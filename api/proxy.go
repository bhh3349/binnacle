package api

import (
	"io"
	"strconv"
	"net"
	"net/http"
	"strings"
	"time"
)

// 反代目标：把 dsh-console（8080）整体挂到 binnacle 的 /console/ 下。
// dsh-console 前端用相对路径（./js/app.js），但 JS 里请求 /api/* 是绝对路径，
// 因此必须同时改写这些绝对路径，否则会打到 binnacle 自己的 /api。
//
// 处理策略：
//   /console/...        → 上游 /...           （静态资源 + 页面）
//   /console/api/...    → 上游 /api/...       （dsh-console 自己的接口）
//   /console/dsh/...    → 上游 /dsh/...       （DSH Web UI 反代，含 WS）
const consolePrefix = "/console"

func (s *Server) consoleProxy(w http.ResponseWriter, r *http.Request) {
	up := s.cfg.ConsoleUpstream // 例：http://127.0.0.1:8080
	if up == "" {
		writeJSON(w, 503, map[string]any{"error": "未配置 dsh-console 上游"})
		return
	}
	// WebSocket 升级：/console/dsh/* 做 TCP 透传（DSH Web UI 需要）
	if strings.Contains(strings.ToLower(r.Header.Get("Connection")), "upgrade") &&
		strings.HasPrefix(r.URL.Path, consolePrefix+"/dsh") {
		hj, ok := w.(http.Hijacker)
		if !ok {
			writeJSON(w, 500, map[string]any{"error": "不支持 hijack"})
			return
		}
		conn, _, err := hj.Hijack()
		if err != nil {
			return
		}
		s.consoleUpgrade(r, conn, nil)
		return
	}

	rest := strings.TrimPrefix(r.URL.Path, consolePrefix)
	if rest == "" {
		rest = "/"
	}

	// HTML 与 JS 需要改写绝对路径，其余直接透传
	isRewrite := strings.HasSuffix(rest, ".html") || rest == "/" ||
		strings.HasSuffix(rest, ".js") || strings.HasSuffix(rest, ".css")

	target := strings.TrimSuffix(up, "/") + rest
	if r.URL.RawQuery != "" {
		target += "?" + r.URL.RawQuery
	}

	req, err := http.NewRequestWithContext(r.Context(), r.Method, target, r.Body)
	if err != nil {
		writeJSON(w, 502, map[string]any{"error": err.Error()})
		return
	}
	for k, vv := range r.Header {
		for _, v := range vv {
			req.Header.Add(k, v)
		}
	}
	req.Header.Del("Accept-Encoding") // 避免拿到压缩内容没法改写

	client := &http.Client{Timeout: 120 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		writeJSON(w, 502, map[string]any{"error": "上游不可达: " + err.Error()})
		return
	}
	defer resp.Body.Close()

	if !isRewrite {
		for k, vv := range resp.Header {
			if strings.EqualFold(k, "Content-Length") || strings.EqualFold(k, "Transfer-Encoding") {
				continue
			}
			for _, v := range vv {
				w.Header().Add(k, v)
			}
		}
		w.WriteHeader(resp.StatusCode)
		_, _ = io.Copy(w, resp.Body)
		return
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		writeJSON(w, 502, map[string]any{"error": err.Error()})
		return
	}
	out := rewriteConsolePaths(string(body))

	for k, vv := range resp.Header {
		if strings.EqualFold(k, "Content-Length") || strings.EqualFold(k, "Transfer-Encoding") {
			continue
		}
		for _, v := range vv {
			w.Header().Add(k, v)
		}
	}
	w.Header().Set("Content-Length", strconv.Itoa(len(out)))
	w.WriteHeader(resp.StatusCode)
	_, _ = w.Write([]byte(out))
}

// rewriteConsolePaths 把上游的绝对路径改成带 /console 前缀。
//   href="/dsh/"       → href="/console/dsh/"
//   '/api/status'      → '/console/api/status'
//   `/api/logs/...`    → `/console/api/logs/...`
//   fetch("/api/...")  → fetch("/console/api/...")
// 只改写 /api/ 与 /dsh/，避免误伤普通文本。
func rewriteConsolePaths(s string) string {
	repls := []struct{ from, to string }{
		{`"/api/`, `"/console/api/`},
		{`'/api/`, `'/console/api/`},
		{"`/api/", "`/console/api/"},
		{`"/dsh/`, `"/console/dsh/`},
		{`'/dsh/`, `'/console/dsh/`},
		{"`/dsh/", "`/console/dsh/"},
		{`href="/dsh/`, `href="/console/dsh/`},
	}
	for _, r := range repls {
		s = strings.ReplaceAll(s, r.from, r.to)
	}
	// 避免二次改写（/console/console/）
	s = strings.ReplaceAll(s, "/console/console/", "/console/")
	return s
}

// consoleUpgrade 处理 /console/dsh/ 的 WebSocket 升级（DSH Web UI 需要）。
func (s *Server) consoleUpgrade(req *http.Request, client net.Conn, head []byte) {
	up := s.cfg.ConsoleUpstream
	if up == "" {
		_ = client.Close()
		return
	}
	host, port := splitHostPort(up)
	rest := strings.TrimPrefix(req.URL.Path, consolePrefix+"/dsh")
	if rest == "" {
		rest = "/"
	}
	path := rest
	if req.URL.RawQuery != "" {
		path += "?" + req.URL.RawQuery
	}

	server, err := net.DialTimeout("tcp", net.JoinHostPort(host, port), 8*time.Second)
	if err != nil {
		_, _ = client.Write([]byte("HTTP/1.1 502 Bad Gateway\r\n\r\n"))
		_ = client.Close()
		return
	}

	var sb strings.Builder
	sb.WriteString(req.Method + " " + path + " HTTP/1.1\r\n")
	for k, vv := range req.Header {
		lk := strings.ToLower(k)
		if lk == "host" {
			sb.WriteString("Host: " + host + ":" + port + "\r\n")
			continue
		}
		for _, v := range vv {
			sb.WriteString(k + ": " + v + "\r\n")
		}
	}
	sb.WriteString("\r\n")
	_, _ = server.Write([]byte(sb.String()))
	if len(head) > 0 {
		_, _ = server.Write(head)
	}

	go func() { _, _ = io.Copy(server, client); _ = server.Close() }()
	_, _ = io.Copy(client, server)
	_ = client.Close()
}

func splitHostPort(u string) (string, string) {
	u = strings.TrimPrefix(u, "http://")
	u = strings.TrimPrefix(u, "https://")
	u = strings.TrimSuffix(u, "/")
	if i := strings.Index(u, "/"); i >= 0 {
		u = u[:i]
	}
	if h, p, err := net.SplitHostPort(u); err == nil {
		return h, p
	}
	return u, "80"
}
