import { ArrowDown, FileText, MessagesSquare, Rocket, ShieldCheck } from 'lucide-react';
import { redirect } from 'next/navigation';
import { Aurora, KatoLogo } from '@/components/brand';
import { Reveal, RotatingWords, Spotlight } from '@/components/motion';
import { authOptions, getCurrentUser } from '@/lib/auth';
import { ProductPreview } from './product-preview';
import { SignInPanel } from './sign-in-panel';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sign in · Kato' };

const ERRORS: Record<string, string> = {
  AccessDenied: 'Your account is not allowed to use Kato. Contact the IT service desk if you think this is wrong.',
  OAuthSignin: 'Could not reach the sign-in service. Please try again.',
  OAuthCallback: 'Sign-in did not complete. Please try again.',
  Callback: 'Sign-in did not complete. Please try again.',
  CredentialsSignin: 'Those details were not accepted.',
  SessionRequired: 'Please sign in to continue.',
  Default: 'Something went wrong while signing you in. Please try again.',
};

const STEPS = [
  {
    icon: MessagesSquare,
    title: 'Describe it in your words',
    body: 'Chat with Kato like you would with a business analyst. No forms, no templates, no jargon.',
  },
  {
    icon: FileText,
    title: 'Watch the BRD build itself',
    body: 'Problem, goals, KPIs and USD impact fill in live as you talk, and Kato asks for whatever is missing.',
  },
  {
    icon: ShieldCheck,
    title: 'IT reviews with full context',
    body: 'Kato scores business value and recommends a delivery route, so reviewers decide quickly and fairly.',
  },
  {
    icon: Rocket,
    title: 'Straight into delivery',
    body: 'Approved requests land in Jira as an epic and in Confluence as a BRD, ready for the Software Factory.',
  },
];

/** Only same-site relative paths, so the page can't be used to bounce users elsewhere. */
function safeCallback(v: string | undefined) {
  return v && v.startsWith('/') && !v.startsWith('//') ? v : '/';
}

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ callbackUrl?: string; error?: string }> }) {
  const { callbackUrl, error } = await searchParams;
  const callback = safeCallback(callbackUrl);
  if (await getCurrentUser()) redirect(callback);

  // User options (e.g. the dev login's id 'kato-dev') are merged by NextAuth at request time, so read them here
  const providers = authOptions.providers.map((p) => {
    const o = (p as { options?: { id?: string; name?: string } }).options;
    return { id: o?.id ?? p.id, name: o?.name ?? p.name };
  });
  const errorMessage = error ? (ERRORS[error] ?? ERRORS.Default) : null;

  return (
    <main id="top" className="relative min-h-dvh overflow-x-hidden scroll-smooth bg-brand-navy-deep text-white">
      <Aurora intensity="vivid" />

      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="relative mx-auto flex min-h-dvh max-w-7xl flex-col px-6 lg:px-10">
        <header className="flex items-center justify-between py-6 animate-in fade-in slide-in-from-top-2 duration-700">
          <KatoLogo tone="dark" subtitle="Cassava AI Software Factory" />
          <span className="hidden items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-brand-light2 backdrop-blur sm:inline-flex">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-green" /> Internal · Cassava employees only
          </span>
        </header>

        <div className="grid flex-1 items-center gap-14 py-10 lg:grid-cols-[1.05fr_1fr]">
          <div className="space-y-8">
            <p className="inline-flex items-center gap-2 rounded-full border border-brand-green/30 bg-brand-green/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-brand-green animate-in fade-in slide-in-from-bottom-2 duration-700">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-green opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-green" />
              </span>
              Demand intake, reimagined
            </p>

            <h1 className="text-4xl font-bold leading-[1.08] tracking-tight sm:text-5xl xl:text-6xl animate-in fade-in slide-in-from-bottom-4 duration-700 [animation-delay:120ms] [animation-fill-mode:both]">
              Turn your idea into
              <br />
              <RotatingWords
                words={['working software', 'a signed-off BRD', 'an AI agent', 'a Jira epic', 'real impact']}
                className="pb-1"
                wordClassName="text-gradient-brand"
              />
            </h1>

            <p className="max-w-xl text-lg leading-relaxed text-brand-light2/85 animate-in fade-in slide-in-from-bottom-4 duration-700 [animation-delay:240ms] [animation-fill-mode:both]">
              Kato is the Software Factory&apos;s AI business analyst. Talk it through, and Kato writes the Business Requirements Document, sizes the value and
              routes it to IT for approval.
            </p>

            <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 [animation-delay:360ms] [animation-fill-mode:both]">
              <SignInPanel providers={providers} callbackUrl={callback} error={errorMessage} />
            </div>
          </div>

          <div className="relative hidden animate-in fade-in zoom-in-95 duration-1000 [animation-delay:300ms] [animation-fill-mode:both] lg:block">
            <ProductPreview />
          </div>
        </div>

        <a
          href="#how-it-works"
          className="mx-auto mb-8 inline-flex flex-col items-center gap-1 text-xs text-brand-light2/70 transition-colors hover:text-brand-green"
        >
          How Kato works
          <ArrowDown className="h-4 w-4 animate-bounce" />
        </a>
      </section>

      {/* ── How it works ─────────────────────────────────────── */}
      <section id="how-it-works" className="relative mx-auto max-w-7xl scroll-mt-10 px-6 pb-28 lg:px-10">
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-green">From idea to delivery</p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Four steps. One conversation.</h2>
          <p className="mt-4 text-brand-light2/80">Everything IT needs to say yes, captured the first time.</p>
        </Reveal>

        <div className="relative mt-16">
          {/* animated connector behind the cards */}
          <div className="absolute left-0 right-0 top-12 hidden h-px overflow-hidden lg:block" aria-hidden>
            <div className="h-full w-full animate-shimmer bg-[linear-gradient(90deg,transparent,#00F19C,#57ACCF,#8D4FE3,transparent)] bg-[length:200%_100%]" />
          </div>
          <ol className="relative grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <Reveal key={s.title} as="li" delay={i * 120}>
                <Spotlight className="glass-dark group h-full rounded-2xl p-6 transition-transform duration-300 hover:-translate-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-brand-green to-brand-light1 text-brand-navy-deep shadow-glow transition-transform duration-300 group-hover:rotate-[-6deg] group-hover:scale-110">
                      <s.icon className="h-6 w-6" />
                    </span>
                    <span className="font-heading text-4xl font-bold text-white/10 transition-colors group-hover:text-brand-green/30">0{i + 1}</span>
                  </div>
                  <h3 className="mt-6 text-lg font-semibold">{s.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-brand-light2/75">{s.body}</p>
                </Spotlight>
              </Reveal>
            ))}
          </ol>
        </div>

        <Reveal className="mt-24">
          <div className="ring-gradient relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-navy to-brand-navy-deep px-8 py-12 text-center sm:px-16">
            <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-brand-green/20 blur-3xl" aria-hidden />
            <h2 className="relative text-2xl font-bold sm:text-3xl">Got a problem worth solving?</h2>
            <p className="relative mx-auto mt-3 max-w-xl text-brand-light2/80">Most requests take about ten minutes. Kato saves your progress as you go.</p>
            <a
              href="#top"
              className="relative mt-8 inline-flex h-11 items-center gap-2 rounded-xl bg-brand-green px-6 font-semibold text-brand-navy-deep transition-all hover:-translate-y-0.5 hover:shadow-glow"
            >
              Start a request
            </a>
          </div>
        </Reveal>
      </section>

      <footer className="relative border-t border-white/10 py-6 text-center text-xs text-brand-light2/60">
        © {new Date().getFullYear()} Cassava Technologies · Kato is for internal use. Conversations are recorded for audit.
      </footer>
    </main>
  );
}
