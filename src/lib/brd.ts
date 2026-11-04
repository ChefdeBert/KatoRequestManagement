import { z } from 'zod';

// ── Reference data ──────────────────────────────────────────────────

export const OPCOS = [
  'LIQUID_INTELLIGENT_TECHNOLOGIES',
  'AFRICA_DATA_CENTRES',
  'LIQUID_C2',
  'SASAI_FINTECH',
  'CASSAVA_AI',
  'CASSAVA_GROUP',
  'OTHER',
] as const;
export type OpCoValue = (typeof OPCOS)[number];

export const OPCO_LABELS: Record<OpCoValue, string> = {
  LIQUID_INTELLIGENT_TECHNOLOGIES: 'Liquid Intelligent Technologies',
  AFRICA_DATA_CENTRES: 'Africa Data Centres',
  LIQUID_C2: 'Liquid C2',
  SASAI_FINTECH: 'Sasai Fintech',
  CASSAVA_AI: 'Cassava AI',
  CASSAVA_GROUP: 'Cassava Technologies (Group)',
  OTHER: 'Other',
};

export const LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type LevelValue = (typeof LEVELS)[number];

export const REFERENCE_KINDS = ['JIRA', 'SERVICENOW', 'SYSTEM', 'DOCUMENT', 'OTHER'] as const;

export const CONFIDENCE = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type ConfidenceValue = (typeof CONFIDENCE)[number];

/** The three financial lenses every request must be quantified against (annual, USD). */
export const FINANCIAL_LENSES = [
  { key: 'revenueGrowthUsd', label: 'Revenue growth', short: 'Revenue' },
  { key: 'ebitdaImpactUsd', label: 'EBITDA impact', short: 'EBITDA' },
  { key: 'cashFlowImpactUsd', label: 'Cash flow impact', short: 'Cash flow' },
] as const;

// ── Strict schema: what a submittable BRD must satisfy ──────────────

const kpiSchema = z.object({
  metric: z.string().trim().min(2),
  baseline: z.string().trim().optional(),
  target: z.string().trim().min(1),
});

const referenceSchema = z.object({
  kind: z.enum(REFERENCE_KINDS),
  value: z.string().trim().min(1),
  note: z.string().optional(),
});

const financialImpactSchema = z
  .object({
    revenueGrowthUsd: z.number().finite(),
    ebitdaImpactUsd: z.number().finite(),
    cashFlowImpactUsd: z.number().finite(),
    oneOffCashBenefitUsd: z.number().finite().optional(),
    implementationBudgetUsd: z.number().finite().nonnegative().optional(),
    horizonYears: z.number().int().min(1).max(10).default(3),
    basis: z.string().trim().min(30, 'Explain how the figures were calculated'),
    confidence: z.enum(CONFIDENCE),
    sourceCurrency: z.string().trim().max(3).optional(),
    fxNote: z.string().optional(),
  })
  .refine((f) => f.revenueGrowthUsd !== 0 || f.ebitdaImpactUsd !== 0 || f.cashFlowImpactUsd !== 0, {
    message: 'At least one of revenue, EBITDA or cash flow impact must be non-zero',
  });

export const brdSchema = z.object({
  title: z.string().trim().min(5).max(120),
  problemStatement: z.string().trim().min(20),
  summary: z.string().trim().min(20),
  strategicGoals: z.array(z.string().trim().min(3)).min(1),
  sponsor: z.object({
    name: z.string().trim().min(2),
    title: z.string().trim().optional(),
    email: z.string().trim().email().optional(),
  }),
  department: z.string().trim().min(2),
  opco: z.enum(OPCOS),
  businessUnit: z.string().trim().min(2),
  impact: z.enum(LEVELS),
  impactJustification: z.string().trim().min(10),
  urgency: z.enum(LEVELS),
  urgencyJustification: z.string().trim().min(10),
  targetDate: z.string().optional(),
  successCriteria: z.array(z.string().trim().min(3)).min(1),
  kpis: z.array(kpiSchema).min(1),
  financialImpact: financialImpactSchema,
  references: z.array(referenceSchema).default([]),
  stakeholders: z.array(z.string()).default([]),
  assumptions: z.array(z.string()).default([]),
  constraints: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  openQuestions: z.array(z.string()).default([]),
});
export type BRD = z.infer<typeof brdSchema>;

// ── Loose patch schema: the LLM tool input (every field optional) ───
// Kept deliberately permissive so partial captures never fail validation.

export const brdPatchSchema = z.object({
  title: z.string().optional().describe('Concise, outcome-oriented request title (max ~10 words).'),
  problemStatement: z
    .string()
    .optional()
    .describe('What is broken or missing today, who is affected, and the current workaround. Third person, BRD tone.'),
  summary: z.string().optional().describe('Detailed summary of the requested capability and desired future state.'),
  strategicGoals: z.array(z.string()).optional().describe('FULL list of strategic goals this request supports.'),
  sponsor: z
    .object({ name: z.string().optional(), title: z.string().optional(), email: z.string().optional() })
    .optional()
    .describe('Accountable business sponsor (an executive or senior manager).'),
  department: z.string().optional(),
  opco: z.enum(OPCOS).optional().describe('Operating company that owns the request.'),
  businessUnit: z.string().optional(),
  impact: z.enum(LEVELS).optional(),
  impactJustification: z.string().optional(),
  urgency: z.enum(LEVELS).optional(),
  urgencyJustification: z.string().optional(),
  targetDate: z.string().optional().describe('ISO date (YYYY-MM-DD) or quarter, only if the user stated one.'),
  successCriteria: z.array(z.string()).optional().describe('FULL list of testable acceptance/success criteria.'),
  kpis: z
    .array(z.object({ metric: z.string(), baseline: z.string().optional(), target: z.string().optional() }))
    .optional()
    .describe('FULL list of KPIs with baseline and target where known.'),
  financialImpact: z
    .object({
      revenueGrowthUsd: z.number().optional().describe('Incremental annual revenue in USD attributable to this request (0 if none).'),
      ebitdaImpactUsd: z
        .number()
        .optional()
        .describe('Annual EBITDA uplift in USD: incremental revenue x contribution margin + opex savings + avoided penalties. Exclude capex and D&A.'),
      cashFlowImpactUsd: z
        .number()
        .optional()
        .describe('Annual operating cash flow improvement in USD: EBITDA effect plus working-capital gains (e.g. lower DSO) and avoided capex.'),
      oneOffCashBenefitUsd: z.number().optional().describe('One-off cash release in USD, e.g. working capital freed once, if stated.'),
      implementationBudgetUsd: z.number().optional().describe('Budget the sponsor expects to spend, in USD, only if stated.'),
      horizonYears: z.number().optional().describe('Benefit horizon in years (default 3).'),
      basis: z.string().optional().describe('How the figures were derived: drivers, volumes, rates, assumptions and FX rate used.'),
      confidence: z.enum(CONFIDENCE).optional().describe('Requester confidence in the estimate.'),
      sourceCurrency: z.string().optional().describe('ISO code of the currency the requester gave figures in, if not USD (e.g. ZAR, NGN, KES).'),
      fxNote: z.string().optional().describe('FX rate and date used to convert to USD.'),
    })
    .optional()
    .describe('Quantified annual financial impact in USD. Mandatory for submission.'),
  references: z
    .array(z.object({ kind: z.enum(REFERENCE_KINDS), value: z.string(), note: z.string().optional() }))
    .optional()
    .describe('FULL list of related Jira keys, ServiceNow tickets, systems or documents.'),
  stakeholders: z.array(z.string()).optional(),
  assumptions: z.array(z.string()).optional(),
  constraints: z.array(z.string()).optional(),
  risks: z.array(z.string()).optional(),
  openQuestions: z.array(z.string()).optional().describe('FULL list of unresolved questions to carry into IT review.'),
});
export type BRDPatch = z.infer<typeof brdPatchSchema>;
/** A BRD under construction — every field may be missing. */
export type BRDDraft = BRDPatch;

export function asDraft(json: unknown): BRDDraft {
  const parsed = brdPatchSchema.safeParse(json ?? {});
  return parsed.success ? parsed.data : {};
}

/** Shallow merge; `sponsor` is merged one level deep; arrays are replaced wholesale. */
export function mergeBrd(current: BRDDraft, patch: BRDPatch | Record<string, unknown>): BRDDraft {
  const next: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (value === undefined || value === null) continue;
    if ((key === 'sponsor' || key === 'financialImpact') && typeof value === 'object') {
      next[key] = { ...(((current as Record<string, unknown>)[key] as object | undefined) ?? {}), ...(value as object) };
    } else {
      next[key] = value;
    }
  }
  return next as BRDDraft;
}

// ── Completeness ────────────────────────────────────────────────────

const filled = (v: unknown) => typeof v === 'string' && v.trim().length > 0;
const filledList = (v: unknown) => Array.isArray(v) && v.length > 0;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function financialImpactComplete(d: BRDDraft) {
  const f = d.financialImpact;
  if (!f) return false;
  const values = [f.revenueGrowthUsd, f.ebitdaImpactUsd, f.cashFlowImpactUsd];
  return values.every(num) && values.some((v) => v !== 0) && filled(f.basis) && (f.basis?.trim().length ?? 0) >= 30 && !!f.confidence;
}

export const REQUIRED_FIELDS: { key: string; label: string; ok: (d: BRDDraft) => boolean }[] = [
  { key: 'title', label: 'Request title', ok: (d) => filled(d.title) },
  { key: 'problemStatement', label: 'Problem statement', ok: (d) => filled(d.problemStatement) },
  { key: 'summary', label: 'Request summary', ok: (d) => filled(d.summary) },
  { key: 'strategicGoals', label: 'Strategic goals', ok: (d) => filledList(d.strategicGoals) },
  { key: 'sponsor', label: 'Business sponsor', ok: (d) => filled(d.sponsor?.name) },
  { key: 'department', label: 'Department', ok: (d) => filled(d.department) },
  { key: 'opco', label: 'Operating company', ok: (d) => !!d.opco },
  { key: 'businessUnit', label: 'Business unit', ok: (d) => filled(d.businessUnit) },
  { key: 'impact', label: 'Business impact & justification', ok: (d) => !!d.impact && filled(d.impactJustification) },
  { key: 'urgency', label: 'Urgency & justification', ok: (d) => !!d.urgency && filled(d.urgencyJustification) },
  { key: 'successCriteria', label: 'Success criteria', ok: (d) => filledList(d.successCriteria) },
  { key: 'kpis', label: 'Target KPIs', ok: (d) => Array.isArray(d.kpis) && d.kpis.some((k) => filled(k?.metric) && filled(k?.target)) },
  { key: 'financialImpact', label: 'Financial impact (USD: revenue, EBITDA, cash flow)', ok: financialImpactComplete },
];

export function assessCompleteness(draft: BRDDraft) {
  const missing = REQUIRED_FIELDS.filter((f) => !f.ok(draft));
  const percent = Math.round(((REQUIRED_FIELDS.length - missing.length) / REQUIRED_FIELDS.length) * 100);
  return {
    percent,
    missing: missing.map((m) => m.label),
    missingKeys: missing.map((m) => m.key),
    ready: missing.length === 0,
  };
}

export function validateForSubmission(draft: BRDDraft) {
  const result = brdSchema.safeParse(draft);
  if (result.success) return { ok: true as const, brd: result.data };
  return {
    ok: false as const,
    issues: result.error.issues.map((i) => `${i.path.join('.') || 'brd'}: ${i.message}`),
  };
}

/** Columns denormalised onto FeatureRequest for filtering. */
export function denormalise(draft: BRDDraft) {
  return {
    title: draft.title?.slice(0, 200) ?? null,
    opco: draft.opco ?? null,
    department: draft.department ?? null,
    impact: draft.impact ?? null,
    urgency: draft.urgency ?? null,
  };
}

/** Requester-stated USD figures, denormalised at submission. */
export function statedFinancials(brd: BRD) {
  return {
    statedRevenueUsd: brd.financialImpact.revenueGrowthUsd,
    statedEbitdaUsd: brd.financialImpact.ebitdaImpactUsd,
    statedCashFlowUsd: brd.financialImpact.cashFlowImpactUsd,
  };
}

const usdFull = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const usdCompact = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });

export function formatUsd(v: number | null | undefined, opts: { compact?: boolean } = {}) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return (opts.compact ? usdCompact : usdFull).format(v);
}

export const FIELD_LABELS: Record<string, string> = {
  ...Object.fromEntries(REQUIRED_FIELDS.map((f) => [f.key, f.label])),
  impactJustification: 'Impact justification',
  urgencyJustification: 'Urgency justification',
  targetDate: 'Target date',
  references: 'References',
  stakeholders: 'Stakeholders',
  assumptions: 'Assumptions',
  constraints: 'Constraints',
  risks: 'Risks',
  openQuestions: 'Open questions',
  financialImpact: 'Financial impact',
};

// ── Rendering ───────────────────────────────────────────────────────

export function formatRef(n: number) {
  return `KATO-${String(n).padStart(5, '0')}`;
}

export function brdToMarkdown(brd: BRD, meta: { reference: string; requester: string; version: number }) {
  const list = (items: string[]) => (items.length ? items.map((i) => `- ${i}`).join('\n') : '_None recorded_');
  return [
    `# ${brd.title}`,
    `**Reference:** ${meta.reference} · **Version:** ${meta.version} · **Requester:** ${meta.requester}`,
    `**OpCo:** ${OPCO_LABELS[brd.opco]} · **Business unit:** ${brd.businessUnit} · **Department:** ${brd.department}`,
    `**Business sponsor:** ${brd.sponsor.name}${brd.sponsor.title ? `, ${brd.sponsor.title}` : ''}`,
    `## 1. Problem statement\n${brd.problemStatement}`,
    `## 2. Request summary\n${brd.summary}`,
    `## 3. Strategic goals\n${list(brd.strategicGoals)}`,
    `## 4. Business impact & urgency\n- **Impact:** ${brd.impact} — ${brd.impactJustification}\n- **Urgency:** ${brd.urgency} — ${brd.urgencyJustification}${brd.targetDate ? `\n- **Target date:** ${brd.targetDate}` : ''}`,
    `## 5. Success criteria\n${list(brd.successCriteria)}`,
    `## 6. Financial impact (USD, annual)\n| Lens | Annual impact |\n|---|---|\n${FINANCIAL_LENSES.map((l) => `| ${l.label} | ${formatUsd(brd.financialImpact[l.key])} |`).join('\n')}\n\n- **Horizon:** ${brd.financialImpact.horizonYears} years · **Confidence:** ${brd.financialImpact.confidence}${brd.financialImpact.oneOffCashBenefitUsd ? `\n- **One-off cash benefit:** ${formatUsd(brd.financialImpact.oneOffCashBenefitUsd)}` : ''}${brd.financialImpact.implementationBudgetUsd ? `\n- **Expected budget:** ${formatUsd(brd.financialImpact.implementationBudgetUsd)}` : ''}\n- **Basis:** ${brd.financialImpact.basis}${brd.financialImpact.fxNote ? `\n- **FX:** ${brd.financialImpact.fxNote}` : ''}`,
    `## 7. Target KPIs\n| Metric | Baseline | Target |\n|---|---|---|\n${brd.kpis.map((k) => `| ${k.metric} | ${k.baseline ?? '—'} | ${k.target} |`).join('\n')}`,
    `## 8. References\n${list(brd.references.map((r) => `${r.kind}: ${r.value}${r.note ? ` (${r.note})` : ''}`))}`,
    `## 9. Stakeholders\n${list(brd.stakeholders)}`,
    `## 10. Assumptions\n${list(brd.assumptions)}`,
    `## 11. Constraints\n${list(brd.constraints)}`,
    `## 12. Risks\n${list(brd.risks)}`,
    `## 13. Open questions\n${list(brd.openQuestions)}`,
  ].join('\n\n');
}
