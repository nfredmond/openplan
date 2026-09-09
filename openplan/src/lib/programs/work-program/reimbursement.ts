import { z } from "zod";
import { decimal, cents, decimalText, type PeriodReport } from "./reporting";
const id = z.string().uuid();
const evidence = z.string().trim().min(1).max(12000);
export const reimbursementDraftSchema = z.object({
 reportId: id, title: z.string().trim().min(1).max(240),
 authorityEvidence: evidence, formEvidence: evidence,
 costs: z.array(z.object({
  actualVersionId: id, eligibleAmount: decimal, eligibilityEvidence: evidence,
  shares: z.array(z.object({ fundId: id, amount: decimal, treatment: z.enum(["reimbursement", "match"]), evidence }).strict()).max(100),
 }).strict()).min(1).max(3000),
}).strict();
export type ReimbursementDraft = z.infer<typeof reimbursementDraftSchema>;
const base = { requestId: id, claimId: id, expectedVersion: z.number().int().nonnegative() };
export const reimbursementCommandSchema = z.discriminatedUnion("kind", [
 z.object({ ...base, kind: z.literal("save"), draft: reimbursementDraftSchema }).strict(),
 ...(["review", "submit", "return", "accept"] as const).map(kind => z.object({ ...base, kind: z.literal(kind), note: evidence }).strict()),
]);
export type ReimbursementCommand = z.infer<typeof reimbursementCommandSchema>;
export type ReimbursementClaim = { id: string; version: number; state: "draft" | "reviewed" | "submitted" | "returned" | "accepted"; draft: ReimbursementDraft; current_report_id: string | null };
export type ReimbursementEvent = { id: string; claim_id: string; sequence: number; kind: string; report_id: string | null; note: string; actor_id: string; created_at: string };
export type ReimbursementSnapshot = ReimbursementDraft & {
 claimId: string; packetVersion: number; sourceReportHash: string; reviewedBy: string; reviewedAt: string; reviewNote: string;
 totalCost: string; eligibleTotal: string; reimbursementTotal: string; matchTotal: string;
 contractCosts?: Record<string, unknown>[]; history: ReimbursementEvent[]; deliverables: Record<string, unknown>[]; deliverableEvents: Record<string, unknown>[];
};

/** Reconstruct the retained shares using exact cents; no billing or payment enters this total. */
export function reimbursementTotals(draft: ReimbursementDraft, report: PeriodReport) {
 let total = BigInt(0), eligible = BigInt(0), reimbursement = BigInt(0), match = BigInt(0);
 const seen = new Set<string>();
 for (const cost of draft.costs) {
  const actual = report.snapshot.actuals.find(v => v.id === cost.actualVersionId);
  if (!actual || actual.status !== "approved" || !["labor", "expense"].includes(actual.kind) || actual.amount === null || actual.entry_date < report.snapshot.period.starts_on || actual.entry_date > report.snapshot.period.ends_on) throw new Error("Select approved incurred costs within this reporting period");
  if (seen.has(actual.entry_id)) throw new Error("A source cost can appear only once");
  seen.add(actual.entry_id);
  const amount = cents(actual.amount), allowed = cents(cost.eligibleAmount);
  if (allowed < BigInt(0) || allowed > amount) throw new Error("Eligible cost exceeds the source cost");
  let allocated = BigInt(0);
  const funds = new Set<string>();
  for (const share of cost.shares) {
   if (!report.snapshot.baseline.content_json.preparation?.funds.some(f => f.id === share.fundId)) throw new Error("Funding share is outside the report baseline");
   if (funds.has(share.fundId)) throw new Error("Combine duplicate shares of the same fund");
   funds.add(share.fundId);
   const value = cents(share.amount);
   if (value <= BigInt(0)) throw new Error("Funding shares must be positive");
   allocated += value;
   if (share.treatment === "reimbursement") reimbursement += value; else match += value;
  }
  if (allocated !== allowed) throw new Error("Reimbursement and match shares must equal eligible cost");
  total += amount; eligible += allowed;
 }
 return { totalCost: decimalText(total), eligibleTotal: decimalText(eligible), reimbursementTotal: decimalText(reimbursement), matchTotal: decimalText(match) };
}
