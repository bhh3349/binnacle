package main

import (
	"encoding/json"
	"fmt"
	"time"

	"srvconsole/collect"
)

func main() {
	hc := collect.NewHostCollector()
	gc := collect.NewGPUCollector()

	hc.Collect() // 预热差分
	time.Sleep(1200 * time.Millisecond)

	start := time.Now()
	snap := collect.Snapshot{T: time.Now().UnixMilli()}
	snap.Host = hc.Collect()
	snap.GPUs = gc.Collect()
	el := time.Since(start)

	b, _ := json.MarshalIndent(snap, "", "  ")
	fmt.Println(string(b))
	fmt.Printf("\n=== 采样耗时: %v\n", el)
}
