import type { ReactNode } from 'react';
import { cx } from '../lib/format';
import { AlertTriangle, Inbox, Loader2, RotateCw } from 'lucide-react';


/* ---------------- 品牌标记 ---------------- */

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
      <circle cx="16" cy="16" r="9.2" stroke="currentColor" strokeWidth="1.3" opacity="0.45" />
      <circle cx="16" cy="16" r="5.6" stroke="currentColor" strokeWidth="1.1" opacity="0.7" />
      <path d="M16 6.4 L18.5 16 L16 25.6 L13.5 16 Z" fill="currentColor" />
      <path d="M6.4 16 L16 13.5 L25.6 16 L16 18.5 Z" fill="currentColor" opacity="0.5" />
      <circle cx="16" cy="16" r="1.5" fill="var(--sc-bg)" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  );
}

/* ---------------- 按钮 ---------------- */

type BtnVariant = 'default' | 'ghost' | 'primary' | 'danger' | 'subtle';
type BtnSize = 'xs' | 'sm' | 'md';

const BTN_VARIANTS: Record<BtnVariant, string> = {
  default:
    'bg-surface-2 text-fg border border-line hover:border-line-strong hover:bg-surface-2/70 active:scale-[0.99]',
  ghost: 'bg-transparent text-fg-muted hover:text-fg hover:bg-surface-2 border border-transparent',
  primary:
    'bg-accent text-accent-fg border border-transparent hover:opacity-90 active:scale-[0.99] font-medium',
  danger:
    'bg-transparent text-danger border border-line hover:border-danger/60 hover:bg-danger/10 active:scale-[0.99]',
  subtle: 'bg-surface-2 text-fg-muted hover:text-fg border border-transparent',
};

const BTN_SIZES: Record<BtnSize, string> = {
  xs: 'h-6 px-2 text-[11px] gap-1 rounded-md',
  sm: 'h-7 px-2.5 text-[12px] gap-1.5 rounded-md',
  md: 'h-8 px-3 text-[13px] gap-1.5 rounded-lg',
};

export function Button({
  children,
  variant = 'default',
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
        'inline-flex select-none items-center justify-center whitespace-nowrap transition-all duration-150',
        'focus-visible:ring-accent/50 outline-none focus-visible:ring-2',
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

/* ---------------- 卡片 / 区块 ---------------- */

export function Card({
  children,
  className,
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div
      className={cx(
        'border-line bg-surface rounded-[10px] border',
        padded && 'p-4',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SectionHead({
  title,
  right,
  hint,
}: {
  title: ReactNode;
  right?: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <div className="flex items-baseline gap-2">
        <h2 className="text-fg text-[12px] font-medium tracking-[0.02em]">{title}</h2>
        {hint && <span className="text-fg-subtle text-[11px]">{hint}</span>}
      </div>
      {right && <div className="flex shrink-0 items-center gap-1.5">{right}</div>}
    </div>
  );
}

/* ---------------- 三态 ---------------- */

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('skeleton', className)} />;
}

export function SkeletonRows({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cx('space-y-2', className)}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-8 w-full" />
      ))}
    </div>
  );
}

export function LoadingBlock({ label = '加载中', rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label={label}>
      <SkeletonRows rows={rows} />
      <div className="text-fg-subtle flex items-center gap-1.5 text-[11px]">
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
        'border-danger/30 bg-danger/5 flex flex-col items-start gap-2 rounded-lg border',
        compact ? 'p-3' : 'p-4',
      )}
      role="alert"
    >
      <div className="text-danger flex items-center gap-1.5 text-[12px] font-medium">
        <AlertTriangle size={13} />
        {message}
      </div>
      {detail && (
        <div className="text-fg-muted num max-h-24 overflow-auto text-[11px] leading-relaxed break-all">
          {detail}
        </div>
      )}
      {onRetry && (
        <Button size="xs" variant="default" onClick={onRetry}>
          <RotateCw size={11} />
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
        'border-line/70 flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-center',
        compact ? 'px-4 py-6' : 'px-6 py-10',
      )}
    >
      <Inbox size={18} className="text-fg-subtle" />
      <div className="text-fg-muted text-[12px]">{title}</div>
      {hint && <div className="text-fg-subtle max-w-sm text-[11px] leading-relaxed">{hint}</div>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

/* ---------------- 徽标 ---------------- */

export type Tone = 'neutral' | 'ok' | 'warn' | 'danger' | 'accent';

const TONES: Record<Tone, string> = {
  neutral: 'text-fg-muted bg-surface-2 border-line',
  ok: 'text-ok bg-ok/10 border-ok/25',
  warn: 'text-warn bg-warn/10 border-warn/25',
  danger: 'text-danger bg-danger/10 border-danger/25',
  accent: 'text-accent bg-accent/10 border-accent/25',
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
        'inline-flex items-center gap-1 rounded-full border px-1.5 py-[1px] text-[10.5px] leading-[16px] font-medium',
        TONES[tone],
        className,
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

/* ---------------- 进度条 ---------------- */

export function Meter({
  percent,
  tone = 'accent',
  height = 4,
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
      ? 'bg-danger'
      : tone === 'warn'
        ? 'bg-warn'
        : tone === 'ok'
          ? 'bg-ok'
          : 'bg-accent';
  return (
    <div
      className={cx('bg-surface-2 w-full overflow-hidden rounded-full', className)}
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

/* ---------------- 键值行 ---------------- */

export function KV({
  k,
  v,
  mono = true,
  muted,
}: {
  k: ReactNode;
  v: ReactNode;
  mono?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[3px]">
      <span className="text-fg-subtle shrink-0 text-[11px]">{k}</span>
      <span
        className={cx(
          'text-right text-[11.5px]',
          mono && 'num',
          muted ? 'text-fg-muted' : 'text-fg',
        )}
      >
        {v}
      </span>
    </div>
  );
}

export function Stat({
  label,
  value,
  unit,
  sub,
  tone,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  sub?: ReactNode;
  tone?: Tone;
}) {
  const color =
    tone === 'danger' ? 'text-danger' : tone === 'warn' ? 'text-warn' : tone === 'ok' ? 'text-ok' : 'text-fg';
  return (
    <div className="min-w-0">
      <div className="text-fg-subtle truncate text-[10.5px] tracking-[0.04em] uppercase">{label}</div>
      <div className={cx('num mt-0.5 flex items-baseline gap-1 text-[18px] leading-tight', color)}>
        <span className="truncate">{value}</span>
        {unit && <span className="text-fg-subtle text-[10.5px] font-normal">{unit}</span>}
      </div>
      {sub && <div className="text-fg-subtle mt-0.5 truncate text-[10.5px]">{sub}</div>}
    </div>
  );
}
