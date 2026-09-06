import { z } from "zod";
import { parseAnchorDate } from "@/lib/work-plans/apply";

const text = z.string().trim().max(12000);
const label = z.string().trim().max(240);
const date = z.string().refine((value) => parseAnchorDate(value) !== null, "Enter an actual calendar date (YYYY-MM-DD).");
const amount = z.number().finite().min(0).max(1e12).refine((value) => Number(value.toFixed(2)) === value, "Enter an amount in whole cents.").nullable();

export const workProgramSourceRefSchema = z.object({
  sourceId: z.string().uuid(),
  elementKey: z.string().min(1).max(80).nullable(),
  pageFrom: z.number().int().min(1),
  pageTo: z.number().int().min(1),
  tableLabel: label,
}).strict().refine((ref) => ref.pageTo >= ref.pageFrom, "Source pages must be in order.");

export const workProgramActivitySchema = z.object({
  id: z.string().uuid(),
  description: text,
  responsible: label,
  schedule: label,
}).strict();

export const workProgramBudgetLineSchema = z.object({
  id: z.string().uuid(),
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
  code: label,
  title: label.min(1),
  disposition: z.enum(["unresolved", "continuing", "changed", "completed", "new"]),
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

/** Proposed program content only; no adoption, authorization, actual cost or payroll fields. */
export const workProgramDraftSchema = z.object({
  schemaVersion: z.literal(1),
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
  if (new Set(refs).size !== refs.length) context.addIssue({ code: "custom", path: ["elements"], message: "A predecessor work element cannot be carried forward twice." });
});

export type WorkProgramDraft = z.infer<typeof workProgramDraftSchema>;
export type WorkProgramElement = z.infer<typeof workProgramElementSchema>;
export type WorkProgramBudgetLine = z.infer<typeof workProgramBudgetLineSchema>;

/** Missing figures remain unresolved; completed predecessor work is excluded from the proposal. */
export function reconcileWorkProgram(draft: WorkProgramDraft) {
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
