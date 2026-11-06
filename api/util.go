package api

import (
	"context"
	"crypto/md5"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"os/user"
	"syscall"
	"time"
)

func contextWithTimeout(d time.Duration) (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), d)
}

func fileMD5(p string) (string, error) {
	f, err := os.Open(p)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := md5.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func fileAtime(fi os.FileInfo) time.Time {
	if st, ok := fi.Sys().(*syscall.Stat_t); ok {
		return time.Unix(st.Atim.Sec, st.Atim.Nsec)
	}
	return time.Time{}
}

func fileCtime(st *syscall.Stat_t) time.Time {
	if st != nil {
		return time.Unix(st.Ctim.Sec, st.Ctim.Nsec)
	}
	return time.Time{}
}

func fileNlink(st *syscall.Stat_t) uint64 {
	if st != nil {
		return uint64(st.Nlink)
	}
	return 0
}

func fileInode(st *syscall.Stat_t) uint64 {
	if st != nil {
		return uint64(st.Ino)
	}
	return 0
}

var _ = fmt.Sprintf

// uidOf 返回 uid 对应的用户名（查不到返回数字）。
func uidOf(fi os.FileInfo) string {
	st, ok := fi.Sys().(*syscall.Stat_t)
	if !ok {
		return "?"
	}
	if u, err := user.LookupId(fmt.Sprint(st.Uid)); err == nil {
		return u.Username
	}
	return fmt.Sprint(st.Uid)
}
