import { CloudOff, LogIn } from 'lucide-react';
import { useState } from 'react';
import { api, ApiError, errorMessage, setToken } from '../../api/client';
import type { LoginResponse } from '../../api/types';
import { useApp } from '../../store/app';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { Brand } from './Startup';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return setErr('Enter e-mail and password');
    setBusy(true);
    setErr(null);
    try {
      const r = await api.post<LoginResponse>('/auth/login', { email: email.trim(), password }, { noAuthRedirect: true });
      setToken(r.access_token);
      useApp.getState().enterServer(r.user);
    } catch (e2) {
      setErr(e2 instanceof ApiError && e2.status === 401 ? 'Invalid e-mail or password' : errorMessage(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center bg-bg">
      <div className="flex w-[880px] overflow-hidden rounded-md border border-line bg-panel shadow-pop">
        <div className="relative hidden w-[400px] border-r border-line bg-bg md:block">
          <svg className="absolute inset-0 h-full w-full" viewBox="0 0 400 520" preserveAspectRatio="xMidYMid slice" aria-hidden>
            <defs>
              <pattern id="lg" width="20" height="20" patternUnits="userSpaceOnUse">
                <path d="M20 0H0V20" fill="none" stroke="rgba(148,163,184,0.07)" />
              </pattern>
            </defs>
            <rect width="400" height="520" fill="url(#lg)" />
            {[60, 150, 240, 330].map((x) => (
              <rect key={x} x={x - 3} y={90} width={6} height={330} fill="#2a323d" stroke="#8b98a8" strokeWidth="0.8" />
            ))}
            {[60, 150, 240].map((x) =>
              [90, 200, 330, 420].map((y) => <rect key={`${x}-${y}`} x={x + 3} y={y - 3} width={84} height={6} fill="#2a323d" stroke="#8b98a8" strokeWidth="0.8" />),
            )}
            {[60, 150, 240].map((x) =>
              [
                [93, 197],
                [203, 327],
                [333, 417],
              ].map(([a, b]) => (
                <g key={`${x}-${a}`}>
                  <rect x={x + 3} y={a} width={84} height={b - a} fill="rgba(56,189,248,0.10)" />
                  <path d={`M${x + 20} ${a + 30} l14 -14 M${x + 27} ${a + 34} l14 -14`} stroke="rgba(186,230,253,0.45)" strokeWidth="0.8" />
                </g>
              )),
            )}
            <path d="M60 455 H330" stroke="#22d3ee" strokeWidth="0.8" />
            <path d="M56 459 l8 -8 M326 459 l8 -8" stroke="#22d3ee" strokeWidth="0.8" />
            <text x="195" y="450" fill="#22d3ee" fontSize="10" fontFamily="JetBrains Mono" textAnchor="middle">
              4500
            </text>
          </svg>
          <div className="absolute bottom-5 left-6 right-6 text-xs text-faint">Stick curtain wall · elevation CAD · cut optimisation · nesting · BOM &amp; quotation</div>
        </div>
        <form onSubmit={submit} className="flex-1 p-8" data-testid="login-form">
          <Brand />
          <h2 className="mt-8 text-lg font-semibold">Sign in</h2>
          <p className="mt-1 text-sm text-muted">Use your FenestrationOS account.</p>
          <div className="mt-5 space-y-3">
            <Field label="E-mail">
              <input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="login-email" autoFocus />
            </Field>
            <Field label="Password">
              <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} data-testid="login-password" />
            </Field>
            {err && <div className="rounded border border-err/40 bg-err/10 px-2.5 py-1.5 text-sm text-err">{err}</div>}
            <Button type="submit" variant="solid" className="w-full justify-center" loading={busy} icon={<LogIn className="h-4 w-4" />} data-testid="login-submit">
              Sign in
            </Button>
          </div>
          {import.meta.env.DEV && (
            <div className="mt-4 rounded border border-dashed border-line-strong px-3 py-2 text-xs text-muted">
              <span className="font-semibold text-faint">DEV ONLY · </span>demo user <span className="font-mono">admin@demo.local</span> — password as set in <span className="font-mono">DEMO_PASSWORD</span>
            </div>
          )}
          <div className="mt-6 border-t border-line pt-4">
            <button type="button" className="flex items-center gap-1.5 text-sm text-muted hover:text-fg" onClick={() => useApp.getState().enterOffline()} data-testid="login-offline">
              <CloudOff className="h-3.5 w-3.5" /> Continue in offline demo mode instead
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
