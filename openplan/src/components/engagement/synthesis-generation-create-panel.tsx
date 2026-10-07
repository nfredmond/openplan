"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { providerApiConnectionPage, type ApiListedConnection } from "@/lib/integrations/provider-api-metadata";
import { synthesisGenerationRequestIntentSchema } from "@/lib/engagement/synthesis-generation-request-records";
import { readSynthesisHistory } from "@/lib/engagement/synthesis-history-read";
import {
  readPendingSynthesisGeneration, retainPendingSynthesisGeneration, sendPendingSynthesisGeneration,
  preservePendingSynthesisGeneration, listPreservedSynthesisGeneration, SynthesisGenerationSaveError,
  type SynthesisGenerationClientScope, type PendingSynthesisGenerationCommand,
} from "@/lib/engagement/synthesis-generation-request-recovery";
import { SynthesisPreparationPanel } from "./synthesis-preparation-panel";
import { SynthesisGenerationCancelPanel } from "./synthesis-generation-cancel-panel";

type Props = SynthesisGenerationClientScope & { onAccessLost: () => void; onCreated: () => void };
type Receipt = Awaited<ReturnType<typeof sendPendingSynthesisGeneration>>;
const inputClass = "mt-1 w-full min-w-0 rounded border border-border bg-background px-3 py-2 text-sm";
const message = (cause: unknown) => cause instanceof Error ? cause.message : "The request is unconfirmed. Keep its exact saved command and retry.";

/** Save a staff-authored intent using existing provider metadata and recovery.
 * Choosing an API here never authorizes execution or acknowledges provider charges.
 */
export function SynthesisGenerationCreatePanel(props: Props) {
  return <Creation key={`${props.userId}:${props.workspaceId}:${props.campaignId}:${props.sourceId}:${props.sourceSha256}`} {...props} />;
}

function Creation({ userId, workspaceId, campaignId, sourceId, sourceSha256, onAccessLost, onCreated }: Props) {
  const scope = useMemo(() => ({ userId, workspaceId, campaignId, sourceId, sourceSha256 }), [userId, workspaceId, campaignId, sourceId, sourceSha256]);
  const [expanded, setExpanded] = useState(false), [ready, setReady] = useState(false), [blocked, setBlocked] = useState(false);
  const [pending, setPending] = useState<PendingSynthesisGenerationCommand | null>(null);
  const [copies, setCopies] = useState<ReturnType<typeof listPreservedSynthesisGeneration>>([]);
  const [connections, setConnections] = useState<ApiListedConnection[]>([]), [next, setNext] = useState<number | null>(null);
  const [selection, setSelection] = useState<ApiListedConnection | null>(null), [modelId, setModelId] = useState("");
  const [loading, setLoading] = useState(false), [choicesError, setChoicesError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [receipt, setReceipt] = useState<Receipt | null>(null);
  const activeRead = useRef<AbortController | null>(null), activeWrite = useRef<AbortController | null>(null), mounted = useRef(false), writing = useRef(false);
  const restore = useCallback(() => {
    try {
      const saved = readPendingSynthesisGeneration(localStorage, scope, "create"); setPending(saved);
      setCopies(listPreservedSynthesisGeneration(localStorage, scope, "create")); setBlocked(false);
      if (saved) setExpanded(true);
    } catch { setBlocked(true); setExpanded(true); setError("Browser recovery could not be read. Preserve the original before making another request."); }
    setReady(true);
  }, [scope]);
  const loseAccess = useCallback(() => {
    activeRead.current?.abort(); activeWrite.current?.abort(); setReceipt(null); setPending(null); setConnections([]); setSelection(null); setModelId(""); setCopies([]); setBlocked(true); onAccessLost();
  }, [onAccessLost]);
  useEffect(() => {
    mounted.current = true; restore();
    return () => { mounted.current = false; activeRead.current?.abort(); activeWrite.current?.abort(); };
  }, [restore]);
  const loadChoices = useCallback(async (offset = 0) => {
    activeRead.current?.abort(); const controller = new AbortController(); activeRead.current = controller;
    const isCurrent = () => mounted.current && activeRead.current === controller && !controller.signal.aborted;
    setLoading(true); setChoicesError(null);
    if (!offset) { setConnections([]); setSelection(null); setModelId(""); setNext(null); }
    try {
      const response = await readSynthesisHistory(`/api/workspaces/provider-api-connections?workspaceId=${workspaceId}&offset=${offset}`, {
        userId, workspaceId, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]), isCurrent,
      });
      if (response.status === 401 || response.status === 403) { loseAccess(); return; }
      if (!response.ok) throw new Error("Saved API choices are unavailable. Refresh the choices before saving a new request.");
      const page = providerApiConnectionPage.parse(await response.json());
      if (page.offset !== offset || (page.nextOffset !== null && page.nextOffset <= offset) || page.connections.some(row =>
        row.workspace_id !== workspaceId || row.current_revision && (row.current_revision.workspace_id !== workspaceId ||
          row.current_revision.connection_id !== row.id || row.current_revision.id !== row.current_revision_id))) throw new Error("Saved API choices do not match this workspace.");
      if (!isCurrent()) return;
      setConnections(previous => offset ? [...previous.filter(row => !page.connections.some(item => item.id === row.id)), ...page.connections] : page.connections);
      setNext(page.nextOffset);
    } catch { if (isCurrent()) { setConnections([]); setNext(null); setChoicesError("Saved API choices could not be confirmed for this workspace. Refresh them before saving a new request."); } }
    finally { if (isCurrent()) setLoading(false); }
  }, [userId, workspaceId, loseAccess]);
  useEffect(() => { if (expanded) void loadChoices(); return () => activeRead.current?.abort(); }, [expanded, loadChoices]);
  const connection = selection;
  const revision = connection?.current_revision;
  const selectionCurrent = Boolean(connection && !connection.revoked_at && revision && connections.some(row => row.id === connection.id &&
    !row.revoked_at && row.current_revision_id === revision.id && row.current_revision?.configuration_hash === revision.configuration_hash));
  const canCreate = ready && !blocked && !pending && !receipt && !busy && !loading && !choicesError && selectionCurrent && revision?.configuration.modelIds.includes(modelId);

  async function send(command: PendingSynthesisGenerationCommand) {
    if (writing.current) return;
    writing.current = true; const controller = new AbortController(); activeWrite.current = controller;
    const isCurrent = () => mounted.current && activeWrite.current === controller && !controller.signal.aborted;
    setBusy(true); setError(null);
    try {
      retainPendingSynthesisGeneration(localStorage, command); setPending(command);
      const result = await sendPendingSynthesisGeneration(localStorage, command, fetch, controller.signal);
      if (!isCurrent()) return;
      // A delayed creation reply cannot erase an already confirmed cancellation.
      setReceipt(current => current?.cancellation?.requestId === result.state.request?.id ? current : result); restore(); onCreated();
    } catch (cause) {
      if (isCurrent()) {
        if (cause instanceof SynthesisGenerationSaveError && [401, 403].includes(cause.status)) loseAccess();
        else { restore(); setError(message(cause)); }
      }
    } finally { writing.current = false; if (isCurrent()) setBusy(false); }
  }
  function create() {
    if (!canCreate || !connection || !revision) return;
    try {
      const intentText = JSON.stringify(synthesisGenerationRequestIntentSchema.parse({ schemaVersion: 1, sourceId, sourceSha256,
        connectionId: connection.id, configurationRevisionId: revision.id, configurationHash: revision.configuration_hash, modelId, taskByteLimit: 65_536 }));
      void send({ version: 1, ...scope, intentText, command: { operation: "create", requestId: crypto.randomUUID(), intentText } });
    } catch { setError("The selected API revision or model is invalid. Refresh the choices before saving."); }
  }
  function preserve() {
    try { preservePendingSynthesisGeneration(localStorage, scope, "create", pending ?? undefined); restore(); setError(null); }
    catch (cause) { setError(message(cause)); }
  }
  const cancelRequest = receipt?.state.request ?? (pending ? { id: pending.command.requestId, intentText: pending.intentText, actorId: userId } : null);
  return <section aria-label="New analysis request" className="min-w-0 space-y-3 rounded border border-border p-3 [&_button]:h-auto [&_button]:min-h-10 [&_button]:max-w-full [&_button]:whitespace-normal">
    <Button type="button" variant="outline" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>Optional generated analysis</Button>
    {expanded ? <div className="min-w-0 space-y-3">
      <p className="max-w-prose text-sm">Save a request for this complete source. Preparation and permission to send contributions to a provider are separate steps. You can also review contributions manually below.</p>
      {error ? <p role="alert">{error}</p> : null}{choicesError ? <p role="alert">{choicesError}</p> : null}
      {blocked ? <p>Browser recovery needs attention. Preserve the original before saving another request.</p> : null}
      {receipt ? <div className="space-y-3">
        <p role="status">{receipt.cancellation ? "Cancellation saved for this analysis request." : "Analysis request saved. No provider execution is authorized."}</p>
        <p className="text-sm break-all">Request {receipt.state.request?.id ?? receipt.cancellation?.requestId}{receipt.intent ? ` · Model ${receipt.intent.modelId}` : ""}</p>
        {receipt.cleanupError ? <p role="alert">{receipt.cleanupError}</p> : null}
        {receipt.state.request ? <SynthesisPreparationPanel {...scope} requestId={receipt.state.request.id} intentSha256={receipt.state.request.intentSha256}
          actorId={receipt.state.request.actorId} stage="segment" cancelled={receipt.cancellation !== null} onAccessLost={loseAccess} /> : null}
        <Button type="button" variant="outline" disabled={busy || Boolean(pending) || blocked} onClick={() => { setReceipt(null); void loadChoices(); }}>Start another request</Button>
      </div> : <>
        <label className="block text-sm">Saved API connection<select className={inputClass} disabled={busy || Boolean(pending) || loading || blocked} value={selectionCurrent ? connection?.id : ""}
          onChange={event => { setSelection(connections.find(row => row.id === event.target.value) ?? null); setModelId(""); }}>
          <option value="">Choose a saved API</option>{connections.filter(row => !row.revoked_at && row.current_revision).map(row => <option key={row.id} value={row.id}>{row.current_revision!.configuration.label}</option>)}
        </select></label>
        {connection && !selectionCurrent && !loading ? <p role="alert">The selected API changed or is unavailable. Choose its current revision before saving a new request.</p> : null}
        {revision ? <><p className="break-words text-sm [overflow-wrap:anywhere]">Destination: {revision.configuration.endpoint}</p>
          <label className="block text-sm">Analysis model<select className={inputClass} disabled={busy || Boolean(pending) || blocked} value={modelId} onChange={event => setModelId(event.target.value)}>
            <option value="">Choose a model</option>{revision.configuration.modelIds.map(model => <option key={model} value={model}>{model}</option>)}
          </select></label></> : null}
        <p className="text-sm text-muted-foreground">This workflow currently uses saved OpenAI-compatible APIs. Installed provider connections are available for supported project tasks. Saving this request does not send data, start a model, or accept provider charges.</p>
        <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={loading || busy} onClick={() => void loadChoices()}>Refresh analysis providers</Button>
          {next !== null ? <Button type="button" variant="outline" disabled={loading || busy} onClick={() => void loadChoices(next)}>Load more analysis providers</Button> : null}
          <Button type="button" disabled={!canCreate} onClick={create}>Save analysis request</Button></div>
        <a className="text-sm underline" href="/workspace">Manage saved APIs in settings</a>
        {loading ? <p role="status">Reading saved API choices…</p> : null}
        {!loading && !choicesError && !connections.some(row => !row.revoked_at && row.current_revision) ? <p>No saved API choices are available. Staff review remains available below.</p> : null}
      </>}
      {pending ? <div className="space-y-2"><p className="break-all text-sm">{receipt ? "Confirmed request recovery copy" : "Unconfirmed request"} {pending.command.requestId}. Its original intent remains saved in this browser. Retry this same command or inspect saved request history.</p>
        <details><summary className="cursor-pointer text-sm">Inspect the original request before retrying</summary>
          <p className="text-sm">The saved provider revision and model below govern the retry. Current provider choices do not replace them.</p>
          <pre className="whitespace-pre-wrap break-all text-xs">{pending.intentText}</pre>
        </details>
        <Button type="button" disabled={busy || blocked} onClick={() => void send(pending)}>Retry saved analysis request</Button></div> : null}
      {pending || blocked ? <Button type="button" variant="outline" disabled={busy} onClick={preserve}>Preserve request recovery copy</Button> : null}
      {cancelRequest ? <SynthesisGenerationCancelPanel {...scope} requestId={cancelRequest.id} intentText={cancelRequest.intentText}
        actorId={cancelRequest.actorId} cancelled={receipt?.cancellation !== null && receipt?.cancellation !== undefined}
        onAccessLost={loseAccess} onCancelled={result => { setReceipt(result); onCreated(); }} /> : null}
      {copies.length ? <details><summary className="cursor-pointer">Preserved request copies ({copies.length})</summary><p className="text-sm">These copies contain request identifiers and provider choices. Keep them private. Preserving a copy does not cancel a saved request.</p>
        {copies.map((copy, index) => <Button key={copy.key} type="button" variant="outline" onClick={() => {
          const url = URL.createObjectURL(new Blob([copy.raw], { type: "application/json" })); const anchor = document.createElement("a");
          anchor.href = url; anchor.download = `openplan-analysis-request-recovery-${index + 1}.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        }}>Download request copy {index + 1}</Button>)}</details> : null}
    </div> : null}
  </section>;
}
