"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { downloadText } from "@/lib/export/download";
import { reviewWorkProgramCloseout, type CloseoutHistory } from "@/lib/programs/work-program/closeout-review";
import type { PeriodReport } from "@/lib/programs/work-program/reporting";
import { SelectField } from "./fields";

export function CloseoutReview({ reports, history }: { reports: PeriodReport[]; history: CloseoutHistory | null }) {
  const [reportId, setReportId] = useState("");
  const report = reports.find(candidate => candidate.id === reportId);
  let review: ReturnType<typeof reviewWorkProgramCloseout> | null = null;
  let error = "";
  try { if (report && history) review = reviewWorkProgramCloseout(report, history); }
  catch (cause) { error = cause instanceof Error ? cause.message : "Closeout records could not reconcile"; }
  return <section id="closeout-review" className="min-w-0 space-y-4 rounded-xl border p-4">
    <h2 className="text-xl font-semibold">Closeout review</h2>
    <p className="text-sm">Review a retained reporting baseline, unresolved claims and unfinished work before preparing the next cycle. This review creates no closure or carryover approval.</p>
    <SelectField label="Closeout source report" value={reportId} onChange={setReportId}>
      <option value="">Select an issued management report</option>
      {reports.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.snapshot.period.name} · version {candidate.version} · through {candidate.snapshot.period.ends_on}</option>)}
    </SelectField>
    {!history && <p role="status">Reimbursement history is unavailable or loading. Reload packet history above before reviewing claims.</p>}
    {error && <p role="alert">Closeout review unavailable: {error}</p>}
    {review && <>
      <p className="text-sm">Baseline revision {review.baselineRevision} · {review.currency} · cycle {review.cycleStart} to {review.cycleEnd}. Report through {review.reportThrough}; sources saved through {review.sourceCutoff}.</p>
      {!review.fullCycleThrough && <p role="status">This report does not end at the cycle end. Final-period reconciliation remains incomplete.</p>}
      <p className="break-all text-xs">Retained baseline SHA256 {review.baselineHash}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <p>Recorded incurred cost: {review.recorded.incurred} {review.currency}</p>
        <p>Recorded commitments: {review.recorded.commitments} {review.currency}</p>
        <p>Outstanding commitments: Unknown</p><p>Refunds due: Unassessed</p>
        <p>Approved carryover: Unassessed</p><p>Excluded or unresolved source entries: {review.unresolvedEntries}</p>
      </div>
      <h3 className="font-semibold">Claims requiring reconciliation</h3>
      {!review.claims.length && <p>No claims are recorded in the loaded history. Completeness of the agency claim register remains unassessed.</p>}
      {review.claims.map(claim => <article key={claim.claimId} className="space-y-2 rounded-lg border p-3 text-sm">
        <h4 className="font-semibold break-words">{claim.title} · {claim.state}</h4>
        <p>Retained request: {claim.retainedRequest ?? "Unresolved for this baseline"} {claim.baselineMatches ? review.currency : ""}. Outstanding balance: Unknown.</p>
        <p>{claim.reconciliation} Earlier packet versions are retained history and are not added to the current request.</p>
        <p className="break-all text-xs">Packet {claim.packetId ?? "Not reviewed"} · SHA256 {claim.packetHash ?? "Unavailable"}</p>
        <details><summary>Review retained claim evidence</summary>{claim.evidence.map(event => <p key={event.id} className="mt-2 break-words">{event.sequence}. {event.kind} · {event.created_at} · {event.note}</p>)}</details>
      </article>)}
      <h3 className="font-semibold">Work to map into the next cycle</h3>
      {review.unfinishedWork.map(element => <article key={element.elementId} className="space-y-2 rounded-lg border p-3 text-sm">
        <h4 className="font-semibold">{element.label}</h4>
        <p>Remaining cost estimate: {element.remainingEstimate ?? "Incomplete"} {element.remainingEstimate === null ? "" : review.currency}. Successor mapping and carryover approval: Unassessed.</p>
        {element.progress.length ? element.progress.map((row, index) => <p key={index} className="break-words">As of {row.asOf}: {row.outstanding || "Outstanding work not described"}. Basis: {row.estimateBasis || "Unassessed"}</p>) : <p>No retained progress assessment.</p>}
      </article>)}
      {review.limits.map(limit => <p key={limit} className="text-sm">{limit}</p>)}
      <Button variant="outline" className="h-auto min-h-10 max-w-full whitespace-normal hover:bg-background hover:text-foreground" onClick={() => downloadText(JSON.stringify({ review, sourceReport: report, reimbursementHistory: history }, null, 2), `owp-closeout-review-${reportId}.json`, "application/json")}>Save private closeout review JSON</Button>
    </>}
  </section>;
}
