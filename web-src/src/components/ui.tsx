import type { ReactNode } from 'react';
import { cx } from '../lib/format';
import { AlertTriangle, Inbox, Loader2, RotateCw } from 'lucide-react';

/* ══════════════════════════════════════════════════════════════════════════
   设计原语 — 1Panel 企业级管理后台
   · 白卡片圆角 8px + 细边框 + 极浅阴影，浅灰内容底
   · 卡片头 primary 竖条 + 标题
   · 主按钮 primary 实底白字；次按钮白底细边框
   · 徽标圆点 + 浅底色块；进度条圆头
   ══════════════════════════════════════════════════════════════════════════ */

/* ── 品牌标记 ─────────────────────────────────────────────────────────── */

export function Logo({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <circle cx="16" cy="16" r="9.4" stroke="currentColor" strokeWidth="1.4" opacity="0.35" />
      <circle cx="16" cy="16" r="5.6" stroke="currentColor" strokeWidth="1.2" opacity="0.65" />
      <path d="M16 6.2 L18.6 16 L16 25.8 L13.4 16 Z" fill="currentColor" />
      <path d="M6.2 16 L16 13.4 L25.8 16 L16 18.6 Z" fill="currentColor" opacity="0.45" />
      <circle cx="16" cy="16" r="1.6" fill="var(--paper-2)" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

/* ── 按钮 ─────────────────────────────────────────────────────────────── */

type BtnVariant = 'solid' | 'quiet' | 'outline' | 'danger' | 'accent';
type BtnSize = 'xs' | 'sm' | 'md';

const BTN_VARIANTS: Record<BtnVariant, string> = {
  accent: 'bg-[var(--accent)] text-white hover:bg-[var(--accent-1)] border border-transparent',
  solid: 'bg-[var(--ink)] text-[var(--paper-2)] hover:opacity-90 border border-transparent',
  quiet:
    'bg-transparent text-[var(--text-secondary)] hover:text-[var(--accent)] hover:bg-[var(--accent-soft)] border border-transparent',
  outline:
    'bg-[var(--paper-2)] text-[var(--text-body)] border-[var(--line-strong)] hover:border-[var(--accent)] hover:text-[var(--accent)]',
  danger:
    'bg-[var(--paper-2)] text-[var(--alert)] border-[var(--alert)]/40 hover:bg-[var(--alert)] hover:text-white hover:border-transparent',
};

const BTN_SIZES: Record<BtnSize, string> = {
  xs: 'h-6 px-2 text-[11.5px] gap-1 rounded-[4px]',
  sm: 'h-7 px-2.5 text-[13px] gap-1.5 rounded-[4px]',
  md: 'h-9 px-4 text-[13.5px] gap-2 rounded-[4px]',
};

export function Button({
  children,
  variant = 'outline',
  size = 'sm',
  className,
  disabled,
  onClick,
  title,
  type = 'button',
}: {
  children: ReactNode;
  variant?: BtnVariant;
  size?: BtnSize;
  className?: string;
  disabled?: boolean;
  onClick?: () => void;
  title?: string;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap',
        'border font-medium transition-all duration-150 active:scale-[0.98]',
        'focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40 focus-visible:outline-none',
        BTN_VARIANTS[variant],
        BTN_SIZES[size],
        disabled && 'pointer-events-none opacity-40',
        className,
      )}
    >
      {children}
    </button>
  );
}

/* ── 卡片 ─────────────────────────────────────────────────────────────── */

export function Card({
  children,
  className,
  padded = true,
  accent = false,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
  accent?: boolean;
}) {
  return (
    <div
      className={cx(
        'flex min-w-0 flex-col',
        accent
          ? 'rounded-[8px] border border-[var(--accent)]/30 bg-[var(--accent-soft)]'
          : 'card',
        padded && 'p-4',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** 卡片头：primary 竖条 + 标题（1Panel 标志性元素） */
export function SectionHead({
  title,
  hint,
  right,
  className,
}: {
  title: ReactNode;
  hint?: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('mb-3 flex items-center justify-between gap-3', className)}>
      <div className="flex min-w-0 items-center gap-2">
        <span className="h-4 w-1 shrink-0 rounded-full bg-[var(--accent)]" />
        <h2 className="truncate text-[13.5px] leading-tight font-medium text-[var(--text-primary)]">
          {title}
        </h2>
        {hint && (
          <span className="truncate text-[11px] leading-tight text-[var(--text-helper)]">
            {hint}
          </span>
        )}
      </div>
      {right && <div className="flex shrink-0 items-center gap-1.5">{right}</div>}
    </div>
  );
}

/* ── 三态 ─────────────────────────────────────────────────────────────── */

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('skeleton', className)} />;
}

export function SkeletonRows({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cx('space-y-2', className)}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-7 w-full" />
      ))}
    </div>
  );
}

export function LoadingBlock({ label = '加载中', rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label={label}>
      <SkeletonRows rows={rows} />
      <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-helper)]">
        <Loader2 size={11} className="spin" />
        {label}…
      </div>
    </div>
  );
}

export function ErrorState({
  message,
  detail,
  onRetry,
  compact,
}: {
  message: string;
  detail?: string;
  onRetry?: () => void;
  compact?: boolean;
}) {
  return (
    <div
      className={cx(
        'rounded-[6px] border border-[var(--alert)]/25 bg-[var(--alert)]/[0.04]',
        compact ? 'p-3' : 'p-4',
      )}
      role="alert"
    >
      <div className="flex items-center gap-2 text-[12.5px] font-medium text-[var(--alert)]">
        <AlertTriangle size={13} className="shrink-0" />
        {message}
      </div>
      {detail && (
        <div className="num mt-1.5 max-h-24 overflow-auto text-[11px] leading-relaxed break-all text-[var(--text-secondary)]">
          {detail}
        </div>
      )}
      {onRetry && (
        <Button size="xs" variant="outline" className="mt-3" onClick={onRetry}>
          <RotateCw size={10} />
          重试
        </Button>
      )}
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  action,
  compact,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={cx('flex flex-col items-start justify-center', compact ? 'py-6' : 'py-10')}
    >
      <div className="flex items-center gap-2 text-[12.5px] text-[var(--text-secondary)]">
        <Inbox size={13} className="shrink-0" />
        {title}
      </div>
      {hint && (
        <div className="mt-1 max-w-md text-[11.5px] leading-relaxed text-[var(--text-helper)]">
          {hint}
        </div>
      )}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/* ── 徽标：圆点 + 浅底色块 ─────────────────────────────────────────────── */

export type Tone = 'neutral' | 'ok' | 'warn' | 'danger' | 'accent';

const TONES: Record<Tone, string> = {
  neutral: 'text-[var(--text-secondary)] bg-[var(--paper-3)]',
  ok: 'text-[var(--ok)] bg-[color-mix(in_oklab,var(--ok)_12%,transparent)]',
  warn: 'text-[var(--warn)] bg-[color-mix(in_oklab,var(--warn)_12%,transparent)]',
  danger: 'text-white bg-[var(--alert)]',
  accent: 'text-[var(--accent)] bg-[var(--accent-soft)]',
};

const DOTS: Record<Tone, string> = {
  neutral: 'bg-[var(--text-placeholder)]',
  ok: 'bg-[var(--ok)]',
  warn: 'bg-[var(--warn)]',
  danger: 'bg-[var(--alert)]',
  accent: 'bg-[var(--accent)]',
};

export function Badge({
  children,
  tone = 'neutral',
  className,
  dot,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span
      className={cx(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-[2px]',
        'text-[11px] leading-[16px] font-medium whitespace-nowrap',
        TONES[tone],
        className,
      )}
    >
      {dot && <span className={cx('h-[5px] w-[5px] rounded-full', DOTS[tone])} />}
      {children}
    </span>
  );
}

/* ── 进度条：圆头 ─────────────────────────────────────────────────────── */

export function Meter({
  percent,
  tone = 'accent',
  height = 6,
  className,
}: {
  percent: number;
  tone?: Tone;
  height?: number;
  className?: string;
}) {
  const p = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));
  const bg =
    tone === 'danger'
      ? 'bg-[var(--alert)]'
      : tone === 'warn'
        ? 'bg-[var(--warn)]'
        : tone === 'ok'
          ? 'bg-[var(--ok)]'
          : 'bg-[var(--accent)]';
  return (
    <div
      className={cx('w-full overflow-hidden rounded-full bg-[var(--paper-3)]', className)}
      style={{ height }}
      role="progressbar"
      aria-valuenow={Math.round(p)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={cx('h-full rounded-full transition-[width] duration-300 ease-out', bg)}
        style={{ width: `${p}%` }}
      />
    </div>
  );
}

/* ── 键值行 ───────────────────────────────────────────────────────────── */

export function KV({
  k,
  v,
  muted,
  className,
}: {
  k: ReactNode;
  v: ReactNode;
  muted?: boolean;
  className?: string;
}) {
  return (
    <div className={cx('flex items-baseline justify-between gap-4 py-[3px]', className)}>
      <span className="shrink-0 text-[12px] leading-tight text-[var(--text-helper)]">{k}</span>
      <span
        className={cx(
          'num truncate text-right text-[12px] leading-tight',
          muted ? 'text-[var(--text-helper)]' : 'text-[var(--ink)]',
        )}
      >
        {v}
      </span>
    </div>
  );
}

/* ── 圆环仪表（1Panel 标志性元素）─────────────────────────────────────── */

const RING_TONES: Record<string, string> = {
  accent: 'var(--accent)',
  ok: 'var(--ok)',
  warn: 'var(--warn)',
  danger: 'var(--alert)',
};

/**
 * SVG 圆环仪表：浅灰轨道 + 彩色弧，中间大字百分比，下方标签与辅助信息。
 * percent 0..100；tone 随阈值可变（健康绿 → 警告黄 → 危险红）。
 */
export function Gauge({
  percent,
  label,
  sub,
  size = 120,
  tone,
  formatValue,
}: {
  percent: number;
  label: string;
  sub?: ReactNode;
  size?: number;
  /** 不传则按阈值自动：60 以上 warn、85 以上 danger */
  tone?: Tone;
  formatValue?: (p: number) => string;
}) {
  const p = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));
  const auto: Tone = p >= 85 ? 'danger' : p >= 60 ? 'warn' : 'accent';
  const t = tone ?? auto;

  const stroke = 8;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  // 顶部留一个 60° 缺口会更像 1Panel？不，1Panel 是整圆。用整圆。
  const filled = (p / 100) * c;

  const value = formatValue ? formatValue(p) : `${p.toFixed(1)}%`;

  return (
    <div className="flex min-w-0 flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="var(--paper-3)"
            strokeWidth={stroke}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={RING_TONES[t === 'neutral' ? 'accent' : t]}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${filled} ${c - filled}`}
            style={{ transition: 'stroke-dasharray 500ms ease, stroke 300ms ease' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            className={cx(
              'num text-[20px] leading-none font-medium',
              t === 'danger'
                ? 'text-[var(--alert)]'
                : t === 'warn'
                  ? 'text-[var(--warn)]'
                  : 'text-[var(--ink)]',
            )}
          >
            {value}
          </span>
          <span className="mt-1 text-[11px] leading-none text-[var(--text-helper)]">{label}</span>
        </div>
      </div>
      {sub && (
        <div className="num max-w-full truncate text-center text-[10.5px] leading-tight text-[var(--text-placeholder)]">
          {sub}
        </div>
      )}
    </div>
  );
}

/* ── 大数字 ───────────────────────────────────────────────────────────── */

export function Stat({
  label,
  value,
  unit,
  sub,
  tone,
  size = 'md',
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  sub?: ReactNode;
  tone?: Tone;
  size?: 'md' | 'lg';
}) {
  const color =
    tone === 'danger'
      ? 'text-[var(--alert)]'
      : tone === 'warn'
        ? 'text-[var(--warn)]'
        : 'text-[var(--ink)]';
  return (
    <div className="min-w-0">
      <div className="truncate text-[11px] text-[var(--text-helper)]">{label}</div>
      <div
        className={cx(
          'num mt-1 flex items-baseline gap-1 leading-none',
          size === 'lg' ? 'text-[28px]' : 'text-[22px]',
          color,
        )}
      >
        <span className="truncate font-medium">{value}</span>
        {unit && (
          <span className="shrink-0 text-[11px] font-normal text-[var(--text-helper)]">{unit}</span>
        )}
      </div>
      {sub && (
        <div className="mt-1.5 truncate text-[11px] leading-tight text-[var(--text-helper)]">
          {sub}
        </div>
      )}
    </div>
  );
}

/* ── 可折叠分组 ───────────────────────────────────────────────────────── */

export function Collapsible({
  title,
  meta,
  open,
  onToggle,
  children,
}: {
  title: ReactNode;
  meta?: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-[4px] px-1.5 py-1.5 text-left transition-colors hover:bg-[var(--paper-3)]"
      >
        <span className="kicker shrink-0 text-[var(--text-secondary)]">{title}</span>
        <span className="ml-auto flex shrink-0 items-center gap-2">{meta}</span>
      </button>
      {open && <div className="pt-1 pb-2 pl-5">{children}</div>}
    </div>
  );
}

/* ── 12 列网格 ────────────────────────────────────────────────────────── */

export function Grid12({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cx('grid grid-cols-1 gap-4 lg:grid-cols-12', className)}>{children}</div>;
}
