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
import { Moon, Sun, WifiOff, Circle } from 'lucide-react';
import { Logo } from './components/ui';

type TabKey = 'overview' | 'files' | 'services' | 'terminal';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: '概览' },
  { key: 'files', label: '文件' },
  { key: 'services', label: '服务' },
  { key: 'terminal', label: '终端' },
];

function readTokenFromUrl(): string | null {
  const sp = new URLSearchParams(location.search);
  const t = sp.get('token');
  if (t) {
    setToken(t);
    // 清掉地址栏里的 token，避免留在历史记录
    sp.delete('token');
    const q = sp.toString();
    history.replaceState(null, '', `${location.pathname}${q ? `?${q}` : ''}${location.hash}`);
    return t;
  }
  return null;
}

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
      <span className="text-fg-subtle inline-flex items-center gap-1.5 text-[11px]">
        <Circle size={7} className="fill-ok text-ok" />
        实时
      </span>
    );
  }
  if (conn === 'connecting' || conn === 'idle') {
    return (
      <span className="text-fg-subtle inline-flex items-center gap-1.5 text-[11px]">
        <Circle size={7} className="text-fg-subtle animate-pulse fill-current" />
        连接中
      </span>
    );
  }
  return (
    <span className="text-warn inline-flex items-center gap-1.5 text-[11px]" title="WebSocket 已断开，界面保留最后数据">
      <WifiOff size={11} />
      离线 · {ago === null ? '无数据' : `最后更新 ${ago} 秒前`}
    </span>
  );
}

export function App() {
  const authed = useTelemetry((s) => s.authed);
  const setAuthed = useTelemetry((s) => s.setAuthed);
  const theme = useTheme((s) => s.theme);
  const toggleTheme = useTheme((s) => s.toggle);
  const [tab, setTab] = useState<TabKey>('overview');
  const [booting, setBooting] = useState(true);
  const [bootErr, setBootErr] = useState<string | null>(null);

  // 首次挂载：URL token → 校验 → 建连
  useEffect(() => {
    let cancelled = false;
    const urlTok = readTokenFromUrl();
    const tok = urlTok ?? getToken();
    if (!tok) {
      setAuthed(false);
      setBooting(false);
      return;
    }
    // 有 token 就先当作已认证，同时后台校验一次
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
        // 后端不可达也要进主界面（会显示离线态），但先尝试一次
        bootstrapTelemetry();
        setBooting(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 键盘：1-4 切页签
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
        <div className="text-fg-subtle flex items-center gap-2 text-[12px]">
          <Circle size={7} className="fill-accent text-accent animate-pulse" />
          正在连接后端…
        </div>
      </div>
    );
  }

  if (!authed) return <Login />;

  return (
    <div className="flex h-full min-h-full flex-col">
      {/* 顶栏 */}
      <header className="border-line bg-bg/85 sticky top-0 z-20 border-b backdrop-blur-md">
        <div className="mx-auto flex h-11 max-w-[1560px] items-center gap-3 px-4">
          <div className="flex items-center gap-2">
            <Logo size={15} className="text-accent" />
            <span className="text-[12.5px] font-medium tracking-tight">binnacle</span>
            <span className="text-fg-subtle hidden text-[10.5px] md:inline">一台机器的驾驶舱</span>
          </div>

          <nav className="ml-2 flex items-center gap-0.5" role="tablist">
            {TABS.map((t, i) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={cx(
                  'relative h-7 rounded-md px-2.5 text-[12px] transition-colors duration-150',
                  tab === t.key
                    ? 'bg-surface-2 text-fg font-medium'
                    : 'text-fg-muted hover:text-fg hover:bg-surface-2/60',
                )}
                title={`快捷键 ${i + 1}`}
              >
                {t.label}
              </button>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <ConnIndicator />
            <div className="bg-line h-4 w-px" />
            <button
              onClick={toggleTheme}
              title={theme === 'dark' ? '切换到亮色' : '切换到暗色'}
              className="text-fg-muted hover:text-fg hover:bg-surface-2 flex h-7 w-7 items-center justify-center rounded-md transition-colors"
            >
              {theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
            </button>
          </div>
        </div>
        {bootErr && (
          <div className="border-line bg-warn/5 text-warn border-t px-4 py-1.5 text-center text-[11px]">
            后端健康检查失败（{bootErr}）——界面保留离线态，恢复后自动重连
          </div>
        )}
      </header>

      {/* 内容 */}
      <main className="mx-auto w-full max-w-[1560px] flex-1 px-4 py-4">
        {/* 四个页签常驻挂载，切走只隐藏 —— 保住目录位置、编辑器草稿、终端会话 */}
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

      <footer className="border-line text-fg-subtle mx-auto flex w-full max-w-[1560px] items-center justify-between border-t px-4 py-2 text-[10.5px]">
        <span>binnacle · 一台机器的驾驶舱 · 数据来自本机 collector，无 mock</span>
        <span className="num">快捷键 1-4 切换页签</span>
      </footer>
    </div>
  );
}
