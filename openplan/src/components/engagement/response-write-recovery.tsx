"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { closeLoopEntrySchema, type CloseLoopEntryRow } from "@/lib/engagement/close-loop";
import { clearPendingResponse, readPendingResponse, retainPendingResponse, pendingResponseSchema, preserveUnreadableResponse, type PendingResponse } from "@/lib/engagement/pending-response";
import { readResponseWriteResult, type ResponseWriteIntent, type ResponseWriteResult } from "@/lib/engagement/response-write";

const unknownMessage = "This save is unconfirmed. Your request is retained in this tab. Retry the same save to check its result without creating another response.";

/** Keep result focus near the save unless the user has moved to another control. */
function mayFocusResponseResult(start: Element | null, recovery: HTMLElement | null) {
  const active = document.activeElement;
  return active === document.body || active === start || Boolean(active && recovery?.contains(active));
}

function ResponseCopy({ title, entry }: { title: string; entry: Partial<CloseLoopEntryRow> | null }) {
  return <div className="min-w-0 space-y-2 rounded-lg border border-border p-3 break-words">
    <h4 className="font-semibold">{title}</h4>
    {entry ? <><p>{entry.theme_title}</p><p className="whitespace-pre-wrap"><strong>You said: </strong>{entry.you_said || "Not recorded"}</p>
      <p className="whitespace-pre-wrap"><strong>We did: </strong>{entry.we_did || "Not recorded"}</p>
      <p>Status: {entry.status || "draft"}</p></> : <p>No current response found.</p>}
  </div>;
}

/** One pending write per campaign keeps retries available even after a removed card disappears on reload. */
export function useResponseWrites({ userId, campaignId, onConfirmed, onAbsent, categories, sourceItems }: {
  userId: string; campaignId: string;
  onAbsent: (entryId: string) => void;
  categories: Array<{ id: string; label: string }>;
  sourceItems: Array<{ id: string; title: string }>;
  onConfirmed: (result: ResponseWriteResult, pending: PendingResponse, payload: Record<string, unknown>) => void;
}) {
  const [pending, setPending] = useState<PendingResponse | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const recoveryRef = useRef<HTMLElement>(null);
  const confirmationRef = useRef<HTMLParagraphElement>(null);
  const saveFocus = useRef<Element | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [review, setReview] = useState<CloseLoopEntryRow[] | null>(null);
  const [editedWords, setEditedWords] = useState<{ themeTitle: string; youSaid: string; weDid: string; reason: string; categoryId: string | null; sourceItemIds: string[] } | null>(null);
  const pendingRef = useRef<PendingResponse | null>(null);
  const busyRef = useRef(false);
  const confirmed = useRef(onConfirmed);
  confirmed.current = onConfirmed;

  function remember(value: PendingResponse | null) {
    pendingRef.current = value;
    setPending(value);
  }
  function restore() {
    try {
      const retained = readPendingResponse(window.sessionStorage, userId, campaignId);
      remember(retained);
      setMessage(retained ? retained.phase === "unconfirmed" ? unknownMessage : "The retained change needs review. Compare current saved responses before changing this request." : null);
      setReady(true);
    } catch {
      setReady(false);
      setMessage("This tab's saved recovery record could not be read. Keep this tab open and retry recovery before making another change.");
    }
  }
  function preserveAndReopen() {
    try {
      const archiveKey = preserveUnreadableResponse(window.sessionStorage, userId, campaignId);
      restore();
      setConfirmation(archiveKey ? "The unreadable recovery copy is preserved in this tab. Saved responses have not changed." : "No pending recovery record remains. Saved responses have not changed.");
    } catch {
      setMessage("The recovery copy could not be preserved, or the record changed. Nothing was discarded. Retry recovery before making another change.");
    }
  }
  useEffect(() => {
    restore();
    // The server page keys this editor by user and campaign; each mount has its own recovery scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, campaignId]);

  useEffect(() => {
    if (pending && !busy && mayFocusResponseResult(saveFocus.current, recoveryRef.current)) recoveryRef.current?.focus();
  }, [pending, busy]);
  useEffect(() => {
    if (confirmation && mayFocusResponseResult(saveFocus.current, recoveryRef.current)) confirmationRef.current?.focus();
  }, [confirmation]);

  async function send(value: PendingResponse) {
    if (busyRef.current) return false;
    if (!pendingResponseSchema.safeParse(value).success) {
      setMessage("The response fields are invalid, so no save was sent. Check the title, text lengths, contribution links and change reason; your words remain editable.");
      return false;
    }
    saveFocus.current = document.activeElement;
    busyRef.current = true;
    setBusy(true);
    setConfirmation(null);
    setReview(null);
    setEditedWords(null);
    let retained = value;
    try {
      retained = retainPendingResponse(window.sessionStorage, { ...value, phase: "unconfirmed" });
      remember(retained);
    } catch {
      remember(value);
      setMessage("This tab could not retain the request, so no save was sent. Keep your words here and retry before leaving this page.");
      busyRef.current = false;
      setBusy(false);
      return false;
    }
    try {
      const intent = retained.intent;
      const response = await fetch(`/api/engagement/campaigns/${campaignId}/closeloop${intent.operation === "create" ? "" : `/${intent.entryId}`}`, {
        method: intent.operation === "create" ? "POST" : intent.operation === "update" ? "PATCH" : "DELETE",
        headers: { "content-type": "application/json" }, body: JSON.stringify(intent.body),
        signal: AbortSignal.timeout(30_000),
      });
      const payload: Record<string, unknown> = await response.json();
      if (!response.ok) {
        const phase = response.status === 409 && payload.kind === "conflict" ? "conflict"
          : response.status === 413 || (response.status === 400 && payload.kind === "invalid") ? "rejected"
            : response.status === 404 && payload.kind === "missing" ? "missing" : "unconfirmed";
        const next: PendingResponse = { ...retained, phase };
        remember(next);
        try { retainPendingResponse(window.sessionStorage, next); } catch { /* The original request remains the safe retry. */ }
        setMessage(phase === "unconfirmed" ? unknownMessage : phase === "conflict"
          ? "The saved response or request has changed. Review the current saved copy below; your proposed words are still retained."
          : phase === "missing" ? "The response or campaign was not found. Review saved responses before resolving this request."
            : "This change was refused. Review its fields and linked contributions, then correct the proposed change below.");
        return false;
      }
      const result = readResponseWriteResult(payload, campaignId, intent);
      confirmed.current(result, retained, payload);
      setConfirmation(result.removed ? "Response removed from the current list. Its retained history remains available." : "Response saved.");
      try {
        clearPendingResponse(window.sessionStorage, retained);
        remember(null);
        setMessage(null);
      } catch {
        setMessage("The save is confirmed, but this tab could not clear its retry record. Retrying the same request is safe.");
      }
      return true;
    } catch {
      setMessage(unknownMessage);
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function submit(intent: ResponseWriteIntent, before: CloseLoopEntryRow | null, origin: PendingResponse["origin"]) {
    if (!ready || pendingRef.current || busyRef.current) return false;
    return send({ version: 1, userId, campaignId, intent, before, origin, phase: "unconfirmed" });
  }

  async function loadReview() {
    if (busyRef.current || !pendingRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setReview(null);
    setEditedWords(null);
    try {
      const response = await fetch(`/api/engagement/campaigns/${campaignId}/closeloop`, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error("Response read failed");
      const payload = await response.json();
      const rows = closeLoopEntrySchema.array().parse(payload.entries);
      if (rows.some(row => row.campaign_id !== campaignId) || new Set(rows.map(row => row.id)).size !== rows.length) throw new Error("Invalid response scope");
      setReview(rows);
      const p = pendingRef.current;
      const fields: Partial<Extract<ResponseWriteIntent, { operation: "update" }>["body"]> = p.intent.operation === "remove" ? {} : p.intent.body;
      setEditedWords({
        themeTitle: fields.themeTitle ?? p.before?.theme_title ?? "",
        youSaid: fields.youSaid ?? p.before?.you_said ?? "",
        weDid: fields.weDid ?? p.before?.we_did ?? "",
        categoryId: "categoryId" in fields ? fields.categoryId ?? null : p.before?.category_id ?? null,
        sourceItemIds: fields.sourceItemIds ?? p.before?.source_item_ids ?? [],
        reason: p.intent.operation === "create" ? "" : p.intent.body.reason,
      });
    } catch {
      setMessage("Current saved responses could not be read completely. Your pending words are unchanged; retry this review.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function saveReviewed() {
    const p = pendingRef.current;
    if (!p || !review || busyRef.current || p.phase === "unconfirmed") return;
    const intent = p.intent;
    const current = intent.operation === "create" ? null : review.find(row => row.id === intent.entryId) ?? null;
    if (intent.operation !== "create" && !current) return;
    const requestId = crypto.randomUUID();
    let next: ResponseWriteIntent;
    if (intent.operation === "create") {
      if (!editedWords) return;
      const { reason: _reason, ...words } = editedWords;
      void _reason;
      next = { operation: "create", body: { ...intent.body, ...words, requestId } };
    } else if (intent.operation === "update") {
      if (!editedWords || !current) return;
      // Rebase only the fields the original edit proposed, plus deliberate text corrections made during review.
      const words: Partial<Extract<ResponseWriteIntent, { operation: "update" }>["body"]> = {};
      for (const [key, column] of [["themeTitle", "theme_title"], ["youSaid", "you_said"], ["weDid", "we_did"]] as const) {
        const previous = intent.body[key] ?? p.before?.[column] ?? "";
        if (key in intent.body || editedWords[key] !== previous) words[key] = editedWords[key];
      }
      const proposedCategory = "categoryId" in intent.body ? intent.body.categoryId ?? null : p.before?.category_id ?? null;
      if ("categoryId" in intent.body || editedWords.categoryId !== proposedCategory) words.categoryId = editedWords.categoryId;
      if ("sourceItemIds" in intent.body || JSON.stringify(editedWords.sourceItemIds) !== JSON.stringify(intent.body.sourceItemIds ?? p.before?.source_item_ids ?? [])) words.sourceItemIds = editedWords.sourceItemIds;
      next = { ...intent, body: { ...intent.body, ...words, reason: editedWords.reason, requestId, expectedUpdatedAt: current.updated_at } };
    } else {
      if (!editedWords || !current) return;
      next = { ...intent, body: { ...intent.body, reason: editedWords.reason, requestId, expectedUpdatedAt: current.updated_at } };
    }
    await send({ ...p, intent: next, before: current, phase: "unconfirmed" });
  }

  function dismissAbsent() {
    const p = pendingRef.current;
    if (!p || !review || busyRef.current || p.phase === "unconfirmed") return;
    const intent = p.intent;
    if (intent.operation === "create" || review.some(row => row.id === intent.entryId)) return;
    try {
      clearPendingResponse(window.sessionStorage, p);
      onAbsent(intent.entryId);
      remember(null);
      setMessage(null);
    } catch {
      setMessage("This tab could not clear the pending record. Keep it open and retry.");
    }
  }

  const intent = pending?.intent;
  const proposed: Partial<CloseLoopEntryRow> | null = pending ? {
    ...pending.before,
    ...(intent?.operation !== "remove" ? {
      theme_title: intent?.body.themeTitle ?? pending.before?.theme_title,
      you_said: intent?.body.youSaid ?? pending.before?.you_said,
      we_did: intent?.body.weDid ?? pending.before?.we_did,
      status: intent?.body.status ?? pending.before?.status,
    } : {}),
  } : null;
  const current = intent && intent.operation !== "create" ? review?.find(row => row.id === intent.entryId) ?? null : null;
  const recovery = <>
    {confirmation && <p ref={confirmationRef} tabIndex={-1} role="status" className="mt-4 rounded-lg border border-border p-3 text-sm">{confirmation}</p>}
    {ready && !pending && message && <p role="alert" className="mt-4 rounded-lg border border-amber-300 p-3 text-sm">{message}</p>}
    {!ready && <div role="alert" className="mt-4 space-y-2 rounded-lg border border-amber-300 p-3">
      <p>{message || "Checking this tab for an unfinished save…"}</p>
      <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={restore}>Retry recovery</Button>
      <Button type="button" variant="outline" onClick={preserveAndReopen}>Preserve unreadable copy and reopen editor</Button></div>
    </div>}
    {pending && <section ref={recoveryRef} tabIndex={-1} aria-label="Pending response change" className="mt-4 space-y-3 rounded-lg border border-amber-300 p-3 text-sm">
      <h3 className="font-semibold">{pending.intent.operation === "remove" ? "Pending removal" : "Pending response change"}</h3>
      <p role="alert">{message || unknownMessage}</p>
      <p>Keep this tab open. The request survives a reload in this tab; closing the tab may remove its recovery copy.</p>
      <ResponseCopy title={pending.intent.operation === "remove" ? "Response you asked to remove" : "Your proposed response"} entry={proposed} />
      {pending.intent.operation !== "create" && <p className="whitespace-pre-wrap"><strong>Reason: </strong>{pending.intent.body.reason}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => void send(pending)} disabled={busy}>Retry same save</Button>
        {pending.phase !== "unconfirmed" && <Button type="button" variant="outline" onClick={() => void loadReview()} disabled={busy}>Review current saved responses</Button>}
      </div>
      {review && <div className="space-y-3">
        {pending.intent.operation === "create" ? <><p>Review the {review.length} saved responses before creating a separate response. The earlier request may already refer to a saved response.</p>
          <div className="max-h-72 space-y-2 overflow-y-auto">{review.map(row => <ResponseCopy key={row.id} title="Saved response" entry={row} />)}</div></>
          : <div className="grid gap-3 md:grid-cols-2"><ResponseCopy title="Copy you started from" entry={pending.before} /><ResponseCopy title="Current saved copy" entry={current} /></div>}
        {editedWords && (current || pending.intent.operation === "create") && <div className="space-y-2">
          {([['themeTitle', 'Reviewed theme'], ['youSaid', 'Reviewed you said'], ['weDid', 'Reviewed we did'], ['reason', 'Reason for reviewed change']] as const)
            .filter(([key]) => pending.intent.operation === "remove" ? key === "reason" : key !== "reason" || pending.intent.operation !== "create")
            .map(([key, label]) => <label className="block space-y-1" key={key}><span>{label}</span>
              <Textarea value={editedWords[key]} maxLength={key === "themeTitle" ? 200 : key === "reason" ? 2000 : 5000} onChange={event => setEditedWords({ ...editedWords, [key]: event.target.value })} />
            </label>)}
          {pending.intent.operation !== "remove" && <>
            <label className="block space-y-1"><span>Reviewed theme tag</span>
              <select className="w-full rounded-lg border border-input bg-background p-2" value={editedWords.categoryId ?? ""} onChange={event => setEditedWords({ ...editedWords, categoryId: event.target.value || null })}>
                <option value="">No tag</option>
                {editedWords.categoryId && !categories.some(category => category.id === editedWords.categoryId) && <option value={editedWords.categoryId}>Proposed tag, unavailable in the loaded list</option>}
                {categories.map(category => <option key={category.id} value={category.id}>{category.label}</option>)}
              </select>
            </label>
            <label className="block space-y-1"><span>Reviewed contributions addressed</span>
              <select multiple className="w-full rounded-lg border border-input bg-background p-2" value={editedWords.sourceItemIds} onChange={event => setEditedWords({ ...editedWords, sourceItemIds: Array.from(event.target.selectedOptions, option => option.value) })}>
                {editedWords.sourceItemIds.filter(id => !sourceItems.some(item => item.id === id)).map(id => <option key={id} value={id}>Retained contribution {id}</option>)}
                {sourceItems.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
              </select>
            </label>
          </>}
        </div>}
        {(current || pending.intent.operation === "create") ? <Button type="button" onClick={() => void saveReviewed()} disabled={busy || (editedWords !== null && (!editedWords.themeTitle.trim() || (pending.intent.operation !== "create" && !editedWords.reason.trim())))}>
          {pending.intent.operation === "create" ? "Create a separate response after review" : pending.intent.operation === "remove" ? "Remove the reviewed current response" : "Save reviewed change"}
        </Button> : <div className="space-y-2"><p>The current list no longer contains this response. Its retained history remains available. This does not confirm who removed it.</p><Button type="button" variant="outline" onClick={dismissAbsent} disabled={busy}>Dismiss pending change to the absent response</Button></div>}
      </div>}
    </section>}
  </>;
  return { pending, ready, busy, submit, recovery };
}
