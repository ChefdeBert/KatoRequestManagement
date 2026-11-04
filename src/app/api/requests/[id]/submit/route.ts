import { getCurrentUser, jsonError } from '@/lib/auth';
import { handleError } from '@/lib/http';
import { submitRequest } from '@/lib/lifecycle';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'Unauthenticated');
  const { id } = await params;
  try {
    const doc = await submitRequest(id, user);
    return Response.json({ ok: true, brdDocumentId: doc.id, version: doc.version });
  } catch (err) {
    return handleError(err);
  }
}
