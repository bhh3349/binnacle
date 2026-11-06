import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { api } from '../lib/api';
import type { DuNode, FsEntry, FsListResponse, FsReadResponse } from '../lib/types';
import {
  baseName,
  cx,
  fmtBytes,
  isImage,
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
import {
  ArrowLeft,
  ArrowUp,
  ChevronRight,
  Copy,
  Download,
  Eye,
  File as FileIcon,
  FileCode,
  FileImage,
  FileText,
  Folder,
  FolderOpen,
  Home,
  Link2,
  Loader2,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  X,
  HardDrive,
  BarChart3,
} from 'lucide-react';

/* ---------------- 图标 ---------------- */

function EntryIcon({ e, size = 13 }: { e: FsEntry; size?: number }) {
  if (e.isDir) return <Folder size={size} className="text-[var(--accent)]/80 shrink-0" />;
  if (isImage(e.name)) return <FileImage size={size} className="text-[var(--text-helper)] shrink-0" />;
  if (isTextFile(e.name)) return <FileCode size={size} className="text-[var(--text-helper)] shrink-0" />;
  if (/\.(zip|tar|gz|xz|7z|bz2|zst)$/i.test(e.name))
    return <FileIcon size={size} className="text-[var(--warn)]/80 shrink-0" />;
  return <FileText size={size} className="text-[var(--text-helper)] shrink-0" />;
}

/* ---------------- 编辑器 ---------------- */

interface EditorState {
  path: string;
  content: string;
  original: string;
  loading: boolean;
  error: string | null;
  saving: boolean;
  saveError: string | null;
}

function Editor({
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
    <div className="border-[var(--line)] bg-[var(--paper-3)]/40 flex min-h-0 flex-1 flex-col overflow-hidden rounded-none border">
      <div className="border-[var(--line)] bg-[var(--paper-2)] flex shrink-0 items-center justify-between gap-2 border-b px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <FileCode size={12} className="text-[var(--text-helper)] shrink-0" />
          <span className="num truncate text-[11.5px]">{state.path}</span>
          {dirty && <Badge tone="warn">未保存</Badge>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <span className="text-[var(--text-helper)] num mr-1 text-[10.5px]">{lines} 行</span>
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
            <div className="border-[var(--alert)]/40 bg-[var(--alert)]/5 text-[var(--alert)] shrink-0 border-b px-3 py-1 text-[11px]">
              保存失败：{state.saveError}
            </div>
          )}
          <textarea
            ref={taRef}
            spellCheck={false}
            value={state.content}
            onChange={(e) => onChange(e.target.value)}
            className="num text-[var(--ink)] placeholder:text-[var(--text-helper)] min-h-0 w-full flex-1 resize-none bg-transparent p-3 text-[12px] leading-[1.55] outline-none"
            placeholder="（空文件）"
          />
        </>
      )}
    </div>
  );
}

/* ---------------- Treemap ---------------- */

function Treemap({ nodes, onOpen }: { nodes: DuNode[]; onOpen: (path: string) => void }) {
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
            className="hover:bg-[var(--paper-3)] group flex w-full items-center gap-2 rounded px-1 py-[2px] text-left transition-colors"
            title={`${n.path}\n${fmtBytes(n.size)}${n.isDir ? ` · ${n.count} 项` : ''}`}
          >
            <span className="text-[var(--text-helper)] num w-4 shrink-0 text-right text-[9.5px]">{i + 1}</span>
            <span className="num text-[var(--text-secondary)] w-[120px] shrink-0 truncate text-[11px]">
              {n.name}
            </span>
            <span className="bg-[var(--paper-3)] relative h-[10px] min-w-0 flex-1 overflow-hidden rounded-none">
              <span
                className={cx(
                  'absolute inset-y-0 left-0 rounded-none transition-[width] duration-300',
                  n.isDir ? 'bg-[var(--accent)]/55' : 'bg-[var(--accent)]/30',
                )}
                style={{ width: `${Math.max(pct, 1.5)}%` }}
              />
            </span>
            <span className="num text-[var(--text-helper)] w-[68px] shrink-0 text-right text-[10px]">
              {fmtBytes(n.size)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ---------------- 主组件 ---------------- */

export function FilesTab({ active = true }: { active?: boolean }) {
  void active;
  const [cwd, setCwd] = useState('/');
  const [list, setList] = useState<FsListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  const [sort, setSort] = useState<'name' | 'mtime' | 'size'>('name');
  const [order, setOrder] = useState<'asc' | 'desc'>('asc');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [search, setSearch] = useState('');
  const [searchRes, setSearchRes] = useState<{ hits: FsEntry[]; truncated: boolean } | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const [du, setDu] = useState<DuNode[] | null>(null);
  const [duLoading, setDuLoading] = useState(false);
  const [duErr, setDuErr] = useState<string | null>(null);
  const [showDu, setShowDu] = useState(false);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [uploading, setUploading] = useState<{ name: string; pct: number } | null>(null);
  const [shortcuts, setShortcuts] = useState<{ name: string; path: string }[]>([]);
  const [dragOver, setDragOver] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const notify = useCallback((kind: 'ok' | 'err', text: string) => {
    setToast({ kind, text });
    window.setTimeout(() => setToast(null), 3200);
  }, []);

  const load = useCallback(
    async (path: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await api.fsList(path, { sort, order, hidden: hidden ? 1 : 0 });
        setList(res);
        setCwd(res.path);
        setSelected(new Set());
      } catch (e) {
        setError(e instanceof Error ? e.message : '目录读取失败');
        setList(null);
      } finally {
        setLoading(false);
      }
    },
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
    if (cwd) void load(cwd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort, order, hidden]);

  /* --- 搜索 --- */
  useEffect(() => {
    const kw = search.trim();
    if (!kw) {
      setSearchRes(null);
      setSearchErr(null);
      return;
    }
    let cancelled = false;
    setSearching(true);
    setSearchErr(null);
    const id = window.setTimeout(() => {
      api
        .fsSearch(kw, cwd, 200)
        .then((r) => {
          if (!cancelled) setSearchRes({ hits: r.hits, truncated: r.truncated });
        })
        .catch((e: unknown) => {
          if (!cancelled) setSearchErr(e instanceof Error ? e.message : '搜索失败');
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 320);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [search, cwd]);

  /* --- 目录占用 --- */
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

  const rows: FsEntry[] = useMemo(() => {
    if (searchRes) return searchRes.hits;
    return list?.entries ?? [];
  }, [searchRes, list]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 28,
    overscan: 14,
  });

  const openEntry = useCallback(
    async (e: FsEntry) => {
      if (e.isDir) {
        setSearch('');
        setSearchRes(null);
        setCwd(e.path);
        void load(e.path);
        return;
      }
      // 文件：文本则编辑，图片则预览下载，其它提示下载
      if (isTextFile(e.name) || e.size === 0) {
        setEditor({
          path: e.path,
          content: '',
          original: '',
          loading: true,
          error: null,
          saving: false,
          saveError: null,
        });
        try {
          const r: FsReadResponse = await api.fsRead(e.path);
          setEditor({
            path: e.path,
            content: r.content,
            original: r.content,
            loading: false,
            error: null,
            saving: false,
            saveError: null,
          });
        } catch (err) {
          setEditor((s) =>
            s
              ? {
                  ...s,
                  loading: false,
                  error:
                    err instanceof Error
                      ? `${err.message}${(err as { status?: number }).status === 413 ? '（文件超过 4 MB，请下载后编辑）' : ''}`
                      : '读取失败',
                }
              : null,
          );
        }
      } else if (isImage(e.name)) {
        window.open(api.downloadUrl(e.path), '_blank', 'noopener');
      } else {
        notify('ok', `开始下载 ${e.name}`);
        const a = document.createElement('a');
        a.href = api.downloadUrl(e.path);
        a.download = e.name;
        a.click();
      }
    },
    [load, notify],
  );

  const saveEditor = useCallback(async () => {
    if (!editor) return;
    setEditor((s) => (s ? { ...s, saving: true, saveError: null } : s));
    try {
      await api.fsWrite(editor.path, editor.content);
      setEditor((s) => (s ? { ...s, saving: false, original: s.content } : s));
      notify('ok', '已保存');
      void load(cwd);
    } catch (e) {
      setEditor((s) =>
        s ? { ...s, saving: false, saveError: e instanceof Error ? e.message : '保存失败' } : s,
      );
    }
  }, [editor, notify, load, cwd]);

  const doUpload = useCallback(
    async (files: FileList | File[]) => {
      const arr = Array.from(files);
      for (const f of arr) {
        setUploading({ name: f.name, pct: 0 });
        try {
          await api.fsUpload(joinPath(cwd, f.name), f, (pct) =>
            setUploading({ name: f.name, pct }),
          );
          notify('ok', `已上传 ${f.name}`);
        } catch (e) {
          notify('err', `${f.name} 上传失败：${e instanceof Error ? e.message : ''}`);
        }
      }
      setUploading(null);
      void load(cwd);
    },
    [cwd, notify, load],
  );

  const toggleSel = (path: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(path)) n.delete(path);
      else n.add(path);
      return n;
    });
  };

  const selectedPaths = useMemo(() => Array.from(selected), [selected]);

  const act = async (kind: 'delete' | 'rename' | 'copy' | 'mkdir') => {
    try {
      if (kind === 'delete') {
        if (selectedPaths.length === 0) return;
        const ok = window.confirm(
          `删除 ${selectedPaths.length} 项？\n\n${selectedPaths.slice(0, 6).join('\n')}${selectedPaths.length > 6 ? '\n…' : ''}\n\n此操作不可撤销。`,
        );
        if (!ok) return;
        const r = await api.fsDelete(selectedPaths);
        if (r.errors && r.errors.length > 0) notify('err', `部分失败：${r.errors.join('; ')}`);
        else notify('ok', '已删除');
      } else if (kind === 'rename') {
        if (selectedPaths.length !== 1) {
          notify('err', '请选择单个条目重命名');
          return;
        }
        const from = selectedPaths[0]!;
        const next = window.prompt('新名称（或新路径）', baseName(from));
        if (!next || next === baseName(from)) return;
        const to = next.startsWith('/') ? next : joinPath(parentOf(from), next);
        await api.fsRename(from, to);
        notify('ok', '已重命名');
      } else if (kind === 'copy') {
        if (selectedPaths.length !== 1) {
          notify('err', '请选择单个条目复制');
          return;
        }
        const from = selectedPaths[0]!;
        const next = window.prompt('复制到（完整目标路径）', `${from}.copy`);
        if (!next || next === from) return;
        await api.fsCopy(from, next);
        notify('ok', '已复制');
      } else {
        const name = window.prompt('新目录名称', 'new-folder');
        if (!name) return;
        await api.fsMkdir(joinPath(cwd, name));
        notify('ok', '已创建目录');
      }
      void load(cwd);
    } catch (e) {
      notify('err', e instanceof Error ? e.message : '操作失败');
    }
  };

  /* --- 面包屑 --- */
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
        'rounded px-1.5 py-0.5 text-[10.5px] transition-colors',
        sort === k ? 'bg-[var(--paper-3)] text-[var(--ink)]' : 'text-[var(--text-helper)] hover:text-[var(--ink)]',
      )}
    >
      {label}
      {sort === k && <span className="ml-0.5">{order === 'asc' ? '↑' : '↓'}</span>}
    </button>
  );

  return (
    <div className="flex h-[calc(100vh-8.5rem)] min-h-[520px] flex-col gap-3">
      {/* 工具栏 */}
      <Card padded={false} className="shrink-0 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="xs" variant="quiet" onClick={() => void load('/')} title="根目录">
            <Home size={12} />
          </Button>
          <Button
            size="xs"
            variant="quiet"
            disabled={!list?.parent}
            onClick={() => void load(list?.parent || '/')}
            title="上级目录"
          >
            <ArrowUp size={12} />
          </Button>
          <Button size="xs" variant="quiet" onClick={() => void load(cwd)} title="刷新">
            <RefreshCw size={11} className={loading ? 'spin' : undefined} />
          </Button>

          <div className="border-[var(--line)] mx-0.5 h-4 w-px" />

          {/* 面包屑 */}
          <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
            {crumbs.map((c, i) => (
              <span key={c.path} className="flex shrink-0 items-center">
                {i > 0 && <ChevronRight size={10} className="text-[var(--text-helper)] mx-0.5" />}
                <button
                  onClick={() => void load(c.path)}
                  className={cx(
                    'num rounded px-1 py-0.5 text-[11.5px] transition-colors',
                    i === crumbs.length - 1
                      ? 'text-[var(--ink)] font-medium'
                      : 'text-[var(--text-secondary)] hover:text-[var(--ink)] hover:bg-[var(--paper-3)]',
                  )}
                >
                  {c.name}
                </button>
              </span>
            ))}
          </div>

          {/* 搜索 */}
          <div className="relative">
            <Search size={11} className="text-[var(--text-helper)] absolute top-1/2 left-2 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索当前目录…"
              className="border-[var(--line)] bg-[var(--paper-3)] text-[var(--ink)] placeholder:text-[var(--text-helper)] focus:border-[var(--accent)] h-6 w-[150px] rounded-none border pr-6 pl-6 text-[11px] outline-none transition-colors"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="text-[var(--text-helper)] hover:text-[var(--ink)] absolute top-1/2 right-1.5 -translate-y-1/2"
              >
                <X size={10} />
              </button>
            )}
          </div>

          <Button size="xs" variant="quiet" onClick={() => setHidden((h) => !h)} title="显示隐藏文件">
            <Eye size={11} className={hidden ? 'text-[var(--ink)]' : undefined} />
          </Button>
          <Button
            size="xs"
            variant={showDu ? 'solid' : 'quiet'}
            onClick={() => setShowDu((v) => !v)}
            title="目录占用"
          >
            <BarChart3 size={11} />
          </Button>
        </div>

        {/* 第二行：操作 */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Button size="xs" variant="accent" onClick={() => fileInputRef.current?.click()}>
            <Upload size={11} />
            上传
          </Button>
          <Button size="xs" onClick={() => void act('mkdir')}>
            <Folder size={11} />
            新建目录
          </Button>
          <div className="border-[var(--line)] mx-0.5 h-4 w-px" />
          <Button
            size="xs"
            disabled={selectedPaths.length !== 1}
            onClick={() => void act('rename')}
          >
            <Pencil size={11} />
            重命名
          </Button>
          <Button size="xs" disabled={selectedPaths.length !== 1} onClick={() => void act('copy')}>
            <Copy size={11} />
            复制
          </Button>
          <Button
            size="xs"
            disabled={selectedPaths.length === 0}
            onClick={() => {
              for (const p of selectedPaths) {
                const a = document.createElement('a');
                a.href = api.downloadUrl(p);
                a.download = baseName(p);
                a.click();
              }
            }}
          >
            <Download size={11} />
            下载
          </Button>
          <Button
            size="xs"
            variant="danger"
            disabled={selectedPaths.length === 0}
            onClick={() => void act('delete')}
          >
            <Trash2 size={11} />
            删除
          </Button>

          <div className="ml-auto flex items-center gap-1">
            {sortBtn('name', '名称')}
            {sortBtn('mtime', '修改时间')}
            {sortBtn('size', '大小')}
            <span className="text-[var(--text-helper)] num ml-2 text-[10.5px]">
              {rows.length} 项
              {list && ` · 可用 ${fmtBytes(list.free)} / ${fmtBytes(list.totalSize)}`}
            </span>
          </div>
        </div>
      </Card>

      {/* 主体：列表 + 编辑/treemap */}
      <div className="flex min-h-0 flex-1 gap-3">
        <Card padded={false} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {/* 表头 */}
          <div className="border-[var(--line)] text-[var(--text-helper)] flex shrink-0 items-center gap-2 border-b px-3 py-1.5 text-[10.5px]">
            <span className="w-4" />
            <span className="flex-1">名称</span>
            <span className="w-[92px] text-right">大小</span>
            <span className="w-[76px] text-right">权限</span>
            <span className="w-[126px] text-right">修改时间</span>
          </div>

          <div
            ref={scrollRef}
            className={cx(
              'min-h-0 flex-1 overflow-auto',
              dragOver && 'ring-[var(--accent)]/40 ring-2 ring-inset',
            )}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              if (e.dataTransfer.files.length > 0) void doUpload(e.dataTransfer.files);
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
                <ErrorState
                  message="目录读取失败"
                  detail={error}
                  onRetry={() => void load(cwd)}
                />
              </div>
            ) : rows.length === 0 ? (
              <div className="p-3">
                {searchRes ? (
                  <EmptyState
                    compact
                    title="没有匹配的文件"
                    hint={`在 ${cwd} 下未找到包含「${search.trim()}」的条目。后端搜索有 8 秒上限，可换更具体的词或换目录。`}
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
                    hint="可以上传文件或新建目录。"
                    action={
                      <div className="flex gap-1.5">
                        <Button size="xs" variant="accent" onClick={() => fileInputRef.current?.click()}>
                          <Upload size={11} />
                          上传
                        </Button>
                        <Button size="xs" onClick={() => void act('mkdir')}>
                          新建目录
                        </Button>
                      </div>
                    }
                  />
                )}
              </div>
            ) : (
              <div
                style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
                className="w-full"
              >
                {virtualizer.getVirtualItems().map((vi) => {
                  const e = rows[vi.index];
                  if (!e) return null;
                  const isSel = selected.has(e.path);
                  return (
                    <div
                      key={`${e.path}-${vi.index}`}
                      className={cx(
                        'absolute top-0 left-0 flex w-full cursor-pointer items-center gap-2 px-3 text-[11.5px] transition-colors',
                        isSel ? 'bg-[var(--accent)]/10' : 'hover:bg-[var(--paper-3)]',
                      )}
                      style={{ height: vi.size, transform: `translateY(${vi.start}px)` }}
                      onClick={(ev) => {
                        if (ev.metaKey || ev.ctrlKey || ev.shiftKey) toggleSel(e.path);
                        else void openEntry(e);
                      }}
                      onDoubleClick={() => {
                        if (!e.isDir) void openEntry(e);
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isSel}
                        onChange={() => toggleSel(e.path)}
                        onClick={(ev) => ev.stopPropagation()}
                        className="accent-[var(--accent)] h-3 w-3 shrink-0"
                        aria-label={`选择 ${e.name}`}
                      />
                      <EntryIcon e={e} />
                      <span className="text-[var(--ink)] min-w-0 flex-1 truncate">
                        {e.name}
                        {e.symlink && (
                          <span className="text-[var(--text-helper)] ml-1 inline-flex items-center gap-0.5 text-[10px]">
                            <Link2 size={9} />
                            {e.linkTo ?? 'symlink'}
                          </span>
                        )}
                      </span>
                      <span className="num text-[var(--text-helper)] w-[92px] shrink-0 text-right text-[10.5px]">
                        {e.isDir ? '—' : fmtBytes(e.size)}
                      </span>
                      <span className="num text-[var(--text-helper)] w-[76px] shrink-0 text-right text-[10px]">
                        {e.mode}
                      </span>
                      <span className="num text-[var(--text-helper)] w-[126px] shrink-0 text-right text-[10px]">
                        {new Date(e.mtime).toLocaleString('zh-CN', { hour12: false })}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 底部状态 */}
          <div className="border-[var(--line)] text-[var(--text-helper)] flex shrink-0 items-center justify-between border-t px-3 py-1 text-[10.5px]">
            <span className="num truncate">
              {cwd}
              {searchRes && ` · 搜索「${search.trim()}」${searchRes.truncated ? '（已截断）' : ''}`}
            </span>
            <span>
              {selectedPaths.length > 0 ? `已选 ${selectedPaths.length} 项` : '单击打开 · 勾选后批量操作'}
            </span>
          </div>
        </Card>

        {/* 右侧面板 */}
        {(editor || showDu) && (
          <div className="flex w-[min(46%,620px)] min-w-[300px] flex-col gap-3">
            {showDu && (
              <Card className="flex max-h-[45%] flex-col overflow-hidden">
                <SectionHead
                  title={
                    <span className="flex items-center gap-1.5">
                      <HardDrive size={12} className="text-[var(--text-helper)]" />
                      目录占用
                    </span>
                  }
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
                    <LoadingBlock label="统计目录（后端 20 秒上限）" rows={5} />
                  ) : duErr ? (
                    <ErrorState compact message="统计失败" detail={duErr} onRetry={() => void loadDu(cwd)} />
                  ) : !du || du.length === 0 ? (
                    <EmptyState compact title="没有可统计的子项" hint="该目录为空或全部为 0 字节。" />
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
                onSave={() => void saveEditor()}
              />
            )}
          </div>
        )}
      </div>

      {/* 快捷入口 */}
      {shortcuts.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-1">
          <span className="text-[var(--text-helper)] mr-1 text-[10px]">快捷：</span>
          {shortcuts.slice(0, 22).map((s) => (
            <button
              key={s.path}
              onClick={() => void load(s.path)}
              className={cx(
                'num rounded border px-1.5 py-[1px] text-[10px] transition-colors',
                cwd === s.path
                  ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
                  : 'border-[var(--line)] text-[var(--text-secondary)] hover:text-[var(--ink)] hover:bg-[var(--paper-3)]',
              )}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      {/* 上传进度 */}
      {uploading && (
        <div className="border-[var(--line)] bg-[var(--paper-2)] fixed right-4 bottom-4 z-40 w-[260px] rounded-none border p-3 ">
          <div className="mb-1.5 flex items-center gap-1.5 text-[11.5px]">
            <Loader2 size={11} className="spin text-[var(--accent)]" />
            <span className="num truncate">{uploading.name}</span>
            <span className="num text-[var(--text-helper)] ml-auto">{uploading.pct}%</span>
          </div>
          <div className="bg-[var(--paper-3)] h-1 w-full overflow-hidden rounded-none">
            <div
              className="bg-[var(--accent)] h-full rounded-none transition-[width] duration-200"
              style={{ width: `${uploading.pct}%` }}
            />
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          className={cx(
            'fade-in fixed right-4 bottom-4 z-50 rounded-none border px-3 py-2 text-[11.5px] ',
            uploading && 'bottom-[76px]',
            toast.kind === 'ok'
              ? 'border-[var(--ok)]/40 bg-[var(--ok)]/10 text-[var(--ok)]'
              : 'border-[var(--alert)]/40 bg-[var(--alert)]/10 text-[var(--alert)]',
          )}
        >
          {toast.text}
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) void doUpload(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}

/* 供其它模块使用（避免未使用告警） */
export const _fileIcons = { FolderOpen, ArrowLeft };
export const _skeleton = Skeleton;
