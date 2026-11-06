import { useState } from 'react';
import { api, setToken } from './lib/api';
import { useTelemetry } from './store/telemetry';
import { Button } from './components/ui';
import { Loader2 } from 'lucide-react';
import { Logo } from './components/ui';

export function Login() {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const setAuthed = useTelemetry((s) => s.setAuthed);
  const connect = useTelemetry((s) => s.connect);

  const submit = async () => {
    const tok = value.trim();
    if (!tok || busy) return;
    setBusy(true);
    setErr(null);
    try {
      setToken(tok);
      await api.login(tok);
      setAuthed(true);
      connect();
    } catch (e) {
      setToken('');
      setErr(e instanceof Error ? e.message : '登录失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center px-6">
      <div className="fade-in w-full max-w-[360px]">
        <div className="mb-7 flex items-center gap-2.5">
          <div className="border-line bg-surface-2 flex h-9 w-9 items-center justify-center rounded-lg border">
            <Logo size={17} className="text-accent" />
          </div>
          <div>
            <div className="text-[14px] font-medium tracking-tight">binnacle</div>
            <div className="text-fg-subtle text-[11px]">一台机器的驾驶舱</div>
          </div>
        </div>

        <label className="text-fg-muted mb-1.5 block text-[11.5px]" htmlFor="token">
          访问 Token
        </label>
        <input
          id="token"
          type="password"
          autoFocus
          autoComplete="current-password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
          }}
          placeholder="粘贴后端 state/token 中的值"
          className="border-line bg-surface-2 text-fg placeholder:text-fg-subtle focus:border-accent/60 num h-9 w-full rounded-lg border px-3 text-[12px] outline-none transition-colors"
        />

        {err && <div className="text-danger mt-2 text-[11.5px]">{err}</div>}

        <Button
          variant="primary"
          size="md"
          className="mt-3 w-full"
          disabled={!value.trim() || busy}
          onClick={() => void submit()}
        >
          {busy ? <Loader2 size={13} className="spin" /> : null}
          {busy ? '验证中…' : '进入控制台'}
        </Button>

        <p className="text-fg-subtle mt-4 text-[11px] leading-relaxed">
          Token 也可通过 URL 传入：<code className="num text-fg-muted">?token=…</code>，或直接放置
          <code className="num text-fg-muted"> X-Token</code> 请求头。
        </p>
      </div>
    </div>
  );
}
