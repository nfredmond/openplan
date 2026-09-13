"use client";

import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { responseHistoryEntrySchema, type ResponseHistoryEntry } from "@/lib/engagement/response-history";

const eventLabels: Record<ResponseHistoryEntry["event"], string> = {
  legacy_baseline: "Retained baseline",
  created: "Created",
  corrected: "Corrected",
  published: "Published",
  unpublished: "Withdrawn from publication",
  removed: "Removed from current responses",
};

function HistoryRecords({ campaignId }: { campaignId: string }) {
  const [history, setHistory] = useState<ResponseHistoryEntry[]>([]);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const selectId = useId();

  useEffect(() => {
    const controller = new AbortController();
    async function read() {
      try {
        const response = await fetch(`/api/engagement/campaigns/${campaignId}/closeloop/history`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("History read failed");
        const payload = await response.json();
        const rows = responseHistoryEntrySchema.array().parse(payload.history);
        if (rows.some(row => row.campaign_id !== campaignId || row.record.campaign_id !== campaignId || row.record.id !== row.response_id)) throw new Error("Invalid history scope");
        if (controller.signal.aborted) return;
        setHistory(rows);
        setSelected(rows[0]?.response_id ?? "");
        setError(false);
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void read();
    return () => controller.abort();
  }, [campaignId, attempt]);

  if (loading) return <p role="status">Loading response history…</p>;
  if (error) return <div className="space-y-2">
    <p role="alert">Response history could not be read and verified completely. Saved records have not been changed.</p>
    <Button type="button" variant="outline" onClick={() => { setLoading(true); setAttempt(value => value + 1); }}>Retry response history</Button>
  </div>;
  if (!history.length) return <p>No response history has been retained for this campaign.</p>;

  const latest = new Map<string, ResponseHistoryEntry>();
  for (const row of history) latest.set(row.response_id, row);
  const revisions = history.filter(row => row.response_id === selected).reverse();
  return <div className="space-y-4">
    <label htmlFor={selectId} className="block text-sm font-medium">Response, including removed entries</label>
    <select id={selectId} value={selected} onChange={event => setSelected(event.target.value)} className="w-full min-w-0 rounded-lg border border-input bg-background p-2 text-sm">
      {[...latest.values()].map(row => <option key={row.response_id} value={row.response_id}>
        {row.record.theme_title || "Untitled response"}{row.event === "removed" ? " (removed)" : ""} · {row.response_id}
      </option>)}
    </select>
    <p className="text-xs text-muted-foreground">{revisions.length} retained revisions. These copies preserve the response text and source references. Translation history and reasons for changes are not recorded here. Withdrawal may follow a source correction.</p>
    <ol className="space-y-4">
      {revisions.map(row => <li key={row.id} className="space-y-2 rounded-lg border border-border p-3 text-sm break-words">
        <h3 className="font-semibold">Revision {row.revision}: {eventLabels[row.event]}</h3>
        <p><time dateTime={row.recorded_at}>{new Date(row.recorded_at).toLocaleString()}</time></p>
        <p className="text-xs text-muted-foreground">{row.actor_id ? `Recorded actor: ${row.actor_id}` : "Actor not recorded"}</p>
        {row.event === "legacy_baseline" && <p>This is the copy present when history retention began. Earlier changes are unknown.</p>}
        <p className="font-medium">{row.record.theme_title}</p>
        <p className="whitespace-pre-wrap"><strong>You said: </strong>{row.record.you_said || "Not recorded"}</p>
        <p className="whitespace-pre-wrap"><strong>We did: </strong>{row.record.we_did || "Not recorded"}</p>
        <p>Saved status: {row.record.status}</p>
        <p className="text-xs">Source contribution IDs: {row.record.source_item_ids.join(", ") || "None recorded"}</p>
        <details className="text-xs text-muted-foreground"><summary>Retained checksum verified</summary><p className="mt-2 break-all">SHA-256: {row.record_sha256}</p></details>
      </li>)}
    </ol>
  </div>;
}

/** Opens private campaign history independently of the current response list. */
export function ResponseHistory({ campaignId }: { campaignId: string }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return <div className="mt-4">
    <Button type="button" variant="outline" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(value => !value)}>
      {open ? "Close response history" : "Response history"}
    </Button>
    <section id={panelId} aria-label="Response history" hidden={!open} className="mt-3 space-y-3 rounded-lg border border-border p-3">
      {open && <HistoryRecords key={campaignId} campaignId={campaignId} />}
    </section>
  </div>;
}
