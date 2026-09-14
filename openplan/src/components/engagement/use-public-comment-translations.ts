"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { publicTranslationResponseSchema } from "@/lib/engagement/public-translation-contract";
import { isTranslationLanguage, type TranslationLanguage } from "@/lib/engagement/translation-languages";

type Item = { id: string; title: string | null; body: string };
type State = {
  shareToken: string; language: TranslationLanguage; original: string; sourceHash: string | null; requestId: string | null;
  text: string | null; status: "loading" | "pending" | "done" | "failed" | "missing" | "unconfirmed" | "unavailable";
};
type Operation = { controller: AbortController; original: string; timer?: ReturnType<typeof setTimeout> };
function stop(operation: Operation) { operation.controller.abort(); if (operation.timer) clearTimeout(operation.timer); }

// Requests are shared for the same public original/language. Leaving a page or
// choosing Original cancels this reader's observation, not another reader's job.
export function usePublicCommentTranslations(shareToken: string, items: readonly Item[], previewMode: boolean) {
  const [translations, setTranslations] = useState<Record<string, State>>({});
  const active = useRef(new Map<string, Operation>()), mounted = useRef(false);
  const versions = useMemo(() => new Map(items.map(item => [item.id, JSON.stringify([item.title, item.body])])), [items]);
  const current = useRef({ shareToken, versions, previewMode });
  useLayoutEffect(() => { current.current = { shareToken, versions, previewMode }; }, [shareToken, versions, previewMode]);
  const versionsKey = JSON.stringify([...versions]);
  const stateKey = JSON.stringify([shareToken, previewMode, versionsKey]);
  const [previousKey, setPreviousKey] = useState(stateKey);
  if (previousKey !== stateKey) {
    setPreviousKey(stateKey);
    setTranslations(previous => previewMode ? {} : Object.fromEntries(Object.entries(previous).filter(([id, value]) =>
      value.shareToken === shareToken && versions.get(id) === value.original)));
  }
  useLayoutEffect(() => { const operations = active.current; mounted.current = true; return () => { mounted.current = false; for (const operation of operations.values()) stop(operation); operations.clear(); }; }, []);
  useEffect(() => {
    for (const operation of active.current.values()) stop(operation); active.current.clear();
  }, [shareToken, previewMode]);
  useEffect(() => {
    for (const [id, operation] of active.current) if (current.current.versions.get(id) !== operation.original) { stop(operation); active.current.delete(id); }
  }, [versionsKey]);

  function clearTranslation(itemId: string) {
    const operation = active.current.get(itemId); if (operation) stop(operation); active.current.delete(itemId);
    setTranslations(previous => { const next = { ...previous }; delete next[itemId]; return next; });
  }
  async function run(itemId: string, language: TranslationLanguage, mode: "create" | "read" | "retry", previous?: State) {
    const original = current.current.versions.get(itemId);
    if (previewMode || !mounted.current || original === undefined || !isTranslationLanguage(language)) return;
    const old = active.current.get(itemId); if (old) stop(old);
    const operation: Operation = { controller: new AbortController(), original }; active.current.set(itemId, operation);
    const isCurrent = () => mounted.current && !operation.controller.signal.aborted && active.current.get(itemId) === operation &&
      current.current.shareToken === shareToken && !current.current.previewMode && current.current.versions.get(itemId) === original;
    let state: State = { shareToken, language, original, sourceHash: previous?.sourceHash ?? null,
      requestId: mode === "read" ? previous?.requestId ?? null : null, text: null, status: "loading" };
    const update = (value: Partial<State>) => { if (!isCurrent()) return; state = { ...state, ...value }; setTranslations(current => ({ ...current, [itemId]: state })); };
    update({});
    const base = `/api/engage/${encodeURIComponent(shareToken)}/items/${itemId}/translate`;
    async function request(method: "POST" | "GET", remaining: number) {
      if (!isCurrent()) return;
      try {
        const query = new URLSearchParams({ language, sourceHash: state.sourceHash! });
        if (method === "GET" && state.requestId !== null) query.set("requestId", state.requestId);
        const response = await fetch(method === "GET" ? `${base}?${query}` : base, { method, signal: operation.controller.signal,
          cache: "no-store", ...(method === "POST" ? { headers: { "content-type": "application/json" }, body: JSON.stringify({ language, sourceHash: state.sourceHash,
            ...(mode === "retry" ? { retryOf: previous!.requestId } : {}) }) } : {}) });
        if (!isCurrent()) return;
        if (!response.ok) { update({ status: [400, 403, 404, 409].includes(response.status) ? "unavailable" : "unconfirmed" }); return; }
        const payload = publicTranslationResponseSchema.safeParse(await response.json());
        if (!isCurrent()) return;
        if (!payload.success || payload.data.sourceHash !== state.sourceHash ||
          (payload.data.source === "queue" ? payload.data.request.language : payload.data.language) !== language ||
          (payload.data.source === "queue" && method === "GET" && state.requestId !== null && payload.data.request.requestId !== state.requestId)) {
          update({ status: "unconfirmed" }); return;
        }
        const value = payload.data;
        if (value.source === "cache") { update({ status: "done", text: value.translated }); return; }
        if (value.source === "missing") { update({ status: "missing", requestId: null }); return; }
        if (value.source === "unavailable") { update({ status: "unavailable" }); return; }
        const job = value.request;
        update({ requestId: job.requestId, text: job.translated,
          status: job.state === "completed" ? "done" : ["queued", "reserved", "running"].includes(job.state) ? "pending" : "failed" });
        if (state.status === "pending" && remaining > 0 && !document.hidden) {
          operation.timer = setTimeout(() => { void request("GET", remaining - 1); }, 2000);
        }
      } catch { update({ status: "unconfirmed" }); }
    }
    try {
      if (state.sourceHash === null) {
        const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(original));
        if (!isCurrent()) return;
        update({ sourceHash: Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("") });
      }
      await request(mode === "read" ? "GET" : "POST", 10);
    } catch { update({ status: "unavailable" }); }
  }
  function translateComment(itemId: string, language: TranslationLanguage) { return run(itemId, language, "create"); }
  function checkTranslation(itemId: string) {
    const previous = translations[itemId]; if (!previous?.sourceHash || previous.status === "loading") return;
    return run(itemId, previous.language, "read", previous);
  }
  function retryTranslation(itemId: string) {
    const previous = translations[itemId]; if (!previous?.sourceHash || !["failed", "missing"].includes(previous.status)) return;
    if (previous.status === "failed" && previous.requestId === null) return;
    return run(itemId, previous.language, previous.status === "failed" ? "retry" : "create", previous);
  }
  return { translations, translateComment, clearTranslation, checkTranslation, retryTranslation };
}
