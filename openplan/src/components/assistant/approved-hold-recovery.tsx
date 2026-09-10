"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { executeAction } from "@/lib/runtime/action-registry";
import type { ApprovedHoldRecoveryEntry } from "@/lib/assistant/stage-gate-hold-recovery";

type RecoveryPage = { items: ApprovedHoldRecoveryEntry[]; nextOffset: number | null };

/** Recover server-retained approval results after a tab, response or process was lost. */
export function ApprovedHoldRecovery({ workspaceId }: { workspaceId: string }) {
  const [items, setItems] = useState<ApprovedHoldRecoveryEntry[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const readPage = useCallback(async (offset: number, signal?: AbortSignal, approvalId?: string): Promise<RecoveryPage> => {
    const response = await fetch(`/api/assistant/actions/holds?workspaceId=${encodeURIComponent(workspaceId)}&offset=${offset}${approvalId ? `&approvalId=${encodeURIComponent(approvalId)}` : ""}`, { signal, cache: "no-store" });
    const data = await response.json();
    if (!response.ok || !Array.isArray(data?.items)) throw new Error(data?.error ?? "Approved HOLD records could not be read.");
    return data as RecoveryPage;
  }, [workspaceId]);

  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    setItems([]);
    setError(null);
    readPage(0, controller.signal).then(data => {
      if (!controller.signal.aborted) { setItems(data.items); setNextOffset(data.nextOffset); }
    }).catch(cause => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Approved HOLD records could not be read.");
    }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [readPage]);

  async function refresh(offset = 0) {
    setBusy(true); setError(null); setMessage(null);
    try {
      const data = await readPage(offset);
      setItems(current => offset === 0 ? data.items : Array.from(new Map([...current, ...data.items].map(item => [item.approvalId, item])).values()));
      setNextOffset(data.nextOffset);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Approved HOLD records could not be read."); }
    finally { setBusy(false); }
  }

  async function resume(item: ApprovedHoldRecoveryEntry) {
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
      if (updated?.receipt) setMessage("The saved HOLD and its receipt are confirmed.");
      else setMessage("The request finished. Check the saved result again before approving more work.");
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : "The action response could not be confirmed.";
      setError(requestCompleted ? `The request finished, but its receipt could not be refreshed. ${detail}` : detail);
    } finally { setBusy(false); }
  }

  return (
    <article id="approved-holds" className="module-section-surface min-w-0">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Saved action recovery</p>
          <h2 className="module-section-title">Your approved HOLD requests</h2>
          <p className="module-section-description">Check the saved result after an interrupted request. Checking does not run the action or renew its approval.</p>
        </div>
        <Button type="button" variant="outline" onClick={() => void refresh()} disabled={busy}>Check saved results</Button>
      </div>
      {error ? <p role="alert" className="mb-4 break-words text-sm text-destructive">{error}</p> : null}
      {message ? <p role="status" className="mb-4 text-sm">{message}</p> : null}
      {busy ? <p role="status" className="text-sm text-muted-foreground">Checking approved requests…</p> : null}
      {!busy && !error && items.length === 0 ? <p className="text-sm text-muted-foreground">No approved HOLD requests were found for your account here.</p> : null}
      <div className="space-y-4">
        {items.map(item => (
          <section key={item.approvalId} aria-label={`Approved HOLD: ${item.gateLabel}`} className="min-w-0 rounded-lg border border-border p-4">
            <h3 className="font-semibold break-words">{item.gateLabel}</h3>
            <p className="mt-1 text-xs text-muted-foreground">Approved {new Date(item.approvedAt).toLocaleString()}</p>
            {item.action ? <p className="mt-3 whitespace-pre-wrap break-words text-sm">{item.action.rationale}</p> : null}
            {item.action?.missingArtifacts?.length ? <p className="mt-2 break-words text-sm">Missing evidence: {item.action.missingArtifacts.join(", ")}</p> : null}
            {item.action ? <dl className="mt-2 space-y-1 break-all text-xs text-muted-foreground">
              <div><dt className="inline">Project: </dt><dd className="inline">{item.action.projectId}</dd></div>
              {item.action.runId ? <div><dt className="inline">Analysis run: </dt><dd className="inline">{item.action.runId}</dd></div> : null}
              {item.action.modelRunId ? <div><dt className="inline">Model run: </dt><dd className="inline">{item.action.modelRunId}</dd></div> : null}
              {item.action.countyRunId ? <div><dt className="inline">County run: </dt><dd className="inline">{item.action.countyRunId}</dd></div> : null}
            </dl> : null}
            {item.issue ? <p className="mt-3 text-sm">{item.issue}</p> : item.receipt ? (
              <p className="mt-3 text-sm font-medium">HOLD saved {new Date(item.receipt.decision.decided_at).toLocaleString()}. Its original receipt is retained.</p>
            ) : (
              <p className="mt-3 text-sm">No completed receipt was found in this read. {Date.parse(item.expiresAt) <= Date.now() ? "This approval expired. Check the project before reviewing a new request." : "An explicit resume can use the same approval if its context is still current."}</p>
            )}
            <div className="mt-3 flex flex-wrap gap-3">
              {!item.receipt && !item.issue && item.action && Date.parse(item.expiresAt) > Date.now() ? <Button type="button" onClick={() => void resume(item)} disabled={busy}>Resume approved HOLD</Button> : null}
              {item.action ? <a className="module-inline-action" href={`/projects/${item.action.projectId}`}>Open project</a> : null}
            </div>
          </section>
        ))}
      </div>
      {nextOffset !== null ? <Button className="mt-4" type="button" variant="outline" onClick={() => void refresh(nextOffset)} disabled={busy}>Load older approvals</Button> : null}
    </article>
  );
}
