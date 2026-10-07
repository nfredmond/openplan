"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  readPendingSynthesisGeneration, retainPendingSynthesisGeneration, sendPendingSynthesisGeneration,
  preservePendingSynthesisGeneration, listPreservedSynthesisGeneration, SynthesisGenerationSaveError,
  type SynthesisGenerationClientScope, type PendingSynthesisGenerationCommand,
} from "@/lib/engagement/synthesis-generation-request-recovery";

type Receipt = Awaited<ReturnType<typeof sendPendingSynthesisGeneration>>;
type Props = SynthesisGenerationClientScope & { requestId: string; intentText: string; actorId: string; cancelled: boolean;
  onAccessLost: () => void; onCancelled: (receipt: Receipt) => void };
const message = (cause: unknown) => cause instanceof Error ? cause.message : "Cancellation is unconfirmed. Keep its original command and retry.";

/** Cancellation can precede confirmation of creation. Its separate recovery slot
 * never discards the uncertain create command or removes retained results.
 */
export function SynthesisGenerationCancelPanel(props: Props) {
  return <Cancellation key={`${props.userId}:${props.workspaceId}:${props.campaignId}:${props.sourceId}:${props.sourceSha256}:${props.requestId}`} {...props} />;
}

function Cancellation({ userId, workspaceId, campaignId, sourceId, sourceSha256, requestId, intentText, actorId, cancelled, onAccessLost, onCancelled }: Props) {
  const scope = useMemo(() => ({ userId, workspaceId, campaignId, sourceId, sourceSha256 }), [userId, workspaceId, campaignId, sourceId, sourceSha256]);
  const [reason, setReason] = useState(""), [pending, setPending] = useState<PendingSynthesisGenerationCommand | null>(null);
  const [ready, setReady] = useState(false), [blocked, setBlocked] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const [copies, setCopies] = useState<ReturnType<typeof listPreservedSynthesisGeneration>>([]);
  const active = useRef<AbortController | null>(null), mounted = useRef(false), writing = useRef(false);
  const restore = useCallback(() => {
    try {
      const saved = readPendingSynthesisGeneration(localStorage, scope, "cancel"); setPending(saved);
      setCopies(listPreservedSynthesisGeneration(localStorage, scope, "cancel")); setBlocked(false);
      if (saved?.command.operation === "cancel" && saved.command.requestId === requestId) setReason(saved.command.reason);
    } catch { setBlocked(true); setError("Cancellation recovery could not be read. Preserve the original copy before making a new cancellation."); }
    setReady(true);
  }, [scope, requestId]);
  useEffect(() => { mounted.current = true; restore(); return () => { mounted.current = false; active.current?.abort(); }; }, [restore]);
  async function send(command: PendingSynthesisGenerationCommand) {
    if (writing.current || actorId !== userId || command.command.requestId !== requestId) return;
    writing.current = true; const controller = new AbortController(); active.current = controller;
    const isCurrent = () => mounted.current && active.current === controller && !controller.signal.aborted;
    setBusy(true); setError(null); setNotice(null);
    try {
      retainPendingSynthesisGeneration(localStorage, command); setPending(command);
      const result = await sendPendingSynthesisGeneration(localStorage, command, fetch, controller.signal);
      if (!isCurrent()) return;
      restore(); setNotice(result.cleanupError ?? "Cancellation saved. Earlier requests and results remain retained."); onCancelled(result);
    } catch (cause) {
      if (isCurrent()) {
        if (cause instanceof SynthesisGenerationSaveError && [401, 403].includes(cause.status)) { setPending(null); setCopies([]); setReason(""); setBlocked(true); onAccessLost(); }
        else { restore(); setError(message(cause)); }
      }
    } finally { writing.current = false; if (isCurrent()) setBusy(false); }
  }
  function cancel() {
    if (!ready || blocked || busy || pending || cancelled || !reason.trim() || actorId !== userId) return;
    void send({ version: 1, ...scope, intentText, command: { operation: "cancel", requestId, cancellationId: crypto.randomUUID(), reason } });
  }
  function preserve() {
    try { preservePendingSynthesisGeneration(localStorage, scope, "cancel", pending ?? undefined); restore(); setError(null); setNotice("Cancellation recovery preserved in this browser. This does not submit or undo a cancellation."); }
    catch (cause) { setError(message(cause)); }
  }
  const pendingHere = pending?.command.requestId === requestId;
  return <section aria-label="Cancel analysis request" className="min-w-0 space-y-3 border-t border-border pt-3 [&_button]:h-auto [&_button]:min-h-10 [&_button]:max-w-full [&_button]:whitespace-normal">
    <h4 className="font-semibold">Stop this analysis request</h4>
    <p className="max-w-prose text-sm">Cancellation prevents new work under this request. You can cancel while the original save is unconfirmed. Earlier contributions, approvals and results remain retained; a provider call already sent may still incur charges.</p>
    {error ? <p role="alert">{error}</p> : null}{notice ? <p role="status">{notice}</p> : null}
    {cancelled ? <p>Cancellation is saved for this request.</p> : actorId !== userId ? <p>Only the original staff requester can cancel this request.</p> : <>
      <label className="block text-sm">Reason for cancelling<Textarea className="mt-1" maxLength={4000} value={reason} disabled={busy || Boolean(pending) || blocked} onChange={event => setReason(event.target.value)} /></label>
      <Button type="button" variant="outline" disabled={!ready || blocked || busy || Boolean(pending) || !reason.trim()} onClick={cancel}>Cancel analysis request</Button>
    </>}
    {pending ? <div className="space-y-2"><p className="break-all text-sm">Saved cancellation for request {pending.command.requestId}. {pendingHere ? "Retrying keeps its original reason and cancellation ID." : "Open that request in saved history, or preserve this copy before cancelling another request."}</p>
      {pending.command.operation === "cancel" ? <p className="whitespace-pre-wrap break-words text-sm">Original reason: {pending.command.reason}</p> : null}
      {pendingHere ? <Button type="button" disabled={busy || blocked || actorId !== userId} onClick={() => void send(pending)}>Retry saved cancellation</Button> : null}</div> : null}
    {pending || blocked ? <Button type="button" variant="outline" disabled={busy} onClick={preserve}>Preserve cancellation recovery copy</Button> : null}
    {copies.length ? <details><summary className="cursor-pointer">Preserved cancellation copies ({copies.length})</summary><p className="text-sm">These copies contain the original reasons and request identifiers. Keep them private.</p>
      {copies.map((copy, index) => <Button key={copy.key} type="button" variant="outline" onClick={() => {
        const url = URL.createObjectURL(new Blob([copy.raw], { type: "application/json" })); const anchor = document.createElement("a");
        anchor.href = url; anchor.download = `openplan-analysis-cancellation-${index + 1}.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      }}>Download cancellation copy {index + 1}</Button>)}</details> : null}
  </section>;
}
