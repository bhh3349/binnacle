import { useEffect, useMemo, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { cx } from '../lib/format';

export interface SeriesDef {
  label: string;
  /** CSS 变量名，如 '--accent' */
  color: string;
  fill?: boolean;
  width?: number;
  dash?: number[];
}

interface Props {
  /** 秒级时间戳，严格递增 */
  times: number[];
  /** 与 times 等长的序列 */
  series: (number | null)[][];
  defs: SeriesDef[];
  height?: number;
  className?: string;
  /** Y 轴格式化：必须保证不同刻度输出不同文本 */
  formatY: (v: number) => string;
  yMin?: number;
  yMax?: number;
  legend?: boolean;
  /** 页签是否可见。隐藏时容器宽度为 0，需要重新测量 */
  active?: boolean;
}

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/**
 * 时间序列图。瑞士风：直角、无阴影、细网格线、mono 轴标签。
 *
 * 两个曾经踩过的坑，这里都处理了：
 * 1. 页签用 `hidden` 常驻挂载时容器宽度是 0 —— 挂载时量不到宽度，
 *    必须靠 ResizeObserver + active 变化时重新 setSize。
 * 2. Y 轴刻度格式化函数必须单调，且轴宽要够 —— 否则长标签会被截断或换行。
 */
export function TimeChart({
  times,
  series,
  defs,
  height = 140,
  className,
  formatY,
  yMin = 0,
  yMax,
  legend = false,
  active = true,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const plotRef = useRef<uPlot | null>(null);
  const dataRef = useRef<uPlot.AlignedData>([[], []]);

  const data = useMemo<uPlot.AlignedData>(() => [times, ...series], [times, series]);
  dataRef.current = data;

  const optsRef = useRef({ formatY, yMin, yMax, height, legend, defsLen: defs.length });
  optsRef.current = { formatY, yMin, yMax, height, legend, defsLen: defs.length };

  const buildOpts = (width: number): uPlot.Options => {
    const line = cssVar('--line', '#d4d4d2');
    const helper = cssVar('--text-helper', '#737373');
    const placeholder = cssVar('--text-placeholder', '#a3a3a3');
    const paper = cssVar('--paper', '#fafaf8');
    const accent = cssVar('--accent', '#002fa7');

    return {
      width,
      height,
      padding: [8, 8, 0, 0],
      cursor: {
        y: false,
        drag: { x: false, y: false, setScale: false },
        points: { size: 4, fill: accent, stroke: paper, width: 1 },
      },
      legend: { show: legend, live: true },
      scales: {
        x: { time: true },
        y: {
          auto: yMax === undefined,
          range: (_u, _min, max) => {
            const hi = yMax ?? (max <= 0 ? 1 : max * 1.12);
            return [yMin, hi];
          },
        },
      },
      axes: [
        {
          stroke: placeholder,
          font: '500 10px "JetBrains Mono", monospace',
          grid: { show: false },
          ticks: { show: false },
          size: 20,
          gap: 4,
          values: (_u, splits) =>
            splits.map((s) => {
              const d = new Date(s * 1000);
              return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
            }),
        },
        {
          stroke: placeholder,
          font: '500 10px "JetBrains Mono", monospace',
          grid: { show: true, stroke: line, width: 1 },
          ticks: { show: false, size: 0 },
          // 轴宽按最长标签估：字符数 × 6.2px + 间隙
          size: 44,
          gap: 6,
          values: (_u, splits) => splits.map((v) => formatY(v)),
        },
      ],
      series: [
        {},
        ...defs.map((d) => ({
          label: d.label,
          stroke: cssVar(d.color, helper),
          width: d.width ?? 1.5,
          dash: d.dash,
          fill: d.fill ? `${cssVar(d.color, helper)}1f` : undefined,
          points: { show: false },
          spanGaps: true,
          value: (_u: uPlot, v: number | null) => (v == null ? '—' : formatY(v)),
        })),
      ],
    };
  };

  const measure = (): number => {
    const w = hostRef.current?.clientWidth ?? 0;
    return w > 0 ? w : 320;
  };

  const rebuild = () => {
    const mount = mountRef.current;
    if (!mount) return;
    const width = measure();
    if (plotRef.current) {
      plotRef.current.destroy();
      plotRef.current = null;
    }
    mount.replaceChildren();
    plotRef.current = new uPlot(buildOpts(width), dataRef.current, mount);
  };

  // 首次挂载 + 依赖变化时重建
  useEffect(() => {
    rebuild();
    const host = hostRef.current;
    if (!host) return;
    const ro = new ResizeObserver(() => {
      const p = plotRef.current;
      if (!p) return;
      const w = host.clientWidth;
      if (w > 0 && Math.abs(w - p.width) > 1) p.setSize({ width: w, height });
    });
    ro.observe(host);
    return () => {
      ro.disconnect();
      plotRef.current?.destroy();
      plotRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height, yMin, yMax, legend, defs.length, formatY]);

  // 页签从隐藏切到可见：容器宽度从 0 变成真实值，重建一次
  useEffect(() => {
    if (!active) return;
    const id = window.requestAnimationFrame(() => {
      const host = hostRef.current;
      const p = plotRef.current;
      if (!host) return;
      const w = host.clientWidth;
      if (w <= 0) return;
      if (!p) {
        rebuild();
        return;
      }
      if (Math.abs(w - p.width) > 1) p.setSize({ width: w, height });
    });
    return () => window.cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, height]);

  // 主题切换：颜色来自 CSS 变量，必须重建
  useEffect(() => {
    const obs = new MutationObserver(() => rebuild());
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    plotRef.current?.setData(data);
  }, [data]);

  return (
    <div
      ref={hostRef}
      className={cx('w-full min-w-0', className)}
      style={{ height }}
      role="img"
      aria-label={defs.map((d) => d.label).join(', ')}
    >
      {/* uPlot 会往挂载点写内联 width，所以它不能是那个 w-full 的容器 */}
      <div ref={mountRef} className="uplot" />
    </div>
  );
}
