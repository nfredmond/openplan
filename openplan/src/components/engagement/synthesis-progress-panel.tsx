"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { readSynthesisHistory } from "@/lib/engagement/synthesis-history-read";
import type { SynthesisExecutionScope } from "@/lib/engagement/synthesis-execution-records";
import { verifySynthesisProgress, type SynthesisProgress } from "@/lib/engagement/synthesis-progress";
import { SynthesisContinuationPanel } from "./synthesis-continuation-panel";

type Props = SynthesisExecutionScope & { userId: string; onAccessLost: () => void };
const outcomes: Record<SynthesisProgress["status"], { title: string; next: string }> = {
  empty_selection: { title: "No contributions require generated analysis", next: "Review the saved source selection. This does not establish that nobody participated." },
  ready_for_record_consolidation: { title: "Contribution outputs are ready to combine", next: "Combine each contribution with its complete context before preparing themes. Meaning remains unassessed." },
  inputs_not_sealed: { title: "Thematic inputs are not complete", next: "Finish selecting and preparing complete contribution context before thematic execution." },
  not_prepared: { title: "Analysis preparation is not complete", next: "Use preparation status above to check or queue this request." },
  staging: { title: "Analysis preparation is incomplete", next: "Check preparation status above. Partial saved material does not authorize execution." },
  incomplete: { title: "Analysis results are incomplete", next: "Review the task states below. A missing reply does not establish whether a provider call is still running or stopped. Do not resend an uncertain call." },
  frames_complete: { title: "Combined context is ready for theme preparation", next: "Select the complete context for each contribution before preparing themes. Machine wording still needs staff review." },
  proposal_complete: { title: "A machine draft is ready for staff review", next: "Open a staff synthesis review below to inspect and explicitly import the proposal. It is not an approved or published finding." },
};
const taskLabels: Record<SynthesisProgress["counts"][number]["disposition"], string> = {
  not_started: "No selected attempt", awaiting_result: "Selected attempt without retained output", failed: "Failed provider response",
  interrupted: "Interrupted response", invalid_output: "Output failed structural checks", provider_incomplete: "Provider response incomplete",
  incomplete_output: "Contribution coverage incomplete", validated_output: "Complete output checks", not_required_empty_selection: "No contribution selected",
  unselected: "No selected attempt", cleared: "Selected attempt cleared", claimed: "Claim retained without dispatch",
  awaiting_output: "Dispatch retained without output", predecessor_changed: "Earlier selected output changed",
  blocked_by_predecessor: "Earlier output must be resolved", resource_limit: "Continuation exceeds its resource limit", verified: "Complete output checks",
};

/** Display verified saved results separately from permission and worker liveness. */
export function SynthesisProgressPanel(props: Props) {
  return <Progress key={`${props.userId}:${props.workspaceId}:${props.campaignId}:${props.requestId}:${props.actorId}:${props.sourceId}:${props.sourceSha256}:${props.requestIntentSha256}:${props.stage}`} {...props} />;
}

function Progress({ userId, workspaceId, campaignId, requestId, actorId, sourceId, sourceSha256, requestIntentSha256, stage, onAccessLost }: Props) {
  const scope = useMemo(() => ({ workspaceId, campaignId, requestId, actorId, sourceId, sourceSha256, requestIntentSha256, stage }),
    [workspaceId, campaignId, requestId, actorId, sourceId, sourceSha256, requestIntentSha256, stage]);
  const [expanded, setExpanded] = useState(false), [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<SynthesisProgress | null>(null), [error, setError] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    active.current?.abort();
    const controller = new AbortController(); active.current = controller;
    const isCurrent = () => active.current === controller && !controller.signal.aborted;
    setSummary(null); setError(null); setBusy(true);
    try {
      const query = new URLSearchParams({ requestId, stage });
      const response = await readSynthesisHistory(`/api/engagement/campaigns/${campaignId}/synthesis/progress?${query}`, {
        userId, workspaceId, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(35_000)]), isCurrent,
      });
      if (!isCurrent()) return;
      if (response.status === 401 || response.status === 403) {
        onAccessLost();
        throw new Error("Current staff access could not be confirmed. Reopen this consultation.");
      }
      if (!response.ok) throw new Error("Saved analysis results could not be confirmed. Refresh this read; this does not mean no work occurred.");
      const next = verifySynthesisProgress(await response.json(), scope);
      if (isCurrent()) setSummary(next);
    } catch {
      if (isCurrent()) { setSummary(null); setError("Saved analysis results could not be confirmed. Refresh this read or reopen the consultation to check access. An unavailable result does not mean no work occurred."); }
    } finally { if (isCurrent()) setBusy(false); }
  }, [userId, workspaceId, campaignId, requestId, stage, scope, onAccessLost]);

  useEffect(() => {
    if (expanded) void refresh();
    return () => { active.current?.abort(); active.current = null; };
  }, [expanded, refresh]);
  const outcome = summary ? outcomes[summary.status] : null;
  const continuationParent = useMemo(() => summary?.stage === "segment" && summary.status === "ready_for_record_consolidation" && summary.selectionSequence !== null
    ? { parentRequestId: summary.requestId, parentActorId: summary.actorId, parentIntentSha256: summary.requestIntentSha256,
      sourceId: summary.sourceId, sourceSha256: summary.sourceSha256, throughSequence: summary.selectionSequence,
      segmentResultsManifestSha256: summary.manifestSha256 } : null, [summary]);
  return <section aria-label="Saved analysis results" className="min-w-0 space-y-3 border-t border-border pt-3">
    <Button type="button" variant="outline" className="h-auto min-h-10 max-w-full whitespace-normal text-left" aria-expanded={expanded}
      onClick={() => { setSummary(null); setError(null); setExpanded(current => !current); }}>Inspect saved analysis results</Button>
    {expanded ? <div className="min-w-0 space-y-3">
      <p className="max-w-prose text-sm text-muted-foreground">This reads saved output and its original saved material. It does not start a worker, retry a provider call or approve findings.</p>
      <Button type="button" variant="outline" disabled={busy} onClick={() => void refresh()}>Refresh results</Button>
      {busy ? <p role="status">Checking saved analysis results…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {summary && outcome ? <>
        <h4 className="font-semibold">{outcome.title}</h4>
        <p className="max-w-prose text-sm">{outcome.next}</p>
        <p className="text-sm text-muted-foreground">Checked <time dateTime={summary.checkedAt}>{new Date(summary.checkedAt).toLocaleString("en-US")}</time>. This is a saved snapshot, not a live worker connection.</p>
        {summary.cancelled ? <p className="text-sm">Cancellation is saved. Earlier results remain available; cancellation does not prove that a call already sent stopped.</p> : null}
        {summary.taskCount === null ? <p className="text-sm">The complete task count is not available until preparation finishes.</p> : <>
          <p className="text-sm">{summary.taskCount.toLocaleString("en-US")} tasks accounted for in this saved selection.</p>
          <dl className="space-y-2 text-sm">{summary.counts.map(row => <div key={row.disposition} className="flex min-w-0 flex-wrap justify-between gap-x-4 gap-y-1">
            <dt className="min-w-0 break-words">{taskLabels[row.disposition]}</dt><dd>{row.count.toLocaleString("en-US")}</dd>
          </div>)}</dl>
        </>}
        {summary.resourceAssessment ? <section aria-label="Continuation task limit" className="space-y-2 text-sm">
          <h5 className="font-semibold">Next continuation exceeds its saved task limit</h5>
          <p>Task {summary.resourceAssessment.taskIndex + 1} requires {summary.resourceAssessment.requiredTaskBytes.toLocaleString("en-US")} bytes. Its saved limit is {summary.resourceAssessment.taskByteLimit.toLocaleString("en-US")} bytes.</p>
          <p className="max-w-prose">This assessment uses saved source material and verified earlier results. It does not establish whether a provider call occurred. Preserve the original request and inspect saved results before preparing a separate request with a larger task limit and separate execution permission. Do not shorten source material to fit.</p>
        </section> : null}
        <p className="max-w-prose text-sm text-muted-foreground">Output checks establish retained bytes and required structure. They do not establish meaning, representative support, staff approval or publication.</p>
        <details className="text-sm"><summary className="cursor-pointer py-1">Original selection reference</summary>
          <dl className="mt-2 space-y-1 break-all"><dt>Request</dt><dd>{requestId}</dd>
            <dt>Selection sequence</dt><dd>{summary.selectionSequence ?? "Not available"}</dd>
            <dt>History SHA-256</dt><dd>{summary.manifestSha256}</dd></dl>
        </details>
        {continuationParent ? <SynthesisContinuationPanel userId={userId} workspaceId={workspaceId} campaignId={campaignId}
          parent={continuationParent} onAccessLost={onAccessLost} /> : null}
      </> : null}
    </div> : null}
  </section>;
}
