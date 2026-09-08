import { z } from "zod";
import { date, workProgramDraftSchema, type WorkProgramDraft } from "./schema";
import { reconcileStructuredWorkProgram } from "./reconciliation";

const uuid = z.string().uuid();
const optionalId = uuid.nullable().default(null);
const note = z.string().trim().max(12000);
export const decimal = z.string().regex(/^\d{1,12}(\.\d{1,2})?$/, "Use a nonnegative number with at most two decimal places");
export const allocationSchema = z.object({ elementId: uuid, taskId: optionalId, deliverableId: optionalId, share: z.number().int().positive().max(10000) }).strict();
export const actualCommandSchema = z.object({
 requestId: uuid, entryId: uuid, expectedVersion: z.number().int().nonnegative(), revisionId: uuid,
 kind: z.enum(["labor", "expense", "opening", "commitment", "billed", "payment"]), status: z.enum(["draft", "approved", "excluded"]),
 entryDate: date, sourceKey: note.min(1).max(500), sourceReference: note.min(1), description: note.min(1),
 staffId: optionalId, projectId: optionalId, contractId: optionalId, timeEntryId: optionalId, spendEntryId: optionalId,
 hours: decimal.nullable(), amount: decimal.nullable(), basis: z.enum(["recorded", "cost_rate", "unvalued"]), rateId: optionalId,
 billable: z.boolean().default(false), allocations: z.array(allocationSchema).max(100),
 openingStart: date.nullable().default(null), openingEnd: date.nullable().default(null), correctionNote: note.default(""), openingBasis: note.default(""), reconciliationNote: note.default(""),
 linkedRecordReference: note.default(""),
}).strict();
export type ActualCommand = z.infer<typeof actualCommandSchema>;
export const progressSchema = z.object({ elementId: uuid, taskId: optionalId, asOf: date, completed: note, outstanding: note, issues: note, remainingHours: decimal.nullable(), remainingCost: decimal.nullable(), estimateBasis: note }).strict();
export type PeriodProgress = z.infer<typeof progressSchema>;
const commandBase = { requestId: uuid, periodId: uuid, expectedVersion: z.number().int().nonnegative() };
export const managementCommandSchema = z.discriminatedUnion("kind", [
 z.object({ kind: z.literal("period"), ...commandBase, name: note.min(1).max(240), startsOn: date, endsOn: date, baselineId: optionalId, sourceCutoff: z.string().datetime({ offset: true }), progress: z.array(progressSchema).max(3000), note }).strict(),
 ...(["review", "return", "issue", "correct"] as const).map(kind => z.object({ kind: z.literal(kind), ...commandBase, note: note.min(1) }).strict()),
 z.object({ kind: z.literal("rate"), requestId: uuid, rateId: uuid, staffId: uuid, startsOn: date, endsOn: date, hourlyCost: decimal, sourceReference: note.min(1) }).strict(),
]);
export type ManagementCommand = z.infer<typeof managementCommandSchema>;
export type ActualAllocation = { element_id: string; task_id: string | null; deliverable_id: string | null; amount: string | null; hours: string | null; share: number };
export type ActualVersion = { id: string; entry_id: string; version: number; revision_id: string; source_key: string; entry_date: string; kind: ActualCommand["kind"]; staff_id: string | null; staffName?: string | null; costRate?: { id: string; hourly_cost: string; starts_on: string; ends_on: string; source_reference: string } | null; amount: string | null; hours: string | null; status: ActualCommand["status"]; valuation_basis: string; detail: ActualCommand; allocations: ActualAllocation[]; created_at: string };
export type ReportingPeriod = { id: string; name: string; starts_on: string; ends_on: string; baseline_id: string | null; source_cutoff: string; version: number; state: "draft" | "review" | "returned" | "issued" | "correcting"; progress: PeriodProgress[]; note: string; review_snapshot: ReportSnapshot | null };
export type ReportSnapshot = { schemaVersion: 1; workingPreview?: true; period: ReportingPeriod; baseline: { id: string; revision: number; content_sha256: string; content_json: WorkProgramDraft; source_ids: string[] }; actuals: ActualVersion[]; valuationHistory: ActualVersion[]; reviewNote: string; issueNote?: string };
export type PeriodReport = { id: string; period_id: string; version: number; snapshot: ReportSnapshot; snapshot_hash: string; issued_at: string; corrects_report_id: string | null };

/** Fixed decimal arithmetic remains exact beyond JavaScript's safe integer range. */
export function cents(value: string): bigint {
 if (!/^-?\d+(\.\d{1,2})?$/.test(value)) throw new Error("Invalid exact decimal");
 const negative = value.startsWith("-");
 const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
 return (BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0"))) * (negative ? -BigInt(1) : BigInt(1));
}
export function decimalText(value: bigint): string {
 const positive = value < BigInt(0) ? -value : value;
 return `${value < BigInt(0) ? "-" : ""}${positive / BigInt(100)}.${String(positive % BigInt(100)).padStart(2, "0")}`;
}
const metrics = ["incurred", "commitments", "billed", "payments", "hours"] as const;
type Metrics = Record<typeof metrics[number], string>;
export type ReportRollup = { key: string; label: string; period: Metrics; cumulative: Metrics };
function metric(kind: ActualCommand["kind"]): keyof Metrics { return kind === "commitment" ? "commitments" : kind === "billed" ? "billed" : kind === "payment" ? "payments" : "incurred"; }
function emptyMetrics(): Metrics { return { incurred: "0.00", commitments: "0.00", billed: "0.00", payments: "0.00", hours: "0.00" }; }

/** All exported views use the same approved source versions. Billing and cash never enter incurred cost. */
export function summarizeReport(snapshot: ReportSnapshot) {
 const draft = workProgramDraftSchema.parse(snapshot.baseline.content_json);
 const actuals = snapshot.actuals.filter(v => v.status === "approved");
 const unresolved = snapshot.actuals.filter(v => v.status !== "approved" || v.amount === null || !v.allocations.length);
 const byElement = new Map<string, ReportRollup>(), byTask = new Map<string, ReportRollup>(), byStaff = new Map<string, ReportRollup>(), bySource = new Map<string, ReportRollup>();
 const total: ReportRollup = { key: "total", label: "Total", period: emptyMetrics(), cumulative: emptyMetrics() };
 function add(row: ReportRollup, v: ActualVersion, amount: string | null, hours: string | null) {
  if (amount === null) throw new Error("Approved record has no cost valuation");
  const key = metric(v.kind);
  const scopes = v.entry_date >= snapshot.period.starts_on && v.kind !== "opening" ? [row.period, row.cumulative] : [row.cumulative];
  for (const target of scopes) {
   target[key] = decimalText(cents(target[key]) + cents(amount));
   if (v.kind === "labor" || v.kind === "opening") target.hours = decimalText(cents(target.hours) + cents(hours ?? "0"));
  }
 }
 function group(map: Map<string, ReportRollup>, key: string, label: string) { if (!map.has(key)) map.set(key, { key, label, period: emptyMetrics(), cumulative: emptyMetrics() }); return map.get(key)!; }
 for (const v of actuals) {
  if (v.entry_date > snapshot.period.ends_on) throw new Error("Actual outside report dates");
  if (!v.allocations.length || v.allocations.reduce((sum, a) => sum + a.share, 0) !== 10000 || v.allocations.reduce((sum, a) => sum + cents(a.amount ?? "0"), BigInt(0)) !== cents(v.amount ?? "0")) throw new Error("Actual allocations do not reconcile");
  add(total, v, v.amount, v.hours);
  add(group(byStaff, v.staff_id ?? "no-staff", v.staffName ?? v.staff_id ?? "No staff attribution"), v, v.amount, v.hours);
  add(group(bySource, v.source_key, v.source_key), v, v.amount, v.hours);
  for (const a of v.allocations) {
   const e = draft.elements.find(e => e.id === a.element_id);
   if (!e || (a.task_id && !e.tasks.some(t => t.id === a.task_id))) throw new Error("Actual target is outside report baseline");
   add(group(byElement, e.id, `${e.code} ${e.title}`), v, a.amount, a.hours);
   add(group(byTask, `${e.id}:${a.task_id ?? "unallocated"}`, `${e.code} / ${e.tasks.find(t => t.id === a.task_id)?.description ?? "Element-level work, task unallocated"}`), v, a.amount, a.hours);
  }
 }
 const structured = draft.preparation ? reconcileStructuredWorkProgram(draft) : null;
 const budget = draft.elements.filter(e => e.disposition !== "completed" && e.budgetTreatment !== "informational").map(e => {
  const rows = e.budget.filter(b => b.kind === "cost");
  const structuredCost = structured?.byElement.find(r => r.id === e.id)?.cost ?? null;
  const approvedText = structured ? structuredCost === null ? null : structuredCost.toFixed(2) : rows.length && rows.every(r => r.amount !== null && r.basis !== "unresolved") ? decimalText(rows.reduce((sum, r) => sum + cents(r.amount!.toFixed(2)), BigInt(0))) : null;
  const actual = byElement.get(e.id)?.cumulative.incurred ?? "0.00";
  const progress = snapshot.period.progress.filter(p => p.elementId === e.id);
  // Element estimates and task estimates cannot both be counted. Missing tasks remain incomplete.
  const elementEstimate = progress.find(p => p.taskId === null);
  const selected = elementEstimate ? [elementEstimate] : e.tasks.map(t => progress.find(p => p.taskId === t.id));
  const complete = selected.length > 0 && selected.every(p => p && p.remainingCost !== null && p.remainingHours !== null && p.estimateBasis.trim());
  const remaining = complete ? decimalText(selected.reduce((sum, p) => sum + cents(p!.remainingCost!), BigInt(0))) : null;
  return { elementId: e.id, label: `${e.code} ${e.title}`, approved: approvedText, incurred: actual, budgetRemaining: approvedText === null ? null : decimalText(cents(approvedText) - cents(actual)), remainingEstimate: remaining, actualPlusRemaining: remaining === null ? null : decimalText(cents(actual) + cents(remaining)) };
 });
 for (const view of [byElement, byTask, byStaff, bySource]) for (const scope of ["period", "cumulative"] as const) for (const key of metrics) {
  if ([...view.values()].reduce((sum, r) => sum + cents(r[scope][key]), BigInt(0)) !== cents(total[scope][key])) throw new Error(`Unreconciled ${scope} ${key}`);
 }
 return { total, byElement: [...byElement.values()], byTask: [...byTask.values()], byStaff: [...byStaff.values()], bySource: [...bySource.values()], budget, unresolved };
}
