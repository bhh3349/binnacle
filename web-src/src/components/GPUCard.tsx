import type { GPUStats } from '../lib/types';
import { Badge, KV, Meter, Card } from './ui';
import { cx, fmtBytes, fmtNum, fmtPct } from '../lib/format';
import { AlertTriangle, Cpu, Info } from 'lucide-react';

/** throttle 位里真正需要报警的项 */
const ALARM_THROTTLE = new Set(['hw_thermal_slowdown', 'hw_power_brake_slowdown']);

const THROTTLE_LABEL: Record<string, string> = {
  gpu_idle: '空闲',
  applications_clocks_setting: '应用锁定频率',
  sw_power_cap: '软件功耗墙',
  hw_slowdown: '硬件降速',
  sync_boost: '同步加速',
  sw_thermal_slowdown: '软件温度降频',
  hw_thermal_slowdown: '硬件温度降频',
  hw_power_brake_slowdown: '功耗刹车',
  display_clock_setting: '显示频率锁定',
};

function pstateLabel(p: number): string {
  return `P${p}`;
}

/** PCIe 面板：降速只标灰字，绝不报警 */
function PCIePanel({ gpu }: { gpu: GPUStats }) {
  const p = gpu.pcie;
  const downclocked = p.gen < p.genMax || p.width < p.widthMax;
  return (
    <div>
      <div className="text-fg-subtle mb-1 text-[10.5px] tracking-[0.04em] uppercase">PCIe 链路</div>
      <div className="flex items-baseline gap-1.5">
        <span className="num text-[15px] leading-tight">
          Gen{p.gen} × {p.width}
        </span>
        {downclocked && (
          <span className="text-fg-subtle text-[10.5px]">
            空闲降速 · 峰值 Gen{p.genMax} × {p.widthMax}
          </span>
        )}
      </div>
      {(p.txBps > 0 || p.rxBps > 0) && (
        <div className="text-fg-subtle num mt-1 text-[10.5px]">
          ↑ {fmtBytes(p.txBps)}/s ↓ {fmtBytes(p.rxBps)}/s
        </div>
      )}
    </div>
  );
}

export function GPUCard({ gpu }: { gpu: GPUStats }) {
  const throttles = gpu.throttle ?? [];
  const alarming = throttles.filter((t) => ALARM_THROTTLE.has(t));
  const benign = throttles.filter((t) => !ALARM_THROTTLE.has(t));
  const procs = gpu.procs ?? [];

  // 按字段判空决定渲染哪些面板
  const showMemTemp = gpu.tempMem !== null;
  const showFan = gpu.fanSupported;
  const showEcc = gpu.ecc !== null;
  const showEncDec = gpu.encUtil !== null || gpu.decUtil !== null;

  return (
    <Card className="flex flex-col gap-3.5">
      {/* 头部 */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <Cpu size={12} className="text-fg-subtle shrink-0" />
            <span className="truncate text-[12.5px] font-medium">{gpu.name}</span>
          </div>
          <div className="text-fg-subtle num mt-0.5 truncate text-[10.5px]">
            GPU{gpu.index} · {gpu.pciAddr} · 驱动 {gpu.driverVer}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {gpu.pstate !== null && (
            <Badge tone={gpu.pstate <= 2 ? 'accent' : 'neutral'}>{pstateLabel(gpu.pstate)}</Badge>
          )}
          {alarming.length > 0 ? (
            <Badge tone="danger" dot>
              {THROTTLE_LABEL[alarming[0] ?? ''] ?? alarming[0]}
            </Badge>
          ) : (
            <Badge tone="ok" dot>
              {benign.length > 0 ? (THROTTLE_LABEL[benign[0] ?? ''] ?? benign[0]) : '正常'}
            </Badge>
          )}
        </div>
      </div>

      {/* 主指标 */}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <div className="text-fg-subtle text-[10.5px] tracking-[0.04em] uppercase">利用率</div>
          <div className="num text-[18px] leading-tight">{fmtPct(gpu.util, 0)}</div>
          <Meter percent={gpu.util} height={3} className="mt-1" />
        </div>
        <div>
          <div className="text-fg-subtle text-[10.5px] tracking-[0.04em] uppercase">显存</div>
          <div className="num text-[18px] leading-tight">
            {fmtBytes(gpu.mem.used)}
            <span className="text-fg-subtle ml-1 text-[10.5px]">/ {fmtBytes(gpu.mem.total)}</span>
          </div>
          <Meter percent={gpu.mem.percent} height={3} className="mt-1" />
        </div>
        <div>
          <div className="text-fg-subtle text-[10.5px] tracking-[0.04em] uppercase">温度</div>
          <div className="num text-[18px] leading-tight">
            {fmtNum(gpu.tempGpu, 0)}
            <span className="text-fg-subtle ml-0.5 text-[10.5px]">°C</span>
          </div>
          <Meter
            percent={gpu.tempLimit ? (gpu.tempGpu / gpu.tempLimit) * 100 : (gpu.tempGpu / 100) * 100}
            height={3}
            className="mt-1"
            tone={gpu.tempLimit && gpu.tempGpu > gpu.tempLimit * 0.9 ? 'warn' : 'accent'}
          />
        </div>
      </div>

      {/* 明细：通用字段 + 条件字段 */}
      <div className="border-line/70 grid grid-cols-2 gap-x-5 gap-y-0 border-t pt-3">
        <KV k="显存带宽占用" v={fmtPct(gpu.memUtil, 1)} />
        <KV k="功耗" v={`${fmtNum(gpu.power.draw, 1)} / ${fmtNum(gpu.power.limit, 0)} W`} />

        {/* 只有 V100 有显存温度 */}
        {showMemTemp && <KV k="显存温度" v={`${fmtNum(gpu.tempMem ?? 0, 0)} °C`} />}

        {/* 只有 3060 有风扇 */}
        {showFan && (
          <KV
            k="风扇转速"
            v={
              gpu.fan !== null && gpu.fan > 0 ? `${fmtNum(gpu.fan, 0)}%` : '停转（空闲零转速）'
            }
          />
        )}

        <KV
          k="核心频率"
          v={`${fmtNum(gpu.clocks.sm, 0)} / ${fmtNum(gpu.clocks.maxSm, 0)} MHz`}
        />
        <KV
          k="显存频率"
          v={`${fmtNum(gpu.clocks.mem, 0)} / ${fmtNum(gpu.clocks.maxMem, 0)} MHz`}
        />

        {showEncDec && (
          <>
            {gpu.encUtil !== null && <KV k="编码器" v={fmtPct(gpu.encUtil, 0)} />}
            {gpu.decUtil !== null && <KV k="解码器" v={fmtPct(gpu.decUtil, 0)} />}
          </>
        )}
      </div>

      {/* PCIe */}
      <div className="border-line/70 border-t pt-3">
        <PCIePanel gpu={gpu} />
      </div>

      {/* ECC：只有 V100 */}
      {showEcc && gpu.ecc && (
        <div className="border-line/70 border-t pt-3">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-fg-subtle text-[10.5px] tracking-[0.04em] uppercase">ECC 显存校验</span>
            <Badge tone={gpu.ecc.mode === 'enabled' ? 'ok' : 'neutral'}>{gpu.ecc.mode}</Badge>
          </div>
          <div className="grid grid-cols-2 gap-x-5">
            <KV
              k="可纠正（累计）"
              v={fmtNum(gpu.ecc.correctedAgg)}
              muted={gpu.ecc.correctedAgg === 0}
            />
            <KV
              k="不可纠正（累计）"
              v={fmtNum(gpu.ecc.uncorrectedAgg)}
              muted={gpu.ecc.uncorrectedAgg === 0}
            />
            <KV k="Retired SBE" v={fmtNum(gpu.ecc.retiredSbe)} muted={gpu.ecc.retiredSbe === 0} />
            <KV k="Retired DBE" v={fmtNum(gpu.ecc.retiredDbe)} muted={gpu.ecc.retiredDbe === 0} />
          </div>
        </div>
      )}

      {/* 进程 */}
      <div className="border-line/70 border-t pt-3">
        <div className="text-fg-subtle mb-1.5 text-[10.5px] tracking-[0.04em] uppercase">
          占用显存的进程
        </div>
        {procs.length === 0 ? (
          <div className="text-fg-subtle text-[11px]">无进程占用</div>
        ) : (
          <div className="space-y-1">
            {procs.map((p) => (
              <div key={`${p.pid}-${p.name}`} className="flex items-baseline justify-between gap-2">
                <span className="num text-fg-muted truncate text-[11px]">
                  {p.pid} · {p.name}
                </span>
                <span className="num text-fg-subtle shrink-0 text-[10.5px]">
                  {fmtBytes(p.usedMem)} · {p.user}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 降速原因（非报警项） */}
      {benign.length > 1 && (
        <div className="text-fg-subtle flex flex-wrap items-center gap-1 text-[10.5px]">
          <Info size={10} />
          {benign.map((t) => (
            <span key={t} className="border-line rounded border px-1 py-[0.5px]">
              {THROTTLE_LABEL[t] ?? t}
            </span>
          ))}
        </div>
      )}
      {alarming.length > 0 && (
        <div className="border-danger/25 bg-danger/5 text-danger flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10.5px]">
          <AlertTriangle size={11} />
          {alarming.map((t) => THROTTLE_LABEL[t] ?? t).join('、')}
        </div>
      )}
    </Card>
  );
}

export function gpuGridClass(n: number): string {
  return cx('grid gap-3', n >= 2 ? 'grid-cols-1 xl:grid-cols-2' : 'grid-cols-1');
}
