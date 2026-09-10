import { z } from "zod";
import { decimal, cents, decimalText, type PeriodReport, type ActualVersion } from "./reporting";
import type { CloseoutHistory } from "./closeout-review";
import type { WorkProgramDraft } from "./schema";

const id = z.string().uuid();
const evidence = z.string().trim().max(12000);
export const closeoutAssessmentSchema = z.object({
  registerEvidence: evidence,
  claims: z.array(z.object({ claimId: id, receipts: z.array(z.object({ actualVersionId: id, amount: decimal }).strict()).max(300), refundDue: decimal.nullable(), refundPayments: z.array(z.object({ actualVersionId: id, amount: decimal }).strict()).max(300).optional(), evidence }).strict()).max(300),
  commitments: z.array(z.object({ actualVersionId: id, outstandingAmount: decimal.nullable(), evidence }).strict()).max(1000),
  work: z.array(z.object({ elementId: id, disposition: z.enum(["unassessed", "completed", "carryover"]), successorRevisionId: id.nullable(), successorElementId: id.nullable(), sourceFundId: id.nullable(), successorFundId: id.nullable(), amount: decimal.nullable(), evidence }).strict()).max(500),
}).strict();
export type CloseoutAssessment = z.infer<typeof closeoutAssessmentSchema>;
const base = { requestId: id, reportId: id, expectedVersion: z.number().int().nonnegative(), sourceHash: z.string().regex(/^[a-f0-9]{64}$/) };
export const closeoutCommandSchema = z.discriminatedUnion("kind", [
  z.object({ ...base, kind: z.literal("save"), assessment: closeoutAssessmentSchema }).strict(),
  z.object({ ...base, kind: z.literal("approve"), note: evidence.min(1) }).strict(),
  z.object({ ...base, kind: z.literal("reopen"), note: evidence.min(1) }).strict(),
  z.object({ ...base, kind: z.literal("close_period"), expectedClosureVersion: z.number().int().nonnegative(), note: evidence.min(1) }).strict(),
  z.object({ ...base, kind: z.literal("reopen_period"), expectedClosureVersion: z.number().int().nonnegative(), note: evidence.min(1) }).strict(),
]);
export type CloseoutCommand = z.infer<typeof closeoutCommandSchema>;
export type SuccessorBaseline = { id: string; program_id: string; revision: number; content_sha256: string; content_json: WorkProgramDraft; title: string };
export type CloseoutSource = { report: PeriodReport; reimbursement: CloseoutHistory; actuals: (ActualVersion & { currency: string | null })[]; successors: SuccessorBaseline[] };
export type CloseoutRecord = { id: string; version: number; state: "draft" | "approved" | "reopened"; report_id: string; source_hash: string; content_hash: string; content: { source: CloseoutSource; assessment: CloseoutAssessment; note: string }; actor_id: string; created_at: string };
export type PeriodClosure = { id: string; period_id: string; version: number; kind: "close_period" | "reopen_period"; starts_on: string; ends_on: string; reconciliation_id: string; content: { note: string }; content_hash: string; actor_id: string; created_at: string };
export type CloseoutData = { source: CloseoutSource; sourceHash: string; records: CloseoutRecord[]; closures?: PeriodClosure[] };

/** Start unknown; recorded acceptance and general payments never imply a settled claim. */
export function initialCloseoutAssessment(source: CloseoutSource): CloseoutAssessment {
  return {
    registerEvidence: "", claims: source.reimbursement.claims.map(claim => ({ claimId: claim.id, receipts: [], refundDue: null, evidence: "" })),
    commitments: source.report.snapshot.actuals.filter(actual => actual.kind === "commitment" && actual.status === "approved").map(actual => ({ actualVersionId: actual.id, outstandingAmount: null, evidence: "" })),
    work: source.report.snapshot.baseline.content_json.elements.map(element => ({ elementId: element.id, disposition: "unassessed", successorRevisionId: null, successorElementId: null, sourceFundId: null, successorFundId: null, amount: null, evidence: "" })),
  };
}

/** Show the explicitly linked receipts only; a negative balance remains visible as overpayment. */
export function closeoutClaimBalance(source: CloseoutSource, claimId: string, assessment: CloseoutAssessment) {
  const claim = source.reimbursement.claims.find(candidate => candidate.id === claimId);
  const packet = source.reimbursement.reports.find(candidate => candidate.id === claim?.current_report_id);
  const row = assessment.claims.find(candidate => candidate.claimId === claimId);
  const request = packet?.snapshot.reimbursement?.reimbursementTotal;
  if (!request || !row?.evidence.trim()) return null;
  return decimalText(cents(request) - row.receipts.reduce((total, receipt) => total + cents(receipt.amount), BigInt(0)));
}

/** Retain unknown assessments and excess disbursements independently of claim receipts. */
export function closeoutRefundBalance(row: CloseoutAssessment["claims"][number]) {
  if (row.refundDue === null || !row.evidence.trim()) return null;
  return decimalText(cents(row.refundDue) - (row.refundPayments ?? []).reduce((total, payment) => total + cents(payment.amount), BigInt(0)));
}
