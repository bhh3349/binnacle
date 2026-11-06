package api

import (
	"encoding/json"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"srvconsole/collect"
)

// Hub 管理所有 WS 连接，单次采样广播给全部客户端。
type Hub struct {
	mu      sync.RWMutex
	clients map[*Client]struct{}
}

type Client struct {
	conn *websocket.Conn
	mu   sync.Mutex
}

func NewHub() *Hub { return &Hub{clients: map[*Client]struct{}{}} }

func (h *Hub) Add(c *websocket.Conn) *Client {
	cl := &Client{conn: c}
	h.mu.Lock()
	h.clients[cl] = struct{}{}
	h.mu.Unlock()
	return cl
}

func (h *Hub) Remove(cl *Client) {
	h.mu.Lock()
	delete(h.clients, cl)
	h.mu.Unlock()
	_ = cl.conn.Close()
}

func (h *Hub) Send(cl *Client, v any) {
	b, err := json.Marshal(v)
	if err != nil {
		return
	}
	cl.mu.Lock()
	defer cl.mu.Unlock()
	_ = cl.conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
	_ = cl.conn.WriteMessage(websocket.TextMessage, b)
}

// Broadcast 给所有客户端推送；写失败的直接摘掉。
func (h *Hub) Broadcast(v any) {
	b, err := json.Marshal(v)
	if err != nil {
		return
	}
	h.mu.RLock()
	list := make([]*Client, 0, len(h.clients))
	for c := range h.clients {
		list = append(list, c)
	}
	h.mu.RUnlock()

	var dead []*Client
	for _, c := range list {
		c.mu.Lock()
		_ = c.conn.SetWriteDeadline(time.Now().Add(3 * time.Second))
		err := c.conn.WriteMessage(websocket.TextMessage, b)
		c.mu.Unlock()
		if err != nil {
			dead = append(dead, c)
		}
	}
	for _, c := range dead {
		h.Remove(c)
	}
}

func (h *Hub) Count() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}

var _ = collect.Snapshot{}
