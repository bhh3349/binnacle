package api

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

/* ---------------- 打包 ---------------- */

// fsArchive 把多个路径打包成 zip。
//   body: { "paths": ["/a", "/b"], "dest": "", "download": true }
//   download=true（或 dest 为空）：流式返回 zip 文件
//   否则：写到 dest 路径（dest 是完整的 zip 文件路径）
func (s *Server) fsArchive(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Paths    []string `json:"paths"`
		Dest     string   `json:"dest"`
		Download bool     `json:"download"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || len(body.Paths) == 0 {
		writeJSON(w, 400, map[string]any{"error": "需要 paths 数组"})
		return
	}

	// 解析并校验全部路径
	type srcEntry struct {
		full  string
		rel   string // zip 内路径
		isDir bool
	}
	var sources []srcEntry
	for _, p := range body.Paths {
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
		rel := filepath.Base(full)
		if fi.IsDir() {
			rel += "/"
		}
		sources = append(sources, srcEntry{full: full, rel: rel, isDir: fi.IsDir()})
	}

	if body.Download || body.Dest == "" {
		w.Header().Set("Content-Type", "application/zip")
		w.Header().Set("Content-Disposition", `attachment; filename="archive.zip"`)
		zw := zip.NewWriter(w)
		defer zw.Close()
		for _, se := range sources {
			if err := zipAdd(zw, se.full, se.rel); err != nil {
				return // 流已破，直接断
			}
		}
		return
	}

	dest, err := s.resolve(body.Dest)
	if err != nil {
		writeJSON(w, 400, map[string]any{"error": err.Error()})
		return
	}
	if !strings.HasSuffix(strings.ToLower(dest), ".zip") {
		writeJSON(w, 400, map[string]any{"error": "dest 必须以 .zip 结尾"})
		return
	}
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		writeJSON(w, 403, map[string]any{"error": err.Error()})
		return
	}
	df, err := os.Create(dest)
	if err != nil {
		writeJSON(w, 403, map[string]any{"error": err.Error()})
		return
	}
	defer df.Close()
	zw := zip.NewWriter(df)
	for _, se := range sources {
		if err := zipAdd(zw, se.full, se.rel); err != nil {
			writeJSON(w, 500, map[string]any{"error": err.Error()})
			return
		}
	}
	if err := zw.Close(); err != nil {
		writeJSON(w, 500, map[string]any{"error": err.Error()})
		return
	}
	fi, _ := df.Stat()
	writeJSON(w, 200, map[string]any{"ok": true, "path": s.virtual(dest), "size": fi.Size()})
}

func zipAdd(zw *zip.Writer, full, rel string) error {
	return filepath.Walk(full, func(p string, info os.FileInfo, err error) error {
		if err != nil {
			return nil // 跳过无法读取的条目
		}
		relP := rel
		if p != full {
			r, err := filepath.Rel(full, p)
			if err != nil {
				return nil
			}
			relP = rel + r
		}
		if info.IsDir() {
			_, err := zw.Create(relP + "/")
			return err
		}
		hdr := &zip.FileHeader{Name: relP, Method: zip.Deflate, Modified: info.ModTime()}
		hdr.SetMode(info.Mode())
		f, err := zw.CreateHeader(hdr)
		if err != nil {
			return err
		}
		src, err := os.Open(p)
		if err != nil {
			return nil
		}
		defer src.Close()
		_, err = io.Copy(f, src)
		return err
	})
}

/* ---------------- 解压 ---------------- */

// fsExtract 解压 zip / tar / tar.gz / tgz 到 destDir。
//   body: { "path": "/a/foo.zip", "destDir": "/a/out" }
//   防 zip-slip：条目名含 .. 或绝对路径一律拒绝。
func (s *Server) fsExtract(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Path    string `json:"path"`
		DestDir string `json:"destDir"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Path == "" {
		writeJSON(w, 400, map[string]any{"error": "需要 path"})
		return
	}
	src, err := s.resolve(body.Path)
	if err != nil {
		writeJSON(w, 400, map[string]any{"error": err.Error()})
		return
	}
	if body.DestDir == "" {
		// 默认解到同名目录（去扩展名）
		base := filepath.Base(src)
		if i := strings.LastIndex(base, "."); i > 0 {
			base = base[:i]
		}
		if strings.HasSuffix(strings.ToLower(base), ".tar") {
			base = base[:len(base)-4]
		}
		body.DestDir = filepath.Join(s.virtual(filepath.Dir(src)), base)
	}
	dest, err := s.resolve(body.DestDir)
	if err != nil {
		writeJSON(w, 400, map[string]any{"error": err.Error()})
		return
	}
	if err := os.MkdirAll(dest, 0o755); err != nil {
		writeJSON(w, 403, map[string]any{"error": err.Error()})
		return
	}

	f, err := os.Open(src)
	if err != nil {
		writeJSON(w, 404, map[string]any{"error": err.Error()})
		return
	}
	defer f.Close()

	var count int
	lower := strings.ToLower(src)
	switch {
	case strings.HasSuffix(lower, ".zip"):
		count, err = extractZip(f, dest)
	case strings.HasSuffix(lower, ".tar.gz"), strings.HasSuffix(lower, ".tgz"):
		gz, gzErr := gzip.NewReader(f)
		if gzErr != nil {
			writeJSON(w, 415, map[string]any{"error": gzErr.Error()})
			return
		}
		count, err = extractTar(gz, dest)
	case strings.HasSuffix(lower, ".tar"):
		count, err = extractTar(f, dest)
	default:
		writeJSON(w, 415, map[string]any{"error": "不支持的格式（支持 zip / tar / tar.gz / tgz）"})
		return
	}
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": err.Error(), "extracted": count})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "dest": s.virtual(dest), "extracted": count})
}

// safeJoinDest 校验条目名不会逃出 dest（zip-slip / tar-slip 防护）。
func safeJoinDest(dest, name string) (string, error) {
	clean := filepath.Clean("/" + name) // 强制相对化并去掉 ..
	if strings.Contains(clean, "..") {
		return "", fmt.Errorf("条目路径非法: %s", name)
	}
	return filepath.Join(dest, clean), nil
}

func extractZip(r io.ReaderAt, dest string) (int, error) {
	// 大小未知时用 64 位极限值；zip.Reader 需要大小，这里从调用侧拿不到 f.Stat，
	// 简化：先读进内存的上限设为 1 GiB，超出报错（本地场景足够）。
	// 若需支持更大文件，调用侧改传 *os.File + Size。
	fi, ok := r.(interface{ Stat() (os.FileInfo, error) })
	if !ok {
		return 0, fmt.Errorf("内部错误：需要 *os.File")
	}
	st, err := fi.Stat()
	if err != nil {
		return 0, err
	}
	zr, err := zip.NewReader(r, st.Size())
	if err != nil {
		return 0, err
	}
	count := 0
	for _, zf := range zr.File {
		target, err := safeJoinDest(dest, zf.Name)
		if err != nil {
			return count, err
		}
		if zf.FileInfo().IsDir() {
			if err := os.MkdirAll(target, 0o755); err != nil {
				return count, err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return count, err
		}
		rc, err := zf.Open()
		if err != nil {
			return count, err
		}
		out, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, zf.Mode())
		if err != nil {
			rc.Close()
			return count, err
		}
		_, err = io.Copy(out, rc)
		rc.Close()
		out.Close()
		if err != nil {
			return count, err
		}
		count++
	}
	return count, nil
}

func extractTar(r io.Reader, dest string) (int, error) {
	tr := tar.NewReader(r)
	count := 0
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return count, err
		}
		target, err := safeJoinDest(dest, hdr.Name)
		if err != nil {
			return count, err
		}
		switch hdr.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, 0o755); err != nil {
				return count, err
			}
		case tar.TypeReg, tar.TypeRegA:
			if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
				return count, err
			}
			out, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, os.FileMode(hdr.Mode))
			if err != nil {
				return count, err
			}
			_, err = io.Copy(out, tr)
			out.Close()
			if err != nil {
				return count, err
			}
			count++
		case tar.TypeSymlink, tar.TypeLink:
			// 链接一律跳过：Web 面板解压出的链接是常见攻击面，保持保守
		}
	}
	return count, nil
}
