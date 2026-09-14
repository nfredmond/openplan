"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { GenerationEditorScope } from "@/lib/engagement/translation-generation-editor";
import { translationGenerationResolutionPacketSchema } from "@/lib/engagement/translation-generation-resolution";
import { archiveResolvedGeneration, pendingResolutionKey, preparePendingResolution, readResolutionRecovery,
  retainPendingResolution, resolutionHasCopy, verifyBrowserResolution, type PendingResolution } from "@/lib/engagement/translation-resolution-recovery";

const buttonClass = "h-auto min-h-10 max-w-full whitespace-normal";
const reason = "Resolve this retained generation request and preserve its recovery copies.";
type RecoveryState = ReturnType<typeof readResolutionRecovery>;
const empty: RecoveryState = { pending: [], unreadable: [], archives: [] };

/** Resolve uncertain identities with durable copies, exact retries and checked receipts. */
export function useTranslationResolution(scope: GenerationEditorScope, options: {
  canWrite: boolean; busy: boolean; acquire: () => boolean; release: () => void;
  onResolved: (bundle: PendingResolution) => void; download: (raw: string, name: string) => void;
}) {
  const [saved, setSaved] = useState<RecoveryState>(empty), [ready, setReady] = useState(false);
  const [candidate, setCandidate] = useState<PendingResolution | null>(null), [message, setMessage] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null), mounted = useRef(false);
  const held = useRef(new Map<string, PendingResolution>());
  const identity = `${scope.userId}:${scope.workspaceId}:${scope.campaignId}`;
  const current = useRef({ identity, canWrite: options.canWrite }); current.current = { identity, canWrite: options.canWrite };

  function restore() {
    try {
      const state = readResolutionRecovery(localStorage, scope), values = new Map(state.pending.map(value => [pendingResolutionKey(value), value]));
      const unreadable = new Set(state.unreadable);
      for (const [key, value] of held.current) {
        const stored = values.get(key);
        if (localStorage.getItem(key) !== null && (!stored || JSON.stringify(stored) !== JSON.stringify(value))) unreadable.add(key);
        values.set(key, value);
      }
      for (const [key, value] of values) held.current.set(key, value);
      const merged = { ...state, pending: [...values.values()], unreadable: [...unreadable] };
      setSaved(merged); setReady(true); return merged;
    }
    catch { setReady(false); setMessage("Resolution recovery could not be read. Keep this page open and download your copies before retrying."); return null; }
  }
  useEffect(() => {
    mounted.current = true; restore(); window.addEventListener("storage", restore);
    return () => { mounted.current = false; active.current?.abort(); window.removeEventListener("storage", restore); };
    // The parent editor is keyed by authenticated user, workspace and campaign.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity]);

  const { canWrite, release } = options;
  useEffect(() => {
    const controller = active.current;
    if (canWrite || !controller) return;
    controller.abort();
    active.current = null;
    release();
  }, [canWrite, release]);

  function hasPending() {
    const state = restore();
    return candidate !== null || state === null || state.pending.length > 0 || state.unreadable.length > 0;
  }
  function begin(key: string, pageCopy?: string) {
    if (!options.canWrite || options.busy || active.current || candidate) return;
    try {
      const state = restore(); if (state === null) return;
      if (state.pending.some(value => value.sourceKey === key)) { setMessage("Retry the resolution already retained below."); return; }
      setCandidate(preparePendingResolution(localStorage, scope, key, reason, pageCopy ?? (held.current.has(key) ? JSON.stringify(held.current.get(key)) : undefined))); setMessage(null);
    } catch { setMessage("The original recovery copy could not be prepared. Keep this page open and download every available copy before retrying."); }
  }
  async function send(bundle: PendingResolution) {
    if (!options.canWrite || active.current || !options.acquire()) return;
    const controller = new AbortController(); active.current = controller;
    const isCurrent = () => mounted.current && current.current.identity === identity && current.current.canWrite && active.current === controller;
    const assertCurrent = () => { if (!isCurrent()) throw new Error("Resolution editor scope changed"); controller.signal.throwIfAborted(); };
    try {
      assertCurrent();
      if (bundle.userId !== scope.userId || bundle.workspaceId !== scope.workspaceId || bundle.campaignId !== scope.campaignId) throw new Error("Resolution scope differs");
      const retained = retainPendingResolution(localStorage, bundle);
      held.current.set(pendingResolutionKey(retained), retained); setCandidate(null); restore(); setMessage(null);
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]);
      const receipts = [];
      for (let index = 0; index < retained.intents.length; index++) {
        assertCurrent();
        const response = await fetch(`/api/engagement/campaigns/${scope.campaignId}/translations/generation/resolutions`, {
          method: "POST", cache: "no-store", signal,
          headers: { "content-type": "application/json", "x-openplan-expected-user": scope.userId, "x-openplan-expected-workspace": scope.workspaceId },
          body: JSON.stringify(retained.intents[index]),
        });
        assertCurrent();
        if (!response.ok) throw new Error("Resolution was not confirmed");
        const raw: unknown = await response.json(); assertCurrent();
        const packet = translationGenerationResolutionPacketSchema.parse(raw);
        await verifyBrowserResolution(packet, retained, index); assertCurrent(); receipts.push(packet);
      }
      const archived = await archiveResolvedGeneration(localStorage, retained, receipts, assertCurrent);
      assertCurrent();
      held.current.delete(pendingResolutionKey(retained));
      for (const [key, value] of held.current) if (resolutionHasCopy(retained, JSON.stringify(value))) held.current.delete(key);
      options.onResolved(retained); restore();
      setMessage(archived.sourceChanged
        ? "Resolution confirmed and copies archived. A different browser copy remains for review. Waiting work was cancelled; work already running may still finish. Existing output remains saved."
        : "Resolution confirmed and copies archived. Waiting work was cancelled; work already running may still finish. Existing output remains saved. Refresh saved requests to review it. A new generation is a separate action.");
    } catch {
      if (isCurrent()) { restore(); setMessage("Resolution is unconfirmed or its archive could not be saved. Keep this page open, download your copies, and retry the same resolution. Do not start a replacement request."); }
    } finally {
      if (active.current === controller) { active.current = null; if (mounted.current && current.current.identity === identity) options.release(); }
    }
  }
  function downloadStored(key: string) {
    try { const raw = localStorage.getItem(key); if (raw === null) throw new Error(); options.download(raw, "translation-resolution-recovery.json"); }
    catch { setMessage("This stored copy could not be read. Keep this page open and download any page-held copy."); }
  }
  const panel = options.canWrite && <section aria-label="Generation resolution recovery" className="space-y-3 text-sm">
    {message && <p role="status">{message}</p>}
    {!ready && <Button type="button" variant="outline" className={buttonClass} onClick={restore}>Retry resolution recovery</Button>}
    {candidate && <section aria-label="Confirm generation resolution" className="space-y-2 rounded-lg border border-amber-400 p-3 break-words">
      <h3 className="font-semibold">Close this retained request?</h3>
      <p>Waiting work will be cancelled. Work already running may still finish. Existing output and history will remain saved. The original request cannot start again.</p>
      <p>Your {candidate.intents.length === 1 ? "recovery copy will" : "two recovery copies will"} be retained with the resolution receipt. Generating replacement output is a separate action.</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={options.busy} className={buttonClass} onClick={() => void send(candidate)}>Confirm resolution and preserve copies</Button>
        <Button type="button" variant="outline" className={buttonClass} onClick={() => options.download(JSON.stringify(candidate), "translation-resolution-request.json")}>Download proposed resolution</Button>
        <Button type="button" variant="outline" disabled={options.busy} className={buttonClass} onClick={() => setCandidate(null)}>Keep request unresolved</Button>
      </div>
    </section>}
    {saved.pending.map(bundle => <section key={pendingResolutionKey(bundle)} aria-label="Retained generation resolution" className="space-y-2 rounded-lg border border-amber-400 p-3 break-words">
      <p>A resolution needs confirmation or archive recovery. Retry with the same identity to preserve its original outcome.</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={options.busy} className={buttonClass} onClick={() => void send(bundle)}>Retry same resolution</Button>
        <Button type="button" variant="outline" className={buttonClass} onClick={() => options.download(JSON.stringify(bundle), "translation-resolution-request.json")}>Download retained resolution</Button>
      </div>
    </section>)}
    {saved.unreadable.map(key => <div key={key} className="space-y-2 break-words">
      <p role="alert">A retained resolution copy could not be read. Preserve it before resolving its original request again.</p>
      <Button type="button" variant="outline" className={buttonClass} onClick={() => downloadStored(key)}>Download unreadable resolution</Button>
      <Button type="button" variant="outline" disabled={options.busy || candidate !== null} className={buttonClass} onClick={() => begin(key)}>Review resolution recovery</Button>
    </div>)}
    {saved.archives.length > 0 && <details><summary>Archived generation resolutions ({saved.archives.length})</summary>
      {saved.archives.map((copy, index) => <Button key={copy.key} type="button" variant="outline" className={`m-1 ${buttonClass}`} onClick={() => options.download(copy.raw, `translation-resolution-archive-${index + 1}.json`)}>Download archived resolution {index + 1}</Button>)}
    </details>}
  </section>;
  return { begin, hasPending, panel, blocked: !ready || candidate !== null || saved.pending.length > 0 || saved.unreadable.length > 0 };
}
