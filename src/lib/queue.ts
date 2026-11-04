import { Queue, type JobsOptions } from 'bullmq';
import IORedis from 'ioredis';

export const QUEUES = {
  JIRA: 'kato-jira-sync',
  JIRA_DLQ: 'kato-jira-sync-dlq',
  NOTIFY: 'kato-notifications',
} as const;

export type JiraJob = { taskId: string };
export type JiraDeadLetter = { taskId: string; error: string; attemptsMade: number; failedAt: string };
export type NotifyJob = { notificationId: string };

const g = globalThis as unknown as {
  katoRedis?: IORedis;
  katoQueues?: Partial<Record<string, Queue>>;
};

export function redisConnection() {
  // BullMQ requires maxRetriesPerRequest: null for blocking connections
  g.katoRedis ??= new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });
  return g.katoRedis;
}

function queue<T>(name: string): Queue<T> {
  g.katoQueues ??= {};
  g.katoQueues[name] ??= new Queue(name, { connection: redisConnection() });
  return g.katoQueues[name] as Queue<T>;
}

export const jiraQueue = () => queue<JiraJob>(QUEUES.JIRA);
export const jiraDeadLetterQueue = () => queue<JiraDeadLetter>(QUEUES.JIRA_DLQ);
export const notifyQueue = () => queue<NotifyJob>(QUEUES.NOTIFY);

export const JIRA_MAX_ATTEMPTS = Number(process.env.JIRA_SYNC_MAX_ATTEMPTS ?? 8);

/** 30s, 1m, 2m, 4m … ≈ 1h of total retry window at 8 attempts. */
export const jiraJobOptions: JobsOptions = {
  attempts: JIRA_MAX_ATTEMPTS,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: { count: 5000 },
  removeOnFail: false,
};

/**
 * jobId = task id makes enqueueing idempotent: the outbox reconciler can
 * safely re-add PENDING tasks without creating duplicate Jira issues.
 */
export async function enqueueJiraSync(taskId: string, opts: { retryOf?: string } = {}) {
  const jobId = opts.retryOf ? `jira-${taskId}-retry-${Date.now()}` : `jira-${taskId}`;
  await jiraQueue().add('create-issue', { taskId }, { ...jiraJobOptions, jobId });
}

export async function enqueueNotification(notificationId: string) {
  await notifyQueue().add(
    'deliver',
    { notificationId },
    { jobId: `notify-${notificationId}`, attempts: 5, backoff: { type: 'exponential', delay: 15_000 }, removeOnComplete: { count: 5000 } },
  );
}
