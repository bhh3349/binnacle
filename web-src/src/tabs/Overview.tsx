import { useMemo, useState } from 'react';
import { useTelemetry } from '../store/telemetry';
import { TimeChart } from '../components/Chart';
import { GPUCard, gpuGridClass } from '../components/GPUCard';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  KV,
  Meter,
  SectionHead,
  Skeleton,
  Stat,
} from '../components/ui';
import { cx, fmtAgo, fmtBps, fmtBytes, fmtNum, fmtPct, fmtUptime, loadLevel } from '../lib/format';
import type { HostStats, Snapshot } from '../lib/types';
import { Activity, HardDrive, Network, Thermometer, Fan, Server, Clock } from 'lucide-react';

/* ---------------- 20 线程热力图 ---------------- */

const LEVEL_BG = [
  'bg-surface-2',
  'bg-accent/25',
  'bg-accent/45',
  'bg-accent/70',
  'bg-accent',
];

function CoreHeatmap({ perCore, cores }: { perCore: number[]; cores: number }) {
  const threads = perCore.length;
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-fg-subtle text-[10.5px] tracking-[0.04em] uppercase">
          逐线程利用率 · {threads} 线程
        </span>
        <span className="text-fg-subtle text-[10.5px]">
          {cores} 物理核 / {threads} 逻辑线程
        </span>
      </div>
      <div className="flex flex-wrap gap-1">
        {perCore.map((v, i) => {
          const lv = loadLevel(v);
          return (
            <div
              key={i}
              className="group relative flex-1 basis-[calc(5%-4px)]"
              title={`线程 ${i}: ${fmtPct(v, 1)}`}
            >
              <div
                className={cx(
                  'h-8 rounded-[3px] transition-colors duration-300',
                  LEVEL_BG[lv],
                  lv === 0 && 'border-line border',
                )}
              />
              <div
                className={cx(
                  'mt-1 text-center text-[9px] leading-none',
                  lv >= 3 ? 'text-fg' : 'text-fg-subtle',
                )}
              >
                {i}
              </div>
            </div>
          );
        })}
      </div>
      <div className="text-fg-subtle mt-2 flex items-center gap-1 text-[9.5px]">
        低
        {LEVEL_BG.map((c, i) => (
          <span key={i} className={cx('h-2 w-4 rounded-sm', c, i === 0 && 'border-line border')} />
        ))}
        高
      </div>
    </div>
  );
}

/* ---------------- 磁盘 ---------------- */

function DiskList({ disks }: { disks: HostStats['disks'] }) {
  return (
    <div className="space-y-2.5">
      {disks.map((d) => {
        const tone = d.percent > 90 ? 'danger' : d.percent > 75 ? 'warn' : 'accent';
        return (
          <div key={`${d.mount}-${d.device}`}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="num text-fg truncate text-[11.5px]">{d.mount}</span>
              <span className="num text-fg-subtle shrink-0 text-[10.5px]">
                {fmtBytes(d.used)} / {fmtBytes(d.total)} · {fmtPct(d.percent, 1)}
              </span>
            </div>
            <Meter percent={d.percent} height={3} tone={tone} className="mt-1" />
            <div className="text-fg-subtle num mt-0.5 flex items-center justify-between text-[9.5px]">
              <span className="truncate">
                {d.device} · {d.fstype}
              </span>
              <span className="shrink-0">
                {d.readBps > 0 || d.writeBps > 0
                  ? `读 ${fmtBps(d.readBps)} 写 ${fmtBps(d.writeBps)}`
                  : '空闲'}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- 温度 ---------------- */

function TempList({ temps }: { temps: HostStats['temps'] }) {
  const sorted = useMemo(() => [...temps].sort((a, b) => b.celsius - a.celsius), [temps]);
  return (
    <div className="space-y-1.5">
      {sorted.map((t, i) => {
        // critical 缺失（0）时不画刻度线
        const hasCrit = typeof t.critical === 'number' && t.critical > 0;
        const ratio = hasCrit ? (t.celsius / t.critical!) * 100 : (t.celsius / 100) * 100;
        const hot = hasCrit ? t.celsius > t.critical! * 0.9 : t.celsius > 80;
        return (
          <div key={`${t.source}-${t.label}-${i}`}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-fg-muted truncate text-[11px]">{t.label}</span>
              <span className={cx('num shrink-0 text-[11px]', hot ? 'text-danger' : 'text-fg')}>
                {fmtNum(t.celsius, 1)} °C
                {hasCrit && <span className="text-fg-subtle"> / {fmtNum(t.critical!, 0)}</span>}
              </span>
            </div>
            <div className="bg-surface-2 relative mt-0.5 h-[3px] w-full overflow-hidden rounded-full">
              <div
                className={cx('h-full rounded-full', hot ? 'bg-danger' : 'bg-accent/70')}
                style={{ width: `${Math.min(100, Math.max(0, ratio))}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- 图表数据 ---------------- */

function useSeries(points: Snapshot[]) {
  return useMemo(() => {
    const times = points.map((p) => Math.floor(p.t / 1000));
    const cpu = points.map((p) => p.host.cpu.usage);
    const mem = points.map((p) => p.host.mem.percent);
    const rx = points.map((p) => p.host.net.reduce((s, n) => s + n.rxBps, 0));
    const tx = points.map((p) => p.host.net.reduce((s, n) => s + n.txBps, 0));
    const load1 = points.map((p) => p.host.load[0] ?? 0);
    return { times, cpu, mem, rx, tx, load1 };
  }, [points]);
}

/* ---------------- 历史模式 ---------------- */

function HistoryControls() {
  const historyMode = useTelemetry((s) => s.historyMode);
  const setHistoryMode = useTelemetry((s) => s.setHistoryMode);
  const loading = useTelemetry((s) => s.historyLoading);
  const [range, setRange] = useState(3600);

  return (
    <div className="flex items-center gap-1">
      {historyMode &&
        [1800, 3600, 21600, 86400].map((r) => (
          <Button
            key={r}
            size="xs"
            variant={range === r ? 'default' : 'ghost'}
            onClick={() => {
              setRange(r);
              const now = Math.floor(Date.now() / 1000);
              void setHistoryMode(true, now - r, now, r > 3600 ? 60 : 30);
            }}
          >
            {r < 3600 ? `${r / 60}分` : r < 86400 ? `${r / 3600}小时` : '24小时'}
          </Button>
        ))}
      <Button
        size="xs"
        variant={historyMode ? 'primary' : 'default'}
        disabled={loading}
        onClick={() => {
          if (historyMode) {
            void setHistoryMode(false);
          } else {
            const now = Math.floor(Date.now() / 1000);
            void setHistoryMode(true, now - range, now, range > 3600 ? 60 : 30);
          }
        }}
      >
        {loading ? '加载中…' : historyMode ? '回到实时' : '历史'}
      </Button>
    </div>
  );
}

/* ---------------- 主视图 ---------------- */

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

  void active;
  const source: Snapshot[] = useMemo(() => {
    if (historyMode && history) return history.points;
    return points;
  }, [historyMode, history, points]);

  const s = useSeries(source);
  const host = latest?.host;

  /* --- 加载态：还没收到任何数据 --- */
  if (!latest) {
    if (conn === 'offline') {
      return (
        <ErrorState
          message="无法连接到后端实时通道"
          detail={`WebSocket /ws 未建立。请确认 binnacle 后端在 127.0.0.1:8090 运行。${lastDataAt ? `上次数据：${fmtAgo(Date.now() - lastDataAt)}` : ''}`}
          onRetry={() => {
            useTelemetry.getState().connect();
          }}
        />
      );
    }
    return (
      <div className="space-y-3" aria-busy="true">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Card key={i}>
              <Skeleton className="h-3 w-16" />
              <Skeleton className="mt-2 h-6 w-24" />
              <Skeleton className="mt-2 h-1 w-full" />
            </Card>
          ))}
        </div>
        <Card>
          <Skeleton className="h-4 w-32" />
          <div className="mt-3 flex gap-1">
            {Array.from({ length: 20 }, (_, i) => (
              <Skeleton key={i} className="h-8 flex-1" />
            ))}
          </div>
        </Card>
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          <Card>
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-3 h-[140px] w-full" />
          </Card>
          <Card>
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-3 h-[140px] w-full" />
          </Card>
        </div>
      </div>
    );
  }

  if (!host) {
    return (
      <EmptyState
        title="主机数据暂不可用"
        hint="后端返回了快照但缺少 host 字段。等待下一次采样，或检查 collector 是否正常。"
        action={
          <Button size="xs" onClick={() => useTelemetry.getState().connect()}>
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

  return (
    <div className={cx('space-y-3', offline && 'opacity-95')}>
      {/* 离线横幅 */}
      {offline && (
        <div className="border-warn/30 bg-warn/5 text-warn flex items-center justify-between rounded-lg border px-3 py-2 text-[11.5px]">
          <span>
            离线 · 最后更新 {lastDataAt ? fmtAgo(Date.now() - lastDataAt) : '未知'} —— 以下为最后一次数据，正在自动重连
          </span>
          <Button size="xs" variant="ghost" onClick={() => useTelemetry.getState().connect()}>
            立即重连
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

      {/* 顶部 4 个概览数字 */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card>
          <Stat
            label="CPU 利用率"
            value={fmtNum(host.cpu.usage, 1)}
            unit="%"
            sub={`${fmtNum(host.cpu.mhz, 0)} MHz · ${host.cpu.threads} 线程`}
            tone={host.cpu.usage > 90 ? 'danger' : host.cpu.usage > 70 ? 'warn' : undefined}
          />
          <Meter percent={host.cpu.usage} height={3} className="mt-2" />
        </Card>
        <Card>
          <Stat
            label="内存"
            value={fmtBytes(mem.used, 1)}
            sub={`共 ${fmtBytes(mem.total)} · ${fmtPct(mem.percent, 1)}`}
            tone={mem.percent > 90 ? 'danger' : mem.percent > 75 ? 'warn' : undefined}
          />
          <Meter percent={mem.percent} height={3} className="mt-2" />
        </Card>
        <Card>
          <Stat
            label="负载 (1/5/15)"
            value={`${load1.toFixed(2)}`}
            sub={`${load5.toFixed(2)} / ${load15.toFixed(2)} · 运行 ${fmtUptime(host.uptimeSec)}`}
            tone={load1 > host.cpu.threads ? 'warn' : undefined}
          />
          <div className="text-fg-subtle mt-2 flex items-center gap-1 text-[10px]">
            <Clock size={9} />
            <span className="num truncate">{host.hostname}</span>
          </div>
        </Card>
        <Card>
          <Stat
            label="网络"
            value={fmtBytes((host.net[0]?.rxBps ?? 0) + (host.net[0]?.txBps ?? 0))}
            unit="/s"
            sub={
              host.net.length === 0
                ? '无活动网卡'
                : host.net.map((n) => n.iface).join(', ')
            }
          />
          <div className="text-fg-subtle num mt-2 flex items-center gap-2 text-[10px]">
            <span>↓ {fmtBps(host.net.reduce((a, n) => a + n.rxBps, 0))}</span>
            <span>↑ {fmtBps(host.net.reduce((a, n) => a + n.txBps, 0))}</span>
          </div>
        </Card>
      </div>

      {/* CPU 热力图 + 型号 */}
      <Card>
        <SectionHead
          title={
            <span className="flex items-center gap-1.5">
              <Activity size={12} className="text-fg-subtle" />
              CPU
            </span>
          }
          hint={host.cpu.model}
          right={<Badge tone="neutral">{host.cpu.threads} 线程</Badge>}
        />
        {host.cpu.perCore.length === 0 ? (
          <EmptyState compact title="未采集到逐线程数据" hint="perCore 为空，可能 /proc/stat 读取受限。" />
        ) : (
          <CoreHeatmap perCore={host.cpu.perCore} cores={host.cpu.cores} />
        )}
      </Card>

      {/* 图表区 */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <Card>
          <SectionHead
            title="CPU / 内存 曲线"
            hint={historyMode ? `历史 ${history?.count ?? 0} 点` : `${source.length} 点实时`}
            right={<HistoryControls />}
          />
          {source.length === 0 ? (
            <EmptyState compact title="还没有足够的数据点" hint="WS 每秒推送一次，稍等几秒即可看到曲线。" />
          ) : historyLoading ? (
            <Skeleton className="h-[150px] w-full" />
          ) : (
            <TimeChart
              times={s.times}
              series={[s.cpu, s.mem]}
              defs={[
                { label: 'CPU %', color: '--sc-accent', fill: true },
                { label: '内存 %', color: '--sc-ok' },
              ]}
              height={150}
              yMax={100}
              unit="%"
            />
          )}
        </Card>

        <Card>
          <SectionHead
            title={
              <span className="flex items-center gap-1.5">
                <Network size={12} className="text-fg-subtle" />
                网络吞吐
              </span>
            }
            hint="全部物理网卡合计"
          />
          {source.length === 0 ? (
            <EmptyState compact title="还没有足够的数据点" hint="等待 WS 推送。" />
          ) : (
            <TimeChart
              times={s.times}
              series={[s.rx, s.tx]}
              defs={[
                { label: '下行', color: '--sc-accent', fill: true },
                { label: '上行', color: '--sc-warn' },
              ]}
              height={150}
              unit=""
              asPercent={false}
            />
          )}
        </Card>
      </div>

      {/* 磁盘 + 温度/风扇 */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <SectionHead
            title={
              <span className="flex items-center gap-1.5">
                <HardDrive size={12} className="text-fg-subtle" />
                磁盘挂载点
              </span>
            }
            hint={`${host.disks.length} 个挂载点`}
            right={
              <span className="text-fg-subtle num text-[10.5px]">
                可用 {fmtBytes(host.disks.reduce((a, d) => a + d.avail, 0))}
              </span>
            }
          />
          {host.disks.length === 0 ? (
            <EmptyState compact title="没有可展示的挂载点" hint="collector 已排除 tmpfs / overlay 等伪文件系统。" />
          ) : (
            <DiskList disks={host.disks} />
          )}
        </Card>

        <div className="space-y-3">
          <Card>
            <SectionHead
              title={
                <span className="flex items-center gap-1.5">
                  <Thermometer size={12} className="text-fg-subtle" />
                  温度
                </span>
              }
              hint={`${host.temps.length} 个传感器`}
            />
            {host.temps.length === 0 ? (
              <EmptyState compact title="没有温度传感器" hint="本机未暴露 hwmon 温度通道。" />
            ) : (
              <div className="max-h-[220px] overflow-auto pr-1">
                <TempList temps={host.temps} />
              </div>
            )}
          </Card>

          <Card>
            <SectionHead
              title={
                <span className="flex items-center gap-1.5">
                  <Fan size={12} className="text-fg-subtle" />
                  风扇
                </span>
              }
              hint={`${host.fans.length} 个通道`}
            />
            {host.fans.length === 0 ? (
              <EmptyState compact title="没有风扇转速通道" hint="0 RPM 通道已被 collector 过滤。" />
            ) : (
              <div className="space-y-1">
                {host.fans.map((f) => (
                  <KV key={f.label} k={f.label} v={`${fmtNum(f.rpm)} RPM`} />
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* swap + 系统信息 */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <Card>
          <SectionHead
            title={
              <span className="flex items-center gap-1.5">
                <Server size={12} className="text-fg-subtle" />
                系统
              </span>
            }
          />
          <KV k="主机名" v={host.hostname} />
          <KV k="运行时长" v={fmtUptime(host.uptimeSec)} />
          <KV k="CPU 型号" v={host.cpu.model} />
          <KV k="物理核 / 线程" v={`${host.cpu.cores} / ${host.cpu.threads}`} />
          <KV k="当前频率" v={`${fmtNum(host.cpu.mhz, 0)} MHz`} />
        </Card>
        <Card>
          <SectionHead title="内存与交换" />
          <KV k="内存已用" v={`${fmtBytes(mem.used)} / ${fmtBytes(mem.total)}`} />
          <KV k="内存可用" v={fmtBytes(mem.available)} />
          <KV k="内存占比" v={fmtPct(mem.percent, 1)} />
          <div className="border-line/70 my-2 border-t" />
          <KV k="Swap 已用" v={`${fmtBytes(swap.used)} / ${fmtBytes(swap.total)}`} />
          {swap.total > 0 ? (
            <Meter percent={swap.percent} height={3} className="mt-1.5" tone="warn" />
          ) : (
            <div className="text-fg-subtle mt-1 text-[10.5px]">未启用 swap</div>
          )}
        </Card>
        <Card>
          <SectionHead title="负载" hint="1 / 5 / 15 分钟" />
          <div className="grid grid-cols-3 gap-2">
            {[
              ['1 分钟', load1],
              ['5 分钟', load5],
              ['15 分钟', load15],
            ].map(([label, v]) => (
              <div key={String(label)}>
                <div className="text-fg-subtle text-[10px]">{label}</div>
                <div className="num text-[16px] leading-tight">{Number(v).toFixed(2)}</div>
              </div>
            ))}
          </div>
          {source.length > 0 && (
            <div className="mt-3">
              <TimeChart
                times={s.times}
                series={[s.load1]}
                defs={[{ label: 'load1', color: '--sc-accent', fill: true }]}
                height={80}
              />
            </div>
          )}
        </Card>
      </div>

      {/* GPU */}
      <div>
        <SectionHead
          title="GPU"
          hint={`${latest.gpus.length} 张卡 · 按能力渲染面板`}
          right={
            <span className="text-fg-subtle text-[10.5px]">
              不支持的字段不渲染，不显示 N/A
            </span>
          }
        />
        {latest.gpus.length === 0 ? (
          <EmptyState
            title="未检测到 GPU"
            hint="NVML 未返回任何设备。检查 NVIDIA 驱动与 nvidia-smi 是否可用。"
          />
        ) : (
          <div className={gpuGridClass(latest.gpus.length)}>
            {latest.gpus.map((g) => (
              <GPUCard key={g.uuid || g.index} gpu={g} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
