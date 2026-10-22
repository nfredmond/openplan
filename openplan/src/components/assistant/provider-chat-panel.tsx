"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChatReviewCancelled, advanceRetainedChatProgress, type RetainedChatProgress } from "@/lib/assistant/chat-stream";
import type { AssistantChatAcceptedGrantV1 } from "@/lib/assistant/provider-chat-task";
import type { ChatIntentReview } from "@/lib/assistant/provider-chat-intents";
import { ApprovedSubmittalRecovery } from "./approved-hold-recovery";

type Option = { id: string; selection: Pick<AssistantChatAcceptedGrantV1["selection"], "modelId" | "endpoint" | "authMode"> };
type Prepared = { canonical: string; digest: string; turnId: string };
type IntentStatus = { intentId: string; state: string; executionState: string; receiptState: string; originalApprovalId: string | null; recoveryHref: string };
const chatUrl = "/api/assistant/providers/chat";
async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const body = await response.json();
  if (!response.ok || body.error) throw new Error(body.error ?? "Saved API chat is unavailable. Check its retained status.");
  return body as T;
}
const post = <T,>(url: string, body: unknown) => json<T>(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export function ProviderChatPanel({ workspaceId, projectId, onReview }: { workspaceId: string; projectId: string | null; onReview: (review: ChatIntentReview) => Promise<void> }) {
  const [opened, setOpened] = useState(false), [options, setOptions] = useState<Option[]>([]), [selected, setSelected] = useState("");
  const [question, setQuestion] = useState(""), [additionalIds, setAdditionalIds] = useState(""), [includeIndex, setIncludeIndex] = useState(false);
  const [prepared, setPrepared] = useState<Prepared | null>(null), [acknowledged, setAcknowledged] = useState(false);
  const [active, setActive] = useState<string | null>(null), [view, setView] = useState<RetainedChatProgress | null>(null);
  const [history, setHistory] = useState<Array<{ id: string; state: string }>>([]), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<Record<string, IntentStatus>>({}), [uncertain, setUncertain] = useState<Record<string, boolean>>({});
  const [repeatAcknowledged, setRepeatAcknowledged] = useState<Record<string, boolean>>({});
  const [showRecovery, setShowRecovery] = useState(false);
  const repeatRequests = useRef<Record<string, string>>({});
  const retainedCursor = useRef<{ turnId: string; sequence: number } | null>(null);
  const reading = useRef(false);
  const selectedTurn = useRef<string | null>(null), retainedView = useRef<RetainedChatProgress | null>(null);
  function chooseTurn(turnId: string | null) {
    if (selectedTurn.current !== turnId) { retainedCursor.current = null; retainedView.current = null; setView(null); }
    selectedTurn.current = turnId; setActive(turnId);
  }
  const refresh = useCallback(async (turnId: string) => {
    if (reading.current) return;
    reading.current = true;
    try {
      // Always GET. Remounting, polling and reconnecting cannot restart generation.
      const afterSequence = retainedCursor.current?.turnId === turnId ? retainedCursor.current.sequence : 0;
      const next = await json<RetainedChatProgress>(`${chatUrl}?turnId=${turnId}&afterSequence=${afterSequence}`);
      if (selectedTurn.current !== turnId) return;
      const merged = advanceRetainedChatProgress(retainedView.current?.turnId === turnId ? retainedView.current : null, next);
      retainedView.current = merged; setView(merged);
      retainedCursor.current = next.released ? { turnId, sequence: next.cursor } : null;
      if (!next.released) { setPrepared(null); setAcknowledged(false); }
    } catch (reason) {
      if (selectedTurn.current !== turnId) return;
      const withheld = { turnId, released: false, state: "unavailable", cursor: 0, recoveryHref: `/assistant-activity?workspaceId=${workspaceId}` };
      retainedView.current = withheld; setView(withheld);
      retainedCursor.current = null;
      setPrepared(null); setAcknowledged(false);
      setError(reason instanceof Error ? reason.message : "Retained chat could not be read.");
    } finally { reading.current = false; }
  }, [workspaceId]);
  useEffect(() => {
    if (!opened) return; let current = true;
    Promise.all([json<{ options: Option[] }>(`${chatUrl}?operation=options&workspaceId=${workspaceId}`),
      json<{ turns: Array<{ id: string; state: string }> }>(`${chatUrl}?operation=history&workspaceId=${workspaceId}`)])
      .then(([available, saved]) => { if (current) { setOptions(available.options); setHistory(saved.turns); } })
      .catch(() => { if (current) setError("Saved API chat is unassessed or unavailable. Apply and validate its upgrade and exact capability before admission."); });
    return () => { current = false; };
  }, [opened, workspaceId]);
  useEffect(() => {
    if (!active || !opened) return;
    let stopped = false, timer: ReturnType<typeof setTimeout>;
    const read = async () => { if (stopped) return; await refresh(active); if (!stopped) timer = setTimeout(() => { void read(); }, 2000); };
    void read(); return () => { stopped = true; clearTimeout(timer); };
  }, [active, opened, refresh]);
  function invalidate() { setPrepared(null); setAcknowledged(false); }
  async function prepare() {
    setBusy(true); setError(null); invalidate();
    try {
      const ids = [projectId, ...additionalIds.split(/[\s,]+/)].filter((id): id is string => Boolean(id));
      const response = await post<Prepared>(chatUrl, { operation: "prepare", input: { prepareRequestId: crypto.randomUUID(), acceptanceRequestId: crypto.randomUUID(), turnRequestId: crypto.randomUUID(),
        capabilityRecordId: selected, question, scope: { target: { kind: projectId ? "project" : "workspace", id: projectId, workspaceId },
          selectedProjectIds: [...new Set(ids)].sort(), includeWorkspaceIndex: includeIndex } } });
      if (!response.canonical || !response.digest) throw new Error("The disclosure preview was withheld.");
      setPrepared(response);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Disclosure preparation failed."); }
    finally { setBusy(false); }
  }
  async function accept() {
    if (!prepared || !acknowledged) return;
    const grant = JSON.parse(prepared.canonical) as AssistantChatAcceptedGrantV1;
    setBusy(true); setError(null);
    try {
      await post(chatUrl, { operation: "accept", turnId: prepared.turnId, digest: prepared.digest, acceptanceRequestId: grant.acceptanceRequestId });
      chooseTurn(prepared.turnId); setAcknowledged(false);
      // This explicit click starts the turn once. No catch/reconnect retries POST.
      await post(chatUrl, { operation: "drive", turnId: prepared.turnId });
    } catch { setError("The reply was lost or refused. Read the retained turn before requesting new work. Possible provider usage remains unknown."); chooseTurn(prepared.turnId); }
    finally { setBusy(false); await refresh(prepared.turnId); }
  }
  async function checkIntent(intentId: string) {
    try {
      // review=true includes a fresh authorized body read. Minimal owner status
      // alone cannot restore review after a disclosure or issuance uncertainty.
      const response = await json<{ status: IntentStatus; review: ChatIntentReview | null }>(`${chatUrl}/intents?intentId=${intentId}&review=true`);
      const status = response.status;
      if (status.intentId !== intentId) throw new Error("Intent status identity changed.");
      setStatuses(old => ({ ...old, [intentId]: status }));
      const unbound = Boolean(response.review && response.review.intentId === intentId && status.state === "proposed" &&
        status.originalApprovalId === null && status.executionState === "not_requested");
      setUncertain(old => ({ ...old, [intentId]: !unbound }));
    }
    catch { setUncertain(old => ({ ...old, [intentId]: true })); setError("Checking the original approval is unavailable. No replacement approval or execution is offered."); }
  }
  async function reviewIntent(intentId: string) {
    setBusy(true); setError(null);
    try {
      const response = await json<{ review: ChatIntentReview | null; status: IntentStatus }>(`${chatUrl}/intents?intentId=${intentId}&review=true`);
      setStatuses(old => ({ ...old, [intentId]: response.status }));
      if (!response.review || response.review.intentId !== intentId || response.status.intentId !== intentId || response.status.state !== "proposed" || response.status.originalApprovalId !== null || response.status.executionState !== "not_requested") return;
      await onReview(response.review);
    } catch (reason) {
      if (!(reason instanceof ChatReviewCancelled)) {
        setUncertain(old => ({ ...old, [intentId]: true }));
        setError(reason instanceof Error ? reason.message : "Check the original approval and result.");
      }
    } finally { setBusy(false); await checkIntent(intentId); if (active) await refresh(active); }
  }
  async function reconcile(intentId: string) {
    setBusy(true);
    try { await post(`${chatUrl}/intents`, { operation: "reconcile", intentId }); }
    catch { setUncertain(old => ({ ...old, [intentId]: true })); setError("The original result remains uncertain. Use approved-submittal recovery."); }
    finally { setBusy(false); await checkIntent(intentId); }
  }
  const grant = prepared ? JSON.parse(prepared.canonical) as AssistantChatAcceptedGrantV1 : null;
  return <section aria-label="Saved API Planner Agent chat" className="min-w-0 rounded-lg border border-white/15 p-3 text-sm text-slate-200">
    <button type="button" aria-expanded={opened} onClick={() => setOpened(v => !v)}>Saved API chat · workspace and selected projects</button>
    {opened ? <div className="mt-3 min-w-0 space-y-3">
      <p>This first profile excludes runs, financial records, documents, history and searches. Installed Codex, Claude Code, OpenCode and the remaining contexts and tools remain unfinished.</p>
      {error ? <p role="alert">{error}</p> : null}
      <button type="button" onClick={() => setShowRecovery(v => !v)}>Read original approved-submittal results</button>
      {showRecovery ? <div><p>This recovery uses original approval permissions, separately from chat-body access.</p><ApprovedSubmittalRecovery workspaceId={workspaceId} /></div> : null}
      {!options.length ? <p role="status">No saved API/model has an admitted chat capability for this installation. Status: unassessed.</p> : null}
      <label className="block">Saved API and model<select aria-label="Saved API and model" value={selected} disabled={busy} className="block w-full bg-slate-900" onChange={e => { setSelected(e.target.value); invalidate(); }}>
        <option value="">Choose an admitted saved API/model</option>{options.map(o => <option key={o.id} value={o.id}>{o.selection.modelId} · {o.selection.endpoint} · {o.selection.authMode}</option>)}</select></label>
      <label className="block">Additional selected project IDs, optional<input aria-label="Additional selected project IDs" className="block w-full bg-slate-900" value={additionalIds} disabled={busy} onChange={e => { setAdditionalIds(e.target.value); invalidate(); }} /></label>
      <label className="flex gap-2"><input type="checkbox" checked={includeIndex} disabled={busy} onChange={e => { setIncludeIndex(e.target.checked); invalidate(); }} />Allow the separate workspace-wide project index, at most 25 names/statuses. Listing does not authorize deeper reads.</label>
      <label className="block">Saved API chat question<textarea aria-label="Saved API chat question" className="block w-full bg-slate-900" maxLength={2000} value={question} disabled={busy} onChange={e => { setQuestion(e.target.value); invalidate(); }} /></label>
      <button type="button" disabled={busy || !selected || !question.trim()} onClick={() => { void prepare(); }}>Preview exact disclosure</button>
      {prepared && grant ? <div aria-label="Exact API chat disclosure" className="space-y-2 border border-white/20 p-2">
        <p>Destination: {grant.selection.endpoint}. Model: {grant.selection.modelId}. Authentication: {grant.selection.authMode}.</p>
        <p>Saved connection {grant.selection.connectionId}, revision {grant.selection.revisionId}. Credential source: {grant.selection.credentialSource.kind}.</p>
        <p>Executing installation {grant.selection.execution.installationId}, pool {grant.selection.execution.poolId}, configuration {grant.selection.execution.poolConfigurationRevision}.</p>
        <p>Cost: unknown. {grant.selection.costDisclosure.reason} A reservation is not a bill. Missing usage stays unknown.</p>
        <p>Disclosed classes: {grant.scope.dataClasses.join(", ")}. History: none. Expires: {grant.expiresAt}.</p>
        <p>Maximum: six model invocations, 2,000 output tokens each, 12 tool calls. This profile cannot approve business actions.</p>
        <p className="whitespace-pre-wrap break-words">Question: {grant.packet.question}</p>
        {grant.packet.initialEnvelopes.map(e => <div key={e.envelopeId}><p>Captured {e.capturedAt}: {e.dataClass}</p><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words">{e.canonicalProjectedContent}</pre></div>)}
        <details><summary>Complete disclosure record</summary><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words">{prepared.canonical}</pre><p className="break-all">Accepted digest: {prepared.digest}</p></details>
        <label className="flex gap-2"><input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} />I accept this exact disclosure and possible unknown provider charges for this selected API/model and installation.</label>
        <button type="button" disabled={busy || !acknowledged} onClick={() => { void accept(); }}>Accept disclosure and start once</button>
      </div> : null}
      {history.length ? <label className="block">Retained chat turns<select aria-label="Retained chat turns" value={active ?? ""} onChange={e => { chooseTurn(e.target.value || null); invalidate(); }} className="block w-full bg-slate-900"><option value="">Choose a retained turn</option>{history.map(t => <option key={t.id} value={t.id}>{t.id} · {t.state}</option>)}</select></label> : null}
      {view ? <div aria-live="polite" className="space-y-2"><p>Status: {view.state}. {view.complete ? "Checked completion retained." : "No complete answer is confirmed."}</p>
        {view.released && view.state === "accepted" && active ? <button type="button" disabled={busy} onClick={() => { setBusy(true); void post(chatUrl, { operation: "drive", turnId: active }).catch(() => setError("Start outcome is uncertain. Read retained status.")).finally(() => setBusy(false)); }}>Start this accepted turn once</button> : null}
        {active ? <button type="button" onClick={() => { void post(chatUrl, { operation: "cancel", turnId: active }).then(() => refresh(active)).catch(() => setError("Cancellation could not be confirmed. Read retained status.")); }}>Cancel further work</button> : null}
        {view.released ? <>
          <p>Reserved model invocations: {view.modelSteps}. Provider-reported output tokens: {view.usageUnknown ? "unknown for at least one step" : view.reportedOutputTokens}. Actual bill: unverified.</p>
          <p>Checked provider responses: {view.checkedResponses ?? 0}. Reservations without a checked response: {view.unconfirmedReservations ?? 0}.</p>
          {view.texts?.map(t => <p key={t.stepId} className="whitespace-pre-wrap break-words">{t.text}</p>)}
          {view.state === "running" ? <p className="whitespace-pre-wrap break-words" aria-label="Partial streamed answer">{view.events?.filter(e => e.kind === "text_delta").map(e => { const b = e.body as { text?: unknown }; return typeof b.text === "string" ? b.text : ""; }).join("")}</p> : null}
          <ol aria-label="Retained tool and model progress">{view.events?.filter(e => !["scope_checked", "text_delta"].includes(e.kind)).map(e => <li key={e.sequence}>{e.sequence}. {e.kind.replace(/_/g, " ")}</li>)}</ol>
          {view.intents?.map(i => { const status = statuses[i.intentId], state = status?.state ?? i.state, bound = Boolean(status?.originalApprovalId ?? i.originalApprovalId);
            const reviewable = view.complete && state === "proposed" && !bound && (status?.executionState ?? i.executionState) === "not_requested" && !uncertain[i.intentId];
            return <div key={i.intentId} className="space-y-2 border border-white/15 p-2"><p>Draft proposal {i.intentId}. State: {state}. Receipt: {status?.receiptState ?? i.receiptState}.</p>
              {reviewable ? <button type="button" disabled={busy} onClick={() => { void reviewIntent(i.intentId); }}>Review exact draft submittal</button> : <p>Recovering the original approval/result. No fresh approval or execution is offered.</p>}
              <button type="button" disabled={busy} onClick={() => { void checkIntent(i.intentId); }}>Check original approval</button>
              <button type="button" disabled={busy || !bound} onClick={() => { void reconcile(i.intentId); }}>Reconcile original result</button>
              <a className="block underline" href={status?.recoveryHref ?? i.recoveryHref}>Open approved-submittal recovery</a>
              {bound ? <><label className="flex gap-2"><input type="checkbox" checked={repeatAcknowledged[i.intentId] ?? false} onChange={e => setRepeatAcknowledged(old => ({ ...old, [i.intentId]: e.target.checked }))} />Request a separate intentional repeat. Prior state: {state}. This can create another record even when the prior result is uncertain.</label>
                <button type="button" disabled={busy || !repeatAcknowledged[i.intentId]} onClick={() => { setBusy(true); repeatRequests.current[i.intentId] ??= crypto.randomUUID(); void post(`${chatUrl}/intents`, { operation: "repeat", intentId: i.intentId, repeatRequestId: repeatRequests.current[i.intentId], acknowledgePossibleDuplicate: true })
                  .then(() => { delete repeatRequests.current[i.intentId]; setRepeatAcknowledged(old => ({ ...old, [i.intentId]: false })); if (active) return refresh(active); }).catch(() => setError("Repeat request is uncertain. Read retained intents before requesting another." )).finally(() => setBusy(false)); }}>Request separate repeat draft</button></> : null}
            </div>; })}
        </> : <p>Source text, answers and draft bodies are withheld. <a href={view.recoveryHref ?? `/assistant-activity?workspaceId=${workspaceId}`} className="underline">Open recovery</a></p>}
      </div> : null}
    </div> : null}
  </section>;
}
