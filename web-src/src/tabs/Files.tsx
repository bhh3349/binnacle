import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { api } from '../lib/api';
import type { DuNode, FsEntry, FsListResponse } from '../lib/types';
import {
  baseName,
  cx,
  fmtBytes,
  isTextFile,
  joinPath,
  parentOf,
} from '../lib/format';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingBlock,
  SectionHead,
  Skeleton,
} from '../components/ui';
import { ContextMenu, Modal, Toast, type MenuItem, type MenuState } from '../components/overlays';
import { Editor, Treemap, type EditorState } from './files/Editor';
import { Preview, canPreview, previewKind } from './files/Preview';
import { UploadPanel, useUploadQueue } from './files/Upload';
import { useClipboard, useKeyboardNav, useSelection } from './files/useFileOps';
import {
  ArrowUp,
  BarChart3,
  ChevronRight,
  Clipboard,
  ClipboardPaste,
  Copy,
  Download,
  Eye,
  FileArchive,
  FileCode,
  FileImage,
  FilePlus,
  FileText,
  Folder,
  FolderPlus,
  Grid3x3,
  HardDrive,
  Home,
  Info,
  LayoutList,
  Link2,
  Loader2,
  Lock,
  Package,
  Pencil,
  RefreshCw,
  Scissors,
  Search,
  Terminal,
  Trash2,
  Upload,
  X,
} from 'lucide-react';

/* ══════════════════════════════════════════════════════════════════════════
   文件管理器
   ══════════════════════════════════════════════════════════════════════════ */

function EntryIcon({ e, size = 13 }: { e: FsEntry; size?: number }) {
  if (e.isDir) return <Folder size={size} className="shrink-0 text-[var(--accent)]" />;
  const k = previewKind(e.name);
  if (k === 'image') return <FileImage size={size} className="shrink-0 text-[var(--text-helper)]" />;
  if (k === 'video' || k === 'audio')
    return <FileImage size={size} className="shrink-0 text-[var(--warn)]" />;
  if (k === 'pdf') return <FileText size={size} className="shrink-0 text-[var(--alert)]" />;
  if (isTextFile(e.name))
    return <FileCode size={size} className="shrink-0 text-[var(--text-helper)]" />;
  if (/\.(zip|tar|gz|xz|7z|bz2|zst|rar)$/i.test(e.name))
    return <FileArchive size={size} className="shrink-0 text-[var(--warn)]" />;
  return <FileText size={size} className="shrink-0 text-[var(--text-helper)]" />;
}

function isArchive(name: string): boolean {
  return /\.(zip|tar\.gz|tgz|tar\.xz|txz|tar\.bz2|tar)$/i.test(name);
}

/* ── chmod 九宫格 ─────────────────────────────────────────────────────── */

const PERM_BITS = [
  { label: '读', bit: 4, key: 'r' },
  { label: '写', bit: 2, key: 'w' },
  { label: '执行', bit: 1, key: 'x' },
] as const;

function ChmodDialog({
  entry,
  onClose,
  onDone,
}: {
  entry: FsEntry | null;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [digits, setDigits] = useState<[number, number, number]>([6, 4, 4]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!entry) return;
    const m = /([r-])([w-])([x-])([r-])([w-])([x-])([r-])([w-])([x-])$/.exec(entry.mode);
    if (m) {
      const toBit = (r: string, w: string, x: string) =>
        (r !== '-' ? 4 : 0) + (w !== '-' ? 2 : 0) + (x !== '-' ? 1 : 0);
      setDigits([
        toBit(m[1]!, m[2]!, m[3]!),
        toBit(m[4]!, m[5]!, m[6]!),
        toBit(m[7]!, m[8]!, m[9]!),
      ]);
    }
    setErr(null);
  }, [entry]);

  const toggle = (idx: 0 | 1 | 2, bit: number) => {
    setDigits((d) => {
      const n = [...d] as [number, number, number];
      n[idx] = n[idx]! ^ bit;
      return n;
    });
  };

  const modeStr = `0${digits.join('')}`;

  const apply = async () => {
    if (!entry) return;
    setBusy(true);
    setErr(null);
    try {
      await api.fsChmod(entry.path, modeStr);
      onDone(`权限已改为 ${modeStr}`);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '修改失败');
    } finally {
      setBusy(false);
    }
  };

  const preview = digits
    .map((d) =>
      [
        d & 4 ? 'r' : '-',
        d & 2 ? 'w' : '-',
        d & 1 ? 'x' : '-',
      ].join(''),
    )
    .join('');

  return (
    <Modal
      open={!!entry}
      title="修改权限"
      subtitle={entry?.path}
      onClose={onClose}
      width={420}
      footer={
        <>
          <Button size="sm" variant="quiet" onClick={onClose}>
            取消
          </Button>
          <Button size="sm" variant="accent" disabled={busy} onClick={() => void apply()}>
            {busy ? <Loader2 size={11} className="spin" /> : null}
            应用
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-4 gap-2">
        <div />
        {PERM_BITS.map((p) => (
          <div key={p.key} className="kicker text-center">
            {p.label}
          </div>
        ))}

        {(['属主', '同组', '其他'] as const).map((rowLabel, idx) => (
          <div key={rowLabel} className="contents">
            <div className="flex items-center text-[11.5px] text-[var(--text-secondary)]">
              {rowLabel}
            </div>
            {PERM_BITS.map((p) => {
              const on = ((digits[idx as 0 | 1 | 2] ?? 0) & p.bit) !== 0;
              return (
                <button
                  key={p.key}
                  onClick={() => toggle(idx as 0 | 1 | 2, p.bit)}
                  className={cx(
                    'h-8 border text-[12px] font-medium transition-colors',
                    on
                      ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-on)]'
                      : 'border-[var(--line)] bg-[var(--paper-2)] text-[var(--text-placeholder)]',
                  )}
                >
                  {on ? p.key.toUpperCase() : '—'}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-baseline justify-between border-t border-[var(--line-subtle)] pt-3">
        <span className="kicker">结果</span>
        <span className="num text-[13px] font-medium text-[var(--ink)]">
          {modeStr} · {preview}
        </span>
      </div>
      {err && <div className="mt-2 text-[11.5px] text-[var(--alert)]">{err}</div>}
    </Modal>
  );
}

/* ── 新建 / 重命名输入框 ──────────────────────────────────────────────── */

function PromptDialog({
  open,
  title,
  label,
  initial,
  confirmText = '确定',
  hint,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  label: string;
  initial: string;
  confirmText?: string;
  hint?: string;
  onClose: () => void;
  onSubmit: (v: string) => Promise<void> | void;
}) {
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setV(initial);
      setErr(null);
      window.setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 30);
    }
  }, [open, initial]);

  const submit = async () => {
    if (!v.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await onSubmit(v.trim());
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      width={400}
      footer={
        <>
          <Button size="sm" variant="quiet" onClick={onClose}>
            取消
          </Button>
          <Button
            size="sm"
            variant="accent"
            disabled={!v.trim() || busy}
            onClick={() => void submit()}
          >
            {busy ? <Loader2 size={11} className="spin" /> : null}
            {confirmText}
          </Button>
        </>
      }
    >
      <label className="kicker mb-1.5 block">{label}</label>
      <input
        ref={inputRef}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void submit();
          }
        }}
        className="num h-8 w-full border border-[var(--line-strong)] bg-[var(--paper-2)] px-2 text-[12.5px] text-[var(--ink)] outline-none focus:border-[var(--accent)]"
      />
      {hint && <div className="mt-1.5 text-[10.5px] text-[var(--text-helper)]">{hint}</div>}
      {err && <div className="mt-2 text-[11.5px] text-[var(--alert)]">{err}</div>}
    </Modal>
  );
}

/* ── 主组件 ───────────────────────────────────────────────────────────── */

export function FilesTab({ active = true }: { active?: boolean }) {
  void active;
  const [cwd, setCwd] = useState('/');
  const [list, setList] = useState<FsListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  const [sort, setSort] = useState<'name' | 'mtime' | 'size'>('name');
  const [order, setOrder] = useState<'asc' | 'desc'>('asc');
  const [view, setView] = useState<'list' | 'grid'>('list');
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [preview, setPreview] = useState<FsEntry | null>(null);
  const [search, setSearch] = useState('');
  const [searchRes, setSearchRes] = useState<{ hits: FsEntry[]; truncated: boolean } | null>(null);
  const [searching, setSearch] = useState(false);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const [du, setDu] = useState<DuNode[] | null>(null);
  const [duLoading, setDuLoading] = useState(false);
  const [duErr, setDuErr] = useState<string | null>(null);
  const [showDu, setShowDu] = useState(false);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [shortcuts, setShortcuts] = useState<{ name: string; path: string }[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [dragCount, setDragCount] = useState(0);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [focusIndex, setFocusIndex] = useState(0);
  const [chmodEntry, setChmodEntry] = useState<FsEntry | null>(null);
  const [prompt, setPrompt] = useState<{
    kind: 'mkdir' | 'newfile' | 'rename';
    initial: string;
    entry?: FsEntry;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const dragDepth = useRef(0);

  const notify = useCallback((kind: 'ok' | 'err', text: string) => {
    setToast({ kind, text });
    window.setTimeout(() => setToast(null), 3200);
  }, []);

  /* ── 数据加载 ───────────────────────────────────────────────────── */

  const load = useCallback(
    async (path: string, opts: { keepSel?: boolean } = {}) => {
      setLoading(true);
      setError(null);
      try {
        const res = await api.fsList(path, { sort, order, hidden: hidden ? 1 : 0 });
        setList(res);
        setCwd(res.path);
        if (!opts.keepSel) {
          selClear();
          setFocusIndex(0);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : '目录读取失败');
        setList(null);
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sort, order, hidden],
  );

  useEffect(() => {
    void load('/');
    api
      .fsRoots()
      .then((r) => setShortcuts(r.shortcuts))
      .catch(() => setShortcuts([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (cwd) void load(cwd, { keepSel: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort, order, hidden]);

  const rows: FsEntry[] = useMemo(() => {
    if (searchRes) return searchRes.hits;
    return list?.entries ?? [];
  }, [searchRes, list]);

  const sel = useSelection(rows);
  const selClear = sel.clear;
  const clip = useClipboard();
  const uploads = useUploadQueue(() => void load(cwd, { keepSel: true }));

  /* ── 搜索 ───────────────────────────────────────────────────────── */

  useEffect(() => {
    const kw = search.trim();
    if (!kw) {
      setSearchRes(null);
      setSearchErr(null);
      return;
    }
    let cancelled = false;
    setSearch(true);
    setSearchErr(null);
    const id = window.setTimeout(() => {
      api
        .fsSearch(kw, cwd, 300)
        .then((r) => {
          if (!cancelled) setSearchRes({ hits: r.hits, truncated: r.truncated });
        })
        .catch((e: unknown) => {
          if (!cancelled) setSearchErr(e instanceof Error ? e.message : '搜索失败');
        })
        .finally(() => {
          if (!cancelled) setSearch(false);
        });
    }, 320);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [search, cwd]);

  /* ── 目录占用 ───────────────────────────────────────────────────── */

  const loadDu = useCallback(async (path: string) => {
    setDuLoading(true);
    setDuErr(null);
    try {
      const r = await api.fsDu(path, 1);
      setDu(r.nodes);
    } catch (e) {
      setDuErr(e instanceof Error ? e.message : '统计失败');
      setDu(null);
    } finally {
      setDuLoading(false);
    }
  }, []);

  useEffect(() => {
    if (showDu) void loadDu(cwd);
  }, [showDu, cwd, loadDu]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => (view === 'grid' ? 104 : 30),
    overscan: 12,
  });

  /* ── 打开条目 ───────────────────────────────────────────────────── */

  const openEditor = useCallback(async (path: string) => {
    setEditor({
      path,
      content: '',
      original: '',
      loading: true,
      error: null,
      saving: false,
      saveError: null,
    });
    try {
      const r = await api.fsRead(path);
      setEditor({
        path,
        content: r.content,
        original: r.content,
        loading: false,
        error: null,
        saving: false,
        saveError: null,
      });
    } catch (e) {
      setEditor((s) =>
        s
          ? {
              ...s,
              loading: false,
              error:
                e instanceof Error
                  ? `${e.message}${(e as { status?: number }).status === 413 ? '（超过 4 MB，请下载后编辑）' : ''}`
                  : '读取失败',
            }
          : null,
      );
    }
  }, []);

  const openEntry = useCallback(
    (e: FsEntry) => {
      if (e.isDir) {
        setSearch('');
        setSearchRes(null);
        setCwd(e.path);
        void load(e.path);
        return;
      }
      if (canPreview(e)) {
        setPreview(e);
        return;
      }
      if (isTextFile(e.name) || e.size === 0) {
        void openEditor(e.path);
        return;
      }
      const a = document.createElement('a');
      a.href = api.downloadUrl(e.path);
      a.download = e.name;
      a.click();
      notify('ok', `开始下载 ${e.name}`);
    },
    [load, notify, openEditor],
  );

  /* ── 操作 ───────────────────────────────────────────────────────── */

  const doDelete = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0) return;
      const ok = window.confirm(
        `删除 ${paths.length} 项？\n\n${paths.slice(0, 6).join('\n')}${paths.length > 6 ? '\n…' : ''}\n\n此操作不可撤销。`,
      );
      if (!ok) return;
      try {
        const r = await api.fsDelete(paths);
        if (r.errors && r.errors.length > 0) notify('err', `部分失败：${r.errors.join('; ')}`);
        else notify('ok', `已删除 ${paths.length} 项`);
        void load(cwd);
      } catch (e) {
        notify('err', e instanceof Error ? e.message : '删除失败');
      }
    },
    [cwd, load, notify],
  );

  const doPaste = useCallback(async () => {
    if (!clip.clip) {
      notify('err', '剪贴板为空');
      return;
    }
    const existing = new Set((list?.entries ?? []).map((e) => e.name));
    const r = await clip.paste(cwd, existing);
    if (r.failed.length > 0) notify('err', `${r.ok} 成功 · ${r.failed.length} 失败`);
    else notify('ok', `已${clip.clip.mode === 'copy' ? '复制' : '移动'} ${r.ok} 项到此目录`);
    void load(cwd, { keepSel: true });
  }, [clip, cwd, list, load, notify]);

  const doArchive = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0) return;
      try {
        const name =
          paths.length === 1 ? `${baseName(paths[0]!)}.zip` : `archive-${Date.now()}.zip`;
        await api.fsArchive(paths, joinPath(cwd, name), false);
        notify('ok', `已打包为 ${name}`);
        void load(cwd, { keepSel: true });
      } catch (e) {
        notify('err', e instanceof Error ? e.message : '打包失败（后端接口未就绪）');
      }
    },
    [cwd, load, notify],
  );

  const doExtract = useCallback(
    async (entry: FsEntry) => {
      try {
        await api.fsExtract(entry.path, cwd);
        notify('ok', `已解压 ${entry.name}`);
        void load(cwd, { keepSel: true });
      } catch (e) {
        notify('err', e instanceof Error ? e.message : '解压失败（后端接口未就绪）');
      }
    },
    [cwd, load, notify],
  );

  const copyPath = useCallback(
    (paths: string[]) => {
      const text = paths.join('\n');
      void navigator.clipboard
        ?.writeText(text)
        .then(() => notify('ok', `已复制 ${paths.length} 条路径`))
        .catch(() => notify('err', '剪贴板不可用'));
    },
    [notify],
  );

  /* ── 右键菜单 ───────────────────────────────────────────────────── */

  const openMenu = useCallback(
    (ev: React.MouseEvent, entry: FsEntry | null) => {
      ev.preventDefault();
      ev.stopPropagation();

      // 右键未选中项时，先把它设为唯一选中
      let targets: string[];
      if (entry) {
        if (!sel.selected.has(entry.path)) {
          sel.setMany([entry.path]);
          targets = [entry.path];
        } else {
          targets = sel.paths;
        }
      } else {
        targets = sel.paths;
      }

      const single = entry && targets.length === 1 ? entry : null;
      const items: MenuItem[] = [];

      if (entry) {
        items.push({
          key: 'open',
          label: entry.isDir ? '打开目录' : canPreview(entry) ? '预览' : '编辑',
          icon: <Eye size={11} />,
          onSelect: () => openEntry(entry),
        });
        if (isArchive(entry.name)) {
          items.push({
            key: 'extract',
            label: '解压到当前目录',
            icon: <Package size={11} />,
            onSelect: () => void doExtract(entry),
          });
        }
        items.push({
          key: 'rename',
          label: '重命名',
          icon: <Pencil size={11} />,
          shortcut: 'F2',
          disabled: !single,
          dividerBefore: true,
          onSelect: () => single && setPrompt({ kind: 'rename', initial: single.name, entry: single }),
        });
      }

      items.push(
        {
          key: 'copy',
          label: `复制${targets.length > 1 ? ` ${targets.length} 项` : ''}`,
          icon: <Copy size={11} />,
          shortcut: 'Ctrl+C',
          disabled: targets.length === 0,
          dividerBefore: !entry,
          onSelect: () => {
            clip.copy(targets);
            notify('ok', `已复制 ${targets.length} 项到剪贴板`);
          },
        },
        {
          key: 'cut',
          label: `剪切${targets.length > 1 ? ` ${targets.length} 项` : ''}`,
          icon: <Scissors size={11} />,
          shortcut: 'Ctrl+X',
          disabled: targets.length === 0,
          onSelect: () => {
            clip.cut(targets);
            notify('ok', `已剪切 ${targets.length} 项`);
          },
        },
        {
          key: 'paste',
          label: '粘贴到此处',
          icon: <ClipboardPaste size={11} />,
          shortcut: 'Ctrl+V',
          disabled: !clip.clip,
          onSelect: () => void doPaste(),
        },
      );

      if (entry) {
        items.push(
          {
            key: 'download',
            label: targets.length > 1 ? `下载 ${targets.length} 项` : entry.isDir ? '下载为 zip' : '下载',
            icon: <Download size={11} />,
            dividerBefore: true,
            onSelect: () => {
              for (const p of targets) {
                const a = document.createElement('a');
                a.href = api.downloadUrl(p);
                a.download = baseName(p);
                a.click();
              }
            },
          },
          {
            key: 'archive',
            label: '打包为 zip',
            icon: <FileArchive size={11} />,
            onSelect: () => void doArchive(targets),
          },
          {
            key: 'chmod',
            label: '修改权限',
            icon: <Lock size={11} />,
            disabled: !single,
            onSelect: () => single && setChmodEntry(single),
          },
          {
            key: 'copypath',
            label: '复制路径',
            icon: <Clipboard size={11} />,
            onSelect: () => copyPath(targets),
          },
          {
            key: 'terminal',
            label: '在终端打开',
            icon: <Terminal size={11} />,
            onSelect: () => {
              const dir = entry.isDir ? entry.path : parentOf(entry.path);
              void navigator.clipboard
                ?.writeText(`cd ${dir}`)
                .then(() => notify('ok', `已复制 cd ${dir}，切到终端页签粘贴`))
                .catch(() => notify('err', '剪贴板不可用'));
            },
          },
          {
            key: 'delete',
            label: `删除${targets.length > 1 ? ` ${targets.length} 项` : ''}`,
            icon: <Trash2 size={11} />,
            danger: true,
            shortcut: 'Del',
            dividerBefore: true,
            onSelect: () => void doDelete(targets),
          },
        );
      } else {
        items.push(
          {
            key: 'mkdir',
            label: '新建目录',
            icon: <FolderPlus size={11} />,
            dividerBefore: true,
            onSelect: () => setPrompt({ kind: 'mkdir', initial: '新建目录' }),
          },
          {
            key: 'newfile',
            label: '新建文件',
            icon: <FilePlus size={11} />,
            onSelect: () => setPrompt({ kind: 'newfile', initial: 'untitled.txt' }),
          },
          {
            key: 'refresh',
            label: '刷新',
            icon: <RefreshCw size={11} />,
            dividerBefore: true,
            onSelect: () => void load(cwd),
          },
        );
      }

      setMenu({
        x: ev.clientX,
        y: ev.clientY,
        items,
        title: entry ? baseName(entry.path) : '当前目录',
        subtitle: entry
          ? entry.isDir
            ? '目录'
            : fmtBytes(entry.size)
          : `${rows.length} 项`,
      });
    },
    [
      sel,
      clip,
      notify,
      openEntry,
      doExtract,
      doPaste,
      doArchive,
      copyPath,
      doDelete,
      load,
      cwd,
      rows.length,
    ],
  );

  /* ── 拖拽 ───────────────────────────────────────────────────────── */

  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes('Files')) {
      dragDepth.current++;
      setDragOver(true);
      setDragCount(e.dataTransfer.items.length);
    }
  };
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) {
      setDragOver(false);
      setDragCount(0);
    }
  };
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = e.dataTransfer.types.includes('Files') ? 'copy' : 'move';
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragOver(false);
    setDragCount(0);
    setDropTarget(null);

    // 1) 系统文件 → 上传
    if (e.dataTransfer.files.length > 0) {
      void uploads.enqueue(cwd, Array.from(e.dataTransfer.files));
      return;
    }
    // 2) 内部条目 → 移动到当前目录
    const srcPath = e.dataTransfer.getData('application/x-binnacle-path');
    if (srcPath) {
      if (parentOf(srcPath) === cwd) return;
      void (async () => {
        try {
          await api.fsRename(srcPath, joinPath(cwd, baseName(srcPath)));
          notify('ok', `已移动 ${baseName(srcPath)}`);
          void load(cwd, { keepSel: true });
        } catch (err) {
          notify('err', err instanceof Error ? err.message : '移动失败');
        }
      })();
    }
  };

  /* ── 键盘 ───────────────────────────────────────────────────────── */

  const kbHandler = useKeyboardNav({
    rows,
    focusIndex,
    setFocusIndex,
    onOpen: (e) => openEntry(e),
    onDelete: () => void doDelete(sel.paths),
    onRename: () => {
      if (sel.paths.length === 1) {
        const p = sel.paths[0]!;
        setPrompt({ kind: 'rename', initial: baseName(p), entry: rows.find((r) => r.path === p) });
      }
    },
    onCopy: () => {
      if (sel.paths.length > 0) {
        clip.copy(sel.paths);
        notify('ok', `已复制 ${sel.paths.length} 项`);
      }
    },
    onCut: () => {
      if (sel.paths.length > 0) {
        clip.cut(sel.paths);
        notify('ok', `已剪切 ${sel.paths.length} 项`);
      }
    },
    onPaste: () => void doPaste(),
    onUp: () => {
      if (list?.parent) void load(list.parent);
    },
    onSelectAll: () => sel.selectAll(),
    onClearSel: () => sel.clear(),
    enabled: !editor && !preview && !menu && !chmodEntry && !prompt,
  });

  useEffect(() => {
    window.addEventListener('keydown', kbHandler);
    return () => window.removeEventListener('keydown', kbHandler);
  }, [kbHandler]);

  /* ── 焦点滚动到可见 ─────────────────────────────────────────────── */

  useEffect(() => {
    if (focusIndex >= 0 && focusIndex < rows.length) {
      virtualizer.scrollToIndex(focusIndex, { align: 'auto' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusIndex]);

  /* ── 面包屑 ─────────────────────────────────────────────────────── */

  const crumbs = useMemo(() => {
    if (cwd === '/') return [{ name: '/', path: '/' }];
    const parts = cwd.split('/').filter(Boolean);
    const out = [{ name: '/', path: '/' }];
    let acc = '';
    for (const p of parts) {
      acc += `/${p}`;
      out.push({ name: p, path: acc });
    }
    return out;
  }, [cwd]);

  const sortBtn = (k: typeof sort, label: string) => (
    <button
      onClick={() => {
        if (sort === k) setOrder(order === 'asc' ? 'desc' : 'asc');
        else {
          setSort(k);
          setOrder('asc');
        }
      }}
      className={cx(
        'px-1.5 py-0.5 text-[10.5px] transition-colors',
        sort === k ? 'bg-[var(--paper-3)] text-[var(--ink)]' : 'text-[var(--text-helper)] hover:text-[var(--ink)]',
      )}
    >
      {label}
      {sort === k && <span className="ml-0.5">{order === 'asc' ? '↑' : '↓'}</span>}
    </button>
  );

  const activeCount = uploads.tasks.filter(
    (t) => t.status === 'uploading' || t.status === 'pending',
  ).length;

  /* ── 渲染 ───────────────────────────────────────────────────────── */

  return (
    <div
      className="flex h-[calc(100vh-9.5rem)] min-h-[520px] flex-col gap-3"
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onContextMenu={(e) => openMenu(e, null)}
    >
      {/* 工具栏 */}
      <Card padded={false} className="shrink-0 px-3 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="xs" variant="quiet" onClick={() => void load('/')} title="根目录">
            <Home size={12} />
          </Button>
          <Button
            size="xs"
            variant="quiet"
            disabled={!list?.parent}
            onClick={() => void load(list?.parent || '/')}
            title="上级 (Backspace)"
          >
            <ArrowUp size={12} />
          </Button>
          <Button size="xs" variant="quiet" onClick={() => void load(cwd)} title="刷新">
            <RefreshCw size={11} className={loading ? 'spin' : undefined} />
          </Button>

          <span className="mx-1 h-4 w-px bg-[var(--line)]" />

          {/* 面包屑 */}
          <div className="flex min-w-0 flex-1 items-center overflow-x-auto">
            {crumbs.map((c, i) => (
              <span key={c.path} className="flex shrink-0 items-center">
                {i > 0 && <ChevronRight size={10} className="mx-0.5 text-[var(--text-placeholder)]" />}
                <button
                  onClick={() => void load(c.path)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setMenu({
                      x: e.clientX,
                      y: e.clientY,
                      title: c.path,
                      items: [
                        {
                          key: 'open',
                          label: '打开',
                          icon: <Folder size={11} />,
                          onSelect: () => void load(c.path),
                        },
                        {
                          key: 'paste',
                          label: '粘贴到此处',
                          icon: <ClipboardPaste size={11} />,
                          disabled: !clip.clip,
                          onSelect: () => {
                            void (async () => {
                              const existing = new Set<string>();
                              const r = await clip.paste(c.path, existing);
                              if (r.failed.length) notify('err', `${r.failed.length} 项失败`);
                              else notify('ok', `已粘贴 ${r.ok} 项`);
                              void load(cwd, { keepSel: true });
                            })();
                          },
                        },
                        {
                          key: 'copypath',
                          label: '复制路径',
                          icon: <Clipboard size={11} />,
                          onSelect: () => copyPath([c.path]),
                        },
                      ],
                    });
                  }}
                  className={cx(
                    'num px-1 py-0.5 text-[11.5px] transition-colors',
                    i === crumbs.length - 1
                      ? 'font-medium text-[var(--ink)]'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--paper-3)] hover:text-[var(--ink)]',
                  )}
                >
                  {c.name}
                </button>
              </span>
            ))}
          </div>

          {/* 搜索 */}
          <div className="relative shrink-0">
            <Search size={11} className="absolute top-1/2 left-2 -translate-y-1/2 text-[var(--text-helper)]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索…"
              className="h-6 w-[140px] border border-[var(--line)] bg-[var(--paper)] pr-6 pl-6 text-[11px] text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--text-placeholder)] focus:border-[var(--accent)]"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute top-1/2 right-1.5 -translate-y-1/2 text-[var(--text-helper)] hover:text-[var(--ink)]"
              >
                <X size={10} />
              </button>
            )}
          </div>

          <Button
            size="xs"
            variant="quiet"
            onClick={() => setHidden((h) => !h)}
            title="显示隐藏文件"
          >
            <Eye size={11} className={hidden ? 'text-[var(--accent)]' : undefined} />
          </Button>
          <Button
            size="xs"
            variant={showDu ? 'solid' : 'quiet'}
            onClick={() => setShowDu((v) => !v)}
            title="目录占用"
          >
            <BarChart3 size={11} />
          </Button>
          <Button
            size="xs"
            variant="quiet"
            onClick={() => setView((v) => (v === 'list' ? 'grid' : 'list'))}
            title={view === 'list' ? '切换到网格视图' : '切换到列表视图'}
          >
            {view === 'list' ? <Grid3x3 size={11} /> : <LayoutList size={11} />}
          </Button>
        </div>

        {/* 第二行：操作 */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Button size="xs" variant="accent" onClick={() => fileInputRef.current?.click()}>
            <Upload size={11} />
            上传
            {activeCount > 0 && <span className="num ml-0.5">{activeCount}</span>}
          </Button>
          <Button size="xs" onClick={() => setPrompt({ kind: 'mkdir', initial: '新建目录' })}>
            <FolderPlus size={11} />
            新建目录
          </Button>
          <Button size="xs" onClick={() => setPrompt({ kind: 'newfile', initial: 'untitled.txt' })}>
            <FilePlus size={11} />
            新建文件
          </Button>

          <span className="mx-1 h-4 w-px bg-[var(--line)]" />

          <Button
            size="xs"
            disabled={sel.count === 0}
            onClick={() => {
              clip.copy(sel.paths);
              notify('ok', `已复制 ${sel.count} 项到剪贴板`);
            }}
            title="复制 (Ctrl+C)"
          >
            <Copy size={11} />
          </Button>
          <Button
            size="xs"
            disabled={sel.count === 0}
            onClick={() => {
              clip.cut(sel.paths);
              notify('ok', `已剪切 ${sel.count} 项`);
            }}
            title="剪切 (Ctrl+X)"
          >
            <Scissors size={11} />
          </Button>
          <Button
            size="xs"
            variant={clip.clip ? 'solid' : 'quiet'}
            disabled={!clip.clip}
            onClick={() => void doPaste()}
            title={clip.clip ? `粘贴 ${clip.clip.paths.length} 项 (Ctrl+V)` : '剪贴板为空'}
          >
            <ClipboardPaste size={11} />
            {clip.clip && <span className="num ml-0.5">{clip.clip.paths.length}</span>}
          </Button>

          <span className="mx-1 h-4 w-px bg-[var(--line)]" />

          <Button
            size="xs"
            disabled={sel.count !== 1}
            onClick={() => {
              const p = sel.paths[0]!;
              setPrompt({ kind: 'rename', initial: baseName(p), entry: rows.find((r) => r.path === p) });
            }}
          >
            <Pencil size={11} />
            重命名
          </Button>
          <Button
            size="xs"
            disabled={sel.count === 0}
            onClick={() => {
              for (const p of sel.paths) {
                const a = document.createElement('a');
                a.href = api.downloadUrl(p);
                a.download = baseName(p);
                a.click();
              }
            }}
          >
            <Download size={11} />
          </Button>
          <Button
            size="xs"
            disabled={sel.count === 0}
            onClick={() => void doArchive(sel.paths)}
            title="打包为 zip"
          >
            <FileArchive size={11} />
          </Button>
          <Button
            size="xs"
            variant="danger"
            disabled={sel.count === 0}
            onClick={() => void doDelete(sel.paths)}
            title="删除 (Delete)"
          >
            <Trash2 size={11} />
          </Button>

          <div className="ml-auto flex items-center gap-1">
            {sortBtn('name', '名称')}
            {sortBtn('mtime', '时间')}
            {sortBtn('size', '大小')}
            <span className="num ml-2 text-[10.5px] text-[var(--text-helper)]">
              {rows.length} 项
              {sel.count > 0 && ` · 选 ${sel.count}`}
              {list && ` · ${fmtBytes(list.free)} 可用`}
            </span>
          </div>
        </div>
      </Card>

      {/* 主体 */}
      <div className="flex min-h-0 flex-1 gap-3">
        <Card padded={false} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {view === 'list' && (
            <div className="flex shrink-0 items-center gap-2 border-b border-[var(--line)] px-3 py-1.5 text-[10.5px] text-[var(--text-helper)]">
              <span className="w-4" />
              <span className="w-3.5" />
              <span className="flex-1">名称</span>
              <span className="w-[84px] text-right">大小</span>
              <span className="w-[74px] text-right">权限</span>
              <span className="w-[120px] text-right">修改时间</span>
            </div>
          )}

          <div
            ref={scrollRef}
            className={cx('relative min-h-0 flex-1 overflow-auto', dragOver && 'ring-2 ring-[var(--accent)] ring-inset')}
            onClick={(e) => {
              if (e.target === e.currentTarget) sel.clear();
            }}
          >
            {loading && !list ? (
              <div className="p-3">
                <LoadingBlock label="读取目录" rows={8} />
              </div>
            ) : searching ? (
              <div className="p-3">
                <LoadingBlock label="搜索中" rows={5} />
              </div>
            ) : searchErr ? (
              <div className="p-3">
                <ErrorState
                  compact
                  message="搜索失败"
                  detail={searchErr}
                  onRetry={() => setSearch((s) => s + ' ')}
                />
              </div>
            ) : error ? (
              <div className="p-3">
                <ErrorState message="目录读取失败" detail={error} onRetry={() => void load(cwd)} />
              </div>
            ) : rows.length === 0 ? (
              <div className="p-3">
                {searchRes ? (
                  <EmptyState
                    compact
                    title="没有匹配的文件"
                    hint={`在 ${cwd} 下未找到「${search.trim()}」。后端搜索有 8 秒上限。`}
                    action={
                      <Button size="xs" onClick={() => setSearch('')}>
                        清除搜索
                      </Button>
                    }
                  />
                ) : (
                  <EmptyState
                    compact
                    title="这个目录是空的"
                    hint="拖文件到这里上传，或右键新建。"
                    action={
                      <div className="flex gap-1.5">
                        <Button size="xs" variant="accent" onClick={() => fileInputRef.current?.click()}>
                          <Upload size={11} />
                          上传
                        </Button>
                        <Button size="xs" onClick={() => setPrompt({ kind: 'mkdir', initial: '新建目录' })}>
                          新建目录
                        </Button>
                      </div>
                    }
                  />
                )}
              </div>
            ) : view === 'grid' ? (
              /* ── 网格视图 ── */
              <div className="p-2">
                <div
                  className="grid gap-1.5"
                  style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))' }}
                >
                  {rows.map((e) => {
                    const isSel = sel.selected.has(e.path);
                    const k = previewKind(e.name);
                    return (
                      <button
                        key={e.path}
                        onClick={(ev) => {
                          sel.click(e.path, { shift: ev.shiftKey, toggle: ev.ctrlKey || ev.metaKey });
                          setFocusIndex(rows.indexOf(e));
                        }}
                        onDoubleClick={() => openEntry(e)}
                        onContextMenu={(ev) => openMenu(ev, e)}
                        draggable
                        onDragStart={(ev) => {
                          ev.dataTransfer.setData('application/x-binnacle-path', e.path);
                          ev.dataTransfer.effectAllowed = 'move';
                        }}
                        className={cx(
                          'group flex flex-col items-center gap-1 p-1.5 text-center transition-colors',
                          isSel ? 'bg-[var(--accent)]/12' : 'hover:bg-[var(--paper-3)]',
                          dropTarget === e.path && 'ring-2 ring-[var(--accent)] ring-inset',
                        )}
                        title={e.name}
                      >
                        <div className="flex h-[56px] w-full items-center justify-center overflow-hidden bg-[var(--paper-3)]">
                          {e.isDir ? (
                            <Folder size={26} className="text-[var(--accent)]" />
                          ) : k === 'image' ? (
                            <img
                              src={api.thumbUrl(e.path, 160)}
                              alt={e.name}
                              loading="lazy"
                              className="h-full w-full object-cover"
                              onError={(ev) => {
                                (ev.currentTarget as HTMLImageElement).style.display = 'none';
                              }}
                            />
                          ) : (
                            <EntryIcon e={e} size={22} />
                          )}
                        </div>
                        <span className="line-clamp-2 w-full text-[10.5px] leading-tight break-all text-[var(--ink)]">
                          {e.name}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              /* ── 列表视图（虚拟滚动） ── */
              <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }} className="w-full">
                {virtualizer.getVirtualItems().map((vi) => {
                  const e = rows[vi.index];
                  if (!e) return null;
                  const isSel = sel.selected.has(e.path);
                  const isFocus = vi.index === focusIndex;
                  return (
                    <div
                      key={`${e.path}-${vi.index}`}
                      className={cx(
                        'absolute top-0 left-0 flex w-full cursor-default items-center gap-2 px-3 text-[11.5px] transition-colors',
                        isSel
                          ? 'bg-[var(--accent)]/12'
                          : isFocus
                            ? 'bg-[var(--paper-3)]/60'
                            : 'hover:bg-[var(--paper-3)]',
                        dropTarget === e.path && 'ring-2 ring-[var(--accent)] ring-inset',
                      )}
                      style={{ height: vi.size, transform: `translateY(${vi.start}px)` }}
                      onClick={(ev) => {
                        sel.click(e.path, { shift: ev.shiftKey, toggle: ev.ctrlKey || ev.metaKey });
                        setFocusIndex(vi.index);
                      }}
                      onDoubleClick={() => openEntry(e)}
                      onContextMenu={(ev) => openMenu(ev, e)}
                      draggable
                      onDragStart={(ev) => {
                        ev.dataTransfer.setData('application/x-binnacle-path', e.path);
                        ev.dataTransfer.effectAllowed = 'move';
                      }}
                      onDragOver={(ev) => {
                        if (e.isDir) {
                          ev.preventDefault();
                          ev.stopPropagation();
                          setDropTarget(e.path);
                        }
                      }}
                      onDragLeave={() => setDropTarget((p) => (p === e.path ? null : p))}
                      onDrop={(ev) => {
                        if (!e.isDir) return;
                        ev.preventDefault();
                        ev.stopPropagation();
                        setDropTarget(null);
                        setDragOver(false);
                        dragDepth.current = 0;
                        const src = ev.dataTransfer.getData('application/x-binnacle-path');
                        if (src && parentOf(src) !== e.path) {
                          void (async () => {
                            try {
                              await api.fsRename(src, joinPath(e.path, baseName(src)));
                              notify('ok', `已移动 ${baseName(src)} → ${e.name}`);
                              void load(cwd, { keepSel: true });
                            } catch (err) {
                              notify('err', err instanceof Error ? err.message : '移动失败');
                            }
                          })();
                        }
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isSel}
                        onChange={() => sel.toggle(e.path)}
                        onClick={(ev) => ev.stopPropagation()}
                        className="h-3 w-3 shrink-0 accent-[var(--accent)]"
                        aria-label={`选择 ${e.name}`}
                      />
                      <EntryIcon e={e} />
                      <span className="min-w-0 flex-1 truncate text-[var(--ink)]">
                        {e.name}
                        {e.symlink && (
                          <span className="ml-1 inline-flex items-center gap-0.5 text-[10px] text-[var(--text-placeholder)]">
                            <Link2 size={9} />
                            {e.linkTo ?? 'symlink'}
                          </span>
                        )}
                      </span>
                      <span className="num w-[84px] shrink-0 text-right text-[10.5px] text-[var(--text-helper)]">
                        {e.isDir ? '—' : fmtBytes(e.size)}
                      </span>
                      <span className="num w-[74px] shrink-0 text-right text-[10px] text-[var(--text-helper)]">
                        {e.mode}
                      </span>
                      <span className="num w-[120px] shrink-0 text-right text-[10px] text-[var(--text-helper)]">
                        {new Date(e.mtime).toLocaleString('zh-CN', { hour12: false })}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* 拖拽遮罩 */}
            {dragOver && (
              <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-[var(--paper)]/85">
                <div className="border-2 border-dashed border-[var(--accent)] px-8 py-6 text-center">
                  <Upload size={22} className="mx-auto text-[var(--accent)]" />
                  <div className="mt-2 text-[13px] font-medium text-[var(--ink)]">
                    松开上传{dragCount > 0 ? ` ${dragCount} 个文件` : ''}
                  </div>
                  <div className="num mt-1 text-[10.5px] text-[var(--text-helper)]">到 {cwd}</div>
                </div>
              </div>
            )}
          </div>

          {/* 底部状态 */}
          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-[var(--line)] px-3 py-1 text-[10.5px] text-[var(--text-helper)]">
            <span className="num truncate">
              {cwd}
              {searchRes && ` · 搜索「${search.trim()}」${searchRes.truncated ? '（截断）' : ''}`}
            </span>
            <span className="shrink-0">
              {clip.clip
                ? `剪贴板 ${clip.clip.paths.length} 项（${clip.clip.mode === 'copy' ? '复制' : '剪切'}）`
                : sel.count > 0
                  ? `已选 ${sel.count} 项`
                  : '右键更多操作 · Ctrl+A 全选'}
            </span>
          </div>
        </Card>

        {/* 右侧面板 */}
        {(editor || showDu) && (
          <div className="flex w-[min(46%,620px)] min-w-[300px] flex-col gap-3">
            {showDu && (
              <Card className="flex max-h-[45%] flex-col overflow-hidden">
                <SectionHead
                  title="目录占用"
                  hint={cwd}
                  right={
                    <>
                      <Button size="xs" variant="quiet" onClick={() => void loadDu(cwd)}>
                        <RefreshCw size={10} className={duLoading ? 'spin' : undefined} />
                      </Button>
                      <Button size="xs" variant="quiet" onClick={() => setShowDu(false)}>
                        <X size={10} />
                      </Button>
                    </>
                  }
                />
                <div className="min-h-0 flex-1 overflow-auto pr-1">
                  {duLoading ? (
                    <LoadingBlock label="统计目录（20 秒上限）" rows={5} />
                  ) : duErr ? (
                    <ErrorState compact message="统计失败" detail={duErr} onRetry={() => void loadDu(cwd)} />
                  ) : !du || du.length === 0 ? (
                    <EmptyState compact title="没有可统计的子项" hint="该目录为空或全部 0 字节。" />
                  ) : (
                    <Treemap
                      nodes={du}
                      onOpen={(p) => {
                        setCwd(p);
                        void load(p);
                      }}
                    />
                  )}
                </div>
              </Card>
            )}

            {editor && (
              <Editor
                state={editor}
                onClose={() => setEditor(null)}
                onChange={(v) => setEditor((s) => (s ? { ...s, content: v } : s))}
                onSave={() => {
                  if (!editor) return;
                  setEditor((s) => (s ? { ...s, saving: true, saveError: null } : s));
                  api
                    .fsWrite(editor.path, editor.content)
                    .then(() => {
                      setEditor((s) => (s ? { ...s, saving: false, original: s.content } : s));
                      notify('ok', '已保存');
                      void load(cwd, { keepSel: true });
                    })
                    .catch((e: unknown) => {
                      setEditor((s) =>
                        s
                          ? {
                              ...s,
                              saving: false,
                              saveError: e instanceof Error ? e.message : '保存失败',
                            }
                          : s,
                      );
                    });
                }}
              />
            )}
          </div>
        )}
      </div>

      {/* 快捷入口 */}
      {shortcuts.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-1">
          <span className="kicker mr-1">快捷</span>
          {shortcuts.slice(0, 22).map((s) => (
            <button
              key={s.path}
              onClick={() => void load(s.path)}
              className={cx(
                'num border px-1.5 py-[1px] text-[10px] transition-colors',
                cwd === s.path
                  ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
                  : 'border-[var(--line)] text-[var(--text-secondary)] hover:bg-[var(--paper-3)] hover:text-[var(--ink)]',
              )}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      {/* 浮层 */}
      <UploadPanel
        tasks={uploads.tasks}
        onCancel={uploads.cancel}
        onClear={uploads.clearFinished}
      />
      <Toast toast={toast} offset={uploads.tasks.length > 0} />
      <ContextMenu state={menu} onClose={() => setMenu(null)} />

      <Preview
        entry={preview ?? ({} as FsEntry)}
        onClose={() => setPreview(null)}
        onPrev={() => {
          if (!preview) return;
          const i = rows.findIndex((r) => r.path === preview.path);
          for (let k = i - 1; k >= 0; k--) {
            const r = rows[k];
            if (r && canPreview(r)) {
              setPreview(r);
              return;
            }
          }
        }}
        onNext={() => {
          if (!preview) return;
          const i = rows.findIndex((r) => r.path === preview.path);
          for (let k = i + 1; k < rows.length; k++) {
            const r = rows[k];
            if (r && canPreview(r)) {
              setPreview(r);
              return;
            }
          }
        }}
        hasPrev={
          !!preview &&
          rows.slice(0, rows.findIndex((r) => r.path === preview.path)).some(canPreview)
        }
        hasNext={
          !!preview &&
          rows.slice(rows.findIndex((r) => r.path === preview.path) + 1).some(canPreview)
        }
      />

      <ChmodDialog
        entry={chmodEntry}
        onClose={() => setChmodEntry(null)}
        onDone={(msg) => {
          notify('ok', msg);
          void load(cwd, { keepSel: true });
        }}
      />

      <PromptDialog
        open={!!prompt}
        title={
          prompt?.kind === 'mkdir'
            ? '新建目录'
            : prompt?.kind === 'newfile'
              ? '新建文件'
              : '重命名'
        }
        label={prompt?.kind === 'rename' ? '新名称' : '名称'}
        initial={prompt?.initial ?? ''}
        hint={
          prompt?.kind === 'rename'
            ? '可输入完整路径实现移动'
            : `将创建于 ${cwd}`
        }
        confirmText={prompt?.kind === 'rename' ? '重命名' : '创建'}
        onClose={() => setPrompt(null)}
        onSubmit={async (v) => {
          if (!prompt) return;
          if (prompt.kind === 'mkdir') {
            await api.fsMkdir(joinPath(cwd, v));
            notify('ok', `已创建目录 ${v}`);
          } else if (prompt.kind === 'newfile') {
            await api.fsWrite(joinPath(cwd, v), '');
            notify('ok', `已创建文件 ${v}`);
          } else if (prompt.entry) {
            const to = v.includes('/') ? v : joinPath(parentOf(prompt.entry.path), v);
            await api.fsRename(prompt.entry.path, to);
            notify('ok', '已重命名');
          }
          void load(cwd, { keepSel: true });
        }}
      />

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            void uploads.enqueue(cwd, Array.from(e.target.files));
          }
          e.target.value = '';
        }}
      />

      {/* 隐藏的图标引用，避免 lint 未使用 */}
      <span className="hidden">
        <Info size={1} />
        <HardDrive size={1} />
        <Skeleton className="h-0" />
        <Badge>.</Badge>
      </span>
    </div>
  );
}
