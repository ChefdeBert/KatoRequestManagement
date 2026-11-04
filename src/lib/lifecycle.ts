import { createHash } from 'node:crypto';
import type { JiraIssueType, Prisma, RequestStatus } from '@prisma/client';
import { asDraft, brdSchema, brdToMarkdown, denormalise, formatRef, validateForSubmission, type BRD } from './brd';
import { buildIssuePayload } from './jira';
import { notifyStaff, notifyUser } from './notify';
import { prisma } from './prisma';
import { enqueueJiraSync } from './queue';
import type { SessionUser } from './auth';

/**
 * Request state machine:
 *   DRAFT → SUBMITTED → UNDER_IT_REVIEW → APPROVED | REJECTED
 */
export const TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
  DRAFT: ['SUBMITTED'],
  SUBMITTED: ['UNDER_IT_REVIEW'],
  UNDER_IT_REVIEW: ['APPROVED', 'REJECTED'],
  APPROVED: [],
  REJECTED: [],
};

export class LifecycleError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

type Tx = Prisma.TransactionClient;

/** Compare-and-set on status so two reviewers can't both act on the same request. */
async function transition(tx: Tx, id: string, from: RequestStatus, to: RequestStatus, data: Prisma.FeatureRequestUncheckedUpdateManyInput = {}) {
  if (!TRANSITIONS[from].includes(to)) throw new LifecycleError(409, `Cannot move a request from ${from} to ${to}`);
  const res = await tx.featureRequest.updateMany({ where: { id, status: from }, data: { ...data, status: to } });
  if (res.count !== 1) throw new LifecycleError(409, 'Request was changed by someone else — refresh and try again');
}

async function load(id: string) {
  const r = await prisma.featureRequest.findUnique({ where: { id } });
  if (!r) throw new LifecycleError(404, 'Request not found');
  return r;
}

function assertNotSelf(requesterId: string, actor: SessionUser) {
  if (requesterId === actor.id && process.env.KATO_ALLOW_SELF_APPROVAL !== 'true') {
    throw new LifecycleError(403, 'Segregation of duties: you cannot decide on your own request');
  }
}

const sha256 = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');

// ── Requester actions ───────────────────────────────────────────────

export async function getOrCreateDraft(userId: string) {
  const empty = await prisma.featureRequest.findFirst({
    where: { requesterId: userId, status: 'DRAFT', messages: { none: {} } },
    orderBy: { createdAt: 'desc' },
  });
  if (empty) return empty;
  return prisma.$transaction(async (tx) => {
    const r = await tx.featureRequest.create({ data: { requesterId: userId } });
    await tx.approvalLog.create({ data: { requestId: r.id, actorId: userId, action: 'CREATED', toStatus: 'DRAFT' } });
    return r;
  });
}

export async function submitRequest(id: string, user: SessionUser) {
  const r = await load(id);
  if (r.requesterId !== user.id) throw new LifecycleError(404, 'Request not found');
  const v = validateForSubmission(asDraft(r.draftBrd));
  if (!v.ok) throw new LifecycleError(422, 'The BRD is incomplete', { issues: v.issues });

  const reference = formatRef(r.number);
  const doc = await prisma.$transaction(async (tx) => {
    await transition(tx, id, 'DRAFT', 'SUBMITTED', { submittedAt: new Date(), completeness: 100, ...denormalise(v.brd) });
    const last = await tx.bRDDocument.findFirst({ where: { requestId: id }, orderBy: { version: 'desc' }, select: { version: true } });
    const version = (last?.version ?? 0) + 1;
    const doc = await tx.bRDDocument.create({
      data: {
        requestId: id,
        version,
        content: v.brd as unknown as Prisma.InputJsonValue,
        markdown: brdToMarkdown(v.brd, { reference, requester: user.name, version }),
        contentHash: sha256(v.brd),
        generatedById: user.id,
      },
    });
    await tx.approvalLog.create({
      data: { requestId: id, actorId: user.id, action: 'SUBMITTED', fromStatus: 'DRAFT', toStatus: 'SUBMITTED', metadata: { brdDocumentId: doc.id, version } },
    });
    return doc;
  });

  await notifyStaff(
    {
      requestId: id,
      type: 'REQUEST_SUBMITTED',
      title: `New request ${reference}: ${v.brd.title}`,
      body: `${user.name} submitted a ${v.brd.impact.toLowerCase()}-impact request for ${v.brd.businessUnit}.`,
      link: `/admin/dashboard?selected=${id}`,
    },
    user.id,
  );
  return doc;
}

// ── IT reviewer actions ─────────────────────────────────────────────

export async function startReview(id: string, actor: SessionUser, comment?: string) {
  await prisma.$transaction(async (tx) => {
    await transition(tx, id, 'SUBMITTED', 'UNDER_IT_REVIEW', { reviewStartedAt: new Date() });
    await tx.approvalLog.create({
      data: { requestId: id, actorId: actor.id, action: 'REVIEW_STARTED', fromStatus: 'SUBMITTED', toStatus: 'UNDER_IT_REVIEW', comment },
    });
  });
}

async function latestBrd(tx: Tx, requestId: string): Promise<BRD> {
  const doc = await tx.bRDDocument.findFirst({ where: { requestId }, orderBy: { version: 'desc' } });
  if (!doc) throw new LifecycleError(409, 'No submitted BRD found for this request');
  return brdSchema.parse(doc.content);
}

export async function approveRequest(id: string, actor: SessionUser, input: { issueType: JiraIssueType; comment?: string }) {
  const r = await load(id);
  assertNotSelf(r.requesterId, actor);

  const task = await prisma.$transaction(async (tx) => {
    await transition(tx, id, 'UNDER_IT_REVIEW', 'APPROVED', { decidedAt: new Date(), decidedById: actor.id });
    const brd = await latestBrd(tx, id);
    const payload = buildIssuePayload(r, brd, input.issueType) as unknown as Prisma.InputJsonValue;
    // Outbox: the task row commits atomically with the approval
    const task = await tx.jiraSyncTask.create({ data: { requestId: id, issueType: input.issueType, payload } });
    await tx.approvalLog.createMany({
      data: [
        { requestId: id, actorId: actor.id, action: 'APPROVED', fromStatus: 'UNDER_IT_REVIEW', toStatus: 'APPROVED', comment: input.comment, metadata: { issueType: input.issueType } },
        { requestId: id, actorId: actor.id, action: 'JIRA_SYNC_QUEUED', metadata: { taskId: task.id, payload } },
      ],
    });
    return task;
  });

  // If Redis is down the PENDING task is picked up by the worker's outbox reconciler.
  await enqueueJiraSync(task.id).catch((err) => console.error('[approve] enqueue failed; reconciler will retry', task.id, err));

  await notifyUser({
    userId: r.requesterId,
    requestId: id,
    type: 'REQUEST_APPROVED',
    title: `${formatRef(r.number)} approved`,
    body: `Your request "${r.title}" was approved by ${actor.name}. A Jira ${input.issueType === 'EPIC' ? 'Epic' : 'Story'} is being created for engineering.${input.comment ? `\n\nReviewer note: ${input.comment}` : ''}`,
    link: `/request?id=${id}`,
  });
  return task;
}

export async function rejectRequest(id: string, actor: SessionUser, reason: string) {
  const r = await load(id);
  assertNotSelf(r.requesterId, actor);
  if (reason.trim().length < 10) throw new LifecycleError(422, 'A rejection reason of at least 10 characters is required');

  await prisma.$transaction(async (tx) => {
    await transition(tx, id, 'UNDER_IT_REVIEW', 'REJECTED', { decidedAt: new Date(), decidedById: actor.id, rejectionReason: reason });
    await tx.approvalLog.create({
      data: { requestId: id, actorId: actor.id, action: 'REJECTED', fromStatus: 'UNDER_IT_REVIEW', toStatus: 'REJECTED', comment: reason },
    });
  });

  await notifyUser({
    userId: r.requesterId,
    requestId: id,
    type: 'REQUEST_REJECTED',
    title: `${formatRef(r.number)} was not approved`,
    body: `Your request "${r.title}" was reviewed by ${actor.name} and not approved.\n\nFeedback: ${reason}\n\nYou can start a new request in Kato that addresses this feedback.`,
    link: `/request?id=${id}`,
  });
}

export async function addComment(id: string, actor: SessionUser, comment: string) {
  await load(id);
  await prisma.approvalLog.create({ data: { requestId: id, actorId: actor.id, action: 'COMMENTED', comment } });
}

export async function retryJiraSync(taskId: string, actor: SessionUser) {
  const task = await prisma.jiraSyncTask.findUnique({ where: { id: taskId } });
  if (!task) throw new LifecycleError(404, 'Sync task not found');
  if (!['DEAD_LETTERED', 'FAILED'].includes(task.status)) throw new LifecycleError(409, `Task is ${task.status}; nothing to retry`);
  await prisma.$transaction([
    prisma.jiraSyncTask.update({ where: { id: taskId }, data: { status: 'PENDING' } }),
    prisma.approvalLog.create({ data: { requestId: task.requestId, actorId: actor.id, action: 'JIRA_SYNC_RETRIED', metadata: { taskId } } }),
  ]);
  await enqueueJiraSync(taskId, { retryOf: taskId });
}
