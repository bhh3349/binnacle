import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import type { FsEntry, FsStatResponse } from '../../lib/types';
import { baseName, fmtBytes } from '../../lib/format';
import { Button, ErrorState, KV, LoadingBlock } from '../../components/ui';
import { X, RefreshCw, Clipboard } from 'lucide-react';

/* ══════════════════════════════════════════════════════════════════════════
   文件详情侧栏 — 走 GET /api/fs/stat
   md5 对大文件要算几秒，加载时显示「计算中」
   ══════════════════════════════════════════════════════════════════════════ */

function fmtDate(v?: string): string {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleString('zh-CN', { hour12: false });
}

export function DetailsPanel({
  entry,
  onClose,
}: {
  entry: FsEntry | null;
  onClose: () => void;
}) {
  const [stat, setStat] = useState<FsStatResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [md5Pending, setMd5Pending] = useState(false);

  useEffect(() => {
    if (!entry) return;
    let cancelled = false;
    setLoading(true);
    setErr(null);
    setStat(null);
    setMd5Pending(!entry.isDir);
    api
      .fsStat(entry.path)
      .then((r) => {
        if (cancelled) return;
        setStat(r);
        setMd5Pending(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : '读取属性失败');
        setMd5Pending(false);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [entry]);

  if (!entry) return null;

  return (
    <div className="flex min-h-0 flex-col border border-[var(--line)] bg-[var(--paper-2)]">
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--line)] px-3 py-1.5">
        <span className="kicker flex-1">详情</span>
        <button
          onClick={() => {
            void navigator.clipboard?.writeText(entry.path);
          }}
          className="text-[var(--text-helper)] transition-colors hover:text-[var(--ink)]"
          title="复制路径"
        >
          <Clipboard size={11} />
        </button>
        <button
          onClick={onClose}
          className="text-[var(--text-helper)] transition-colors hover:text-[var(--ink)]"
          title="关闭"
        >
          <X size={11} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
        {loading ? (
          <LoadingBlock label="读取属性" rows={6} />
        ) : err ? (
          <ErrorState
            compact
            message="读取属性失败"
            detail={err}
            onRetry={() => {
              setErr(null);
              setLoading(true);
              api
                .fsStat(entry.path)
                .then(setStat)
                .catch((e: unknown) => setErr(e instanceof Error ? e.message : '失败'))
                .finally(() => setLoading(false));
            }}
          />
        ) : stat ? (
          <>
            <div className="num mb-2 truncate text-[12px] font-medium text-[var(--ink)]">
              {baseName(stat.path)}
            </div>
            <KV k="类型" v={stat.isDir ? '目录' : '文件'} />
            <KV k="大小" v={stat.isDir ? '—' : fmtBytes(stat.size)} />
            <KV k="权限" v={`${stat.modeOct}  ${stat.mode}`} />
            <KV k="属主" v={stat.uid ?? '—'} />
            {stat.gid && <KV k="属组" v={stat.gid} />}
            <KV k="inode" v={stat.inode != null ? String(stat.inode) : '—'} />
            <KV k="硬链接" v={stat.nlink != null ? String(stat.nlink) : '—'} />
            <div className="my-2 h-px bg-[var(--line)]" />
            <KV k="修改" v={fmtDate(stat.mtime)} />
            <KV k="访问" v={fmtDate(stat.atime)} />
            <KV k="变更" v={fmtDate(stat.ctime)} />
            {!stat.isDir && (
              <>
                <div className="my-2 h-px bg-[var(--line)]" />
                <div className="kicker mb-1">MD5</div>
                {md5Pending && !stat.md5 ? (
                  <div className="flex items-center gap-1.5 text-[10.5px] text-[var(--text-helper)]">
                    <RefreshCw size={10} className="spin" />
                    计算中（大文件需要几秒）
                  </div>
                ) : (
                  <div className="num break-all text-[10.5px] text-[var(--text-secondary)]">
                    {stat.md5 ?? '—'}
                  </div>
                )}
              </>
            )}
            <div className="mt-3 border-t border-[var(--line)] pt-2">
              <div className="kicker mb-1">完整路径</div>
              <div className="num break-all text-[10.5px] text-[var(--text-secondary)]">
                {stat.path}
              </div>
            </div>
          </>
        ) : null}
      </div>

      <div className="shrink-0 border-t border-[var(--line)] p-2">
        <Button
          size="xs"
          variant="outline"
          className="w-full"
          onClick={() => {
            setStat(null);
            setLoading(true);
            setErr(null);
            api
              .fsStat(entry.path)
              .then(setStat)
              .catch((e: unknown) => setErr(e instanceof Error ? e.message : '失败'))
              .finally(() => setLoading(false));
          }}
        >
          <RefreshCw size={10} />
          重新读取
        </Button>
      </div>
    </div>
  );
}
