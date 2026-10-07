"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { readSynthesisHistory } from "@/lib/engagement/synthesis-history-read";
import { synthesisContinuationPageSchema, synthesisContinuationParentSchema,
  type SynthesisContinuationParent, type SynthesisContinuationProposal } from "@/lib/engagement/synthesis-continuation-records";
import { SynthesisGenerationCreatePanel } from "./synthesis-generation-create-panel";

type Props = { userId: string; workspaceId: string; campaignId: string; parent: SynthesisContinuationParent; onAccessLost: () => void };
type Page = ReturnType<typeof synthesisContinuationPageSchema.parse>;
const saved = () => { /* The embedded receipt provides the next preparation step. */ };

/** Continue only from an explicitly inspected, complete parent selection. */
export function SynthesisContinuationPanel(props: Props) {
  return <Continuation key={`${props.userId}:${props.workspaceId}:${props.campaignId}:${JSON.stringify(props.parent)}`} {...props} />;
}

function Continuation({ userId, workspaceId, campaignId, parent, onAccessLost }: Props) {
  const [expanded, setExpanded] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [entries, setEntries] = useState<Page["entries"]>([]), [total, setTotal] = useState<number | null>(null), [next, setNext] = useState<number | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null), pageState = useRef<{ entries: Page["entries"]; total: number | null }>({ entries: [], total: null });
  const clear = useCallback(() => { setEntries([]); setTotal(null); setNext(null); setSelected(null); pageState.current = { entries: [], total: null }; }, []);
  const loseAccess = useCallback(() => { active.current?.abort(); clear(); setBusy(false); setError("Current staff access could not be confirmed. Reopen this consultation."); onAccessLost(); }, [clear, onAccessLost]);
  const load = useCallback(async (offset = 0) => {
    active.current?.abort(); const controller = new AbortController(); active.current = controller;
    const isCurrent = () => active.current === controller && !controller.signal.aborted;
    setBusy(true); setError(null); setSelected(null);
    if (!offset) clear();
    try {
      const query = new URLSearchParams(Object.entries({ ...parent, offset }).map(([key, value]) => [key, String(value)]));
      const response = await readSynthesisHistory(`/api/engagement/campaigns/${campaignId}/synthesis/continuation?${query}`, {
        userId, workspaceId, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(35_000)]), isCurrent,
      });
      if (!isCurrent()) return;
      if (response.status === 401 || response.status === 403) { loseAccess(); return; }
      if (!response.ok) throw new Error("Saved contribution choices could not be confirmed.");
      const page = synthesisContinuationPageSchema.parse(await response.json()), expected = synthesisContinuationParentSchema.parse(parent);
      if (page.campaignId !== campaignId || page.workspaceId !== workspaceId || page.offset !== offset ||
        (Object.keys(expected) as Array<keyof SynthesisContinuationParent>).some(key => page.parent[key] !== expected[key])) throw new Error("Contribution selection differs");
      if (!isCurrent()) return;
      const previous = pageState.current;
      if (offset && (previous.total !== page.total || previous.entries.length !== offset ||
        page.entries.some(row => previous.entries.some(saved => saved.recordId === row.recordId)))) throw new Error("Contribution continuation differs");
      const combined = offset ? [...previous.entries, ...page.entries] : page.entries;
      pageState.current = { entries: combined, total: page.total };
      setEntries(combined); setTotal(page.total); setNext(page.nextOffset);
    } catch { if (isCurrent()) { clear(); setError("Saved contribution choices could not be confirmed. Refresh this read before saving another request."); } }
    finally { if (isCurrent()) setBusy(false); }
  }, [userId, workspaceId, campaignId, parent, clear, loseAccess]);
  useEffect(() => {
    if (expanded) void load();
    return () => { active.current?.abort(); active.current = null; };
  }, [expanded, load]);
  const proposal = useMemo<SynthesisContinuationProposal | undefined>(() => selected
    ? { stage: "context", parent, targetRecordId: selected, frameByteLimit: 65_536 } : undefined, [selected, parent]);
  const selectedEntry = entries.find(row => row.recordId === selected);
  return <section aria-label="Combine contribution context" className="min-w-0 space-y-3 border-t border-border pt-3 [&_button]:h-auto [&_button]:min-h-10 [&_button]:max-w-full [&_button]:whitespace-normal">
    <Button type="button" variant="outline" aria-expanded={expanded} onClick={() => { clear(); setError(null); setExpanded(value => !value); }}>Choose a contribution to combine</Button>
    {expanded ? <div className="min-w-0 space-y-3">
      <p className="max-w-prose text-sm">Combine each contribution with its complete saved context before preparing themes. These previews help you choose a contribution; each request uses the complete saved material.</p>
      <Button type="button" variant="outline" disabled={busy} onClick={() => void load()}>Refresh contribution choices</Button>
      {busy ? <p role="status">Reading saved contributions…</p> : null}{error ? <p role="alert">{error}</p> : null}
      {total !== null ? <p className="text-sm">Showing {entries.length.toLocaleString("en-US")} of {total.toLocaleString("en-US")} contributions in this saved selection.</p> : null}
      <ul className="space-y-2">{entries.map(row => <li key={row.recordId} className="min-w-0 space-y-1 border-b border-border pb-3">
        <Button type="button" variant={selected === row.recordId ? "secondary" : "outline"} disabled={busy} aria-pressed={selected === row.recordId}
          className="text-left" onClick={() => setSelected(row.recordId)}>{row.label}</Button>
        <p className="whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">{row.excerpt || "This response has no plain-text preview. Inspect its complete saved source before review."}{row.excerptTruncated ? "…" : ""}</p>
        <p className="break-all text-xs text-muted-foreground">{row.kind === "item" ? "Comment" : "Survey response"} · {row.recordId}</p>
      </li>)}</ul>
      {next !== null ? <Button type="button" variant="outline" disabled={busy} onClick={() => void load(next)}>Load more contributions</Button> : null}
      {proposal && selectedEntry && !busy ? <div className="min-w-0 space-y-2">
        <h5 className="break-words font-semibold">Context for {selectedEntry.label}</h5>
        <SynthesisGenerationCreatePanel userId={userId} workspaceId={workspaceId} campaignId={campaignId}
          sourceId={parent.sourceId} sourceSha256={parent.sourceSha256} continuation={proposal} onAccessLost={loseAccess} onCreated={saved} />
      </div> : null}
    </div> : null}
  </section>;
}
