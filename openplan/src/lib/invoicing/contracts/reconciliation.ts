import { cents, decimalText } from "@/lib/programs/work-program/reporting";
import type { ActualVersion, ContractState, ContractSnapshot } from "./schema";
export const contractMetrics = ["incurred", "commitments", "payments", "credits", "hours"] as const;
export type Metrics = Record<typeof contractMetrics[number], string>;
export type Rollup = { id: string; label: string; totals: Metrics };
const empty = (): Metrics => ({ incurred: "0.00", commitments: "0.00", payments: "0.00", credits: "0.00", hours: "0.00" });
export function currentActuals(versions: ActualVersion[], asOf = "9999-12-31"): ActualVersion[] {
 const latest = new Map<string, ActualVersion>();
 for (const v of versions) if (!latest.has(v.entry_id) || latest.get(v.entry_id)!.version < v.version) latest.set(v.entry_id, v);
 return [...latest.values()].filter(v => v.command.entryDate <= asOf);
}
/** Reconcile retained sources once. Physical identity prevents OWP and contract copies becoming two costs. */
export function reconcileContract(state: ContractState, options: { asOf?: string; baselineId?: string; coverageComplete?: boolean } = {}) {
 const baseline = options.baselineId ? state.baselines.find(b => b.id === options.baselineId && b.state === "approved") : state.baselines.filter(b => b.state === "approved").at(-1);
 const actuals = currentActuals(state.actuals, options.asOf);
 const tasks = new Map<string, Rollup>(), staff = new Map<string, Rollup>(), deliverables = new Map<string, Rollup>();
 const total = empty(), identities = new Set<string>();
 const unresolved = actuals.filter(v => v.shared_source_stale || v.command.status === "draft" || v.amount === null || v.allocations.length === 0);
 const excluded = actuals.filter(v => v.command.status === "excluded");
 function row(map: Map<string, Rollup>, id: string, label: string) { if (!map.has(id)) map.set(id, { id, label, totals: empty() }); return map.get(id)!.totals; }
 function add(target: Metrics, v: ActualVersion, amount: string | null, hours: string | null) {
  if (amount === null) throw new Error("Approved source has no valuation");
  const category = v.command.category;
  const metric = category === "commitment" ? "commitments" : category === "payment" ? "payments" : category === "credit" ? "credits" : "incurred";
  target[metric] = decimalText(cents(target[metric]) + cents(amount));
  if (category === "labor" || category === "opening") target.hours = decimalText(cents(target.hours) + cents(hours ?? "0"));
 }
 for (const v of actuals.filter(v => v.command.status === "approved")) {
  const identity = v.time_entry_id ? `time:${v.time_entry_id}` : v.spend_entry_id ? `spend:${v.spend_entry_id}` : `source:${v.command.sourceKey}`;
  if (identities.has(identity)) throw new Error("Duplicate physical source in contract totals");
  identities.add(identity);
  if (v.amount === null || v.allocations.reduce((n, a) => n + a.share, 0) !== 10000 || v.allocations.reduce((n, a) => n + cents(a.amount ?? "0"), BigInt(0)) !== cents(v.amount) || (v.hours !== null && v.allocations.reduce((n, a) => n + cents(a.hours ?? "0"), BigInt(0)) !== cents(v.hours))) throw new Error("Actual allocations do not reconcile");
  add(total, v, v.amount, v.hours);
  add(row(staff, v.command.staffId ?? "unassigned", state.staff.find(s => s.id === v.command.staffId)?.name ?? "No staff attribution"), v, v.amount, v.hours);
  for (const a of v.allocations) {
   const task = baseline?.content.tasks.find(t => t.id === a.taskId);
   // An amended scope may remove an old task. Its incurred history remains visible.
   const historical = task ?? state.baselines.flatMap(b => b.content.tasks).find(t => t.id === a.taskId);
   if (!historical) throw new Error("Unknown contract task attribution");
   add(row(tasks, a.taskId, historical.title + (task ? "" : " (prior scope)")), v, a.amount, a.hours);
   add(row(deliverables, a.deliverableId ?? "unassigned", state.deliverables.find(d => d.id === a.deliverableId)?.title ?? "No deliverable attribution"), v, a.amount, a.hours);
  }
 }
 for (const map of [tasks, staff, deliverables]) for (const metric of contractMetrics) if ([...map.values()].reduce((n, r) => n + cents(r.totals[metric]), BigInt(0)) !== cents(total[metric])) throw new Error(`Unreconciled ${metric}`);
 const estimates = baseline?.content.tasks.map(t => {
  const estimate = state.estimates.filter(e => e.task_id === t.id && e.command.asOf <= (options.asOf ?? "9999-12-31")).at(-1);
  return { task: t, estimate, incurred: tasks.get(t.id)?.totals.incurred ?? "0.00" };
 }) ?? [];
 const complete = !!options.coverageComplete && !!baseline && estimates.length > 0 && estimates.every(e => e.estimate?.command.cost != null && e.estimate.command.hours != null) && !unresolved.length && !state.unmappedSpend.length && !state.unmappedTime.length;
 const remainingCost = complete ? decimalText(estimates.reduce((n, e) => n + cents(e.estimate!.command.cost!), BigInt(0))) : null;
 const issued = state.invoices.filter(i => i.status === "sent" || i.status === "paid");
 const undatedInvoices = issued.filter(i => !i.sent_date || !i.invoice_date);
 const invoices = issued.filter(i => i.sent_date && i.invoice_date && i.sent_date <= (options.asOf ?? "9999-12-31") && i.invoice_date <= (options.asOf ?? "9999-12-31"));
 const currencyMismatch = invoices.some(i => i.currency_code !== baseline?.content.currency);
 const grossBilled = currencyMismatch || undatedInvoices.length ? null : decimalText(invoices.reduce((n, i) => n + cents(i.subtotal_amount), BigInt(0)));
 const retention = currencyMismatch || undatedInvoices.length ? null : decimalText(invoices.reduce((n, i) => n + cents(i.retention_amount), BigInt(0)));
 const grossFeeRemaining = baseline?.content.feeBasis === "gross_fee" && baseline.content.fee !== null && grossBilled !== null ? decimalText(cents(baseline.content.fee) - cents(grossBilled) + cents(total.credits)) : null;
 return { baseline, actuals, total, byTask: [...tasks.values()], byStaff: [...staff.values()], byDeliverable: [...deliverables.values()], unresolved, excluded, estimates, remainingCost, actualPlusRemaining: remainingCost === null ? null : decimalText(cents(total.incurred) + cents(remainingCost)), grossBilled, retention, grossFeeRemaining, currencyMismatch, undatedInvoices, unknownHours: actuals.filter(v => v.command.status === "approved" && v.command.category === "opening" && v.hours === null).length };
}
export function reconcileSnapshot(report: ContractSnapshot) { return reconcileContract(report.snapshot, { asOf: report.snapshot.asOf, baselineId: report.snapshot.baselineId, coverageComplete: report.snapshot.coverageComplete }); }
