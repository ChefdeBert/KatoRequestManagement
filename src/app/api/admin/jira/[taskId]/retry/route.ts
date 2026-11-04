import { getCurrentUser, isStaff, jsonError } from '@/lib/auth';
import { handleError } from '@/lib/http';
import { retryJiraSync } from '@/lib/lifecycle';

/** Replay a dead-lettered Jira sync once the root cause (credentials, field mapping, outage) is fixed. */
export async function POST(_req: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const user = await getCurrentUser();
  if (!user || !isStaff(user.role)) return jsonError(403, 'Forbidden');
  const { taskId } = await params;
  try {
    await retryJiraSync(taskId, user);
    return Response.json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
