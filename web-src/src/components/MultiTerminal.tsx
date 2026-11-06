import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { getToken, wsUrl } from '../lib/api';
import { useTheme } from '../store/theme';
import { cx } from '../lib/format';
import { Button } from './ui';
import { Loader2, Maximize2, Plug, Plus, Trash2, WifiOff, X } from 'lucide-react';

/* ══════════════════════════════════════════════════════════════════════════
   多终端 — 浏览器式标签栏，每个标签一个独立 PTY
   · 后端 /ws/term 每次连接开独立 PTY，互不干扰
   · 切标签只 display:none，xterm 实例与 WS 全部保留
   · 切回来要 rAF 后再 fit()（隐藏时容器宽度为 0）
   · 上限 8 个
   ══════════════════════════════════════════════════════════════════════════ */

const MAX_TERMS = 8;
const FONT_SIZE = 14;

type TermState = 'connecting' | 'open' | 'closed' | 'error';

interface TermTheme {
  background: string;
  foreground: string;
  cursor: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
}

function themeOf(dark: boolean): TermTheme {
  if (dark) {
    return {
      background: '#1d2129',
      foreground: '#e8eaed',
      cursor: '#337eef',
      selectionBackground: 'rgba(51,126,239,0.32)',
      black: '#333538',
      red: '#f56c6c',
      green: '#67c23a',
      yellow: '#e6a23c',
      blue: '#669ef3',
      magenta: '#c084fc',
      cyan: '#22d3ee',
      white: '#cfd3d8',
      brightBlack: '#7d828a',
    };
  }
  return {
    background: '#ffffff',
    foreground: '#1f2329',
    cursor: '#005eeb',
    selectionBackground: 'rgba(0,94,235,0.18)',
    black: '#1f2329',
    red: '#f54a45',
    green: '#00a854',
    yellow: '#ff8800',
    blue: '#005eeb',
    magenta: '#9333ea',
    cyan: '#0e7490',
    white: '#e4e7ed',
    brightBlack: '#8f959e',
  };
}

/** 单个终端会话（xterm + WS），由 MultiTerminal 持有并隐藏/显示 */
interface Session {
  id: string;
  title: string;
  state: TermState;
  errMsg: string | null;
  retries: number;
  term: Terminal;
  fit: FitAddon;
  sock: WebSocket | null;
  /** 最近一次输入的命令行，用于标签标题 */
  lastLine: string;
  disposed: boolean;
}

let seq = 0;

export function MultiTerminal({
  className,
  active = true,
  emptyHint = '点 + 新建终端',
}: {
  className?: string;
  active?: boolean;
  emptyHint?: string;
}) {
  const theme = useTheme((s) => s.theme);
  const [ids, setIds] = useState<string[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [, forceRender] = useState(0);
  const sessions = useRef(new Map<string, Session>());
  const hosts = useRef(new Map<string, HTMLDivElement>());
  const [notice, setNotice] = useState<string | null>(null);

  const notify = useCallback((msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice(null), 2600);
  }, []);

  /* ── 建会话 ─────────────────────────────────────────────────── */

  const connect = useCallback((s: Session) => {
    if (s.disposed) return;
    if (!getToken()) {
      s.state = 'error';
      s.errMsg = '缺少 token';
      forceRender((n) => n + 1);
      return;
    }
    const existing = s.sock;
    if (
      existing &&
      (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)
    )
      return;

    s.state = 'connecting';
    s.errMsg = null;
    forceRender((n) => n + 1);

    let sock: WebSocket;
    try {
      sock = new WebSocket(wsUrl('/ws/term'));
    } catch (e) {
      s.state = 'error';
      s.errMsg = e instanceof Error ? e.message : 'WebSocket 创建失败';
      forceRender((n) => n + 1);
      return;
    }
    sock.binaryType = 'arraybuffer';
    s.sock = sock;

    sock.onopen = () => {
      if (s.disposed) return;
      s.state = 'open';
      s.retries = 0;
      forceRender((n) => n + 1);
      try {
        s.fit.fit();
      } catch {
        /* 隐藏时可能抛，忽略 */
      }
      try {
        sock.send(JSON.stringify({ type: 'resize', cols: s.term.cols, rows: s.term.rows }));
      } catch {
        /* 忽略 */
      }
      s.term.focus();
    };

    sock.onmessage = (ev: MessageEvent<ArrayBuffer | string>) => {
      if (s.disposed) return;
      if (ev.data instanceof ArrayBuffer) s.term.write(new Uint8Array(ev.data));
      else if (typeof ev.data === 'string') s.term.write(ev.data);
    };

    sock.onerror = () => {
      if (s.disposed) return;
      s.state = 'error';
      s.errMsg = 'WebSocket 出错';
      forceRender((n) => n + 1);
    };

    sock.onclose = (ev) => {
      if (s.sock === sock) s.sock = null;
      if (s.disposed) return;
      s.state = s.state === 'error' ? 'error' : 'closed';
      forceRender((n) => n + 1);
      if (ev.code !== 1000) {
        s.retries += 1;
        window.setTimeout(() => {
          if (!s.disposed && s.sock === null) connect(s);
        }, 2500);
      }
    };
  }, []);

  const openSession = useCallback(() => {
    if (sessions.current.size >= MAX_TERMS) {
      notify(`最多 ${MAX_TERMS} 个终端`);
      return;
    }
    const id = `t${++seq}`;
    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontFamily:
        "'JetBrains Mono', ui-monospace, 'DejaVu Sans Mono', Menlo, Consolas, monospace",
      fontSize: FONT_SIZE,
      lineHeight: 1.35,
      letterSpacing: 0,
      scrollback: 8000,
      allowProposedApi: true,
      convertEol: false,
      theme: themeOf(document.documentElement.classList.contains('dark')),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());

    const s: Session = {
      id,
      title: `终端 ${sessions.current.size + 1}`,
      state: 'connecting',
      errMsg: null,
      retries: 0,
      term,
      fit,
      sock: null,
      lastLine: '',
      disposed: false,
    };

    // 记录输入的最后一行，用于标签标题
    term.onData((data) => {
      const sock = s.sock;
      if (sock && sock.readyState === WebSocket.OPEN) {
        sock.send(JSON.stringify({ type: 'input', data }));
      }
      if (data === '\r' || data === '\n') {
        if (s.lastLine.trim()) {
          s.title = s.lastLine.trim().slice(0, 24);
          forceRender((n) => n + 1);
        }
        s.lastLine = '';
      } else if (data === '\u007f') {
        s.lastLine = s.lastLine.slice(0, -1);
      } else if (data.length === 1 && data >= ' ') {
        s.lastLine += data;
      }
    });

    term.onResize(({ cols, rows }) => {
      const sock = s.sock;
      if (sock && sock.readyState === WebSocket.OPEN) {
        sock.send(JSON.stringify({ type: 'resize', cols, rows }));
      }
    });

    sessions.current.set(id, s);
    setIds((prev) => [...prev, id]);
    setCurrent(id);
    // 等 DOM 挂上再 open + connect
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const host = hosts.current.get(id);
        if (!host || s.disposed) return;
        term.open(host);
        try {
          fit.fit();
        } catch {
          /* 忽略 */
        }
        connect(s);
      });
    });
  }, [connect, notify]);

  const closeSession = useCallback((id: string) => {
    const s = sessions.current.get(id);
    if (!s) return;
    s.disposed = true;
    if (s.sock) {
      try {
        s.sock.close();
      } catch {
        /* 忽略 */
      }
      s.sock = null;
    }
    try {
      s.term.dispose();
    } catch {
      /* 忽略 */
    }
    sessions.current.delete(id);
    hosts.current.delete(id);
    setIds((prev) => {
      const next = prev.filter((x) => x !== id);
      setCurrent((cur) => {
        if (cur !== id) return cur;
        const idx = prev.indexOf(id);
        return next[Math.min(idx, next.length - 1)] ?? null;
      });
      return next;
    });
  }, []);

  /* ── 挂载 host 回调 ─────────────────────────────────────────── */

  const setHost = useCallback(
    (id: string) => (el: HTMLDivElement | null) => {
      if (el) hosts.current.set(id, el);
      else hosts.current.delete(id);
    },
    [],
  );

  /* ── 当前标签变化：rAF 后 fit（隐藏时宽度为 0）───────────────── */

  useEffect(() => {
    if (!current) return;
    const s = sessions.current.get(current);
    if (!s) return;
    let raf1 = 0;
    let raf2 = 0;
    raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(() => {
        try {
          s.fit.fit();
        } catch {
          /* 忽略 */
        }
        s.term.focus();
      });
    });
    return () => {
      window.cancelAnimationFrame(raf1);
      window.cancelAnimationFrame(raf2);
    };
  }, [current, active]);

  /* ── 容器尺寸变化：给当前标签 fit ────────────────────────────── */

  useEffect(() => {
    if (!current) return;
    const host = hosts.current.get(current);
    if (!host) return;
    const ro = new ResizeObserver(() => {
      const s = sessions.current.get(current);
      if (!s) return;
      try {
        s.fit.fit();
      } catch {
        /* 忽略 */
      }
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, [current, ids.length]);

  /* ── 主题切换 ───────────────────────────────────────────────── */

  useEffect(() => {
    const t = themeOf(theme === 'dark');
    for (const s of sessions.current.values()) {
      s.term.options.theme = t;
    }
  }, [theme, ids.length]);

  /* ── 首次进入自动开一个 ─────────────────────────────────────── */

  useEffect(() => {
    if (active && sessions.current.size === 0) openSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const cur = current ? sessions.current.get(current) : null;
  const atMax = ids.length >= MAX_TERMS;

  const reconnect = () => {
    if (!cur) return;
    if (cur.sock) {
      try {
        cur.sock.close();
      } catch {
        /* 忽略 */
      }
      cur.sock = null;
    }
    cur.term.reset();
    connect(cur);
  };

  return (
    <div className={cx('flex min-h-0 flex-col', className)}>
      {/* ── 标签栏 ─────────────────────────────────────────────── */}
      <div className="flex shrink-0 items-center gap-1 border-b border-[var(--line)] bg-[var(--paper-3)] px-1.5 py-1">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {ids.map((id, i) => {
            const s = sessions.current.get(id);
            const on = id === current;
            return (
              <div
                key={id}
                className={cx(
                  'group flex h-7 max-w-[190px] min-w-0 shrink-0 items-center gap-1 rounded-[4px] pr-1 pl-2 text-[12px] transition-colors',
                  on
                    ? 'bg-[var(--paper-2)] font-medium text-[var(--text-primary)] shadow-[0_1px_2px_rgba(0,21,41,0.06)]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--paper-2)]/70',
                )}
              >
                <button
                  onClick={() => setCurrent(id)}
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                  title={s?.title ?? `终端 ${i + 1}`}
                >
                  <span
                    className={cx(
                      'h-[6px] w-[6px] shrink-0 rounded-full',
                      s?.state === 'open'
                        ? 'bg-[var(--ok)]'
                        : s?.state === 'connecting'
                          ? 'animate-pulse bg-[var(--text-placeholder)]'
                          : 'bg-[var(--alert)]',
                    )}
                  />
                  <span className="truncate">{s?.title ?? `终端 ${i + 1}`}</span>
                </button>
                <button
                  onClick={() => closeSession(id)}
                  className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] text-[var(--text-placeholder)] transition-colors hover:bg-[var(--paper-3)] hover:text-[var(--alert)]"
                  title="关闭终端"
                >
                  <X size={10} />
                </button>
              </div>
            );
          })}
        </div>

        <button
          onClick={openSession}
          disabled={atMax}
          title={atMax ? `最多 ${MAX_TERMS} 个终端` : '新建终端'}
          className={cx(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-[4px] transition-colors',
            atMax
              ? 'cursor-not-allowed text-[var(--text-placeholder)]'
              : 'text-[var(--text-secondary)] hover:bg-[var(--paper-2)] hover:text-[var(--accent)]',
          )}
        >
          <Plus size={14} />
        </button>
      </div>

      {/* ── 操作条 ─────────────────────────────────────────────── */}
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--line)] bg-[var(--paper-2)] px-2 py-1">
        {cur?.state === 'open' ? (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--text-helper)]">
            <span className="h-[6px] w-[6px] rounded-full bg-[var(--ok)]" />
            已连接 · PTY bash -l
          </span>
        ) : cur?.state === 'connecting' ? (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--text-helper)]">
            <Loader2 size={10} className="spin" />
            连接中…
          </span>
        ) : cur?.state === 'closed' ? (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--warn)]">
            <WifiOff size={10} />
            已断开{cur.retries > 0 ? ` · 第 ${cur.retries} 次重连中` : ''}
          </span>
        ) : cur?.state === 'error' ? (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--alert)]">
            <WifiOff size={10} />
            {cur.errMsg ?? '连接失败'}
          </span>
        ) : (
          <span className="text-[11px] text-[var(--text-helper)]">无终端</span>
        )}

        <div className="ml-auto flex items-center gap-1">
          <Button
            size="xs"
            variant="quiet"
            onClick={() => {
              cur?.term.clear();
              cur?.term.focus();
            }}
            title="清屏"
          >
            <Trash2 size={11} />
          </Button>
          <Button
            size="xs"
            variant="quiet"
            onClick={() => {
              try {
                cur?.fit.fit();
              } catch {
                /* 忽略 */
              }
            }}
            title="适应窗口"
          >
            <Maximize2 size={11} />
          </Button>
          <Button size="xs" variant="outline" onClick={reconnect} title="重连">
            <Plug size={11} />
            重连
          </Button>
        </div>
      </div>

      {/* ── 终端体：全部渲染，非当前 display:none ─────────────── */}
      <div className="relative min-h-0 flex-1 overflow-hidden bg-[var(--paper-2)]">
        {ids.map((id) => (
          <div
            key={id}
            ref={setHost(id)}
            className={cx(
              'term-host absolute inset-0 overflow-hidden',
              id === current ? 'block' : 'hidden',
            )}
            onClick={() => {
              const s = sessions.current.get(id);
              s?.term.focus();
            }}
          />
        ))}

        {ids.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2">
            <div className="text-[12.5px] text-[var(--text-secondary)]">没有打开的终端</div>
            <div className="text-[11.5px] text-[var(--text-helper)]">{emptyHint}</div>
            <Button size="sm" variant="accent" onClick={openSession}>
              <Plus size={12} />
              新建终端
            </Button>
          </div>
        )}
      </div>

      {notice && (
        <div className="absolute right-3 bottom-3 z-10 rounded-[4px] border border-[var(--warn)]/40 bg-[var(--paper-2)] px-2.5 py-1 text-[11.5px] text-[var(--warn)]">
          {notice}
        </div>
      )}
    </div>
  );
}
