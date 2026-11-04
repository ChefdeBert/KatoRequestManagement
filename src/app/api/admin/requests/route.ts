import { getCurrentUser, isStaff, jsonError } from '@/lib/auth';
import { listRequests, parseFilters } from '@/lib/admin-queries';
import { formatRef } from '@/lib/brd';

const num = (d: { toNumber(): number } | null) => (d ? d.toNumber() : null);

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
      financialImpactUsd: {
        stated: { revenue: num(r.statedRevenueUsd), ebitda: num(r.statedEbitdaUsd), cashFlow: num(r.statedCashFlowUsd) },
        assessed: { revenue: num(r.assessedRevenueUsd), ebitda: num(r.assessedEbitdaUsd), cashFlow: num(r.assessedCashFlowUsd) },
      },
      valueScore: r.valueScore,
      assessmentStatus: r.assessmentStatus,
      recommendedRoute: r.recommendedRoute,
      approvedRoute: r.approvedRoute,
      confluencePageUrl: r.confluencePageUrl,
      jiraIssueKey: r.jiraIssueKey,
      submittedAt: r.submittedAt,
    })),
  });
}
