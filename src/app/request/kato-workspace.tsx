'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import type { RequestStatus } from '@prisma/client';
import { AlertTriangle, ArrowUp, CheckCircle2, FilePenLine, Loader2, RotateCcw, ShieldCheck, Square } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BrdPreview } from '@/components/brd-preview';
import { StatusBadge } from '@/components/status-badge';
import { Button, Progress, Textarea } from '@/components/ui';
import { FIELD_LABELS, assessCompleteness, formatRef, mergeBrd, type BRDDraft, type BRDPatch } from '@/lib/brd';
import { cn, formatDateTime } from '@/lib/utils';

type Props = {
  request: {
    id: string;
    number: number;
    status: RequestStatus;
    jiraIssueKey: string | null;
    jiraIssueUrl: string | null;
    rejectionReason: string | null;
    submittedAt: string | null;
    confluencePageUrl: string | null;
  };
  initialMessages: UIMessage[];
  initialDraft: BRDDraft;
  user: { name: string };
  myRequests: { id: string; number: number; title: string | null; status: RequestStatus }[];
};

const STARTERS = [
  'Finance teams across OpCos reconcile supplier invoices by hand in Excel — I want this automated.',
  'Our NOC needs an AI assistant that summarises fibre-cut incidents for customers.',
  'Sasai agents need a dashboard showing failed wallet top-ups in real time.',
];

type ToolPart = { type: string; state?: string; input?: unknown };
const isBrdTool = (p: { type: string }): p is ToolPart => p.type === 'tool-updateBRD';

export function KatoWorkspace({ request, initialMessages, initialDraft, user, myRequests }: Props) {
  const router = useRouter();
  const readOnly = request.status !== 'DRAFT';
  const reference = formatRef(request.number);
  const [input, setInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const transport = useMemo(() => new DefaultChatTransport({ api: '/api/chat', body: { requestId: request.id } }), [request.id]);
  const { messages, sendMessage, status, error, stop, regenerate } = useChat({ id: request.id, messages: initialMessages, transport });

  // Live BRD = server draft + any updateBRD tool calls streamed this session (including partial input)
  const initialIds = useMemo(() => new Set(initialMessages.map((m) => m.id)), [initialMessages]);
  const draft = useMemo(() => {
    let d = initialDraft;
    for (const m of messages) {
      if (initialIds.has(m.id)) continue;
      for (const p of m.parts) if (isBrdTool(p) && p.input && typeof p.input === 'object') d = mergeBrd(d, p.input as BRDPatch);
    }
    return d;
  }, [messages, initialDraft, initialIds]);
  const completeness = assessCompleteness(draft);

  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  const redacted = (lastAssistant?.metadata as { redactions?: number } | undefined)?.redactions ?? 0;
  const busy = status === 'submitted' || status === 'streaming';

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, status]);

  function send(text: string) {
    const t = text.trim();
    if (!t || busy || readOnly) return;
    void sendMessage({ text: t });
    setInput('');
  }

  async function submit() {
    setSubmitting(true);
    setSubmitError(null);
    const res = await fetch(`/api/requests/${request.id}/submit`, { method: 'POST' });
    if (res.ok) {
      router.refresh();
    } else {
      const j = (await res.json().catch(() => ({}))) as { error?: string; details?: { issues?: string[] } };
      setSubmitError([j.error ?? 'Submission failed', ...(j.details?.issues ?? [])].join(' · '));
    }
    setSubmitting(false);
  }

  return (
    <div className="flex h-dvh flex-col bg-muted/30">
      <header className="flex items-center justify-between gap-4 border-b bg-background px-5 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">K</div>
          <div>
            <p className="text-sm font-semibold leading-tight">Kato</p>
            <p className="text-xs text-muted-foreground">AI Software Factory · Request intake</p>
          </div>
          <span className="ml-3 font-mono text-xs text-muted-foreground">{reference}</span>
          <StatusBadge status={request.status} />
        </div>
        <div className="flex items-center gap-2">
          {myRequests.length > 0 && (
            <details className="relative">
              <summary className="cursor-pointer list-none rounded-md px-3 py-1.5 text-sm hover:bg-accent">My requests</summary>
              <ul className="absolute right-0 z-20 mt-1 w-80 rounded-md border bg-popover p-1 shadow-md">
                {myRequests.map((r) => (
                  <li key={r.id}>
                    <Link href={`/request?id=${r.id}`} className="flex items-center justify-between gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent">
                      <span className="truncate">
                        <span className="font-mono text-xs text-muted-foreground">{formatRef(r.number)}</span> {r.title ?? 'Untitled'}
                      </span>
                      <StatusBadge status={r.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <Button asChild variant="outline" size="sm">
            <Link href="/request?new=1">New request</Link>
          </Button>
        </div>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-2">
        {/* ── Chat ─────────────────────────────────────────── */}
        <section className="flex min-h-0 flex-col border-r bg-background" aria-label="Conversation with Kato">
          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-6">
            <Bubble role="assistant">
              {`Hi ${user.name.split(' ')[0]}, I'm Kato, the AI Software Factory's business analyst. Tell me about the problem you'd like solved or the feature you need, in your own words. I'll ask a few follow-up questions and build the Business Requirements Document on the right as we go.`}
            </Bubble>

            {messages.length === 0 && !readOnly && (
              <div className="flex flex-wrap gap-2 pl-10">
                {STARTERS.map((s) => (
                  <button key={s} onClick={() => send(s)} className="rounded-full border px-3 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
                    {s}
                  </button>
                ))}
              </div>
            )}

            {messages.map((m) => (
              <div key={m.id} className="space-y-2">
                {m.parts.map((p, i) => {
                  if (p.type === 'text' && p.text.trim()) return <Bubble key={i} role={m.role === 'user' ? 'user' : 'assistant'}>{p.text}</Bubble>;
                  if (isBrdTool(p)) return <BrdUpdateChip key={i} part={p} />;
                  return null;
                })}
              </div>
            ))}

            {status === 'submitted' && (
              <div className="flex items-center gap-2 pl-10 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Kato is thinking…
              </div>
            )}
            {error && (
              <div className="ml-10 flex items-center gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                <span className="flex-1">Kato could not respond. {error.message}</span>
                <Button size="sm" variant="outline" onClick={() => regenerate()}>
                  <RotateCcw /> Retry
                </Button>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {readOnly ? (
            <StatusPanel request={request} />
          ) : (
            <div className="border-t p-4">
              {redacted > 0 && (
                <p className="mb-2 flex items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  <ShieldCheck className="h-4 w-4" />
                  Kato removed {redacted} sensitive value{redacted > 1 ? 's' : ''} (credentials, tokens or card numbers) before processing. They were not stored.
                </p>
              )}
              <form
                className="relative"
                onSubmit={(e) => {
                  e.preventDefault();
                  send(input);
                }}
              >
                <Textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      send(input);
                    }
                  }}
                  placeholder={messages.length ? 'Reply to Kato…' : 'Describe the problem or feature you need…'}
                  rows={3}
                  maxLength={8000}
                  className="resize-none pr-14"
                  aria-label="Message Kato"
                />
                {busy ? (
                  <Button type="button" size="icon" variant="secondary" className="absolute bottom-2 right-2" onClick={() => stop()} aria-label="Stop">
                    <Square />
                  </Button>
                ) : (
                  <Button type="submit" size="icon" className="absolute bottom-2 right-2" disabled={!input.trim()} aria-label="Send">
                    <ArrowUp />
                  </Button>
                )}
              </form>
              <p className="mt-2 text-[11px] text-muted-foreground">Enter to send · Shift+Enter for a new line · Never share passwords or secrets — Kato redacts them automatically.</p>
            </div>
          )}
        </section>

        {/* ── Live BRD ─────────────────────────────────────── */}
        <section className="flex min-h-0 flex-col" aria-label="Live BRD preview">
          <div className="border-b bg-background px-5 py-3">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="font-medium">BRD completeness</span>
                  <span className="tabular-nums text-muted-foreground">{completeness.percent}%</span>
                </div>
                <Progress value={completeness.percent} />
              </div>
              {!readOnly && (
                <Button onClick={submit} disabled={!completeness.ready || submitting || busy}>
                  {submitting ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
                  Submit for IT review
                </Button>
              )}
            </div>
            {!readOnly && completeness.missing.length > 0 && (
              <p className="mt-2 truncate text-xs text-muted-foreground" title={completeness.missing.join(', ')}>
                Still needed: {completeness.missing.join(' · ')}
              </p>
            )}
            {submitError && <p className="mt-2 text-xs text-destructive">{submitError}</p>}
          </div>
          <div className="flex-1 overflow-y-auto p-5">
            <div className="mx-auto max-w-2xl rounded-xl border bg-background p-6 shadow-sm">
              <BrdPreview draft={draft} missingKeys={readOnly ? [] : completeness.missingKeys} reference={reference} />
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function Bubble({ role, children }: { role: 'user' | 'assistant'; children: React.ReactNode }) {
  const mine = role === 'user';
  return (
    <div className={cn('flex gap-3', mine && 'flex-row-reverse')}>
      {!mine && <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">K</div>}
      <div
        className={cn(
          'max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
          mine ? 'rounded-tr-sm bg-primary text-primary-foreground' : 'rounded-tl-sm bg-muted',
        )}
      >
        {children}
      </div>
    </div>
  );
}

function BrdUpdateChip({ part }: { part: ToolPart }) {
  const fields = part.input && typeof part.input === 'object' ? Object.keys(part.input).map((k) => FIELD_LABELS[k] ?? k) : [];
  const done = part.state === 'output-available';
  const failed = part.state === 'output-error';
  return (
    <div className="ml-10 inline-flex max-w-[85%] items-center gap-2 rounded-md border border-dashed px-2.5 py-1 text-xs text-muted-foreground">
      {failed ? <AlertTriangle className="h-3.5 w-3.5 text-destructive" /> : done ? <FilePenLine className="h-3.5 w-3.5 text-primary" /> : <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      <span className="truncate">
        {failed ? 'BRD update failed' : done ? 'Updated BRD' : 'Updating BRD'}
        {fields.length ? ` · ${fields.join(', ')}` : ''}
      </span>
    </div>
  );
}

function StatusPanel({ request }: { request: Props['request'] }) {
  const copy: Record<RequestStatus, React.ReactNode> = {
    DRAFT: null,
    SUBMITTED: (
      <>
        Submitted {formatDateTime(request.submittedAt)}. Kato is assessing its business value and development route, and the IT team has been notified.
      </>
    ),
    UNDER_IT_REVIEW: <>The IT team is reviewing your request. You&apos;ll be notified of the decision.</>,
    APPROVED: (
      <>
        Approved.{' '}
        {request.jiraIssueKey ? (
          <>
            Engineering is tracking it as{' '}
            <a className="font-medium underline" href={request.jiraIssueUrl ?? '#'} target="_blank" rel="noreferrer">
              {request.jiraIssueKey}
            </a>
            .
          </>
        ) : (
          'The Jira ticket is being created.'
        )}
      </>
    ),
    REJECTED: (
      <>
        Not approved. <span className="font-medium">Feedback from IT:</span> {request.rejectionReason}
      </>
    ),
  };
  return (
    <div className="border-t bg-muted/40 p-4 text-sm">
      <p>{copy[request.status]}</p>
      {request.confluencePageUrl && (
        <p className="mt-1 text-xs">
          Your BRD is stored in Confluence:{' '}
          <a className="font-medium underline" href={request.confluencePageUrl} target="_blank" rel="noreferrer">
            open the BRD page
          </a>
          .
        </p>
      )}
      <p className="mt-1 text-xs text-muted-foreground">This conversation is read-only. Start a new request to raise something else.</p>
    </div>
  );
}
