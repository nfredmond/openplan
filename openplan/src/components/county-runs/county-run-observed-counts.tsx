"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  COUNTY_SCAFFOLD_EDITABLE_COLUMNS,
  serializeCountyValidationScaffoldCsv,
  type CountyValidationScaffoldTable,
} from "@/lib/api/county-onramp-scaffold";
import { getCountyRunScaffold, saveCountyRunScaffold } from "@/lib/api/county-onramp-client";
import type { CountyOnrampScaffoldSummary } from "@/lib/models/county-onramp";

/**
 * WHERE OBSERVED COUNTS ACTUALLY GET TYPED IN.
 *
 * A county run becomes `validated-screening` only when its assigned volumes
 * have been checked against counts somebody observed. The whole path already
 * existed — the route reads the scaffold, replaces it, diffs what a person
 * changed, and records that the counts were hand-entered rather than fetched —
 * and NOTHING IN THE PRODUCT OPENED IT. The counts had to be edited in a text
 * editor on the operator's own filesystem, which is a manual operator step in
 * the middle of the modeling lane's most important gate.
 *
 * WHY A TABLE AND NOT A FILE UPLOAD. The stations are already known: the worker
 * wrote a row per count location, and the planner is filling in three cells on
 * rows that exist. That is data entry into a fixed set, not importing an
 * arbitrary file — and the question a planner actually has ("which stations
 * still need a count?") is one a table can answer and an upload box cannot.
 * Pasting is still available through the raw-CSV view for anyone who has the
 * numbers in a spreadsheet already.
 *
 * WHY STATION IDS ARE NOT EDITABLE. The route diffs edits BY station id, so a
 * changed id reads as a new station rather than as a correction — and a count
 * silently re-pointed at a different link is the one error nobody would catch.
 *
 * NOT LOADED ON MOUNT, matching `CountyRunValidationPrep`: the scaffold may
 * live on the deployment's filesystem, and a read behind every render would put
 * a file stat on runs nowhere near this stage.
 */

const EDITABLE = new Set<string>(COUNTY_SCAFFOLD_EDITABLE_COLUMNS);

function ReadinessLine({ summary }: { summary: CountyOnrampScaffoldSummary }) {
  return (
    <div className="module-record-meta" data-testid="scaffold-readiness">
      <span className="module-record-chip">{summary.station_count} stations</span>
      <span className="module-record-chip">
        {summary.observed_volume_filled_count} with a count
      </span>
      {summary.observed_volume_missing_count > 0 ? (
        <span className="module-record-chip">
          {summary.observed_volume_missing_count} still missing one
        </span>
      ) : null}
      <span className="module-record-chip">{summary.ready_station_count} ready to validate</span>
    </div>
  );
}

export function CountyRunObservedCounts({ countyRunId }: { countyRunId: string }) {
  const [table, setTable] = useState<CountyValidationScaffoldTable | null>(null);
  const [summary, setSummary] = useState<CountyOnrampScaffoldSummary | null>(null);
  const [path, setPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [dirty, setDirty] = useState(false);

  async function load() {
    setError(null);
    setLoading(true);
    try {
      const response = await getCountyRunScaffold(countyRunId);
      setTable({ header: response.header, rows: response.rows });
      setSummary(response.summary);
      setPath(response.path);
      setDirty(false);
      setSaved(false);
    } catch (cause) {
      // A failed load is not "no counts to enter". Saying so would send an
      // operator to check a file that is present and readable.
      setError(cause instanceof Error ? cause.message : "Could not open the counts for this run.");
      setTable(null);
    } finally {
      setLoading(false);
    }
  }

  function editCell(rowIndex: number, column: string, value: string) {
    setTable((current) => {
      if (!current) return current;
      const rows = current.rows.map((row, index) =>
        index === rowIndex ? { ...row, [column]: value } : row
      );
      return { ...current, rows };
    });
    setDirty(true);
    setSaved(false);
  }

  async function save() {
    if (!table) return;
    setError(null);
    setSaving(true);
    try {
      // The WHOLE file goes back, serialized from the same table that was
      // loaded — every column the scaffold carried, including the ones this
      // screen does not understand.
      await saveCountyRunScaffold(countyRunId, serializeCountyValidationScaffoldCsv(table));
      setSaved(true);
      setDirty(false);
      // Re-read so the readiness figures come from the saved file rather than
      // from what this screen believes it wrote.
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save these counts.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="module-section-surface" id="observed-counts">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Validation</p>
          <h2 className="module-section-title">Observed counts</h2>
          <p className="module-section-description">
            The counts this run is checked against. Fill in what your agency or the state
            measured at each station; a station needs a volume and a source before it can be
            used.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
          {loading ? "Opening…" : table ? "Reload" : "Open counts"}
        </Button>
      </div>

      {error ? (
        <p className="module-empty-state" data-testid="observed-counts-error">
          {error}
        </p>
      ) : null}

      {table ? (
        <div className="mt-5 space-y-4">
          {summary ? <ReadinessLine summary={summary} /> : null}
          {path ? <p className="module-note">Saved to {path}</p> : null}

          <div className="overflow-x-auto">
            <table className="w-full text-left text-[0.78rem]" data-testid="observed-counts-table">
              <thead>
                <tr>
                  {table.header.map((column) => (
                    <th key={column} className="px-2 py-1 font-medium text-muted-foreground">
                      {column.replace(/_/g, " ")}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, rowIndex) => (
                  <tr key={row.station_id || rowIndex} data-testid={`counts-row-${row.station_id}`}>
                    {table.header.map((column) => (
                      <td key={column} className="px-2 py-1 align-top">
                        {EDITABLE.has(column) ? (
                          <input
                            className="w-full rounded border bg-transparent px-1 py-0.5"
                            aria-label={`${column.replace(/_/g, " ")} for station ${row.station_id}`}
                            value={row[column] ?? ""}
                            onChange={(event) => editCell(rowIndex, column, event.target.value)}
                          />
                        ) : (
                          <span className="text-muted-foreground">{row[column]}</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={() => void save()} disabled={saving || !dirty}>
              {saving ? "Saving…" : "Save counts"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setShowRaw((value) => !value)}>
              {showRaw ? "Hide the file" : "Show the file"}
            </Button>
            {dirty ? (
              <StatusBadge tone="warning">Unsaved changes</StatusBadge>
            ) : saved ? (
              <StatusBadge tone="success">Saved</StatusBadge>
            ) : null}
          </div>

          {showRaw ? (
            <pre
              className="max-h-64 overflow-auto rounded bg-muted p-3 text-[0.7rem]"
              data-testid="observed-counts-raw"
            >
              {serializeCountyValidationScaffoldCsv(table)}
            </pre>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
