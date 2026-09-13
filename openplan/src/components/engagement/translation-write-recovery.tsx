"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { archivePendingTranslation, clearPendingTranslation, confirmPendingTranslation, pendingTranslationKey, pendingTranslationSchema,
  readPendingTranslations, retainPendingTranslation, type PendingTranslation } from "@/lib/engagement/pending-translation";
import { readTranslationSnapshot, translationSnapshotSource, type TranslationSnapshot } from "@/lib/engagement/translation-snapshot";
import type { TranslationWriteResult } from "@/lib/engagement/translation-write";

const unknownMessage = "This translation request is unconfirmed. Its exact words and observed versions are retained in this browser. Retry the same request to check its result.";

function downloadCopy(raw: string, name: string) {
  const url = URL.createObjectURL(new Blob([raw], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function EarlierRequest({ raw }: { raw: string }) {
  let value: PendingTranslation | null = null;
  try { value = pendingTranslationSchema.parse(JSON.parse(raw)); } catch { /* Preserve unreadable bytes for download. */ }
  if (!value) return <p>This earlier copy could not be read. Download it to retain its original contents.</p>;
  return <div className="space-y-2 break-words"><p>{value.intent.operation} in {value.intent.locale}. Reason: {value.intent.reason || "New wording"}</p>
      {value.intent.entries.map((entry, index) => <div key={index} className="whitespace-pre-wrap">
        <p><strong>Source at the time: </strong>{entry.expectedSource.text ?? "Not recorded"}</p>
        <p><strong>Earlier saved copy: </strong>{value.before[index]?.entry.translated_text ?? "No saved translation"}</p>
        <p><strong>Requested wording: </strong>{"text" in entry ? entry.text : value.before[index]?.entry.translated_text}</p>
      </div>)}
    </div>;
}

/** Retain requests before sending; a lost acknowledgement never invents a new request identity. */
export function useTranslationWrites({ userId, workspaceId, campaignId, canWrite, onConfirmed, onReopen }: {
  userId: string; workspaceId: string; campaignId: string; canWrite: boolean;
  onConfirmed: (result: TranslationWriteResult, pending: PendingTranslation) => void;
  onReopen: (pending: PendingTranslation | null, snapshot: TranslationSnapshot) => void;
}) {
  const [pending, setPending] = useState<PendingTranslation[]>([]);
  const [unreadable, setUnreadable] = useState<string[]>([]);
  const [archives, setArchives] = useState<Array<{ key: string; raw: string }>>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [review, setReview] = useState<{ requestId: string; snapshot: TranslationSnapshot } | null>(null);
  const pendingRef = useRef<PendingTranslation[]>([]);
  const volatile = useRef(new Map<string, PendingTranslation>());
  const busyRef = useRef(false);
  const recoveryRef = useRef<HTMLElement>(null);
  const focusStart = useRef<Element | null>(null);
  const callbacks = useRef({ onConfirmed, onReopen }); callbacks.current = { onConfirmed, onReopen };

  function remember(values: PendingTranslation[]) { pendingRef.current = values; setPending(values); }
  function restore() {
    try {
      const storage = window.localStorage;
      const loaded = readPendingTranslations(storage, userId, campaignId, workspaceId);
      const values = new Map(loaded.pending.map(value => [value.intent.requestId, value]));
      for (const [key, value] of volatile.current) if (!values.has(key)) values.set(key, value);
      remember([...values.values()]); setUnreadable(loaded.unreadableKeys);
      const prefix = `openplan:translation-archive:${encodeURIComponent(userId)}:${encodeURIComponent(campaignId)}:`;
      const retained = [];
      for (let index = 0; index < storage.length; index++) {
        const key = storage.key(index); if (!key?.startsWith(prefix)) continue;
        const raw = storage.getItem(key); if (raw !== null) retained.push({ key, raw });
      }
      setArchives(retained); setReady(true);
    } catch {
      setReady(false); setMessage("This browser's translation recovery records could not be read. Keep this page open and retry recovery before making another change.");
    }
  }
  useEffect(() => {
    restore();
    const changed = () => restore();
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
    // The page keys the panel by user, workspace and campaign.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, workspaceId, campaignId]);
  useEffect(() => {
    const active = document.activeElement;
    if (!busy && (pending.length || confirmation) && (active === document.body || active === focusStart.current || recoveryRef.current?.contains(active))) recoveryRef.current?.focus();
  }, [pending, confirmation, busy]);

  async function send(value: PendingTranslation) {
    if (busyRef.current || !canWrite) return false;
    const parsed = pendingTranslationSchema.safeParse(value);
    if (!parsed.success || value.userId !== userId || value.workspaceId !== workspaceId || value.campaignId !== campaignId) {
      setMessage("No translation was sent. Review the words, observed source and saved versions, and provide a reason for changing saved wording."); return false;
    }
    focusStart.current = document.activeElement; busyRef.current = true; setBusy(true); setConfirmation(null); setReview(null);
    let retained: PendingTranslation = { ...parsed.data, phase: "unconfirmed" };
    try {
      try {
        retained = retainPendingTranslation(window.localStorage, retained);
        volatile.current.delete(retained.intent.requestId);
        restore();
      } catch {
        volatile.current.set(retained.intent.requestId, retained);
        remember([...pendingRef.current.filter(row => row.intent.requestId !== retained.intent.requestId), retained]);
        setMessage("This browser could not retain the request, so no save was sent. Keep this page open, download your copy, and retry when storage is available.");
        return false;
      }
      const response = await fetch(`/api/engagement/campaigns/${campaignId}/translations/commands`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(retained.intent), signal: AbortSignal.timeout(30_000),
      });
      const body = await response.json();
      if (!response.ok) {
        const phase = response.status === 409 && body?.kind === "conflict" ? "conflict"
          : response.status === 413 || response.status === 400 && body?.kind === "invalid" ? "rejected" : "unconfirmed";
        const next: PendingTranslation = { ...retained, phase };
        try { retainPendingTranslation(window.localStorage, next); } catch { /* The original remains a safe retry. */ }
        remember(pendingRef.current.map(row => row.intent.requestId === next.intent.requestId ? next : row));
        setMessage(phase === "unconfirmed" ? unknownMessage : "The change was refused. Your proposed words are retained. Review the current saved copy before reopening the editor.");
        return false;
      }
      const result = confirmPendingTranslation(body, retained);
      callbacks.current.onConfirmed(result, retained);
      setConfirmation(result.operation === "withdraw" ? "Translation withdrawn. Its earlier words remain in private history." : "Translation request confirmed. Refreshing the saved copy.");
      try { clearPendingTranslation(window.localStorage, retained); restore(); setMessage(null); }
      catch { setMessage("The request is confirmed, but this browser could not clear its recovery record. Retrying the same request is safe."); }
      return true;
    } catch { setMessage(unknownMessage); return false; }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function submit(value: PendingTranslation) {
    if (!ready || unreadable.length || pendingRef.current.length || busyRef.current) return false;
    // Refresh the queue immediately before a new request; another tab may have added one.
    try {
      const current = readPendingTranslations(window.localStorage, userId, campaignId, workspaceId);
      if (current.pending.length || current.unreadableKeys.length) { restore(); return false; }
    } catch { restore(); return false; }
    return send(value);
  }
  async function loadReview(requestId: string) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setReview(null);
    try {
      const response = await fetch(`/api/engagement/campaigns/${campaignId}/translations/snapshot`, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error("Snapshot unavailable");
      const data = await response.json();
      setReview({ requestId, snapshot: readTranslationSnapshot(data.snapshot, campaignId) });
      setMessage(null);
    } catch { setMessage("Current translations could not be read completely. The retained request is unchanged; retry the review."); }
    finally { busyRef.current = false; setBusy(false); }
  }
  function reopen(value: PendingTranslation | null, key: string) {
    if (busyRef.current || !review || review.requestId !== (value?.intent.requestId ?? key) || value?.phase === "unconfirmed") return;
    try {
      archivePendingTranslation(window.localStorage, key, userId, campaignId);
      volatile.current.delete(value?.intent.requestId ?? ""); restore(); setReview(null);
      callbacks.current.onReopen(value, review.snapshot); setMessage(null);
      setConfirmation("The earlier request is preserved under Earlier translation requests. Review the refreshed source and enter a reason before sending a new change.");
    } catch { setMessage("The earlier copy could not be preserved, or changed during archiving. It was not discarded. Retry recovery."); }
  }

  const recovery = <section ref={recoveryRef} tabIndex={-1} aria-label="Translation save recovery" className="mt-4 space-y-3 text-sm">
    {confirmation && <p role="status">{confirmation}</p>}
    {message && <p role="alert" className="rounded-lg border border-amber-400 p-3">{message}</p>}
    {!ready && <Button className="h-auto min-h-10 min-w-0 max-w-full whitespace-normal" type="button" onClick={restore} disabled={busy}>Retry translation recovery</Button>}
    {pending.map(value => <section key={value.intent.requestId} aria-label="Pending translation change" className="space-y-3 rounded-lg border border-amber-400 p-3">
      <h3 className="font-semibold">Pending {value.intent.operation} in {value.intent.locale}</h3>
      <p>{volatile.current.has(value.intent.requestId) ? "This request has not been sent or retained. Keep this page open and download its copy before leaving." : value.phase === "unconfirmed" ? unknownMessage : "This request was refused. Compare the retained and current copies before proposing another change."}</p>
      <p className="whitespace-pre-wrap">Reason: {value.intent.reason || "New wording"}</p>
      {value.intent.entries.map((entry, index) => {
        const current = review?.requestId === value.intent.requestId ? review.snapshot : null;
        const saved = current?.translations.find(row => row.entity_type === entry.entityType && row.entity_id === entry.entityId && row.field === entry.field && row.locale === value.intent.locale);
        const source = current && translationSnapshotSource(current, entry);
        return <div key={`${entry.entityType}:${entry.entityId}:${entry.field}`} className="space-y-2 rounded-lg border border-border p-3 break-words">
          <h4 className="font-semibold">{entry.field.replaceAll("_", " ")}</h4>
          <p className="whitespace-pre-wrap"><strong>Source you saw: </strong>{entry.expectedSource.text ?? "No source words"}</p>
          <p className="whitespace-pre-wrap"><strong>Copy you started from: </strong>{value.before[index]?.entry.translated_text ?? "No saved translation"}</p>
          <p className="whitespace-pre-wrap"><strong>{value.intent.operation === "save" ? "Your proposed wording: " : "Wording in this request: "}</strong>{"text" in entry ? entry.text : value.before[index]?.entry.translated_text}</p>
          {current && <><p className="whitespace-pre-wrap"><strong>Current source: </strong>{source?.text ?? "Source unavailable"}</p>
            <p className="whitespace-pre-wrap"><strong>Current saved copy: </strong>{saved?.translated_text ?? "No saved translation"}</p>
            <p>{source?.available ? "Source is available for translation." : "Source is not available for new wording."} {saved ? `Saved revision ${saved.revision}.` : ""}</p></>}
        </div>;
      })}
      <div className="flex flex-wrap gap-2">
        <Button className="h-auto min-h-10 min-w-0 max-w-full whitespace-normal" type="button" disabled={busy || !canWrite} onClick={() => void send(value)}>Retry same translation request</Button>
        <Button className="h-auto min-h-10 min-w-0 max-w-full whitespace-normal" type="button" variant="outline" onClick={() => downloadCopy(JSON.stringify(value, null, 2), `translation-request-${value.intent.requestId}.json`)}>Download retained request</Button>
        {value.phase !== "unconfirmed" && <Button className="h-auto min-h-10 min-w-0 max-w-full whitespace-normal" type="button" variant="outline" disabled={busy} onClick={() => void loadReview(value.intent.requestId)}>Review current saved translations</Button>}
        {value.phase !== "unconfirmed" && review?.requestId === value.intent.requestId && <Button className="h-auto min-h-10 min-w-0 max-w-full whitespace-normal" type="button" variant="outline" disabled={busy || !canWrite} onClick={() => reopen(value, pendingTranslationKey(value))}>Keep this copy and reopen editor</Button>}
      </div>
    </section>)}
    {unreadable.map(key => <div key={key} className="space-y-2 rounded-lg border border-amber-400 p-3">
      <p role="alert">A retained translation request could not be read. This does not establish whether it reached the server. Preserve its copy and review current translations before reopening the editor.</p>
      <div className="flex flex-wrap gap-2"><Button className="h-auto min-h-10 min-w-0 max-w-full whitespace-normal" type="button" variant="outline" onClick={() => {
        try { const raw = window.localStorage.getItem(key); if (raw !== null) downloadCopy(raw, "unreadable-translation-request.json"); }
        catch { setMessage("The retained request could not be downloaded. Keep this page open and retry recovery."); }
      }}>Download unreadable copy</Button>
      <Button className="h-auto min-h-10 min-w-0 max-w-full whitespace-normal" type="button" variant="outline" disabled={busy} onClick={() => void loadReview(key)}>Review current saved translations</Button>
      {review?.requestId === key && <><p>Read the current saved translations below before continuing.</p>
        {review.snapshot.translations.map(row => <p key={row.id} className="whitespace-pre-wrap">{row.locale}: {row.translated_text}</p>)}
        <Button className="h-auto min-h-10 min-w-0 max-w-full whitespace-normal" type="button" disabled={busy || !canWrite} onClick={() => reopen(null, key)}>Preserve unreadable copy and reopen editor</Button></>}
      </div>
    </div>)}
    {archives.length > 0 && <details className="rounded-lg border border-border p-3"><summary>Earlier translation requests ({archives.length})</summary>
      {archives.map(({ key, raw }, index) => <div key={key} className="mt-3 space-y-2">
        <EarlierRequest raw={raw} />
        <Button className="h-auto min-h-10 min-w-0 max-w-full whitespace-normal" type="button" variant="outline" onClick={() => downloadCopy(raw, `earlier-translation-request-${index + 1}.json`)}>Download earlier request {index + 1}</Button>
      </div>)}
    </details>}
  </section>;
  return { ready, busy, pending, blocked: !ready || pending.length > 0 || unreadable.length > 0, submit, recovery };
}
