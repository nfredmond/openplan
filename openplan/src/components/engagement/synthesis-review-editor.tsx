"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { applySynthesisReviewChange, synthesisReviewIntentSchema, verifySynthesisReviewContent, type SynthesisReviewContent, type SynthesisReviewIntent } from "@/lib/engagement/synthesis-review";
import { synthesisReviewListSchema, synthesisReviewRecordSchema, synthesisReviewRevisionListSchema, type SynthesisReviewRecord } from "@/lib/engagement/synthesis-review-records";
import { emptyReviewWorkingCopy, freezeReviewRequest, listPreservedReviewCopies, preserveReviewWorkingCopy, readReviewWorkingCopy, sendReviewRequest, writeReviewWorkingCopy, ReviewSaveError,
  type ReviewClientScope, type ReviewDraft, type ReviewWorkingCopy } from "@/lib/engagement/synthesis-review-recovery";
import type { SynthesisSourceSnapshot } from "@/lib/engagement/synthesis-sources";

type SavedReview = SynthesisReviewRecord & { content: SynthesisReviewContent };
type ReviewPage = z.infer<typeof synthesisReviewListSchema>;
type RevisionPage = z.infer<typeof synthesisReviewRevisionListSchema>;
type Props = ReviewClientScope & { snapshot: SynthesisSourceSnapshot; onAccessLost: () => void; recoveryMemory?: { current: ReviewWorkingCopy | null } };
const errorText = (cause: unknown) => cause instanceof Error ? cause.message : "The saved review is unavailable. Keep your recovery copy.";

/** The parent owns campaign authentication; scope changes remount every private editor state. */
export function SynthesisReviewEditor(props: Props) {
  return <ReviewPanel key={`${props.userId}:${props.workspaceId}:${props.campaignId}:${props.sourceId}`} {...props} />;
}

function ReviewPanel({ snapshot, onAccessLost, recoveryMemory: sourceMemory, ...scope }: Props) {
  const { userId, workspaceId, campaignId, sourceId, sourceSha256 } = scope;
  const localMemory = useRef<ReviewWorkingCopy | null>(null);
  const recoveryMemory = sourceMemory ?? localMemory;
  const [working, setWorking] = useState(() => emptyReviewWorkingCopy(scope));
  const workingRef = useRef(working), epoch = useRef(0), reading = useRef(0), listing = useRef(0), sending = useRef(false);
  const [ready, setReady] = useState(false), [blocked, setBlocked] = useState(false), [busy, setBusy] = useState(false);
  const [accessLost, setAccessLost] = useState(false);
  const [saved, setSaved] = useState<SavedReview | null>(null), [page, setPage] = useState<ReviewPage | null>(null), [history, setHistory] = useState<RevisionPage | null>(null);
  const [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const [copies, setCopies] = useState<ReturnType<typeof listPreservedReviewCopies>>([]);
  const endpoint = `/api/engagement/campaigns/${campaignId}/synthesis/reviews`;
  const adopt = (value: ReviewWorkingCopy) => { workingRef.current = value; setWorking(value); };

  const read = useCallback(async (query: Record<string, string>) => {
    const response = await fetch(`${endpoint}?${new URLSearchParams(query)}`, { cache: "no-store", headers: { "x-openplan-expected-user": userId, "x-openplan-expected-workspace": workspaceId } });
    if (response.status === 401 || response.status === 403) { epoch.current++; setAccessLost(true); onAccessLost(); }
    if (!response.ok) throw new Error(response.status === 404 ? "This review revision has not been confirmed. Keep its request for retry." : "The saved review could not be opened. Any earlier confirmed save remains retained.");
    return response.json() as Promise<unknown>;
  }, [endpoint, userId, workspaceId, onAccessLost]);

  const list = useCallback(async (before: ReviewPage["nextCursor"] = null) => {
    const current = epoch.current, sequence = ++listing.current;
    try {
      const data = synthesisReviewListSchema.parse(await read({ mode: "reviews", sourceId, ...(before ? { beforeId: before.id, beforeCreatedAt: before.createdAt } : {}) }));
      if (data.campaignId !== campaignId || data.workspaceId !== workspaceId || data.sourceId !== sourceId) throw new Error("Review history belongs to another source");
      if (current !== epoch.current || sequence !== listing.current) return;
      setPage(previous => before && previous ? { ...data, entries: [...previous.entries, ...data.entries.filter(row => !previous.entries.some(old => old.reviewId === row.reviewId))] } : data);
    } catch (cause) { if (current === epoch.current && sequence === listing.current) { setPage(null); setSaved(null); setHistory(null); setError(errorText(cause)); } }
  }, [read, sourceId, campaignId, workspaceId]);

  const open = useCallback(async (reviewId: string, revisionId?: string) => {
    const current = epoch.current, sequence = ++reading.current;
    setSaved(null); setHistory(null); setError(null);
    try {
      const record = synthesisReviewRecordSchema.passthrough().parse(await read({ mode: "read", reviewId, ...(revisionId ? { revisionId } : {}) }));
      if (record.reviewId !== reviewId || record.campaignId !== campaignId || record.workspaceId !== workspaceId || record.sourceId !== sourceId || record.sourceSha256 !== sourceSha256
        || (revisionId && record.revision.requestId !== revisionId)) throw new Error("Saved review identity differs from this source");
      const content = verifySynthesisReviewContent(JSON.parse(record.revision.contentText), snapshot, sourceSha256);
      if (current !== epoch.current || sequence !== reading.current) return;
      setSaved({ ...record, content });
      const revisions = synthesisReviewRevisionListSchema.parse(await read({ mode: "revisions", reviewId }));
      if (revisions.reviewId !== reviewId || revisions.campaignId !== campaignId || revisions.workspaceId !== workspaceId) throw new Error("Revision history belongs to another review");
      if (current === epoch.current && sequence === reading.current) setHistory(revisions);
    } catch (cause) { if (current === epoch.current && sequence === reading.current) { setSaved(null); setHistory(null); setError(errorText(cause)); } }
  }, [read, campaignId, workspaceId, sourceId, sourceSha256, snapshot]);

  useEffect(() => {
    const currentScope = { userId, workspaceId, campaignId, sourceId, sourceSha256 };
    const restore = () => {
      const unsaved = recoveryMemory.current;
      if (unsaved) setWorking(unsaved);
      try {
        const value = readReviewWorkingCopy(localStorage, currentScope);
        adopt(value); setBlocked(Boolean(unsaved)); setCopies(listPreservedReviewCopies(localStorage, currentScope));
        if (unsaved) { setWorking(unsaved); setError("This edit could not be stored in the browser. Preserve the latest text before continuing."); }
        const displayed = unsaved ?? value;
        if (displayed.draft) void open(displayed.draft.reviewId, displayed.draft.parentId);
        else if (displayed.activeReviewId) void open(displayed.activeReviewId);
      } catch (cause) { setBlocked(true); setSaved(null); setError(errorText(cause)); }
      setReady(true);
    };
    restore(); void list();
    const refresh = () => { reading.current++; setSaved(null); setHistory(null); restore(); void list(); };
    window.addEventListener("storage", refresh);
    const invalidate = () => { epoch.current++; };
    return () => { invalidate(); window.removeEventListener("storage", refresh); };
  }, [userId, workspaceId, campaignId, sourceId, sourceSha256, open, list, recoveryMemory]);

  function update(value: ReviewWorkingCopy) {
    try { adopt(writeReviewWorkingCopy(localStorage, workingRef.current, value)); recoveryMemory.current = null; setBlocked(false); setError(null); }
    catch (cause) { recoveryMemory.current = value; setWorking(value); setBlocked(true); setError(errorText(cause)); }
  }

  async function send(intent?: SynthesisReviewIntent, revisionNo = 1) {
    if (sending.current) return;
    sending.current = true; setBusy(true); setError(null); setNotice(null);
    const current = epoch.current;
    try {
      let request = workingRef.current;
      if (!request.pending) {
        if (!intent) throw new Error("Prepare a review command before saving");
        request = freezeReviewRequest(localStorage, request, intent, revisionNo); adopt(request);
      }
      const result = await sendReviewRequest(localStorage, request);
      if (current !== epoch.current) return;
      adopt(result.working); setNotice(result.cleanupError ?? `Review saved, revision ${result.receipt.revisionNo}.`);
      void list(); void open(result.receipt.reviewId, result.receipt.requestId);
    } catch (cause) {
      if (current === epoch.current && cause instanceof ReviewSaveError && (cause.status === 401 || cause.status === 403)) { epoch.current++; setAccessLost(true); onAccessLost(); }
      else if (current === epoch.current) setError(errorText(cause));
    }
    finally { sending.current = false; if (current === epoch.current) setBusy(false); }
  }

  function correct() {
    const draft = workingRef.current.draft;
    if (!draft || !saved) return;
    try {
      if (saved.reviewId !== draft.reviewId || saved.revision.requestId !== draft.parentId || saved.revision.contentSha256 !== draft.parentSha256 || saved.currentRevisionId !== draft.parentId) throw new Error("Open the current review before correcting it. Your earlier draft remains preserved.");
      const group = saved.content.groups.find(row => row.id === draft.groupId);
      const change = draft.kind === "notes" ? { kind: draft.kind, title: draft.title, notes: draft.notes }
        : draft.kind === "group_remove" ? { kind: draft.kind, groupId: draft.groupId }
        : draft.kind === "group_add" ? { kind: draft.kind, groupId: draft.groupId, label: draft.label, summary: draft.summary, sentiment: draft.sentiment, sourceIds: draft.members }
        : { kind: draft.kind, groupId: draft.groupId, label: draft.label, summary: draft.summary, sentiment: draft.sentiment,
          addSourceIds: draft.members.filter(id => !group?.sourceIds.includes(id)), removeSourceIds: group?.sourceIds.filter(id => !draft.members.includes(id)) ?? [] };
      const intent = synthesisReviewIntentSchema.parse({ operation: "correct", requestId: crypto.randomUUID(), actorId: userId, workspaceId, reviewId: draft.reviewId,
        expectedRevisionId: draft.parentId, expectedRevisionSha256: draft.parentSha256, reason: draft.reason, change });
      applySynthesisReviewChange(saved.content, change, snapshot, sourceSha256);
      void send(intent, draft.parentNumber + 1);
    } catch (cause) { setError(cause instanceof z.ZodError ? "Add a correction reason and complete the required fields." : errorText(cause)); }
  }

  async function olderRevisions() {
    if (!history?.nextCursor) return;
    const previous = history, current = epoch.current, sequence = reading.current;
    try {
      const data = synthesisReviewRevisionListSchema.parse(await read({ mode: "revisions", reviewId: previous.reviewId, before: String(previous.nextCursor) }));
      if (data.reviewId !== previous.reviewId || data.campaignId !== campaignId || data.workspaceId !== workspaceId) throw new Error("Revision continuation belongs to another review");
      if (current === epoch.current && sequence === reading.current) setHistory({ ...data, entries: [...previous.entries, ...data.entries.filter(row => !previous.entries.some(old => old.requestId === row.requestId))] });
    } catch (cause) { if (current === epoch.current && sequence === reading.current) { setHistory(null); setSaved(null); setError(errorText(cause)); } }
  }

  const draft = working.draft, oldRevision = saved && saved.currentRevisionId !== saved.revision.requestId;
  if (accessLost) return <section><p role="alert">Staff access changed. Reopen this consultation to check access.</p></section>;
  return <section aria-label="Retained staff reviews" className="space-y-4 min-w-0 sm:rounded sm:border sm:p-4">
    <h3 className="font-semibold">Staff synthesis reviews</h3>
    <p>Create a private draft from this complete saved source. Historical categories begin unassessed. Staff wording and membership corrections retain their reasons and earlier versions.</p>
    <p className="text-sm">These drafts do not approve or publish findings. Contribution counts do not measure distinct people or representative support.</p>
    {error ? <p role="alert" className="break-words">{error}</p> : null}{notice ? <p role="status">{notice}</p> : null}
    {blocked ? <><p role="alert">Browser recovery needs attention. Preserve or copy the latest text before leaving or reloading this page.</p>{working.draft ? <details><summary>Latest edit retained on screen</summary><pre className="mt-2 whitespace-pre-wrap break-all text-xs">{JSON.stringify(working.draft, null, 2)}</pre></details> : null}</> : null}
    {working.pending ? <div className="rounded border p-3 space-y-2"><p>An exact review request is retained for retry. Its text and parent are fixed.</p><p className="text-xs break-all">Request {working.pending.intent.requestId}</p><Button type="button" className="h-auto min-h-10 max-w-full whitespace-normal" disabled={busy || blocked} onClick={() => void send()}>Retry retained review request</Button></div> : null}
    <div className="flex flex-wrap gap-3">
      <Button type="button" className="h-auto min-h-10 max-w-full whitespace-normal" disabled={!ready || blocked || busy || Boolean(draft || working.pending)} onClick={() => void send({ operation: "create", requestId: crypto.randomUUID(), actorId: userId, workspaceId, sourceId, sourceSha256 })}>Create staff review</Button>
      <Button type="button" className="h-auto min-h-10 max-w-full whitespace-normal" variant="outline" onClick={() => void list()}>Refresh staff reviews</Button>
      {draft || working.pending || blocked ? <Button type="button" className="h-auto min-h-10 max-w-full whitespace-normal" variant="outline" disabled={busy} onClick={() => {
        try { preserveReviewWorkingCopy(localStorage, scope, working); adopt(readReviewWorkingCopy(localStorage, scope)); recoveryMemory.current = null; setCopies(listPreservedReviewCopies(localStorage, scope)); setBlocked(false); setError(null); setNotice("Recovery copy preserved below. Open the current review before starting another correction."); }
        catch (cause) { setError(errorText(cause)); }
      }}>Preserve edit and start another correction</Button> : null}
    </div>
    {page?.entries.length === 0 ? <p>No staff reviews have been saved for this source.</p> : null}
    <ul className="space-y-2">{page?.entries.map(row => <li key={row.reviewId} className="rounded border p-3 space-y-2"><p className="break-words">{row.title} · latest revision {row.revisionNo}</p><Button type="button" className="h-auto min-h-10 max-w-full whitespace-normal" variant="outline" onClick={() => { if (!blocked) update({ ...workingRef.current, activeReviewId: row.reviewId }); void open(row.reviewId); }}>Open staff review {row.reviewId.slice(0, 8)}</Button></li>)}</ul>
    {page?.nextCursor ? <Button type="button" className="h-auto min-h-10 max-w-full whitespace-normal" variant="outline" onClick={() => void list(page.nextCursor)}>Load older staff reviews</Button> : null}
    {saved ? <article aria-label="Saved staff review" className="space-y-3 min-w-0">
      <h4 className="font-semibold break-words">{saved.content.title} · revision {saved.revision.revisionNo}</h4>
      <p>{saved.content.assignedSourceCount} assigned contributions; {saved.content.unassignedSourceIds.length} unassigned; {saved.content.overlappingSourceCount} appear in more than one group.</p>
      <p className="whitespace-pre-wrap break-words">{saved.content.notes || "No staff notes."}</p>
      <p className="text-xs break-all">Revision SHA256: {saved.revision.contentSha256}</p>
      <p className="text-sm break-words">{saved.revision.reason ? `Correction reason: ${saved.revision.reason}` : "Original draft from historical source preparation."}</p>
      {saved.content.groups.map(group => <details key={group.id} className="rounded border p-3"><summary className="break-words">{group.label} · {group.sourceIds.length} contributions · {group.sentiment.replaceAll("_", " ")}</summary><p className="mt-2 whitespace-pre-wrap break-words">{group.summary || "No staff summary."}</p><pre className="mt-2 whitespace-pre-wrap break-all text-xs">{group.sourceIds.join("\n")}</pre></details>)}
      <details><summary>Original preparation and unassigned membership</summary><p className="mt-2 text-xs break-all">Preparation SHA256: {saved.preparationSha256}</p><pre className="mt-2 whitespace-pre-wrap break-all text-xs">{saved.preparationText}</pre><pre className="mt-2 whitespace-pre-wrap break-all text-xs">Unassigned: {saved.content.unassignedSourceIds.join(", ") || "none"}</pre></details>
      {oldRevision ? <div><p>This is an earlier revision. Open the current review before editing.</p><Button type="button" className="h-auto min-h-10 max-w-full whitespace-normal" variant="outline" onClick={() => void open(saved.reviewId)}>Open current review</Button></div> : null}
      <ReviewCorrectionForm key={`${saved.reviewId}:${saved.revision.requestId}`} saved={saved} snapshot={snapshot} draft={draft?.reviewId === saved.reviewId && draft.parentId === saved.revision.requestId ? draft : null}
        disabled={!ready || blocked || busy || Boolean(working.pending) || Boolean(oldRevision) || Boolean(draft && (draft.reviewId !== saved.reviewId || draft.parentId !== saved.revision.requestId))}
        onChange={value => update({ ...workingRef.current, activeReviewId: saved.reviewId, draft: value })} onSave={correct} />
      {draft && (draft.reviewId !== saved.reviewId || draft.parentId !== saved.revision.requestId) ? <p>A different parent has an unfinished correction. Preserve that edit before starting another.</p> : null}
      <h5 className="font-semibold">Revision history</h5><ul className="space-y-2">{history?.entries.map(row => <li key={row.requestId}><Button type="button" className="h-auto min-h-10 max-w-full whitespace-normal" variant="outline" onClick={() => void open(saved.reviewId, row.requestId)}>Open revision {row.revisionNo}</Button><p className="text-sm break-words">{row.reason ?? "Original staff draft"}</p></li>)}</ul>
      {history?.nextCursor ? <Button type="button" className="h-auto min-h-10 max-w-full whitespace-normal" variant="outline" onClick={() => void olderRevisions()}>Load older revisions</Button> : null}
    </article> : null}
    {copies.length ? <section aria-label="Preserved review recovery copies" className="space-y-2"><h4 className="font-semibold">Preserved browser recovery copies</h4>{copies.map(copy => <details key={copy.key}><summary>Preserved {copy.value?.draft ? `correction to revision ${copy.value.draft.parentNumber}` : "review request"}</summary><pre className="mt-2 whitespace-pre-wrap break-all text-xs">{copy.raw}</pre>{copy.value ? <Button type="button" className="h-auto min-h-10 max-w-full whitespace-normal" variant="outline" disabled={busy || blocked || Boolean(draft || working.pending)} onClick={() => {
      try { const next = writeReviewWorkingCopy(localStorage, workingRef.current, copy.value!); adopt(next); if (next.draft) void open(next.draft.reviewId, next.draft.parentId); else if (next.activeReviewId) void open(next.activeReviewId); }
      catch (cause) { setError(errorText(cause)); }
    }}>Restore preserved edit</Button> : <p>This copy is unreadable; its exact text is retained above.</p>}</details>)}</section> : null}
  </section>;
}

function ReviewCorrectionForm({ saved, snapshot, draft, disabled, onChange, onSave }: {
  saved: SavedReview; snapshot: SynthesisSourceSnapshot; draft: ReviewDraft | null; disabled: boolean; onChange: (draft: ReviewDraft) => void; onSave: () => void;
}) {
  const [kind, setKind] = useState<ReviewDraft["kind"]>(draft?.kind ?? "notes"), [groupId, setGroupId] = useState(draft?.groupId ?? saved.content.groups[0]?.id ?? "");
  const [newId] = useState(() => `staff-${crypto.randomUUID()}`);
  const [search, setSearch] = useState(""), [page, setPage] = useState(0);
  const group = saved.content.groups.find(row => row.id === groupId);
  const current: ReviewDraft = draft ?? { reviewId: saved.reviewId, parentId: saved.revision.requestId, parentSha256: saved.revision.contentSha256, parentNumber: saved.revision.revisionNo,
    kind, groupId: kind === "group_add" ? newId : groupId, title: saved.content.title, notes: saved.content.notes, label: kind === "group_add" ? "" : group?.label ?? "",
    summary: kind === "group_add" ? "" : group?.summary ?? "", sentiment: kind === "group_add" ? "not_assessed" : group?.sentiment ?? "not_assessed", members: kind === "group_add" ? [] : group?.sourceIds ?? [], reason: "" };
  const contributions = useMemo(() => [...snapshot.items.map(row => ({ id: `item:${row.id}`, label: row.parent_item_id ? "Reply" : "Comment", text: row.body })),
    ...snapshot.answers.map(row => ({ id: `answer:${row.id}`, label: `Survey: ${row.question_prompt_snapshot ?? row.question_type}`, text: row.answer_text ?? JSON.stringify(row.answer_json) }))], [snapshot]);
  const filtered = contributions.filter(row => `${row.label} ${row.text}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const set = (patch: Partial<ReviewDraft>) => onChange({ ...current, ...patch });
  return <fieldset disabled={disabled} className="rounded border p-2 space-y-3 min-w-0 sm:p-3">
    <legend className="font-semibold">Reasoned correction</legend>
    <p className="text-sm">Edits are retained in this browser as you type. Save one correction at a time. Earlier saved versions remain unchanged.</p>
    {draft ? <p role="status">Unfinished correction retained for revision {draft.parentNumber}.</p> : null}
    <label className="block">Correction type<select className="block w-full min-w-0 rounded border p-2" disabled={Boolean(draft)} value={current.kind} onChange={event => setKind(event.target.value as ReviewDraft["kind"])}><option value="notes">Review title and notes</option><option value="group_update" disabled={!saved.content.groups.length}>Edit an existing group</option><option value="group_add">Add a group</option><option value="group_remove" disabled={!saved.content.groups.length}>Remove a group</option></select></label>
    {current.kind === "group_update" || current.kind === "group_remove" ? <label className="block">Review group<select className="block w-full min-w-0 rounded border p-2" disabled={Boolean(draft)} value={current.groupId} onChange={event => setGroupId(event.target.value)}>{saved.content.groups.map((row, index) => <option key={row.id} value={row.id}>{index + 1}. {row.label} · {row.sourceIds.length} contributions</option>)}</select></label> : null}
    {current.kind === "notes" ? <><label className="block">Review title<input className="block w-full rounded border p-2" value={current.title} onChange={event => set({ title: event.target.value })} /></label><label className="block">Staff review notes<textarea rows={5} className="block w-full rounded border p-2" value={current.notes} onChange={event => set({ notes: event.target.value })} /></label></> : null}
    {current.kind === "group_add" || current.kind === "group_update" ? <>
      <label className="block">Group label<input className="block w-full rounded border p-2" value={current.label} onChange={event => set({ label: event.target.value })} /></label>
      <label className="block">Staff group summary<textarea className="block w-full rounded border p-2" rows={4} value={current.summary} onChange={event => set({ summary: event.target.value })} /></label>
      <label className="block">Staff sentiment assessment<select className="block w-full rounded border p-2" value={current.sentiment} onChange={event => set({ sentiment: event.target.value as ReviewDraft["sentiment"] })}>{["not_assessed", "positive", "mixed", "neutral", "negative"].map(value => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label>
      <label className="block">Find contributions for this group<input type="search" className="block w-full rounded border p-2" value={search} onChange={event => { setSearch(event.target.value); setPage(0); }} /></label>
      <p>{current.members.length} selected contributions. {filtered.length} match this search; page {page + 1} of {Math.max(1, Math.ceil(filtered.length / 25))}.</p>
      <div className="flex flex-wrap gap-3"><Button type="button" className="h-auto min-h-10 max-w-full whitespace-normal" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous membership page</Button><Button type="button" className="h-auto min-h-10 max-w-full whitespace-normal" variant="outline" disabled={(page + 1) * 25 >= filtered.length} onClick={() => setPage(page + 1)}>Next membership page</Button></div>
      {filtered.slice(page * 25, (page + 1) * 25).map(row => <label key={row.id} className="block rounded border p-3 break-words"><input type="checkbox" checked={current.members.includes(row.id)} onChange={event => set({ members: event.target.checked ? [...current.members, row.id] : current.members.filter(id => id !== row.id) })} /> {row.label}<span className="block whitespace-pre-wrap">{row.text}</span></label>)}
    </> : null}
    {current.kind === "group_remove" ? <p>Removing this group preserves every source. Contributions with no other group become explicitly unassigned.</p> : null}
    <label className="block">Reason for correction<textarea rows={3} className="block w-full rounded border p-2" value={current.reason} onChange={event => set({ reason: event.target.value })} /></label>
    <Button type="button" className="h-auto min-h-10 max-w-full whitespace-normal" disabled={!draft} onClick={onSave}>Save reasoned correction</Button>
  </fieldset>;
}
