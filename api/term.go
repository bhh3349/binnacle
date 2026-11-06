package api

import (
	"encoding/json"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"sync"
	"time"

	"github.com/creack/pty"
	"github.com/gorilla/websocket"
)

type termMsg struct {
	Type string `json:"type"` // input | resize | ping
	Data string `json:"data,omitempty"`
	Cols int    `json:"cols,omitempty"`
	Rows int    `json:"rows,omitempty"`
}

// termWS 提供一个 PTY 终端。前端用 xterm.js 对接。
func (s *Server) termWS(w http.ResponseWriter, r *http.Request) {
	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	shell := "/bin/bash"
	if _, err := os.Stat(shell); err != nil {
		shell = "/bin/sh"
	}

	cmd := exec.Command(shell, "-l")
	cmd.Env = append(os.Environ(),
		"TERM=xterm-256color",
		"COLORTERM=truecolor",
		"LANG=C.UTF-8",
	)
	// 终端默认落在工作目录
	cmd.Dir = "/root"

	ptmx, err := pty.StartWithSize(cmd, &pty.Winsize{Cols: 120, Rows: 32})
	if err != nil {
		_ = conn.WriteJSON(map[string]string{"type": "error", "data": err.Error()})
		return
	}
	defer func() {
		_ = ptmx.Close()
		_ = cmd.Process.Kill()
		_, _ = cmd.Process.Wait()
	}()

	var once sync.Once
	cleanup := func() {
		once.Do(func() {
			_ = ptmx.Close()
			_ = conn.Close()
		})
	}
	defer cleanup()

	// PTY -> WS
	go func() {
		defer cleanup()
		buf := make([]byte, 32*1024)
		for {
			n, err := ptmx.Read(buf)
			if n > 0 {
				_ = conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
				if werr := conn.WriteMessage(websocket.BinaryMessage, buf[:n]); werr != nil {
					return
				}
			}
			if err != nil {
				return
			}
		}
	}()

	// WS -> PTY
	for {
		mt, data, err := conn.ReadMessage()
		if err != nil {
			return
		}
		if mt == websocket.BinaryMessage {
			_, _ = ptmx.Write(data)
			continue
		}
		var m termMsg
		if err := json.Unmarshal(data, &m); err != nil {
			// 非 JSON 就当原始输入
			_, _ = ptmx.Write(data)
			continue
		}
		switch m.Type {
		case "input":
			_, _ = ptmx.Write([]byte(m.Data))
		case "resize":
			cols, rows := m.Cols, m.Rows
			if cols <= 0 {
				cols = 120
			}
			if rows <= 0 {
				rows = 32
			}
			_ = pty.Setsize(ptmx, &pty.Winsize{Cols: uint16(cols), Rows: uint16(rows)})
		case "ping":
			_ = conn.WriteJSON(map[string]string{"type": "pong"})
		}
	}
}

func (s *Server) handleHistory(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	now := timeNowUnix()
	to := now
	from := now - 3600
	if v, err := strconv.ParseInt(q.Get("to"), 10, 64); err == nil {
		to = v
	}
	if v, err := strconv.ParseInt(q.Get("from"), 10, 64); err == nil {
		from = v
	}
	step := 30
	if v, err := strconv.Atoi(q.Get("step")); err == nil && v > 0 {
		step = v
	}
	snaps, err := s.store.Query(from, to, step)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"from": from, "to": to, "step": step, "points": snaps, "count": len(snaps)})
}

func timeNowUnix() int64 { return time.Now().Unix() }
