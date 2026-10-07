"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { SynthesisExecutionScope } from "@/lib/engagement/synthesis-execution-records";
import { verifySynthesisQueueLookup } from "@/lib/engagement/synthesis-execution-queue-records";
import { readPendingSynthesisQueue, retainPendingSynthesisQueue, sendPendingSynthesisQueue,
  preservePendingSynthesisQueue, SynthesisQueueSaveError } from "@/lib/engagement/synthesis-execution-queue-recovery";
import { readSynthesisHistory } from "@/lib/engagement/synthesis-history-read";

type Props = { scope: SynthesisExecutionScope; authorizationId: string; authorizationIntentSha256: string;
  expiresAt: string; unavailable: boolean; onAccessLost: () => void };

/** Separate explicit scheduling from permission, custody and output approval. */
export function SynthesisQueuePanel(props: Props) {
  const identity = JSON.stringify([props.scope, props.authorizationId, props.authorizationIntentSha256]);
  return <Queue key={identity} {...props} />;
}
function Queue({ scope, authorizationId, authorizationIntentSha256, expiresAt, unavailable, onAccessLost }: Props) {
  const bound = { ...scope, authorizationId, authorizationIntentSha256 };
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [checked, setChecked] = useState(false);
  const [pending, setPending] = useState<string | null>(null), [queued, setQueued] = useState(false), [blocked, setBlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null), running = useRef(false);
  useEffect(() => () => { active.current?.abort(); active.current = null; }, []);
  const expired = Date.parse(expiresAt) <= Date.now();
  function accessLost() { setPending(null); setQueued(false); setChecked(false); setBlocked(true); onAccessLost(); }
  async function review() {
    if (running.current) return;
    running.current = true; const controller = new AbortController(); active.current = controller;
    const current = () => active.current === controller && !controller.signal.aborted;
    setOpen(true); setBusy(true); setChecked(false); setError(null); setQueued(false);
    try {
      let local: ReturnType<typeof readPendingSynthesisQueue>;
      try { local = readPendingSynthesisQueue(localStorage, bound); }
      catch { setBlocked(true); throw new Error("Browser queue recovery is unreadable. Preserve its original copy before continuing."); }
      setPending(local?.commandText ?? null); setBlocked(false);
      const query = new URLSearchParams({ requestId: scope.requestId, authorizationId });
      const response = await readSynthesisHistory(`/api/engagement/campaigns/${scope.campaignId}/synthesis/execution/queue?${query}`, {
        userId: scope.actorId, workspaceId: scope.workspaceId, signal: controller.signal, isCurrent: current,
      });
      if ([401, 403].includes(response.status)) { if (current()) accessLost(); throw new Error("Current requester access could not be confirmed."); }
      if (!response.ok) throw new Error("Queue lookup failed. Retry this read before requesting execution.");
      const result = await verifySynthesisQueueLookup(await response.json(), bound);
      if (!current()) return;
      if (result.receipt) {
        try { retainPendingSynthesisQueue(localStorage, bound, result.receipt.commandText); }
        catch { setBlocked(true); throw new Error("Server and browser recovery differ. Preserve the browser copy, then read the server receipt again."); }
        setPending(result.receipt.commandText); setQueued(true);
      }
      setChecked(true);
    } catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : "Queue lookup is unavailable."); }
    finally { running.current = false; if (current()) setBusy(false); }
  }
  async function schedule() {
    if (running.current || !checked || blocked || queued || (!pending && (unavailable || expired))) return;
    running.current = true; const controller = new AbortController(); active.current = controller;
    const current = () => active.current === controller && !controller.signal.aborted;
    setBusy(true); setError(null);
    try {
      const bytes = pending ?? JSON.stringify({ schemaVersion: 1, ...bound, queueId: crypto.randomUUID() });
      retainPendingSynthesisQueue(localStorage, bound, bytes); setPending(bytes);
      await sendPendingSynthesisQueue(localStorage, bound, bytes, fetch, controller.signal);
      if (current()) setQueued(true);
    } catch (cause) {
      if (current()) {
        if (cause instanceof SynthesisQueueSaveError && [401, 403].includes(cause.status)) accessLost();
        setError(cause instanceof Error ? cause.message : "Scheduling is unconfirmed. Keep the original command.");
      }
    } finally { running.current = false; if (current()) setBusy(false); }
  }
  return <div className="min-w-0 space-y-2 border-t border-border pt-2">
    <Button type="button" variant="outline" disabled={busy} onClick={() => void review()}>Review scheduling</Button>
    {open ? <div className="min-w-0 space-y-2">
      <p>A configured execution worker can process an explicitly queued allowance. Queue custody does not prove that a call ran or that outputs are complete.</p>
      {busy ? <p role="status">Checking execution scheduling…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {queued ? <p role="status">Original execution request is queued. Inspect saved results for provider-call and output status.</p> : checked ? <p>No server queue receipt was found for this allowance.</p> : null}
      {pending ? <details><summary>Original scheduling command</summary><pre className="whitespace-pre-wrap break-all text-xs">{pending}</pre></details> : null}
      {blocked ? <Button type="button" variant="outline" disabled={busy} onClick={() => {
        try { preservePendingSynthesisQueue(localStorage, bound); setPending(null); setBlocked(false); setChecked(false); void review(); }
        catch (cause) { setError(cause instanceof Error ? cause.message : "Recovery could not be preserved."); }
      }}>Preserve browser queue recovery</Button> : null}
      {!queued ? <Button type="button" className="h-auto min-h-10 max-w-full whitespace-normal" disabled={busy || !checked || blocked || (!pending && (unavailable || expired))} onClick={() => void schedule()}>
        {pending ? "Retry original execution request" : "Request execution under this allowance"}
      </Button> : null}
      {!pending && (unavailable || expired) ? <p>New scheduling is unavailable because this allowance expired or its request/provider is no longer current.</p> : null}
    </div> : null}
  </div>;
}
