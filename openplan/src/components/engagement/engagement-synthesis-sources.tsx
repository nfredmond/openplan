"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import {
  synthesisSourceSelectionSchema, synthesisSourceListSchema, synthesisSourceSnapshotSchema,
  type SynthesisSourceSelection, type SynthesisSourceListEntry, type SynthesisSourceCursor,
} from "@/lib/engagement/synthesis-sources";
import {
  readPendingSynthesisSource, retainPendingSynthesisSource, archivePendingSynthesisSource, sendPendingSynthesisSource,
  type PendingSynthesisSource, type SynthesisClientScope,
} from "@/lib/engagement/pending-synthesis-source";
import { SynthesisSourceInspection } from "./synthesis-source-inspection";
import { SynthesisReviewEditor } from "./synthesis-review-editor";
import { readReviewWorkingCopy, type ReviewWorkingCopy } from "@/lib/engagement/synthesis-review-recovery";

const inspectionSchema = z.object({
  requestId: z.string().uuid(), campaignId: z.string().uuid(), workspaceId: z.string().uuid(),
  snapshotSha256: z.string().regex(/^[a-f0-9]{64}$/), snapshot: synthesisSourceSnapshotSchema,
});
type Inspection = z.infer<typeof inspectionSchema>;
const initialSelection: SynthesisSourceSelection = { statuses: ["approved"], includeItems: true, includeSurveys: true, categoryIds: [], from: null, to: null };
const localDateInput = (value: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const statuses = ["approved", "pending", "flagged", "rejected"] as const;
const message = (error: unknown) => error instanceof Error ? error.message : "Saved sources are unavailable. Retry when campaign access is restored.";

/** Mounted with a scope key so another account/campaign never inherits this private state. */
export function EngagementSynthesisSources(props: SynthesisClientScope & { categories: Array<{ id: string; label: string }> }) {
  return <SourcePanel key={`${props.userId}:${props.workspaceId}:${props.campaignId}`} {...props} />;
}

function SourcePanel({ userId, workspaceId, campaignId, categories }: SynthesisClientScope & { categories: Array<{ id: string; label: string }> }) {
  const [selection, setSelection] = useState(initialSelection);
  const [from, setFrom] = useState(""), [to, setTo] = useState("");
  const [pending, setPending] = useState<PendingSynthesisSource | null>(null);
  const [ready, setReady] = useState(false), [unreadable, setUnreadable] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const [entries, setEntries] = useState<SynthesisSourceListEntry[] | null>(null);
  const [cursor, setCursor] = useState<SynthesisSourceCursor | null>(null), [listing, setListing] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [inspection, setInspection] = useState<Inspection | null>(null), [openId, setOpenId] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null), [reading, setReading] = useState(false);
  const [accessLost, setAccessLost] = useState(false);
  // Revalidation unmounts private inspectors. Keep quota-failed edits within this account/campaign until the user can preserve them.
  const reviewMemories = useRef(new Map<string, { current: ReviewWorkingCopy | null }>());
  function reviewMemory(saved: Inspection) {
    const key = `${saved.requestId}:${saved.snapshotSha256}`;
    let memory = reviewMemories.current.get(key);
    if (!memory) { memory = { current: null }; reviewMemories.current.set(key, memory); }
    return memory;
  }
  const openIdRef = useRef<string | null>(null);
  const loseReviewAccess = useCallback(() => { reviewMemories.current.clear(); setAccessLost(true); setInspection(null); setEntries(null); setPending(null); setNotice(null); }, []);
  const epoch = useRef(0), readSequence = useRef(0), listSequence = useRef(0), sending = useRef(false);
  const endpoint = `/api/engagement/campaigns/${campaignId}/synthesis/sources`;

  const list = useCallback(async (before: SynthesisSourceCursor | null = null) => {
    const current = epoch.current, sequence = ++listSequence.current;
    setListing(true); setListError(null);
    try {
      const query = before ? `?${new URLSearchParams({ beforeId: before.id, beforeCreatedAt: before.createdAt })}` : "";
      const response = await fetch(`${endpoint}${query}`, { cache: "no-store", headers: { "x-openplan-expected-user": userId, "x-openplan-expected-workspace": workspaceId } });
      if (!response.ok) throw new Error("Saved source history is unavailable. Retry after checking campaign access.");
      const page = synthesisSourceListSchema.parse(await response.json());
      if (page.campaignId !== campaignId || page.workspaceId !== workspaceId) throw new Error("Saved source history belongs to another campaign.");
      if (current !== epoch.current || sequence !== listSequence.current) return;
      setEntries(previous => before ? [...(previous ?? []), ...page.entries.filter(entry => !previous?.some(row => row.requestId === entry.requestId))] : page.entries);
      setCursor(page.nextCursor);
    } catch (cause) {
      if (current === epoch.current && sequence === listSequence.current) { setEntries(null); setCursor(null); setInspection(null); setListError(message(cause)); }
    } finally { if (current === epoch.current && sequence === listSequence.current) setListing(false); }
  }, [endpoint, campaignId, workspaceId, userId]);


  const inspect = useCallback(async (requestId: string) => {
    openIdRef.current = requestId;
    const current = epoch.current, sequence = ++readSequence.current;
    setOpenId(requestId); setInspection(null); setReadError(null); setReading(true);
    try {
      const response = await fetch(`${endpoint}?requestId=${requestId}`, { cache: "no-store", headers: { "x-openplan-expected-user": userId, "x-openplan-expected-workspace": workspaceId } });
      if (!response.ok) throw new Error("The saved source could not be opened. Retry this read; an earlier confirmed save remains retained.");
      const saved = inspectionSchema.parse(await response.json());
      if (saved.requestId !== requestId || saved.campaignId !== campaignId || saved.workspaceId !== workspaceId
        || saved.snapshot.requestId !== requestId || saved.snapshot.campaignId !== campaignId || saved.snapshot.workspaceId !== workspaceId) throw new Error("Saved source identity differs from the requested source.");
      if (current === epoch.current && sequence === readSequence.current) setInspection(saved);
    } catch (cause) { if (current === epoch.current && sequence === readSequence.current) setReadError(message(cause)); }
    finally { if (current === epoch.current && sequence === readSequence.current) setReading(false); }
  }, [endpoint, campaignId, workspaceId, userId]);

  useEffect(() => {
    const restore = () => {
      try {
        const retained = readPendingSynthesisSource(localStorage, { userId, workspaceId, campaignId });
        setPending(retained); setUnreadable(false); setReady(true);
        if (retained) { setSelection(retained.intent.selection); setFrom(localDateInput(retained.intent.selection.from)); setTo(localDateInput(retained.intent.selection.to)); }
      } catch { setUnreadable(true); setReady(true); }
    };
    restore(); void list();
    const client = createClient();
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      if (session?.user.id !== userId) {
        reviewMemories.current.clear();
        epoch.current++; setAccessLost(true); setInspection(null); setEntries(null); setPending(null); setNotice(null);
      }
    });
    const refresh = () => { const requestId = openIdRef.current; setInspection(null); readSequence.current++; restore(); void list(); if (requestId) void inspect(requestId); };
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", refresh);
    const invalidate = () => { epoch.current++; };
    return () => { invalidate(); subscription.unsubscribe(); window.removeEventListener("focus", refresh); window.removeEventListener("storage", refresh); };
  }, [userId, workspaceId, campaignId, list, inspect]);

  async function save() {
    if (sending.current) return;
    sending.current = true; setBusy(true); setError(null); setNotice(null);
    const current = epoch.current;
    try {
      let request = pending;
      if (!request) {
        const chosen = synthesisSourceSelectionSchema.parse({ ...selection, from: from ? new Date(from).toISOString() : null, to: to ? new Date(to).toISOString() : null });
        request = retainPendingSynthesisSource(localStorage, { version: 1, userId, workspaceId, campaignId,
          intent: { requestId: crypto.randomUUID(), actorId: userId, workspaceId, selection: chosen } });
        setPending(request);
      }
      const result = await sendPendingSynthesisSource(localStorage, request);
      if (current !== epoch.current) return;
      setNotice(result.cleanupError ?? `Source saved: ${result.receipt.counts.items} comments, ${result.receipt.counts.sessions} survey responses and ${result.receipt.counts.answers} answers.`);
      if (!result.cleanupError) setPending(null);
      void list(); void inspect(result.receipt.requestId);
    } catch (cause) { if (current === epoch.current) setError(message(cause)); }
    finally { sending.current = false; if (current === epoch.current) setBusy(false); }
  }

  function reviewRecoveryLabel(entry: SynthesisSourceListEntry) {
    try {
      const unsaved = reviewMemories.current.get(`${entry.requestId}:${entry.snapshotSha256}`)?.current;
      if (unsaved?.draft || unsaved?.pending) return "Staff review recovery in this browser needs attention";
      const recovery = readReviewWorkingCopy(localStorage, { userId, workspaceId, campaignId, sourceId: entry.requestId, sourceSha256: entry.snapshotSha256 });
      return recovery.draft || recovery.pending ? "Unfinished staff review in this browser" : null;
    } catch { return "Staff review recovery in this browser needs attention"; }
  }

  if (accessLost) return <section className="module-section-surface"><p role="alert">The signed-in account changed. Reopen this consultation to check access.</p></section>;
  return <section className="module-section-surface p-3 space-y-4 sm:p-6" aria-label="Retained synthesis sources">
    <h2 className="module-section-title">Retained synthesis sources</h2>
    <p className="text-sm">Save a private, complete copy of a selected contribution scope before preparing a synthesis. This records sources; it does not analyze sentiment, approve findings or publish participant text.</p>
    <fieldset disabled={!ready || busy || Boolean(pending) || unreadable} className="space-y-3">
      <legend className="font-semibold">Choose contributions</legend>
      <div className="flex flex-wrap gap-4">{statuses.map(status => <label key={status} className="capitalize"><input type="checkbox" checked={selection.statuses.includes(status)} onChange={event => setSelection({ ...selection, statuses: event.target.checked ? [...selection.statuses, status] : selection.statuses.filter(value => value !== status) })} /> {status[0].toUpperCase() + status.slice(1)}</label>)}</div>
      <div className="flex flex-wrap gap-4"><label><input type="checkbox" checked={selection.includeItems} onChange={event => setSelection({ ...selection, includeItems: event.target.checked })} /> Comments and replies</label><label><input type="checkbox" checked={selection.includeSurveys} onChange={event => setSelection({ ...selection, includeSurveys: event.target.checked })} /> Survey responses</label></div>
      <label className="block">Category<select className="block w-full rounded border p-2" value={selection.categoryIds[0] ?? ""} onChange={event => setSelection({ ...selection, categoryIds: event.target.value ? [event.target.value] : [] })}><option value="">All categories, including historical and uncategorized</option>{categories.map(category => <option key={category.id} value={category.id}>{category.label}</option>)}</select></label>
      <div className="grid gap-3 sm:grid-cols-2"><label>Received from, inclusive<input type="datetime-local" className="block w-full min-w-0 rounded border p-2" value={from} onChange={event => setFrom(event.target.value)} /></label><label>Received before, exclusive<input type="datetime-local" className="block w-full min-w-0 rounded border p-2" value={to} onChange={event => setTo(event.target.value)} /></label></div>
      <p className="text-xs">Dates use this browser’s local time zone. A category filter uses the retained question/category definition and can exclude answers without historical context.</p>
    </fieldset>
    {pending ? <div className="rounded border p-3 space-y-2"><p>A source request is retained for retry. Its selection is fixed until the save is confirmed.</p><p className="break-all text-xs">Request {pending.intent.requestId}</p><p>{pending.intent.selection.statuses.join(", ")} · {pending.intent.selection.includeItems ? "comments included" : "comments excluded"} · {pending.intent.selection.includeSurveys ? "surveys included" : "surveys excluded"}</p><p className="text-xs break-words">Categories: {pending.intent.selection.categoryIds.join(", ") || "all"}. Dates: {pending.intent.selection.from ?? "no start"} to {pending.intent.selection.to ?? "no end"}.</p></div> : null}
    {unreadable ? <p role="alert">The browser’s pending request is unreadable. Preserve it before starting another selection.</p> : null}
    {error ? <p role="alert">{error}</p> : null}{notice ? <p role="status">{notice}</p> : null}
    <div className="flex flex-wrap gap-3"><Button type="button" disabled={!ready || busy || unreadable} onClick={() => void save()}>{busy ? "Confirming save…" : pending ? "Retry retained source request" : "Save selected sources"}</Button>
      {pending || unreadable ? <Button type="button" variant="outline" className="h-auto min-h-10 max-w-full whitespace-normal" disabled={busy} onClick={() => {
        try { archivePendingSynthesisSource(localStorage, { userId, workspaceId, campaignId }); setPending(null); setUnreadable(false); setError(null); setNotice("Recovery copy preserved in this browser. Any source already saved remains in history. Check history before creating another capture."); }
        catch (cause) { setError(message(cause)); }
      }}>Preserve request and start another selection</Button> : null}</div>
    <h3 className="font-semibold">Saved source history</h3>
    <Button type="button" variant="outline" disabled={listing} onClick={() => void list()}>Refresh saved sources</Button>
    {listing ? <p role="status">Loading saved source history…</p> : null}{listError ? <p role="alert">{listError}</p> : null}
    {entries?.length === 0 ? <p>No saved sources were found.</p> : null}
    <ul className="space-y-3">{entries?.map(entry => <li key={entry.requestId} className="rounded border p-3 space-y-2"><p>{new Date(entry.createdAt).toLocaleString()} · {entry.counts.items} comments · {entry.counts.sessions} survey responses · {entry.counts.answers} answers</p><p className="text-xs">Statuses: {entry.selection.statuses.join(", ")}</p><p className="text-sm font-medium">{reviewRecoveryLabel(entry)}</p><Button type="button" variant="outline" onClick={() => void inspect(entry.requestId)}>Open saved source {entry.requestId.slice(0, 8)}</Button></li>)}</ul>
    {cursor ? <Button type="button" variant="outline" disabled={listing} onClick={() => void list(cursor)}>Load older sources</Button> : null}
    {reading ? <p role="status">Opening retained source…</p> : null}{readError ? <div><p role="alert">{readError}</p>{openId ? <Button type="button" variant="outline" onClick={() => void inspect(openId)}>Retry opening saved source</Button> : null}</div> : null}
    {inspection ? <div key={inspection.requestId} className="space-y-4"><SynthesisSourceInspection snapshot={inspection.snapshot} sha256={inspection.snapshotSha256} /><SynthesisReviewEditor userId={userId} workspaceId={workspaceId} campaignId={campaignId} sourceId={inspection.requestId} sourceSha256={inspection.snapshotSha256} snapshot={inspection.snapshot} onAccessLost={loseReviewAccess} recoveryMemory={reviewMemory(inspection)} /></div> : null}
  </section>;
}
