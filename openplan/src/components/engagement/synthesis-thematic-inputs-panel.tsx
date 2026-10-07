"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { readSynthesisHistory } from "@/lib/engagement/synthesis-history-read";
import { inspectThematicContributionPage, type ThematicInputScope } from "@/lib/engagement/synthesis-thematic-choice-discovery";
import { SynthesisThematicContextChoice } from "./synthesis-thematic-context-choice";

type Page = Awaited<ReturnType<typeof inspectThematicContributionPage>>;
type Row = Page["page"]["entries"][number] & { choice: Page["choices"][number] };
type Props = ThematicInputScope & { userId: string; onAccessLost: () => void; onReadyChange: (ready: boolean) => void };
type Loaded = { rows: Row[]; total: number; next: number | null; thematicSha256: string; parentKey: string };

/** Confirm whole-source choice coverage without treating those choices as a seal
 * or as staff approval of generated wording. Native preparation rechecks both.
 */
export function SynthesisThematicInputsPanel(props: Props) {
  return <Inputs key={`${props.userId}:${props.workspaceId}:${props.campaignId}:${props.sourceId}:${props.sourceSha256}:${props.requestId}:${props.requestIntentSha256}:${props.actorId}`} {...props} />;
}

function Inputs({ userId, workspaceId, campaignId, sourceId, sourceSha256, requestId, requestIntentSha256, actorId, onAccessLost, onReadyChange }: Props) {
  const scope = useMemo(() => ({ workspaceId, campaignId, sourceId, sourceSha256, requestId, requestIntentSha256, actorId }),
    [workspaceId, campaignId, sourceId, sourceSha256, requestId, requestIntentSha256, actorId]);
  const [expanded, setExpanded] = useState(false), [data, setData] = useState<Loaded | null>(null), [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null), retained = useRef<Loaded | null>(null);
  const update = useCallback((value: Loaded | null) => { retained.current = value; setData(value); }, []);
  const loseAccess = useCallback(() => { active.current?.abort(); update(null); setSelected(null); setBusy(false); onAccessLost(); }, [update, onAccessLost]);
  const load = useCallback(async (offset = 0) => {
    active.current?.abort(); const controller = new AbortController(); active.current = controller;
    const isCurrent = () => active.current === controller && !controller.signal.aborted;
    setBusy(true); setError(null); setSelected(null); if (!offset) update(null);
    try {
      const query = new URLSearchParams({ mode: "contributions", requestId, offset: String(offset) });
      const response = await readSynthesisHistory(`/api/engagement/campaigns/${campaignId}/synthesis/thematic-choices?${query}`, {
        userId, workspaceId, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(35_000)]), isCurrent,
      });
      if (!isCurrent()) return;
      if ([401, 403].includes(response.status)) { loseAccess(); return; }
      if (!response.ok) throw new Error("Contribution choices are unavailable. Refresh this read before preparing themes.");
      const page = await inspectThematicContributionPage(await response.json(), scope, offset);
      if (!isCurrent()) return;
      const previous = retained.current, parentKey = JSON.stringify(page.page.parent);
      if (offset && (!previous || previous.rows.length !== offset || previous.total !== page.page.total ||
        previous.thematicSha256 !== page.thematicSha256 || previous.parentKey !== parentKey ||
        page.page.entries.some(row => previous.rows.some(old => old.recordId === row.recordId)))) throw new Error("Contribution page changed");
      const rows = page.page.entries.map((row, index) => ({ ...row, choice: page.choices[index] }));
      update({ rows: offset ? [...previous!.rows, ...rows] : rows, total: page.page.total, next: page.page.nextOffset,
        thematicSha256: page.thematicSha256, parentKey });
    } catch { if (isCurrent()) { update(null); setError("Contribution choices could not be confirmed. Refresh the list; unavailable choices are not an empty selection."); } }
    finally { if (isCurrent()) setBusy(false); }
  }, [userId, workspaceId, campaignId, requestId, scope, update, loseAccess]);
  useEffect(() => {
    if (expanded && actorId === userId) void load();
    return () => { active.current?.abort(); active.current = null; };
  }, [expanded, actorId, userId, load]);
  const complete = !busy && data !== null && data.rows.length === data.total && data.rows.every(row => row.choice !== null);
  useEffect(() => { onReadyChange(complete); }, [complete, onReadyChange]);
  useEffect(() => () => onReadyChange(false), [onReadyChange]);
  const chosen = data?.rows.find(row => row.recordId === selected);
  if (actorId !== userId) return <p className="text-sm">Only this theme request’s author can choose its context. Saved preparation and results remain available below.</p>;
  return <section aria-label="Context choices for themes" className="min-w-0 space-y-3 border-t border-border pt-3 [&_button]:h-auto [&_button]:min-h-10 [&_button]:max-w-full [&_button]:whitespace-normal">
    <Button type="button" variant="outline" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>Choose context for themes</Button>
    {expanded ? <div className="min-w-0 space-y-3">
      <p className="max-w-prose text-sm">Select one completed context for every contribution in this saved source. This chooses the context used to prepare themes; it does not approve the generated wording or authorize provider execution.</p>
      <Button type="button" variant="outline" disabled={busy} onClick={() => void load()}>Refresh context choices</Button>
      {busy ? <p role="status">Reading contribution choices…</p> : null}{error ? <p role="alert">{error}</p> : null}
      {data ? <p className="text-sm">{data.rows.filter(row => row.choice).length.toLocaleString("en-US")} selected among {data.rows.length.toLocaleString("en-US")} loaded contributions. The source contains {data.total.toLocaleString("en-US")} contributions.</p> : null}
      <ul className="space-y-2">{data?.rows.map(row => <li key={row.recordId} className="min-w-0 space-y-1 border-b border-border pb-3">
        <Button type="button" variant={selected === row.recordId ? "secondary" : "outline"} aria-pressed={selected === row.recordId} disabled={busy}
          className="text-left" onClick={() => setSelected(row.recordId)}>{row.label}</Button>
        <p className="text-sm">{row.choice ? "Context selected" : "Context still needed"}</p>
        <p className="whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">{row.excerpt || "No plain-text preview. Inspect the complete saved source."}{row.excerptTruncated ? "…" : ""}</p>
      </li>)}</ul>
      {data?.next !== null && data?.next !== undefined ? <Button type="button" variant="outline" disabled={busy} onClick={() => void load(data.next!)}>Load more contributions</Button> : null}
      {complete ? <p role="status">Every source contribution has a saved context choice. Preparation must still verify every choice against the original contributions and saved context.</p> : null}
      {chosen && data && !busy ? <SynthesisThematicContextChoice {...scope} userId={userId} targetRecordId={chosen.recordId}
        label={chosen.label} thematicSha256={data.thematicSha256} saved={chosen.choice} onAccessLost={loseAccess} onSaved={choice => {
          const current = retained.current;
          if (current) update({ ...current, rows: current.rows.map(row => row.recordId === choice.targetRecordId ? { ...row, choice } : row) });
        }} /> : null}
    </div> : null}
  </section>;
}
