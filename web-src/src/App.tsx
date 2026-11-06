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
import {
  Activity,
  Folder,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Sun,
  TerminalSquare,
  WifiOff,
  type LucideIcon,
} from 'lucide-react';
import { Logo } from './components/ui';

type TabKey = 'overview' | 'files' | 'services' | 'terminal';

interface MenuEntry {
  key: TabKey;
  label: string;
  icon: LucideIcon;
}

const MENU_GROUPS: { title: string; items: MenuEntry[] }[] = [
  {
    title: '监控',
    items: [{ key: 'overview', label: '概览', icon: Activity }],
  },
  {
    title: '管理',
    items: [
      { key: 'files', label: '文件', icon: Folder },
      { key: 'services', label: '服务', icon: TerminalSquare },
      { key: 'terminal', label: '终端', icon: TerminalSquare },
    ],
  },
];

const ALL_ITEMS: MenuEntry[] = MENU_GROUPS.flatMap((g) => g.items);

const PAGE_TITLE: Record<TabKey, string> = {
  overview: '概览',
  files: '文件管理',
  services: '服务管理',
  terminal: '终端',
};

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

/* ── 连接状态 ─────────────────────────────────────────────────────────── */

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
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[color-mix(in_oklab,var(--ok)_10%,transparent)] px-2 py-[3px] text-[11px] font-medium text-[var(--ok)]">
        <span className="h-[6px] w-[6px] shrink-0 rounded-full bg-[var(--ok)]" />
        实时
      </span>
    );
  }
  if (conn === 'connecting' || conn === 'idle') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--paper-3)] px-2 py-[3px] text-[11px] font-medium text-[var(--text-helper)]">
        <span className="h-[6px] w-[6px] shrink-0 animate-pulse rounded-full bg-[var(--text-placeholder)]" />
        连接中
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full bg-[color-mix(in_oklab,var(--warn)_12%,transparent)] px-2 py-[3px] text-[11px] font-medium text-[var(--warn)]"
      title="WebSocket 已断开，界面保留最后数据"
    >
      <WifiOff size={10} className="shrink-0" />
      离线 · {ago === null ? '无数据' : `${ago}s`}
    </span>
  );
}

/* ── 侧栏 ─────────────────────────────────────────────────────────────── */

function Sidebar({
  tab,
  setTab,
  collapsed,
  setCollapsed,
}: {
  tab: TabKey;
  setTab: (t: TabKey) => void;
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
}) {
  return (
    <aside
      className={cx(
        'flex shrink-0 flex-col border-r border-[var(--line)] bg-[var(--paper-2)] transition-[width] duration-200',
        collapsed ? 'w-16' : 'w-[180px]',
      )}
    >
      {/* 品牌 */}
      <div
        className={cx(
          'flex h-12 shrink-0 items-center gap-2 border-b border-[var(--line)] px-4',
          collapsed && 'justify-center px-0',
        )}
      >
        <Logo size={20} className="shrink-0 text-[var(--accent)]" />
        {!collapsed && (
          <span className="truncate text-[14px] font-semibold tracking-tight text-[var(--text-primary)]">
            binnacle
          </span>
        )}
      </div>

      {/* 菜单 */}
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-3" role="navigation">
        {MENU_GROUPS.map((group) => (
          <div key={group.title} className="mb-4">
            {!collapsed && (
              <div className="kicker mb-1 px-2">{group.title}</div>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const on = tab === item.key;
                const Icon = item.icon;
                return (
                  <button
                    key={item.key}
                    onClick={() => setTab(item.key)}
                    title={collapsed ? item.label : undefined}
                    aria-current={on ? 'page' : undefined}
                    className={cx(
                      'relative flex h-9 w-full items-center gap-2.5 rounded-[6px] px-2.5 text-[13px] transition-colors duration-150',
                      collapsed && 'justify-center px-0',
                      on
                        ? 'bg-[var(--accent-soft)] font-medium text-[var(--accent)]'
                        : 'text-[var(--text-secondary)] hover:bg-[var(--paper-3)] hover:text-[var(--ink)]',
                    )}
                  >
                    {/* 选中左侧竖条 */}
                    {on && (
                      <span className="absolute top-1/2 left-0 h-4 w-[3px] -translate-y-1/2 rounded-full bg-[var(--accent)]" />
                    )}
                    <Icon size={15} className="shrink-0" />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* 折叠按钮 */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className={cx(
          'flex h-10 shrink-0 items-center gap-2 border-t border-[var(--line)] px-4 text-[12px] text-[var(--text-helper)] transition-colors hover:text-[var(--ink)]',
          collapsed && 'justify-center px-0',
        )}
        title={collapsed ? '展开侧栏' : '收起侧栏'}
      >
        {collapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
        {!collapsed && <span>收起</span>}
      </button>
    </aside>
  );
}

/* ── 应用外壳 ─────────────────────────────────────────────────────────── */

export function App() {
  const authed = useTelemetry((s) => s.authed);
  const setAuthed = useTelemetry((s) => s.setAuthed);
  const theme = useTheme((s) => s.theme);
  const toggleTheme = useTheme((s) => s.toggle);
  const [tab, setTab] = useState<TabKey>('overview');
  const [collapsed, setCollapsed] = useState(false);
  const [narrow, setNarrow] = useState(false);
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

  // ≤1024px 侧栏自动收成图标条
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1024px)');
    const apply = () => {
      setNarrow(mq.matches);
      if (mq.matches) setCollapsed(true);
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  // 快捷键 1-4
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const idx = Number(e.key);
      if (idx >= 1 && idx <= 4) {
        const next = ALL_ITEMS[idx - 1];
        if (next) setTab(next.key);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (booting) {
    return (
      <div className="flex min-h-full items-center justify-center bg-[var(--paper)]">
        <div className="flex items-center gap-2 text-[13px] text-[var(--text-helper)]">
          <Logo size={16} className="animate-pulse text-[var(--accent)]" />
          正在连接后端…
        </div>
      </div>
    );
  }

  if (!authed) return <Login />;

  const itemIndex = ALL_ITEMS.findIndex((i) => i.key === tab);

  return (
    <div className="flex h-full min-h-full bg-[var(--paper)]">
      <Sidebar tab={tab} setTab={setTab} collapsed={collapsed} setCollapsed={setCollapsed} />

      <div className="flex min-h-full min-w-0 flex-1 flex-col">
        {/* ── 顶栏：白底，标题 + 状态 ─────────────────────────── */}
        <header className="sticky top-0 z-20 shrink-0 border-b border-[var(--line)] bg-[var(--paper-2)]">
          <div className="flex h-12 items-center gap-3 px-5">
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="truncate text-[15px] font-medium text-[var(--text-primary)]">
                {PAGE_TITLE[tab]}
              </h1>
              <span className="num hidden shrink-0 rounded bg-[var(--paper-3)] px-1.5 py-[1px] text-[10px] text-[var(--text-helper)] sm:inline">
                {itemIndex + 1}
              </span>
            </div>

            <div className="ml-auto flex shrink-0 items-center gap-3">
              <ConnIndicator />
              <span className="h-4 w-px bg-[var(--line)]" />
              <button
                onClick={toggleTheme}
                title={theme === 'dark' ? '切换到亮色' : '切换到暗色'}
                className="flex h-7 w-7 items-center justify-center rounded-[4px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--paper-3)] hover:text-[var(--ink)]"
              >
                {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
              </button>
            </div>
          </div>
          {bootErr && (
            <div className="border-t border-[var(--warn)]/25 bg-[color-mix(in_oklab,var(--warn)_8%,transparent)] px-5 py-1.5 text-center text-[11.5px] text-[var(--warn)]">
              后端健康检查失败（{bootErr}）—— 界面保留离线态，恢复后自动重连
            </div>
          )}
        </header>

        {/* ── 内容区：浅灰底 ──────────────────────────────────── */}
        <main className="min-h-0 flex-1 overflow-y-auto p-5">
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

        {/* ── 页脚 ───────────────────────────────────────────── */}
        <footer className="flex h-9 shrink-0 items-center justify-between border-t border-[var(--line)] bg-[var(--paper-2)] px-5">
          <span className="text-[11px] text-[var(--text-placeholder)]">
            binnacle · 一台机器的驾驶舱
          </span>
          <span className="num text-[10.5px] text-[var(--text-placeholder)]">
            {narrow ? '图标栏模式' : '快捷键 1-4 切换页签'}
          </span>
        </footer>
      </div>
    </div>
  );
}
