import type { ReactNode } from 'react';
import { cx } from '../lib/format';
import { AlertTriangle, ChevronDown, Inbox, Loader2, RotateCw } from 'lucide-react';

/* ══════════════════════════════════════════════════════════════════════════
   设计原语 — 瑞士国际主义（Swiss / ikb）
   · 直角 0 圆角、无阴影、无渐变
   · 卡片靠背景色区分，不画边框（design-rules: 卡片语言）
   · 字体三级：标题 / 正文 / 元信息（mono kicker）
   · 单一 accent：克莱因蓝；危险色只在真故障时出现
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
      <circle cx="16" cy="16" r="1.6" fill="var(--paper)" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

/* ── 按钮 ─────────────────────────────────────────────────────────────── */

type BtnVariant = 'solid' | 'quiet' | 'outline' | 'danger' | 'accent';
type BtnSize = 'xs' | 'sm' | 'md';

const BTN_VARIANTS: Record<BtnVariant, string> = {
  solid:
    'bg-[var(--ink)] text-[var(--paper)] hover:bg-[var(--text-secondary)]',
  quiet:
    'bg-transparent text-[var(--text-secondary)] hover:text-[var(--ink)] hover:bg-[var(--paper-3)]',
  outline:
    'bg-transparent text-[var(--ink)] border border-[var(--line-strong)] hover:border-[var(--ink)]',
  danger:
    'bg-transparent text-[var(--alert)] border border-[var(--line)] hover:border-[var(--alert)]',
  accent:
    'bg-[var(--accent)] text-[var(--accent-on)] hover:bg-[var(--accent-ink)]',
};

const BTN_SIZES: Record<BtnSize, string> = {
  xs: 'h-6 px-2 text-[11px] gap-1',
  sm: 'h-7 px-2.5 text-[11.5px] gap-1.5',
  md: 'h-9 px-4 text-[13px] gap-2',
};

export function Button({
  children,
  variant = 'quiet',
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
        'rounded-none font-medium transition-colors duration-150',
        'focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-0 focus-visible:outline-none',
        BTN_VARIANTS[variant],
        BTN_SIZES[size],
        disabled && 'pointer-events-none opacity-30',
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
          ? 'bg-[var(--accent)] text-[var(--accent-on)]'
          : 'bg-[var(--paper-2)]',
        padded && 'p-4',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** 区块标题：mono kicker + 可选右侧操作。section 之间不加线。 */
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
    <div className={cx('mb-3 flex items-baseline justify-between gap-3', className)}>
      <div className="flex min-w-0 items-baseline gap-2">
        <h2 className="kicker shrink-0">{title}</h2>
        {hint && (
          <span className="text-helper truncate text-[11px] leading-none">{hint}</span>
        )}
      </div>
      {right && <div className="flex shrink-0 items-center gap-1">{right}</div>}
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
      <div className="kicker flex items-center gap-1.5">
        <Loader2 size={10} className="spin" />
        {label}
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
      className={cx('bg-[var(--paper-3)]', compact ? 'p-3' : 'p-5')}
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
      className={cx(
        'flex flex-col items-start justify-center',
        compact ? 'py-6' : 'py-10',
      )}
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

/* ── 徽标 ─────────────────────────────────────────────────────────────── */

export type Tone = 'neutral' | 'ok' | 'warn' | 'danger' | 'accent';

const TONES: Record<Tone, string> = {
  neutral: 'text-[var(--text-helper)] bg-[var(--paper-3)]',
  ok: 'text-[var(--ok)] bg-[var(--paper-3)]',
  warn: 'text-[var(--warn)] bg-[var(--paper-3)]',
  danger: 'text-[var(--accent-on)] bg-[var(--alert)]',
  accent: 'text-[var(--accent-on)] bg-[var(--accent)]',
};

/** 瑞士风标签：直角实心色块 */
export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cx(
        'inline-flex shrink-0 items-center rounded-none px-1.5 py-[2px]',
        'font-mono text-[10px] leading-[14px] font-medium tracking-[0.02em] whitespace-nowrap',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ── 进度条：统一 2px 规格 ────────────────────────────────────────────── */

export function Meter({
  percent,
  tone = 'accent',
  height = 2,
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
      className={cx('w-full overflow-hidden bg-[var(--paper-3)]', className)}
      style={{ height }}
      role="progressbar"
      aria-valuenow={Math.round(p)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={cx('h-full transition-[width] duration-300 ease-out', bg)}
        style={{ width: `${p}%` }}
      />
    </div>
  );
}

/* ── 键值行：左标签 右数值，数值等宽右对齐 ───────────────────────────── */

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
    <div
      className={cx(
        'flex items-baseline justify-between gap-4 py-[3px]',
        className,
      )}
    >
      <span className="shrink-0 text-[11.5px] leading-tight text-[var(--text-helper)]">{k}</span>
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
      <div className="kicker truncate">{label}</div>
      <div
        className={cx(
          'num mt-1 flex items-baseline gap-1 leading-none',
          size === 'lg' ? 'text-[30px]' : 'text-[24px]',
          color,
        )}
      >
        <span className="truncate font-medium">{value}</span>
        {unit && (
          <span className="shrink-0 font-mono text-[11px] font-normal text-[var(--text-helper)]">
            {unit}
          </span>
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

/* ── 可折叠分组（温度按传感器类型分组用） ─────────────────────────────── */

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
        className="group flex w-full items-center gap-2 py-1.5 text-left transition-colors hover:bg-[var(--paper-3)]"
      >
        <ChevronDown
          size={11}
          className={cx(
            'shrink-0 text-[var(--text-helper)] transition-transform duration-200',
            !open && '-rotate-90',
          )}
        />
        <span className="kicker shrink-0 text-[var(--text-secondary)]">{title}</span>
        <span className="ml-auto flex shrink-0 items-center gap-2">{meta}</span>
      </button>
      {open && <div className="pb-2">{children}</div>}
    </div>
  );
}

/* ── 12 列网格容器 ────────────────────────────────────────────────────── */

/** design-rules: 12 列网格，gutter 20px；≤1024px 回落单列 */
export function Grid12({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('grid grid-cols-1 gap-5 lg:grid-cols-12', className)}>{children}</div>
  );
}
