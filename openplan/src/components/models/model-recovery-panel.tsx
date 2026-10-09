"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { recoveryInspectionSchema } from "@/lib/models/recovery-decision";
import { readRecoveryArchives, reviewRecoveryCopy, restoreRecoveryCopy, recoveryDecisionKey, readRecoveryDecisions, retainRecoveryDecision, sendRecoveryDecision, recoveryEndpoint, recoveryHeaders, type RecoveryScope, type SavedRecoveryDecision } from "@/lib/models/pending-recovery-decision";
import type { z } from "zod";

type Props = RecoveryScope & { permission: "allowed" | "denied" | "unavailable"; stageNames?: Record<string, string>; onConfirmed?: () => void };
function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ModelRecoveryPanel({ userId, workspaceId, modelId, runId, permission, stageNames = {}, onConfirmed }: Props) {
  const scope = useMemo(() => ({ userId, workspaceId, modelId, runId }), [userId, workspaceId, modelId, runId]);
  const scopeIdentity = `${userId}:${workspaceId}:${modelId}:${runId}`;
  const importId = useId();
  const fieldId = useId(), busyRef = useRef(false);
  const [busy, setBusy] = useState(false), [reason, setReason] = useState(""), [acknowledged, setAcknowledged] = useState(false);
  const [loadedInspection, setInspection] = useState<z.infer<typeof recoveryInspectionSchema> | null>(null);
  const [inspectedScope, setInspectedScope] = useState<string | null>(null);
  const inspection = inspectedScope === scopeIdentity ? loadedInspection : null;
  const [snapshot, setSnapshot] = useState<{ identity: string; value: ReturnType<typeof readRecoveryDecisions>; archives: ReturnType<typeof readRecoveryArchives> } | null>(null);
  const saved = snapshot?.identity === scopeIdentity ? snapshot.value : { records: [], unreadable: [] };
  const archives = snapshot?.identity === scopeIdentity ? snapshot.archives : [];
  const [imported, setImported] = useState<{ identity: string; text: string; record: SavedRecoveryDecision } | null>(null);
  const [preserveDamaged, setPreserveDamaged] = useState(false);
  const reviewedCopy = imported?.identity === scopeIdentity ? imported : null;
  const damagedCopy = reviewedCopy ? saved.unreadable.find((copy) => copy.key === recoveryDecisionKey(reviewedCopy.record)) : undefined;
  const [storageError, setStorageError] = useState<string | null>(null), [message, setMessage] = useState<string | null>(null);
  const refresh = useCallback(() => {
    try { setSnapshot({ identity: scopeIdentity, value: readRecoveryDecisions(localStorage, scope), archives: readRecoveryArchives(localStorage, scope) }); setStorageError(null); }
    catch { setStorageError("Browser storage is unavailable. No new decision can be sent until its recovery copy can be saved."); }
  }, [scope, scopeIdentity]);
  useEffect(() => { refresh(); window.addEventListener("storage", refresh); return () => window.removeEventListener("storage", refresh); }, [refresh]);
  const pending = saved.records.some((record) => record.phase === "pending");
  const blocked = permission !== "allowed" || busy || storageError !== null || saved.unreadable.length > 0;
  const active = inspection && ["queued", "running"].includes(inspection.expected_state.status);

  async function reviewFile(file?: File) {
    setImported(null); setPreserveDamaged(false); setMessage(null);
    if (!file) return;
    try {
      if (file.size > 2_000_000) throw new Error("Recovery copy exceeds the 2 MB review limit.");
      const text = await file.text();
      setImported({ identity: scopeIdentity, text, record: reviewRecoveryCopy(text, scope) });
    } catch { setMessage("This file is not a valid recovery copy for the current account and run. Existing copies were kept."); }
  }

  function restoreCopy() {
    if (!reviewedCopy || busyRef.current || permission !== "allowed" || storageError || (damagedCopy && !preserveDamaged)) return;
    try {
      const restored = restoreRecoveryCopy(localStorage, reviewedCopy.text, scope, damagedCopy);
      setImported(null); setPreserveDamaged(false); refresh();
      setMessage(restored.phase === "confirmed" ? "The matching decision and receipt are already retained." : "The decision copy is retained. No request was sent. Use Retry saved decision to ask the server to confirm its outcome.");
    } catch (error) { refresh(); setMessage(error instanceof Error ? error.message : "The copy could not be restored. Existing bytes were kept."); }
  }

  async function inspect() {
    if (busyRef.current) return; busyRef.current = true; setBusy(true); setMessage(null); setInspection(null); setAcknowledged(false);
    try {
      const response = await fetch(recoveryEndpoint(scope), { credentials: "same-origin", cache: "no-store", headers: recoveryHeaders(scope), signal: AbortSignal.timeout(30000) });
      const parsed = recoveryInspectionSchema.safeParse(await response.json());
      if (!response.ok || !parsed.success || parsed.data.expected_state.run_id !== runId || parsed.data.expected_state.model_id !== modelId || parsed.data.expected_state.workspace_id !== workspaceId) throw new Error("Recovery state could not be verified. No decision was sent.");
      setInspectedScope(scopeIdentity); setInspection(parsed.data);
    } catch { setMessage("Recovery state could not be verified. No decision was sent. Check your account and try again."); }
    finally { busyRef.current = false; setBusy(false); }
  }

  async function send(record?: SavedRecoveryDecision) {
    if (busyRef.current) return; busyRef.current = true; setBusy(true); setMessage(null);
    try {
      let retained = record;
      if (record && (record.scope.userId !== userId || record.scope.workspaceId !== workspaceId || record.scope.modelId !== modelId || record.scope.runId !== runId)) throw new Error("The account or run changed. Reopen its saved decision.");
      if (!retained) {
        if (!inspection || !active || !acknowledged || !reason.trim() || pending || blocked) throw new Error("Review the current state and consequence before saving a decision.");
        retained = retainRecoveryDecision(localStorage, { version: 1, scope, phase: "pending", receipt: null,
          decision: { requestId: crypto.randomUUID(), decision: "abandon_execution", expectedState: inspection.expected_state, reason,
            evidence: { source: "operator_recovery_review", process_termination: "unconfirmed", acknowledged_unconfirmed_termination: true } } });
        refresh();
      }
      const result = await sendRecoveryDecision(localStorage, retained);
      setMessage(result.phase === "confirmed" ? "Execution authority was abandoned. Process termination remains unconfirmed; no restart was authorized."
        : result.phase === "conflict" ? "The reviewed state changed or this request was refused. The original decision is kept below. Review current state before another decision."
        : "The decision is unconfirmed. Its exact request is saved below. Retry that request to recover its receipt.");
      if (result.phase === "confirmed") { setInspection(null); setAcknowledged(false); onConfirmed?.(); }
    } catch (error) { setMessage(error instanceof Error ? error.message : "The request could not be confirmed. Its saved copy was kept."); }
    finally { refresh(); busyRef.current = false; setBusy(false); }
  }

  return <details className="min-w-0 rounded-md border border-border p-3 text-sm" data-testid="model-recovery-panel">
    <summary className="cursor-pointer font-medium">Review execution recovery{pending ? " (saved request needs confirmation)" : ""}</summary>
    <div className="mt-3 min-w-0 space-y-3 break-words">
      <p>Abandoning execution prevents this run from accepting new worker writes. It preserves existing records. It does not prove the worker process stopped, validate results or authorize a restart.</p>
      {permission !== "allowed" ? <p role="status">{permission === "unavailable" ? "Recovery permissions could not be checked. Refresh this page before deciding." : "A workspace owner or administrator must make recovery decisions."}</p> : null}
      {storageError ? <p role="alert">{storageError}</p> : null}
      {message ? <p role="status" aria-live="polite">{message}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" disabled={blocked || pending} onClick={() => void inspect()}>Review current execution state</Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={refresh}>Reload saved decisions</Button>
      </div>
      {inspection ? <section className="space-y-3" aria-label="Reviewed execution state">
        <p>Recorded run status: <strong>{inspection.expected_state.status}</strong>. Reviewed version: {inspection.expected_state.updated_at}.</p>
        <ul className="space-y-1">{inspection.expected_state.stages.map((stage) => <li key={stage.id}>{stageNames[stage.id] ?? `Stage ${stage.id}`}: {stage.status}. {stage.active_attempt_id ? "An attempt holds write authority." : "No active attempt is recorded."}</li>)}</ul>
        {active ? <>
          <label className="block space-y-1" htmlFor={fieldId}><span>Reason for abandoning this execution</span><Textarea id={fieldId} maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)} disabled={busy || pending} /></label>
          <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} disabled={busy || pending} /><span>I understand that this revokes write authority without confirming process termination or restarting the model.</span></label>
          <Button type="button" variant="destructive" className="h-auto min-h-10 max-w-full whitespace-normal" disabled={blocked || pending || !acknowledged || !reason.trim()} onClick={() => void send()}>Save abandonment decision</Button>
        </> : <p>This run is already terminal. This recovery command cannot abandon it again.</p>}
      </section> : null}
      <section className="space-y-2 border-t border-border pt-3" aria-label="Restore recovery files">
        <label htmlFor={importId} className="block font-medium">Restore a downloaded recovery copy</label>
        <p>Select the original JSON decision downloaded for this account and run. Importing a receipt does not confirm its outcome. Restore saves the decision locally and sends nothing.</p>
        <input id={importId} type="file" accept="application/json,.json" className="block w-full min-w-0 text-sm" disabled={busy || permission !== "allowed" || storageError !== null} onChange={(event) => { void reviewFile(event.target.files?.[0]); event.target.value = ""; }} />
        {reviewedCopy ? <div className="space-y-2">
          <p>Request: {reviewedCopy.record.decision.requestId}</p>
          <p className="whitespace-pre-wrap">{reviewedCopy.record.decision.reason}</p>
          {damagedCopy ? <label className="flex items-start gap-2"><input type="checkbox" checked={preserveDamaged} onChange={(event) => setPreserveDamaged(event.target.checked)} /><span>Preserve the unreadable bytes in an archive before restoring this same request.</span></label> : null}
          <Button type="button" size="sm" variant="outline" disabled={busy || permission !== "allowed" || storageError !== null || Boolean(damagedCopy && !preserveDamaged)} onClick={restoreCopy}>Restore decision copy</Button>
        </div> : null}
      </section>
      {archives.map((archive) => <section key={archive.key} className="space-y-2 border-t border-border pt-3" aria-label="Preserved unreadable recovery copy"><p>Original unreadable bytes were preserved during restoration.</p><Button type="button" size="sm" variant="outline" onClick={() => download("preserved-model-recovery.json", archive.raw)}>Download preserved original</Button></section>)}
      {saved.records.map((record) => <section key={record.decision.requestId} className="space-y-2 border-t border-border pt-3" aria-label="Saved recovery decision">
        <p className="font-medium">{record.phase === "confirmed" ? "Decision receipt retained" : record.phase === "conflict" ? "Decision requires a new review" : "Decision awaiting confirmation"}</p>
        <p className="whitespace-pre-wrap">{record.decision.reason}</p>
        {record.phase === "confirmed" ? <p>Write authority was abandoned. Process termination remains unconfirmed.</p> : null}
        <div className="flex flex-wrap gap-2">
          {record.phase === "pending" ? <Button type="button" size="sm" variant="outline" disabled={blocked} onClick={() => void send(record)}>Retry saved decision</Button> : null}
          <Button type="button" size="sm" variant="outline" onClick={() => download(`model-recovery-${record.decision.requestId}.json`, JSON.stringify(record, null, 2) + "\n")}>Download decision{record.phase === "confirmed" ? " and receipt" : " copy"}</Button>
        </div>
      </section>)}
      {saved.unreadable.map((record) => <div key={record.key} className="space-y-2 border-t border-border pt-3" role="alert"><p>A saved recovery copy cannot be verified. It remains untouched. Download it before resolving this storage problem.</p><Button type="button" size="sm" variant="outline" onClick={() => download("unreadable-model-recovery.json", record.raw)}>Download unreadable copy</Button></div>)}
    </div>
  </details>;
}
