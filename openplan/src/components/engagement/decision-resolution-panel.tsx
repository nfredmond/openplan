"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { DecisionResolutionScope } from "@/lib/engagement/decision-request-resolution";
import { decisionResolutionPacketSchema, readDecisionResolution } from "@/lib/engagement/decision-request-resolution";
import { archiveDecisionResolution, pendingDecisionResolutionKey, prepareDecisionResolution, readDecisionResolutionRecovery,
  retainDecisionResolution, decisionResolutionHasCopy, type PendingDecisionResolution } from "@/lib/engagement/decision-resolution-recovery";

const buttonClass = "h-auto min-h-10 max-w-full whitespace-normal";
const reason = "Resolve this retained decision request and preserve its recovery copies.";
type RecoveryState = ReturnType<typeof readDecisionResolutionRecovery>;
const empty: RecoveryState = { pending: [], unreadable: [], archives: [] };

/** Resolve uncertain identities with durable copies, exact retries and checked receipts. */
export function useDecisionResolution(scope: DecisionResolutionScope, options: {
  canWrite: boolean; busy: boolean; acquire: () => boolean; release: () => void;
  onResolved: (bundle: PendingDecisionResolution) => void; download: (raw: string, name: string) => void;
}) {
  const [saved, setSaved] = useState<RecoveryState>(empty), [ready, setReady] = useState(false);
  const [candidate, setCandidate] = useState<PendingDecisionResolution | null>(null), [message, setMessage] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null), mounted = useRef(false);
  const held = useRef(new Map<string, PendingDecisionResolution>());
  const identity = `${scope.actorId}:${scope.workspaceId}:${scope.campaignId}`;
  const current = useRef({ identity, canWrite: options.canWrite }); current.current = { identity, canWrite: options.canWrite };

  function restore() {
    try {
      const state = readDecisionResolutionRecovery(localStorage, scope), values = new Map(state.pending.map(value => [pendingDecisionResolutionKey(value), value]));
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
      setCandidate(prepareDecisionResolution(localStorage, scope, key, reason, pageCopy ?? (held.current.has(key) ? JSON.stringify(held.current.get(key)) : undefined))); setMessage(null);
    } catch { setMessage("The original recovery copy could not be prepared. Keep this page open and download every available copy before retrying."); }
  }
  async function send(bundle: PendingDecisionResolution) {
    if (!options.canWrite || active.current || !options.acquire()) return;
    const controller = new AbortController(); active.current = controller;
    const isCurrent = () => mounted.current && current.current.identity === identity && current.current.canWrite && active.current === controller;
    const assertCurrent = () => { if (!isCurrent()) throw new Error("Resolution editor scope changed"); controller.signal.throwIfAborted(); };
    try {
      assertCurrent();
      if (bundle.actorId !== scope.actorId || bundle.workspaceId !== scope.workspaceId || bundle.campaignId !== scope.campaignId) throw new Error("Resolution scope differs");
      const retained = retainDecisionResolution(localStorage, bundle);
      held.current.set(pendingDecisionResolutionKey(retained), retained); setCandidate(null); restore(); setMessage(null);
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]);
      const receipts = [];
      for (let index = 0; index < retained.intents.length; index++) {
        assertCurrent();
        const response = await fetch(`/api/engagement/campaigns/${scope.campaignId}/decision-links/resolutions`, {
          method: "POST", cache: "no-store", signal,
          headers: { "content-type": "application/json", "x-openplan-expected-user": scope.actorId, "x-openplan-expected-workspace": scope.workspaceId },
          body: JSON.stringify(retained.intents[index]),
        });
        assertCurrent();
        if (!response.ok) throw new Error("Resolution was not confirmed");
        const raw: unknown = await response.json(); assertCurrent();
        const packet = decisionResolutionPacketSchema.parse(raw);
        await readDecisionResolution(packet, scope, retained.intents[index]); assertCurrent(); receipts.push(packet);
      }
      const archived = await archiveDecisionResolution(localStorage, retained, receipts, assertCurrent);
      assertCurrent();
      held.current.delete(pendingDecisionResolutionKey(retained));
      for (const [key, value] of held.current) if (decisionResolutionHasCopy(retained, JSON.stringify(value))) held.current.delete(key);
      options.onResolved(retained); restore();
      setMessage(archived.sourceChanged
        ? "Recovery confirmed and copies archived. A different browser copy remains for review. Existing decision links remain saved."
        : "Recovery confirmed and copies archived. An unsaved request cannot arrive late; an existing saved link keeps its original evidence. Review decision history before a new link.");
    } catch {
      if (isCurrent()) { restore(); setMessage("Resolution is unconfirmed or its archive could not be saved. Keep this page open, download your copies, and retry the same resolution. Do not start a replacement request."); }
    } finally {
      if (active.current === controller) { active.current = null; if (mounted.current && current.current.identity === identity) options.release(); }
    }
  }
  function downloadStored(key: string) {
    try { const raw = localStorage.getItem(key); if (raw === null) throw new Error(); options.download(raw, "decision-resolution-recovery.json"); }
    catch { setMessage("This stored copy could not be read. Keep this page open and download any page-held copy."); }
  }
  const panel = options.canWrite && <section aria-label="Decision request recovery" className="space-y-3 text-sm">
    {message && <p role="status">{message}</p>}
    {!ready && <Button type="button" variant="outline" className={buttonClass} onClick={restore}>Retry resolution recovery</Button>}
    {candidate && <section aria-label="Confirm decision recovery" className="space-y-2 rounded-lg border border-amber-400 p-3 break-words">
      <h3 className="font-semibold">Close this retained request?</h3>
      <p>If the link was saved, its original evidence will be recovered. Otherwise this request will be cancelled so a late retry cannot save it. Existing links and history stay unchanged.</p>
      <p>Your {candidate.intents.length === 1 ? "recovery copy will" : "two recovery copies will"} be retained with the resolution receipt. Saving a new link is a separate action.</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={options.busy} className={buttonClass} onClick={() => void send(candidate)}>Confirm resolution and preserve copies</Button>
        <Button type="button" variant="outline" className={buttonClass} onClick={() => options.download(JSON.stringify(candidate), "decision-resolution-request.json")}>Download proposed resolution</Button>
        <Button type="button" variant="outline" disabled={options.busy} className={buttonClass} onClick={() => setCandidate(null)}>Keep request unresolved</Button>
      </div>
    </section>}
    {saved.pending.map(bundle => <section key={pendingDecisionResolutionKey(bundle)} aria-label="Retained decision recovery" className="space-y-2 rounded-lg border border-amber-400 p-3 break-words">
      <p>A resolution needs confirmation or archive recovery. Retry with the same identity to preserve its original outcome.</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={options.busy} className={buttonClass} onClick={() => void send(bundle)}>Retry same resolution</Button>
        <Button type="button" variant="outline" className={buttonClass} onClick={() => options.download(JSON.stringify(bundle), "decision-resolution-request.json")}>Download retained resolution</Button>
      </div>
    </section>)}
    {saved.unreadable.map(key => <div key={key} className="space-y-2 break-words">
      <p role="alert">A retained resolution copy could not be read. Preserve it before resolving its original request again.</p>
      <Button type="button" variant="outline" className={buttonClass} onClick={() => downloadStored(key)}>Download unreadable resolution</Button>
      <Button type="button" variant="outline" disabled={options.busy || candidate !== null} className={buttonClass} onClick={() => begin(key)}>Review resolution recovery</Button>
    </div>)}
    {saved.archives.length > 0 && <details><summary>Archived decision recoveries ({saved.archives.length})</summary>
      {saved.archives.map((copy, index) => <Button key={copy.key} type="button" variant="outline" className={`m-1 ${buttonClass}`} onClick={() => options.download(copy.raw, `decision-resolution-archive-${index + 1}.json`)}>Download archived resolution {index + 1}</Button>)}
    </details>}
  </section>;
  return { begin, hasPending, panel, blocked: !ready || candidate !== null || saved.pending.length > 0 || saved.unreadable.length > 0 };
}
