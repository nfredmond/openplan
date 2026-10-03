"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readSynthesisHistory } from "@/lib/engagement/synthesis-history-read";
import { Button } from "@/components/ui/button";
import type { SynthesisSourceSnapshot } from "@/lib/engagement/synthesis-sources";
import { ReviewSaveError } from "@/lib/engagement/synthesis-review-recovery";
import { assertThematicBrowserScope, inspectThematicPreview, thematicRequestPageSchema, type ThematicRequestPage } from "@/lib/engagement/synthesis-thematic-browser";
import { emptyThematicImportCopy, freezeThematicImport, listPreservedThematicImports, preserveThematicImportCopy, readThematicImportCopy,
  sendThematicImport, writeThematicImportCopy, type ThematicImportScope, type ThematicImportWorkingCopy, type ThematicImportMemory } from "@/lib/engagement/synthesis-thematic-import-recovery";
import { SynthesisThematicEvidence } from "./synthesis-thematic-evidence";

type Props = { scope: ThematicImportScope; snapshot: SynthesisSourceSnapshot;
  revision: { id: string; sha256: string; number: number; current: boolean; title: string; groupCount: number };
  disabled: boolean; memory: ThematicImportMemory;
  onAccessLost: () => void; onSaved: (revisionId: string) => void; onPendingChange: (pending: boolean) => void };
const message = (error: unknown) => error instanceof Error ? error.message : "The proposal is unavailable. Keep its saved selection and retry.";
const statusText = { inputs_not_sealed: "The complete input set is not sealed.", not_prepared: "Thematic tasks have not been prepared.",
  staging: "Thematic task preparation is unfinished.", incomplete: "The selected outputs do not form a complete proposal.", proposal_complete: "Complete original proposal available for inspection." };

/** Import replaces draft wording and groups at one exact parent. It never grants approval or starts a provider. */
export function SynthesisThematicImportPanel({ scope: suppliedScope, snapshot, revision, disabled, memory, onAccessLost, onSaved, onPendingChange }: Props) {
  const { userId, workspaceId, campaignId, sourceId, sourceSha256, reviewId, preparationSha256 } = suppliedScope;
  const scope = useMemo(() => ({ userId, workspaceId, campaignId, sourceId, sourceSha256, reviewId, preparationSha256 }),
    [userId, workspaceId, campaignId, sourceId, sourceSha256, reviewId, preparationSha256]);
  const [working, setWorking] = useState(() => emptyThematicImportCopy(scope));
  const workingRef = useRef(working), epoch = useRef(0), readSequence = useRef(0), listSequence = useRef(0), sending = useRef(false);
  const readAbort = useRef<AbortController | null>(null);
  const [ready, setReady] = useState(false), [blocked, setBlocked] = useState(false), [busy, setBusy] = useState(false), [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const [page, setPage] = useState<ThematicRequestPage | null>(null), [listing, setListing] = useState(false);
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof inspectThematicPreview>> | null>(null);
  const [copies, setCopies] = useState<ReturnType<typeof listPreservedThematicImports>>([]);
  const adopt = useCallback((value: ThematicImportWorkingCopy) => { workingRef.current = value; setWorking(value); }, []);
  const endpoint = `/api/engagement/campaigns/${campaignId}/synthesis/proposals`;
  const read = useCallback(async (query: Record<string, string>, signal?: AbortSignal) => {
    const current = epoch.current;
    const response = await readSynthesisHistory(`${endpoint}?${new URLSearchParams({ ...query, sourceId, sourceSha256 })}`, {
      userId, workspaceId, signal, isCurrent: () => current === epoch.current,
    });
    if ((response.status === 401 || response.status === 403) && current === epoch.current && !signal?.aborted) { epoch.current++; setPreview(null); setPage(null); onAccessLost(); }
    if (!response.ok) throw new Error("Proposal history could not be read. Keep any saved request and retry after checking access.");
    return response.json() as Promise<unknown>;
  }, [endpoint, sourceId, sourceSha256, userId, workspaceId, onAccessLost]);
  const inspect = useCallback(async (requestId: string, retained?: NonNullable<ThematicImportWorkingCopy["draft"]>["proposal"]) => {
    memory.inspection = { open: true, requestId };
    const current = epoch.current, sequence = ++readSequence.current;
    readAbort.current?.abort(); const controller = new AbortController(); readAbort.current = controller;
    setReading(true); setPreview(null); setError(null);
    try {
      const raw = await read({ mode: "preview", requestId, ...(retained ? { throughSequence: String(retained.selectionSequence) } : {}) }, controller.signal);
      const result = await inspectThematicPreview(raw, scope, requestId, snapshot);
      if (retained && Object.entries(retained).some(([key, value]) => result.preview.origin?.reference[key as keyof typeof retained] !== value)) throw new Error("The original proposal differs from the retained selection. Keep your exact request for recovery.");
      if (current === epoch.current && sequence === readSequence.current) setPreview(result);
    } catch (cause) { if (current === epoch.current && sequence === readSequence.current && !controller.signal.aborted) setError(message(cause)); }
    finally { if (current === epoch.current && sequence === readSequence.current) setReading(false); }
  }, [read, scope, snapshot, memory]);
  const list = useCallback(async (cursor: ThematicRequestPage["nextCursor"] = null) => {
    const current = epoch.current, sequence = ++listSequence.current; setListing(true); setError(null);
    try {
      const result = thematicRequestPageSchema.parse(await read({ mode: "list", ...(cursor ? { beforeId: cursor.id, beforeCreatedAt: cursor.createdAt } : {}) }));
      assertThematicBrowserScope(result, scope);
      if (current === epoch.current && sequence === listSequence.current) setPage(previous => cursor && previous
        ? { ...result, entries: [...previous.entries, ...result.entries.filter(row => !previous.entries.some(old => old.requestId === row.requestId))] } : result);
    } catch (cause) { if (current === epoch.current && sequence === listSequence.current) { setPage(null); setError(message(cause)); } }
    finally { if (current === epoch.current && sequence === listSequence.current) setListing(false); }
  }, [read, scope]);
  useEffect(() => {
    const restore = () => {
      const latest = memory.current; setPreview(null); setReading(false);
      try {
        const stored = readThematicImportCopy(localStorage, scope); adopt(stored); setBlocked(Boolean(latest));
        setCopies(listPreservedThematicImports(localStorage, scope));
        if (latest) { setWorking(latest); setError("The latest import edit could not be stored. Preserve its text before leaving this page."); }
        const draft = (latest ?? stored).draft;
        if (draft) void inspect(draft.proposal.requestId, draft.proposal);
        else if (memory.inspection?.open && memory.inspection.requestId) void inspect(memory.inspection.requestId);
      } catch (cause) { if (latest) setWorking(latest); setBlocked(true); setError(message(cause)); }
      setReady(true);
    };
    restore(); void list();
    const refresh = () => { readSequence.current++; readAbort.current?.abort(); restore(); void list(); };
    window.addEventListener("storage", refresh);
    const invalidate = () => { epoch.current++; readAbort.current?.abort(); };
    return () => { invalidate(); window.removeEventListener("storage", refresh); };
  }, [scope, memory, adopt, inspect, list]);
  useEffect(() => { onPendingChange(!ready || Boolean(working.draft || working.pending || blocked)); }, [ready, working.draft, working.pending, blocked, onPendingChange]);
  useEffect(() => () => onPendingChange(false), [onPendingChange]);
  function update(next: ThematicImportWorkingCopy) {
    try { adopt(writeThematicImportCopy(localStorage, workingRef.current, next)); memory.current = null; setBlocked(false); setError(null); }
    catch (cause) { memory.current = next; setWorking(next); setBlocked(true); setError(message(cause)); }
  }
  async function send() {
    if (sending.current || blocked) return;
    sending.current = true; setBusy(true); setError(null); setNotice(null); const current = epoch.current;
    try {
      let request = workingRef.current;
      if (!request.pending) {
        if (disabled || !revision.current || !request.draft || request.draft.parentId !== revision.id || request.draft.parentSha256 !== revision.sha256) throw new Error("Open the exact current review before importing. Preserve the earlier selection before choosing another parent.");
        const selectedProposal = request.draft.proposal;
        if (!preview?.preview.origin || Object.entries(selectedProposal).some(([key, value]) => preview.preview.origin?.reference[key as keyof typeof selectedProposal] !== value)) throw new Error("Inspect the exact retained proposal before importing.");
        request = freezeThematicImport(localStorage, request, crypto.randomUUID()); adopt(request);
      }
      const result = await sendThematicImport(localStorage, request);
      if (current !== epoch.current) return;
      adopt(result.working); setNotice(result.cleanupError ?? `Proposal imported as draft revision ${result.receipt.revisionNo}. Existing approvals remain attached to their earlier revisions.`);
      onSaved(result.receipt.requestId);
    } catch (cause) {
      if (current !== epoch.current) return;
      if (cause instanceof ReviewSaveError && (cause.status === 401 || cause.status === 403)) { epoch.current++; setPreview(null); setPage(null); onAccessLost(); }
      else { setError(message(cause)); if (!workingRef.current.pending) setBlocked(true); }
    } finally { sending.current = false; if (current === epoch.current) setBusy(false); }
  }
  const draft = working.draft, stale = draft && (draft.parentId !== revision.id || draft.parentSha256 !== revision.sha256 || !revision.current);
  return <section aria-label="Import a machine proposal" className="min-w-0 space-y-4 rounded border p-3">
    <h5 className="font-semibold">Inspect and import a machine proposal</h5>
    <p className="text-sm">Import replaces this draft’s title, notes and groups with the selected machine proposal. Earlier revisions and their approvals remain unchanged. Import does not approve, publish or run a model.</p>
    {error ? <p role="alert" className="break-words">{error}</p> : null}{notice ? <p role="status">{notice}</p> : null}
    {blocked ? <><p role="alert">Browser recovery needs attention. Preserve the exact copy before starting another selection.</p><details><summary>Latest import recovery text</summary><pre className="whitespace-pre-wrap break-all text-xs">{JSON.stringify(working, null, 2)}</pre></details></> : null}
    {working.pending ? <div className="rounded border p-3 space-y-2"><p>The exact import command is retained. Retry confirms that same save; it does not create another proposal.</p>
      <Button type="button" className="h-auto min-h-10 max-w-full whitespace-normal" disabled={busy || blocked} onClick={() => void send()}>Retry retained import</Button></div> : null}
    <Button type="button" variant="outline" disabled={listing} onClick={() => void list()}>Refresh proposal history</Button>
    {listing ? <p role="status">Reading saved proposal requests.</p> : null}
    {page?.entries.length === 0 ? <p>No thematic requests are saved for this source. Staff can continue their review without a machine proposal.</p> : null}
    <ul className="space-y-2">{page?.entries.map(row => <li key={row.requestId} className="rounded border p-3 space-y-2">
      <p>Requested {new Date(row.createdAt).toLocaleString("en-US")}. {row.cancelled ? "Cancelled; retained history remains readable." : "Inspect retained outputs to determine whether a complete proposal is available."}</p>
      <Button type="button" variant="outline" className="h-auto min-h-10 max-w-full whitespace-normal" disabled={Boolean(draft) || busy || blocked || reading}
        onClick={() => void inspect(row.requestId)}>Inspect proposal {row.requestId.slice(0, 8)}</Button>
    </li>)}</ul>
    {page?.nextCursor ? <Button type="button" variant="outline" disabled={listing} onClick={() => void list(page.nextCursor)}>Load older proposal requests</Button> : null}
    {reading ? <p role="status">Reconstructing the selected original proposal and its evidence.</p> : null}
    {preview ? <><p role="status">{statusText[preview.preview.status]} {preview.preview.cancelled ? "The original request is cancelled. Inspection and import do not renew execution." : ""}</p>
      {preview.proposal && preview.preview.origin ? <>
        <SynthesisThematicEvidence origin={preview.preview.origin} proposal={preview.proposal} snapshot={snapshot} />
        {!draft ? <><p>Replacement preview: revision {revision.number}, “{revision.title}”, has {revision.groupCount} groups. The proposed draft has {preview.proposal.groups.length} groups. Complete earlier wording remains in revision history.</p>
          <Button type="button" className="h-auto min-h-10 max-w-full whitespace-normal" disabled={!ready || blocked || busy || disabled || !revision.current}
            onClick={() => update({ ...workingRef.current, draft: { parentId: revision.id, parentSha256: revision.sha256, parentNumber: revision.number,
              proposal: preview.preview.origin!.reference, reason: "" } })}>Select this proposal for the current draft</Button></> : null}
      </> : null}
    </> : null}
    {draft ? <div className="space-y-3">
      <p>Retained replacement for revision {draft.parentNumber}. {stale ? "That parent is no longer the displayed current revision. Preserve this selection and inspect the current review." : "Earlier wording and approvals remain retained."}</p>
      <label className="block">Reason for importing this proposal<textarea rows={4} className="block w-full min-w-0 rounded border p-2" value={draft.reason}
        disabled={busy || blocked || Boolean(working.pending) || disabled || Boolean(stale)} onChange={event => update({ ...workingRef.current, draft: { ...draft, reason: event.target.value } })} /></label>
      <Button type="button" className="h-auto min-h-10 max-w-full whitespace-normal" disabled={!ready || busy || blocked || disabled || Boolean(stale) || Boolean(working.pending) || !draft.reason.trim() || !preview?.preview.origin}
        onClick={() => void send()}>Replace draft with this machine proposal</Button>
    </div> : null}
    {draft || working.pending || blocked ? <Button type="button" variant="outline" className="h-auto min-h-10 max-w-full whitespace-normal" disabled={busy} onClick={() => {
      try { preserveThematicImportCopy(localStorage, scope, working); adopt(readThematicImportCopy(localStorage, scope)); memory.current = null;
        memory.inspection = { open: true, requestId: null }; setBlocked(false); setPreview(null); setCopies(listPreservedThematicImports(localStorage, scope)); setError(null); setNotice("Exact recovery copies preserved below. Inspect the current review before selecting another proposal."); }
      catch (cause) { setError(message(cause)); }
    }}>Preserve import copy and choose again</Button> : null}
    {copies.length ? <section aria-label="Preserved thematic import copies" className="space-y-2"><h6 className="font-semibold">Preserved import recovery copies</h6>{copies.map(copy => <details key={copy.key}>
      <summary>Preserved {copy.value?.draft ? `selection for revision ${copy.value.draft.parentNumber}` : "unreadable recovery copy"}</summary><pre className="whitespace-pre-wrap break-all text-xs">{copy.raw}</pre>
      {copy.value ? <Button type="button" variant="outline" disabled={busy || blocked || Boolean(draft || working.pending)} onClick={() => {
        try { const next = writeThematicImportCopy(localStorage, workingRef.current, copy.value!); adopt(next); if (next.draft) void inspect(next.draft.proposal.requestId, next.draft.proposal); }
        catch (cause) { setError(message(cause)); }
      }}>Restore preserved import selection</Button> : null}
    </details>)}</section> : null}
  </section>;
}
