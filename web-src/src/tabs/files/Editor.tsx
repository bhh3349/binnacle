import { useEffect, useRef } from 'react';
import { cx, fmtBytes } from '../../lib/format';
import type { DuNode } from '../../lib/types';
import { Badge, Button, ErrorState, LoadingBlock } from '../../components/ui';
import { FileCode, Loader2, X } from 'lucide-react';

/* ══════════════════════════════════════════════════════════════════════════
   在线编辑器（纯 textarea，无语法高亮）
   ══════════════════════════════════════════════════════════════════════════ */

export interface EditorState {
  path: string;
  content: string;
  original: string;
  loading: boolean;
  error: string | null;
  saving: boolean;
  saveError: string | null;
}

export function Editor({
  state,
  onClose,
  onChange,
  onSave,
}: {
  state: EditorState;
  onClose: () => void;
  onChange: (v: string) => void;
  onSave: () => void;
}) {
  const dirty = state.content !== state.original;
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (dirty && !state.saving) onSave();
      }
      if (e.key === 'Escape' && !dirty) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dirty, state.saving, onSave, onClose]);

  const lines = state.content.split('\n').length;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden border border-[var(--line)] bg-[var(--paper)]">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--line)] bg-[var(--paper-2)] px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <FileCode size={12} className="shrink-0 text-[var(--text-helper)]" />
          <span className="num truncate text-[11.5px]">{state.path}</span>
          {dirty && <Badge tone="warn">未保存</Badge>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <span className="num mr-1 text-[10.5px] text-[var(--text-helper)]">{lines} 行</span>
          <Button size="xs" variant="accent" disabled={!dirty || state.saving} onClick={onSave}>
            {state.saving ? <Loader2 size={10} className="spin" /> : null}
            {state.saving ? '保存中' : '保存'}
          </Button>
          <Button size="xs" variant="quiet" onClick={onClose} title="关闭">
            <X size={11} />
          </Button>
        </div>
      </div>
      {state.loading ? (
        <div className="p-3">
          <LoadingBlock label="读取文件" rows={6} />
        </div>
      ) : state.error ? (
        <div className="p-3">
          <ErrorState compact message="无法打开文件" detail={state.error} />
        </div>
      ) : (
        <>
          {state.saveError && (
            <div className="shrink-0 border-b border-[var(--alert)]/40 bg-[var(--alert)]/5 px-3 py-1 text-[11px] text-[var(--alert)]">
              保存失败：{state.saveError}
            </div>
          )}
          <textarea
            ref={taRef}
            spellCheck={false}
            value={state.content}
            onChange={(e) => onChange(e.target.value)}
            className="num min-h-0 w-full flex-1 resize-none bg-transparent p-3 text-[12px] leading-[1.6] text-[var(--ink)] outline-none placeholder:text-[var(--text-helper)]"
            placeholder="（空文件）"
          />
        </>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   目录占用排行
   ══════════════════════════════════════════════════════════════════════════ */

export function Treemap({
  nodes,
  onOpen,
}: {
  nodes: DuNode[];
  onOpen: (path: string) => void;
}) {
  const top = nodes.filter((n) => n.size > 0).slice(0, 24);
  const max = top[0]?.size ?? 1;
  return (
    <div className="space-y-[3px]">
      {top.map((n, i) => {
        const pct = (n.size / max) * 100;
        return (
          <button
            key={n.path}
            onClick={() => onOpen(n.path)}
            className="group flex w-full items-center gap-2 px-1 py-[2px] text-left transition-colors hover:bg-[var(--paper-3)]"
            title={`${n.path}\n${fmtBytes(n.size)}${n.isDir ? ` · ${n.count} 项` : ''}`}
          >
            <span className="num w-4 shrink-0 text-right text-[9.5px] text-[var(--text-helper)]">
              {i + 1}
            </span>
            <span className="num w-[110px] shrink-0 truncate text-[11px] text-[var(--text-secondary)]">
              {n.name}
            </span>
            <span className="relative h-[10px] min-w-0 flex-1 overflow-hidden bg-[var(--paper-3)]">
              <span
                className={cx(
                  'absolute inset-y-0 left-0 transition-[width] duration-300',
                  n.isDir ? 'bg-[var(--accent)]/55' : 'bg-[var(--accent)]/30',
                )}
                style={{ width: `${Math.max(pct, 1.5)}%` }}
              />
            </span>
            <span className="num w-[64px] shrink-0 text-right text-[10px] text-[var(--text-helper)]">
              {fmtBytes(n.size)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
