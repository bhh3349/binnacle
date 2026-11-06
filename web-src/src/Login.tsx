import { useState } from 'react';
import { api, setToken } from './lib/api';
import { useTelemetry } from './store/telemetry';
import { Button, Logo } from './components/ui';
import { Loader2 } from 'lucide-react';

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
    <div className="flex min-h-full items-center justify-center bg-[var(--paper)] px-6">
      <div className="fade-in w-full max-w-[380px]">
        <div className="mb-8 flex items-center gap-3">
          <Logo size={26} className="text-[var(--accent)]" />
          <div>
            <div className="text-[17px] leading-tight font-medium text-[var(--ink)]">binnacle</div>
            <div className="kicker mt-0.5">一台机器的驾驶舱</div>
          </div>
        </div>

        <label className="kicker mb-2 block" htmlFor="token">
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
          placeholder="粘贴 /opt/binnacle/state/token 中的值"
          className="num h-10 w-full border-0 border-b-2 border-[var(--line-strong)] bg-transparent px-0 text-[13px] text-[var(--ink)] transition-colors outline-none placeholder:text-[var(--text-placeholder)] focus:border-[var(--accent)]"
        />

        {err && <div className="mt-2 text-[12px] text-[var(--alert)]">{err}</div>}

        <Button
          variant="accent"
          size="md"
          className="mt-5 w-full"
          disabled={!value.trim() || busy}
          onClick={() => void submit()}
        >
          {busy ? <Loader2 size={13} className="spin" /> : null}
          {busy ? '验证中' : '进入控制台'}
        </Button>

        <p className="mt-6 text-[11.5px] leading-relaxed text-[var(--text-helper)]">
          Token 也可通过 URL 传入 <code className="num text-[var(--text-secondary)]">?token=…</code>
          ，或直接使用 <code className="num text-[var(--text-secondary)]">X-Token</code> 请求头。
        </p>
      </div>
    </div>
  );
}
