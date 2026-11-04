import { ExternalLink, Search, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { BrdPreview } from '@/components/brd-preview';
import { LevelBadge, StatusBadge, SyncBadge } from '@/components/status-badge';
import { Badge, Button, Card, Input, selectClass } from '@/components/ui';
import { PAGE_SIZE, STATUSES, getRequestDetail, listRequests, parseFilters, statusCounts, type RequestDetail } from '@/lib/admin-queries';
import { getCurrentUser, isStaff, type SessionUser } from '@/lib/auth';
import { LEVELS, OPCO_LABELS, OPCOS, asDraft, formatRef, type OpCoValue } from '@/lib/brd';
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
const TABS = ['brd', 'transcript', 'audit', 'jira'] as const;
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

export default async function AdminDashboardPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await getCurrentUser();
  if (!user) redirect('/api/auth/signin?callbackUrl=/admin/dashboard');
  if (!isStaff(user.role)) redirect('/request');

  const sp = await searchParams;
  const filters = parseFilters(sp);
  const selectedId = typeof sp.selected === 'string' ? sp.selected : undefined;
  const tab: Tab = TABS.includes(sp.tab as Tab) ? (sp.tab as Tab) : 'brd';

  const [{ items, total }, counts, detail] = await Promise.all([
    listRequests(filters),
    statusCounts(),
    selectedId ? getRequestDetail(selectedId) : Promise.resolve(null),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="min-h-dvh bg-muted/30">
      <header className="flex items-center justify-between border-b bg-background px-6 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">K</div>
          <div>
            <p className="text-sm font-semibold leading-tight">Kato · Demand management</p>
            <p className="text-xs text-muted-foreground">AI Software Factory intake workspace</p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <Badge variant="violet">
            <ShieldCheck className="mr-1 h-3 w-3" />
            {user.role === 'ADMIN' ? 'Admin' : 'IT reviewer'}
          </Badge>
          <span className="text-muted-foreground">{user.name}</span>
          <Button asChild size="sm" variant="outline">
            <Link href="/request">Raise a request</Link>
          </Button>
        </div>
      </header>

      <div className="space-y-5 p-6">
        {/* ── KPI tiles ─────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {STATUSES.map((s) => (
            <Link key={s} href={href({}, { status: s })}>
              <Card className={cn('p-4 transition-colors hover:border-primary/50', filters.status === s && 'border-primary ring-1 ring-primary')}>
                <p className="text-xs text-muted-foreground">{STATUS_LABEL[s]}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{counts[s]}</p>
              </Card>
            </Link>
          ))}
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
          <Button type="submit" size="sm">
            Apply
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link href="/admin/dashboard">Reset</Link>
          </Button>
        </form>

        <div className={cn('grid gap-5', detail && 'xl:grid-cols-[minmax(0,1fr)_minmax(0,46rem)]')}>
          {/* ── Queue ─────────────────────────────────── */}
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Ref</th>
                    <th className="px-4 py-2.5 font-medium">Request</th>
                    <th className="px-4 py-2.5 font-medium">OpCo</th>
                    <th className="px-4 py-2.5 font-medium">Impact</th>
                    <th className="px-4 py-2.5 font-medium">Urgency</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5 font-medium">Submitted</th>
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                        No requests match these filters.
                      </td>
                    </tr>
                  )}
                  {items.map((r) => (
                    <tr key={r.id} className={cn('border-b last:border-0 hover:bg-muted/40', r.id === selectedId && 'bg-primary/5')}>
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
                      <td className="px-4 py-3">
                        <LevelBadge level={r.impact} />
                      </td>
                      <td className="px-4 py-3">
                        <LevelBadge level={r.urgency} />
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

          {detail && <DetailPanel detail={detail} tab={tab} sp={sp} user={user} />}
        </div>
      </div>
    </div>
  );
}

function DetailPanel({ detail, tab, sp, user }: { detail: RequestDetail; tab: Tab; sp: SP; user: SessionUser }) {
  const reference = formatRef(detail.number);
  const brdDoc = detail.brdDocuments[0];
  const latestTask = detail.jiraSyncTasks[0];

  return (
    <Card className="flex max-h-[calc(100dvh-10rem)] flex-col overflow-hidden xl:sticky xl:top-6">
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
            {detail.jiraIssueKey && (
              <a href={detail.jiraIssueUrl ?? '#'} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-xs text-primary hover:underline">
                {detail.jiraIssueKey} <ExternalLink className="h-3 w-3" />
              </a>
            )}
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
          jiraTask={latestTask ? { id: latestTask.id, status: latestTask.status } : null}
        />
        <nav className="flex gap-1 border-b -mb-5 pt-1">
          {TABS.map((t) => (
            <Link
              key={t}
              href={href(sp, { tab: t })}
              className={cn('-mb-px border-b-2 px-3 py-2 text-sm capitalize', tab === t ? 'border-primary font-medium' : 'border-transparent text-muted-foreground hover:text-foreground')}
            >
              {t === 'brd' ? `BRD${brdDoc ? ` v${brdDoc.version}` : ''}` : t === 'jira' ? `Jira (${detail.jiraSyncTasks.length})` : t === 'audit' ? `Audit (${detail.approvalLogs.length})` : `Transcript (${detail.messages.length})`}
            </Link>
          ))}
        </nav>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
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
