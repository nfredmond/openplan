"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { readResponseLinkChoices, readSynthesisResponseLinkIndex } from "@/lib/engagement/synthesis-response-index";
import { readResponseLinkContextPreview, readResponseLinkHistoryDisplay, type ResponseLinkContextPreview, type ResponseLinkHistoryDisplay } from "@/lib/engagement/synthesis-response-link-reader";
import { emptyResponseLinkWorkingCopy, freezeResponseLinkRequest, listPreservedResponseLinkCopies, preserveResponseLinkWorkingCopy,
  readResponseLinkWorkingCopy, sendResponseLinkRequest, writeResponseLinkWorkingCopy, ResponseLinkSaveError,
  type ResponseLinkClientScope, type ResponseLinkWorkingCopy } from "@/lib/engagement/synthesis-response-link-recovery";

type Address = { responseId: string; groupId: string };
type Props = { scope: ResponseLinkClientScope; revision: { id: string; number: number; sha256: string };
  groups: Array<{ id: string; label: string }>; hasUnsavedReview: boolean; memory: { current: ResponseLinkWorkingCopy | null }; onAccessLost: () => void };
const packet = z.object({ context: z.unknown() }).strict(), historyPacket = z.object({ history: z.unknown() }).strict(), indexPacket = z.object({ index: z.unknown() }).strict();
const buttonClass = "h-auto min-h-10 max-w-full whitespace-normal";
const sameAddress = (left: Address | null, right: Address | null) => Boolean(left && right && left.responseId === right.responseId && left.groupId === right.groupId);
const message = (cause: unknown) => cause instanceof Error ? cause.message : "The response link is unconfirmed. Keep its exact request for retry.";

/** Scope changes clear private presentation; durable commands retain their original actor and evidence identities. */
export function SynthesisResponseLinksPanel(props: Props) {
  const s = props.scope;
  return <LinkPanel key={`${s.userId}:${s.workspaceId}:${s.campaignId}:${s.reviewId}`} {...props} />;
}
function LinkPanel({ scope, revision, groups, hasUnsavedReview, memory, onAccessLost }: Props) {
  const { userId, workspaceId, campaignId, reviewId } = scope;
  const [working, setWorking] = useState(() => emptyResponseLinkWorkingCopy(scope));
  const workingRef = useRef(working), epoch = useRef(0), reading = useRef(0), listing = useRef(0), sending = useRef(false);
  const selectedRef = useRef<Address | null>(null);
  const [ready, setReady] = useState(false), [blocked, setBlocked] = useState(false), [busy, setBusy] = useState(false), [accessLost, setAccessLost] = useState(false);
  const [selected, setSelected] = useState<Address | null>(null), [responseId, setResponseId] = useState(""), [groupId, setGroupId] = useState("");
  const [index, setIndex] = useState<ReturnType<typeof readSynthesisResponseLinkIndex> | null>(null);
  const [choices, setChoices] = useState<ReturnType<typeof readResponseLinkChoices> | null>(null);
  const [history, setHistory] = useState<ResponseLinkHistoryDisplay | null>(null), [preview, setPreview] = useState<ResponseLinkContextPreview | null>(null);
  const [error, setError] = useState<string | null>(null), [contextError, setContextError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [copies, setCopies] = useState<ReturnType<typeof listPreservedResponseLinkCopies>>([]);
  const endpoint = `/api/engagement/campaigns/${campaignId}/synthesis/response-links`;
  const adopt = (value: ResponseLinkWorkingCopy) => { workingRef.current = value; setWorking(value); };
  const loseAccess = useCallback(() => {
    epoch.current++; memory.current = null; setIndex(null); setChoices(null); setHistory(null); setPreview(null); setNotice(null); setAccessLost(true); onAccessLost();
  }, [memory, onAccessLost]);
  const read = useCallback(async (mode: string, address?: Address) => {
    const res = await fetch(`${endpoint}?${new URLSearchParams({ mode, reviewId, ...address })}`, { cache: "no-store",
      headers: { "x-openplan-expected-user": userId, "x-openplan-expected-workspace": workspaceId } });
    if (res.status === 401 || res.status === 403) { throw new ResponseLinkSaveError(res.status, "Current staff access is required. Reopen the campaign."); }
    if (!res.ok) throw new ResponseLinkSaveError(res.status, mode === "context"
      ? "Current approved evidence is unavailable. Retained history can still be inspected and an active link can be withdrawn."
      : "Response links could not be read. Keep any pending command and retry the read.");
    return res.json() as Promise<unknown>;
  }, [endpoint, reviewId, userId, workspaceId]);
  const reloadLists = useCallback(async () => {
    const current = epoch.current, sequence = ++listing.current; setIndex(null); setChoices(null);
    try {
      const address = { campaignId, workspaceId, reviewId };
      const [indexRaw, choicesRaw] = await Promise.all([read("index"), read("responses")]);
      const nextIndex = readSynthesisResponseLinkIndex(indexPacket.parse(indexRaw).index, address), nextChoices = readResponseLinkChoices(choicesRaw, address);
      if (current !== epoch.current || sequence !== listing.current) return;
      setIndex(nextIndex); setChoices(nextChoices);
    } catch (cause) {
      if (current !== epoch.current || sequence !== listing.current) return;
      if (cause instanceof ResponseLinkSaveError && (cause.status === 401 || cause.status === 403)) loseAccess();
      else setError(message(cause));
    }
  }, [read, campaignId, workspaceId, reviewId, loseAccess]);
  const open = useCallback(async (input: Address) => {
    const address = { responseId: input.responseId, groupId: input.groupId };
    const current = epoch.current, sequence = ++reading.current;
    selectedRef.current = address; setSelected(address); setResponseId(address.responseId); setGroupId(address.groupId);
    setHistory(null); setPreview(null); setContextError(null); setError(null);
    const expected = { campaignId, workspaceId, reviewId, ...address };
    const [saved, currentContext] = await Promise.allSettled([
      read("history", address).then(raw => readResponseLinkHistoryDisplay(historyPacket.parse(raw).history, expected)),
      read("context", address).then(raw => readResponseLinkContextPreview(packet.parse(raw).context, expected)),
    ]);
    if (current !== epoch.current || sequence !== reading.current) return;
    if ([saved, currentContext].some(result => result.status === "rejected" && result.reason instanceof ResponseLinkSaveError && [401, 403].includes(result.reason.status))) { loseAccess(); return; }
    if (saved.status === "fulfilled") setHistory(saved.value); else setError(message(saved.reason));
    if (currentContext.status === "fulfilled") setPreview(currentContext.value); else setContextError(message(currentContext.reason));
  }, [read, campaignId, workspaceId, reviewId, loseAccess]);
  useEffect(() => () => { epoch.current++; }, []);
  useEffect(() => {
    const currentScope = { userId, workspaceId, campaignId, reviewId };
    const restore = () => {
      const unsaved = memory.current;
      try {
        const stored = readResponseLinkWorkingCopy(localStorage, currentScope); adopt(stored); setBlocked(Boolean(unsaved)); setStorageError(null);
        setCopies(listPreservedResponseLinkCopies(localStorage, currentScope));
        if (unsaved) { setWorking(unsaved); setStorageError("The latest response-link reason could not be stored. Preserve or copy it before continuing."); }
        const address = selectedRef.current ?? unsaved?.draft ?? stored.draft;
        if (address) void open({ responseId: address.responseId, groupId: address.groupId });
      } catch (cause) { if (unsaved) setWorking(unsaved); setBlocked(true); setStorageError(message(cause)); }
      setReady(true); void reloadLists();
    };
    restore(); window.addEventListener("storage", restore);
    return () => { window.removeEventListener("storage", restore); };
  }, [userId, workspaceId, campaignId, reviewId, memory, open, reloadLists]);
  function update(next: ResponseLinkWorkingCopy) {
    try { adopt(writeResponseLinkWorkingCopy(localStorage, workingRef.current, next)); memory.current = null; setBlocked(false); setStorageError(null); return true; }
    catch (cause) { memory.current = next; setWorking(next); setBlocked(true); setStorageError(message(cause)); return false; }
  }
  const draftHere = sameAddress(working.draft, selected), otherDraft = Boolean(working.draft && !draftHere);
  const reason = draftHere ? working.draft!.reason : "", head = history?.head;
  const currentRevision = preview && preview.context.revision.id === revision.id && preview.context.revision.number === revision.number && preview.context.revision.contentSha256 === revision.sha256;
  const sameContext = head && head.intent.operation !== "withdraw" && preview?.packet.contextSha256 === head.context.contextSha256;
  const canEdit = ready && !blocked && !busy && !working.pending && !otherDraft;
  async function send(operation?: "link" | "refresh" | "withdraw") {
    if (sending.current || !ready || blocked) return;
    const current = epoch.current; sending.current = true; setBusy(true); setError(null); setNotice(null);
    try {
      let retained = workingRef.current;
      if (!retained.pending) {
        if (!operation || !selected || !history || !retained.draft || !sameAddress(retained.draft, selected)) throw new Error("Inspect this response link and retain a reason first.");
        if (operation === "withdraw") {
          if (!head || head.intent.operation === "withdraw") throw new Error("There is no active link to withdraw.");
        } else if (!preview || !currentRevision || hasUnsavedReview || sameContext) throw new Error("Open the current approved review and inspect changed response evidence before saving.");
        const intent = { campaignId, workspaceId, reviewId, actorId: userId, ...selected, requestId: crypto.randomUUID(), operation, reason: retained.draft.reason,
          predecessorId: head?.intent.requestId ?? null, predecessorSha256: head?.eventSha256 ?? null,
          expectedContextSha256: operation === "withdraw" ? null : preview!.packet.contextSha256 };
        retained = freezeResponseLinkRequest(localStorage, retained, intent); adopt(retained);
      }
      const result = await sendResponseLinkRequest(localStorage, retained);
      if (current !== epoch.current) return;
      adopt(result.working); memory.current = null;
      setNotice(result.cleanupError ?? `Response link saved${result.receipt.replayed ? " from its original request" : ""}. Event ${result.receipt.event.eventNo}.`);
      void reloadLists(); const address = selectedRef.current; if (address) void open(address);
    } catch (cause) {
      if (current !== epoch.current) return;
      if (cause instanceof ResponseLinkSaveError && (cause.status === 401 || cause.status === 403)) loseAccess();
      else setError(message(cause));
    } finally { sending.current = false; if (current === epoch.current) setBusy(false); }
  }
  function preserve() {
    try {
      preserveResponseLinkWorkingCopy(localStorage, scope, memory.current ?? working); memory.current = null;
      adopt(readResponseLinkWorkingCopy(localStorage, scope)); setCopies(listPreservedResponseLinkCopies(localStorage, scope)); setBlocked(false); setError(null); setStorageError(null);
      setNotice("Response-link recovery copies preserved below. Inspect current evidence before starting another command.");
    } catch (cause) { setStorageError(message(cause)); }
  }
  if (accessLost) return <p role="alert">Current staff access is required. Reopen the consultation to inspect response links.</p>;
  return <section aria-label="Response links for this staff review" className="min-w-0 space-y-3 rounded border p-3">
    <h5 className="font-semibold">Response links</h5>
    <p className="text-sm">Link a reviewed group to a staff response. This private record preserves the evidence and reason; it does not publish a response or authorize a decision.</p>
    {storageError ? <p role="alert" className="break-words">{storageError}</p> : null}
    {error ? <p role="alert" className="break-words">{error}</p> : null}{notice ? <p role="status" className="break-words">{notice}</p> : null}
    <Button type="button" variant="outline" className={buttonClass} disabled={busy} onClick={() => void reloadLists()}>Refresh response choices and links</Button>
    {choices ? <div className="grid gap-3 sm:grid-cols-2">
      <label className="min-w-0">Response to link<select className="mt-1 block min-h-10 w-full min-w-0 rounded border p-2" value={responseId} disabled={busy} onChange={event => setResponseId(event.target.value)}><option value="">Select a saved response</option>{responseId && !choices.responses.some(row => row.id === responseId) ? <option value={responseId}>Retained response {responseId.slice(0, 8)}</option> : null}{choices.responses.map(row => <option key={row.id} value={row.id}>{row.theme_title || row.id}</option>)}</select></label>
      <label className="min-w-0">Reviewed group<select className="mt-1 block min-h-10 w-full min-w-0 rounded border p-2" value={groupId} disabled={busy} onChange={event => setGroupId(event.target.value)}><option value="">Select a reviewed group</option>{groupId && !groups.some(row => row.id === groupId) ? <option value={groupId}>Retained group {groupId}</option> : null}{groups.map(row => <option key={row.id} value={row.id}>{row.label}</option>)}</select></label>
      <Button type="button" variant="outline" className={buttonClass} disabled={busy || !responseId || !groupId} onClick={() => void open({ responseId, groupId })}>Inspect response link</Button>
    </div> : <p>Current response choices are unavailable until this read succeeds.</p>}
    {index ? <div><h6 className="font-medium">Retained response links</h6>{index.entries.length === 0 ? <p>No links have been retained for this review.</p> : <ul className="space-y-2">{index.entries.map(row => <li key={`${row.responseId}:${row.groupId}`}><Button type="button" variant="outline" className={buttonClass} disabled={busy} onClick={() => void open(row)}>Open link: {choices?.responses.find(value => value.id === row.responseId)?.theme_title || `retained response ${row.responseId.slice(0, 8)}`} / {groups.find(value => value.id === row.groupId)?.label || `retained group ${row.groupId}`}</Button></li>)}</ul>}</div> : null}
    {selected ? <div className="space-y-3">
      <p className="break-all text-xs">Response {selected.responseId}; group {selected.groupId}</p>
      {contextError ? <p className="break-words">{contextError}</p> : null}
      {preview ? <div className="space-y-2"><h6 className="font-medium">Current approved evidence</h6><ContextPreview value={preview} />{!currentRevision ? <p>Open the current staff review revision before saving a new link.</p> : null}{hasUnsavedReview ? <p>Save or preserve unfinished review edits before linking evidence.</p> : null}{sameContext ? <p>The active link already retains this evidence.</p> : null}</div> : null}
      {otherDraft ? <p>An unfinished reason belongs to another response or group. Inspect that link or preserve the recovery copy before starting another.</p> : null}
      <label className="block">Reason for this response link<textarea className="mt-1 block min-h-24 w-full rounded border p-2" value={reason} disabled={!canEdit} onChange={event => update({ ...workingRef.current, draft: { ...selected, reason: event.target.value } })} /></label>
      <div className="flex flex-wrap gap-2"><Button type="button" className={buttonClass} disabled={!canEdit || !history || !preview || !currentRevision || hasUnsavedReview || Boolean(sameContext) || !reason.trim()} onClick={() => void send(head ? "refresh" : "link")}>{head ? "Save updated response link" : "Save response link"}</Button>
        <Button type="button" variant="outline" className={buttonClass} disabled={!canEdit || !head || head.intent.operation === "withdraw" || !reason.trim()} onClick={() => void send("withdraw")}>Withdraw response link</Button></div>
      {history ? <div><h6 className="font-medium">Response-link history</h6>{history.entries.length === 0 ? <p>No retained events for this response and group.</p> : history.entries.map(row => <details className="mt-2 min-w-0 rounded border p-2" key={row.intent.requestId}><summary className="break-words">Event {row.eventNo}: {row.intent.operation} · {row.preview.group.label}</summary><p className="whitespace-pre-wrap break-words">Reason: {row.intent.reason}</p><ContextPreview value={row.preview} /><p className="break-all text-xs">Event SHA256: {row.eventSha256}</p></details>)}</div> : <p>Complete link history is unavailable. New changes remain disabled.</p>}
    </div> : null}
    {working.pending ? <div className="space-y-2"><p className="break-words">Unconfirmed response-link request. Keep its original identity when retrying.</p><pre className="whitespace-pre-wrap break-all text-xs">{JSON.stringify(working.pending, null, 2)}</pre><Button type="button" className={buttonClass} disabled={busy || blocked || !ready} onClick={() => void send()}>Retry exact response-link request</Button></div> : null}
    {working.draft || working.pending || blocked ? <div className="space-y-2"><Button type="button" variant="outline" className={buttonClass} disabled={busy} onClick={preserve}>Preserve response-link copy and start another</Button>{working.draft ? <pre className="whitespace-pre-wrap break-words text-xs">Latest retained or on-screen reason: {working.draft.reason}</pre> : null}</div> : null}
    {copies.length ? <div aria-label="Preserved response-link copies"><h6 className="font-medium">Preserved browser copies</h6>{copies.map(copy => <details key={copy.key}><summary>Preserved response-link command or reason</summary><pre className="whitespace-pre-wrap break-all text-xs">{copy.raw}</pre>{copy.value ? <Button type="button" variant="outline" className={buttonClass} disabled={busy || blocked || Boolean(working.draft || working.pending)} onClick={() => { if (update(copy.value!) && copy.value!.draft) void open(copy.value!.draft); }}>Restore preserved response-link copy</Button> : null}</details>)}</div> : null}
  </section>;
}
function ContextPreview({ value }: { value: ResponseLinkContextPreview }) {
  return <div className="min-w-0 space-y-1 text-sm"><p className="break-words">Review revision {value.context.revision.number}: {value.content.title}</p><p className="whitespace-pre-wrap break-words">{value.group.label}: {value.group.summary || "No group summary."}</p><p>{value.group.sourceIds.length} retained contribution references.</p><p className="whitespace-pre-wrap break-words">Response: {value.response.theme_title}</p><p className="whitespace-pre-wrap break-words">You said: {value.response.you_said}</p><p className="whitespace-pre-wrap break-words">We did: {value.response.we_did}</p><p className="break-all text-xs">Context SHA256: {value.packet.contextSha256}</p></div>;
}
