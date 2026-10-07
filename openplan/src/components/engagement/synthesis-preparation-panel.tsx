"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { readSynthesisHistory } from "@/lib/engagement/synthesis-history-read";
import { verifySynthesisPreparation, type SynthesisPreparationState } from "@/lib/engagement/synthesis-preparation-state";
import {
  readPendingSynthesisPreparation, retainPendingSynthesisPreparation, sendPendingSynthesisPreparation,
  preservePendingSynthesisPreparation, listPreservedSynthesisPreparations, SynthesisPreparationSaveError,
  type PendingSynthesisPreparation, type SynthesisPreparationClientScope,
} from "@/lib/engagement/synthesis-preparation-recovery";

type Props = SynthesisPreparationClientScope & { actorId: string; cancelled: boolean; onAccessLost: () => void };
const statusLabels = { queued: "Waiting for the preparation worker", running: "Preparing analysis inputs", failed: "Preparation failed", cancelled: "Preparation cancelled", prepared: "Analysis inputs prepared" };
const failureLabels = { access_unavailable: "The worker could not confirm access.", input_unavailable: "The required inputs were unavailable.", preparation_failed: "The worker could not finish preparation." };
const message = (cause: unknown) => cause instanceof Error ? cause.message : "Preparation could not be confirmed. Keep the saved command and refresh its status.";

/** A history entry identifies the request. A fresh native read establishes its
 * preparation state; neither record grants permission to contact a provider.
 */
export function SynthesisPreparationPanel(props: Props) {
  return <Preparation key={`${props.userId}:${props.workspaceId}:${props.campaignId}:${props.sourceId}:${props.sourceSha256}:${props.requestId}:${props.intentSha256}:${props.stage}`} {...props} />;
}

function Preparation({ userId, workspaceId, campaignId, sourceId, sourceSha256, requestId, intentSha256, stage, actorId, cancelled, onAccessLost }: Props) {
  const scope = useMemo(() => ({ userId, workspaceId, campaignId, sourceId, sourceSha256, requestId, intentSha256, stage }),
    [userId, workspaceId, campaignId, sourceId, sourceSha256, requestId, intentSha256, stage]);
  const [state, setState] = useState<SynthesisPreparationState | null>(null);
  const [confirmed, setConfirmed] = useState(false), [ready, setReady] = useState(false), [blocked, setBlocked] = useState(false);
  const [pending, setPending] = useState<PendingSynthesisPreparation | null>(null);
  const [copies, setCopies] = useState<ReturnType<typeof listPreservedSynthesisPreparations>>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null), writing = useRef(false);
  const loseAccess = useCallback(() => {
    setState(null); setConfirmed(false); setPending(null); setCopies([]); setNotice(null); setBlocked(true); onAccessLost();
  }, [onAccessLost]);
  const restore = useCallback(() => {
    try {
      setPending(readPendingSynthesisPreparation(localStorage, scope));
      setCopies(listPreservedSynthesisPreparations(localStorage, scope)); setBlocked(false);
    } catch { setBlocked(true); setError("Browser recovery could not be read. Preserve it before making another preparation command."); }
    setReady(true);
  }, [scope]);
  const refresh = useCallback(async () => {
    if (writing.current) return;
    active.current?.abort(); const controller = new AbortController(); active.current = controller;
    const isCurrent = () => active.current === controller && !controller.signal.aborted;
    setBusy(true); setError(null); setState(null); setConfirmed(false);
    try {
      const response = await readSynthesisHistory(`/api/engagement/campaigns/${campaignId}/synthesis/preparation?requestId=${requestId}`, {
        userId, workspaceId, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]), isCurrent,
      });
      if (response.status === 401 || response.status === 403) { loseAccess(); throw new Error("Staff access could not be confirmed. Reopen this consultation."); }
      if (!response.ok) throw new Error("Preparation status is unavailable. Refresh to check it; an unavailable read does not mean preparation has not started.");
      const next = verifySynthesisPreparation(await response.json(), { campaignId, workspaceId, requestId });
      if (next && (next.actorId !== actorId || next.intentSha256 !== intentSha256 || next.stage !== stage)) throw new Error("Preparation does not match this saved request.");
      if (isCurrent()) { setState(next); setConfirmed(true); }
    } catch (cause) { if (isCurrent()) setError(message(cause)); }
    finally { if (isCurrent()) setBusy(false); }
  }, [userId, workspaceId, campaignId, requestId, actorId, intentSha256, stage, loseAccess]);
  useEffect(() => {
    restore(); void refresh();
    return () => { active.current?.abort(); active.current = null; };
  }, [restore, refresh]);

  async function send(command: PendingSynthesisPreparation) {
    if (writing.current || actorId !== userId) return;
    writing.current = true; active.current?.abort(); const controller = new AbortController(); active.current = controller;
    const isCurrent = () => active.current === controller && !controller.signal.aborted;
    setBusy(true); setError(null); setNotice(null); setConfirmed(false);
    try {
      // No network write occurs unless the exact command survives storage readback.
      retainPendingSynthesisPreparation(localStorage, command); setPending(command);
      const result = await sendPendingSynthesisPreparation(localStorage, command, fetch, controller.signal);
      if (!isCurrent()) return;
      setState(result.state); setConfirmed(true); restore();
      setNotice(result.cleanupError ?? "Preparation command confirmed. Provider execution still requires separate authorization.");
    } catch (cause) {
      if (isCurrent()) {
        if (cause instanceof SynthesisPreparationSaveError && [401, 403].includes(cause.status)) loseAccess();
        setError(message(cause));
      }
    } finally { writing.current = false; if (isCurrent()) setBusy(false); }
  }
  function preserve() {
    try { preservePendingSynthesisPreparation(localStorage, scope, pending ?? undefined); restore(); setError(null); setNotice("Recovery copies preserved in this browser. This does not cancel a saved preparation job."); }
    catch (cause) { setError(message(cause)); }
  }
  const canChange = ready && confirmed && !busy && !blocked && !pending && actorId === userId && !cancelled && !state?.cancelled;
  return <section aria-label="Request preparation" className="min-w-0 space-y-3 rounded border border-border p-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-semibold">Prepare analysis inputs</h4>
      <Button type="button" variant="outline" disabled={busy} onClick={() => void refresh()}>Refresh preparation status</Button></div>
    <p className="max-w-prose text-sm text-muted-foreground">Preparation reads this saved source and builds the inputs for analysis. It does not send contributions to a provider or approve findings.</p>
    {busy ? <p role="status">Checking preparation…</p> : null}
    {error ? <p role="alert">{error}</p> : null}{notice ? <p role="status">{notice}</p> : null}
    {blocked ? <p className="text-sm">Recovery needs attention before another command can be saved. Preserve the original copy or reopen the consultation to check access.</p> : null}
    {confirmed ? <><p className="font-medium">{state ? statusLabels[state.status] : "Preparation has not been queued"}</p>
      {state ? <p className="text-sm">Attempt {state.attempts}. Last updated <time dateTime={state.updatedAt}>{new Date(state.updatedAt).toLocaleString("en-US")}</time>.</p> : null}
      {state?.failureCode ? <p>{failureLabels[state.failureCode]}</p> : null}
      {state?.cancelled || cancelled ? <p>Cancellation is recorded. Earlier preparation and results remain retained.</p> : null}</> : null}
    {actorId !== userId ? <p className="text-sm">Another staff account created this request. Only that account can queue or retry preparation.</p> : null}
    <div className="flex flex-wrap gap-2">
      {confirmed && state === null ? <Button type="button" disabled={!canChange} onClick={() => void send({ version: 1, ...scope, command: { operation: "enqueue", requestId, stage, intentSha256 } })}>Queue preparation</Button> : null}
      {confirmed && state?.status === "failed" ? <Button type="button" disabled={!canChange} onClick={() => void send({ version: 1, ...scope, command: { operation: "retry", requestId, attempt: state.attempts } })}>Retry failed preparation</Button> : null}
      {pending ? <Button type="button" disabled={busy || blocked || actorId !== userId} onClick={() => void send(pending)}>Retry saved preparation command</Button> : null}
      {pending || blocked ? <Button type="button" variant="outline" disabled={busy} onClick={preserve}>Preserve recovery copy</Button> : null}
    </div>
    {pending ? <p className="text-sm">An exact {pending.command.operation} command remains in this browser. Retrying uses the same request and observed attempt. It never starts provider execution.</p> : null}
    {copies.length ? <details><summary className="cursor-pointer">Preserved preparation copies ({copies.length})</summary>
      <p className="text-sm">These copies contain request identifiers. Keep them private. Downloading or preserving a copy does not send it.</p>
      {copies.map((copy, index) => <Button key={copy.key} type="button" variant="outline" onClick={() => {
        const url = URL.createObjectURL(new Blob([copy.raw], { type: "application/json" })); const anchor = document.createElement("a");
        anchor.href = url; anchor.download = `openplan-preparation-recovery-${index + 1}.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      }}>Download copy {index + 1}</Button>)}</details> : null}
  </section>;
}
