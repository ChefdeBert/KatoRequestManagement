import type { FeatureRequest, JiraIssueType, Prisma } from '@prisma/client';
import { UnrecoverableError } from 'bullmq';
import { OPCO_LABELS, formatRef, type BRD, type LevelValue } from './brd';
import { notifyStaff, notifyUser } from './notify';
import { prisma } from './prisma';
import { publicUrl } from './utils';

// ── Config ──────────────────────────────────────────────────────────

function cfg() {
  const baseUrl = process.env.JIRA_BASE_URL?.replace(/\/$/, '');
  if (!baseUrl || !process.env.JIRA_EMAIL || !process.env.JIRA_API_TOKEN || !process.env.JIRA_PROJECT_KEY) {
    throw new UnrecoverableError('Jira is not configured (JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEY)');
  }
  return {
    baseUrl,
    auth: 'Basic ' + Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString('base64'),
    projectKey: process.env.JIRA_PROJECT_KEY,
    issueTypes: { EPIC: process.env.JIRA_EPIC_ISSUE_TYPE ?? 'Epic', STORY: process.env.JIRA_STORY_ISSUE_TYPE ?? 'Story' },
    setPriority: process.env.JIRA_SET_PRIORITY !== 'false',
    priorityMap: parseJson<Record<LevelValue, string>>(process.env.JIRA_PRIORITY_MAP, {
      CRITICAL: 'Highest',
      HIGH: 'High',
      MEDIUM: 'Medium',
      LOW: 'Low',
    }),
    customFields: parseJson<Record<string, string>>(process.env.JIRA_CUSTOM_FIELDS, {}),
    epicNameField: process.env.JIRA_EPIC_NAME_FIELD || undefined,
  };
}

function parseJson<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// ── HTTP ────────────────────────────────────────────────────────────

export class JiraHttpError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`Jira HTTP ${status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`.slice(0, 2000));
  }
  /** 408/409/429/5xx are transient; other 4xx are payload/permission problems → DLQ immediately. */
  get retryable() {
    return this.status >= 500 || [408, 409, 425, 429].includes(this.status);
  }
}

async function jira<T>(path: string, init: RequestInit = {}): Promise<T> {
  const c = cfg();
  let res: Response;
  try {
    res = await fetch(`${c.baseUrl}${path}`, {
      ...init,
      headers: { Authorization: c.auth, Accept: 'application/json', 'Content-Type': 'application/json', ...init.headers },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    throw new Error(`Jira network error: ${(err as Error).message}`); // retryable
  }
  const text = await res.text();
  const body = text ? safeJson(text) : null;
  if (!res.ok) {
    const e = new JiraHttpError(res.status, body);
    throw e.retryable ? e : new UnrecoverableError(e.message);
  }
  return body as T;
}

const safeJson = (t: string) => {
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
};

// ── Atlassian Document Format builders ──────────────────────────────

type AdfNode = Record<string, unknown>;
const txt = (text: string, marks?: AdfNode[]): AdfNode => ({ type: 'text', text, ...(marks ? { marks } : {}) });
const p = (...content: AdfNode[]): AdfNode => ({ type: 'paragraph', content });
const h = (level: number, text: string): AdfNode => ({ type: 'heading', attrs: { level }, content: [txt(text)] });
const bullets = (items: string[]): AdfNode =>
  items.length
    ? { type: 'bulletList', content: items.map((i) => ({ type: 'listItem', content: [p(txt(i))] })) }
    : p(txt('None recorded', [{ type: 'em' }]));
const strong = (label: string, value: string) => p(txt(`${label}: `, [{ type: 'strong' }]), txt(value || '—'));

function buildDescription(brd: BRD, reference: string, katoUrl: string): AdfNode {
  return {
    type: 'doc',
    version: 1,
    content: [
      p(txt('Created by Kato from an approved request. '), txt(`${reference} in Kato`, [{ type: 'link', attrs: { href: katoUrl } }])),
      strong('Operating company', OPCO_LABELS[brd.opco]),
      strong('Business unit', brd.businessUnit),
      strong('Department', brd.department),
      strong('Business sponsor', [brd.sponsor.name, brd.sponsor.title].filter(Boolean).join(', ')),
      h(2, 'Problem statement'),
      p(txt(brd.problemStatement)),
      h(2, 'Request summary'),
      p(txt(brd.summary)),
      h(2, 'Strategic goals'),
      bullets(brd.strategicGoals),
      h(2, 'Impact & urgency'),
      strong(`Impact (${brd.impact})`, brd.impactJustification),
      strong(`Urgency (${brd.urgency})`, brd.urgencyJustification),
      ...(brd.targetDate ? [strong('Target date', brd.targetDate)] : []),
      h(2, 'Success criteria'),
      bullets(brd.successCriteria),
      h(2, 'Target KPIs'),
      bullets(brd.kpis.map((k) => `${k.metric}: ${k.baseline ? `${k.baseline} → ` : ''}${k.target}`)),
      h(2, 'References'),
      bullets(brd.references.map((r) => `${r.kind}: ${r.value}${r.note ? ` (${r.note})` : ''}`)),
      ...(brd.risks.length ? [h(2, 'Risks'), bullets(brd.risks)] : []),
      ...(brd.constraints.length ? [h(2, 'Constraints'), bullets(brd.constraints)] : []),
      ...(brd.openQuestions.length ? [h(2, 'Open questions'), bullets(brd.openQuestions)] : []),
    ],
  };
}

const LEVEL_RANK: Record<LevelValue, number> = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
const RANK_LEVEL = ['LOW', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

/** Priority = ceiling of the impact/urgency average (CRITICAL impact + LOW urgency → HIGH). */
export function derivePriority(impact: LevelValue, urgency: LevelValue): LevelValue {
  return RANK_LEVEL[Math.ceil((LEVEL_RANK[impact] + LEVEL_RANK[urgency]) / 2)];
}

export function katoLabel(request: Pick<FeatureRequest, 'number'>) {
  return `kato-${request.number}`;
}

/** Pure: build the Jira create-issue body. Stored on JiraSyncTask.payload for audit. */
export function buildIssuePayload(request: FeatureRequest, brd: BRD, issueType: JiraIssueType) {
  const c = cfg();
  const reference = formatRef(request.number);
  const katoUrl = publicUrl(`/admin/dashboard?selected=${request.id}`);
  const fields: Record<string, unknown> = {
    project: { key: c.projectKey },
    issuetype: { name: c.issueTypes[issueType] },
    summary: `${brd.title} [${reference}]`.slice(0, 254),
    description: buildDescription(brd, reference, katoUrl),
    labels: ['kato', katoLabel(request), `opco-${brd.opco.toLowerCase().replace(/_/g, '-')}`],
  };
  if (c.setPriority) fields.priority = { name: c.priorityMap[derivePriority(brd.impact, brd.urgency)] };
  if (issueType === 'EPIC' && c.epicNameField) fields[c.epicNameField] = brd.title.slice(0, 254);

  const values: Record<string, string | undefined> = {
    opco: OPCO_LABELS[brd.opco],
    businessUnit: brd.businessUnit,
    department: brd.department,
    sponsor: brd.sponsor.name,
    impact: brd.impact,
    urgency: brd.urgency,
    katoUrl,
    targetDate: brd.targetDate,
  };
  for (const [key, spec] of Object.entries(c.customFields)) {
    const value = values[key];
    if (!value) continue;
    const [fieldId, kind] = spec.split(':');
    fields[fieldId] = kind === 'option' ? { value } : value;
  }
  return { fields };
}

// ── API calls ───────────────────────────────────────────────────────

type CreatedIssue = { id: string; key: string; self: string };

/** Idempotency guard: a retry after a timed-out-but-successful create must not duplicate the issue. */
async function findIssueByLabel(label: string): Promise<CreatedIssue | null> {
  const c = cfg();
  const res = await jira<{ issues?: { id: string; key: string; self: string }[] }>('/rest/api/3/search/jql', {
    method: 'POST',
    body: JSON.stringify({ jql: `project = "${c.projectKey}" AND labels = "${label}"`, fields: ['key'], maxResults: 1 }),
  });
  return res.issues?.[0] ?? null;
}

async function createIssue(payload: unknown) {
  return jira<CreatedIssue>('/rest/api/3/issue', { method: 'POST', body: JSON.stringify(payload) });
}

async function addRemoteLink(issueKey: string, requestId: string, reference: string) {
  await jira(`/rest/api/3/issue/${issueKey}/remotelink`, {
    method: 'POST',
    body: JSON.stringify({
      globalId: `kato:${requestId}`, // same globalId → Jira updates instead of duplicating
      object: { url: publicUrl(`/admin/dashboard?selected=${requestId}`), title: `${reference} — Kato request & BRD` },
    }),
  });
}

// ── Orchestration (called by the BullMQ worker) ─────────────────────

export async function syncTaskToJira(taskId: string) {
  const task = await prisma.jiraSyncTask.findUnique({ where: { id: taskId }, include: { request: true } });
  if (!task) throw new UnrecoverableError(`JiraSyncTask ${taskId} not found`);
  if (task.status === 'SUCCEEDED' && task.jiraIssueKey) return task.jiraIssueKey;

  await prisma.jiraSyncTask.update({ where: { id: taskId }, data: { status: 'IN_PROGRESS', attempts: { increment: 1 } } });

  const { request } = task;
  const reference = formatRef(request.number);
  const existing = await findIssueByLabel(katoLabel(request));
  const issue = existing ?? (await createIssue(task.payload));
  const issueUrl = `${cfg().baseUrl}/browse/${issue.key}`;

  await addRemoteLink(issue.key, request.id, reference).catch((err) =>
    console.warn(`[jira] remote link failed for ${issue.key} (non-fatal)`, err),
  );

  const response = { ...issue, reusedExisting: Boolean(existing) } as unknown as Prisma.InputJsonValue;
  await prisma.$transaction([
    prisma.jiraSyncTask.update({
      where: { id: taskId },
      data: { status: 'SUCCEEDED', jiraIssueKey: issue.key, response, lastError: null, completedAt: new Date() },
    }),
    prisma.featureRequest.update({ where: { id: request.id }, data: { jiraIssueKey: issue.key, jiraIssueUrl: issueUrl } }),
    prisma.approvalLog.create({
      data: {
        requestId: request.id,
        action: 'JIRA_SYNCED',
        comment: `${task.issueType === 'EPIC' ? 'Epic' : 'Story'} ${issue.key} ${existing ? 'linked (already existed)' : 'created'}`,
        metadata: { taskId, payload: task.payload as Prisma.InputJsonValue, response },
      },
    }),
  ]);

  await notifyUser({
    userId: request.requesterId,
    requestId: request.id,
    type: 'JIRA_CREATED',
    title: `${reference} is now ${issue.key} in Jira`,
    body: `Engineering has been handed your request "${request.title}". Track it in Jira: ${issueUrl}`,
    link: `/request?id=${request.id}`,
  });
  return issue.key;
}

export async function recordAttemptFailure(taskId: string, error: Error) {
  await prisma.jiraSyncTask.update({ where: { id: taskId }, data: { status: 'FAILED', lastError: error.message.slice(0, 4000) } });
}

export async function recordDeadLetter(taskId: string, error: Error, attemptsMade: number) {
  const task = await prisma.jiraSyncTask.update({
    where: { id: taskId },
    data: { status: 'DEAD_LETTERED', lastError: error.message.slice(0, 4000) },
    include: { request: true },
  });
  await prisma.approvalLog.create({
    data: {
      requestId: task.requestId,
      action: 'JIRA_SYNC_FAILED',
      comment: `Jira sync moved to dead-letter queue after ${attemptsMade} attempt(s)`,
      metadata: { taskId, error: error.message.slice(0, 4000), payload: task.payload as Prisma.InputJsonValue },
    },
  });
  await notifyStaff({
    requestId: task.requestId,
    type: 'JIRA_SYNC_FAILED',
    title: `Jira sync failed for ${formatRef(task.request.number)}`,
    body: `Kato could not create the Jira issue after ${attemptsMade} attempt(s): ${error.message.slice(0, 500)}\nRetry it from the admin dashboard once the cause is fixed.`,
    link: `/admin/dashboard?selected=${task.requestId}&tab=jira`,
  });
}
