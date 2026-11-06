import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cx } from '../lib/format';

/* ══════════════════════════════════════════════════════════════════════════
   右键上下文菜单
   · fixed 定位，自动翻转到视口内
   · 键盘：↑↓ 移动、Enter 触发、Esc 关闭
   · 点击外部 / 滚动 / 窗口 resize 关闭
   ══════════════════════════════════════════════════════════════════════════ */

export interface MenuItem {
  key: string;
  label: string;
  icon?: ReactNode;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  /** 在它之前画一条分隔线 */
  dividerBefore?: boolean;
  onSelect: () => void;
}

export interface MenuState {
  x: number;
  y: number;
  items: MenuItem[];
  title?: string;
  subtitle?: string;
}

export function ContextMenu({
  state,
  onClose,
}: {
  state: MenuState | null;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [active, setActive] = useState(-1);

  useLayoutEffect(() => {
    if (!state) return;
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pad = 8;
    let x = state.x;
    let y = state.y;
    if (x + r.width > window.innerWidth - pad) x = Math.max(pad, window.innerWidth - r.width - pad);
    if (y + r.height > window.innerHeight - pad)
      y = Math.max(pad, window.innerHeight - r.height - pad);
    setPos({ x, y });
    setActive(-1);
  }, [state]);

  useEffect(() => {
    if (!state) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      const items = state.items;
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((i) => {
          let n = i;
          for (let k = 0; k < items.length; k++) {
            n = (n + 1) % items.length;
            if (!items[n]?.disabled) break;
          }
          return n;
        });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((i) => {
          let n = i < 0 ? items.length : i;
          for (let k = 0; k < items.length; k++) {
            n = (n - 1 + items.length) % items.length;
            if (!items[n]?.disabled) break;
          }
          return n;
        });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const it = items[active];
        if (it && !it.disabled) {
          onClose();
          it.onSelect();
        }
      }
    };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onClose);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('blur', onClose);
    };
  }, [state, active, onClose]);

  if (!state) return null;

  return (
    <div
      ref={ref}
      role="menu"
      className="fixed z-50 min-w-[188px] border border-[var(--line-strong)] bg-[var(--paper)] py-1"
      style={{ left: pos.x, top: pos.y }}
    >
      {state.title && (
        <div className="border-b border-[var(--line-subtle)] px-3 py-1.5">
          <div className="num truncate text-[11.5px] font-medium text-[var(--ink)]">
            {state.title}
          </div>
          {state.subtitle && (
            <div className="kicker mt-0.5 truncate">{state.subtitle}</div>
          )}
        </div>
      )}
      {state.items.map((it, i) => (
        <div key={it.key}>
          {it.dividerBefore && <div className="my-1 h-px bg-[var(--line-subtle)]" />}
          <button
            role="menuitem"
            disabled={it.disabled}
            onMouseEnter={() => setActive(i)}
            onClick={() => {
              onClose();
              it.onSelect();
            }}
            className={cx(
              'flex w-full items-center gap-2.5 px-3 py-[5px] text-left text-[12px] transition-colors',
              it.disabled
                ? 'cursor-default text-[var(--text-placeholder)]'
                : it.danger
                  ? 'text-[var(--alert)] hover:bg-[var(--paper-3)]'
                  : 'text-[var(--ink)] hover:bg-[var(--paper-3)]',
              active === i && !it.disabled && 'bg-[var(--paper-3)]',
            )}
          >
            <span className="flex w-3.5 shrink-0 items-center justify-center opacity-70">
              {it.icon}
            </span>
            <span className="flex-1 truncate">{it.label}</span>
            {it.shortcut && (
              <span className="num shrink-0 text-[9.5px] text-[var(--text-placeholder)]">
                {it.shortcut}
              </span>
            )}
          </button>
        </div>
      ))}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   通用模态框
   ══════════════════════════════════════════════════════════════════════════ */

export function Modal({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
  width = 420,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-auto bg-black/35 p-6 pt-[12vh]">
      <div
        className="w-full border border-[var(--line-strong)] bg-[var(--paper)]"
        style={{ maxWidth: width }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--line-subtle)] px-4 py-3">
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-[var(--ink)]">{title}</div>
            {subtitle && <div className="kicker mt-0.5 truncate">{subtitle}</div>}
          </div>
          <button
            onClick={onClose}
            className="-mr-1 shrink-0 px-1 text-[var(--text-helper)] transition-colors hover:text-[var(--ink)]"
            aria-label="关闭"
          >
            ✕
          </button>
        </div>
        <div className="px-4 py-3.5">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-[var(--line-subtle)] px-4 py-2.5">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   轻提示
   ══════════════════════════════════════════════════════════════════════════ */

export function Toast({
  toast,
  offset,
}: {
  toast: { kind: 'ok' | 'err'; text: string } | null;
  offset?: boolean;
}) {
  if (!toast) return null;
  return (
    <div
      className={cx(
        'fade-in fixed right-5 z-[70] border px-3 py-2 text-[11.5px]',
        offset ? 'bottom-[88px]' : 'bottom-5',
        toast.kind === 'ok'
          ? 'border-[var(--ok)]/40 bg-[var(--paper)] text-[var(--ok)]'
          : 'border-[var(--alert)]/50 bg-[var(--paper)] text-[var(--alert)]',
      )}
      role="status"
    >
      {toast.text}
    </div>
  );
}
