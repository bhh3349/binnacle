package main

import (
	"flag"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/bhh3349/binnacle/api"
)

func main() {
	var (
		addr     = flag.String("addr", "127.0.0.1:8090", "监听地址")
		root     = flag.String("root", "/", "文件管理根目录")
		stateDir = flag.String("state", "/var/lib/binnacle", "状态目录（token、db）")
		webDir   = flag.String("web", "", "前端静态目录")
		sampleMs = flag.Int("sample", 1000, "采样间隔（毫秒）")
		token    = flag.String("token", "", "固定 token（默认自动生成）")
		retain   = flag.Int("retain", 7, "历史保留天数")
	)
	flag.Parse()

	exe, _ := os.Executable()
	if *webDir == "" {
		for _, c := range []string{
			filepath.Join(filepath.Dir(exe), "web"),
			filepath.Join(filepath.Dir(exe), "..", "web"),
			"web",
		} {
			if fi, err := os.Stat(c); err == nil && fi.IsDir() {
				*webDir = c
				break
			}
		}
	}

	srv, err := api.New(api.Config{
		Addr:      *addr,
		StateDir:  *stateDir,
		RootPath:  *root,
		Token:     *token,
		SampleMs:  *sampleMs,
		StorePath: filepath.Join(*stateDir, "metrics.db"),
		WebDir:    *webDir,
	})
	if err != nil {
		log.Fatalf("init: %v", err)
	}

	srv.StartCollector()

	// 每天清理一次历史
	go func() {
		for {
			time.Sleep(24 * time.Hour)
			if err := srv.PruneStore(*retain); err != nil {
				log.Printf("prune: %v", err)
			}
		}
	}()

	hs := &http.Server{
		Addr:              *addr,
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	log.Printf("binnacle listening on http://%s", *addr)
	log.Printf("  root  = %s", *root)
	log.Printf("  web   = %s", *webDir)
	log.Printf("  token = %s", srv.Token())
	if err := hs.ListenAndServe(); err != nil {
		log.Fatal(err)
	}
}
