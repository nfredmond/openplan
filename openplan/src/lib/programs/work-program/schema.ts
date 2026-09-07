import { z } from "zod";
import { reconcileStructuredWorkProgram } from "./reconciliation";
import { parseAnchorDate } from "@/lib/work-plans/apply";

export const text = z.string().trim().max(12000);
export const label = z.string().trim().max(240);
export const date = z.string().refine((value) => parseAnchorDate(value) !== null, "Enter an actual calendar date (YYYY-MM-DD).");
export const amount = z.number().finite().min(0).max(1e12).refine((value) => Number(value.toFixed(2)) === value, "Enter an amount in whole cents.").nullable();

export const workProgramSourceRefSchema = z.object({
  sourceId: z.string().uuid(),
  extractionVersionId: z.string().uuid().nullable().optional(),
  purpose: label.optional(),
  elementKey: z.string().min(1).max(80).nullable(),
  pageFrom: z.number().int().min(1),
  pageTo: z.number().int().min(1),
  tableLabel: label,
}).strict().refine((ref) => ref.pageTo >= ref.pageFrom, "Source pages must be in order.");

const refs = z.array(workProgramSourceRefSchema).max(100).optional();

export const workProgramActivitySchema = z.object({
  id: z.string().uuid(),
  description: text,
  sourceRefs: refs,  responsible: label,
  schedule: label,
}).strict();

export const workProgramBudgetLineSchema = z.object({
  id: z.string().uuid(),
  sourceRefs: refs,
  kind: z.enum(["revenue", "cost"]),
  label,
  amount,
  fundingYear: label,
  basis: z.enum(["proposed", "unresolved"]),
  note: text,
}).strict();

export const workProgramElementSchema = z.object({
  id: z.string().uuid(),
  source: workProgramSourceRefSchema.nullable(),
  sourceRefs: refs,
  code: label,
  title: label.min(1),
  disposition: z.enum(["unresolved", "continuing", "changed", "completed", "new", "split", "merged"]),
  decisionNote: text,
  objective: text,
  discussion: text,
  responsible: label,
  schedule: text,
  personMonths: z.number().finite().min(0).max(120000).nullable(),
  budgetTreatment: z.enum(["unresolved", "included", "informational"]),
  budgetTreatmentNote: text,
  tasks: z.array(workProgramActivitySchema).max(200),
  products: z.array(workProgramActivitySchema).max(200),
  budget: z.array(workProgramBudgetLineSchema).max(200),
  projectId: z.string().uuid().nullable(),
}).strict().superRefine((element, context) => {
  if (element.budgetTreatment === "informational" && !element.budgetTreatmentNote) {
    context.addIssue({ code: "custom", path: ["budgetTreatmentNote"], message: "Explain why this work is shown outside the financial totals, including any allocation elsewhere." });
  }
  if (element.disposition !== "unresolved" && !element.decisionNote) {
    context.addIssue({ code: "custom", path: ["decisionNote"], message: "Explain the decision to carry, change, complete or add this work." });
  }
  if (element.source && element.disposition === "new") {
    context.addIssue({ code: "custom", path: ["disposition"], message: "Sourced predecessor work needs a carry-forward decision." });
  }
});

const rowIdentity = { id: z.string().uuid(), sourceRefs: z.array(workProgramSourceRefSchema).max(100) };
const target = { elementId: z.string().uuid(), taskId: z.string().uuid().nullable() };
export const workProgramPreparationSchema = z.object({
  formatVersion: z.literal(2),
  referenceFigures: z.array(z.object({ ...rowIdentity, table: label, row: label, column: label, unit: label,
    value: z.number().finite().nullable(), sourceText: label, state: z.enum(["amount", "blank", "dash", "unavailable"]),
    note: text }).strict().superRefine((row, context) => { if ((row.state === "amount") !== (row.value !== null)) context.addIssue({ code: "custom", message: "Only a printed amount has a numeric reference value; blank, dash and unavailable remain null." }); })).max(10000).optional(),
  extractionSelections: z.array(z.object({ sourceId: z.string().uuid(), versionId: z.string().uuid().nullable() }).strict()).max(300),
  funds: z.array(z.object({ ...rowIdentity, name: label, vintage: label, periodStart: date, periodEnd: date,
    kind: z.enum(["proposed", "match", "carryover", "prior_authority", "prior_balance"]),
    amount, basis: z.enum(["proposed", "reference", "unresolved"]), matchBasis: z.enum(["unresolved", "not_required", "amount", "percent_funded_amount", "percent_total_cost"]).optional(), matchValue: z.number().finite().min(0).max(1e12).nullable().optional(), matchNote: text.optional(), note: text }).strict().superRefine((fund, context) => { if (fund.matchBasis === "amount" && fund.matchValue != null && !amount.safeParse(fund.matchValue).success) context.addIssue({ code: "custom", message: "Required match amount must use whole cents." }); })).max(1000),
  allocations: z.array(z.object({ ...rowIdentity, ...target, fundId: z.string().uuid(), amount,
    matchForFundId: z.string().uuid().nullable(), note: text }).strict()).max(3000),
  costs: z.array(z.object({ ...rowIdentity, ...target, label, category: z.enum(["direct", "consultant", "indirect", "labor_summary"]),
    amount, contractId: z.string().uuid().nullable(), indirectPoolId: z.string().uuid().nullable(), note: text }).strict()).max(3000),
  staffing: z.array(z.object({ ...rowIdentity, ...target, staffId: z.string().uuid().nullable(), role: label,
    periodStart: date, periodEnd: date, quantity: z.number().finite().min(0).max(10000000).nullable(),
    unit: z.enum(["hours", "fte", "person_months"]), capacityHours: z.number().finite().positive().max(10000000).nullable(), capacityBasis: text, hoursPerUnit: z.number().finite().positive().max(10000000).nullable().optional(),
    costTreatment: z.enum(["capacity_only", "calculate"]), rate: amount, rateBasis: z.enum(["labor_cost", "billing", "unresolved"]),
    rateStart: date, rateEnd: date, rateNote: text, includesIndirect: z.boolean() }).strict()).max(3000),
  indirectPools: z.array(z.object({ ...rowIdentity, name: label, amount, note: text }).strict()).max(300),
  mappings: z.array(z.object({ ...rowIdentity, disposition: z.enum(["unresolved", "continuing", "changed", "completed", "new", "split", "merged"]),
    targetIds: z.array(z.string().uuid()).max(300), note: text }).strict()).max(1000),
  sourceSections: z.array(z.object({ ...rowIdentity, title: label, proposedText: text.optional(), retainedText: text.optional(), retainPageImages: z.boolean().optional(), status: z.enum(["unresolved", "incorporated", "reference_only", "not_applicable"]), note: text }).strict()).max(1000),
  amendments: z.array(z.object({ ...rowIdentity, amendmentSourceId: z.string().uuid(), modifiesSourceId: z.string().uuid(),
    status: z.enum(["unresolved", "applies", "separate_cycle", "superseded"]), note: text }).strict()).max(300),
  conflicts: z.array(z.object({ ...rowIdentity, description: text, resolution: text, status: z.enum(["unresolved", "resolved"]) }).strict()).max(1000),
}).strict();
export type WorkProgramStructuredPreparation = z.infer<typeof workProgramPreparationSchema>;

/** Proposed program content only; no adoption, authorization, actual cost or payroll fields. */
export const workProgramDraftSchema = z.object({
  schemaVersion: z.literal(1),
  preparation: workProgramPreparationSchema.optional(),
  documentKind: z.enum(["owp", "upwp", "agency_work_program"]),
  agency: label.min(1),
  responsibleAuthority: label.min(1),
  authorityBasis: text,
  periodStart: date,
  periodEnd: date,
  introduction: text,
  staffing: text,
  financialNotes: text,
  currency: z.string().regex(/^[A-Z]{3}$/),
  priorBalance: amount,
  priorBalanceBasis: text,
  elements: z.array(workProgramElementSchema).max(300),
}).strict().superRefine((draft, context) => {
  if (draft.periodEnd < draft.periodStart) context.addIssue({ code: "custom", path: ["periodEnd"], message: "The program must end on or after its start date." });
  const totalCents = draft.elements.flatMap((element) => element.budget).reduce((total, line) => total + Math.round((line.amount ?? 0) * 100), 0);
  if (!Number.isSafeInteger(totalCents)) context.addIssue({ code: "custom", path: ["elements"], message: "The combined budget exceeds exact cent arithmetic; reduce the proposal before saving." });
  const ids = draft.elements.flatMap((element) => [element.id, ...element.tasks.map((row) => row.id), ...element.products.map((row) => row.id), ...element.budget.map((row) => row.id)]);
  if (new Set(ids).size !== ids.length) context.addIssue({ code: "custom", path: ["elements"], message: "Duplicate work or budget identifiers must be resolved before saving." });
  const refs = draft.elements.filter((element) => element.source?.elementKey).map((element) => `${element.source!.sourceId}:${element.source!.elementKey}`);
  if (!draft.preparation && new Set(refs).size !== refs.length) context.addIssue({ code: "custom", path: ["elements"], message: "A predecessor work element cannot be carried forward twice." });
});

export type WorkProgramDraft = z.infer<typeof workProgramDraftSchema>;
export type WorkProgramElement = z.infer<typeof workProgramElementSchema>;
export type WorkProgramBudgetLine = z.infer<typeof workProgramBudgetLineSchema>;

/** Missing figures remain unresolved; completed predecessor work is excluded from the proposal. */
export function reconcileWorkProgram(draft: WorkProgramDraft) {
  if (draft.preparation) {
    const result = reconcileStructuredWorkProgram(draft);
    return { revenue: result.revenue, cost: result.cost, difference: result.difference,
      unresolvedDecisions: draft.elements.filter((element) => element.disposition === "unresolved").length,
      missingBudgetElements: result.issues.filter((issue) => issue.code === "element_unresolved").length,
      missingAmounts: result.issues.filter((issue) => issue.code === "missing_amount").length,
      unresolvedBudgetTreatments: result.issues.filter((issue) => issue.code === "budget_treatment").length,
      priorBalanceUnresolved: draft.priorBalance === null || !draft.priorBalanceBasis };
  }
  const active = draft.elements.filter((element) => element.disposition !== "completed");
  const elements = active.filter((element) => element.budgetTreatment !== "informational");
  const lines = elements.flatMap((element) => element.budget);
  const sum = (kind: WorkProgramBudgetLine["kind"]) => {
    const selected = lines.filter((line) => line.kind === kind);
    if (elements.some((element) => element.budgetTreatment === "unresolved" || !element.budget.some((line) => line.kind === kind)) || selected.length === 0 || selected.some((line) => line.amount === null || line.basis === "unresolved")) return null;
    const cents = selected.reduce((total, line) => total + Math.round(line.amount! * 100), 0);
    return Number.isSafeInteger(cents) ? cents / 100 : null;
  };
  const revenue = sum("revenue"), cost = sum("cost");
  return {
    revenue, cost,
    difference: revenue === null || cost === null ? null : Math.round((revenue - cost) * 100) / 100,
    unresolvedDecisions: draft.elements.filter((element) => element.disposition === "unresolved").length,
    missingBudgetElements: elements.filter((element) => !element.budget.some((line) => line.kind === "revenue") || !element.budget.some((line) => line.kind === "cost")).length,
    missingAmounts: lines.filter((line) => line.amount === null || line.basis === "unresolved").length,
    unresolvedBudgetTreatments: active.filter((element) => element.budgetTreatment === "unresolved").length,
    priorBalanceUnresolved: draft.priorBalance === null || !draft.priorBalanceBasis,
  };
}
