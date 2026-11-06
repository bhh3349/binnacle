import { useMemo, useState } from 'react';
import { useTelemetry } from '../store/telemetry';
import { TimeChart } from '../components/Chart';
import { GPUCard } from '../components/GPUCard';
import {
  Badge,
  Button,
  Card,
  Collapsible,
  EmptyState,
  ErrorState,
  Grid12,
  KV,
  Meter,
  SectionHead,
  Skeleton,
  Stat,
} from '../components/ui';
import {
  cx,
  fmtAgo,
  fmtBytes,
  fmtBytesAxis,
  fmtNum,
  fmtPct,
  fmtPctAxis,
  fmtUptime,
  loadLevel,
} from '../lib/format';
import type { HostStats, Snapshot, TempStat } from '../lib/types';
import { RefreshCw } from 'lucide-react';

/* ══════════════════════════════════════════════════════════════════════════
   概览
   12 列网格。跨列体现主次：
   · CPU 曲线 8 列 / 网络 4 列
   · 磁盘 7 列 / 温度 5 列
   · 系统信息 4 / 内存 4 / 负载 4
   · GPU 每张 6 列
   ══════════════════════════════════════════════════════════════════════════ */

/* ── 线程热力图 ───────────────────────────────────────────────────────── */

/** 5 档灰→accent 色阶，不用多彩 */
const HEAT = [
  'bg-[var(--paper-3)]',
  'bg-[color-mix(in_oklab,var(--accent)_22%,var(--paper-2))]',
  'bg-[color-mix(in_oklab,var(--accent)_45%,var(--paper-2))]',
  'bg-[color-mix(in_oklab,var(--accent)_72%,var(--paper-2))]',
  'bg-[var(--accent)]',
];

function CoreHeatmap({ perCore, cores }: { perCore: number[]; cores: number }) {
  const threads = perCore.length;
  const avg = threads > 0 ? perCore.reduce((a, b) => a + b, 0) / threads : 0;
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="kicker">
          逐线程 · {threads} 线程 / {cores} 核
        </span>
        <span className="num text-[10.5px] text-[var(--text-helper)]">
          均值 {fmtPct(avg, 1)}
        </span>
      </div>
      <div className="flex gap-[3px]">
        {perCore.map((v, i) => {
          const lv = loadLevel(v);
          return (
            <div key={i} className="group min-w-0 flex-1" title={`线程 ${i} · ${fmtPct(v, 1)}`}>
              <div className={cx('h-9 w-full transition-colors duration-300', HEAT[lv])} />
              <div className="num mt-1 text-center text-[9px] leading-none text-[var(--text-placeholder)]">
                {i}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        <span className="kicker">0%</span>
        {HEAT.map((c, i) => (
          <span key={i} className={cx('h-[6px] w-6', c)} />
        ))}
        <span className="kicker">100%</span>
      </div>
    </div>
  );
}

/* ── 磁盘：统一 2px 进度条，数字等宽右对齐 ─────────────────────────────── */

function DiskList({ disks }: { disks: HostStats['disks'] }) {
  return (
    <div>
      {/* 表头 */}
      <div className="mb-1 grid grid-cols-[minmax(0,1fr)_76px_96px] items-baseline gap-4">
        <span className="kicker">挂载点</span>
        <span className="kicker text-right">已用 / 总量</span>
        <span className="kicker text-right">使用率</span>
      </div>
      <div className="divide-y divide-[var(--line-subtle)]">
        {disks.map((d) => {
          const tone = d.percent > 90 ? 'danger' : d.percent > 75 ? 'warn' : 'accent';
          return (
            <div key={`${d.mount}-${d.device}`} className="py-2">
              <div className="grid grid-cols-[minmax(0,1fr)_76px_96px] items-baseline gap-4">
                <div className="min-w-0">
                  <div className="num truncate text-[12.5px] font-medium text-[var(--ink)]">
                    {d.mount}
                  </div>
                  <div className="num truncate text-[10px] leading-tight text-[var(--text-placeholder)]">
                    {d.device} · {d.fstype}
                  </div>
                </div>
                <div className="num text-right text-[11.5px] leading-tight text-[var(--text-secondary)]">
                  {fmtBytes(d.used)}
                  <div className="text-[10px] text-[var(--text-placeholder)]">
                    {fmtBytes(d.total)}
                  </div>
                </div>
                <div className="num text-right text-[12px] leading-tight text-[var(--ink)]">
                  {fmtPct(d.percent, 1)}
                  <div className="text-[10px] text-[var(--text-placeholder)]">
                    {d.readBps > 0 || d.writeBps > 0
                      ? `${fmtBytesAxis(d.writeBps)}/s`
                      : '—'}
                  </div>
                </div>
              </div>
              <Meter percent={d.percent} height={2} tone={tone} className="mt-2 mb-1" />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── 温度：按传感器类型分组折叠 ───────────────────────────────────────── */

type TempGroup = { key: string; label: string; items: TempStat[] };

const SOURCE_LABEL: Record<string, string> = {
  coretemp: 'CPU 核心',
  nvme: 'NVMe 固态',
  nct6779: '主板 SuperIO',
  k10temp: 'CPU (k10temp)',
  acpitz: 'ACPI 热区',
};

function groupTemps(temps: TempStat[]): TempGroup[] {
  const map = new Map<string, TempStat[]>();
  for (const t of temps) {
    const k = t.source || 'other';
    const arr = map.get(k);
    if (arr) arr.push(t);
    else map.set(k, [t]);
  }
  return Array.from(map.entries())
    .map(([key, items]) => ({
      key,
      label: SOURCE_LABEL[key] ?? key,
      items: [...items].sort((a, b) => b.celsius - a.celsius),
    }))
    .sort((a, b) => Math.max(...b.items.map((i) => i.celsius)) - Math.max(...a.items.map((i) => i.celsius)));
}

function TempRow({ t }: { t: TempStat }) {
  const hasCrit = typeof t.critical === 'number' && t.critical > 0;
  const crit = t.critical ?? 0;
  const ratio = hasCrit ? (t.celsius / crit) * 100 : (t.celsius / 100) * 100;
  const hot = hasCrit ? t.celsius > crit * 0.9 : t.celsius > 80;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_42px] items-center gap-3 py-[3px]">
      <span className="truncate text-[11.5px] text-[var(--text-secondary)]">{t.label}</span>
      <div className="h-[2px] w-16 bg-[var(--paper-3)]">
        <div
          className={cx('h-full', hot ? 'bg-[var(--alert)]' : 'bg-[var(--accent)]')}
          style={{ width: `${Math.min(100, Math.max(0, ratio))}%` }}
        />
      </div>
      <span
        className={cx(
          'num text-right text-[11.5px]',
          hot ? 'text-[var(--alert)]' : 'text-[var(--ink)]',
        )}
      >
        {fmtNum(t.celsius, 1)}°
      </span>
    </div>
  );
}

function TempGroups({ temps }: { temps: TempStat[] }) {
  const groups = useMemo(() => groupTemps(temps), [temps]);
  // 默认展开最热的组，其余折叠 —— 17 行不再平铺
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const isOpen = (key: string, idx: number) => open[key] ?? idx === 0;

  return (
    <div className="divide-y divide-[var(--line-subtle)]">
      {groups.map((g, idx) => {
        const hottest = g.items[0];
        const max = hottest?.celsius ?? 0;
        return (
          <Collapsible
            key={g.key}
            title={g.label}
            open={isOpen(g.key, idx)}
            onToggle={() => setOpen((o) => ({ ...o, [g.key]: !isOpen(g.key, idx) }))}
            meta={
              <>
                <span className="num text-[10px] text-[var(--text-placeholder)]">
                  {g.items.length} 项
                </span>
                <span className="num text-[11.5px] font-medium text-[var(--ink)]">
                  {fmtNum(max, 1)}°
                </span>
              </>
            }
          >
            <div className="pl-5">
              {g.items.map((t, i) => (
                <TempRow key={`${t.label}-${i}`} t={t} />
              ))}
            </div>
          </Collapsible>
        );
      })}
    </div>
  );
}

/* ── 历史模式控制 ─────────────────────────────────────────────────────── */

const RANGES = [
  { sec: 1800, label: '30 分', step: 30 },
  { sec: 3600, label: '1 时', step: 30 },
  { sec: 21600, label: '6 时', step: 60 },
  { sec: 86400, label: '24 时', step: 300 },
] as const;

function HistoryControls() {
  const historyMode = useTelemetry((s) => s.historyMode);
  const loading = useTelemetry((s) => s.historyLoading);
  const setHistoryMode = useTelemetry((s) => s.setHistoryMode);
  const [range, setRange] = useState<number>(3600);

  const apply = (sec: number, step: number) => {
    setRange(sec);
    const now = Math.floor(Date.now() / 1000);
    void setHistoryMode(true, now - sec, now, step);
  };

  return (
    <div className="flex items-center gap-1">
      {historyMode &&
        RANGES.map((r) => (
          <Button
            key={r.sec}
            size="xs"
            variant={range === r.sec ? 'solid' : 'quiet'}
            onClick={() => apply(r.sec, r.step)}
          >
            {r.label}
          </Button>
        ))}
      <Button
        size="xs"
        variant={historyMode ? 'accent' : 'outline'}
        disabled={loading}
        onClick={() => {
          if (historyMode) void setHistoryMode(false);
          else apply(3600, 30);
        }}
      >
        {loading ? '载入' : historyMode ? '实时' : '历史'}
      </Button>
    </div>
  );
}

/* ── 数据抽取 ─────────────────────────────────────────────────────────── */

function useSeries(points: Snapshot[]) {
  return useMemo(() => {
    const times = points.map((p) => Math.floor(p.t / 1000));
    return {
      times,
      cpu: points.map((p) => p.host.cpu.usage),
      mem: points.map((p) => p.host.mem.percent),
      rx: points.map((p) => p.host.net.reduce((s, n) => s + n.rxBps, 0)),
      tx: points.map((p) => p.host.net.reduce((s, n) => s + n.txBps, 0)),
      load1: points.map((p) => p.host.load[0] ?? 0),
    };
  }, [points]);
}

/* ── 加载骨架 ─────────────────────────────────────────────────────────── */

function OverviewSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true">
      <Grid12>
        {Array.from({ length: 4 }, (_, i) => (
          <Card key={i} className="lg:col-span-3">
            <Skeleton className="h-2.5 w-16" />
            <Skeleton className="mt-2.5 h-6 w-20" />
            <Skeleton className="mt-3 h-[2px] w-full" />
          </Card>
        ))}
      </Grid12>
      <Card>
        <Skeleton className="h-2.5 w-28" />
        <div className="mt-3 flex gap-[3px]">
          {Array.from({ length: 20 }, (_, i) => (
            <Skeleton key={i} className="h-9 flex-1" />
          ))}
        </div>
      </Card>
      <Grid12>
        <Card className="lg:col-span-8">
          <Skeleton className="h-2.5 w-24" />
          <Skeleton className="mt-3 h-[150px] w-full" />
        </Card>
        <Card className="lg:col-span-4">
          <Skeleton className="h-2.5 w-20" />
          <Skeleton className="mt-3 h-[150px] w-full" />
        </Card>
      </Grid12>
    </div>
  );
}

/* ── 主视图 ───────────────────────────────────────────────────────────── */

export function OverviewTab({ active = true }: { active?: boolean }) {
  const latest = useTelemetry((s) => s.latest);
  const points = useTelemetry((s) => s.points);
  const conn = useTelemetry((s) => s.conn);
  const lastDataAt = useTelemetry((s) => s.lastDataAt);
  const historyMode = useTelemetry((s) => s.historyMode);
  const history = useTelemetry((s) => s.history);
  const historyLoading = useTelemetry((s) => s.historyLoading);
  const historyError = useTelemetry((s) => s.historyError);
  const setHistoryMode = useTelemetry((s) => s.setHistoryMode);

  const source: Snapshot[] = useMemo(() => {
    if (historyMode && history) return history.points;
    return points;
  }, [historyMode, history, points]);

  const s = useSeries(source);
  const host = latest?.host;

  if (!latest) {
    if (conn === 'offline') {
      return (
        <ErrorState
          message="无法连接到实时通道"
          detail={`WebSocket /ws 未建立。请确认 binnacle 后端在运行。${lastDataAt ? `上次数据：${fmtAgo(Date.now() - lastDataAt)}` : ''}`}
          onRetry={() => useTelemetry.getState().connect()}
        />
      );
    }
    return <OverviewSkeleton />;
  }

  if (!host) {
    return (
      <EmptyState
        title="主机数据暂不可用"
        hint="后端返回了快照但缺少 host 字段。等待下一次采样。"
        action={
          <Button size="xs" variant="outline" onClick={() => useTelemetry.getState().connect()}>
            重新连接
          </Button>
        }
      />
    );
  }

  const offline = conn === 'offline';
  const mem = host.mem;
  const swap = host.swap;
  const load1 = host.load[0] ?? 0;
  const load5 = host.load[1] ?? 0;
  const load15 = host.load[2] ?? 0;
  const rxTotal = host.net.reduce((a, n) => a + n.rxBps, 0);
  const txTotal = host.net.reduce((a, n) => a + n.txBps, 0);

  return (
    <div className="space-y-5">
      {offline && (
        <div className="flex items-center justify-between gap-3 bg-[var(--paper-3)] px-4 py-2 text-[12px] text-[var(--warn)]">
          <span>
            离线 · 最后更新 {lastDataAt ? fmtAgo(Date.now() - lastDataAt) : '未知'}
            <span className="ml-2 text-[var(--text-helper)]">以下为最后一次数据，正在自动重连</span>
          </span>
          <Button size="xs" variant="outline" onClick={() => useTelemetry.getState().connect()}>
            <RefreshCw size={10} />
            重连
          </Button>
        </div>
      )}

      {historyMode && historyError && (
        <ErrorState
          compact
          message="历史数据加载失败"
          detail={historyError}
          onRetry={() => {
            const now = Math.floor(Date.now() / 1000);
            void setHistoryMode(true, now - 3600, now, 30);
          }}
        />
      )}

      {/* ── 四个主指标：各占 3 列，等高 ─────────────────────────────── */}
      <Grid12>
        <Card className="lg:col-span-3">
          <Stat
            label="CPU 利用率"
            value={fmtNum(host.cpu.usage, 1)}
            unit="%"
            sub={`${fmtNum(host.cpu.mhz, 0)} MHz · ${host.cpu.threads} 线程`}
            tone={host.cpu.usage > 90 ? 'danger' : host.cpu.usage > 70 ? 'warn' : undefined}
          />
          <Meter percent={host.cpu.usage} height={2} className="mt-auto pt-0" />
        </Card>
        <Card className="lg:col-span-3">
          <Stat
            label="内存"
            value={fmtBytes(mem.used)}
            sub={`共 ${fmtBytes(mem.total)} · ${fmtPct(mem.percent, 1)}`}
            tone={mem.percent > 90 ? 'danger' : mem.percent > 75 ? 'warn' : undefined}
          />
          <Meter
            percent={mem.percent}
            height={2}
            tone={mem.percent > 90 ? 'danger' : 'accent'}
            className="mt-auto pt-0"
          />
        </Card>
        <Card className="lg:col-span-3">
          <Stat
            label="系统负载"
            value={load1.toFixed(2)}
            sub={`5 分 ${load5.toFixed(2)} · 15 分 ${load15.toFixed(2)}`}
            tone={load1 > host.cpu.threads ? 'warn' : undefined}
          />
          <div className="num mt-auto truncate pt-1 text-[10.5px] text-[var(--text-placeholder)]">
            {host.hostname} · 运行 {fmtUptime(host.uptimeSec)}
          </div>
        </Card>
        <Card className="lg:col-span-3">
          <Stat
            label="网络吞吐"
            value={fmtBytes(rxTotal + txTotal)}
            unit="/s"
            sub={host.net.length === 0 ? '无活动网卡' : host.net.map((n) => n.iface).join(' · ')}
          />
          <div className="num mt-auto flex items-center gap-3 pt-1 text-[10.5px]">
            <span className="text-[var(--text-secondary)]">↓ {fmtBytes(rxTotal)}/s</span>
            <span className="text-[var(--text-placeholder)]">↑ {fmtBytes(txTotal)}/s</span>
          </div>
        </Card>
      </Grid12>

      {/* ── CPU 热力图：整幅 ──────────────────────────────────────── */}
      <Card>
        <SectionHead
          title="CPU"
          hint={host.cpu.model}
          right={<Badge>{host.cpu.cores} 核 / {host.cpu.threads} 线程</Badge>}
        />
        {host.cpu.perCore.length === 0 ? (
          <EmptyState compact title="未采集到逐线程数据" hint="perCore 为空。" />
        ) : (
          <CoreHeatmap perCore={host.cpu.perCore} cores={host.cpu.cores} />
        )}
      </Card>

      {/* ── 曲线：CPU 8 列 / 网络 4 列 ────────────────────────────── */}
      <Grid12>
        <Card className="lg:col-span-8">
          <SectionHead
            title="CPU / 内存"
            hint={historyMode ? `历史 · ${history?.count ?? 0} 点` : `实时 · ${source.length} 点`}
            right={<HistoryControls />}
          />
          {source.length === 0 ? (
            <EmptyState compact title="还没有数据点" hint="WS 每秒推送一次，稍等几秒。" />
          ) : historyLoading ? (
            <Skeleton className="h-[160px] w-full" />
          ) : (
            <TimeChart
              active={active}
              times={s.times}
              series={[s.cpu, s.mem]}
              defs={[
                { label: 'CPU %', color: '--accent', fill: true },
                { label: '内存 %', color: '--text-helper', dash: [3, 3] },
              ]}
              height={160}
              yMax={100}
              formatY={fmtPctAxis}
            />
          )}
        </Card>

        <Card className="lg:col-span-4">
          <SectionHead title="网络吞吐" hint="全部网卡合计" />
          {source.length === 0 ? (
            <EmptyState compact title="还没有数据点" hint="等待 WS 推送。" />
          ) : (
            <TimeChart
              active={active}
              times={s.times}
              series={[s.rx, s.tx]}
              defs={[
                { label: '下行', color: '--accent', fill: true },
                { label: '上行', color: '--text-helper', dash: [3, 3] },
              ]}
              height={160}
              formatY={fmtBytesAxis}
            />
          )}
        </Card>
      </Grid12>

      {/* ── 磁盘 7 列 / 温度+风扇 5 列 ───────────────────────────── */}
      <Grid12>
        <Card className="lg:col-span-7">
          <SectionHead
            title="磁盘"
            hint={`${host.disks.length} 个挂载点`}
            right={
              <span className="num text-[10.5px] text-[var(--text-helper)]">
                可用 {fmtBytes(host.disks.reduce((a, d) => a + d.avail, 0))}
              </span>
            }
          />
          {host.disks.length === 0 ? (
            <EmptyState compact title="没有可展示的挂载点" hint="已排除 tmpfs / overlay 等。" />
          ) : (
            <DiskList disks={host.disks} />
          )}
        </Card>

        <div className="flex flex-col gap-5 lg:col-span-5">
          <Card>
            <SectionHead
              title="温度"
              hint={`${host.temps.length} 个传感器`}
              right={<span className="kicker">按类型分组</span>}
            />
            {host.temps.length === 0 ? (
              <EmptyState compact title="没有温度传感器" hint="本机未暴露 hwmon 温度通道。" />
            ) : (
              <TempGroups temps={host.temps} />
            )}
          </Card>

          <Card>
            <SectionHead title="风扇" hint={`${host.fans.length} 通道`} />
            {host.fans.length === 0 ? (
              <EmptyState compact title="没有风扇通道" hint="0 RPM 通道已被过滤。" />
            ) : (
              <div className="divide-y divide-[var(--line-subtle)]">
                {host.fans.map((f) => (
                  <div key={f.label} className="flex items-baseline justify-between gap-3 py-1.5">
                    <span className="num truncate text-[11.5px] text-[var(--text-secondary)]">
                      {f.label}
                    </span>
                    <span className="num shrink-0 text-[13px] font-medium text-[var(--ink)]">
                      {fmtNum(f.rpm)}
                      <span className="ml-1 text-[10px] font-normal text-[var(--text-helper)]">
                        RPM
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </Grid12>

      {/* ── 系统 / 内存 / 负载：各 4 列 ───────────────────────────── */}
      <Grid12>
        <Card className="lg:col-span-4">
          <SectionHead title="系统" />
          <KV k="主机名" v={host.hostname} />
          <KV k="运行时长" v={fmtUptime(host.uptimeSec)} />
          <KV k="物理核 / 线程" v={`${host.cpu.cores} / ${host.cpu.threads}`} />
          <KV k="当前频率" v={`${fmtNum(host.cpu.mhz, 0)} MHz`} />
          <KV k="CPU 型号" v={host.cpu.model} muted />
        </Card>

        <Card className="lg:col-span-4">
          <SectionHead title="内存与交换" />
          <KV k="已用" v={`${fmtBytes(mem.used)} / ${fmtBytes(mem.total)}`} />
          <KV k="可用" v={fmtBytes(mem.available)} />
          <KV k="占比" v={fmtPct(mem.percent, 1)} />
          <div className="my-2 h-px bg-[var(--line-subtle)]" />
          <KV k="Swap" v={`${fmtBytes(swap.used)} / ${fmtBytes(swap.total)}`} />
          {swap.total > 0 ? (
            <Meter percent={swap.percent} height={2} tone="warn" className="mt-1.5" />
          ) : (
            <div className="mt-1 text-[11px] text-[var(--text-helper)]">未启用 swap</div>
          )}
        </Card>

        <Card className="lg:col-span-4">
          <SectionHead title="负载趋势" hint="1 分钟" />
          <div className="mb-2 flex items-baseline gap-4">
            {[
              ['1 分', load1],
              ['5 分', load5],
              ['15 分', load15],
            ].map(([l, v]) => (
              <div key={String(l)}>
                <div className="kicker">{l}</div>
                <div className="num text-[15px] leading-tight text-[var(--ink)]">
                  {Number(v).toFixed(2)}
                </div>
              </div>
            ))}
          </div>
          {source.length > 0 && (
            <TimeChart
              active={active}
              times={s.times}
              series={[s.load1]}
              defs={[{ label: 'load1', color: '--accent', fill: true }]}
              height={72}
              formatY={(v) => v.toFixed(2)}
            />
          )}
        </Card>
      </Grid12>

      {/* ── GPU ─────────────────────────────────────────────────── */}
      <div>
        <SectionHead
          title="GPU"
          hint={`${latest.gpus.length} 张卡 · 按能力渲染`}
          right={
            <span className="kicker">不支持的字段不渲染，不显示 N/A</span>
          }
        />
        {latest.gpus.length === 0 ? (
          <EmptyState
            title="未检测到 GPU"
            hint="NVML 未返回设备。检查 NVIDIA 驱动与 nvidia-smi。"
          />
        ) : (
          <Grid12>
            {latest.gpus.map((g) => (
              <GPUCard
                key={g.uuid || g.index}
                gpu={g}
                className={latest.gpus.length >= 2 ? 'lg:col-span-6' : 'lg:col-span-12'}
              />
            ))}
          </Grid12>
        )}
      </div>
    </div>
  );
}
