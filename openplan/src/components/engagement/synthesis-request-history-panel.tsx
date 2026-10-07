"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { SynthesisPreparationPanel } from "./synthesis-preparation-panel";
import { SynthesisGenerationCancellationInspector } from "./synthesis-generation-cancellation-inspector";
import { readSynthesisHistory } from "@/lib/engagement/synthesis-history-read";
import {
  verifySynthesisRequestHistory, type SynthesisRequestHistoryCursor,
  type SynthesisRequestHistoryPage, type SynthesisRequestHistoryScope,
} from "@/lib/engagement/synthesis-request-history";

type Props = SynthesisRequestHistoryScope & { userId: string; onAccessLost: () => void };
const stages = { segment: "Contribution analysis", context: "Combined context", thematic: "Themes" };

/** Keep private history within one current account and saved source. Listing a
 * request establishes neither preparation completion nor permission to execute it.
 */
export function SynthesisRequestHistoryPanel(props: Props) {
  return <History key={`${props.userId}:${props.workspaceId}:${props.campaignId}:${props.sourceId}:${props.sourceSha256}`} {...props} />;
}

function History({ userId, workspaceId, campaignId, sourceId, sourceSha256, onAccessLost }: Props) {
  const [entries, setEntries] = useState<SynthesisRequestHistoryPage["entries"] | null>(null);
  const [cursor, setCursor] = useState<SynthesisRequestHistoryCursor | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null);
  const load = useCallback(async (before: SynthesisRequestHistoryCursor | null = null) => {
    active.current?.abort();
    const controller = new AbortController(); active.current = controller;
    const isCurrent = () => active.current === controller && !controller.signal.aborted;
    setBusy(true); setError(null); setSelected(null);
    if (!before) { setEntries(null); setCursor(null); }
    try {
      const query = new URLSearchParams({ sourceId, sourceSha256 });
      if (before) { query.set("beforeId", before.id); query.set("beforeCreatedAt", before.createdAt); }
      const response = await readSynthesisHistory(`/api/engagement/campaigns/${campaignId}/synthesis/generation/history?${query}`, {
        userId, workspaceId, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]), isCurrent,
      });
      if (response.status === 401 || response.status === 403) {
        setEntries(null); setCursor(null); onAccessLost();
        throw new Error("Staff access could not be confirmed. Reopen this consultation to check access.");
      }
      if (!response.ok) throw new Error("Saved generation requests could not be read. Retry the list; this does not mean there are no requests.");
      const page = verifySynthesisRequestHistory(await response.json(), { workspaceId, campaignId, sourceId, sourceSha256 }, before);
      if (!isCurrent()) return;
      setEntries(previous => before ? [...(previous ?? []), ...page.entries] : page.entries);
      setCursor(page.nextCursor);
    } catch {
      if (isCurrent()) {
        setEntries(null); setCursor(null);
        setError("Saved generation requests could not be confirmed. Refresh the list to check current access and the saved source.");
      }
    } finally { if (isCurrent()) setBusy(false); }
  }, [userId, workspaceId, campaignId, sourceId, sourceSha256, onAccessLost]);

  useEffect(() => {
    void load();
    return () => { active.current?.abort(); active.current = null; };
  }, [load]);

  return <section aria-label="Saved generation requests" className="min-w-0 space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="font-semibold">Saved generation requests</h3>
      <Button type="button" variant="outline" disabled={busy} onClick={() => void load()}>Refresh generation requests</Button>
    </div>
    <p className="max-w-prose text-sm text-muted-foreground">Requests for this saved source, newest first. A saved request does not mean analysis has finished. Cancellation does not remove earlier results.</p>
    {busy ? <p role="status">Reading saved generation requests…</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {entries?.length === 0 ? <p>No generation requests were found for this saved source.</p> : null}
    <ul className="divide-y divide-border">{entries?.map(entry => <li key={entry.requestId} className="min-w-0 space-y-2 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="font-medium">{stages[entry.stage]}</span>
        <span className="text-sm">{entry.cancelled ? "Cancellation recorded" : "Request saved"}</span>
      </div>
      <p className="text-sm text-muted-foreground"><time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString("en-US")}</time>{entry.actorId === userId ? " · Requested by you" : " · Requested by another staff account"}</p>
      <details className="text-sm">
        <summary className="cursor-pointer py-1">Request details {entry.requestId.slice(0, 8)}</summary>
        <dl className="mt-2 grid min-w-0 gap-1 break-all sm:grid-cols-[8rem_minmax(0,1fr)]">
          <dt className="text-muted-foreground">Request</dt><dd>{entry.requestId}</dd>
          <dt className="text-muted-foreground">Staff account</dt><dd>{entry.actorId}</dd>
          <dt className="text-muted-foreground">Source</dt><dd>{sourceId}</dd>
          {entry.parentRequestId ? <><dt className="text-muted-foreground">Parent request</dt><dd>{entry.parentRequestId}</dd></> : null}
          <dt className="text-muted-foreground">Intent SHA-256</dt><dd>{entry.intentSha256}</dd>
        </dl>
      </details>
      <Button type="button" variant="outline" disabled={busy} aria-expanded={selected === entry.requestId}
        onClick={() => setSelected(current => current === entry.requestId ? null : entry.requestId)}>
        {selected === entry.requestId ? "Close preparation" : "Inspect preparation"} {entry.requestId.slice(0, 8)}
      </Button>
      {selected === entry.requestId ? <><SynthesisPreparationPanel userId={userId} workspaceId={workspaceId} campaignId={campaignId}
        sourceId={sourceId} sourceSha256={sourceSha256} requestId={entry.requestId} intentSha256={entry.intentSha256}
        stage={entry.stage} actorId={entry.actorId} cancelled={entry.cancelled} onAccessLost={onAccessLost} />
        <SynthesisGenerationCancellationInspector userId={userId} workspaceId={workspaceId} campaignId={campaignId}
          sourceId={sourceId} sourceSha256={sourceSha256} requestId={entry.requestId} intentSha256={entry.intentSha256} actorId={entry.actorId}
          onAccessLost={onAccessLost} onCancelled={() => setEntries(current => current?.map(row => row.requestId === entry.requestId ? { ...row, cancelled: true } : row) ?? null)} />
      </> : null}
    </li>)}</ul>
    {cursor ? <Button type="button" variant="outline" disabled={busy} onClick={() => void load(cursor)}>Load older generation requests</Button> : null}
  </section>;
}
