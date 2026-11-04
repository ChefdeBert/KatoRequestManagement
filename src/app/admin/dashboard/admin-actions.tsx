'use client';

import type { JiraSyncStatus, RequestStatus } from '@prisma/client';
import { CheckCircle2, Loader2, MessageSquarePlus, PlayCircle, RotateCcw, XCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Label, Textarea } from '@/components/ui';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

type Props = {
  requestId: string;
  reference: string;
  status: RequestStatus;
  isOwnRequest: boolean;
  jiraTask?: { id: string; status: JiraSyncStatus } | null;
};

async function post(url: string, body?: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(j.error ?? `Request failed (${res.status})`);
  }
}

export function AdminActions({ requestId, reference, status, isOwnRequest, jiraTask }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [issueType, setIssueType] = useState<'EPIC' | 'STORY'>('EPIC');
  const [approveNote, setApproveNote] = useState('');
  const [reason, setReason] = useState('');

  const url = `/api/admin/requests/${requestId}/transition`;

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

  const decisionBlocked = isOwnRequest;

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
                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-600/90" disabled={!!pending || decisionBlocked}>
                  <CheckCircle2 /> Approve
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Approve {reference}</DialogTitle>
                  <DialogDescription>Kato will create the Jira issue for engineering and notify the requester.</DialogDescription>
                </DialogHeader>
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
                  <Textarea id="approve-note" value={approveNote} onChange={(e) => setApproveNote(e.target.value)} rows={3} />
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setApproveOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    className="bg-emerald-600 hover:bg-emerald-600/90"
                    disabled={pending === 'approve'}
                    onClick={() =>
                      run('approve', () => post(url, { action: 'approve', issueType, comment: approveNote || undefined }), () => setApproveOpen(false))
                    }
                  >
                    {pending === 'approve' && <Loader2 className="animate-spin" />} Approve & create {issueType === 'EPIC' ? 'Epic' : 'Story'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="destructive" disabled={!!pending || decisionBlocked}>
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
                    placeholder="e.g. Already covered by the Group ERP programme (AISF-1042). Please work with the SAP CoE instead."
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

        {jiraTask && ['DEAD_LETTERED', 'FAILED'].includes(jiraTask.status) && (
          <Button size="sm" variant="outline" onClick={() => run('retry', () => post(`/api/admin/jira/${jiraTask.id}/retry`))} disabled={!!pending}>
            {pending === 'retry' ? <Loader2 className="animate-spin" /> : <RotateCcw />} Retry Jira sync
          </Button>
        )}
      </div>

      {decisionBlocked && status === 'UNDER_IT_REVIEW' && (
        <p className="text-xs text-muted-foreground">You raised this request, so another reviewer must approve or reject it.</p>
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
