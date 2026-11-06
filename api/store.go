package api

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite"

	"srvconsole/collect"
)

// Store 只存降采样后的历史点，实时曲线走内存。
type Store struct {
	db *sql.DB
}

func OpenStore(path string) (*Store, error) {
	if path == "" {
		path = "/var/lib/srvconsole/metrics.db"
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", path+"?_pragma=journal_mode(WAL)&_pragma=synchronous(NORMAL)&_pragma=busy_timeout(5000)")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS sample (
			ts     INTEGER PRIMARY KEY,
			host   TEXT NOT NULL,
			gpus   TEXT NOT NULL
		);
		CREATE INDEX IF NOT EXISTS idx_sample_ts ON sample(ts);
	`); err != nil {
		return nil, fmt.Errorf("create table: %w", err)
	}
	return &Store{db: db}, nil
}

func (s *Store) Append(snap collect.Snapshot) error {
	h, err := json.Marshal(snap.Host)
	if err != nil {
		return err
	}
	g, err := json.Marshal(snap.GPUs)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`INSERT OR REPLACE INTO sample(ts, host, gpus) VALUES(?,?,?)`,
		snap.T/1000, string(h), string(g))
	return err
}

// Query 返回时间窗口内的历史点。step 为最小间隔秒数。
func (s *Store) Query(from, to int64, step int) ([]collect.Snapshot, error) {
	if step <= 0 {
		step = 30
	}
	rows, err := s.db.Query(`
		SELECT ts, host, gpus FROM sample
		WHERE ts >= ? AND ts <= ? AND (ts % ?) = 0
		ORDER BY ts ASC LIMIT 5000`, from, to, step)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []collect.Snapshot
	for rows.Next() {
		var ts int64
		var hStr, gStr string
		if err := rows.Scan(&ts, &hStr, &gStr); err != nil {
			continue
		}
		var snap collect.Snapshot
		snap.T = ts * 1000
		_ = json.Unmarshal([]byte(hStr), &snap.Host)
		_ = json.Unmarshal([]byte(gStr), &snap.GPUs)
		out = append(out, snap)
	}
	return out, rows.Err()
}

// Prune 删除超过保留期的数据。
func (s *Store) Prune(days int) error {
	if days <= 0 {
		days = 7
	}
	cutoff := time.Now().AddDate(0, 0, -days).Unix()
	_, err := s.db.Exec(`DELETE FROM sample WHERE ts < ?`, cutoff)
	return err
}

func (s *Store) Close() error { return s.db.Close() }

// PruneStore 暴露给 main 的保留策略入口。
func (s *Server) PruneStore(days int) error { return s.store.Prune(days) }
