// Server- and client-safe (no hooks). Renders a partial or complete BRD defensively,
// because during streaming the tool input may be half-formed.
import { FINANCIAL_LENSES, OPCO_LABELS, formatUsd, type BRDDraft, type OpCoValue } from '@/lib/brd';
import { cn } from '@/lib/utils';
import { LevelBadge } from './status-badge';

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : undefined);
const arr = <T,>(v: unknown) => (Array.isArray(v) ? (v.filter(Boolean) as T[]) : []);

function Pending({ children = 'Kato will capture this during the conversation' }: { children?: string }) {
  return <p className="text-sm italic text-muted-foreground/70">{children}</p>;
}

// Sections glow green when they go from "missing" to complete (the keyed remount replays the flash)
function Section({
  n,
  title,
  missing,
  animate,
  children,
}: {
  n: number;
  title: string;
  missing?: boolean;
  animate?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      key={missing ? 'missing' : 'done'}
      className={cn(
        'rounded-r-lg border-l-[3px] py-1.5 pl-4 transition-colors duration-700',
        missing ? 'border-amber-300' : 'border-brand-green',
        animate && !missing && 'animate-flash',
      )}
    >
      <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-brand-blue">
        <span
          className={cn(
            'flex h-5 w-5 items-center justify-center rounded-full text-[10px] transition-colors duration-500',
            missing ? 'bg-amber-100 text-amber-800' : 'bg-brand-navy text-white',
          )}
        >
          {n}
        </span>
        {title}
      </h3>
      <div className="space-y-2 text-sm leading-relaxed">{children}</div>
    </section>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-1 pl-5">
      {items.map((i, idx) => (
        <li key={idx}>{i}</li>
      ))}
    </ul>
  );
}

function KV({ k, v }: { k: string; v?: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-2">
      <dt className="text-muted-foreground">{k}</dt>
      <dd>{v ?? <span className="italic text-muted-foreground/70">Pending</span>}</dd>
    </div>
  );
}

export function BrdPreview({
  draft,
  missingKeys = [],
  reference,
  className,
  animate = false,
}: {
  draft: BRDDraft;
  missingKeys?: string[];
  reference?: string;
  className?: string;
  /** Flash sections as they become complete (live editing only). */
  animate?: boolean;
}) {
  const m = new Set(missingKeys);
  const goals = arr<string>(draft.strategicGoals);
  const criteria = arr<string>(draft.successCriteria);
  const kpis = arr<{ metric?: string; baseline?: string; target?: string }>(draft.kpis);
  const refs = arr<{ kind?: string; value?: string; note?: string }>(draft.references);
  const extras = (
    [
      ['Stakeholders', arr<string>(draft.stakeholders)],
      ['Assumptions', arr<string>(draft.assumptions)],
      ['Constraints', arr<string>(draft.constraints)],
      ['Risks', arr<string>(draft.risks)],
    ] as const
  ).filter(([, items]) => items.length);
  const openQs = arr<string>(draft.openQuestions);
  const opco = draft.opco && draft.opco in OPCO_LABELS ? OPCO_LABELS[draft.opco as OpCoValue] : undefined;

  return (
    <article className={cn('space-y-6', className)}>
      <header className="space-y-1 border-b pb-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-brand-blue">Business Requirements Document{reference ? ` · ${reference}` : ''}</p>
        <h2 className={cn('text-2xl font-bold tracking-tight text-brand-navy transition-all duration-500', !str(draft.title) && 'italic font-medium text-muted-foreground/70')}>
          {str(draft.title) ?? 'Untitled request'}
        </h2>
      </header>

      <Section animate={animate} n={1} title="Problem statement" missing={m.has('problemStatement')}>
        {str(draft.problemStatement) ? <p>{draft.problemStatement}</p> : <Pending />}
      </Section>

      <Section animate={animate} n={2} title="Request summary & strategic goals" missing={m.has('summary') || m.has('strategicGoals')}>
        {str(draft.summary) ? <p>{draft.summary}</p> : <Pending>Detailed summary pending</Pending>}
        {goals.length ? <Bullets items={goals} /> : <Pending>Strategic goals pending</Pending>}
      </Section>

      <Section animate={animate} n={3} title="Ownership" missing={['sponsor', 'department', 'opco', 'businessUnit'].some((k) => m.has(k))}>
        <dl className="space-y-1">
          <KV
            k="Business sponsor"
            v={str(draft.sponsor?.name) && [draft.sponsor?.name, draft.sponsor?.title].filter(Boolean).join(', ')}
          />
          <KV k="Department" v={str(draft.department)} />
          <KV k="Operating company" v={opco} />
          <KV k="Business unit" v={str(draft.businessUnit)} />
        </dl>
      </Section>

      <Section animate={animate} n={4} title="Business impact & urgency" missing={m.has('impact') || m.has('urgency')}>
        <div className="space-y-3">
          <div>
            <LevelBadge level={draft.impact} prefix="Impact" />
            {str(draft.impactJustification) ? <p className="mt-1">{draft.impactJustification}</p> : <Pending>Impact justification pending</Pending>}
          </div>
          <div>
            <LevelBadge level={draft.urgency} prefix="Urgency" />
            {str(draft.urgencyJustification) ? <p className="mt-1">{draft.urgencyJustification}</p> : <Pending>Urgency justification pending</Pending>}
          </div>
          {str(draft.targetDate) && <KV k="Target date" v={draft.targetDate} />}
        </div>
      </Section>

      <Section animate={animate} n={5} title="Success criteria & KPIs" missing={m.has('successCriteria') || m.has('kpis')}>
        {criteria.length ? <Bullets items={criteria} /> : <Pending>Success criteria pending</Pending>}
        {kpis.length ? (
          <table className="mt-2 w-full text-left text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="py-1 font-medium">KPI</th>
                <th className="py-1 font-medium">Baseline</th>
                <th className="py-1 font-medium">Target</th>
              </tr>
            </thead>
            <tbody>
              {kpis.map((k, i) => (
                <tr key={i} className="border-t">
                  <td className="py-1.5 pr-2">{k.metric ?? '…'}</td>
                  <td className="py-1.5 pr-2 text-muted-foreground">{k.baseline ?? '—'}</td>
                  <td className="py-1.5 font-medium">{k.target ?? '…'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Pending>KPIs pending</Pending>
        )}
      </Section>

      <Section animate={animate} n={6} title="Financial impact (USD, annual)" missing={m.has('financialImpact')}>
        <FinancialImpact draft={draft} />
      </Section>

      <Section animate={animate} n={7} title="Related tickets & systems">
        {refs.length ? (
          <ul className="space-y-1">
            {refs.map((r, i) => (
              <li key={i}>
                <span className="mr-2 rounded bg-brand-surface px-1.5 py-0.5 font-mono text-xs text-brand-blue">{r.kind ?? 'REF'}</span>
                {r.value}
                {r.note && <span className="text-muted-foreground"> — {r.note}</span>}
              </li>
            ))}
          </ul>
        ) : (
          <Pending>None recorded yet</Pending>
        )}
      </Section>

      {extras.length > 0 && (
        <Section animate={animate} n={8} title="Context">
          {extras.map(([label, items]) => (
            <div key={label}>
              <p className="font-medium">{label}</p>
              <Bullets items={items} />
            </div>
          ))}
        </Section>
      )}

      {openQs.length > 0 && (
        <Section animate={animate} n={extras.length ? 9 : 8} title="Open questions for IT">
          <Bullets items={openQs} />
        </Section>
      )}
    </article>
  );
}

function FinancialImpact({ draft }: { draft: BRDDraft }) {
  const f: NonNullable<BRDDraft['financialImpact']> = draft.financialImpact ?? {};
  const val = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        {FINANCIAL_LENSES.map((l) => {
          const v = val(f[l.key]);
          return (
            <div key={l.key} className={cn('rounded-xl border p-2.5 transition-all duration-500', v === undefined ? 'bg-brand-surface/60' : 'border-brand-navy bg-brand-navy text-white shadow-lift')}>
              <p className={cn('text-[11px] uppercase tracking-wide', v === undefined ? 'text-muted-foreground' : 'text-brand-light2')}>{l.short} / yr</p>
              <p className={cn('mt-0.5 font-heading text-base font-bold tabular-nums', v === undefined ? 'text-muted-foreground/60' : 'text-brand-green')}>
                {v === undefined ? 'Pending' : formatUsd(v, { compact: Math.abs(v) >= 100_000 })}
              </p>
            </div>
          );
        })}
      </div>
      {str(f.basis) ? (
        <p>
          <span className="text-muted-foreground">Basis: </span>
          {f.basis}
        </p>
      ) : (
        <Pending>Kato will help you quantify the revenue, EBITDA and cash-flow effect in USD</Pending>
      )}
      <p className="text-xs text-muted-foreground">
        {[
          f.confidence && `Confidence: ${f.confidence.toLowerCase()}`,
          `Horizon: ${val(f.horizonYears) ?? 3} years`,
          val(f.oneOffCashBenefitUsd) !== undefined && `One-off cash benefit: ${formatUsd(f.oneOffCashBenefitUsd)}`,
          val(f.implementationBudgetUsd) !== undefined && `Expected budget: ${formatUsd(f.implementationBudgetUsd)}`,
          str(f.fxNote) && `FX: ${f.fxNote}`,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
    </div>
  );
}
