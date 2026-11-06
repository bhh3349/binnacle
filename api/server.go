package api

import (
	"bufio"
	"crypto/rand"
	"fmt"
	"net"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"github.com/bhh3349/binnacle/collect"
)

type Config struct {
	Addr      string
	StateDir  string
	RootPath  string // 文件管理根目录
	Token     string
	SampleMs  int
	StorePath string
	WebDir    string
}

type Server struct {
	cfg      Config
	host     *collect.HostCollector
	gpu      *collect.GPUCollector
	hub      *Hub
	store    *Store
	upgrader websocket.Upgrader
	token    string
}

func New(cfg Config) (*Server, error) {
	if err := os.MkdirAll(cfg.StateDir, 0o755); err != nil {
		return nil, err
	}
	tok := cfg.Token
	if tok == "" {
		tok = loadOrCreateToken(cfg.StateDir)
	}
	st, err := OpenStore(cfg.StorePath)
	if err != nil {
		return nil, err
	}
	s := &Server{
		cfg:   cfg,
		host:  collect.NewHostCollector(),
		gpu:   collect.NewGPUCollector(),
		hub:   NewHub(),
		store: st,
		token: tok,
		upgrader: websocket.Upgrader{
			ReadBufferSize:  4096,
			WriteBufferSize: 4096,
			CheckOrigin:     func(r *http.Request) bool { return true },
		},
	}
	return s, nil
}

func loadOrCreateToken(dir string) string {
	p := filepath.Join(dir, "token")
	if b, err := os.ReadFile(p); err == nil {
		if s := strings.TrimSpace(string(b)); len(s) >= 16 {
			return s
		}
	}
	buf := make([]byte, 24)
	_, _ = rand.Read(buf)
	tok := hex.EncodeToString(buf)
	_ = os.WriteFile(p, []byte(tok+"\n"), 0o600)
	return tok
}

func (s *Server) Token() string { return s.token }

/* ---------------- 采集循环 ---------------- */

func (s *Server) StartCollector() {
	interval := time.Duration(s.cfg.SampleMs) * time.Millisecond
	if interval <= 0 {
		interval = time.Second
	}
	s.host.Collect() // 预热差分

	go func() {
		t := time.NewTicker(interval)
		defer t.Stop()
		var lastStore time.Time
		for range t.C {
			snap := collect.Snapshot{T: time.Now().UnixMilli()}
			snap.Host = s.host.Collect()
			snap.GPUs = s.gpu.Collect()

			s.hub.Broadcast(snap)

			// 落盘节流：30s 一次，实时曲线走内存环形缓冲
			if time.Since(lastStore) >= 30*time.Second {
				lastStore = time.Now()
				if err := s.store.Append(snap); err != nil {
					log.Printf("store append: %v", err)
				}
			}
		}
	}()
}

/* ---------------- 路由 ---------------- */

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	// 公开：健康检查 + 登录
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{"ok": true, "time": time.Now().UnixMilli()})
	})
	mux.HandleFunc("POST /api/login", s.handleLogin)
	mux.HandleFunc("GET /api/meta", s.handleMeta)

	// 受保护
	auth := s.requireAuth
	mux.Handle("GET /api/snapshot", auth(http.HandlerFunc(s.handleSnapshot)))
	mux.Handle("GET /api/history", auth(http.HandlerFunc(s.handleHistory)))
	mux.Handle("GET /ws", auth(http.HandlerFunc(s.handleWS)))

	// 文件系统
	mux.Handle("GET /api/fs/list", auth(http.HandlerFunc(s.fsList)))
	mux.Handle("GET /api/fs/read", auth(http.HandlerFunc(s.fsRead)))
	mux.Handle("PUT /api/fs/write", auth(http.HandlerFunc(s.fsWrite)))
	mux.Handle("GET /api/fs/download", auth(http.HandlerFunc(s.fsDownload)))
	mux.Handle("GET /api/fs/thumb", auth(http.HandlerFunc(s.fsThumb)))
	mux.Handle("POST /api/fs/mkdir", auth(http.HandlerFunc(s.fsMkdir)))
	mux.Handle("POST /api/fs/rename", auth(http.HandlerFunc(s.fsRename)))
	mux.Handle("POST /api/fs/delete", auth(http.HandlerFunc(s.fsDelete)))
	mux.Handle("POST /api/fs/copy", auth(http.HandlerFunc(s.fsCopy)))
	mux.Handle("POST /api/fs/chmod", auth(http.HandlerFunc(s.fsChmod)))
	mux.Handle("POST /api/fs/upload", auth(http.HandlerFunc(s.fsUpload)))
	mux.Handle("GET /api/fs/search", auth(http.HandlerFunc(s.fsSearch)))
	mux.Handle("GET /api/fs/du", auth(http.HandlerFunc(s.fsDU)))
	mux.Handle("GET /api/fs/roots", auth(http.HandlerFunc(s.fsRoots)))

	// 服务与日志
	mux.Handle("GET /api/services", auth(http.HandlerFunc(s.svcList)))
	mux.Handle("POST /api/services/{name}/{action}", auth(http.HandlerFunc(s.svcAction)))
	mux.Handle("GET /api/logs/{unit}", auth(http.HandlerFunc(s.logsGet)))
	mux.Handle("GET /ws/logs/{unit}", auth(http.HandlerFunc(s.logsStream)))

	// 终端
	mux.Handle("GET /ws/term", auth(http.HandlerFunc(s.termWS)))

	// 静态前端
	mux.Handle("GET /", s.staticHandler())

	return logMiddleware(mux)
}

func (s *Server) staticHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.cfg.WebDir == "" {
			http.NotFound(w, r)
			return
		}
		p := filepath.Join(s.cfg.WebDir, filepath.Clean("/"+r.URL.Path))
		if fi, err := os.Stat(p); err != nil || fi.IsDir() {
			p = filepath.Join(s.cfg.WebDir, "index.html")
		}
		http.ServeFile(w, r, p)
	})
}

/* ---------------- 鉴权 ---------------- */

func (s *Server) requireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var got string
		if c, err := r.Cookie("sc_token"); err == nil {
			got = c.Value
		}
		if got == "" {
			got = r.Header.Get("X-Token")
		}
		if got == "" {
			got = r.URL.Query().Get("token")
		}
		if subtle.ConstantTimeCompare([]byte(got), []byte(s.token)) != 1 {
			writeJSON(w, 401, map[string]any{"error": "unauthorized"})
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Token string `json:"token"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if subtle.ConstantTimeCompare([]byte(body.Token), []byte(s.token)) != 1 {
		writeJSON(w, 401, map[string]any{"error": "token 不正确"})
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     "sc_token",
		Value:    s.token,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   30 * 24 * 3600,
	})
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) handleMeta(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]any{
		"root":     s.cfg.RootPath,
		"sampleMs": s.cfg.SampleMs,
	})
}

func (s *Server) handleSnapshot(w http.ResponseWriter, r *http.Request) {
	snap := collect.Snapshot{T: time.Now().UnixMilli()}
	snap.Host = s.host.Collect()
	snap.GPUs = s.gpu.Collect()
	writeJSON(w, 200, snap)
}

/* ---------------- WebSocket ---------------- */

func (s *Server) handleWS(w http.ResponseWriter, r *http.Request) {
	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	client := s.hub.Add(conn)
	defer s.hub.Remove(client)

	// 先推一份当前值，避免前端等一秒
	snap := collect.Snapshot{T: time.Now().UnixMilli()}
	snap.Host = s.host.Collect()
	snap.GPUs = s.gpu.Collect()
	s.hub.Send(client, snap)

	// 读循环：只用于检测断开和接收 ping
	for {
		if _, _, err := conn.ReadMessage(); err != nil {
			return
		}
	}
}

/* ---------------- 工具 ---------------- */

func writeJSON(w http.ResponseWriter, code int, v any) {
	b, err := json.Marshal(v)
	if err != nil {
		http.Error(w, `{"error":"encode"}`, 500)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	_, _ = w.Write(b)
}

func logMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		sw := &statusWriter{ResponseWriter: w, code: 200}
		next.ServeHTTP(sw, r)
		if sw.code >= 400 || time.Since(start) > 500*time.Millisecond {
			log.Printf("%s %s -> %d (%v)", r.Method, r.URL.Path, sw.code, time.Since(start).Round(time.Millisecond))
		}
	})
}

type statusWriter struct {
	http.ResponseWriter
	code int
}

func (w *statusWriter) WriteHeader(c int) {
	w.code = c
	w.ResponseWriter.WriteHeader(c)
}

// Hijack 必须透传，否则 WebSocket upgrade 会 500：
// 包装过的 ResponseWriter 默认不实现 http.Hijacker。
func (w *statusWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	h, ok := w.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, fmt.Errorf("responsewriter 不支持 hijack")
	}
	w.code = 101
	return h.Hijack()
}

// Flush 让 SSE / 流式响应能及时吐出。
func (w *statusWriter) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

var _ = sync.Mutex{}
