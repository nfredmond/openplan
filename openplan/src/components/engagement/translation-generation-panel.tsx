"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useTranslationResolution } from "./translation-resolution-panel";
import { resolutionHasCopy } from "@/lib/engagement/translation-resolution-recovery";
import { canonicalizeActionPayload } from "@/lib/runtime/action-metadata";
import { readTranslationGenerationCatalog, type TranslationGenerationCatalog, type TranslationGenerationCursor } from "@/lib/engagement/translation-generation-catalog";
import { translationGenerationRequestAckSchema, type TranslationGenerationRead } from "@/lib/engagement/translation-generation-request";
import { archivePendingGeneration, clearPendingGeneration, generationArchivePrefix, pendingGenerationKey, pendingGenerationSchema, readPendingGenerations,
  readViewedTranslationGeneration, retainPendingGeneration, type GenerationEditorScope, type PendingGeneration } from "@/lib/engagement/translation-generation-editor";
import { TRANSLATION_LANGUAGE_LABELS } from "@/lib/engagement/translation-languages";
import { isPortalLocale, PORTAL_LOCALE_DIRECTION } from "@/lib/engagement/portal-i18n/locales";

const stateNames = { queued: "Waiting for the local worker", reserved: "Worker preparing this field", running: "Generating", completed: "Ready to review",
  incomplete: "Incomplete output", failed: "Generation failed", interrupted: "Generation interrupted", cancelled: "Generation cancelled" };
function download(raw: string, name: string) {
  const url = URL.createObjectURL(new Blob([raw], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Keep uncertain queue requests separate from saved output and publication decisions. */
export function useTranslationGeneration({ userId, workspaceId, campaignId, canWrite, publicationBlocked, onPublish, onRefresh }: GenerationEditorScope & {
  canWrite: boolean; publicationBlocked: boolean;
  onPublish: (viewed: TranslationGenerationRead, fields: string[]) => Promise<void>;
  onRefresh: () => void;
}) {
  const scope = { userId, workspaceId, campaignId };
  const [open, setOpen] = useState(false), [ready, setReady] = useState(false), [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingGeneration[]>([]), [unreadable, setUnreadable] = useState<string[]>([]);
  const [archives, setArchives] = useState<Array<{ key: string; raw: string }>>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<TranslationGenerationCatalog | null>(null);
  const [viewed, setViewed] = useState<TranslationGenerationRead | null>(null);
  const [readFailed, setReadFailed] = useState(false);
  const remembered = useRef<PendingGeneration[]>([]), volatile = useRef(new Map<string, PendingGeneration>()), busyRef = useRef(false);
  const callbacks = useRef({ onPublish, onRefresh }); callbacks.current = { onPublish, onRefresh };
  const api = `/api/engagement/campaigns/${campaignId}/translations/generation`;
  const identity = `${userId}:${workspaceId}:${campaignId}`;
  const current = useRef({ identity, canWrite }); current.current = { identity, canWrite };
  const mounted = useRef(false), active = useRef<AbortController | null>(null);
  function operation() {
    const controller = new AbortController(); active.current = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]);
    const isCurrent = () => mounted.current && current.current.identity === identity && current.current.canWrite &&
      active.current === controller && !controller.signal.aborted;
    return {
      signal, isCurrent,
      assertCurrent: () => { if (!isCurrent()) throw new Error("Generation editor scope changed"); signal.throwIfAborted(); },
      finish: () => {
        if (active.current !== controller) return;
        active.current = null; busyRef.current = false;
        if (mounted.current && current.current.identity === identity) setBusy(false);
      },
    };
  }
  function remember(values: PendingGeneration[]) { remembered.current = values; setPending(values); }
  function restore() {
    try {
      const stored = readPendingGenerations(localStorage, scope), values = new Map(stored.pending.map(value => [value.intent.requestId, value]));
      const damaged = new Set(stored.unreadable);
      for (const value of remembered.current) {
        const current = values.get(value.intent.requestId);
        if (!current || canonicalizeActionPayload({ ...current, phase: value.phase }) !== canonicalizeActionPayload(value)) volatile.current.set(value.intent.requestId, value);
      }
      for (const [id, value] of volatile.current) {
        const current = values.get(id);
        if (current && canonicalizeActionPayload({ ...current, phase: value.phase }) !== canonicalizeActionPayload(value)) damaged.add(pendingGenerationKey(value));
        values.set(id, value);
      }
      const copies = [];
      for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index); if (!key?.startsWith(generationArchivePrefix(scope))) continue;
        const raw = localStorage.getItem(key); if (raw !== null) copies.push({ key, raw });
      }
      setArchives(copies); remember([...values.values()]); setUnreadable([...damaged]); setReady(true);
    } catch { setReady(false); setMessage("Generation recovery could not be read. Keep this page open and retry recovery before requesting more output."); }
  }
  useEffect(() => {
    mounted.current = true; restore(); window.addEventListener("storage", restore);
    return () => { mounted.current = false; active.current?.abort(); active.current = null; busyRef.current = false; window.removeEventListener("storage", restore); };
    // The editor is keyed by authenticated user, workspace and campaign.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, workspaceId, campaignId]);
  useEffect(() => {
    if (!canWrite) {
      active.current?.abort(); active.current = null; busyRef.current = false; setBusy(false); setReadFailed(true);
    }
  }, [canWrite]);

  const resolution = useTranslationResolution(scope, {
    canWrite, busy,
    acquire: () => { if (busyRef.current) return false; busyRef.current = true; setBusy(true); setOpen(true); return true; },
    release: () => { busyRef.current = false; setBusy(false); },
    download,
    onResolved: bundle => {
      setMessage(null);
      for (const [id, value] of volatile.current) if (resolutionHasCopy(bundle, JSON.stringify(value))) volatile.current.delete(id);
      remember(remembered.current.filter(value => !resolutionHasCopy(bundle, JSON.stringify(value))));
      restore(); callbacks.current.onRefresh();
    },
  });

  async function readRequest(id: string, run: ReturnType<typeof operation>, retained?: PendingGeneration) {
    run.assertCurrent();
    const response = await fetch(`${api}?requestId=${encodeURIComponent(id)}`, { cache: "no-store", signal: run.signal });
    run.assertCurrent();
    if (!response.ok) throw new Error("Generation evidence is unavailable");
    const raw: unknown = await response.json(); run.assertCurrent();
    return readViewedTranslationGeneration(raw, { campaignId, workspaceId, requestId: id }, retained);
  }
  async function send(value: PendingGeneration) {
    if (!canWrite || busyRef.current || resolution.hasPending()) return;
    const parsed = pendingGenerationSchema.safeParse(value);
    if (!parsed.success || value.userId !== userId || value.workspaceId !== workspaceId || value.campaignId !== campaignId) {
      setMessage("No generation was requested. Refresh and review the original source and saved versions."); return;
    }
    busyRef.current = true; setBusy(true); setOpen(true); setMessage(null);
    const run = operation();
    let retained = { ...parsed.data, phase: "unconfirmed" as const } as PendingGeneration;
    try {
      try { retained = retainPendingGeneration(localStorage, retained); volatile.current.delete(retained.intent.requestId); restore(); }
      catch {
        volatile.current.set(retained.intent.requestId, retained); remember([...remembered.current.filter(row => row.intent.requestId !== retained.intent.requestId), retained]);
        setMessage("This browser could not retain the request, so generation was not sent. Keep this page open and download your copy before retrying."); return;
      }
      run.assertCurrent();
      const signal = run.signal;
      const response = await fetch(api, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(retained.intent), signal });
      run.assertCurrent();
      const raw = await response.json(); run.assertCurrent();
      if (!response.ok) {
        const refused = response.status === 409 && raw?.kind === "conflict" || response.status === 400 && raw?.kind === "invalid" || response.status === 413;
        if (refused) {
          retained = { ...retained, phase: "refused" };
          try { retainPendingGeneration(localStorage, retained); volatile.current.delete(retained.intent.requestId); } catch { volatile.current.set(retained.intent.requestId, retained); }
          remember(remembered.current.map(row => row.intent.requestId === retained.intent.requestId ? retained : row));
        }
        setMessage(refused ? "The generation request was refused. Its source and saved versions are retained for review." : "Generation is unconfirmed. Retry this same request; a new request could generate the output again."); return;
      }
      const ack = translationGenerationRequestAckSchema.parse(raw);
      if (ack.requestId !== retained.intent.requestId) throw new Error("Generation acknowledgement identity differs");
      const found = await readRequest(retained.intent.requestId, run, retained); run.assertCurrent(); setViewed(found); setReadFailed(false);
      try {
        clearPendingGeneration(localStorage, retained); volatile.current.delete(retained.intent.requestId);
        remember(remembered.current.filter(row => row.intent.requestId !== retained.intent.requestId)); restore();
        setMessage("Generation request retained on the server. Review its status and output below.");
      } catch { setMessage("The server retained this request, but browser recovery could not be cleared. Retrying the same request is safe."); }
    } catch { if (run.isCurrent()) setMessage("Generation is unconfirmed. Keep the retained request and retry it with the same identity."); }
    finally { run.finish(); }
  }
  async function start(value: PendingGeneration) {
    if (!ready || busyRef.current || pending.length || unreadable.length || resolution.blocked || resolution.hasPending()) { setOpen(true); return; }
    try {
      const current = readPendingGenerations(localStorage, scope);
      if (current.pending.length || current.unreadable.length) { restore(); setOpen(true); return; }
    } catch { restore(); setOpen(true); return; }
    await send(value);
  }
  async function list(cursor: TranslationGenerationCursor | null = null) {
    if (busyRef.current || !canWrite) return;
    busyRef.current = true; setBusy(true); setOpen(true); setMessage(null);
    const run = operation();
    try {
      const query = cursor ? `?${new URLSearchParams({ beforeCreatedAt: cursor.createdAt, beforeId: cursor.id })}` : "";
      run.assertCurrent();
      const response = await fetch(api + query, { cache: "no-store", signal: run.signal });
      run.assertCurrent();
      if (!response.ok) throw new Error("Saved requests unavailable");
      const raw: unknown = await response.json(); run.assertCurrent();
      const page = readTranslationGenerationCatalog(raw, scope, cursor);
      const requests = cursor && catalog ? [...catalog.requests, ...page.requests] : page.requests;
      if (new Set(requests.map(request => request.id)).size !== requests.length) throw new Error("Saved request pages overlap");
      setCatalog({ ...page, requests });
    } catch { if (run.isCurrent()) setMessage("Saved generation requests could not be read completely. Retry the list; this does not mean there are no saved requests."); }
    finally { run.finish(); }
  }
  async function view(id: string) {
    if (busyRef.current || !canWrite) return;
    busyRef.current = true; setBusy(true); setOpen(true); setMessage(null);
    const run = operation();
    try {
      const found = await readRequest(id, run); run.assertCurrent();
      const listed = catalog?.requests.find(request => request.id === id);
      if (listed && listed.fieldCount !== found.fields.length) throw new Error("Saved generation field count differs");
      setViewed(found); setReadFailed(false);
    } catch { if (run.isCurrent()) { setReadFailed(true); setMessage("This request's retained output could not be verified. Keep any viewed copy and retry its read before publishing."); } }
    finally { run.finish(); }
  }
  async function recover(key: string) {
    if (busyRef.current || !canWrite) return;
    busyRef.current = true; setBusy(true);
    const run = operation();
    try {
      const raw = localStorage.getItem(key); if (raw === null) throw new Error("Stored recovery copy disappeared");
      const id = key.split(":").at(-1)!;
      const known = remembered.current.find(value => pendingGenerationKey(value) === key);
      const found = await readRequest(id, run, known); run.assertCurrent();
      if (found.actorId !== userId || localStorage.getItem(key) !== raw) throw new Error("Saved request or browser copy changed");
      archivePendingGeneration(localStorage, key, scope);
      volatile.current.delete(id); remember(remembered.current.filter(value => value.intent.requestId !== id)); restore();
      setViewed(found); setReadFailed(false); setMessage("The saved request was recovered from the server. Its earlier browser copy remains archived below.");
    } catch { if (run.isCurrent()) setMessage("The saved request could not be matched, or its browser copy changed. The server copy has not been verified. Keep your browser copies and retry recovery or resolve the retained request below."); }
    finally { run.finish(); }
  }
  const completed = viewed?.fields.filter(field => field.state === "completed" && field.output?.status === "completed" && field.output.acceptedState === "completed").map(field => field.id) ?? [];
  const blocked = !ready || pending.length > 0 || unreadable.length > 0 || resolution.blocked;
  const panel = canWrite && <section aria-label="Machine translation requests" className="mt-4 space-y-3 text-sm">
    <Button type="button" variant="outline" className="h-auto min-h-10 max-w-full whitespace-normal" aria-expanded={open} onClick={() => { if (open) setOpen(false); else void list(); }}>
      {open ? "Hide machine translation requests" : "Machine translation requests"}
    </Button>
    {(open || pending.length > 0 || unreadable.length > 0 || message !== null) && <div className="space-y-3 rounded-lg border border-border p-3">
      {message && <p role="status">{message}</p>}
      {!ready && <Button type="button" variant="outline" className="h-auto min-h-10 max-w-full whitespace-normal" onClick={restore}>Retry generation recovery</Button>}
      {pending.map(value => <section key={value.intent.requestId} aria-label="Retained generation request" className="space-y-2 rounded-lg border border-amber-400 p-3 break-words">
        <h3 className="font-semibold">{value.phase === "refused" ? "Refused generation request" : "Unconfirmed generation request"}</h3>
        <p>{TRANSLATION_LANGUAGE_LABELS[value.intent.locale]}. Keep this request&apos;s original source and identity when retrying.</p>
        {value.intent.fields.map(field => <p key={field.id} className="whitespace-pre-wrap">{field.address.field}: {field.address.expectedSource.text}</p>)}
        <div className="flex flex-wrap gap-2"><Button type="button" disabled={busy || resolution.blocked} className="h-auto min-h-10 max-w-full whitespace-normal" onClick={() => void send(value)}>Retry same generation request</Button>
          <Button type="button" variant="outline" className="h-auto min-h-10 max-w-full whitespace-normal" onClick={() => download(JSON.stringify(value, null, 2), `translation-generation-${value.intent.requestId}.json`)}>Download generation request</Button>
          <Button type="button" variant="outline" disabled={busy} className="h-auto min-h-10 max-w-full whitespace-normal" onClick={() => resolution.begin(pendingGenerationKey(value), JSON.stringify(value))}>Review request resolution</Button></div>
      </section>)}
      {unreadable.map(key => <div key={key} className="space-y-2 break-words"><p role="alert">A generation recovery copy could not be read or differs from this page&apos;s request. Preserve both copies and check saved requests before generating again.</p>
        <Button type="button" variant="outline" className="h-auto min-h-10 max-w-full whitespace-normal" onClick={() => { try { const raw = localStorage.getItem(key); if (raw !== null) download(raw, "unreadable-generation-request.json"); }
          catch { setMessage("The stored generation copy could not be read. Keep this page open and retry recovery."); } }}>Download stored generation copy</Button>
        <Button type="button" variant="outline" disabled={busy} className="h-auto min-h-10 max-w-full whitespace-normal" onClick={() => void recover(key)}>Recover saved generation request</Button>
        <Button type="button" variant="outline" disabled={busy} className="h-auto min-h-10 max-w-full whitespace-normal" onClick={() => resolution.begin(key, remembered.current.find(value => pendingGenerationKey(value) === key) ? JSON.stringify(remembered.current.find(value => pendingGenerationKey(value) === key)) : undefined)}>Review damaged request resolution</Button>
      </div>)}
      {archives.length > 0 && <details><summary>Earlier generation requests ({archives.length})</summary>
        {archives.map((copy,index) => <Button key={copy.key} type="button" variant="outline" className="m-1 h-auto min-h-10 max-w-full whitespace-normal" onClick={() => download(copy.raw, `earlier-generation-${index + 1}.json`)}>Download earlier generation request {index + 1}</Button>)}
      </details>}
      <Button type="button" variant="outline" disabled={busy} className="h-auto min-h-10 max-w-full whitespace-normal" onClick={() => void list()}>Refresh saved generation requests</Button>
      {catalog && <><p>{catalog.requests.length ? "Saved requests at the last refresh:" : "No saved generation requests were returned."}</p>
        <ul className="space-y-2">{catalog.requests.map(request => <li key={request.id}>
          <Button type="button" variant="outline" disabled={busy} className="h-auto min-h-10 max-w-full whitespace-normal text-left" onClick={() => void view(request.id)}>
            {TRANSLATION_LANGUAGE_LABELS[request.locale]} · {new Date(request.createdAt).toLocaleString()} · {request.counts.completed} of {request.fieldCount} fields completed
          </Button>
        </li>)}</ul>
        {catalog.next && <Button type="button" variant="outline" disabled={busy} className="h-auto min-h-10 max-w-full whitespace-normal" onClick={() => void list(catalog.next)}>Load older generation requests</Button>}</>}
      {viewed && <section aria-label="Retained machine output" className="space-y-3 border-t border-border pt-3">
        <h3 className="font-semibold">{TRANSLATION_LANGUAGE_LABELS[viewed.locale]} output for review</h3>
        <p>{viewed.actorId === userId ? "Requested by you." : "Requested by another staff member."} Publication records you separately as the publisher.</p>
        <p>Review the retained output and its original source. Add a publication reason above before publishing with a machine label.</p>
        <Button type="button" variant="outline" disabled={busy} className="h-auto min-h-10 max-w-full whitespace-normal" onClick={() => void view(viewed.requestId)}>Refresh request status</Button>
        <details><summary>Request record</summary><p className="break-all">Request: {viewed.requestId}</p><p className="break-all">Requested by: {viewed.actorId}</p><p>{new Date(viewed.createdAt).toLocaleString()}</p></details>
        {viewed.fields.map(field => <div key={field.id} className="space-y-2 rounded-lg border border-border p-3 break-words">
          <h4 className="font-semibold">{field.address.field.replaceAll("_", " ")}: {stateNames[field.state]}</h4>
          <p>Source used:</p><p className="whitespace-pre-wrap" lang={field.address.expectedSource.sourceLocale ?? undefined} dir="auto">{field.address.expectedSource.text}</p>
          <p>{field.address.expectedTranslation ? `Started from saved revision ${field.address.expectedTranslation.revision}.` : "No saved translation existed at the start."}</p>
          {field.output && <><p className="whitespace-pre-wrap" lang={viewed.locale} dir={isPortalLocale(viewed.locale) ? PORTAL_LOCALE_DIRECTION[viewed.locale] : "auto"}>{field.output.text}</p><p>Model: {field.output.model}</p></>}
          {completed.includes(field.id) && <Button type="button" disabled={busy || publicationBlocked || readFailed} className="h-auto min-h-10 max-w-full whitespace-normal" onClick={() => void callbacks.current.onPublish(viewed, [field.id])}>Publish this retained output with a machine label</Button>}
        </div>)}
        {completed.length > 1 && <Button type="button" disabled={busy || publicationBlocked || readFailed} className="h-auto min-h-10 max-w-full whitespace-normal" onClick={() => void callbacks.current.onPublish(viewed, completed)}>Publish all {completed.length} completed fields with machine labels</Button>}
      </section>}
    </div>}
    {resolution.panel}
  </section>;
  return { start, panel, busy, blocked };
}
