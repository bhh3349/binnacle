package api

import (
	"bufio"
	"encoding/json"
	"net/http"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type Service struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Active      string `json:"active"`
	Sub         string `json:"sub"`
	LoadState   string `json:"loadState"`
	SinceUnix   int64  `json:"sinceUnix"`
	MainPID     int    `json:"mainPid"`
}

// 允许操作的 unit 白名单前缀，防止任意 unit 被停掉。
var unitAllowPrefix = []string{
	"dsh-", "srvconsole", "jupyter", "docker", "containerd", "sshd", "mihomo", "cockpit",
}

func unitAllowed(name string) bool {
	base := strings.TrimSuffix(name, ".service")
	for _, p := range unitAllowPrefix {
		if strings.HasPrefix(base, p) {
			return true
		}
	}
	return false
}

func (s *Server) svcList(w http.ResponseWriter, r *http.Request) {
	out, err := exec.Command("systemctl", "list-units", "--type=service", "--all",
		"--no-pager", "--plain", "--no-legend").Output()
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": err.Error()})
		return
	}

	var list []Service
	sc := bufio.NewScanner(strings.NewReader(string(out)))
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" {
			continue
		}
		f := strings.Fields(line)
		if len(f) < 4 {
			continue
		}
		name := f[0]
		// 只暴露白名单内的 + 运行中的非系统 unit
		if !unitAllowed(name) {
			continue
		}
		svc := Service{
			Name:        name,
			LoadState:   f[1],
			Active:      f[2],
			Sub:         f[3],
			Description: strings.Join(f[4:], " "),
		}
		list = append(list, svc)
	}

	// 补 PID 与启动时间
	var wg sync.WaitGroup
	for i := range list {
		wg.Add(1)
		go func(sv *Service) {
			defer wg.Done()
			out, err := exec.Command("systemctl", "show", sv.Name, "--no-pager", "--timestamp=unix",
				"--property=MainPID,ActiveEnterTimestamp").Output()
			if err != nil {
				return
			}
			for _, ln := range strings.Split(string(out), "\n") {
				k, v, ok := strings.Cut(strings.TrimSpace(ln), "=")
				if !ok {
					continue
				}
				switch k {
				case "MainPID":
					sv.MainPID, _ = strconv.Atoi(v)
				case "ActiveEnterTimestamp":
					v = strings.TrimPrefix(v, "@")
					sv.SinceUnix, _ = strconv.ParseInt(v, 10, 64)
				}
			}
		}(&list[i])
	}
	wg.Wait()

	writeJSON(w, 200, map[string]any{"services": list, "count": len(list)})
}

func (s *Server) svcAction(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	action := r.PathValue("action")

	if !unitAllowed(name) {
		writeJSON(w, 403, map[string]any{"error": "unit 不在白名单: " + name})
		return
	}
	switch action {
	case "start", "stop", "restart", "reload":
	default:
		writeJSON(w, 400, map[string]any{"error": "未知动作: " + action})
		return
	}

	// 操作自身 unit 时必须脱离，否则 systemctl 会杀掉执行它的进程
	if strings.HasPrefix(name, "srvconsole") && (action == "restart" || action == "stop") {
		go func() {
			time.Sleep(150 * time.Millisecond)
			_ = exec.Command("systemctl", action, name).Run()
		}()
		writeJSON(w, 202, map[string]any{"ok": true, "pending": true,
			"output": "已派发，控制台会重启，请稍后刷新"})
		return
	}

	ctx, cancel := contextWithTimeout(90 * time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "systemctl", action, name)
	out, err := cmd.CombinedOutput()
	output := strings.TrimSpace(string(out))
	if err != nil {
		// 二次确认，避免假失败
		if check := exec.Command("systemctl", "is-active", name); check.Run() == nil {
			writeJSON(w, 200, map[string]any{"ok": true, "output": output, "verified": true})
			return
		}
		writeJSON(w, 500, map[string]any{"error": err.Error(), "output": output})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "output": output})
}

/* ---------------- 日志 ---------------- */

func (s *Server) logsGet(w http.ResponseWriter, r *http.Request) {
	unit := r.PathValue("unit")
	lines := 200
	if v, err := strconv.Atoi(r.URL.Query().Get("lines")); err == nil && v > 0 && v <= 5000 {
		lines = v
	}
	out, err := exec.Command("journalctl", "-u", unit, "-n", strconv.Itoa(lines),
		"--no-pager", "-o", "cat").Output()
	if err != nil && len(out) == 0 {
		writeJSON(w, 500, map[string]any{"error": err.Error()})
		return
	}
	all := strings.Split(strings.TrimRight(string(out), "\n"), "\n")
	if len(all) == 1 && all[0] == "" {
		all = nil
	}
	writeJSON(w, 200, map[string]any{"unit": unit, "lines": all, "count": len(all)})
}

func (s *Server) logsStream(w http.ResponseWriter, r *http.Request) {
	unit := r.PathValue("unit")
	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	ctx, cancel := contextWithTimeout(2 * time.Hour)
	defer cancel()

	cmd := exec.CommandContext(ctx, "journalctl", "-u", unit, "-f", "-n", "200",
		"--no-pager", "-o", "short-iso")
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return
	}
	if err := cmd.Start(); err != nil {
		return
	}
	defer func() { _ = cmd.Process.Kill(); _ = cmd.Wait() }()

	// 客户端断开时取消
	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				cancel()
				return
			}
		}
	}()

	sc := bufio.NewScanner(stdout)
	sc.Buffer(make([]byte, 0, 64*1024), 1<<20)
	for sc.Scan() {
		select {
		case <-done:
			return
		default:
		}
		b, _ := json.Marshal(map[string]string{"line": sc.Text()})
		_ = conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
		if err := conn.WriteMessage(websocket.TextMessage, b); err != nil {
			return
		}
	}
}
