import { summarizeReport, type PeriodReport } from "./reporting";
import type { ReimbursementClaim, ReimbursementEvent } from "./reimbursement";

export type CloseoutHistory = { claims: ReimbursementClaim[]; reports: PeriodReport[]; events: ReimbursementEvent[] };

/** Review one retained baseline without summing cumulative reports or treating claims as cash. */
export function reviewWorkProgramCloseout(report: PeriodReport, history: CloseoutHistory) {
  const snapshot = report.snapshot;
  if (snapshot.workingPreview || snapshot.reimbursement) throw new Error("Select an issued management report for closeout review");
  if (new Set(snapshot.actuals.map(actual => actual.entry_id)).size !== snapshot.actuals.length) throw new Error("The retained report repeats a physical source entry");
  const totals = summarizeReport(snapshot);
  const claims = history.claims.map(claim => {
    const packet = history.reports.find(candidate => candidate.id === claim.current_report_id);
    const retained = packet?.snapshot.reimbursement;
    const belongs = !!retained && retained.claimId === claim.id && packet?.snapshot.baseline.id === snapshot.baseline.id
      && packet.snapshot.baseline.content_sha256 === snapshot.baseline.content_sha256;
    const currencyMatches = packet?.snapshot.baseline.content_json.currency === snapshot.baseline.content_json.currency;
    return {
      claimId: claim.id, title: claim.draft.title, state: claim.state, commandVersion: claim.version,
      packetId: packet?.id ?? null, packetHash: packet?.snapshot_hash ?? null,
      packetVersion: retained?.packetVersion ?? null,
      baselineMatches: belongs && currencyMatches,
      retainedRequest: belongs && currencyMatches ? retained!.reimbursementTotal : null,
      currency: packet?.snapshot.baseline.content_json.currency ?? null,
      balanceDue: null,
      reconciliation: belongs && currencyMatches
        ? "Cash receipts and refunds have not been reconciled to this claim. Acceptance does not establish payment."
        : "No current retained packet for this exact baseline and currency. Review the draft or the other baseline separately.",
      evidence: history.events.filter(event => event.claim_id === claim.id).sort((a, b) => a.sequence - b.sequence),
    };
  });
  return {
    schemaVersion: 1 as const,
    status: "unapproved_closeout_review" as const,
    reportId: report.id, reportHash: report.snapshot_hash,
    baselineId: snapshot.baseline.id, baselineHash: snapshot.baseline.content_sha256,
    baselineRevision: snapshot.baseline.revision, currency: snapshot.baseline.content_json.currency,
    cycleStart: snapshot.baseline.content_json.periodStart, cycleEnd: snapshot.baseline.content_json.periodEnd,
    reportThrough: snapshot.period.ends_on, sourceCutoff: snapshot.period.source_cutoff,
    fullCycleThrough: snapshot.period.ends_on === snapshot.baseline.content_json.periodEnd,
    recorded: totals.total.cumulative,
    unresolvedEntries: totals.unresolved.length,
    outstandingCommitments: null, refundsDue: null, approvedCarryover: null,
    claims,
    unfinishedWork: totals.budget.map(element => ({
      elementId: element.elementId, label: element.label, remainingEstimate: element.remainingEstimate,
      progress: snapshot.period.progress.filter(row => row.elementId === element.elementId),
      successorElementId: null, carryoverApproval: null,
    })),
    limits: [
      "This review does not close a period, settle a claim, authorize carryover or create successor costs.",
      "Recorded commitments have no linked discharge reconciliation; outstanding commitments remain unknown.",
      "Refunds and approved carryover remain unassessed. General payment entries are not matched reimbursement receipts.",
      "Only this report's retained source cutoff and baseline are reviewed; later costs, amendments and unrecorded obligations require separate reconciliation.",
    ],
  };
}
