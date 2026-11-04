import { z } from 'zod';
import { getCurrentUser, isStaff, jsonError } from '@/lib/auth';
import { handleError } from '@/lib/http';
import { addComment, approveRequest, rejectRequest, startReview } from '@/lib/lifecycle';

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start_review'), comment: z.string().trim().max(4000).optional() }),
  z.object({ action: z.literal('approve'), issueType: z.enum(['EPIC', 'STORY']), comment: z.string().trim().max(4000).optional() }),
  z.object({ action: z.literal('reject'), reason: z.string().trim().min(10, 'Please give a reason of at least 10 characters').max(4000) }),
  z.object({ action: z.literal('comment'), comment: z.string().trim().min(1).max(4000) }),
]);

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || !isStaff(user.role)) return jsonError(403, 'Forbidden');
  const { id } = await params;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(422, parsed.error.issues[0]?.message ?? 'Invalid body');
  const body = parsed.data;

  try {
    switch (body.action) {
      case 'start_review':
        await startReview(id, user, body.comment || undefined);
        break;
      case 'approve': {
        const task = await approveRequest(id, user, { issueType: body.issueType, comment: body.comment || undefined });
        return Response.json({ ok: true, jiraSyncTaskId: task.id });
      }
      case 'reject':
        await rejectRequest(id, user, body.reason);
        break;
      case 'comment':
        await addComment(id, user, body.comment);
        break;
    }
    return Response.json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
