// Kato brand elements: logo mark, wordmark and the animated aurora backdrop. Server-safe (no hooks).
import { cn } from '@/lib/utils';

/** The Kato "K" mark with the Cassava green signal dot. */
export function KatoMark({ className, glow }: { className?: string; glow?: boolean }) {
  return (
    <span className={cn('relative inline-flex shrink-0', className ?? 'h-9 w-9')}>
      {glow && <span className="absolute inset-0 animate-pulse-ring rounded-[28%] bg-brand-green/40" aria-hidden />}
      <svg viewBox="0 0 32 32" className="relative h-full w-full drop-shadow-sm" aria-hidden>
        <defs>
          <linearGradient id="kato-mark" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#001D58" />
            <stop offset="1" stopColor="#00082F" />
          </linearGradient>
        </defs>
        <rect width="32" height="32" rx="9" fill="url(#kato-mark)" />
        <rect x="0.5" y="0.5" width="31" height="31" rx="8.5" fill="none" stroke="#ADE9F7" strokeOpacity="0.25" />
        <path d="M11 8.5v15M11 16.5l8-8M14.2 13.6l6.3 9.9" stroke="#fff" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <circle cx="23.2" cy="9.2" r="2.4" fill="#00F19C" />
      </svg>
    </span>
  );
}

export function KatoLogo({ subtitle, tone = 'light', className }: { subtitle?: string; tone?: 'light' | 'dark'; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-3', className)}>
      <KatoMark />
      <span className="leading-tight">
        <span className={cn('block font-heading text-base font-bold tracking-tight', tone === 'dark' ? 'text-white' : 'text-brand-navy')}>
          Kato
        </span>
        {subtitle && <span className={cn('block text-xs', tone === 'dark' ? 'text-brand-light2/80' : 'text-muted-foreground')}>{subtitle}</span>}
      </span>
    </span>
  );
}

/**
 * Slow-drifting blurred colour fields in the brand palette, with a dotted grid on top.
 * `intensity="soft"` for working screens, `"vivid"` for the sign-in hero.
 */
export function Aurora({ intensity = 'soft', className }: { intensity?: 'soft' | 'vivid'; className?: string }) {
  const vivid = intensity === 'vivid';
  return (
    <div className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)} aria-hidden>
      <div
        className={cn(
          'absolute -left-[10%] -top-[20%] h-[60vmax] w-[60vmax] animate-aurora rounded-full blur-3xl',
          vivid ? 'bg-brand-green/25' : 'bg-brand-green/[0.07]',
        )}
      />
      <div
        className={cn(
          'absolute -right-[15%] top-[10%] h-[55vmax] w-[55vmax] animate-aurora-slow rounded-full blur-3xl',
          vivid ? 'bg-brand-blue/40' : 'bg-brand-light1/[0.10]',
        )}
      />
      <div
        className={cn(
          'absolute -bottom-[30%] left-[25%] h-[50vmax] w-[50vmax] animate-aurora rounded-full blur-3xl [animation-delay:-9s]',
          vivid ? 'bg-brand-purple/30' : 'bg-brand-purple/[0.06]',
        )}
      />
      <div className={cn('absolute inset-0', vivid ? 'bg-dot-grid' : 'bg-dot-grid-light')} />
    </div>
  );
}
