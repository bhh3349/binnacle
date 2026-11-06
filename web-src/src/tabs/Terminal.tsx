import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { getToken, wsUrl } from '../lib/api';
import { useTheme } from '../store/theme';
import { Button } from '../components/ui';
import { cx } from '../lib/format';
import { Circle, Loader2, Maximize2, Plug, Trash2, WifiOff } from 'lucide-react';

type TermState = 'connecting' | 'open' | 'closed' | 'error';

function themeOf(dark: boolean): {
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
} {
  if (dark) {
    return {
      background: '#0d0e11',
      foreground: '#eceef2',
      cursor: '#818cf8',
      selectionBackground: 'rgba(129,140,248,0.28)',
      black: '#1e2025',
      red: '#f87171',
      green: '#4ade80',
      yellow: '#fbbf24',
      blue: '#60a5fa',
      magenta: '#c084fc',
      cyan: '#22d3ee',
      white: '#d4d7dd',
      brightBlack: '#6b7280',
    };
  }
  return {
    background: '#fcfcfd',
    foreground: '#16181d',
    cursor: '#4f46e5',
    selectionBackground: 'rgba(79,70,229,0.2)',
    black: '#16181d',
    red: '#dc2626',
    green: '#15803d',
    yellow: '#a16207',
    blue: '#2563eb',
    magenta: '#9333ea',
    cyan: '#0e7490',
    white: '#e7e8ec',
    brightBlack: '#8e939d',
  };
}

export function TerminalTab({ active }: { active: boolean }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [state, setState] = useState<TermState>('connecting');
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [retries, setRetries] = useState(0);
  const theme = useTheme((s) => s.theme);
  const retryRef = useRef<number | null>(null);
  const manualRef = useRef(false);

  /* --- 初始化 xterm（只一次） --- */
  useEffect(() => {
    const host = hostRef.current;
    if (!host || termRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontFamily:
        "ui-monospace, 'JetBrains Mono', 'DejaVu Sans Mono', Menlo, Consolas, monospace",
      fontSize: 12.5,
      lineHeight: 1.32,
      letterSpacing: 0,
      scrollback: 8000,
      allowProposedApi: true,
      convertEol: false,
      theme: themeOf(document.documentElement.classList.contains('dark')),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(host);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    term.writeln('\x1b[38;5;245mbinnacle 终端 · 后端 PTY (bash -l)\x1b[0m');
    term.writeln('\x1b[38;5;245m等待 WebSocket 连接…\x1b[0m');

    return () => {
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, []);

  /* --- 连接 --- */
  const connect = useCallback(() => {
    const term = termRef.current;
    if (!term) return;
    if (!getToken()) {
      setState('error');
      setErrMsg('缺少 token，无法建立终端连接');
      return;
    }
    const existing = wsRef.current;
    if (existing && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING))
      return;

    setState('connecting');
    setErrMsg(null);

    let sock: WebSocket;
    try {
      sock = new WebSocket(wsUrl('/ws/term'));
    } catch (e) {
      setState('error');
      setErrMsg(e instanceof Error ? e.message : 'WebSocket 创建失败');
      return;
    }
    sock.binaryType = 'arraybuffer';
    wsRef.current = sock;

    sock.onopen = () => {
      setState('open');
      setRetries(0);
      // 首次握手后同步尺寸
      const fit = fitRef.current;
      fit?.fit();
      const { cols, rows } = term;
      try {
        sock.send(JSON.stringify({ type: 'resize', cols, rows }));
      } catch {
        /* 忽略 */
      }
      term.focus();
    };

    sock.onmessage = (ev: MessageEvent<ArrayBuffer | string>) => {
      if (ev.data instanceof ArrayBuffer) {
        term.write(new Uint8Array(ev.data));
      } else if (typeof ev.data === 'string') {
        term.write(ev.data);
      }
    };

    sock.onerror = () => {
      setState('error');
      setErrMsg('终端 WebSocket 出错');
    };

    sock.onclose = (ev) => {
      if (wsRef.current === sock) wsRef.current = null;
      setState((s) => (s === 'error' ? 'error' : 'closed'));
      if (ev.code !== 1000 && !manualRef.current) {
        setRetries((n) => n + 1);
        if (retryRef.current !== null) window.clearTimeout(retryRef.current);
        retryRef.current = window.setTimeout(() => connect(), 2500);
      }
    };
  }, []);

  /* --- 键盘输入 --- */
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    const sub = term.onData((data) => {
      const sock = wsRef.current;
      if (sock && sock.readyState === WebSocket.OPEN) {
        sock.send(JSON.stringify({ type: 'input', data }));
      }
    });
    const subResize = term.onResize(({ cols, rows }) => {
      const sock = wsRef.current;
      if (sock && sock.readyState === WebSocket.OPEN) {
        sock.send(JSON.stringify({ type: 'resize', cols, rows }));
      }
    });
    return () => {
      sub.dispose();
      subResize.dispose();
    };
  }, []);

  /* --- 只在页签激活时连 --- */
  useEffect(() => {
    if (!active) return;
    manualRef.current = false;
    connect();
    return () => {
      // 切走时不断开，保留会话（终端切回来还在）
    };
  }, [active, connect]);

  /* --- 尺寸自适应 --- */
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const ro = new ResizeObserver(() => {
      const fit = fitRef.current;
      const term = termRef.current;
      if (!fit || !term) return;
      try {
        fit.fit();
      } catch {
        /* 容器隐藏时会抛，忽略 */
      }
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  /* --- 主题切换 --- */
  useEffect(() => {
    const term = termRef.current;
    if (term) term.options.theme = themeOf(theme === 'dark');
  }, [theme]);

  const reconnect = () => {
    manualRef.current = false;
    const sock = wsRef.current;
    if (sock) {
      try {
        sock.close();
      } catch {
        /* 忽略 */
      }
      wsRef.current = null;
    }
    termRef.current?.reset();
    connect();
  };

  const clear = () => {
    termRef.current?.clear();
    termRef.current?.focus();
  };

  const fitNow = () => {
    fitRef.current?.fit();
    const term = termRef.current;
    const sock = wsRef.current;
    if (term && sock && sock.readyState === WebSocket.OPEN) {
      sock.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    }
  };

  return (
    <div className="flex h-[calc(100vh-8.5rem)] min-h-[420px] flex-col gap-2">
      {/* 工具条 */}
      <div className="border-[var(--line)] bg-[var(--paper-2)] flex shrink-0 items-center gap-2 rounded-none border px-3 py-1.5">
        <span className="text-[12px] font-medium">终端</span>
        {state === 'open' ? (
          <span className="text-[var(--text-helper)] inline-flex items-center gap-1 text-[10.5px]">
            <Circle size={7} className="fill-[var(--ok)] text-[var(--ok)]" />
            已连接 · PTY bash -l
          </span>
        ) : state === 'connecting' ? (
          <span className="text-[var(--text-helper)] inline-flex items-center gap-1 text-[10.5px]">
            <Loader2 size={10} className="spin" />
            连接中…
          </span>
        ) : state === 'closed' ? (
          <span className="text-[var(--warn)] inline-flex items-center gap-1 text-[10.5px]">
            <WifiOff size={10} />
            已断开{retries > 0 ? ` · 第 ${retries} 次重连中` : ''}
          </span>
        ) : (
          <span className="text-[var(--alert)] inline-flex items-center gap-1 text-[10.5px]">
            <WifiOff size={10} />
            {errMsg ?? '连接失败'}
          </span>
        )}

        <div className="ml-auto flex items-center gap-1">
          <Button size="xs" variant="quiet" onClick={clear} title="清屏">
            <Trash2 size={11} />
          </Button>
          <Button size="xs" variant="quiet" onClick={fitNow} title="适应窗口">
            <Maximize2 size={11} />
          </Button>
          <Button size="xs" variant="outline" onClick={reconnect} title="重连">
            <Plug size={11} />
            重连
          </Button>
        </div>
      </div>

      {/* 终端主体 */}
      <div
        className={cx(
          'border-[var(--line)] bg-[var(--paper-2)] term-host relative min-h-0 flex-1 overflow-hidden rounded-none border',
        )}
        onClick={() => termRef.current?.focus()}
      >
        <div ref={hostRef} className="h-full w-full" />
        {state !== 'open' && (
          <div className="bg-[var(--paper)]/85 pointer-events-none absolute inset-x-0 top-0 flex justify-center p-2 ">
            <div
              className={cx(
                'pointer-events-auto flex items-center gap-2 rounded-none border px-2.5 py-1 text-[11px]',
                state === 'error'
                  ? 'border-[var(--alert)]/40 bg-[var(--alert)]/10 text-[var(--alert)]'
                  : 'border-[var(--line)] bg-[var(--paper-3)] text-[var(--text-secondary)]',
              )}
            >
              {state === 'error' ? <WifiOff size={11} /> : <Loader2 size={11} className="spin" />}
              {state === 'error'
                ? (errMsg ?? '终端连接失败')
                : state === 'closed'
                  ? '连接已断开，正在自动重连…'
                  : '正在建立 PTY 连接…'}
              <Button size="xs" variant="quiet" onClick={reconnect}>
                立即重连
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
