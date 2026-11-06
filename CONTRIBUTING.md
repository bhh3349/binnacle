# 贡献指南

## 开发环境

```bash
# 依赖：Go 1.26+、gcc（cgo 需要）、NVIDIA 驱动自带的 libnvidia-ml
go version

# 构建
CGO_CFLAGS="-w" go build -o srvconsole ./cmd/srvconsole

# 采集调试：打印一份完整快照
CGO_CFLAGS="-w" go run ./cmd/probe
```

`CGO_CFLAGS="-w"` 是必需的：NVML 头文件里大量 `DEPRECATED` 标注会让 cgo 刷几百行警告。

## 代码结构

| 目录 | 职责 |
|---|---|
| `collect/` | 采集层。`types.go` 里的 struct tag 就是 API 契约，改动需同步 `API.md` |
| `api/` | HTTP/WS 层。`server.go` 是路由与鉴权，其余按领域拆分 |
| `cmd/srvconsole/` | 主程序 |
| `cmd/probe/` | 采集调试工具 |

## 改动的硬性要求

1. **改 `collect/types.go` 必须同步 `API.md`** —— 前端依赖这份契约。
2. **新增字段要能表达「不支持」** —— 用指针（`*float64`）而非零值。
   不同型号的卡能力差异很大，零值会被误读成真实读数。
3. **路径处理必须走 `Server.resolve()`** —— 不要自己拼路径，穿越防护在那里。
4. **新增 systemd 操作要加白名单** —— 改 `api/services.go:unitAllowPrefix`。
5. **提交前跑 `go vet ./...`**。

## 平台差异注意事项

写采集代码时踩过的坑，改相关代码前先看 `README.md` 的「硬件侧的关键事实」一节：

- 消费卡 vs 数据中心卡的字段可用性不同
- 被动散热卡（SXM2）`fan.speed` 返回 Not Supported，不是 0
- 部分主板 hwmon 有悬空通道，读数 110°C+ 是假值
- PCIe 空闲降速是正常省电行为

## 提交信息

用 `type: 简述` 格式：`feat` / `fix` / `docs` / `refactor` / `perf` / `test` / `chore`。
