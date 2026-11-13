'use client';

// Looping illustration of a Kato session: chat on the left, the BRD filling in on the right.
// Purely decorative (aria-hidden). The scene remounts every 9s to replay, matching the `fill-bar` cycle.
import { CheckCircle2, FileText, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { KatoMark } from '@/components/brand';

const delay = (ms: number) => ({ animationDelay: `${ms}ms` });

export function ProductPreview() {
  const [cycle, setCycle] = useState(0);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const id = setInterval(() => setCycle((c) => c + 1), 9000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="relative mx-auto w-full max-w-xl animate-float" aria-hidden>
      {/* orbiting accents */}
      <div className="absolute -left-10 -top-10 h-24 w-24 rounded-full border border-brand-green/30" />
      <div className="absolute -bottom-8 -right-6 h-32 w-32 rounded-full border border-dashed border-brand-light1/30 animate-[spin_40s_linear_infinite]" />

      <div className="glass-dark relative overflow-hidden rounded-3xl p-5 shadow-[0_40px_120px_-30px_rgb(0_110_167/0.7)]">
        <div className="mb-4 flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
          <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
          <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
          <span className="ml-3 rounded-md bg-white/5 px-2 py-0.5 font-mono text-[10px] text-brand-light2/70">kato · KATO-0142</span>
        </div>

        <div key={cycle} className="grid grid-cols-[1.1fr_1fr] gap-4">
          {/* chat */}
          <div className="space-y-3 text-[12px] leading-snug">
            <div className="flex gap-2 animate-line-in" style={delay(200)}>
              <KatoMark className="h-6 w-6" />
              <p className="rounded-2xl rounded-tl-sm bg-white/10 px-3 py-2 text-brand-light2">What problem should we solve?</p>
            </div>
            <p
              className="ml-auto max-w-[90%] rounded-2xl rounded-tr-sm bg-gradient-to-br from-brand-blue to-brand-navy px-3 py-2 text-white animate-line-in"
              style={delay(900)}
            >
              Finance reconciles 4,000 supplier invoices a month by hand.
            </p>
            <div className="flex gap-2 animate-line-in" style={delay(1700)}>
              <KatoMark className="h-6 w-6" />
              <p className="rounded-2xl rounded-tl-sm bg-white/10 px-3 py-2 text-brand-light2">How many hours does that take each month?</p>
            </div>
            <p
              className="ml-auto max-w-[90%] rounded-2xl rounded-tr-sm bg-gradient-to-br from-brand-blue to-brand-navy px-3 py-2 text-white animate-line-in"
              style={delay(2600)}
            >
              About 600 hours across three OpCos.
            </p>
            <div className="flex items-center gap-1.5 pl-8 animate-line-in" style={delay(3300)}>
              {[0, 150, 300].map((d) => (
                <span key={d} className="h-1.5 w-1.5 animate-typing rounded-full bg-brand-green" style={delay(d)} />
              ))}
            </div>
          </div>

          {/* live BRD */}
          <div className="rounded-2xl bg-white p-3 text-brand-navy shadow-lg">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-brand-blue">
              <FileText className="h-3 w-3" /> Live BRD
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-brand-surface">
              <div className="h-full animate-fill-bar rounded-full bg-gradient-to-r from-brand-blue via-brand-light1 to-brand-green" />
            </div>
            <ul className="mt-3 space-y-2 text-[11px]">
              {[
                ['Problem statement', 600],
                ['Strategic goals', 1500],
                ['KPIs', 2400],
                ['USD impact', 3200],
                ['Sponsor', 4000],
              ].map(([label, ms]) => (
                <li key={label as string} className="flex items-center gap-1.5 animate-line-in" style={delay(ms as number)}>
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                  <span className="flex-1">{label}</span>
                  <span className="h-1.5 w-10 rounded-full bg-brand-surface" />
                </li>
              ))}
            </ul>
            <div className="mt-3 rounded-xl bg-brand-navy p-2 text-white animate-line-in" style={delay(4800)}>
              <p className="text-[9px] uppercase tracking-wider text-brand-light2/80">EBITDA / yr</p>
              <p className="font-heading text-lg font-bold text-brand-green">$1.2M</p>
            </div>
          </div>
        </div>

        <div
          key={`ready-${cycle}`}
          className="absolute bottom-4 right-4 flex items-center gap-1.5 rounded-full bg-brand-green px-3 py-1 text-[11px] font-semibold text-brand-navy-deep shadow-glow animate-line-in"
          style={delay(5600)}
        >
          <Sparkles className="h-3 w-3" /> Ready for IT review
        </div>
      </div>
    </div>
  );
}
