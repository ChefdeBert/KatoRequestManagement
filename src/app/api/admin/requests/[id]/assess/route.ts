import { getCurrentUser, isStaff, jsonError } from '@/lib/auth';
import { handleError } from '@/lib/http';
import { rerunAssessment } from '@/lib/lifecycle';

/** Re-run the value & development-route assessment (e.g. after it failed, or the BRD was clarified). */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || !isStaff(user.role)) return jsonError(403, 'Forbidden');
  const { id } = await params;
  try {
    await rerunAssessment(id, user);
    return Response.json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
