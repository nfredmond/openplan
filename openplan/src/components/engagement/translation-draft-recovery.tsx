"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { archiveTranslationDrafts, readTranslationDrafts, retainTranslationDrafts, translationDraftKey, translationDraftStorageKey,
  type TranslationDraft, type TranslationDraftRecord, type TranslationDraftScope } from "@/lib/engagement/translation-drafts";
import { translationSnapshotSource, type TranslationSnapshot, type TranslationAddress } from "@/lib/engagement/translation-snapshot";
import type { PendingTranslation } from "@/lib/engagement/pending-translation";

function downloadDraft(raw: string) {
  const url = URL.createObjectURL(new Blob([raw], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = "translation-drafts.json"; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Freeze the source and saved version when typing starts, and survive a page remount. */
export function useTranslationDrafts(scope: TranslationDraftScope) {
  const [record, setRecord] = useState<TranslationDraftRecord | null>(null);
  const current = useRef<TranslationDraftRecord | null>(null);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [archives, setArchives] = useState<Array<{ key: string; raw: string }>>([]);
  const key = translationDraftStorageKey(scope);
  function restore() {
    try {
      const value = readTranslationDrafts(window.sessionStorage, scope); current.current = value; setRecord(value); setReady(true); setMessage(null);
      const copies = [];
      for (let index = 0; index < sessionStorage.length; index++) {
        const name = sessionStorage.key(index); if (!name?.startsWith(key + ":archive:")) continue;
        const raw = sessionStorage.getItem(name); if (raw !== null) copies.push({ key: name, raw });
      }
      setArchives(copies);
    } catch { setReady(false); setMessage("This tab's unsaved translation drafts could not be read. Preserve their copy before starting another draft."); }
  }
  useEffect(() => {
    restore();
    // The page keys this panel by the complete scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  function remember(next: TranslationDraftRecord) {
    current.current = next; setRecord(next);
    try { retainTranslationDrafts(window.sessionStorage, next); setMessage(null); }
    catch { setMessage("This tab could not retain the latest draft. Keep the page open and download your words before leaving or refreshing."); }
  }
  function observed(snapshot: TranslationSnapshot, address: TranslationAddress, locale: string, text: string): TranslationDraft {
    if (snapshot.campaignId !== scope.campaignId) throw new Error("Different draft campaign");
    const source = translationSnapshotSource(snapshot, address);
    if (!source) throw new Error("Draft source unavailable");
    const row = snapshot.translations.find(row => row.entity_type === address.entityType && row.entity_id === address.entityId && row.field === address.field && row.locale === locale);
    let before: TranslationDraft["before"] = null;
    if (row) { const { revision, ...entry } = row; before = { revision, entry }; }
    return { ...address, locale, text, source, before };
  }
  function find(locale: string, fieldKey: string) { return current.current?.entries.find(entry => translationDraftKey(entry) === `${locale}::${fieldKey}`); }
  function setText(snapshot: TranslationSnapshot, address: TranslationAddress, locale: string, text: string) {
    const value = current.current; if (!ready || !value) return;
    const key = translationDraftKey({ ...address, locale });
    const old = value.entries.find(entry => translationDraftKey(entry) === key);
    const draft = old ? { ...old, text } : observed(snapshot, address, locale, text);
    remember({ ...value, entries: [...value.entries.filter(entry => translationDraftKey(entry) !== key), draft] });
  }
  function clearConfirmed(pending: PendingTranslation) {
    const value = current.current; if (!value) return;
    const entries = value.entries.filter(draft => {
      const requested = pending.intent.entries.find(entry => translationDraftKey({ ...entry, locale: pending.intent.locale }) === translationDraftKey(draft));
      if (!requested) return true;
      if ("text" in requested && draft.text !== requested.text) return true;
      return JSON.stringify(draft.source) !== JSON.stringify(requested.expectedSource)
        || (draft.before?.entry.id ?? null) !== (requested.expectedTranslation?.id ?? null)
        || (draft.before?.revision ?? null) !== (requested.expectedTranslation?.revision ?? null);
    });
    remember({ ...value, reason: value.reason === (pending.intent.reason ?? "") ? "" : value.reason, entries });
  }
  function reopen(pending: PendingTranslation, snapshot: TranslationSnapshot) {
    const value = current.current; if (!value) return;
    const drafts = pending.intent.entries.map((entry, index) => {
      const text = "text" in entry && typeof entry.text === "string" ? entry.text : pending.before[index]?.entry.translated_text ?? "";
      if (!translationSnapshotSource(snapshot, entry)) return { entityType: entry.entityType, entityId: entry.entityId, field: entry.field,
        locale: pending.intent.locale, text, source: entry.expectedSource, before: pending.before[index] };
      return observed(snapshot, entry, pending.intent.locale, text);
    });
    const keys = new Set(drafts.map(translationDraftKey));
    remember({ ...value, reason: "", entries: [...value.entries.filter(entry => !keys.has(translationDraftKey(entry))), ...drafts] });
  }
  function clear(keys: string[], locale: string) {
    const value = current.current; if (value) remember({ ...value, entries: value.entries.filter(entry => !keys.some(key => `${locale}::${key}` === translationDraftKey(entry))) });
  }
  function archive() {
    try {
      if (current.current) retainTranslationDrafts(window.sessionStorage, current.current);
      archiveTranslationDrafts(window.sessionStorage, scope); restore();
    }
    catch { setMessage("The draft copy could not be preserved. Keep this page open and download it before retrying."); }
  }
  const recovery = <div className="mt-3 space-y-2 text-sm">
    {message && <p role="alert">{message}</p>}
    {!ready && <Button type="button" variant="outline" onClick={restore}>Retry unsaved draft recovery</Button>}
    {(message || Boolean(record?.entries.length)) && <details className="rounded-lg border border-border p-3"><summary>Unsaved translation drafts</summary>
      <p className="mt-2">Drafts and their starting versions are retained in this tab. Download a copy before closing it.</p>
      {record?.entries.map(draft => <div key={translationDraftKey(draft)} className="mt-2 whitespace-pre-wrap break-words"><p>{draft.field} ({draft.locale})</p><p>{draft.text}</p></div>)}
      <div className="mt-2 flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={() => {
        try { downloadDraft(record ? JSON.stringify(record) : sessionStorage.getItem(key) ?? ""); }
        catch { setMessage("The draft could not be downloaded. Keep this page open and retry recovery."); }
      }}>Download unsaved drafts</Button>
      <Button type="button" variant="outline" onClick={archive}>Preserve these drafts and start fresh</Button></div>
    </details>}
    {archives.length > 0 && <details className="rounded-lg border border-border p-3"><summary>Earlier unsaved draft copies ({archives.length})</summary>
      {archives.map((copy, index) => <Button key={copy.key} type="button" variant="outline" onClick={() => downloadDraft(copy.raw)}>Download earlier draft copy {index + 1}</Button>)}
    </details>}
  </div>;
  return { ready, record, find, setText, clearConfirmed, reopen, clear, recovery,
    reason: record?.reason ?? "", setReason: (reason: string) => { if (current.current) remember({ ...current.current, reason }); } };
}
