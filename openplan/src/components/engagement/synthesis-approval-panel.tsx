"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { checkSynthesisApprovalIntent, readSynthesisApprovalHistory, synthesisApprovalForRevision,
  type SynthesisApprovalContext, type VerifiedSynthesisApprovalHistory } from "@/lib/engagement/synthesis-approval";
import { ApprovalSaveError, emptyApprovalWorkingCopy, freezeApprovalRequest, listPreservedApprovalCopies,
  preserveApprovalWorkingCopy, readApprovalWorkingCopy, sendApprovalRequest, writeApprovalWorkingCopy,
  type ApprovalClientScope, type ApprovalWorkingCopy } from "@/lib/engagement/synthesis-approval-recovery";

type Props = { scope: ApprovalClientScope; revision: SynthesisApprovalContext; hasUnsavedReview: boolean;
  memory: { current: ApprovalWorkingCopy | null }; onAccessLost: () => void };
type Loaded = { current: SynthesisApprovalContext; history: VerifiedSynthesisApprovalHistory };
const payloadSchema = z.object({ current: z.unknown(), history: z.unknown() }).strict();
const message = (cause: unknown) => cause instanceof Error ? cause.message : "Approval is unconfirmed. Keep the exact request for retry.";
const buttonClass = "h-auto min-h-10 max-w-full whitespace-normal";

/** Recovery belongs to the retained review; selecting another revision does not replace its pending command. */
export function SynthesisApprovalPanel(props: Props) {
  const s = props.scope;
  return <ApprovalPanel key={`${s.userId}:${s.workspaceId}:${s.campaignId}:${s.sourceId}:${s.sourceSha256}:${s.reviewId}:${s.preparationSha256}`} {...props} />;
}
function ApprovalPanel({ scope, revision, hasUnsavedReview, memory, onAccessLost }: Props) {
  const { userId, workspaceId, campaignId, sourceId, sourceSha256, reviewId, preparationSha256 } = scope;
  const [working, setWorking] = useState(() => emptyApprovalWorkingCopy(scope));
  const workingRef = useRef(working), epoch = useRef(0), reads = useRef(0), sending = useRef(false);
  const [loaded, setLoaded] = useState<Loaded | null>(null), [ready, setReady] = useState(false), [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState(false), [accessLost, setAccessLost] = useState(false);
  const [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const [copies, setCopies] = useState<ReturnType<typeof listPreservedApprovalCopies>>([]);
  const endpoint = `/api/engagement/campaigns/${campaignId}/synthesis/approvals`;
  const adopt = (value: ApprovalWorkingCopy) => { workingRef.current = value; setWorking(value); };
  const loseAccess = useCallback(() => { epoch.current++; memory.current = null; setLoaded(null); setAccessLost(true); onAccessLost(); }, [memory, onAccessLost]);

  const reload = useCallback(async () => {
    const currentEpoch = epoch.current, sequence = ++reads.current;
    setLoaded(null);
    try {
      const res = await fetch(`${endpoint}?${new URLSearchParams({ reviewId })}`, { cache: "no-store",
        headers: { "x-openplan-expected-user": userId, "x-openplan-expected-workspace": workspaceId } });
      if (currentEpoch !== epoch.current || sequence !== reads.current) return;
      if (res.status === 401 || res.status === 403) { loseAccess(); return; }
      if (!res.ok) throw new Error("Approval history is unavailable. Keep any pending request and retry this read.");
      const data = payloadSchema.parse(await res.json());
      const history = await readSynthesisApprovalHistory(data.history, { campaignId, workspaceId, sourceId, sourceSha256, reviewId, preparationSha256 });
      // This protocol reader validates the full current-context schema and its history scope before use.
      const current = data.current as SynthesisApprovalContext;
      synthesisApprovalForRevision(history, current);
      if (currentEpoch === epoch.current && sequence === reads.current) setLoaded({ current, history });
    } catch (cause) { if (currentEpoch === epoch.current && sequence === reads.current) { setLoaded(null); setError(message(cause)); } }
  }, [endpoint, reviewId, userId, workspaceId, campaignId, sourceId, sourceSha256, preparationSha256, loseAccess]);

  // Only leaving this keyed scope invalidates a write. Revision selection still needs its exact receipt.
  useEffect(() => {
    const invalidate = () => { epoch.current++; };
    return invalidate;
  }, []);
  useEffect(() => {
    const currentScope = { userId, workspaceId, campaignId, sourceId, sourceSha256, reviewId, preparationSha256 };
    const restore = () => {
      const unsaved = memory.current;
      if (unsaved) setWorking(unsaved);
      try {
        adopt(readApprovalWorkingCopy(localStorage, currentScope)); setBlocked(Boolean(unsaved));
        setCopies(listPreservedApprovalCopies(localStorage, currentScope));
        if (unsaved) { setWorking(unsaved); setError("This approval reason could not be stored. Preserve or copy the latest text before continuing."); }
      } catch (cause) { setBlocked(true); setError(message(cause)); }
      setReady(true);
    };
    restore(); void reload();
    const refresh = () => { restore(); void reload(); };
    window.addEventListener("storage", refresh);
    return () => { window.removeEventListener("storage", refresh); };
  }, [userId, workspaceId, campaignId, sourceId, sourceSha256, reviewId, preparationSha256, memory, reload, revision.revisionId, revision.revisionSha256, revision.revisionNo]);

  function update(value: ApprovalWorkingCopy) {
    try { adopt(writeApprovalWorkingCopy(localStorage, workingRef.current, value)); memory.current = null; setBlocked(false); setError(null); return true; }
    catch (cause) { memory.current = value; setWorking(value); setBlocked(true); setError(message(cause)); return false; }
  }
  const status = (() => { try { return loaded ? synthesisApprovalForRevision(loaded.history, revision) : null; } catch { return null; } })();
  const isCurrent = loaded && loaded.current.revisionId === revision.revisionId && loaded.current.revisionSha256 === revision.revisionSha256 && loaded.current.revisionNo === revision.revisionNo;
  const head = loaded?.history.head;
  const canWithdraw = head?.intent.operation === "approve" && head.intent.revisionId === revision.revisionId && head.intent.revisionSha256 === revision.revisionSha256 && head.intent.revisionNo === revision.revisionNo;
  const otherDraft = working.draft && (working.draft.revisionId !== revision.revisionId || working.draft.revisionSha256 !== revision.revisionSha256 || working.draft.revisionNo !== revision.revisionNo);

  async function send(operation?: "approve" | "withdraw") {
    if (sending.current || blocked || !ready) return;
    const currentEpoch = epoch.current; sending.current = true; setBusy(true); setError(null); setNotice(null);
    try {
      let retained = workingRef.current;
      if (operation) {
        if (!loaded || !status || otherDraft || (operation === "approve" && hasUnsavedReview)) throw new Error("Open the exact saved review and preserve unfinished edits before approval.");
        const nextDraft = { revisionId: revision.revisionId, revisionNo: revision.revisionNo, revisionSha256: revision.revisionSha256,
          operation, reason: retained.draft?.reason ?? "" };
        const intent = checkSynthesisApprovalIntent({ ...revision, actorId: userId, requestId: crypto.randomUUID(), operation, reason: nextDraft.reason,
          predecessorId: loaded.history.head?.intent.requestId ?? null, predecessorSha256: loaded.history.head?.eventSha256 ?? null }, loaded.current, loaded.history.head);
        if (!update({ ...retained, draft: nextDraft })) return;
        retained = workingRef.current;
        try { retained = freezeApprovalRequest(localStorage, retained, intent); adopt(retained); }
        catch (cause) { memory.current = { ...retained, pending: intent }; setWorking(memory.current); setBlocked(true); throw cause; }
      }
      const result = await sendApprovalRequest(localStorage, retained);
      if (currentEpoch !== epoch.current) return;
      adopt(result.working); memory.current = null;
      setNotice(`${result.receipt.replayed ? "Recovered" : "Saved"} ${result.receipt.event.intent.operation === "approve" ? "approval" : "withdrawal"} for revision ${result.receipt.event.intent.revisionNo}.`);
      setError(result.cleanupError); await reload();
    } catch (cause) {
      if (currentEpoch !== epoch.current) return;
      if (cause instanceof ApprovalSaveError && (cause.status === 401 || cause.status === 403)) loseAccess();
      else setError(cause instanceof z.ZodError ? "Record a reason of at most 2000 characters before approval or withdrawal." : message(cause));
    } finally { sending.current = false; if (currentEpoch === epoch.current) setBusy(false); }
  }
  if (accessLost) return <section><p role="alert">Staff access changed. Reopen the consultation before viewing approvals.</p></section>;
  const disabled = !ready || !loaded || !status || blocked || busy || Boolean(working.pending) || Boolean(otherDraft);
  return <section aria-label="Exact revision approval" className="space-y-3 min-w-0 rounded border p-3">
    <h5 className="font-semibold">Staff approval of revision {revision.revisionNo}</h5>
    <p>Staff approval applies to this exact saved version. It does not publish findings, establish representative support or change unassessed interpretation.</p>
    <p role="status">{status ? `Revision ${revision.revisionNo} is ${status.state}.` : "Approval status is unavailable until its history is verified."}</p>
    {notice ? <p role="status">{notice}</p> : null}{error ? <p role="alert" className="break-words">{error}</p> : null}
    {blocked ? <p role="alert">Browser recovery needs attention. Preserve or copy the latest reason before leaving or reloading.</p> : null}
    {working.draft && (blocked || otherDraft) ? <details><summary>Latest approval reason retained on screen</summary><pre className="whitespace-pre-wrap break-all text-xs">{JSON.stringify(working.draft, null, 2)}</pre></details> : null}
    {otherDraft ? <p>An unfinished approval reason belongs to another revision. Preserve it before starting another action.</p> : null}
    {hasUnsavedReview ? <p>A review correction is unfinished. Save or preserve that correction before a new approval.</p> : null}
    {working.pending ? <div className="rounded border p-3 space-y-2"><p>Exact {working.pending.operation} request for revision {working.pending.revisionNo} retained for retry.</p><p className="text-xs break-all">Request {working.pending.requestId}</p><Button type="button" className={buttonClass} disabled={busy || blocked || !ready} onClick={() => void send()}>Retry retained approval request</Button></div> : null}
    <label className="block">Reason for approval or withdrawal<textarea className="block w-full rounded border p-2" rows={3}
      disabled={disabled} value={otherDraft ? "" : working.draft?.reason ?? ""} onChange={event => update({ ...workingRef.current,
        draft: { revisionId: revision.revisionId, revisionNo: revision.revisionNo, revisionSha256: revision.revisionSha256,
          operation: workingRef.current.draft?.operation ?? (canWithdraw ? "withdraw" : "approve"), reason: event.target.value } })} /></label>
    <div className="flex flex-wrap gap-3">
      <Button type="button" className={buttonClass} disabled={disabled || !isCurrent || status?.state === "approved" || hasUnsavedReview} onClick={() => void send("approve")}>Approve revision {revision.revisionNo}</Button>
      <Button type="button" className={buttonClass} variant="outline" disabled={disabled || !canWithdraw} onClick={() => void send("withdraw")}>Withdraw approval of revision {revision.revisionNo}</Button>
      <Button type="button" className={buttonClass} variant="outline" disabled={busy} onClick={() => void reload()}>Refresh approval history</Button>
      {working.draft || working.pending || blocked ? <Button type="button" className={buttonClass} variant="outline" disabled={busy} onClick={() => {
        try { preserveApprovalWorkingCopy(localStorage, scope, working); adopt(readApprovalWorkingCopy(localStorage, scope)); memory.current = null;
          setCopies(listPreservedApprovalCopies(localStorage, scope)); setBlocked(false); setError(null); setNotice("Approval recovery copy preserved below."); }
        catch (cause) { setError(message(cause)); }
      }}>Preserve approval reason and start another</Button> : null}
    </div>
    {loaded?.history.entries.length === 0 ? <p>No approval events are saved for this review.</p> : null}
    <ol aria-label="Approval history" className="space-y-2">{loaded?.history.entries.map(row => <li key={row.intent.requestId} className="rounded border p-3 break-words">
      <p>{row.intent.operation === "approve" ? "Approved" : "Withdrawn"} revision {row.intent.revisionNo} · {row.createdAt}</p>
      <p className="whitespace-pre-wrap">{row.intent.reason}</p><p className="text-xs break-all">Staff account {row.intent.actorId}</p>
      <p className="text-xs break-all">Revision SHA256 {row.intent.revisionSha256}</p><p className="text-xs break-all">Event SHA256 {row.eventSha256}</p>
    </li>)}</ol>
    {copies.length ? <section aria-label="Preserved approval recovery copies"><h6 className="font-semibold">Preserved approval reasons and requests</h6>{copies.map(copy => <details key={copy.key}>
      <summary>Preserved {copy.value?.pending ? "approval request" : "approval reason"}</summary><pre className="whitespace-pre-wrap break-all text-xs">{copy.raw}</pre>
      {copy.value ? <Button type="button" className={buttonClass} variant="outline" disabled={busy || blocked || Boolean(working.draft || working.pending)} onClick={() => update(copy.value!)}>Restore preserved approval copy</Button> : <p>The exact unreadable copy remains above.</p>}
    </details>)}</section> : null}
  </section>;
}
