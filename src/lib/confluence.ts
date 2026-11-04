/**
 * Confluence Cloud — system of record for BRDs.
 *
 * Every submitted request gets one Confluence page (title "KATO-00042 · <title>") in
 * CONFLUENCE_SPACE_KEY. The page is re-rendered from Kato's current state whenever something
 * changes (new BRD version, assessment, decision, Jira key), so Confluence page history mirrors
 * the BRD's lifecycle. A Page Properties macro on each page makes the whole portfolio reportable
 * with a Page Properties Report (filter by label "kato-brd").
 */
import type { Prisma } from '@prisma/client';
import { UnrecoverableError } from 'bullmq';
import type { StoredAutonomy, StoredFinancial } from './assessment';
import { atlassianFetch, basicAuth } from './atlassian';
import { FINANCIAL_LENSES, OPCO_LABELS, brdSchema, formatRef, formatUsd, type BRD } from './brd';
import { notifyStaff } from './notify';
import { prisma } from './prisma';
import { ROUTE_DESCRIPTIONS, ROUTE_LABELS } from './routes';
import { formatDateTime, publicUrl } from './utils';

// ── Config & HTTP ───────────────────────────────────────────────────

export const confluenceEnabled = () => process.env.CONFLUENCE_ENABLED !== 'false';

function cfg() {
  const baseUrl = (process.env.CONFLUENCE_BASE_URL || (process.env.JIRA_BASE_URL ? `${process.env.JIRA_BASE_URL.replace(/\/$/, '')}/wiki` : '')).replace(/\/$/, '');
  const email = process.env.CONFLUENCE_EMAIL || process.env.JIRA_EMAIL;
  const token = process.env.CONFLUENCE_API_TOKEN || process.env.JIRA_API_TOKEN;
  const spaceKey = process.env.CONFLUENCE_SPACE_KEY;
  if (!baseUrl || !email || !token || !spaceKey) {
    throw new UnrecoverableError('Confluence is not configured (CONFLUENCE_BASE_URL or JIRA_BASE_URL, credentials, CONFLUENCE_SPACE_KEY)');
  }
  return { baseUrl, auth: basicAuth(email, token), spaceKey, parentPageId: process.env.CONFLUENCE_PARENT_PAGE_ID || undefined };
}

function conf<T>(path: string, init: RequestInit & { allow404?: boolean } = {}) {
  const c = cfg();
  return atlassianFetch<T>('Confluence', c.baseUrl, c.auth, path, init);
}

let spaceIdCache: string | null = null;
async function spaceId() {
  if (spaceIdCache) return spaceIdCache;
  const { spaceKey } = cfg();
  const res = await conf<{ results: { id: string; key: string }[] }>(`/api/v2/spaces?keys=${encodeURIComponent(spaceKey)}&limit=1`);
  const id = res?.results?.[0]?.id;
  if (!id) throw new UnrecoverableError(`Confluence space "${spaceKey}" not found or not visible to the service account`);
  return (spaceIdCache = id);
}

type Page = { id: string; title: string; version: { number: number }; _links?: { webui?: string } };

// ── Storage-format rendering ────────────────────────────────────────

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const para = (t: string) => `<p>${esc(t)}</p>`;
const h = (n: number, t: string) => `<h${n}>${esc(t)}</h${n}>`;
const ul = (items: string[]) => (items.length ? `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : '<p><em>None recorded</em></p>');
const a = (href: string, text: string) => `<a href="${esc(href)}">${esc(text)}</a>`;
const row = (cells: string[], header = false) => `<tr>${cells.map((c) => (header ? `<th>${c}</th>` : `<td>${c}</td>`)).join('')}</tr>`;
const table = (rows: string[]) => `<table><tbody>${rows.join('')}</tbody></table>`;
const panel = (kind: 'info' | 'note' | 'tip' | 'warning', body: string) =>
  `<ac:structured-macro ac:name="${kind}"><ac:rich-text-body>${body}</ac:rich-text-body></ac:structured-macro>`;
const status = (title: string, colour: 'Grey' | 'Blue' | 'Yellow' | 'Green' | 'Red') =>
  `<ac:structured-macro ac:name="status"><ac:parameter ac:name="colour">${colour}</ac:parameter><ac:parameter ac:name="title">${esc(title)}</ac:parameter></ac:structured-macro>`;

const STATUS_STYLE = {
  DRAFT: ['Draft', 'Grey'],
  SUBMITTED: ['Submitted', 'Blue'],
  UNDER_IT_REVIEW: ['Under IT review', 'Yellow'],
  APPROVED: ['Approved', 'Green'],
  REJECTED: ['Rejected', 'Red'],
} as const;

type Loaded = NonNullable<Awaited<ReturnType<typeof load>>>;

function load(requestId: string) {
  return prisma.featureRequest.findUnique({
    where: { id: requestId },
    include: {
      requester: { select: { name: true, email: true } },
      decidedBy: { select: { name: true } },
      brdDocuments: { orderBy: { version: 'desc' }, take: 1 },
      assessments: { orderBy: { version: 'desc' }, take: 1 },
      approvalLogs: { where: { action: 'APPROVED' }, orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });
}

export function renderPage(r: Loaded, brd: BRD) {
  const reference = formatRef(r.number);
  const doc = r.brdDocuments[0]!;
  const asmt = r.assessments[0];
  const fin = asmt?.financial as unknown as StoredFinancial | undefined;
  const aut = asmt?.autonomy as unknown as StoredAutonomy | undefined;
  const approval = r.approvalLogs[0]?.metadata as { route?: string; routeOverrideReason?: string } | undefined;
  const [statusLabel, statusColour] = STATUS_STYLE[r.status];
  const kato = publicUrl(`/admin/dashboard?selected=${r.id}`);
  const assessedFor = (key: (typeof FINANCIAL_LENSES)[number]['key']) =>
    asmt ? formatUsd(Number(key === 'revenueGrowthUsd' ? asmt.assessedRevenueUsd : key === 'ebitdaImpactUsd' ? asmt.assessedEbitdaUsd : asmt.assessedCashFlowUsd)) : 'Pending';

  const banner = panel(
    'info',
    para(
      `This BRD is maintained by Kato (${reference}). Do not edit this page directly — it is regenerated from Kato on every change. ` +
        `Source: BRD version ${doc.version}, sha256 ${doc.contentHash.slice(0, 12)}…, last published ${formatDateTime(new Date())}.`,
    ) + `<p>${a(kato, 'Open in Kato')}</p>`,
  );

  const decision =
    r.status === 'REJECTED'
      ? panel('warning', para(`Rejected by ${r.decidedBy?.name ?? 'IT'} on ${formatDateTime(r.decidedAt)}: ${r.rejectionReason ?? ''}`))
      : r.status === 'APPROVED'
        ? panel(
            'tip',
            para(
              `Approved by ${r.decidedBy?.name ?? 'IT'} on ${formatDateTime(r.decidedAt)} for the ${r.approvedRoute ? ROUTE_LABELS[r.approvedRoute] : '—'} route.` +
                (approval?.routeOverrideReason ? ` Route override reason: ${approval.routeOverrideReason}` : ''),
            ),
          )
        : '';

  const properties = `<ac:structured-macro ac:name="details"><ac:rich-text-body>${table([
    row(['<strong>Reference</strong>', esc(reference)]),
    row(['<strong>Status</strong>', status(statusLabel, statusColour)]),
    row(['<strong>Operating company</strong>', esc(OPCO_LABELS[brd.opco])]),
    row(['<strong>Business unit</strong>', esc(brd.businessUnit)]),
    row(['<strong>Department</strong>', esc(brd.department)]),
    row(['<strong>Business sponsor</strong>', esc([brd.sponsor.name, brd.sponsor.title].filter(Boolean).join(', '))]),
    row(['<strong>Requester</strong>', esc(`${r.requester.name} (${r.requester.email})`)]),
    row(['<strong>Impact / urgency</strong>', esc(`${brd.impact} / ${brd.urgency}`)]),
    row(['<strong>EBITDA impact (USD/yr)</strong>', esc(asmt ? assessedFor('ebitdaImpactUsd') : formatUsd(brd.financialImpact.ebitdaImpactUsd))]),
    row(['<strong>Revenue growth (USD/yr)</strong>', esc(asmt ? assessedFor('revenueGrowthUsd') : formatUsd(brd.financialImpact.revenueGrowthUsd))]),
    row(['<strong>Cash flow impact (USD/yr)</strong>', esc(asmt ? assessedFor('cashFlowImpactUsd') : formatUsd(brd.financialImpact.cashFlowImpactUsd))]),
    row(['<strong>Value score</strong>', esc(asmt ? `${asmt.valueScore}/100` : 'Pending')]),
    row(['<strong>Recommended route</strong>', esc(asmt ? `${ROUTE_LABELS[asmt.recommendedRoute]} (${asmt.autonomyScore}/100)` : 'Pending')]),
    row(['<strong>Approved route</strong>', esc(r.approvedRoute ? ROUTE_LABELS[r.approvedRoute] : '—')]),
    row(['<strong>Jira</strong>', r.jiraIssueKey && r.jiraIssueUrl ? a(r.jiraIssueUrl, r.jiraIssueKey) : '—']),
    row(['<strong>Submitted</strong>', esc(formatDateTime(r.submittedAt))]),
  ])}</ac:rich-text-body></ac:structured-macro>`;

  const f = brd.financialImpact;
  const financial = [
    h(2, '1. Financial impact (annual, USD)'),
    table([
      row(['Lens', 'Stated by requester', 'Kato assessment'], true),
      ...FINANCIAL_LENSES.map((l) => row([esc(l.label), esc(formatUsd(f[l.key])), esc(assessedFor(l.key))])),
    ]),
    para(`Horizon ${f.horizonYears} years · requester confidence ${f.confidence}` + (f.implementationBudgetUsd ? ` · expected budget ${formatUsd(f.implementationBudgetUsd)}` : '') + (f.oneOffCashBenefitUsd ? ` · one-off cash benefit ${formatUsd(f.oneOffCashBenefitUsd)}` : '')),
    `<p><strong>Basis:</strong> ${esc(f.basis)}</p>`,
    f.fxNote ? `<p><strong>FX:</strong> ${esc(f.fxNote)}${f.sourceCurrency ? ` (source currency ${esc(f.sourceCurrency)})` : ''}</p>` : '',
    ...(fin
      ? [
          h(3, 'Value assessment'),
          para(
            `Value score ${asmt!.valueScore}/100 · credibility ${fin.credibility.toLowerCase()} · confidence ${fin.confidence.toLowerCase()} · strategic alignment ${fin.strategicAlignment.score}/5` +
              (fin.paybackMonths != null ? ` · payback ≈ ${fin.paybackMonths} months` : ''),
          ),
          para(fin.commentary),
          `<p><strong>Value drivers:</strong> ${esc(fin.valueDrivers.map((d) => d.replace(/_/g, ' ').toLowerCase()).join(', '))}</p>`,
          '<p><strong>Key assumptions</strong></p>',
          ul(fin.keyAssumptions),
          ...(fin.questionsForSponsor.length ? ['<p><strong>Questions for the sponsor</strong></p>', ul(fin.questionsForSponsor)] : []),
        ]
      : [panel('note', para('Value assessment pending.'))]),
  ];

  const route = aut
    ? [
        h(2, '2. Development route assessment'),
        para(`Recommended: ${ROUTE_LABELS[asmt!.recommendedRoute]} — ${ROUTE_DESCRIPTIONS[asmt!.recommendedRoute]} Autonomy score ${asmt!.autonomyScore}/100.`),
        table([
          row(['Criterion', 'Score (1–5)', 'Evidence'], true),
          ...(
            [
              ['Requirement clarity', aut.requirementClarity],
              ['Testability', aut.testability],
              ['Scope containment', aut.scopeContainment],
              ['Integration simplicity', aut.integrationSimplicity],
              ['Reversibility', aut.reversibility],
              ['Pattern familiarity', aut.patternFamiliarity],
            ] as const
          ).map(([label, c]) => row([esc(label), esc(c.score), esc(c.reason)])),
        ]),
        '<p><strong>Risk flags</strong></p>',
        ul(aut.blockers.length ? aut.blockers : ['None raised']),
        '<p><strong>Decision rules applied</strong></p>',
        ul(aut.rules),
        '<p><strong>Required guardrails</strong></p>',
        ul(aut.guardrails),
        para(aut.rationale),
      ]
    : [h(2, '2. Development route assessment'), panel('note', para('Route assessment pending.'))];

  const body = [
    h(2, '3. Problem statement'),
    para(brd.problemStatement),
    h(2, '4. Request summary'),
    para(brd.summary),
    h(2, '5. Strategic goals'),
    ul(brd.strategicGoals),
    h(2, '6. Business impact & urgency'),
    `<p><strong>Impact (${esc(brd.impact)}):</strong> ${esc(brd.impactJustification)}</p>`,
    `<p><strong>Urgency (${esc(brd.urgency)}):</strong> ${esc(brd.urgencyJustification)}</p>`,
    brd.targetDate ? `<p><strong>Target date:</strong> ${esc(brd.targetDate)}</p>` : '',
    h(2, '7. Success criteria'),
    ul(brd.successCriteria),
    h(2, '8. Target KPIs'),
    table([row(['KPI', 'Baseline', 'Target'], true), ...brd.kpis.map((k) => row([esc(k.metric), esc(k.baseline ?? '—'), esc(k.target)]))]),
    h(2, '9. Related tickets & systems'),
    ul(brd.references.map((x) => `${x.kind}: ${x.value}${x.note ? ` (${x.note})` : ''}`)),
    h(2, '10. Stakeholders, assumptions, constraints & risks'),
    '<p><strong>Stakeholders</strong></p>',
    ul(brd.stakeholders),
    '<p><strong>Assumptions</strong></p>',
    ul(brd.assumptions),
    '<p><strong>Constraints</strong></p>',
    ul(brd.constraints),
    '<p><strong>Risks</strong></p>',
    ul(brd.risks),
    h(2, '11. Open questions'),
    ul(brd.openQuestions),
  ];

  return [banner, decision, properties, ...financial, ...route, ...body].join('\n');
}

// ── Publish (called by the worker) ──────────────────────────────────

export async function syncConfluencePage(requestId: string) {
  if (!confluenceEnabled()) return null;
  const r = await load(requestId);
  if (!r) throw new UnrecoverableError(`Request ${requestId} not found`);
  const doc = r.brdDocuments[0];
  if (!doc) return null; // drafts are not published

  const c = cfg();
  const brd = brdSchema.parse(doc.content);
  const reference = formatRef(r.number);
  const title = `${reference} · ${brd.title}`.slice(0, 255);
  const value = renderPage(r, brd);
  const sid = await spaceId();

  await prisma.featureRequest.update({ where: { id: requestId }, data: { confluenceSyncState: 'PENDING' } });

  // Find the page: stored id first, then by title (covers a create that timed out after succeeding)
  let page: Page | null = r.confluencePageId ? await conf<Page>(`/api/v2/pages/${r.confluencePageId}`, { allow404: true }) : null;
  if (!page) {
    const found = await conf<{ results: Page[] }>(`/api/v2/pages?space-id=${sid}&title=${encodeURIComponent(title)}&limit=1`);
    page = found?.results?.[0] ?? null;
  }

  let created = false;
  if (page) {
    page = await conf<Page>(`/api/v2/pages/${page.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        id: page.id,
        status: 'current',
        title,
        body: { representation: 'storage', value },
        version: { number: page.version.number + 1, message: `Kato sync · ${r.status.toLowerCase()} · BRD v${doc.version}` },
      }),
    });
  } else {
    page = await conf<Page>('/api/v2/pages', {
      method: 'POST',
      body: JSON.stringify({ spaceId: sid, status: 'current', title, ...(c.parentPageId ? { parentId: c.parentPageId } : {}), body: { representation: 'storage', value } }),
    });
    created = true;
  }
  if (!page) throw new Error('Confluence returned no page');

  if (created) {
    const labels = ['kato-brd', `kato-${r.number}`, `opco-${brd.opco.toLowerCase().replace(/_/g, '-')}`].map((name) => ({ prefix: 'global', name }));
    await conf(`/rest/api/content/${page.id}/label`, { method: 'POST', body: JSON.stringify(labels) }).catch((e) => console.warn('[confluence] labels failed (non-fatal)', e));
  }

  const url = page._links?.webui ? `${c.baseUrl}${page._links.webui}` : `${c.baseUrl}/pages/viewpage.action?pageId=${page.id}`;
  await prisma.$transaction([
    prisma.featureRequest.update({
      where: { id: requestId },
      data: { confluencePageId: page.id, confluencePageUrl: url, confluenceSyncState: 'SYNCED', confluenceSyncedAt: new Date(), confluenceLastError: null },
    }),
    prisma.approvalLog.create({
      data: {
        requestId,
        action: 'CONFLUENCE_PUBLISHED',
        comment: `${created ? 'Created' : 'Updated'} Confluence page (version ${page.version?.number ?? 1}) from BRD v${doc.version}`,
        metadata: { pageId: page.id, pageVersion: page.version?.number ?? 1, brdVersion: doc.version, url } as Prisma.InputJsonValue,
      },
    }),
  ]);
  return { pageId: page.id, url };
}

export async function recordConfluenceFailure(requestId: string, error: Error, attemptsMade: number, final: boolean) {
  const r = await prisma.featureRequest.update({
    where: { id: requestId },
    data: { confluenceSyncState: 'FAILED', confluenceLastError: error.message.slice(0, 4000) },
  });
  if (!final) return;
  await prisma.approvalLog.create({
    data: {
      requestId,
      action: 'CONFLUENCE_SYNC_FAILED',
      comment: `Confluence publish moved to dead-letter queue after ${attemptsMade} attempt(s)`,
      metadata: { error: error.message.slice(0, 2000) },
    },
  });
  await notifyStaff({
    requestId,
    type: 'CONFLUENCE_SYNC_FAILED',
    title: `Confluence publish failed for ${formatRef(r.number)}`,
    body: `Kato could not store the BRD in Confluence: ${error.message.slice(0, 400)}\nRetry from the admin dashboard once the cause is fixed.`,
    link: `/admin/dashboard?selected=${requestId}`,
  });
}
