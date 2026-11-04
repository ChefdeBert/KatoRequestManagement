import { getCurrentUser, isStaff, jsonError } from '@/lib/auth';
import { handleError } from '@/lib/http';
import { retryConfluenceSync } from '@/lib/lifecycle';

/** Re-publish the BRD page to Confluence (e.g. after a dead-lettered sync). */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || !isStaff(user.role)) return jsonError(403, 'Forbidden');
  const { id } = await params;
  try {
    await retryConfluenceSync(id, user);
    return Response.json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
