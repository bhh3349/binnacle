# binnacle-web 前端工程

React 19 + TypeScript 严格模式 + Vite + Tailwind CSS 4 + Zustand + uPlot + xterm.js。

## 开发

```bash
cd web-src
pnpm install          # 直连即可，无需代理
pnpm dev              # http://127.0.0.1:5174，/api 与 /ws 代理到 127.0.0.1:8090
```

## 构建

```bash
pnpm build            # 产物直接写入 /opt/binnacle/web，后端托管，刷新即生效
```

`vite.config.ts` 中 `outDir` 指向 `/opt/binnacle/web`。部署到其它机器时改成对应静态目录即可。

## 结构

```
web-src/
├── index.html            # 首帧前定主题，防闪白；favicon 用 public/favicon.svg
└── src/
    ├── main.tsx          # 入口
    ├── App.tsx           # 顶栏 / 页签路由 / 离线指示 / 快捷键 1-4
    ├── Login.tsx         # token 登录（也支持 ?token= 与 X-Token）
    ├── lib/
    │   ├── types.ts      # 与 collect/types.go 一一对应的 TS 类型
    │   ├── api.ts        # fetch 封装 + WS 地址拼接 + 401 统一处理
    │   └── format.ts     # 字节/百分比/时间格式化、路径工具
    ├── store/
    │   ├── telemetry.ts  # WS 接入：900 点环形缓冲、断线保留数据 + 自动重连
    │   └── theme.ts      # 亮暗主题（CSS 变量同源）
    ├── components/
    │   ├── ui.tsx        # 按钮/卡片/三态（骨架、错误+重试、空+下一步）/徽标/进度条
    │   ├── Chart.tsx     # uPlot 封装，跟随主题重建
    │   └── GPUCard.tsx   # 按能力渲染的 GPU 卡片
    └── tabs/
        ├── Overview.tsx  # 概览：热力图/磁盘/温度/风扇/曲线/GPU
        ├── Files.tsx     # 文件：虚拟滚动/编辑/上传/搜索/treemap
        ├── Services.tsx  # systemd unit + 日志抽屉（WS 实时跟随）
        └── Terminal.tsx  # xterm.js ↔ /ws/term
```

## 设计约定（改代码前先读）

1. **GPU 卡片按字段判空渲染**：`tempMem !== null` 才渲染显存温度；`fanSupported` 才渲染风扇；`ecc !== null` 才渲染 ECC。不显示 N/A、不显示假 0，直接不渲染面板。
2. **3060 PCIe 降速是 ASPM 省电**：`gen < genMax || width < widthMax` 时只标灰字「空闲降速」，绝不报警。只有 `hw_thermal_slowdown` / `hw_power_brake_slowdown` 才标红。
3. **三态齐全**：每个数据区块必须有加载骨架、错误+重试、空态+下一步。
4. **WS 断开不清空界面**：telemetry store 断线时保留 points/latest，顶栏显示「离线 · 最后更新 X 秒前」，指数退避重连（0.5s→8s）。
5. **页签常驻挂载**：切页签只 `hidden`，保住文件目录位置、编辑器草稿、终端会话。
6. **主题**：全部走 CSS 变量（`--sc-*`），亮暗同源，uPlot/xterm 切主题时重建。
