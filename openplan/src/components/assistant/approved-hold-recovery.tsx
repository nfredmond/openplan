"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { executeAction } from "@/lib/runtime/action-registry";
import type { ApprovedHoldRecoveryEntry } from "@/lib/assistant/stage-gate-hold-recovery";

import type { ApprovedSubmittalRecoveryEntry } from "@/lib/assistant/project-submittal-recovery";

type RecoveryEntry = ApprovedHoldRecoveryEntry | ApprovedSubmittalRecoveryEntry;
type RecoveryPage = { items: RecoveryEntry[]; nextOffset: number | null };

/** Recover server-retained approval results after a tab, response or process was lost. */
function ApprovedActionRecovery({ workspaceId, kind }: { workspaceId: string; kind: "HOLD" | "submittal" }) {
  const path = kind === "HOLD" ? "holds" : "submittals";
  const [items, setItems] = useState<RecoveryEntry[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const readPage = useCallback(async (offset: number, signal?: AbortSignal, approvalId?: string): Promise<RecoveryPage> => {
    const endpoint = kind === "HOLD" ? "/api/assistant/actions/holds" : "/api/assistant/actions/submittals";
    const response = await fetch(`${endpoint}?workspaceId=${encodeURIComponent(workspaceId)}&offset=${offset}${approvalId ? `&approvalId=${encodeURIComponent(approvalId)}` : ""}`, { signal, cache: "no-store" });
    const data = await response.json();
    if (!response.ok || !Array.isArray(data?.items)) throw new Error(data?.error ?? `Approved ${kind} records could not be read.`);
    return data as RecoveryPage;
  }, [workspaceId, kind]);

  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    setItems([]);
    setError(null);
    readPage(0, controller.signal).then(data => {
      if (!controller.signal.aborted) { setItems(data.items); setNextOffset(data.nextOffset); }
    }).catch(cause => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : `Approved ${kind} records could not be read.`);
    }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [readPage, kind]);

  async function refresh(offset = 0) {
    setBusy(true); setError(null); setMessage(null);
    try {
      const data = await readPage(offset);
      setItems(current => offset === 0 ? data.items : Array.from(new Map([...current, ...data.items].map(item => [item.approvalId, item])).values()));
      setNextOffset(data.nextOffset);
    } catch (cause) { setError(cause instanceof Error ? cause.message : `Approved ${kind} records could not be read.`); }
    finally { setBusy(false); }
  }

  async function resume(item: RecoveryEntry) {
    if (!item.action) return;
    setBusy(true); setError(null); setMessage(null);
    let requestCompleted = false;
    try {
      await executeAction(item.action, { onCompleted: () => { requestCompleted = true; } }, {
        approvalEvidence: { approvalId: item.approvalId, inputHash: item.inputHash, executionSource: "planner_agent_quick_link" },
      });
      const data = await readPage(0, undefined, item.approvalId);
      // Recover this exact approval even when it is older than the first page.
      const updated = data.items.find(row => row.approvalId === item.approvalId);
      setItems(current => Array.from(new Map([...current, ...data.items].map(row => [row.approvalId, row])).values()));
      if (updated?.receipt) setMessage(`The saved ${kind} and its receipt are confirmed.`);
      else setMessage("The request finished. Check the saved result again before approving more work.");
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : "The action response could not be confirmed.";
      setError(requestCompleted ? `The request finished, but its receipt could not be refreshed. ${detail}` : detail);
    } finally { setBusy(false); }
  }

  return (
    <article id={`approved-${path}`} className="module-section-surface min-w-0">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Saved action recovery</p>
          <h2 className="module-section-title">Your approved {kind} requests</h2>
          <p className="module-section-description">Check the saved result after an interrupted request. Checking does not run the action or renew its approval.</p>
        </div>
        <Button type="button" variant="outline" onClick={() => void refresh()} disabled={busy}>Check saved results</Button>
      </div>
      {error ? <p role="alert" className="mb-4 break-words text-sm text-destructive">{error}</p> : null}
      {message ? <p role="status" className="mb-4 text-sm">{message}</p> : null}
      {busy ? <p role="status" className="text-sm text-muted-foreground">Checking approved requests…</p> : null}
      {!busy && !error && items.length === 0 ? <p className="text-sm text-muted-foreground">No approved {kind} requests were found for your account here.</p> : null}
      <div className="space-y-4">
        {items.map(item => (
          <section key={item.approvalId} aria-label={`Approved ${kind}: ${"gateLabel" in item ? item.gateLabel : item.action?.title ?? "Earlier submittal approval"}`} className="min-w-0 rounded-lg border border-border p-4">
            <h3 className="font-semibold break-words">{"gateLabel" in item ? item.gateLabel : item.action?.title ?? "Earlier submittal approval"}</h3>
            <p className="mt-1 text-xs text-muted-foreground">Approved {new Date(item.approvedAt).toLocaleString()}</p>
            {item.action ? <p className="mt-3 whitespace-pre-wrap break-words text-sm">{item.action.kind === "record_stage_gate_hold" ? item.action.rationale : item.action.notes}</p> : null}
            {item.action?.kind === "record_stage_gate_hold" && item.action.missingArtifacts?.length ? <p className="mt-2 break-words text-sm">Missing evidence: {item.action.missingArtifacts.join(", ")}</p> : null}
            {item.action ? <dl className="mt-2 space-y-1 break-words text-xs text-muted-foreground">
              <div><dt className="inline">Project: </dt><dd className="inline">{"projectName" in item && item.projectName ? <span>{item.projectName} (name at approval)<br /></span> : null}<span className="break-all">{item.action.projectId}</span></dd></div>
              {item.action.kind === "record_stage_gate_hold" && item.action.runId ? <div><dt className="inline">Analysis run: </dt><dd className="inline">{item.action.runId}</dd></div> : null}
              {item.action.kind === "record_stage_gate_hold" && item.action.modelRunId ? <div><dt className="inline">Model run: </dt><dd className="inline">{item.action.modelRunId}</dd></div> : null}
              {item.action.kind === "record_stage_gate_hold" && item.action.countyRunId ? <div><dt className="inline">County run: </dt><dd className="inline">{item.action.countyRunId}</dd></div> : null}
            </dl> : null}
            {item.receipt && "record" in item.receipt ? <p className="mt-3 break-words text-sm">Original status: {item.receipt.record.status.replace(/_/g, " ")}. Submittal type: {item.receipt.record.submittal_type.replace(/_/g, " ")}.</p> : null}
            {item.issue ? <p className="mt-3 text-sm">{item.issue}</p> : item.receipt ? (
              <p className="mt-3 text-sm font-medium">{kind === "HOLD" ? "HOLD" : "Submittal"} saved {new Date("decision" in item.receipt ? item.receipt.decision.decided_at : item.receipt.record.created_at).toLocaleString()}. Its original receipt is retained.{"record" in item.receipt ? " This is the result at creation; later project or record edits do not change it." : ""}</p>
            ) : (
              <p className="mt-3 text-sm">No completed receipt was found in this read. {Date.parse(item.expiresAt) <= Date.now() ? "This approval expired. Check the project before reviewing a new request." : "An explicit resume can use the same approval if its context is still current."}</p>
            )}
            <div className="mt-3 flex flex-wrap gap-3">
              {!item.receipt && !item.issue && item.action && Date.parse(item.expiresAt) > Date.now() ? <Button type="button" onClick={() => void resume(item)} disabled={busy}>Resume approved {kind}</Button> : null}
              {item.action ? <a className="module-inline-action" href={`/projects/${item.action.projectId}`}>Open project</a> : null}
            </div>
          </section>
        ))}
      </div>
      {nextOffset !== null ? <Button className="mt-4" type="button" variant="outline" onClick={() => void refresh(nextOffset)} disabled={busy}>Load older approvals</Button> : null}
    </article>
  );
}

export function ApprovedHoldRecovery({ workspaceId }: { workspaceId: string }) {
  return <ApprovedActionRecovery workspaceId={workspaceId} kind="HOLD" />;
}

export function ApprovedSubmittalRecovery({ workspaceId }: { workspaceId: string }) {
  return <ApprovedActionRecovery workspaceId={workspaceId} kind="submittal" />;
}
