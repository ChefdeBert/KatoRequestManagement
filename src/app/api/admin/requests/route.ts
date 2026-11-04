import { getCurrentUser, isStaff, jsonError } from '@/lib/auth';
import { listRequests, parseFilters } from '@/lib/admin-queries';
import { formatRef } from '@/lib/brd';

/** JSON view of the admin queue (for integrations / reporting). */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || !isStaff(user.role)) return jsonError(403, 'Forbidden');
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const { items, total } = await listRequests(parseFilters(sp));
  return Response.json({
    total,
    items: items.map((r) => ({
      id: r.id,
      reference: formatRef(r.number),
      title: r.title,
      status: r.status,
      opco: r.opco,
      impact: r.impact,
      urgency: r.urgency,
      requester: r.requester,
      jiraIssueKey: r.jiraIssueKey,
      submittedAt: r.submittedAt,
    })),
  });
}
