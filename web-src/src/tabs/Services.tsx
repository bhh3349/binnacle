import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, wsUrl } from '../lib/api';
import type { ServiceEntry } from '../lib/types';
import { cx, fmtAgo } from '../lib/format';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingBlock,
  Skeleton,
} from '../components/ui';
import {
  Play,
  RefreshCw,
  RotateCw,
  Square,
  ScrollText,
  Loader2,
  Search,
  X,
  CircleDot,
} from 'lucide-react';

type Action = 'start' | 'stop' | 'restart' | 'reload';

function activeTone(active: string): 'ok' | 'danger' | 'warn' | 'neutral' {
  if (active === 'active') return 'ok';
  if (active === 'failed') return 'danger';
  if (active === 'activating' || active === 'deactivating') return 'warn';
  return 'neutral';
}

const ACTIVE_LABEL: Record<string, string> = {
  active: '运行中',
  inactive: '未运行',
  failed: '失败',
  activating: '启动中',
  deactivating: '停止中',
};

/* ---------------- 日志抽屉 ---------------- */

function LogPanel({ unit, onClose }: { unit: string; onClose: () => void }) {
  const [lines, setLines] = useState<string[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'empty'>('loading');
  const [err, setErr] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    setErr(null);
    try {
      const r = await api.logs(unit, 300);
      const ls = r.lines ?? [];
      setLines(ls);
      setState(ls.length === 0 ? 'empty' : 'ready');
    } catch (e) {
      setErr(e instanceof Error ? e.message : '日志读取失败');
      setState('error');
    }
  }, [unit]);

  useEffect(() => {
    void load();
  }, [load]);

  // 实时跟随
  useEffect(() => {
    if (!follow) return;
    let closed = false;
    let sock: WebSocket | null = null;
    let retry: number | null = null;

    const open = () => {
      if (closed) return;
      try {
        sock = new WebSocket(wsUrl(`/ws/logs/${encodeURIComponent(unit)}`));
      } catch {
        return;
      }
      wsRef.current = sock;
      sock.onmessage = (ev: MessageEvent<string>) => {
        if (typeof ev.data !== 'string') return;
        try {
          const obj = JSON.parse(ev.data) as { line?: string };
          if (obj.line) {
            setLines((prev) => {
              const next = prev.length > 4000 ? prev.slice(-3000) : prev.slice();
              next.push(obj.line as string);
              return next;
            });
            setState('ready');
          }
        } catch {
          /* 忽略非 JSON 帧 */
        }
      };
      sock.onclose = () => {
        if (closed) return;
        retry = window.setTimeout(open, 3000);
      };
    };
    open();
    return () => {
      closed = true;
      if (retry !== null) window.clearTimeout(retry);
      if (sock) {
        try {
          sock.close();
        } catch {
          /* 忽略 */
        }
      }
      wsRef.current = null;
    };
  }, [follow, unit]);

  useEffect(() => {
    const el = bodyRef.current;
    if (el && follow) el.scrollTop = el.scrollHeight;
  }, [lines, follow]);

  return (
    <div className="border-line bg-surface flex min-h-0 flex-col overflow-hidden rounded-lg border">
      <div className="border-line flex shrink-0 items-center justify-between gap-2 border-b px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <ScrollText size={12} className="text-fg-subtle" />
          <span className="num truncate text-[11.5px]">{unit}</span>
          <span className="text-fg-subtle num text-[10px]">{lines.length} 行</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="xs"
            variant={follow ? 'primary' : 'default'}
            onClick={() => setFollow((f) => !f)}
            title="实时跟随"
          >
            {follow ? <CircleDot size={10} /> : <Play size={10} />}
            {follow ? '跟随中' : '已暂停'}
          </Button>
          <Button size="xs" variant="ghost" onClick={() => void load()} title="重新拉取">
            <RefreshCw size={10} />
          </Button>
          <Button size="xs" variant="ghost" onClick={onClose} title="关闭">
            <X size={10} />
          </Button>
        </div>
      </div>

      <div ref={bodyRef} className="min-h-0 flex-1 overflow-auto p-2">
        {state === 'loading' ? (
          <LoadingBlock label="读取 journal 日志" rows={6} />
        ) : state === 'error' ? (
          <ErrorState compact message="日志读取失败" detail={err ?? ''} onRetry={() => void load()} />
        ) : state === 'empty' ? (
          <EmptyState
            compact
            title="该 unit 没有日志输出"
            hint="journald 中暂无记录。可能该服务从未启动，或日志已被轮转清理。"
            action={
              <Button size="xs" onClick={() => void load()}>
                重新拉取
              </Button>
            }
          />
        ) : (
          <pre className="num text-fg-muted text-[10.5px] leading-[1.55] break-all whitespace-pre-wrap">
            {lines.map((l, i) => {
              const m = /^(\d{4}-\d\d-\d\dT[\d:+-]+)\s+(\S+)\s+(\S+?):\s?(.*)$/.exec(l);
              if (!m) return <div key={i}>{l}</div>;
              const [, ts, host, unitName, msg] = m;
              const isErr = /error|fail|fatal|panic/i.test(msg ?? '');
              const isWarn = /warn/i.test(msg ?? '');
              return (
                <div key={i} className="flex gap-2">
                  <span className="text-fg-subtle shrink-0">{ts?.slice(11, 19)}</span>
                  <span className="text-fg-subtle shrink-0 opacity-70">{host}</span>
                  <span className="text-accent/70 shrink-0">{unitName}</span>
                  <span className={cx('min-w-0', isErr ? 'text-danger' : isWarn ? 'text-warn' : '')}>
                    {msg}
                  </span>
                </div>
              );
            })}
          </pre>
        )}
      </div>
    </div>
  );
}

/* ---------------- 主组件 ---------------- */

export function ServicesTab({ active = true }: { active?: boolean }) {
  const [services, setServices] = useState<ServiceEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, Action | undefined>>({});
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [logUnit, setLogUnit] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const r = await api.services();
      setServices(r.services ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : '服务列表读取失败');
      if (!silent) setServices(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void load();
    const id = window.setInterval(() => void load(true), 10000);
    return () => window.clearInterval(id);
  }, [load, active]);

  const doAction = useCallback(
    async (name: string, action: Action) => {
      if (action === 'stop' || action === 'restart') {
        const label = action === 'stop' ? '停止' : '重启';
        if (!window.confirm(`${label} ${name}？`)) return;
      }
      setBusy((b) => ({ ...b, [name]: action }));
      try {
        const r = await api.serviceAction(name, action);
        if (r.pending) {
          setNotice({ kind: 'ok', text: `${name}：已派发，控制台自身会重启，请稍后刷新` });
        } else {
          setNotice({ kind: 'ok', text: `${name}：${action} 完成` });
        }
        window.setTimeout(() => void load(true), 800);
      } catch (e) {
        setNotice({ kind: 'err', text: `${name}：${e instanceof Error ? e.message : '操作失败'}` });
      } finally {
        setBusy((b) => {
          const n = { ...b };
          delete n[name];
          return n;
        });
        window.setTimeout(() => setNotice(null), 4000);
      }
    },
    [load],
  );

  const rows = useMemo(() => {
    const list = services ?? [];
    const kw = filter.trim().toLowerCase();
    if (!kw) return list;
    return list.filter(
      (s) => s.name.toLowerCase().includes(kw) || s.description.toLowerCase().includes(kw),
    );
  }, [services, filter]);

  const counts = useMemo(() => {
    const list = services ?? [];
    return {
      total: list.length,
      running: list.filter((s) => s.active === 'active').length,
      failed: list.filter((s) => s.active === 'failed').length,
    };
  }, [services]);

  return (
    <div className="flex h-[calc(100vh-8.5rem)] min-h-[480px] flex-col gap-3">
      <Card padded={false} className="shrink-0 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] font-medium">systemd 服务</span>
          <Badge tone="ok" dot>
            {counts.running} 运行中
          </Badge>
          {counts.failed > 0 && (
            <Badge tone="danger" dot>
              {counts.failed} 失败
            </Badge>
          )}
          <span className="text-fg-subtle num text-[10.5px]">共 {counts.total} 个（白名单内）</span>

          <div className="relative ml-auto">
            <Search size={11} className="text-fg-subtle absolute top-1/2 left-2 -translate-y-1/2" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="过滤 unit…"
              className="border-line bg-surface-2 text-fg placeholder:text-fg-subtle focus:border-accent/50 h-6 w-[170px] rounded-md border pr-6 pl-6 text-[11px] outline-none transition-colors"
            />
            {filter && (
              <button
                onClick={() => setFilter('')}
                className="text-fg-subtle hover:text-fg absolute top-1/2 right-1.5 -translate-y-1/2"
              >
                <X size={10} />
              </button>
            )}
          </div>
          <Button size="xs" variant="ghost" onClick={() => void load()} title="刷新">
            <RefreshCw size={11} className={loading ? 'spin' : undefined} />
          </Button>
        </div>
      </Card>

      {notice && (
        <div
          className={cx(
            'fade-in shrink-0 rounded-lg border px-3 py-1.5 text-[11.5px]',
            notice.kind === 'ok'
              ? 'border-ok/30 bg-ok/10 text-ok'
              : 'border-danger/30 bg-danger/10 text-danger',
          )}
        >
          {notice.text}
        </div>
      )}

      <div className="flex min-h-0 flex-1 gap-3">
        <Card padded={false} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="border-line text-fg-subtle flex shrink-0 items-center gap-2 border-b px-3 py-1.5 text-[10.5px]">
            <span className="flex-1">Unit</span>
            <span className="w-[84px]">状态</span>
            <span className="w-[80px] text-right">PID</span>
            <span className="w-[120px] text-right">启动于</span>
            <span className="w-[178px] text-right">操作</span>
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            {loading && !services ? (
              <div className="space-y-1 p-3">
                {Array.from({ length: 8 }, (_, i) => (
                  <Skeleton key={i} className="h-7 w-full" />
                ))}
              </div>
            ) : error ? (
              <div className="p-3">
                <ErrorState message="服务列表读取失败" detail={error} onRetry={() => void load()} />
              </div>
            ) : rows.length === 0 ? (
              <div className="p-3">
                {filter ? (
                  <EmptyState
                    compact
                    title="没有匹配的服务"
                    hint={`白名单内没有包含「${filter}」的 unit。`}
                    action={
                      <Button size="xs" onClick={() => setFilter('')}>
                        清除过滤
                      </Button>
                    }
                  />
                ) : (
                  <EmptyState
                    compact
                    title="没有可管理的 systemd unit"
                    hint="后端只暴露白名单内的 unit（dsh-*、binnacle*、jupyter*、docker、containerd、sshd、mihomo、cockpit*）。"
                    action={
                      <Button size="xs" onClick={() => void load()}>
                        重新加载
                      </Button>
                    }
                  />
                )}
              </div>
            ) : (
              <div className="divide-line/60 divide-y">
                {rows.map((s) => {
                  const b = busy[s.name];
                  return (
                    <div
                      key={s.name}
                      className="hover:bg-surface-2/60 flex items-center gap-2 px-3 py-1.5 text-[11.5px] transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="num text-fg truncate">{s.name}</div>
                        <div className="text-fg-subtle truncate text-[10px]">{s.description || '—'}</div>
                      </div>
                      <div className="w-[84px] shrink-0">
                        <Badge tone={activeTone(s.active)} dot>
                          {ACTIVE_LABEL[s.active] ?? s.active}
                        </Badge>
                        <div className="text-fg-subtle num mt-0.5 text-[9.5px]">{s.sub}</div>
                      </div>
                      <span className="num text-fg-subtle w-[80px] shrink-0 text-right text-[10px]">
                        {s.mainPid > 0 ? s.mainPid : '—'}
                      </span>
                      <span className="num text-fg-subtle w-[120px] shrink-0 text-right text-[10px]">
                        {s.sinceUnix > 0
                          ? new Date(s.sinceUnix * 1000).toLocaleString('zh-CN', { hour12: false })
                          : '—'}
                        {s.sinceUnix > 0 && (
                          <div className="text-[9.5px] opacity-70">
                            {fmtAgo(Date.now() - s.sinceUnix * 1000)}
                          </div>
                        )}
                      </span>
                      <div className="flex w-[178px] shrink-0 items-center justify-end gap-1">
                        {b && <Loader2 size={11} className="spin text-accent" />}
                        <Button
                          size="xs"
                          variant="ghost"
                          disabled={!!b}
                          onClick={() => void doAction(s.name, 'start')}
                          title="启动"
                        >
                          <Play size={10} />
                        </Button>
                        <Button
                          size="xs"
                          variant="ghost"
                          disabled={!!b}
                          onClick={() => void doAction(s.name, 'stop')}
                          title="停止"
                        >
                          <Square size={10} />
                        </Button>
                        <Button
                          size="xs"
                          variant="ghost"
                          disabled={!!b}
                          onClick={() => void doAction(s.name, 'restart')}
                          title="重启"
                        >
                          <RotateCw size={10} />
                        </Button>
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => setLogUnit(s.name)}
                          title="查看日志"
                        >
                          <ScrollText size={10} />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </Card>

        {logUnit && (
          <div className="flex w-[min(48%,640px)] min-w-[300px] flex-col">
            <LogPanel unit={logUnit} onClose={() => setLogUnit(null)} />
          </div>
        )}
      </div>
    </div>
  );
}
