'use client';

import { AlertTriangle, ArrowRight, Loader2 } from 'lucide-react';
import { signIn } from 'next-auth/react';
import { useState } from 'react';
import { Input, Label } from '@/components/ui';
import { cn } from '@/lib/utils';

type Provider = { id: string; name: string };

function MicrosoftLogo() {
  return (
    <svg viewBox="0 0 21 21" className="h-5 w-5" aria-hidden>
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

const LABELS: Record<string, string> = {
  'azure-ad': 'Sign in with Microsoft',
  okta: 'Sign in with Okta',
};

export function SignInPanel({ providers, callbackUrl, error }: { providers: Provider[]; callbackUrl: string; error: string | null }) {
  const [pending, setPending] = useState<string | null>(null);
  const sso = providers.filter((p) => p.id !== 'kato-dev');
  const dev = providers.find((p) => p.id === 'kato-dev');

  return (
    <div className="max-w-md space-y-4">
      {error && (
        <p className="flex items-start gap-2 rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-100 animate-in fade-in slide-in-from-top-1">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </p>
      )}

      {sso.map((p, i) => (
        <button
          key={p.id}
          type="button"
          disabled={pending !== null}
          onClick={() => {
            setPending(p.id);
            void signIn(p.id, { callbackUrl });
          }}
          className={cn(
            'group relative flex h-14 w-full items-center justify-center gap-3 overflow-hidden rounded-2xl px-6 text-base font-semibold transition-all duration-300 disabled:opacity-70',
            i === 0
              ? 'bg-white text-brand-navy shadow-[0_10px_40px_-10px_rgb(0_241_156/0.6)] hover:-translate-y-0.5 hover:shadow-[0_16px_50px_-10px_rgb(0_241_156/0.8)]'
              : 'border border-white/20 bg-white/5 text-white backdrop-blur hover:bg-white/10',
          )}
        >
          {/* light sweep on hover */}
          <span
            className="pointer-events-none absolute inset-y-0 -left-1/2 w-1/3 -skew-x-12 bg-gradient-to-r from-transparent via-brand-green/30 to-transparent transition-transform duration-700 ease-out group-hover:translate-x-[450%]"
            aria-hidden
          />
          {pending === p.id ? <Loader2 className="h-5 w-5 animate-spin" /> : p.id === 'azure-ad' ? <MicrosoftLogo /> : null}
          {LABELS[p.id] ?? `Sign in with ${p.name}`}
          <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
        </button>
      ))}

      {sso.length > 0 && <p className="text-xs text-brand-light2/60">Single sign-on with your Cassava work account. No new password needed.</p>}

      {dev && <DevLogin callbackUrl={callbackUrl} highlighted={sso.length === 0} />}

      {providers.length === 0 && (
        <p className="rounded-xl border border-amber-300/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
          No sign-in method is configured. Set the Entra ID variables (AZURE_AD_CLIENT_ID and friends).
        </p>
      )}
    </div>
  );
}

function DevLogin({ callbackUrl, highlighted }: { callbackUrl: string; highlighted: boolean }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      className={cn('glass-dark space-y-3 rounded-2xl p-4', !highlighted && 'mt-2')}
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        void signIn('kato-dev', { email, name, callbackUrl });
      }}
    >
      <p className="text-xs font-semibold uppercase tracking-wider text-brand-green">Local development login</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="dev-email" className="text-xs text-brand-light2">
            Email
          </Label>
          <Input
            id="dev-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="border-white/15 bg-white/5 text-white placeholder:text-white/40"
            placeholder="you@cassava.tech"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dev-name" className="text-xs text-brand-light2">
            Name
          </Label>
          <Input
            id="dev-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="border-white/15 bg-white/5 text-white placeholder:text-white/40"
            placeholder="Optional"
          />
        </div>
      </div>
      <button
        type="submit"
        disabled={busy || !email}
        className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-brand-green text-sm font-semibold text-brand-navy-deep transition-all hover:-translate-y-0.5 hover:shadow-glow disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Continue
      </button>
    </form>
  );
}
