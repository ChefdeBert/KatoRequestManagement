'use client';

import type { AssessmentStatus, DevelopmentRoute, JiraSyncStatus, RequestStatus, SyncState } from '@prisma/client';
import { BookOpen, CheckCircle2, Gauge, Loader2, MessageSquarePlus, PlayCircle, RotateCcw, XCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Label, Textarea } from '@/components/ui';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { ROUTES, ROUTE_DESCRIPTIONS, ROUTE_LABELS } from '@/lib/routes';
import { cn } from '@/lib/utils';

type Props = {
  requestId: string;
  reference: string;
  status: RequestStatus;
  isOwnRequest: boolean;
  requireAssessment: boolean;
  assessment: { status: AssessmentStatus; recommendedRoute: DevelopmentRoute | null; autonomyScore: number | null };
  confluenceState: SyncState;
  jiraTask?: { id: string; status: JiraSyncStatus } | null;
};

async function post(url: string, body?: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(j.error ?? `Request failed (${res.status})`);
  }
}

export function AdminActions({ requestId, reference, status, isOwnRequest, requireAssessment, assessment, confluenceState, jiraTask }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [issueType, setIssueType] = useState<'EPIC' | 'STORY'>('EPIC');
  const [route, setRoute] = useState<DevelopmentRoute>(assessment.recommendedRoute ?? 'AI_ASSISTED');
  const [overrideReason, setOverrideReason] = useState('');
  const [approveNote, setApproveNote] = useState('');
  const [reason, setReason] = useState('');

  const url = `/api/admin/requests/${requestId}/transition`;
  const overridden = !!assessment.recommendedRoute && route !== assessment.recommendedRoute;
  const assessmentBlocks = requireAssessment && assessment.status !== 'COMPLETED';
  const canRerun = ['SUBMITTED', 'UNDER_IT_REVIEW'].includes(status);

  async function run(key: string, fn: () => Promise<void>, after?: () => void) {
    setPending(key);
    setError(null);
    try {
      await fn();
      after?.();
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {status === 'SUBMITTED' && (
          <Button size="sm" onClick={() => run('review', () => post(url, { action: 'start_review' }))} disabled={!!pending}>
            {pending === 'review' ? <Loader2 className="animate-spin" /> : <PlayCircle />} Start IT review
          </Button>
        )}

        {status === 'UNDER_IT_REVIEW' && (
          <>
            <Dialog open={approveOpen} onOpenChange={setApproveOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-600/90" disabled={!!pending || isOwnRequest || assessmentBlocks}>
                  <CheckCircle2 /> Approve
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-xl">
                <DialogHeader>
                  <DialogTitle>Approve {reference}</DialogTitle>
                  <DialogDescription>Kato will create the Jira issue, update the BRD in Confluence and notify the requester.</DialogDescription>
                </DialogHeader>

                <div className="space-y-2">
                  <Label>Development route</Label>
                  <div className="grid gap-2">
                    {ROUTES.map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setRoute(r)}
                        className={cn('rounded-md border p-3 text-left text-sm', route === r ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-accent')}
                      >
                        <p className="font-medium">
                          {ROUTE_LABELS[r]}
                          {assessment.recommendedRoute === r && (
                            <span className="ml-2 text-xs font-normal text-emerald-700">
                              Recommended{assessment.autonomyScore != null ? ` · autonomy ${assessment.autonomyScore}/100` : ''}
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">{ROUTE_DESCRIPTIONS[r]}</p>
                      </button>
                    ))}
                  </div>
                  {overridden && (
                    <div className="space-y-1">
                      <Label htmlFor="override-reason">Why override the recommendation? (recorded in the audit trail)</Label>
                      <Textarea id="override-reason" value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} rows={2} />
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>Jira issue type</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {(['EPIC', 'STORY'] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setIssueType(t)}
                        className={cn('rounded-md border p-3 text-left text-sm', issueType === t ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-accent')}
                      >
                        <p className="font-medium">{t === 'EPIC' ? 'Epic' : 'Story'}</p>
                        <p className="text-xs text-muted-foreground">{t === 'EPIC' ? 'Multi-sprint initiative, to be broken down' : 'Self-contained, deliverable in a sprint'}</p>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="approve-note">Note to requester (optional)</Label>
                  <Textarea id="approve-note" value={approveNote} onChange={(e) => setApproveNote(e.target.value)} rows={2} />
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setApproveOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    className="bg-emerald-600 hover:bg-emerald-600/90"
                    disabled={pending === 'approve' || (overridden && overrideReason.trim().length < 10)}
                    onClick={() =>
                      run(
                        'approve',
                        () =>
                          post(url, {
                            action: 'approve',
                            issueType,
                            route,
                            routeOverrideReason: overridden ? overrideReason : undefined,
                            comment: approveNote || undefined,
                          }),
                        () => setApproveOpen(false),
                      )
                    }
                  >
                    {pending === 'approve' && <Loader2 className="animate-spin" />} Approve · {ROUTE_LABELS[route]} · {issueType === 'EPIC' ? 'Epic' : 'Story'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="destructive" disabled={!!pending || isOwnRequest}>
                  <XCircle /> Reject
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Reject {reference}</DialogTitle>
                  <DialogDescription>The reason is mandatory and is sent to the requester as feedback.</DialogDescription>
                </DialogHeader>
                <div className="space-y-2">
                  <Label htmlFor="reject-reason">Rejection reason</Label>
                  <Textarea
                    id="reject-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={5}
                    placeholder="e.g. The financial case is not yet supported: please quantify hours saved per month with Finance."
                  />
                  <p className="text-xs text-muted-foreground">{reason.trim().length < 10 ? `At least 10 characters (${reason.trim().length}/10)` : 'Ready'}</p>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setRejectOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    disabled={reason.trim().length < 10 || pending === 'reject'}
                    onClick={() => run('reject', () => post(url, { action: 'reject', reason }), () => setRejectOpen(false))}
                  >
                    {pending === 'reject' && <Loader2 className="animate-spin" />} Reject request
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        )}

        {canRerun && (
          <Button size="sm" variant="outline" onClick={() => run('assess', () => post(`/api/admin/requests/${requestId}/assess`))} disabled={!!pending}>
            {pending === 'assess' ? <Loader2 className="animate-spin" /> : <Gauge />}
            {assessment.status === 'FAILED' ? 'Retry assessment' : 'Re-run assessment'}
          </Button>
        )}

        {confluenceState === 'FAILED' && (
          <Button size="sm" variant="outline" onClick={() => run('confluence', () => post(`/api/admin/requests/${requestId}/confluence`))} disabled={!!pending}>
            {pending === 'confluence' ? <Loader2 className="animate-spin" /> : <BookOpen />} Retry Confluence publish
          </Button>
        )}

        {jiraTask && ['DEAD_LETTERED', 'FAILED'].includes(jiraTask.status) && (
          <Button size="sm" variant="outline" onClick={() => run('retry', () => post(`/api/admin/jira/${jiraTask.id}/retry`))} disabled={!!pending}>
            {pending === 'retry' ? <Loader2 className="animate-spin" /> : <RotateCcw />} Retry Jira sync
          </Button>
        )}
      </div>

      {status === 'UNDER_IT_REVIEW' && isOwnRequest && (
        <p className="text-xs text-muted-foreground">You raised this request, so another reviewer must approve or reject it.</p>
      )}
      {status === 'UNDER_IT_REVIEW' && assessmentBlocks && (
        <p className="text-xs text-amber-700">
          {assessment.status === 'FAILED'
            ? 'The value and route assessment failed — re-run it before approving.'
            : 'Approval unlocks once the value and development-route assessment completes.'}
        </p>
      )}

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (comment.trim()) void run('comment', () => post(url, { action: 'comment', comment }), () => setComment(''));
        }}
      >
        <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={1} placeholder="Add an internal review comment…" className="min-h-9" />
        <Button type="submit" size="sm" variant="secondary" disabled={!comment.trim() || !!pending}>
          <MessageSquarePlus /> Comment
        </Button>
      </form>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
