import { BookOpen, ExternalLink, Search, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Aurora, KatoLogo } from '@/components/brand';
import { BrdPreview } from '@/components/brd-preview';
import { CountUp, Spotlight } from '@/components/motion';
import { LevelBadge, RouteBadge, StatusBadge, SyncBadge, SyncStateBadge } from '@/components/status-badge';
import { Badge, Button, Card, Input, selectClass } from '@/components/ui';
import {
  PAGE_SIZE,
  STATUSES,
  getRequestDetail,
  listRequests,
  parseFilters,
  pipelineSummary,
  statusCounts,
  type RequestDetail,
} from '@/lib/admin-queries';
import type { StoredAutonomy, StoredFinancial } from '@/lib/assessment';
import { getCurrentUser, isStaff, type SessionUser } from '@/lib/auth';
import { FINANCIAL_LENSES, LEVELS, OPCO_LABELS, OPCOS, asDraft, formatRef, formatUsd, type OpCoValue } from '@/lib/brd';
import { requireAssessmentForApproval } from '@/lib/lifecycle';
import { ROUTES, ROUTE_DESCRIPTIONS, ROUTE_LABELS } from '@/lib/routes';
import { cn, formatDateTime } from '@/lib/utils';
import { AdminActions } from './admin-actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Demand management · Kato' };

type SP = Record<string, string | string[] | undefined>;

const STATUS_LABEL: Record<(typeof STATUSES)[number], string> = {
  SUBMITTED: 'Awaiting triage',
  UNDER_IT_REVIEW: 'Under IT review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
};
const TABS = ['assessment', 'brd', 'transcript', 'audit', 'jira'] as const;
type Tab = (typeof TABS)[number];

function href(sp: SP, patch: Record<string, string | undefined>) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...sp, ...patch })) {
    const val = Array.isArray(v) ? v[0] : v;
    if (val) params.set(k, val);
  }
  return `/admin/dashboard?${params.toString()}`;
}

const opcoLabel = (o?: string | null) => (o && o in OPCO_LABELS ? OPCO_LABELS[o as OpCoValue] : '—');
const n = (d: { toNumber(): number } | null | undefined) => (d == null ? null : d.toNumber());
const usd = (v: number | null) => formatUsd(v, { compact: true });

export default async function AdminDashboardPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await getCurrentUser();
  if (!user) redirect('/signin?callbackUrl=/admin/dashboard');
  if (!isStaff(user.role)) redirect('/request');

  const sp = await searchParams;
  const filters = parseFilters(sp);
  const selectedId = typeof sp.selected === 'string' ? sp.selected : undefined;
  const tab: Tab = TABS.includes(sp.tab as Tab) ? (sp.tab as Tab) : 'assessment';

  const [{ items, total }, counts, pipeline, detail] = await Promise.all([
    listRequests(filters),
    statusCounts(),
    pipelineSummary(),
    selectedId ? getRequestDetail(selectedId) : Promise.resolve(null),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="relative min-h-dvh bg-brand-surface">
      <Aurora className="fixed" />
      <header className="relative z-20 flex items-center justify-between bg-gradient-to-r from-brand-navy-deep via-brand-navy to-brand-blue-dark px-6 py-3 text-white shadow-lg shadow-brand-navy/20 animate-in fade-in slide-in-from-top-2 duration-500">
        <Link href="/admin/dashboard" className="transition-opacity hover:opacity-90">
          <KatoLogo tone="dark" subtitle="Demand management · AI Software Factory" />
        </Link>
        <div className="flex items-center gap-3 text-sm">
          <Badge className="border-brand-green/40 bg-brand-green/15 text-brand-green">
            <ShieldCheck className="mr-1 h-3 w-3" />
            {user.role === 'ADMIN' ? 'Admin' : 'IT reviewer'}
          </Badge>
          <span className="hidden text-brand-light2 sm:inline">{user.name}</span>
          <Button asChild size="sm" variant="glass">
            <Link href="/request">Raise a request</Link>
          </Button>
        </div>
      </header>

      <div className="relative z-10 space-y-5 p-6">
        {/* ── KPI tiles ─────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {STATUSES.map((s, i) => (
            <Link key={s} href={href({}, { status: s })} className="stagger-in group" style={{ '--i': i } as React.CSSProperties}>
              <Spotlight
                className={cn(
                  'relative overflow-hidden rounded-2xl border bg-white p-4 shadow-sm transition-all duration-300 group-hover:-translate-y-1 group-hover:border-brand-green/60 group-hover:shadow-lift',
                  filters.status === s && 'border-brand-blue ring-2 ring-brand-blue/30',
                )}
              >
                <span
                  className={cn('absolute inset-x-0 top-0 h-1 transition-opacity', filters.status === s ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')}
                  style={{ background: 'linear-gradient(90deg,#006EA7,#00F19C)' }}
                  aria-hidden
                />
                <p className="text-xs font-medium text-muted-foreground">{STATUS_LABEL[s]}</p>
                <p className="mt-1 font-heading text-3xl font-bold tabular-nums text-brand-navy">
                  <CountUp value={counts[s]} />
                </p>
              </Spotlight>
            </Link>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <ValueTile i={4} featured label="Open pipeline EBITDA / yr" value={usd(pipeline.openEbitdaUsd)} hint={`Revenue ${usd(pipeline.openRevenueUsd)} · cash flow ${usd(pipeline.openCashFlowUsd)}`} />
          <ValueTile i={5} label="Approved EBITDA / yr" value={usd(pipeline.approvedEbitdaUsd)} hint="Assessed value of approved requests" />
          <Link href={href({}, { route: 'AUTONOMOUS' })} className="group">
            <ValueTile i={6} label="Eligible for autonomous route" value={<CountUp value={pipeline.autonomousEligible} />} hint="Open requests recommended Autonomous" />
          </Link>
          <ValueTile
            i={7}
            label="Awaiting assessment"
            value={<CountUp value={pipeline.awaitingAssessment} />}
            hint="Pending or failed value / route assessment"
            warn={pipeline.awaitingAssessment > 0}
          />
        </div>

        {/* ── Filters ───────────────────────────────────── */}
        <form method="GET" className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-64 flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input name="q" defaultValue={filters.q} placeholder="Search title, requester, KATO-123 or Jira key" className="bg-background pl-9" />
          </div>
          <select name="status" defaultValue={filters.status ?? ''} className={selectClass} aria-label="Status">
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          <select name="opco" defaultValue={filters.opco ?? ''} className={selectClass} aria-label="Operating company">
            <option value="">All OpCos</option>
            {OPCOS.map((o) => (
              <option key={o} value={o}>
                {OPCO_LABELS[o]}
              </option>
            ))}
          </select>
          <select name="impact" defaultValue={filters.impact ?? ''} className={selectClass} aria-label="Priority / impact">
            <option value="">All impact levels</option>
            {LEVELS.map((l) => (
              <option key={l} value={l}>
                {l.charAt(0) + l.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
          <select name="route" defaultValue={filters.route ?? ''} className={selectClass} aria-label="Development route">
            <option value="">All routes</option>
            {ROUTES.map((r) => (
              <option key={r} value={r}>
                {ROUTE_LABELS[r]}
              </option>
            ))}
          </select>
          <select name="sort" defaultValue={filters.sort} className={selectClass} aria-label="Sort">
            <option value="newest">Newest first</option>
            <option value="value">Highest value score</option>
            <option value="ebitda">Highest EBITDA impact</option>
          </select>
          <Button type="submit" size="sm">
            Apply
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link href="/admin/dashboard">Reset</Link>
          </Button>
        </form>

        <div className={cn('grid gap-5', detail && 'xl:grid-cols-[minmax(0,1fr)_minmax(0,46rem)]')}>
          {/* ── Queue ─────────────────────────────────── */}
          <Card className="overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div className="scrollbar-thin overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-brand-navy text-left text-xs text-brand-light2">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Ref</th>
                    <th className="px-4 py-2.5 font-medium">Request</th>
                    <th className="px-4 py-2.5 font-medium">OpCo</th>
                    <th className="px-4 py-2.5 text-right font-medium">EBITDA / yr</th>
                    <th className="px-4 py-2.5 text-right font-medium">Value</th>
                    <th className="px-4 py-2.5 font-medium">Route</th>
                    <th className="px-4 py-2.5 font-medium">Impact</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5 font-medium">Submitted</th>
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-4 py-12 text-center text-muted-foreground">
                        No requests match these filters.
                      </td>
                    </tr>
                  )}
                  {items.map((r, i) => (
                    <tr
                      key={r.id}
                      style={{ '--i': i } as React.CSSProperties}
                      className={cn(
                        'stagger-in border-b transition-colors duration-200 last:border-0 hover:bg-brand-surface [&>td:first-child]:border-l-[3px] [&>td:first-child]:border-l-transparent hover:[&>td:first-child]:border-l-brand-green',
                        r.id === selectedId && 'bg-brand-light2/25 [&>td:first-child]:border-l-brand-blue',
                      )}
                    >
                      <td className="px-4 py-3 font-mono text-xs">
                        <Link href={href(sp, { selected: r.id, tab: undefined })} className="hover:underline">
                          {formatRef(r.number)}
                        </Link>
                      </td>
                      <td className="max-w-xs px-4 py-3">
                        <Link href={href(sp, { selected: r.id, tab: undefined })} className="block">
                          <p className="truncate font-medium">{r.title ?? 'Untitled'}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {r.requester.name}
                            {r.department ? ` · ${r.department}` : ''}
                          </p>
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-xs">{opcoLabel(r.opco)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                        {r.assessedEbitdaUsd != null ? (
                          <span className="font-medium">{usd(n(r.assessedEbitdaUsd))}</span>
                        ) : (
                          <span className="text-muted-foreground" title="Requester-stated, not yet assessed">
                            {usd(n(r.statedEbitdaUsd))}*
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{r.valueScore ?? '—'}</td>
                      <td className="px-4 py-3">
                        <RouteBadge route={r.approvedRoute ?? r.recommendedRoute} pending={r.assessmentStatus === 'PENDING'} />
                      </td>
                      <td className="px-4 py-3">
                        <LevelBadge level={r.impact} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <StatusBadge status={r.status} />
                          {r.jiraIssueKey && <span className="font-mono text-xs text-muted-foreground">{r.jiraIssueKey}</span>}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">{formatDateTime(r.submittedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">EBITDA is Kato&apos;s assessed annual figure; * marks requester-stated values still awaiting assessment.</p>
            {pages > 1 && (
              <div className="flex items-center justify-between border-t px-4 py-2 text-xs text-muted-foreground">
                <span>
                  {total} requests · page {filters.page} of {pages}
                </span>
                <div className="flex gap-1">
                  {filters.page > 1 && (
                    <Button asChild size="sm" variant="ghost">
                      <Link href={href(sp, { page: String(filters.page - 1) })}>Previous</Link>
                    </Button>
                  )}
                  {filters.page < pages && (
                    <Button asChild size="sm" variant="ghost">
                      <Link href={href(sp, { page: String(filters.page + 1) })}>Next</Link>
                    </Button>
                  )}
                </div>
              </div>
            )}
          </Card>

          {detail && <DetailPanel key={detail.id} detail={detail} tab={tab} sp={sp} user={user} />}
        </div>
      </div>
    </div>
  );
}

function DetailPanel({ detail, tab, sp, user }: { detail: RequestDetail; tab: Tab; sp: SP; user: SessionUser }) {
  const reference = formatRef(detail.number);
  const brdDoc = detail.brdDocuments[0];
  const latestTask = detail.jiraSyncTasks[0];
  const assessment = detail.assessments[0];

  return (
    <Card className="flex max-h-[calc(100dvh-10rem)] flex-col overflow-hidden shadow-lift animate-in fade-in slide-in-from-right-8 duration-500 xl:sticky xl:top-6">
      <div className="space-y-3 border-b p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-xs text-muted-foreground">{reference}</p>
            <h2 className="truncate text-lg font-semibold">{detail.title}</h2>
            <p className="text-xs text-muted-foreground">
              {detail.requester.name} · {detail.requester.email} · {opcoLabel(detail.opco)}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <StatusBadge status={detail.status} />
            {detail.confluencePageUrl ? (
              <a href={detail.confluencePageUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                <BookOpen className="h-3 w-3" /> BRD in Confluence
              </a>
            ) : (
              <SyncStateBadge state={detail.confluenceSyncState} />
            )}
            {detail.jiraIssueKey && (
              <a href={detail.jiraIssueUrl ?? '#'} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-xs text-primary hover:underline">
                {detail.jiraIssueKey} <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        </div>
        <div className="grid grid-cols-5 gap-2">
          {FINANCIAL_LENSES.map((l) => {
            const assessed = n(l.key === 'revenueGrowthUsd' ? detail.assessedRevenueUsd : l.key === 'ebitdaImpactUsd' ? detail.assessedEbitdaUsd : detail.assessedCashFlowUsd);
            const stated = n(l.key === 'revenueGrowthUsd' ? detail.statedRevenueUsd : l.key === 'ebitdaImpactUsd' ? detail.statedEbitdaUsd : detail.statedCashFlowUsd);
            return (
              <div key={l.key} className="rounded-md border p-2">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{l.short} / yr</p>
                <p className="text-sm font-semibold tabular-nums">{usd(assessed ?? stated)}</p>
                <p className="text-[10px] text-muted-foreground">{assessed != null ? `stated ${usd(stated)}` : 'stated · not assessed'}</p>
              </div>
            );
          })}
          <div className="rounded-md border p-2">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Value score</p>
            <p className="text-sm font-semibold tabular-nums">{detail.valueScore ?? '—'}<span className="text-xs font-normal text-muted-foreground">/100</span></p>
          </div>
          <div className="rounded-md border p-2">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Route</p>
            <div className="mt-0.5">
              <RouteBadge route={detail.approvedRoute ?? detail.recommendedRoute} pending={detail.assessmentStatus === 'PENDING'} />
            </div>
            {detail.autonomyScore != null && <p className="text-[10px] text-muted-foreground">autonomy {detail.autonomyScore}/100</p>}
          </div>
        </div>
        {detail.status === 'REJECTED' && detail.rejectionReason && (
          <p className="rounded-md bg-red-50 p-2 text-xs text-red-900">
            <span className="font-medium">Rejected by {detail.decidedBy?.name}:</span> {detail.rejectionReason}
          </p>
        )}
        <AdminActions
          requestId={detail.id}
          reference={reference}
          status={detail.status}
          isOwnRequest={detail.requesterId === user.id && process.env.KATO_ALLOW_SELF_APPROVAL !== 'true'}
          requireAssessment={requireAssessmentForApproval()}
          assessment={{ status: detail.assessmentStatus, recommendedRoute: detail.recommendedRoute, autonomyScore: detail.autonomyScore }}
          confluenceState={detail.confluenceSyncState}
          jiraTask={latestTask ? { id: latestTask.id, status: latestTask.status } : null}
        />
        <nav className="flex gap-1 border-b -mb-5 pt-1">
          {TABS.map((t) => (
            <Link
              key={t}
              href={href(sp, { tab: t })}
              className={cn(
                '-mb-px border-b-2 px-3 py-2 text-sm capitalize transition-colors duration-200',
                tab === t ? 'border-brand-green font-semibold text-brand-navy' : 'border-transparent text-muted-foreground hover:border-brand-border hover:text-brand-navy',
              )}
            >
              {t === 'assessment' ? 'Assessment' : t === 'brd' ? `BRD${brdDoc ? ` v${brdDoc.version}` : ''}` : t === 'jira' ? `Jira (${detail.jiraSyncTasks.length})` : t === 'audit' ? `Audit (${detail.approvalLogs.length})` : `Transcript (${detail.messages.length})`}
            </Link>
          ))}
        </nav>
      </div>

      <div key={tab} className="scrollbar-thin flex-1 overflow-y-auto p-5 animate-in fade-in duration-300">
        {tab === 'assessment' && <AssessmentView detail={detail} assessment={assessment} />}
        {tab === 'brd' && <BrdPreview draft={asDraft(brdDoc?.content ?? detail.draftBrd)} reference={reference} />}

        {tab === 'transcript' && (
          <ol className="space-y-3">
            {detail.messages.map((m) => (
              <li key={m.id} className={cn('rounded-lg p-3 text-sm', m.role === 'USER' ? 'bg-primary/5' : 'bg-muted')}>
                <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                  <span className="font-medium">{m.role === 'USER' ? detail.requester.name : 'Kato'}</span>
                  <span>
                    {m.redactions > 0 && <Badge variant="warning" className="mr-2">{m.redactions} redacted</Badge>}
                    {formatDateTime(m.createdAt)}
                  </span>
                </div>
                <p className="whitespace-pre-wrap">{m.content || <span className="italic text-muted-foreground">(BRD update only)</span>}</p>
              </li>
            ))}
          </ol>
        )}

        {tab === 'audit' && (
          <ol className="relative space-y-4 border-l pl-5">
            {detail.approvalLogs.map((log) => (
              <li key={log.id} className="relative">
                <span className="absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-primary" />
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{log.action.replace(/_/g, ' ').toLowerCase()}</span>
                  {log.fromStatus && log.toStatus && (
                    <span className="text-xs text-muted-foreground">
                      {log.fromStatus} → {log.toStatus}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {log.actor?.name ?? 'System'} · {formatDateTime(log.createdAt)}
                </p>
                {log.comment && <p className="mt-1 whitespace-pre-wrap rounded-md bg-muted p-2 text-sm">{log.comment}</p>}
                {log.metadata != null && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs text-muted-foreground">Payload</summary>
                    <pre className="mt-1 max-h-64 overflow-auto rounded-md bg-muted p-2 text-[11px]">{JSON.stringify(log.metadata, null, 2)}</pre>
                  </details>
                )}
              </li>
            ))}
          </ol>
        )}

        {tab === 'jira' &&
          (detail.jiraSyncTasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No Jira sync yet. A sync task is created when the request is approved.</p>
          ) : (
            <div className="space-y-3">
              {detail.jiraSyncTasks.map((t) => (
                <div key={t.id} className="rounded-lg border p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{t.issueType === 'EPIC' ? 'Epic' : 'Story'}</span>
                    <SyncBadge status={t.status} />
                  </div>
                  <dl className="mt-2 grid grid-cols-[7rem_1fr] gap-1 text-xs">
                    <dt className="text-muted-foreground">Issue</dt>
                    <dd className="font-mono">{t.jiraIssueKey ?? '—'}</dd>
                    <dt className="text-muted-foreground">Attempts</dt>
                    <dd>{t.attempts}</dd>
                    <dt className="text-muted-foreground">Queued</dt>
                    <dd>{formatDateTime(t.createdAt)}</dd>
                    <dt className="text-muted-foreground">Completed</dt>
                    <dd>{formatDateTime(t.completedAt)}</dd>
                  </dl>
                  {t.lastError && <p className="mt-2 rounded bg-red-50 p-2 font-mono text-[11px] text-red-900">{t.lastError}</p>}
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-muted-foreground">Request payload</summary>
                    <pre className="mt-1 max-h-64 overflow-auto rounded-md bg-muted p-2 text-[11px]">{JSON.stringify(t.payload, null, 2)}</pre>
                  </details>
                </div>
              ))}
            </div>
          ))}
      </div>
    </Card>
  );
}

function ValueTile({
  label,
  value,
  hint,
  warn,
  featured,
  i = 0,
}: {
  label: string;
  value: React.ReactNode;
  hint: string;
  warn?: boolean;
  featured?: boolean;
  i?: number;
}) {
  return (
    <Spotlight
      style={{ '--i': i } as React.CSSProperties}
      className={cn(
        'stagger-in relative h-full overflow-hidden rounded-2xl border p-4 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lift',
        featured ? 'border-brand-navy bg-gradient-to-br from-brand-navy to-brand-navy-deep text-white' : 'bg-white',
        warn && 'border-amber-300',
      )}
    >
      {featured && <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-brand-green/25 blur-2xl" aria-hidden />}
      <p className={cn('text-xs font-medium', featured ? 'text-brand-light2' : 'text-muted-foreground')}>{label}</p>
      <p className={cn('mt-1 font-heading text-3xl font-bold tabular-nums', featured ? 'text-brand-green' : 'text-brand-navy')}>{value}</p>
      <p className={cn('mt-0.5 truncate text-[11px]', featured ? 'text-brand-light2/70' : 'text-muted-foreground')}>{hint}</p>
    </Spotlight>
  );
}

function ScoreBar({ score, max = 5 }: { score: number; max?: number }) {
  return (
    <div className="flex gap-0.5" aria-label={`${score} of ${max}`}>
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className={cn('h-2 w-5 rounded-sm', i < score ? (score >= 4 ? 'bg-emerald-500' : score === 3 ? 'bg-amber-400' : 'bg-red-400') : 'bg-muted')} />
      ))}
    </div>
  );
}

const CREDIBILITY_VARIANT = { CONSERVATIVE: 'success', SUPPORTED: 'success', OPTIMISTIC: 'warning', UNSUBSTANTIATED: 'danger' } as const;

function AssessmentView({ detail, assessment }: { detail: RequestDetail; assessment: RequestDetail['assessments'][number] | undefined }) {
  if (!assessment) {
    return (
      <p className="text-sm text-muted-foreground">
        {detail.assessmentStatus === 'FAILED'
          ? 'The automatic assessment failed. Use "Retry assessment" above.'
          : 'Kato is assessing the business value and development route. This usually takes under a minute.'}
      </p>
    );
  }
  const fin = assessment.financial as unknown as StoredFinancial;
  const aut = assessment.autonomy as unknown as StoredAutonomy;
  const criteria = [
    ['Requirement clarity', aut.requirementClarity],
    ['Testability', aut.testability],
    ['Scope containment', aut.scopeContainment],
    ['Integration simplicity', aut.integrationSimplicity],
    ['Reversibility', aut.reversibility],
    ['Pattern familiarity', aut.patternFamiliarity],
  ] as const;
  const stated = [n(detail.statedRevenueUsd), n(detail.statedEbitdaUsd), n(detail.statedCashFlowUsd)];
  const assessed = [n(assessment.assessedRevenueUsd), n(assessment.assessedEbitdaUsd), n(assessment.assessedCashFlowUsd)];

  return (
    <div className="space-y-6 text-sm">
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Business value</h3>
          <div className="flex items-center gap-2">
            <Badge variant={CREDIBILITY_VARIANT[fin.credibility]}>{fin.credibility.toLowerCase()}</Badge>
            <span className="text-xs text-muted-foreground">
              v{assessment.version} · {formatDateTime(assessment.createdAt)}
            </span>
          </div>
        </div>
        <table className="w-full text-left">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th className="py-1 font-medium">Annual USD</th>
              <th className="py-1 text-right font-medium">Stated</th>
              <th className="py-1 text-right font-medium">Assessed</th>
              <th className="py-1 text-right font-medium">Δ</th>
            </tr>
          </thead>
          <tbody>
            {FINANCIAL_LENSES.map((l, i) => {
              const delta = stated[i] != null && assessed[i] != null ? assessed[i]! - stated[i]! : null;
              return (
                <tr key={l.key} className="border-t">
                  <td className="py-1.5">{l.label}</td>
                  <td className="py-1.5 text-right tabular-nums text-muted-foreground">{formatUsd(stated[i])}</td>
                  <td className="py-1.5 text-right font-medium tabular-nums">{formatUsd(assessed[i])}</td>
                  <td className={cn('py-1.5 text-right tabular-nums text-xs', delta != null && delta < 0 ? 'text-red-600' : 'text-emerald-700')}>
                    {delta == null || delta === 0 ? '—' : `${delta > 0 ? '+' : ''}${usd(delta)}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="text-xs text-muted-foreground">
          Value score <span className="font-medium text-foreground">{assessment.valueScore}/100</span> · confidence {fin.confidence.toLowerCase()} · strategic alignment{' '}
          {fin.strategicAlignment.score}/5{fin.paybackMonths != null ? ` · payback ≈ ${fin.paybackMonths} months` : ''}
        </p>
        <p>{fin.commentary}</p>
        <div className="flex flex-wrap gap-1">
          {fin.valueDrivers.map((d) => (
            <Badge key={d} variant="outline">
              {d.replace(/_/g, ' ').toLowerCase()}
            </Badge>
          ))}
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground">Key assumptions</p>
          <ul className="list-disc pl-5">
            {fin.keyAssumptions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
        {fin.questionsForSponsor.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground">Questions for the sponsor</p>
            <ul className="list-disc pl-5">
              {fin.questionsForSponsor.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="space-y-3 border-t pt-5">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Development route</h3>
          <div className="flex items-center gap-2">
            <RouteBadge route={assessment.recommendedRoute} />
            <span className="text-xs tabular-nums text-muted-foreground">autonomy {assessment.autonomyScore}/100</span>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{ROUTE_DESCRIPTIONS[assessment.recommendedRoute]}</p>
        {detail.approvedRoute && detail.approvedRoute !== assessment.recommendedRoute && (
          <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-900">
            Approved for the {ROUTE_LABELS[detail.approvedRoute]} route, overriding the recommendation. See the audit trail for the reason.
          </p>
        )}
        <table className="w-full text-left">
          <tbody>
            {criteria.map(([label, c]) => (
              <tr key={label} className="border-t align-top">
                <td className="w-40 py-1.5 pr-2">{label}</td>
                <td className="w-28 py-2">
                  <ScoreBar score={c.score} />
                </td>
                <td className="py-1.5 text-xs text-muted-foreground">{c.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div>
          <p className="text-xs font-medium text-muted-foreground">Risk flags</p>
          {aut.blockers.length ? (
            <ul className="list-disc pl-5 text-red-700">
              {aut.blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          ) : (
            <p className="text-emerald-700">None raised</p>
          )}
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground">Decision rules applied</p>
          <ul className="list-disc pl-5">
            {aut.rules.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground">Required guardrails</p>
          <ul className="list-disc pl-5">
            {aut.guardrails.map((g, i) => (
              <li key={i}>{g}</li>
            ))}
          </ul>
        </div>
        <p>{aut.rationale}</p>
        <p className="text-[11px] text-muted-foreground">Assessed by {assessment.model}. Scores come from the model; the route and value score are computed by fixed rules.</p>
      </section>
    </div>
  );
}
