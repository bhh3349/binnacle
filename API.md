# srvconsole API 契约

给前端工程师的对接文档。后端已全部实现并实测通过，本文档中的字段名与响应结构**与代码一致**。

- 基址：`http://127.0.0.1:8090`（默认绑本地，生产建议走 SSH 隧道或 ufw 白名单）
- 认证：`X-Token` 头、`?token=` 查询参数、或登录后下发的 `sc_token` Cookie（HttpOnly，30 天）
- 所有 JSON 响应 `Content-Type: application/json; charset=utf-8`，`Cache-Control: no-store`
- 错误统一为 `{ "error": "说明" }` + 4xx/5xx

---

## 0. 鉴权

### `POST /api/login`

```jsonc
// 请求
{ "token": "..." }
// 200
{ "ok": true }        // 同时 Set-Cookie: sc_token=<token>; HttpOnly; SameSite=Lax; Max-Age=2592000
// 401
{ "error": "token 不正确" }
```

### `GET /api/health`（无需鉴权）

```json
{ "ok": true, "time": 1793985470171 }
```

### `GET /api/meta`

```json
{ "root": "/", "sampleMs": 1000 }
```

---

## 1. 实时数据 `WS /ws`

连接后**立即推送一份当前值**，之后每 `sampleMs`（默认 1000）推一份完整快照。

```jsonc
{
  "t": 1793985470171,          // 毫秒时间戳
  "host": { ... },
  "gpus": [ ... ]
}
```

### 1.1 `host`

```jsonc
{
  "hostname": "bhhserver",
  "uptimeSec": 37867,
  "load": [0.24, 0.23, 0.19],          // 1/5/15 分钟
  "cpu": {
    "cores": 10,                        // 物理核（socket_id + core_id 去重）
    "threads": 20,                      // 逻辑线程
    "model": "Intel(R) Xeon(R) CPU E5-2666 v3 @ 2.90GHz",
    "usage": 0.8,                       // 总利用率 %
    "perCore": [0, 0.8, 0, ...],        // 逐线程利用率，长度 = threads
    "mhz": 3500
  },
  "mem":  { "total": 132482725888, "used": 3179274240, "available": 129303451648, "percent": 2.4 },
  "swap": { "total": 8589934592, "used": 0, "available": 8589934592, "percent": 0 },
  "disks": [
    {
      "device": "/dev/mapper/ubuntu--vg-ubuntu--lv",
      "mount": "/",
      "fstype": "ext4",
      "total": 248215199744,
      "used": 48234496000,
      "avail": 188183482368,
      "percent": 20.4,
      "readBps": 0,
      "writeBps": 52428.8
    }
  ],
  "net": [ { "iface": "enp7s0", "rxBps": 2129.4, "txBps": 283.7 } ],
  "temps": [
    { "label": "Package id 0", "celsius": 32, "critical": 93, "source": "coretemp" },
    { "label": "Core 1",       "celsius": 29, "critical": 93, "source": "coretemp" },
    { "label": "Composite",    "celsius": 25.9, "critical": 84.9, "source": "nvme" },
    { "label": "CPUTIN",       "celsius": 20.5, "source": "nct6779" }
  ],
  "fans": [ { "label": "nct6779:fan2", "rpm": 1157 } ]
}
```

**渲染注意**：

- `disks` 已排除 `tmpfs/devtmpfs/overlay/squashfs` 等伪文件系统，可直接遍历
- `net` 已排除 `lo`、`docker*`、`veth*`、`br-*`
- `temps` 已过滤悬空通道（nct6779 的 AUXTIN1/2/3 在 X99 上读 112°C，是未接热敏电阻的假值）
- `temps[].critical` 可能缺失（值为 0 时省略），此时不要画刻度线
- `fans` 只含有实际转速的通道，其余 0 RPM 通道已丢弃
- `perCore` 是**逐线程**的，20 个值；如果要按物理核展示，每两个一组取平均

### 1.2 `gpus[]`

两张卡口径不同，**必须按字段是否 `null` 决定渲不渲染该面板**。

```jsonc
{
  "index": 0,
  "name": "NVIDIA GeForce RTX 3060",
  "uuid": "GPU-80d5ba99-2b83-7f28-dbef-392f1f29e3f9",
  "vendor": "nvidia",
  "driverVer": "580.178.04",
  "vbios": "94.04.71.40.0F",
  "pciAddr": "00000000:04:00.0",

  "util": 0,                 // GPU 利用率 %
  "memUtil": 3.2,            // 显存带宽利用率 %
  "encUtil": 0,              // 编码器利用率 %，可为 null
  "decUtil": 0,              // 解码器利用率 %，可为 null

  "mem": { "total": 12884901888, "used": 412000000, "free": 12472901888, "percent": 3.2 },

  "tempGpu": 41,             // GPU 温度 °C
  "tempMem": null,           // 显存温度 °C，**3060 为 null**
  "tempLimit": 90,           // 降频温度墙 °C，可为 null

  "power": { "draw": 19.3, "limit": 170, "default": 170, "min": 100, "max": 170, "percent": 11.4 },

  "clocks": { "sm": 210, "mem": 405, "maxSm": 2100, "maxMem": 7501 },

  "fan": 0,                  // 风扇转速 %，可为 null
  "fanSupported": true,      // **false 时前端不要渲染风扇面板**

  "ecc": null,               // 3060 为 null；V100 为对象

  "pcie": { "gen": 1, "genMax": 3, "width": 8, "widthMax": 16, "txBps": 0, "rxBps": 0 },

  "throttle": ["gpu_idle"],
  "procs": [],
  "pstate": 8
}
```

V100 那张：

```jsonc
{
  "index": 1,
  "name": "Tesla V100-SXM2-16GB",
  "tempGpu": 24,
  "tempMem": 23,             // **有值**
  "fan": null,
  "fanSupported": false,     // **SXM2 被动散热，不要画风扇**
  "ecc": {
    "mode": "enabled",
    "correctedVol": 0, "uncorrectedVol": 0,
    "correctedAgg": 0, "uncorrectedAgg": 0,
    "retiredSbe": 0, "retiredDbe": 0
  },
  "pcie": { "gen": 3, "genMax": 3, "width": 16, "widthMax": 16 },
  "pstate": 0
}
```

**两个必须处理的特殊情况**：

1. **`fanSupported: false`** — V100 SXM2 通过转接板接成 PCIe，本身是被动散热（水冷头压着），NVML 返回 Not Supported。不要显示 `0%`，不要显示 `N/A` 占位，直接隐藏该面板。
2. **3060 的 PCIe 降速** — `gen: 1, width: 8` 而 `genMax: 3, widthMax: 16`。这是 **ASPM 省电**，空闲时正常现象，负载上来会自己回到 Gen4 x16。**不要报警**，只在 `gen < genMax || width < widthMax` 时标注「空闲降速」灰字即可。

`throttle` 可能的取值（来自位掩码解码）：

```
gpu_idle                 空闲（正常）
applications_clocks_setting
sw_power_cap             软件功耗墙
hw_slowdown              硬件降速
sync_boost
sw_thermal_slowdown      软件温度降频
hw_thermal_slowdown      硬件温度降频  ← 这个要红色报警
hw_power_brake_slowdown  功耗刹车      ← 这个要红色报警
display_clock_setting
```

`procs[]` 结构（有进程占显存时才有内容）：

```jsonc
{ "pid": 12345, "name": "python3", "usedMem": 4294967296, "user": "root" }
```

---

## 2. 历史数据

### `GET /api/history?from=<unix>&to=<unix>&step=<秒>`

```jsonc
{
  "from": 1793980000, "to": 1793983600, "step": 30,
  "points": [ { "t": ..., "host": {...}, "gpus": [...] } ],
  "count": 120
}
```

- 落盘间隔 30 秒，默认保留 7 天
- `points[]` 的元素结构与 WS 快照**完全一致**，可以直接复用同一套渲染
- 最多返回 5000 点，超出请缩小时间窗口或加大 `step`

---

## 3. 文件系统

所有路径都是**虚拟路径**，以 `/` 为根。后端已做穿越防护（`..`、URL 编码、绝对路径越界都会被拒）。

### `GET /api/fs/list?path=/&sort=mtime|name|size&order=asc|desc&hidden=0|1`

```jsonc
{
  "path": "/root",
  "parent": "/",
  "total": 10,
  "free": 188183482368,
  "totalSize": 248215199744,
  "entries": [
    {
      "name": "WorkSpace",
      "path": "/root/WorkSpace",
      "isDir": true,
      "size": 4096,
      "mode": "drwxr-xr-x",
      "mtime": "2026-11-06T22:44:48.969008063+08:00",
      "symlink": false
    }
  ]
}
```

- 目录永远排在文件前面，之后按 `sort` 排序
- `parent` 为空串表示已在根目录
- `symlink: true` 时附带 `linkTo` 字段（软链目标）

### `GET /api/fs/read?path=...`

```jsonc
{ "path": "/etc/hostname", "size": 10, "mtime": "...", "content": "bhhserver\n" }
```

超过 4 MB 返回 `413`，前端应引导用户下载。

### `PUT /api/fs/write?path=...`

```jsonc
// 请求
{ "content": "文件全文" }
// 200
{ "ok": true }
```

### `GET /api/fs/download?path=...`

- 文件：`Content-Disposition: attachment`，支持 `Range`（视频可直接拖进度条）
- 目录：**流式打包成 zip** 下载

### `GET /api/fs/thumb?path=...&w=256`

返回 `image/jpeg` 缩略图。支持 jpg/png/gif/webp，其它格式返回 `415`。

### 目录/文件操作

| 方法 | 路径 | 请求体 | 说明 |
|---|---|---|---|
| `POST` | `/api/fs/mkdir` | `{ "path": "/a/b" }` | 递归创建 |
| `POST` | `/api/fs/rename` | `{ "from": "...", "to": "..." }` | 改名/移动同接口 |
| `POST` | `/api/fs/delete` | `{ "paths": ["/a", "/b"] }` | 批量，返回 `{ ok, errors[] }` |
| `POST` | `/api/fs/copy` | `{ "from": "...", "to": "..." }` | 递归复制 |
| `POST` | `/api/fs/chmod` | `{ "path": "...", "mode": "0644" }` | 八进制字符串 |

### `POST /api/fs/upload?path=...`

两种模式，共用同一接口：

**整文件上传**（小文件）：

```bash
curl -X POST --data-binary @file '.../api/fs/upload?path=/a/b.txt'
```

**分块续传**（大文件）：

```bash
# 每个分块
curl -X POST --data-binary @chunk \
  -H "Content-Range: bytes 0-999999/3000000" \
  -H "X-Upload-Final: 0" \
  '.../api/fs/upload?path=/a/big.bin'
# 最后一块把 X-Upload-Final 设为 1，后端会把 .part 重命名为目标文件
```

响应：`{ "ok": true, "written": 1000000, "path": "/a/big.bin", "size": 3000000, "final": false }`

### `GET /api/fs/search?q=关键词&path=/root&limit=200`

```jsonc
{ "hits": [ { "name": "...", "path": "...", "isDir": false, "size": 123, "mode": "-rw-r--r--", "mtime": "..." } ],
  "count": 3, "truncated": false }
```

后端硬性 8 秒超时 + 最多 200 条（`limit` 可调，上限 2000）。

### `GET /api/fs/du?path=/root&depth=1`

目录占用 treemap 数据（只统计一层子项）：

```jsonc
{
  "path": "/root",
  "depth": 1,
  "nodes": [ { "name": "WorkSpace", "path": "/root/WorkSpace", "size": 1234567, "isDir": true, "count": 42 } ]
}
```

已按 `size` 降序排列，前端直接画矩形树图。**20 秒硬超时**，超大目录可能统计不全。

### `GET /api/fs/roots`

```jsonc
{ "root": "/", "shortcuts": [ { "name": "root", "path": "/root" }, ... ] }
```

---

## 4. systemd 服务

### `GET /api/services`

```jsonc
{
  "count": 7,
  "services": [
    {
      "name": "dsh-web.service",
      "description": "DSH Web",
      "active": "active",
      "sub": "running",
      "loadState": "loaded",
      "sinceUnix": 1793983584,
      "mainPid": 198619
    }
  ]
}
```

`active` 取值：`active | inactive | failed | activating | deactivating`
`sub` 取值：`running | dead | exited | failed | ...`

### `POST /api/services/{name}/{action}`

`action` ∈ `start | stop | restart | reload`

```jsonc
// 200
{ "ok": true, "output": "systemctl 输出" }
// 202（操作自身 unit）
{ "ok": true, "pending": true, "output": "已派发，控制台会重启，请稍后刷新" }
```

**只暴露白名单内的 unit**（`dsh-*`、`srvconsole*`、`jupyter*`、`docker`、`containerd`、`sshd`、`mihomo`、`cockpit*`），其余返回 `403`。

---

## 5. 日志

### `GET /api/logs/{unit}?lines=200`

```jsonc
{ "unit": "dsh-console", "count": 3, "lines": ["...", "...", "..."] }
```

### `WS /ws/logs/{unit}`

连接后先补 200 行历史，之后实时跟随。每帧：

```jsonc
{ "line": "2026-11-06T16:25:54+08:00 bhhserver systemd[1]: Started dsh-console.service - ..." }
```

行格式是 `journalctl -o short-iso`，前端可正则拆出时间戳与消息体做级别着色。

---

## 6. 终端 `WS /ws/term`

双向 WebSocket。

**前端 → 后端**：

```jsonc
{ "type": "input",  "data": "ls -la\n" }
{ "type": "resize", "cols": 120, "rows": 32 }
{ "type": "ping" }
```

也接受裸 `BinaryMessage`（直接写进 PTY）。

**后端 → 前端**：`BinaryMessage`，内容是原始 PTY 输出字节，直接喂给 xterm.js 的 `term.write()`。

连接时自动 `pty.StartWithSize(bash -l, 120x32)`，`TERM=xterm-256color`，`COLORTERM=truecolor`，工作目录 `/root`。

---

## 7. 前端工程建议

| 项 | 建议 |
|---|---|
| 图表 | `uPlot`（10 KB，高频刷新比 Recharts 快一个数量级）；要做仪表盘再用 Recharts |
| 终端 | `xterm.js` + `xterm-addon-fit` |
| 虚拟滚动 | 大目录用 `@tanstack/react-virtual` |
| 状态 | WS 数据进 Zustand，保留 900 点环形缓冲（15 分钟 @1s） |
| 曲线 | 实时曲线用内存环形缓冲，切到历史模式才打 `/api/history` |
| 主题 | 亮暗同源，全部走 CSS 变量 |

### 必须实现的三态

每个数据区块都要有：**加载（骨架屏）→ 错误（说明 + 重试）→ 空（说明 + 下一步）**。

### 双卡布局的关键约束

GPU 卡片不能按统一模板渲染。正确做法：

```
for each gpu:
  渲染通用面板：util / mem / tempGpu / power / clocks / pcie / throttle / procs
  if gpu.tempMem !== null:      渲染「显存温度」
  if gpu.fanSupported:          渲染「风扇」
  if gpu.ecc !== null:          渲染「ECC 错误」「Retired Pages」
```

这样 3060 少两个面板、V100 少一个面板，布局各自自适应，而不是留一堆 `N/A`。
