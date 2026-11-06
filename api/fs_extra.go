package api

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"syscall"

	"golang.org/x/image/draw"
	"golang.org/x/image/webp"
	"image"
	"image/gif"
	"image/jpeg"
	"image/png"
)

/* ---------------- 上传：分块 + 断点续传 ---------------- */

// fsUpload 支持三种模式：
//  1. 普通 PUT 整个文件（无 Content-Range）
//  2. 分块：Content-Range: bytes start-end/total，追加写入 .part 临时文件
//  3. 完成：请求头 X-Upload-Final: 1 时把 .part 重命名为目标文件
func (s *Server) fsUpload(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	target := q.Get("path")
	full, err := s.resolve(target)
	if err != nil {
		writeJSON(w, 400, map[string]any{"error": err.Error()})
		return
	}
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		writeJSON(w, 403, map[string]any{"error": err.Error()})
		return
	}

	partPath := full + ".part"
	rangeHdr := r.Header.Get("Content-Range")
	isFinal := r.Header.Get("X-Upload-Final") == "1"

	var f *os.File
	if rangeHdr == "" {
		f, err = os.OpenFile(full, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	} else {
		f, err = os.OpenFile(partPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	}
	if err != nil {
		writeJSON(w, 403, map[string]any{"error": err.Error()})
		return
	}
	n, copyErr := io.Copy(f, r.Body)
	_ = f.Close()
	if copyErr != nil {
		writeJSON(w, 500, map[string]any{"error": copyErr.Error(), "written": n})
		return
	}

	if isFinal && rangeHdr != "" {
		if err := os.Rename(partPath, full); err != nil {
			writeJSON(w, 500, map[string]any{"error": err.Error()})
			return
		}
	}

	var size int64
	if fi, err := os.Stat(full); err == nil {
		size = fi.Size()
	}
	writeJSON(w, 200, map[string]any{"ok": true, "written": n, "path": s.virtual(full), "size": size, "final": isFinal})
}

/* ---------------- 缩略图 ---------------- */

func (s *Server) fsThumb(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	full, err := s.resolve(q.Get("path"))
	if err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	maxW := 256
	if v, err := atoiSafe(q.Get("w")); err == nil && v > 16 && v <= 1024 {
		maxW = v
	}

	f, err := os.Open(full)
	if err != nil {
		http.Error(w, err.Error(), 404)
		return
	}
	defer f.Close()

	ext := strings.ToLower(filepath.Ext(full))
	var src image.Image
	switch ext {
	case ".jpg", ".jpeg":
		src, err = jpeg.Decode(f)
	case ".png":
		src, err = png.Decode(f)
	case ".gif":
		src, err = gif.Decode(f)
	case ".webp":
		src, err = webp.Decode(f)
	default:
		http.Error(w, "不支持的图片格式", 415)
		return
	}
	if err != nil {
		http.Error(w, "解码失败", 415)
		return
	}

	b := src.Bounds()
	w0, h0 := b.Dx(), b.Dy()
	if w0 == 0 || h0 == 0 {
		http.Error(w, "空图像", 415)
		return
	}
	newW := maxW
	newH := h0 * maxW / w0
	if newH == 0 {
		newH = 1
	}
	if newW >= w0 {
		newW, newH = w0, h0
	}

	dst := image.NewRGBA(image.Rect(0, 0, newW, newH))
	draw.ApproxBiLinear.Scale(dst, dst.Bounds(), src, b, draw.Over, nil)

	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("Cache-Control", "public, max-age=3600")
	_ = jpeg.Encode(w, dst, &jpeg.Options{Quality: 82})
}

/* ---------------- 工具 ---------------- */

func atoiSafe(s string) (int, error) {
	var n int
	_, err := fmt.Sscanf(s, "%d", &n)
	return n, err
}

// diskFree 返回 [可用, 总量]。
func diskFree(p string) ([2]uint64, error) {
	var st syscall.Statfs_t
	if err := syscall.Statfs(p, &st); err != nil {
		return [2]uint64{}, err
	}
	return [2]uint64{st.Bavail * uint64(st.Bsize), st.Blocks * uint64(st.Bsize)}, nil
}

// copyRecursive 复制文件或目录。
func copyRecursive(src, dst string) error {
	info, err := os.Stat(src)
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return copyFile(src, dst, info.Mode())
	}
	if err := os.MkdirAll(dst, info.Mode()); err != nil {
		return err
	}
	des, err := os.ReadDir(src)
	if err != nil {
		return err
	}
	for _, de := range des {
		s := filepath.Join(src, de.Name())
		d := filepath.Join(dst, de.Name())
		if err := copyRecursive(s, d); err != nil {
			return err
		}
	}
	return nil
}

func copyFile(src, dst string, mode os.FileMode) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, mode)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}
