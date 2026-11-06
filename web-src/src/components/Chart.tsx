import { useEffect, useMemo, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { cx } from '../lib/format';

export interface SeriesDef {
  label: string;
  /** CSS 变量名或颜色值 */
  color: string;
  /** 填充渐变（面积图） */
  fill?: boolean;
  width?: number;
  dash?: number[];
}

interface Props {
  /** 秒级时间戳，严格递增 */
  times: number[];
  /** 与 times 等长的序列数据 */
  series: (number | null)[][];
  defs: SeriesDef[];
  height?: number;
  className?: string;
  yLabel?: string;
  /** y 轴固定上限 */
  yMax?: number;
  /** y 轴固定下限 */
  yMin?: number;
  /** 单位后缀 */
  unit?: string;
  /** 显示图例 */
  legend?: boolean;
  /** 0..1 之间的小数按百分比显示 */
  asPercent?: boolean;
}

function readVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export function TimeChart({
  times,
  series,
  defs,
  height = 140,
  className,
  yLabel,
  yMax,
  yMin = 0,
  unit = '',
  legend = false,
  asPercent = false,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const plotRef = useRef<uPlot | null>(null);
  const dataRef = useRef<uPlot.AlignedData>([[], []]);

  const data = useMemo<uPlot.AlignedData>(() => {
    const arr: uPlot.AlignedData = [times, ...series];
    return arr;
  }, [times, series]);
  dataRef.current = data;

  const buildOpts = (): uPlot.Options => {
    const line = readVar('--sc-line', '#1e2025');
    const muted = readVar('--sc-fg-subtle', '#6b7280');
    const accent = readVar('--sc-accent', '#818cf8');
    const surface = readVar('--sc-surface', '#0d0e11');

    return {
      width: Math.max(160, hostRef.current?.clientWidth ?? 320),
      height,
      padding: [6, 6, 0, 0],
      cursor: {
        y: false,
        drag: { x: false, y: false, setScale: false },
        points: { size: 5, fill: accent, stroke: surface },
      },
      legend: { show: legend, live: true },
      scales: {
        x: { time: true },
        y: {
          auto: yMax === undefined,
          range: (_u, _min, max) => {
            const hi = yMax ?? (max <= 0 ? 1 : max * 1.15);
            return [yMin, hi];
          },
        },
      },
      axes: [
        {
          stroke: muted,
          font: '10px ui-monospace, monospace',
          grid: { show: false },
          ticks: { show: false },
          size: 22,
          values: (_u, splits) =>
            splits.map((s) => {
              const d = new Date(s * 1000);
              return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
            }),
        },
        {
          stroke: muted,
          font: '10px ui-monospace, monospace',
          grid: { show: true, stroke: line, width: 1 },
          ticks: { show: false },
          size: 40,
          label: yLabel,
          labelSize: 0,
          values: (_u, splits) =>
            splits.map((v) =>
              asPercent ? `${Math.round(v * 100)}%` : `${v >= 1000 ? (v / 1000).toFixed(1) + 'k' : Math.round(v)}${unit}`,
            ),
        },
      ],
      series: [
        {},
        ...defs.map((d, i) => ({
          label: d.label,
          stroke: readVar(d.color, d.color),
          width: d.width ?? 1.5,
          dash: d.dash,
          fill: d.fill ? `${readVar(d.color, d.color)}22` : undefined,
          points: { show: false },
          value: (_u: uPlot, v: number | null) =>
            v == null ? '—' : asPercent ? `${(v * 100).toFixed(1)}%` : `${v.toFixed(1)}${unit}`,
          spanGaps: true,
          _i: i,
        })),
      ],
    };
  };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const plot = new uPlot(buildOpts(), dataRef.current, host);
    plotRef.current = plot;

    const ro = new ResizeObserver(() => {
      const w = host.clientWidth;
      if (w > 0) plot.setSize({ width: w, height });
    });
    ro.observe(host);

    return () => {
      ro.disconnect();
      plot.destroy();
      plotRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height, yMax, yMin, asPercent, unit, legend, defs.length]);

  // 主题切换时重建（颜色来自 CSS 变量）
  useEffect(() => {
    const obs = new MutationObserver(() => {
      const host = hostRef.current;
      if (!host || !plotRef.current) return;
      plotRef.current.destroy();
      plotRef.current = new uPlot(buildOpts(), dataRef.current, host);
    });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const p = plotRef.current;
    if (!p) return;
    p.setData(data);
  }, [data]);

  return (
    <div
      ref={hostRef}
      className={cx('uplot w-full', className)}
      style={{ height }}
      role="img"
      aria-label={defs.map((d) => d.label).join(', ')}
    />
  );
}
