import type { GPUStats } from '../lib/types';
import { Badge, Card, KV, Meter } from './ui';
import { cx, fmtBytes, fmtBytesAxis, fmtNum, fmtPct } from '../lib/format';
import { AlertTriangle } from 'lucide-react';

/* ══════════════════════════════════════════════════════════════════════════
   GPU 卡片 — 按字段判空渲染，不显示 N/A、不显示假 0
   · tempMem !== null      → 显存温度面板（仅 V100）
   · fanSupported          → 风扇面板（仅 3060）
   · ecc !== null          → ECC 面板（仅 V100）
   · PCIe 降速只标灰字「空闲降速」，绝不报警
   ══════════════════════════════════════════════════════════════════════════ */

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

export function GPUCard({ gpu, className }: { gpu: GPUStats; className?: string }) {
  const throttles = gpu.throttle ?? [];
  const alarming = throttles.filter((t) => ALARM_THROTTLE.has(t));
  const benign = throttles.filter((t) => !ALARM_THROTTLE.has(t));
  const procs = gpu.procs ?? [];

  const showMemTemp = gpu.tempMem !== null;
  const showFan = gpu.fanSupported;
  const showEcc = gpu.ecc !== null;
  const showEncDec = gpu.encUtil !== null || gpu.decUtil !== null;

  const pcie = gpu.pcie;
  const downclocked = pcie.gen < pcie.genMax || pcie.width < pcie.widthMax;

  return (
    <Card className={cx('gap-0', className)}>
      {/* 头部：卡名 + 状态 */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[14px] leading-tight font-medium text-[var(--ink)]">
            {gpu.name}
          </div>
          <div className="num mt-1 truncate text-[10.5px] leading-tight text-[var(--text-placeholder)]">
            GPU{gpu.index} · {gpu.pciAddr} · 驱动 {gpu.driverVer}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {gpu.pstate !== null && (
            <Badge tone={gpu.pstate <= 2 ? 'accent' : 'neutral'}>P{gpu.pstate}</Badge>
          )}
          {alarming.length > 0 ? (
            <Badge tone="danger">{THROTTLE_LABEL[alarming[0] ?? ''] ?? alarming[0]}</Badge>
          ) : (
            <Badge tone="neutral">
              {benign.length > 0 ? (THROTTLE_LABEL[benign[0] ?? ''] ?? benign[0]) : '正常'}
            </Badge>
          )}
        </div>
      </div>

      {/* 三个主指标 */}
      <div className="mt-4 grid grid-cols-3 gap-4">
        <div>
          <div className="kicker">利用率</div>
          <div className="num mt-1 text-[20px] leading-none font-medium text-[var(--ink)]">
            {fmtPct(gpu.util, 0)}
          </div>
          <Meter percent={gpu.util} height={2} className="mt-1.5" />
        </div>
        <div>
          <div className="kicker">显存</div>
          <div className="num mt-1 text-[20px] leading-none font-medium text-[var(--ink)]">
            {fmtPct(gpu.mem.percent, 0)}
          </div>
          <Meter percent={gpu.mem.percent} height={2} className="mt-1.5" />
        </div>
        <div>
          <div className="kicker">温度</div>
          <div className="num mt-1 text-[20px] leading-none font-medium text-[var(--ink)]">
            {fmtNum(gpu.tempGpu, 0)}
            <span className="ml-0.5 text-[11px] font-normal text-[var(--text-helper)]">°C</span>
          </div>
          <Meter
            percent={gpu.tempLimit ? (gpu.tempGpu / gpu.tempLimit) * 100 : gpu.tempGpu}
            height={2}
            className="mt-1.5"
            tone={gpu.tempLimit && gpu.tempGpu > gpu.tempLimit * 0.9 ? 'warn' : 'accent'}
          />
        </div>
      </div>

      {/* 明细：两列键值 */}
      <div className="mt-4 grid grid-cols-2 gap-x-6 border-t border-[var(--line-subtle)] pt-3">
        <KV k="显存占用" v={`${fmtBytes(gpu.mem.used)} / ${fmtBytes(gpu.mem.total)}`} />
        <KV k="显存带宽" v={fmtPct(gpu.memUtil, 1)} />
        <KV k="功耗" v={`${fmtNum(gpu.power.draw, 1)} / ${fmtNum(gpu.power.limit, 0)} W`} />
        <KV k="核心频率" v={`${fmtNum(gpu.clocks.sm, 0)} / ${fmtNum(gpu.clocks.maxSm, 0)} MHz`} />

        {/* 仅 V100：显存温度 */}
        {showMemTemp && <KV k="显存温度" v={`${fmtNum(gpu.tempMem ?? 0, 0)} °C`} />}

        {/* 仅 3060：风扇 */}
        {showFan && (
          <KV
            k="风扇转速"
            v={gpu.fan !== null && gpu.fan > 0 ? `${fmtNum(gpu.fan, 0)}%` : '停转（空闲零转速）'}
            muted={gpu.fan === 0}
          />
        )}

        <KV k="显存频率" v={`${fmtNum(gpu.clocks.mem, 0)} / ${fmtNum(gpu.clocks.maxMem, 0)} MHz`} />

        {showEncDec && (
          <>
            {gpu.encUtil !== null && <KV k="编码器" v={fmtPct(gpu.encUtil, 0)} />}
            {gpu.decUtil !== null && <KV k="解码器" v={fmtPct(gpu.decUtil, 0)} />}
          </>
        )}
      </div>

      {/* PCIe：降速只标灰字 */}
      <div className="mt-3 border-t border-[var(--line-subtle)] pt-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="kicker">PCIe 链路</span>
          <div className="num text-right text-[12px] leading-tight">
            <span className="font-medium text-[var(--ink)]">
              Gen{pcie.gen} × {pcie.width}
            </span>
            {downclocked && (
              <span className="ml-2 text-[10.5px] font-normal text-[var(--text-placeholder)]">
                空闲降速 · 峰值 Gen{pcie.genMax} × {pcie.widthMax}
              </span>
            )}
          </div>
        </div>
        {(pcie.txBps > 0 || pcie.rxBps > 0) && (
          <div className="num mt-1 text-right text-[10px] text-[var(--text-placeholder)]">
            ↑ {fmtBytesAxis(pcie.txBps)}/s · ↓ {fmtBytesAxis(pcie.rxBps)}/s
          </div>
        )}
      </div>

      {/* ECC：仅 V100 */}
      {showEcc && gpu.ecc && (
        <div className="mt-3 border-t border-[var(--line-subtle)] pt-3">
          <div className="mb-1.5 flex items-baseline justify-between gap-3">
            <span className="kicker">ECC 显存校验</span>
            <Badge tone={gpu.ecc.mode === 'enabled' ? 'ok' : 'neutral'}>{gpu.ecc.mode}</Badge>
          </div>
          <div className="grid grid-cols-2 gap-x-6">
            <KV k="可纠正" v={fmtNum(gpu.ecc.correctedAgg)} muted={gpu.ecc.correctedAgg === 0} />
            <KV
              k="不可纠正"
              v={fmtNum(gpu.ecc.uncorrectedAgg)}
              muted={gpu.ecc.uncorrectedAgg === 0}
            />
            <KV k="Retired SBE" v={fmtNum(gpu.ecc.retiredSbe)} muted={gpu.ecc.retiredSbe === 0} />
            <KV k="Retired DBE" v={fmtNum(gpu.ecc.retiredDbe)} muted={gpu.ecc.retiredDbe === 0} />
          </div>
        </div>
      )}

      {/* 进程 */}
      <div className="mt-3 border-t border-[var(--line-subtle)] pt-3">
        <div className="kicker mb-1.5">占用显存的进程</div>
        {procs.length === 0 ? (
          <div className="text-[11.5px] text-[var(--text-helper)]">无进程占用</div>
        ) : (
          <div className="space-y-1">
            {procs.map((p) => (
              <div key={`${p.pid}-${p.name}`} className="flex items-baseline justify-between gap-3">
                <span className="num truncate text-[11.5px] text-[var(--text-secondary)]">
                  {p.pid} · {p.name}
                </span>
                <span className="num shrink-0 text-[10.5px] text-[var(--text-placeholder)]">
                  {fmtBytes(p.usedMem)} · {p.user}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 降速原因 */}
      {benign.length > 1 && (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {benign.map((t) => (
            <span
              key={t}
              className="num px-1 py-[1px] text-[9.5px] text-[var(--text-placeholder)] outline outline-[var(--line-subtle)]"
            >
              {THROTTLE_LABEL[t] ?? t}
            </span>
          ))}
        </div>
      )}
      {alarming.length > 0 && (
        <div className="mt-2 flex items-center gap-1.5 bg-[var(--paper-3)] px-2 py-1 text-[10.5px] text-[var(--alert)]">
          <AlertTriangle size={11} />
          {alarming.map((t) => THROTTLE_LABEL[t] ?? t).join('、')}
        </div>
      )}
    </Card>
  );
}


