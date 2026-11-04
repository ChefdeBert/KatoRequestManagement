import type { Level, OpCo, Prisma, RequestStatus } from '@prisma/client';
import { LEVELS, OPCOS } from './brd';
import { prisma } from './prisma';

export const STATUSES = ['SUBMITTED', 'UNDER_IT_REVIEW', 'APPROVED', 'REJECTED'] as const;
export const PAGE_SIZE = 25;

export type RequestFilters = { q?: string; status?: RequestStatus; opco?: OpCo; impact?: Level; page: number };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
const pick = <T extends string>(v: string | undefined, allowed: readonly T[]) => (allowed.includes(v as T) ? (v as T) : undefined);

export function parseFilters(sp: SP): RequestFilters {
  return {
    q: one(sp.q)?.trim().slice(0, 100) || undefined,
    status: pick(one(sp.status), STATUSES),
    opco: pick(one(sp.opco), OPCOS),
    impact: pick(one(sp.impact), LEVELS),
    page: Math.max(1, Number(one(sp.page)) || 1),
  };
}

export async function listRequests(f: RequestFilters) {
  const or: Prisma.FeatureRequestWhereInput[] = [];
  if (f.q) {
    or.push(
      { title: { contains: f.q, mode: 'insensitive' } },
      { jiraIssueKey: { equals: f.q.toUpperCase() } },
      { requester: { name: { contains: f.q, mode: 'insensitive' } } },
      { requester: { email: { contains: f.q, mode: 'insensitive' } } },
    );
    const num = f.q.match(/^(?:kato-)?0*(\d+)$/i)?.[1];
    if (num) or.push({ number: Number(num) });
  }

  const where: Prisma.FeatureRequestWhereInput = {
    status: f.status ?? { not: 'DRAFT' }, // drafts are private to the requester
    ...(f.opco ? { opco: f.opco } : {}),
    ...(f.impact ? { impact: f.impact } : {}),
    ...(or.length ? { OR: or } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.featureRequest.findMany({
      where,
      orderBy: [{ submittedAt: 'desc' }],
      skip: (f.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { requester: { select: { name: true, email: true, department: true } } },
    }),
    prisma.featureRequest.count({ where }),
  ]);
  return { items, total };
}

export async function statusCounts() {
  const rows = await prisma.featureRequest.groupBy({ by: ['status'], where: { status: { not: 'DRAFT' } }, _count: true });
  return Object.fromEntries(STATUSES.map((s) => [s, rows.find((r) => r.status === s)?._count ?? 0])) as Record<
    (typeof STATUSES)[number],
    number
  >;
}

export async function getRequestDetail(id: string) {
  return prisma.featureRequest.findFirst({
    where: { id, status: { not: 'DRAFT' } },
    include: {
      requester: true,
      decidedBy: { select: { name: true } },
      messages: { orderBy: { createdAt: 'asc' } },
      brdDocuments: { orderBy: { version: 'desc' }, take: 1 },
      approvalLogs: { orderBy: { createdAt: 'desc' }, include: { actor: { select: { name: true, email: true } } } },
      jiraSyncTasks: { orderBy: { createdAt: 'desc' } },
    },
  });
}
export type RequestDetail = NonNullable<Awaited<ReturnType<typeof getRequestDetail>>>;
