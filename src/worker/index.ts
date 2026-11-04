/**
 * Kato background worker — run as a separate process/container:
 *   - Jira sync (retries with exponential backoff → DLQ)
 *   - Notification delivery (email)
 *   - Outbox reconciler for tasks that never reached Redis
 */
import { UnrecoverableError, Worker, type Job } from 'bullmq';
import { recordAttemptFailure, recordDeadLetter, syncTaskToJira } from '@/lib/jira';
import { deliverNotification } from '@/lib/notify';
import { prisma } from '@/lib/prisma';
import { QUEUES, enqueueJiraSync, jiraDeadLetterQueue, redisConnection, type JiraJob, type NotifyJob } from '@/lib/queue';

const connection = redisConnection();

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
  const exhausted = err instanceof UnrecoverableError || err.name === 'UnrecoverableError' || job.attemptsMade >= (job.opts.attempts ?? 1);
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
}
const reconcileTimer = setInterval(() => reconcile().catch((e) => console.error('[reconcile]', e)), 5 * 60_000);
void reconcile().catch((e) => console.error('[reconcile]', e));

async function shutdown(signal: string) {
  console.info(`[worker] ${signal} received, draining…`);
  clearInterval(reconcileTimer);
  await Promise.allSettled([jiraWorker.close(), notifyWorker.close()]);
  await prisma.$disconnect();
  await connection.quit();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

console.info('[worker] Kato worker started');
