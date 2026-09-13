"use client";

import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { translationHistoryEntrySchema, type TranslationHistoryEntry } from "@/lib/engagement/translation-history";

const eventLabels: Record<TranslationHistoryEntry["event"], string> = {
  legacy_baseline: "Retained baseline",
  created: "Created",
  corrected: "Corrected",
  accepted: "Accepted as agency wording",
  removed: "Withdrawn",
};

function recordLabel(row: TranslationHistoryEntry) {
  const kinds = { campaign: "Campaign", category: "Topic", survey_question: "Question", survey_question_option: "Answer option", close_loop_entry: "Response" };
  return `${kinds[row.record.entity_type]} ${row.record.field.replaceAll("_", " ")} · ${row.record.locale} · ${row.record.translated_text.slice(0, 60)}`;
}

function HistoryRecords({ campaignId, revision }: { campaignId: string; revision: number }) {
  const [history, setHistory] = useState<TranslationHistoryEntry[]>([]);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadedRevision, setLoadedRevision] = useState<number | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const selectId = useId();

  useEffect(() => {
    const controller = new AbortController();
    async function read() {
      try {
        const response = await fetch(`/api/engagement/campaigns/${campaignId}/translations/history`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("History read failed");
        const payload = await response.json();
        const rows = translationHistoryEntrySchema.array().parse(payload.history);
        if (rows.some(row => row.campaign_id !== campaignId || row.record.campaign_id !== campaignId || row.record.id !== row.translation_id)) throw new Error("Invalid history scope");
        if (controller.signal.aborted) return;
        setHistory(rows);
        setSelected(current => rows.some(row => row.translation_id === current) ? current : rows[0]?.translation_id ?? "");
        setError(false);
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        if (!controller.signal.aborted) { setLoading(false); setLoadedRevision(revision); }
      }
    }
    void read();
    return () => controller.abort();
  }, [campaignId, attempt, revision]);

  const refreshing = loadedRevision !== revision;
  if (loading || (refreshing && history.length === 0)) return <p role="status">Loading translation history…</p>;
  if (error) return <div className="space-y-2">
    <p role="alert">Translation history could not be read and verified completely. Saved translations have not been changed.</p>
    <Button type="button" variant="outline" onClick={() => { setLoading(true); setAttempt(value => value + 1); }}>Retry translation history</Button>
  </div>;
  if (!history.length) return <p>No translation history has been retained yet.</p>;

  const latest = new Map<string, TranslationHistoryEntry>();
  for (const row of history) latest.set(row.translation_id, row);
  const revisions = history.filter(row => row.translation_id === selected).reverse();
  return <div className="space-y-4" aria-busy={refreshing}>
    {refreshing && <p role="status">Refreshing translation history. Showing the last verified copy.</p>}
    <label htmlFor={selectId} className="block text-sm font-medium">Translation, including withdrawn entries</label>
    <select id={selectId} value={selected} onChange={event => setSelected(event.target.value)} className="w-full min-w-0 rounded-lg border border-input bg-background p-2 text-sm">
      {[...latest.values()].map(row => <option key={row.translation_id} value={row.translation_id}>
        {recordLabel(row)}{row.event === "removed" ? " (withdrawn)" : ""}
      </option>)}
    </select>
    <p className="text-xs text-muted-foreground">{revisions.length} retained revisions. Earlier changes before retention began remain unknown. These copies retain translated wording and its recorded origin; a source checksum cannot reconstruct the original source text.</p>
    <ol className="space-y-4">
      {revisions.map(row => <li key={row.id} className="space-y-2 rounded-lg border border-border p-3 text-sm break-words">
        <h3 className="font-semibold">Revision {row.revision}: {eventLabels[row.event]}</h3>
        <p><time dateTime={row.recorded_at}>{new Date(row.recorded_at).toLocaleString()}</time></p>
        <p className="text-xs text-muted-foreground">{row.actor_id ? `Recorded actor: ${row.actor_id}` : "Actor not recorded"}</p>
        {row.event === "legacy_baseline" && <p>This is the copy present when history retention began. Earlier changes and actors are unknown.</p>}
        <p className="whitespace-pre-wrap">{row.record.translated_text}</p>
        <p>Saved origin: {row.record.source === "machine" ? "Machine translation" : "Agency wording, written or accepted"}</p>
        <p>Model recorded: {row.record.machine_model || "Not recorded for this copy"}</p>
        <p className="text-xs text-muted-foreground">Source text: not retained in this copy.</p>
        <details className="text-xs text-muted-foreground"><summary>Retained checksum verified</summary><p className="mt-2 break-all">SHA-256: {row.record_sha256}</p></details>
      </li>)}
    </ol>
  </div>;
}

/** Opens retained translation copies independently of the current field inventory. */
export function TranslationHistory({ campaignId, revision = 0 }: { campaignId: string; revision?: number }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return <div className="mt-4">
    <Button type="button" variant="outline" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(value => !value)}>
      {open ? "Close translation history" : "Translation history"}
    </Button>
    <section id={panelId} aria-label="Translation history" hidden={!open} className="mt-3 space-y-3 rounded-lg border border-border p-3">
      {open && <HistoryRecords key={campaignId} campaignId={campaignId} revision={revision} />}
    </section>
  </div>;
}
