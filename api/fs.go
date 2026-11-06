package api

import (
	"archive/zip"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

type FsEntry struct {
	Name    string    `json:"name"`
	Path    string    `json:"path"`
	IsDir   bool      `json:"isDir"`
	Size    int64     `json:"size"`
	Mode    string    `json:"mode"`
	Mtime   time.Time `json:"mtime"`
	Symlink bool      `json:"symlink"`
	LinkTo  string    `json:"linkTo,omitempty"`
}

type FsListResp struct {
	Path    string    `json:"path"`
	Parent  string    `json:"parent"`
	Entries []FsEntry `json:"entries"`
	Total   int       `json:"total"`
	Free    uint64    `json:"free"`
	TotalSz uint64    `json:"totalSize"`
}

// resolve 把用户给的路径安全地解析到根目录内，阻止 .. 穿越。
func (s *Server) resolve(p string) (string, error) {
	root := s.cfg.RootPath
	if root == "" {
		root = "/"
	}
	root = filepath.Clean(root)

	if p == "" {
		p = "/"
	}
	if !filepath.IsAbs(p) {
		p = "/" + p
	}
	full := filepath.Clean(filepath.Join(root, p))

	// 根为 "/" 时，任何绝对路径都在范围内
	if root == "/" {
		return full, nil
	}
	if full != root && !strings.HasPrefix(full, root+string(os.PathSeparator)) {
		return "", fmt.Errorf("路径越界: %s", p)
	}
	return full, nil
}

// virtual 把物理路径转回以 / 为根的虚拟路径，前端只看到虚拟路径。
func (s *Server) virtual(full string) string {
	root := s.cfg.RootPath
	if root == "" || root == "/" {
		return full
	}
	root = filepath.Clean(root)
	if full == root {
		return "/"
	}
	return strings.TrimPrefix(full, root)
}

func (s *Server) fsList(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	p := q.Get("path")
	showHidden := q.Get("hidden") == "1"
	sortBy := q.Get("sort")
	order := q.Get("order")

	full, err := s.resolve(p)
	if err != nil {
		writeJSON(w, 400, map[string]any{"error": err.Error()})
		return
	}
	fi, err := os.Stat(full)
	if err != nil {
		writeJSON(w, 404, map[string]any{"error": err.Error()})
		return
	}
	if !fi.IsDir() {
		writeJSON(w, 400, map[string]any{"error": "不是目录"})
		return
	}
	des, err := os.ReadDir(full)
	if err != nil {
		writeJSON(w, 403, map[string]any{"error": err.Error()})
		return
	}

	entries := make([]FsEntry, 0, len(des))
	for _, de := range des {
		name := de.Name()
		if !showHidden && strings.HasPrefix(name, ".") {
			continue
		}
		info, err := de.Info()
		if err != nil {
			continue
		}
		e := FsEntry{
			Name:  name,
			Path:  s.virtual(filepath.Join(full, name)),
			IsDir: info.IsDir(),
			Size:  info.Size(),
			Mode:  info.Mode().String(),
			Mtime: info.ModTime(),
		}
		if info.Mode()&os.ModeSymlink != 0 {
			e.Symlink = true
			if t, err := os.Readlink(filepath.Join(full, name)); err == nil {
				e.LinkTo = t
			}
		}
		entries = append(entries, e)
	}

	// 目录永远在前
	sort.SliceStable(entries, func(i, j int) bool {
		a, b := entries[i], entries[j]
		if a.IsDir != b.IsDir {
			return a.IsDir
		}
		var less bool
		switch sortBy {
		case "size":
			less = a.Size < b.Size
		case "name":
			less = strings.ToLower(a.Name) < strings.ToLower(b.Name)
		default:
			less = a.Mtime.After(b.Mtime)
		}
		if order == "desc" && sortBy != "mtime" {
			less = !less
		}
		return less
	})

	parent := s.virtual(filepath.Dir(full))
	if full == filepath.Clean(s.cfg.RootPath) || full == "/" {
		parent = ""
	}

	resp := FsListResp{
		Path:    s.virtual(full),
		Parent:  parent,
		Entries: entries,
		Total:   len(entries),
	}
	if du, err := diskFree(full); err == nil {
		resp.Free, resp.TotalSz = du[0], du[1]
	}
	writeJSON(w, 200, resp)
}

func (s *Server) fsRead(w http.ResponseWriter, r *http.Request) {
	full, err := s.resolve(r.URL.Query().Get("path"))
	if err != nil {
		writeJSON(w, 400, map[string]any{"error": err.Error()})
		return
	}
	fi, err := os.Stat(full)
	if err != nil {
		writeJSON(w, 404, map[string]any{"error": err.Error()})
		return
	}
	if fi.Size() > 4<<20 {
		writeJSON(w, 413, map[string]any{"error": "文件超过 4 MB，请下载后编辑", "size": fi.Size()})
		return
	}
	b, err := os.ReadFile(full)
	if err != nil {
		writeJSON(w, 403, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{
		"path":    s.virtual(full),
		"size":    fi.Size(),
		"mtime":   fi.ModTime(),
		"content": string(b),
	})
}

func (s *Server) fsWrite(w http.ResponseWriter, r *http.Request) {
	full, err := s.resolve(r.URL.Query().Get("path"))
	if err != nil {
		writeJSON(w, 400, map[string]any{"error": err.Error()})
		return
	}
	var body struct {
		Content string `json:"content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, 400, map[string]any{"error": "bad body"})
		return
	}
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		writeJSON(w, 403, map[string]any{"error": err.Error()})
		return
	}
	if err := os.WriteFile(full, []byte(body.Content), 0o644); err != nil {
		writeJSON(w, 403, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) fsDownload(w http.ResponseWriter, r *http.Request) {
	full, err := s.resolve(r.URL.Query().Get("path"))
	if err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	fi, err := os.Stat(full)
	if err != nil {
		http.Error(w, err.Error(), 404)
		return
	}
	if fi.IsDir() {
		s.zipDir(w, full, filepath.Base(full)+".zip")
		return
	}
	w.Header().Set("Content-Disposition", "attachment; filename=\""+filepath.Base(full)+"\"")
	// ServeFile 自带 Range 支持
	http.ServeFile(w, r, full)
}

func (s *Server) zipDir(w http.ResponseWriter, dir, name string) {
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", "attachment; filename=\""+name+"\"")
	zw := zip.NewWriter(w)
	defer zw.Close()

	base := filepath.Dir(dir)
	_ = filepath.Walk(dir, func(p string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return nil
		}
		rel, err := filepath.Rel(base, p)
		if err != nil {
			return nil
		}
		f, err := zw.Create(rel)
		if err != nil {
			return nil
		}
		src, err := os.Open(p)
		if err != nil {
			return nil
		}
		defer src.Close()
		_, _ = io.Copy(f, src)
		return nil
	})
}

func (s *Server) fsMkdir(w http.ResponseWriter, r *http.Request) {
	var body struct{ Path string `json:"path"` }
	_ = json.NewDecoder(r.Body).Decode(&body)
	full, err := s.resolve(body.Path)
	if err != nil {
		writeJSON(w, 400, map[string]any{"error": err.Error()})
		return
	}
	if err := os.MkdirAll(full, 0o755); err != nil {
		writeJSON(w, 403, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "path": s.virtual(full)})
}

func (s *Server) fsRename(w http.ResponseWriter, r *http.Request) {
	var body struct{ From, To string }
	_ = json.NewDecoder(r.Body).Decode(&body)
	from, err1 := s.resolve(body.From)
	to, err2 := s.resolve(body.To)
	if err1 != nil || err2 != nil {
		writeJSON(w, 400, map[string]any{"error": "路径非法"})
		return
	}
	if err := os.Rename(from, to); err != nil {
		writeJSON(w, 403, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) fsDelete(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Paths []string `json:"paths"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	var errs []string
	for _, p := range body.Paths {
		full, err := s.resolve(p)
		if err != nil {
			errs = append(errs, p+": "+err.Error())
			continue
		}
		if err := os.RemoveAll(full); err != nil {
			errs = append(errs, p+": "+err.Error())
		}
	}
	writeJSON(w, 200, map[string]any{"ok": len(errs) == 0, "errors": errs})
}

func (s *Server) fsCopy(w http.ResponseWriter, r *http.Request) {
	var body struct {
		From string `json:"from"`
		To   string `json:"to"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	from, err1 := s.resolve(body.From)
	to, err2 := s.resolve(body.To)
	if err1 != nil || err2 != nil {
		writeJSON(w, 400, map[string]any{"error": "路径非法"})
		return
	}
	if err := copyRecursive(from, to); err != nil {
		writeJSON(w, 500, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) fsChmod(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Path string `json:"path"`
		Mode string `json:"mode"` // "0644"
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	full, err := s.resolve(body.Path)
	if err != nil {
		writeJSON(w, 400, map[string]any{"error": err.Error()})
		return
	}
	m, err := strconv.ParseUint(strings.TrimPrefix(body.Mode, "0o"), 8, 32)
	if err != nil {
		writeJSON(w, 400, map[string]any{"error": "mode 需为八进制，如 0644"})
		return
	}
	if err := os.Chmod(full, os.FileMode(m)); err != nil {
		writeJSON(w, 403, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) fsSearch(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	kw := strings.ToLower(q.Get("q"))
	if kw == "" {
		writeJSON(w, 400, map[string]any{"error": "缺少 q"})
		return
	}
	start, err := s.resolve(q.Get("path"))
	if err != nil {
		writeJSON(w, 400, map[string]any{"error": err.Error()})
		return
	}
	limit := 200
	if v, err := strconv.Atoi(q.Get("limit")); err == nil && v > 0 && v < 2000 {
		limit = v
	}

	var hits []FsEntry
	deadline := time.Now().Add(8 * time.Second)
	_ = filepath.Walk(start, func(p string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if time.Now().After(deadline) {
			return filepath.SkipAll
		}
		if len(hits) >= limit {
			return filepath.SkipAll
		}
		if strings.Contains(strings.ToLower(info.Name()), kw) {
			hits = append(hits, FsEntry{
				Name:  info.Name(),
				Path:  s.virtual(p),
				IsDir: info.IsDir(),
				Size:  info.Size(),
				Mode:  info.Mode().String(),
				Mtime: info.ModTime(),
			})
		}
		return nil
	})
	writeJSON(w, 200, map[string]any{"hits": hits, "count": len(hits), "truncated": len(hits) >= limit})
}

// fsDU 返回目录占用 treemap 数据（只算一层子目录）。
func (s *Server) fsDU(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	full, err := s.resolve(q.Get("path"))
	if err != nil {
		writeJSON(w, 400, map[string]any{"error": err.Error()})
		return
	}
	depth := 1
	if v, err := strconv.Atoi(q.Get("depth")); err == nil && v > 0 && v <= 3 {
		depth = v
	}
	type Node struct {
		Name  string `json:"name"`
		Path  string `json:"path"`
		Size  int64  `json:"size"`
		IsDir bool   `json:"isDir"`
		Count int    `json:"count"`
	}
	var out []Node
	des, err := os.ReadDir(full)
	if err != nil {
		writeJSON(w, 403, map[string]any{"error": err.Error()})
		return
	}
	deadline := time.Now().Add(20 * time.Second)
	for _, de := range des {
		p := filepath.Join(full, de.Name())
		var size int64
		var cnt int
		if de.IsDir() {
			_ = filepath.Walk(p, func(_ string, info os.FileInfo, err error) error {
				if err != nil {
					return nil
				}
				if time.Now().After(deadline) {
					return filepath.SkipAll
				}
				if !info.IsDir() {
					size += info.Size()
					cnt++
				}
				return nil
			})
		} else if info, err := de.Info(); err == nil {
			size = info.Size()
			cnt = 1
		}
		out = append(out, Node{Name: de.Name(), Path: s.virtual(p), Size: size, IsDir: de.IsDir(), Count: cnt})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Size > out[j].Size })
	writeJSON(w, 200, map[string]any{"path": s.virtual(full), "nodes": out, "depth": depth})
}

func (s *Server) fsRoots(w http.ResponseWriter, r *http.Request) {
	var roots []map[string]string
	// 展示 / 下的一级目录作为快捷入口
	des, _ := os.ReadDir("/")
	for _, de := range des {
		if de.IsDir() {
			roots = append(roots, map[string]string{"name": de.Name(), "path": "/" + de.Name()})
		}
	}
	writeJSON(w, 200, map[string]any{"root": s.cfg.RootPath, "shortcuts": roots})
}
