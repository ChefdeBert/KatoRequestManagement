/**
 * Kato background worker — run as a separate process/container:
 *   - Value & development-route assessment of submitted BRDs (LLM)
 *   - Confluence BRD publishing (retries → DLQ)
 *   - Jira sync (retries with exponential backoff → DLQ)
 *   - Notification delivery (email)
 *   - Outbox reconciler for tasks that never reached Redis
 */
import { UnrecoverableError, Worker, type Job } from 'bullmq';
import { recordAssessmentFailure, runAssessment } from '@/lib/assessment';
import { recordConfluenceFailure, syncConfluencePage } from '@/lib/confluence';
import { recordAttemptFailure, recordDeadLetter, syncTaskToJira } from '@/lib/jira';
import { deliverNotification } from '@/lib/notify';
import { prisma } from '@/lib/prisma';
import {
  QUEUES,
  confluenceDeadLetterQueue,
  enqueueAssessment,
  enqueueConfluenceSync,
  enqueueJiraSync,
  jiraDeadLetterQueue,
  redisConnection,
  type AssessJob,
  type ConfluenceJob,
  type JiraJob,
  type NotifyJob,
} from '@/lib/queue';

const connection = redisConnection();

const isFinalFailure = (job: Job, err: Error) =>
  err instanceof UnrecoverableError || err.name === 'UnrecoverableError' || job.attemptsMade >= (job.opts.attempts ?? 1);

// ── Assessment ──────────────────────────────────────────────────────

const assessWorker = new Worker<AssessJob>(
  QUEUES.ASSESS,
  async (job) => {
    const a = await runAssessment(job.data.requestId);
    return a ? { assessmentId: a.id, route: a.recommendedRoute, valueScore: a.valueScore } : { skipped: true };
  },
  { connection, concurrency: 3 },
);
assessWorker.on('completed', (job, res) => console.info(`[assess] ${job.data.requestId} →`, res));
assessWorker.on('failed', async (job: Job<AssessJob> | undefined, err: Error) => {
  if (!job) return;
  console.warn(`[assess] ${job.data.requestId} attempt ${job.attemptsMade} failed: ${err.message}`);
  if (isFinalFailure(job, err)) await recordAssessmentFailure(job.data.requestId, err).catch((e) => console.error('[assess] bookkeeping failed', e));
});

// ── Confluence ──────────────────────────────────────────────────────
// concurrency 1: page updates are read-modify-write on the page version number

const confluenceWorker = new Worker<ConfluenceJob>(
  QUEUES.CONFLUENCE,
  async (job) => (await syncConfluencePage(job.data.requestId)) ?? { skipped: true },
  { connection, concurrency: 1 },
);
confluenceWorker.on('completed', (job, res) => console.info(`[confluence] ${job.data.requestId} →`, res));
confluenceWorker.on('failed', async (job: Job<ConfluenceJob> | undefined, err: Error) => {
  if (!job) return;
  const final = isFinalFailure(job, err);
  console.warn(`[confluence] ${job.data.requestId} attempt ${job.attemptsMade} failed${final ? ' → DLQ' : ''}: ${err.message}`);
  if (final) {
    await confluenceDeadLetterQueue()
      .add('dead-letter', { requestId: job.data.requestId, error: err.message, attemptsMade: job.attemptsMade, failedAt: new Date().toISOString() }, { removeOnFail: false })
      .catch(() => undefined);
  }
  await recordConfluenceFailure(job.data.requestId, err, job.attemptsMade, final).catch((e) => console.error('[confluence] bookkeeping failed', e));
});

// ── Jira ────────────────────────────────────────────────────────────

const jiraWorker = new Worker<JiraJob>(
  QUEUES.JIRA,
  async (job) => {
    try {
      const key = await syncTaskToJira(job.data.taskId);
      return { key };
    } catch (err) {
      await recordAttemptFailure(job.data.taskId, err as Error).catch(() => undefined);
      throw err;
    }
  },
  { connection, concurrency: 4, limiter: { max: 10, duration: 1000 } }, // stay well under Jira Cloud rate limits
);

jiraWorker.on('failed', async (job: Job<JiraJob> | undefined, err: Error) => {
  if (!job) return;
  const exhausted = isFinalFailure(job, err);
  console.warn(`[jira] task ${job.data.taskId} attempt ${job.attemptsMade} failed${exhausted ? ' → DLQ' : ''}: ${err.message}`);
  if (!exhausted) return;
  await jiraDeadLetterQueue().add(
    'dead-letter',
    { taskId: job.data.taskId, error: err.message, attemptsMade: job.attemptsMade, failedAt: new Date().toISOString() },
    { removeOnComplete: false, removeOnFail: false },
  );
  await recordDeadLetter(job.data.taskId, err, job.attemptsMade).catch((e) => console.error('[jira] DLQ bookkeeping failed', e));
});

jiraWorker.on('completed', (job, result) => console.info(`[jira] task ${job.data.taskId} → ${result?.key}`));

const notifyWorker = new Worker<NotifyJob>(QUEUES.NOTIFY, (job) => deliverNotification(job.data.notificationId), {
  connection,
  concurrency: 5,
});
notifyWorker.on('failed', (job, err) => console.warn(`[notify] ${job?.data.notificationId} failed: ${err.message}`));

/** Outbox reconciler: re-enqueue PENDING tasks (e.g. Redis was down at approval time). jobId dedupes. */
async function reconcile() {
  const stale = await prisma.jiraSyncTask.findMany({
    where: { status: 'PENDING', updatedAt: { lt: new Date(Date.now() - 2 * 60_000) } },
    select: { id: true },
    take: 100,
  });
  for (const t of stale) await enqueueJiraSync(t.id).catch(() => undefined);
  if (stale.length) console.info(`[reconcile] re-enqueued ${stale.length} pending Jira task(s)`);

  // Submissions whose assessment / Confluence publish never reached Redis (or a job was lost)
  const cutoff = new Date(Date.now() - 15 * 60_000);
  const stuck = await prisma.featureRequest.findMany({
    where: {
      status: { in: ['SUBMITTED', 'UNDER_IT_REVIEW', 'APPROVED', 'REJECTED'] },
      updatedAt: { lt: cutoff },
      OR: [{ assessmentStatus: 'PENDING' }, { confluenceSyncState: 'PENDING' }],
    },
    select: { id: true, status: true, assessmentStatus: true, confluenceSyncState: true },
    take: 50,
  });
  for (const r of stuck) {
    // Touch updatedAt so the same request is not re-enqueued every cycle while its job retries
    await prisma.featureRequest.update({ where: { id: r.id }, data: { updatedAt: new Date() } });
    if (r.assessmentStatus === 'PENDING' && ['SUBMITTED', 'UNDER_IT_REVIEW'].includes(r.status)) await enqueueAssessment(r.id).catch(() => undefined);
    if (r.confluenceSyncState === 'PENDING') await enqueueConfluenceSync(r.id).catch(() => undefined);
  }
  if (stuck.length) console.info(`[reconcile] re-enqueued follow-ups for ${stuck.length} request(s)`);
}
const reconcileTimer = setInterval(() => reconcile().catch((e) => console.error('[reconcile]', e)), 5 * 60_000);
void reconcile().catch((e) => console.error('[reconcile]', e));

async function shutdown(signal: string) {
  console.info(`[worker] ${signal} received, draining…`);
  clearInterval(reconcileTimer);
  await Promise.allSettled([jiraWorker.close(), notifyWorker.close(), assessWorker.close(), confluenceWorker.close()]);
  await prisma.$disconnect();
  await connection.quit();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

console.info('[worker] Kato worker started');
