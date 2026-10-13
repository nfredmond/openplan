"use client";

import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { historicalDecisionRpcArguments, matchesHistoricalDecisionReceipt, recoveryInspectionSchema, type HistoricalRunDecision as DecisionRequest } from "@/lib/models/recovery-decision";
import { recoveryEndpoint, recoveryHeaders, type RecoveryScope } from "@/lib/models/pending-recovery-decision";

type Choice = DecisionRequest["decision"];
type Props = RecoveryScope & { permission: "allowed" | "denied" | "unavailable"; onDecided?: () => void };

/**
 * Keep or close a run recorded before recovery tracking. Either choice appends
 * an audited receipt; neither changes the run, its outputs or its saved status.
 * An unconfirmed request is kept in memory and resent unchanged on retry.
 */
export function HistoricalRunDecision({ userId, workspaceId, modelId, runId, permission, onDecided }: Props) {
  const scope = { userId, workspaceId, modelId, runId };
  const reasonId = useId();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const busyRef = useRef(false);
  const unconfirmed = useRef<DecisionRequest | null>(null);

  if (permission !== "allowed") {
    return <p className="text-sm text-muted-foreground" data-testid="historical-run-decision">
      {permission === "unavailable" ? "Permissions could not be checked. Reload the page to decide." : "A workspace owner or admin decides what happens to this run."}
    </p>;
  }

  async function observedState() {
    const response = await fetch(recoveryEndpoint(scope), { credentials: "same-origin", cache: "no-store", headers: recoveryHeaders(scope), signal: AbortSignal.timeout(30000) });
    const parsed = recoveryInspectionSchema.safeParse(await response.json());
    if (!response.ok || !parsed.success || parsed.data.expected_state.run_id !== runId
        || parsed.data.expected_state.model_id !== modelId || parsed.data.expected_state.workspace_id !== workspaceId) return null;
    return parsed.data.expected_state;
  }

  async function decide(choice: Choice) {
    if (busyRef.current || !reason.trim()) return;
    busyRef.current = true; setBusy(true); setMessage(null);
    try {
      let request = unconfirmed.current;
      if (!request || request.decision !== choice || request.reason !== reason) {
        const expectedState = await observedState();
        if (!expectedState) { setMessage("This run could not be checked. Nothing was recorded. Try again."); return; }
        request = { requestId: crypto.randomUUID(), decision: choice, expectedState, reason };
      }
      unconfirmed.current = request;
      const response = await fetch(recoveryEndpoint(scope), {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json", ...recoveryHeaders(scope) },
        body: JSON.stringify(request), signal: AbortSignal.timeout(30000),
      });
      const body: unknown = await response.json().catch(() => null);
      if (response.ok && matchesHistoricalDecisionReceipt(body, historicalDecisionRpcArguments(request, workspaceId, runId, userId))) {
        unconfirmed.current = null; setMessage("Decision recorded."); onDecided?.(); return;
      }
      if (response.status >= 500) { setMessage("The decision could not be confirmed. Press the same button to try again."); return; }
      unconfirmed.current = null;
      const error = body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : null;
      setMessage(error ?? "The decision was not recorded.");
    } catch {
      setMessage("The decision could not be confirmed. Press the same button to try again.");
    } finally {
      busyRef.current = false; setBusy(false);
    }
  }

  const disabled = busy || !reason.trim();
  return <div className="space-y-2 text-sm" data-testid="historical-run-decision">
    <label className="block space-y-1" htmlFor={reasonId}>
      <span>Reason, saved with the decision</span>
      <Textarea id={reasonId} maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)} disabled={busy} />
    </label>
    <div className="flex flex-wrap gap-2">
      <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => void decide("keep_as_record")}>Keep it</Button>
      <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => void decide("close_for_fresh_run")}>Close to run again</Button>
    </div>
    {message ? <p role="status" aria-live="polite">{message}</p> : null}
  </div>;
}
