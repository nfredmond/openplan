"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SynthesisQueuePanel } from "./synthesis-queue-panel";
import { Button } from "@/components/ui/button";
import { readSynthesisHistory } from "@/lib/engagement/synthesis-history-read";
import { synthesisWorkerAuthorizationIntentSchema, type SynthesisExecutionScope } from "@/lib/engagement/synthesis-execution-records";
import { verifySynthesisExecutionPreview, verifySynthesisExecutionHistory } from "@/lib/engagement/synthesis-execution-browser";
import { readPendingSynthesisExecution, retainPendingSynthesisExecution, sendPendingSynthesisExecution,
  preservePendingSynthesisExecution, listPreservedSynthesisExecution, SynthesisExecutionSaveError,
  type PendingSynthesisExecution } from "@/lib/engagement/synthesis-execution-recovery";

type Props = SynthesisExecutionScope & { userId: string; onAccessLost: () => void };
type Preview = ReturnType<typeof verifySynthesisExecutionPreview>;
type History = Awaited<ReturnType<typeof verifySynthesisExecutionHistory>>;
const message = (cause: unknown) => cause instanceof Error ? cause.message : "Execution permission could not be confirmed. Preserve the original allowance and retry the read.";
const inputClass = "mt-1 block w-full min-w-0 rounded border border-border bg-background p-2 text-sm";
const localExpiry = () => {
  const date = new Date(Date.now() + 2 * 60 * 60 * 1000);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

/** Staff reviews the original destination and exact limits before retaining
 * execution authority. Existing workers own dispatch and recovery separately.
 */
export function SynthesisExecutionPanel(props: Props) {
  return <Execution key={`${props.userId}:${props.workspaceId}:${props.campaignId}:${props.requestId}:${props.actorId}:${props.sourceId}:${props.sourceSha256}:${props.stage}:${props.requestIntentSha256}`} {...props} />;
}

function Execution({ userId, workspaceId, campaignId, requestId, actorId, sourceId, sourceSha256, requestIntentSha256, stage, onAccessLost }: Props) {
  const scope = useMemo(() => ({ workspaceId, campaignId, requestId, actorId, sourceId, sourceSha256, requestIntentSha256, stage }),
    [workspaceId, campaignId, requestId, actorId, sourceId, sourceSha256, requestIntentSha256, stage]);
  const [expanded, setExpanded] = useState(false), [ready, setReady] = useState(false), [blocked, setBlocked] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null), [history, setHistory] = useState<History | null>(null);
  const [pending, setPending] = useState<PendingSynthesisExecution | null>(null);
  const [copies, setCopies] = useState<ReturnType<typeof listPreservedSynthesisExecution>>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [attempts, setAttempts] = useState("1"), [tokens, setTokens] = useState("2048"), [bytes, setBytes] = useState("65536");
  const [expires, setExpires] = useState(localExpiry), [acknowledged, setAcknowledged] = useState(false);
  const attemptsInitialized = useRef(false);
  const active = useRef<AbortController | null>(null), writing = useRef(false);
  const endpoint = `/api/engagement/campaigns/${campaignId}/synthesis/execution`;
  const loseAccess = useCallback(() => {
    setPreview(null); setHistory(null); setPending(null); setCopies([]); setNotice(null); setRecoveryError(null); setReady(false); setBlocked(true); onAccessLost();
  }, [onAccessLost]);
  const restore = useCallback(() => {
    if (userId !== actorId) return;
    try {
      const saved = readPendingSynthesisExecution(localStorage, scope);
      setPending(saved); setCopies(listPreservedSynthesisExecution(localStorage, scope)); setBlocked(false); setRecoveryError(null);
      if (saved) setExpanded(true);
    } catch { setBlocked(true); setExpanded(true); setRecoveryError("Execution recovery is unreadable. Preserve its original copy before saving another allowance."); }
  }, [userId, actorId, scope]);

  const refresh = useCallback(async (before: History["nextCursor"] = null) => {
    if (writing.current) return;
    active.current?.abort(); const controller = new AbortController(); active.current = controller;
    const isCurrent = () => active.current === controller && !controller.signal.aborted;
    setBusy(true); setError(null); setReady(false); setAcknowledged(false);
    if (!before) { setPreview(null); setHistory(null); }
    try {
      const headers = { userId, workspaceId, signal: controller.signal, isCurrent };
      const query = new URLSearchParams({ mode: "history", requestId,
        ...(before ? { beforeId: before.id, beforeCreatedAt: before.createdAt } : {}) });
      const historyResponse = await readSynthesisHistory(`${endpoint}?${query}`, headers);
      if ([401, 403].includes(historyResponse.status)) { loseAccess(); throw new Error("Staff access could not be confirmed. Reopen this consultation."); }
      if (!historyResponse.ok) throw new Error("Saved execution permissions are unavailable. Retry this read before saving another allowance.");
      const page = await verifySynthesisExecutionHistory(await historyResponse.json(), scope);
      if (!isCurrent()) return;
      setHistory(current => before && current ? { ...page, entries: [...current.entries, ...page.entries.filter(entry => !current.entries.some(row => row.id === entry.id))] } : page);
      let plan: Preview | null = null;
      if (!before) {
        const response = await readSynthesisHistory(`${endpoint}?${new URLSearchParams({ requestId, stage })}`, headers);
        if ([401, 403].includes(response.status)) { loseAccess(); throw new Error("Staff access could not be confirmed. Reopen this consultation."); }
        if (!response.ok) throw new Error("The prepared plan is unavailable. Complete preparation and retry this read.");
        plan = verifySynthesisExecutionPreview(await response.json(), scope);
      }
      if (!isCurrent()) return;
      if (plan) {
        setPreview(plan);
        // A fresh review must not increase a limit the requester already chose.
        if (!attemptsInitialized.current) {
          setAttempts(String(Math.max(1, plan.taskCount)));
          attemptsInitialized.current = true;
        }
      }
      setReady(true);
    } catch (cause) { if (isCurrent()) { setError(message(cause)); setReady(false); } }
    finally { if (isCurrent()) setBusy(false); }
  }, [userId, workspaceId, requestId, endpoint, scope, stage, loseAccess]);

  useEffect(() => { restore(); return () => { active.current?.abort(); active.current = null; }; }, [restore]);
  useEffect(() => { if (expanded) void refresh(); }, [expanded, refresh]);

  async function send(command: PendingSynthesisExecution) {
    if (writing.current || userId !== actorId) return;
    writing.current = true; active.current?.abort(); const controller = new AbortController(); active.current = controller;
    const isCurrent = () => active.current === controller && !controller.signal.aborted;
    setBusy(true); setError(null); setNotice(null); setAcknowledged(false);
    try {
      retainPendingSynthesisExecution(localStorage, command); setPending(command);
      const result = await sendPendingSynthesisExecution(localStorage, command, fetch, controller.signal);
      if (isCurrent()) setNotice(`Execution permission saved: ${result.receipt.id}. The original allowance remains saved in this browser. A configured worker must claim it before any provider call.`);
    } catch (cause) {
      if (isCurrent()) {
        if (cause instanceof SynthesisExecutionSaveError && [401, 403].includes(cause.status)) loseAccess();
        else restore();
        setError(message(cause));
      }
    } finally { writing.current = false; if (isCurrent()) setBusy(false); }
  }

  function authorize() {
    if (!preview || !history || !ready || busy || blocked || pending || !acknowledged || userId !== actorId ||
      preview.cancelled || history.cancelled || !preview.provider.current || preview.taskCount === 0) return;
    try {
      const intent = synthesisWorkerAuthorizationIntentSchema.parse({ schemaVersion: 1, headerSha256: preview.headerSha256,
        maxAttempts: Number(attempts), maxOutputTokens: Number(tokens), responseByteLimit: Number(bytes),
        expiresAt: new Date(expires).toISOString(), chargesAcknowledged: true, retryTaskIndex: null, retryOfAttemptId: null });
      if (intent.maxAttempts > preview.taskCount || new Date(intent.expiresAt).getTime() <= Date.now()) throw new Error("Choose a future expiry and no more attempts than prepared tasks.");
      void send({ version: 1, ...scope, command: { authorizationId: crypto.randomUUID(), intentText: JSON.stringify(intent) } });
    } catch { setError("Review the attempt, output-token and response-byte limits and choose a future expiry."); }
  }
  const canAuthorize = ready && Boolean(preview && history) && !busy && !blocked && !pending && acknowledged && userId === actorId &&
    !preview?.cancelled && !history?.cancelled && preview?.provider.current && preview.taskCount > 0;
  return <section aria-label="Execution permission" className="min-w-0 space-y-3 border-t border-border pt-3">
    <Button type="button" variant="outline" className="h-auto min-h-10 max-w-full whitespace-normal" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>Review execution permission</Button>
    {expanded ? <div className="min-w-0 space-y-4">
      <p className="max-w-prose text-sm">Sending contributions to a provider requires separate staff permission. Saving this allowance does not start a worker or approve findings.</p>
      <Button type="button" variant="outline" disabled={busy} onClick={() => void refresh()}>Refresh execution review</Button>
      {busy ? <p role="status">Checking execution permission…</p> : null}
      {recoveryError ? <p role="alert">{recoveryError}</p> : null}
      {error ? <p role="alert">{error}</p> : null}{notice ? <p role="status" className="break-words [overflow-wrap:anywhere]">{notice}</p> : null}
      {preview ? <div className="space-y-2 text-sm">
        <p className="break-words [overflow-wrap:anywhere]">Provider: {preview.provider.label}. Destination: {preview.provider.endpoint}</p>
        <p className="break-words [overflow-wrap:anywhere]">Model: {preview.provider.modelId}. {preview.taskCount} prepared tasks; {preview.inputBytes.toLocaleString("en-US")} saved bytes.</p>
        <p>Prepared bytes describe saved material, not a token estimate or provider price. Workers recheck the complete original material before each call.</p>
        {preview.cancelled || history?.cancelled ? <p>Cancellation is saved. New execution is unavailable.</p> : null}
        {!preview.provider.current ? <p>The original provider choice changed or was revoked. New execution is unavailable for this saved choice.</p> : null}
      </div> : null}
      {history ? <div className="space-y-2"><h5 className="font-semibold">Saved execution permissions</h5>
        <p className="text-sm">Review earlier allowances before adding one. An allowance is not proof that a call ran or completed. Expiry does not tell you whether a provider call completed.</p>
        {history.entries.length === 0 ? <p>No saved permissions were found.</p> : <ul className="space-y-2">{history.entries.map(entry => {
          const intent = synthesisWorkerAuthorizationIntentSchema.parse(JSON.parse(entry.intentText));
          return <li key={entry.id} className="rounded border border-border p-3 text-sm space-y-2"><p className="break-all">Permission {entry.id}</p>
            <p>{intent.maxAttempts} attempts; {intent.maxOutputTokens} output tokens and {intent.responseByteLimit} response bytes per call.</p>
            <p>Expires {new Date(intent.expiresAt).toLocaleString("en-US")}. {new Date(intent.expiresAt).getTime() <= Date.now() ? "Expired allowance." : "Workers still check current access and request state."}</p>
            <details><summary className="cursor-pointer">Original allowance bytes</summary><pre className="whitespace-pre-wrap break-all text-xs">{entry.intentText}</pre></details>
            {userId === actorId ? <SynthesisQueuePanel scope={scope} authorizationId={entry.id} authorizationIntentSha256={entry.intentSha256}
              expiresAt={intent.expiresAt} unavailable={!ready || !preview?.provider.current || Boolean(preview?.cancelled || history.cancelled)} onAccessLost={loseAccess} /> : null}
          </li>;
        })}</ul>}
        {history.nextCursor ? <Button type="button" variant="outline" disabled={busy} onClick={() => void refresh(history.nextCursor)}>Load older permissions</Button> : null}
      </div> : null}
      {userId !== actorId ? <p>Only the original requester can save execution permission. Other staff can inspect its history.</p> : <>
        <fieldset disabled={!ready || busy || blocked || Boolean(pending) || !preview?.provider.current || preview.cancelled || history?.cancelled} className="grid gap-3 sm:grid-cols-2">
          <legend className="font-semibold">New execution allowance</legend>
          <label>Maximum attempts<input className={inputClass} type="number" min="1" max={preview?.taskCount} value={attempts} onChange={event => setAttempts(event.target.value)} /></label>
          <label>Output tokens per call<input className={inputClass} type="number" min="1" max="65536" value={tokens} onChange={event => setTokens(event.target.value)} /></label>
          <label>Response bytes per call<input className={inputClass} type="number" min="4096" max="4194304" value={bytes} onChange={event => setBytes(event.target.value)} /></label>
          <label>Permission expires, local time<input className={inputClass} type="datetime-local" value={expires} onChange={event => setExpires(event.target.value)} /></label>
          <p className="text-sm sm:col-span-2">These resource limits are not a dollar ceiling. Check the provider’s terms and rates. A call already sent may incur charges even if its reply is lost. This form does not authorize retrying a task whose outcome is unknown.</p>
          <label className="flex items-start gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />I authorize sending the saved contributions to this provider under these limits and accept the provider’s charges.</label>
        </fieldset>
        <Button type="button" className="h-auto min-h-10 max-w-full whitespace-normal" disabled={!canAuthorize} onClick={authorize}>Save execution permission</Button>
        {pending ? <div className="space-y-2"><p className="break-words [overflow-wrap:anywhere]">Original allowance {pending.command.authorizationId} remains saved in this browser. Retrying reuses its exact bytes and never renews its expiry.</p>
          <details><summary className="cursor-pointer">Inspect retained allowance</summary><pre className="whitespace-pre-wrap break-all text-xs">{pending.command.intentText}</pre></details>
          <Button type="button" disabled={busy || blocked} onClick={() => void send(pending)}>Retry original execution permission</Button></div> : null}
        {pending || blocked ? <Button type="button" variant="outline" className="h-auto min-h-10 max-w-full whitespace-normal" disabled={busy} onClick={() => {
          try { preservePendingSynthesisExecution(localStorage, scope, pending ?? undefined); restore(); setNotice("Recovery copies preserved. Any saved permission remains in history; preservation does not cancel it."); setError(null); setAcknowledged(false); void refresh(); }
          catch (cause) { setError(message(cause)); }
        }}>Preserve allowance recovery</Button> : null}
        {copies.length ? <details><summary className="cursor-pointer">Preserved allowance copies ({copies.length})</summary><p className="text-sm">Keep these private. Downloading does not send a command or cancel execution.</p>
          {copies.map((copy, index) => <Button key={copy.key} type="button" variant="outline" onClick={() => {
            const url = URL.createObjectURL(new Blob([copy.raw], { type: "application/json" })), anchor = document.createElement("a");
            anchor.href = url; anchor.download = `openplan-execution-recovery-${index + 1}.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}>Download allowance copy {index + 1}</Button>)}</details> : null}
      </>}
    </div> : null}
  </section>;
}
