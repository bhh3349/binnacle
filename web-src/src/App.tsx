import { useEffect, useState } from 'react';
import { bootstrapTelemetry, useTelemetry } from './store/telemetry';
import { useTheme } from './store/theme';
import { api, getToken, setToken } from './lib/api';
import { Login } from './Login';
import { OverviewTab } from './tabs/Overview';
import { FilesTab } from './tabs/Files';
import { ServicesTab } from './tabs/Services';
import { TerminalTab } from './tabs/Terminal';
import { cx } from './lib/format';
import { Moon, Sun, WifiOff } from 'lucide-react';
import { Logo } from './components/ui';

type TabKey = 'overview' | 'files' | 'services' | 'terminal';

const TABS: { key: TabKey; label: string; hint: string }[] = [
  { key: 'overview', label: '概览', hint: 'OVERVIEW' },
  { key: 'files', label: '文件', hint: 'FILES' },
  { key: 'services', label: '服务', hint: 'SERVICES' },
  { key: 'terminal', label: '终端', hint: 'TERMINAL' },
];

function readTokenFromUrl(): string | null {
  const sp = new URLSearchParams(location.search);
  const t = sp.get('token');
  if (t) {
    setToken(t);
    sp.delete('token');
    const q = sp.toString();
    history.replaceState(null, '', `${location.pathname}${q ? `?${q}` : ''}${location.hash}`);
    return t;
  }
  return null;
}

/* ── 连接状态指示 ─────────────────────────────────────────────────────── */

function ConnIndicator() {
  const conn = useTelemetry((s) => s.conn);
  const lastDataAt = useTelemetry((s) => s.lastDataAt);
  const [, force] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => force((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const ago = lastDataAt ? Math.max(0, Math.floor((Date.now() - lastDataAt) / 1000)) : null;

  if (conn === 'online') {
    return (
      <span className="kicker inline-flex items-center gap-1.5 text-[var(--ok)]">
        <span className="h-[6px] w-[6px] shrink-0 bg-[var(--ok)]" />
        实时
      </span>
    );
  }
  if (conn === 'connecting' || conn === 'idle') {
    return (
      <span className="kicker inline-flex items-center gap-1.5">
        <span className="h-[6px] w-[6px] shrink-0 animate-pulse bg-[var(--text-placeholder)]" />
        连接中
      </span>
    );
  }
  return (
    <span
      className="kicker inline-flex items-center gap-1.5 text-[var(--warn)]"
      title="WebSocket 已断开，界面保留最后数据"
    >
      <WifiOff size={10} className="shrink-0" />
      离线 · {ago === null ? '无数据' : `${ago}s`}
    </span>
  );
}

/* ── 应用外壳 ─────────────────────────────────────────────────────────── */

export function App() {
  const authed = useTelemetry((s) => s.authed);
  const setAuthed = useTelemetry((s) => s.setAuthed);
  const theme = useTheme((s) => s.theme);
  const toggleTheme = useTheme((s) => s.toggle);
  const [tab, setTab] = useState<TabKey>('overview');
  const [booting, setBooting] = useState(true);
  const [bootErr, setBootErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const urlTok = readTokenFromUrl();
    const tok = urlTok ?? getToken();
    if (!tok) {
      setAuthed(false);
      setBooting(false);
      return;
    }
    setToken(tok);
    setAuthed(true);
    api
      .health()
      .then(() => {
        if (cancelled) return;
        bootstrapTelemetry();
        setBooting(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setBootErr(e instanceof Error ? e.message : '后端不可达');
        bootstrapTelemetry();
        setBooting(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const idx = Number(e.key);
      if (idx >= 1 && idx <= 4) {
        const next = TABS[idx - 1];
        if (next) setTab(next.key);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (booting) {
    return (
      <div className="flex min-h-full items-center justify-center">
        <div className="kicker flex items-center gap-2">
          <span className="h-[6px] w-[6px] animate-pulse bg-[var(--accent)]" />
          正在连接后端
        </div>
      </div>
    );
  }

  if (!authed) return <Login />;

  return (
    <div className="flex min-h-full flex-col bg-[var(--paper)]">
      {/* ── 顶栏：瑞士风，底部一条 2px 实线 ─────────────────────── */}
      <header className="sticky top-0 z-20 bg-[var(--paper)]">
        <div className="mx-auto flex h-12 w-full max-w-[1280px] items-center gap-6 px-6">
          {/* 品牌 */}
          <div className="flex shrink-0 items-center gap-2">
            <Logo size={16} className="text-[var(--accent)]" />
            <span className="text-[13.5px] leading-none font-medium tracking-[0.01em] text-[var(--ink)]">
              binnacle
            </span>
            <span className="kicker hidden lg:inline">驾驶舱</span>
          </div>

          {/* 页签：直角，选中用 accent 下划线 */}
          <nav className="flex items-stretch gap-0" role="tablist">
            {TABS.map((t, i) => {
              const on = tab === t.key;
              return (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={on}
                  onClick={() => setTab(t.key)}
                  title={`快捷键 ${i + 1}`}
                  className={cx(
                    'group relative flex items-center gap-1.5 px-3 py-1 transition-colors duration-150',
                    on
                      ? 'text-[var(--ink)]'
                      : 'text-[var(--text-helper)] hover:text-[var(--ink)]',
                  )}
                >
                  <span className="text-[12.5px] font-medium whitespace-nowrap">{t.label}</span>
                  <span className="num hidden text-[9px] text-[var(--text-placeholder)] lg:inline">
                    {i + 1}
                  </span>
                  <span
                    className={cx(
                      'absolute inset-x-2 -bottom-[13px] h-[2px] transition-colors duration-150',
                      on ? 'bg-[var(--accent)]' : 'bg-transparent',
                    )}
                  />
                </button>
              );
            })}
          </nav>

          {/* 右侧状态 */}
          <div className="ml-auto flex shrink-0 items-center gap-4">
            <ConnIndicator />
            <span className="h-3 w-px bg-[var(--line)]" />
            <button
              onClick={toggleTheme}
              title={theme === 'dark' ? '切换到亮色' : '切换到暗色'}
              className="flex h-6 w-6 items-center justify-center text-[var(--text-helper)] transition-colors hover:text-[var(--ink)]"
            >
              {theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
            </button>
          </div>
        </div>
        <div className="h-[2px] w-full bg-[var(--ink)]" />
        {bootErr && (
          <div className="bg-[var(--paper-3)] px-6 py-1.5 text-center text-[11.5px] text-[var(--warn)]">
            后端健康检查失败（{bootErr}）—— 界面保留离线态，恢复后自动重连
          </div>
        )}
      </header>

      {/* ── 内容 ────────────────────────────────────────────────── */}
      <main className="mx-auto w-full max-w-[1280px] flex-1 px-6 py-6">
        <div className={tab === 'overview' ? 'fade-in' : 'hidden'}>
          <OverviewTab active={tab === 'overview'} />
        </div>
        <div className={tab === 'files' ? 'fade-in' : 'hidden'}>
          <FilesTab active={tab === 'files'} />
        </div>
        <div className={tab === 'services' ? 'fade-in' : 'hidden'}>
          <ServicesTab active={tab === 'services'} />
        </div>
        <div className={tab === 'terminal' ? 'fade-in' : 'hidden'}>
          <TerminalTab active={tab === 'terminal'} />
        </div>
      </main>

      {/* ── 页脚 ────────────────────────────────────────────────── */}
      <footer className="mx-auto flex w-full max-w-[1280px] items-center justify-between gap-4 px-6 py-3">
        <span className="kicker">binnacle · 一台机器的驾驶舱</span>
        <span className="kicker">数据来自本机 collector · 1-4 切换页签</span>
      </footer>
    </div>
  );
}
