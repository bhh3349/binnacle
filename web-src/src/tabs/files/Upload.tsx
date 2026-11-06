import { useCallback, useRef, useState } from 'react';
import { api, type UploadProgress } from '../../lib/api';
import { fmtBytes, joinPath } from '../../lib/format';
import { X, Check, AlertTriangle, Loader2 } from 'lucide-react';

/* ══════════════════════════════════════════════════════════════════════════
   上传队列
   · 串行上传，逐个显示进度 / 速度
   · 支持取消单个任务（AbortController）
   ══════════════════════════════════════════════════════════════════════════ */

export interface UploadTask {
  id: string;
  name: string;
  size: number;
  loaded: number;
  percent: number;
  speed: number;
  status: 'pending' | 'uploading' | 'done' | 'error' | 'canceled';
  error?: string;
}

let seq = 0;

export function useUploadQueue(onDone: () => void) {
  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const aborters = useRef(new Map<string, AbortController>());
  const running = useRef(false);

  const patch = useCallback((id: string, p: Partial<UploadTask>) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...p } : t)));
  }, []);

  const cancel = useCallback((id: string) => {
    const a = aborters.current.get(id);
    if (a) a.abort();
    else setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status: 'canceled' } : t)));
  }, []);

  const clearFinished = useCallback(() => {
    setTasks((prev) => prev.filter((t) => t.status === 'uploading' || t.status === 'pending'));
  }, []);

  const enqueue = useCallback(
    async (dir: string, files: File[]) => {
      if (files.length === 0) return;
      const created: UploadTask[] = files.map((f) => ({
        id: `u${++seq}`,
        name: f.name,
        size: f.size,
        loaded: 0,
        percent: 0,
        speed: 0,
        status: 'pending',
      }));
      setTasks((prev) => [...prev, ...created]);

      // 串行，避免打满带宽也便于观察进度
      if (running.current) return;
      running.current = true;
      try {
        for (let i = 0; i < files.length; i++) {
          const file = files[i]!;
          const task = created[i]!;
          if (aborters.current.has(task.id) === false && task.status === 'canceled') continue;

          const ac = new AbortController();
          aborters.current.set(task.id, ac);
          patch(task.id, { status: 'uploading' });

          try {
            await api.fsUpload(joinPath(dir, file.name), file, {
              signal: ac.signal,
              onProgress: (p: UploadProgress) =>
                patch(task.id, {
                  loaded: p.loaded,
                  percent: p.percent,
                  speed: p.speed,
                }),
            });
            patch(task.id, { status: 'done', percent: 100, loaded: file.size });
          } catch (e) {
            const aborted =
              e instanceof DOMException && e.name === 'AbortError';
            patch(task.id, {
              status: aborted ? 'canceled' : 'error',
              error: aborted ? undefined : e instanceof Error ? e.message : '上传失败',
            });
          } finally {
            aborters.current.delete(task.id);
          }
        }
      } finally {
        running.current = false;
        onDone();
      }
    },
    [onDone, patch],
  );

  return { tasks, enqueue, cancel, clearFinished };
}

/* ── 进度面板 ─────────────────────────────────────────────────────────── */

export function UploadPanel({
  tasks,
  onCancel,
  onClear,
}: {
  tasks: UploadTask[];
  onCancel: (id: string) => void;
  onClear: () => void;
}) {
  if (tasks.length === 0) return null;
  const active = tasks.filter((t) => t.status === 'uploading' || t.status === 'pending');
  const finished = tasks.length - active.length;

  return (
    <div className="fixed right-5 bottom-5 z-[65] w-[300px] border border-[var(--line-strong)] bg-[var(--paper)]">
      <div className="flex items-center gap-2 border-b border-[var(--line-subtle)] px-3 py-1.5">
        <span className="kicker flex-1">
          上传 {active.length > 0 ? `${active.length} 进行中` : '完成'}
          {finished > 0 && ` · ${finished} 已完成`}
        </span>
        {active.length === 0 && (
          <button
            onClick={onClear}
            className="text-[var(--text-helper)] transition-colors hover:text-[var(--ink)]"
            title="清空列表"
          >
            <X size={12} />
          </button>
        )}
      </div>
      <div className="max-h-[240px] overflow-auto">
        {tasks.map((t) => (
          <div key={t.id} className="border-b border-[var(--line-subtle)] px-3 py-1.5 last:border-0">
            <div className="flex items-center gap-1.5">
              <span className="shrink-0">
                {t.status === 'done' ? (
                  <Check size={11} className="text-[var(--ok)]" />
                ) : t.status === 'error' ? (
                  <AlertTriangle size={11} className="text-[var(--alert)]" />
                ) : t.status === 'canceled' ? (
                  <X size={11} className="text-[var(--text-placeholder)]" />
                ) : t.status === 'uploading' ? (
                  <Loader2 size={11} className="spin text-[var(--accent)]" />
                ) : (
                  <span className="block h-[11px] w-[11px] bg-[var(--paper-3)]" />
                )}
              </span>
              <span className="num min-w-0 flex-1 truncate text-[11px] text-[var(--ink)]">
                {t.name}
              </span>
              {(t.status === 'uploading' || t.status === 'pending') && (
                <button
                  onClick={() => onCancel(t.id)}
                  className="shrink-0 text-[var(--text-placeholder)] transition-colors hover:text-[var(--alert)]"
                  title="取消"
                >
                  <X size={11} />
                </button>
              )}
            </div>
            {t.status === 'error' && (
              <div className="mt-0.5 text-[10px] text-[var(--alert)]">{t.error}</div>
            )}
            <div className="mt-1 flex items-center gap-2">
              <div className="h-[2px] min-w-0 flex-1 bg-[var(--paper-3)]">
                <div
                  className={
                    t.status === 'error'
                      ? 'h-full bg-[var(--alert)]'
                      : t.status === 'done'
                        ? 'h-full bg-[var(--ok)]'
                        : 'h-full bg-[var(--accent)]'
                  }
                  style={{ width: `${t.percent}%` }}
                />
              </div>
              <span className="num shrink-0 text-[9.5px] text-[var(--text-placeholder)]">
                {fmtBytes(t.loaded)} / {fmtBytes(t.size)}
              </span>
            </div>
            {t.status === 'uploading' && t.speed > 0 && (
              <div className="num mt-0.5 text-[9.5px] text-[var(--text-placeholder)]">
                {fmtBytes(t.speed)}/s
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
