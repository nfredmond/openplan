"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { IMPORTABLE_SOURCE_TYPES, type ImportableSourceType } from "@/lib/engagement/comment-import";

/**
 * BRINGING IN THE COMMENT THAT DID NOT ARRIVE THROUGH THE PORTAL.
 *
 * The flip chart at the open house, the comment cards at the library, the
 * project inbox, the council transcript. `source_type` has carried `meeting` and
 * `email` since the table was created; nothing ever offered a way to enter them,
 * and one comment at a time is not a way in for an agency holding 300 cards.
 *
 * The consequence was not inconvenience. Everything OpenPlan says about a
 * campaign — the synthesis, the representativeness screening, the hotspot test,
 * the appendix — is computed over the items it holds, so an agency whose
 * in-person turnout never got entered received a confident analysis of its own
 * outreach that was wrong in a predictable direction. Portal submissions skew
 * toward people with a device, a data plan, and enough English or Spanish to use
 * one. The people missing from that reading are the ones an equity screening
 * exists to find.
 *
 * NOTHING IS WRITTEN UNTIL THE PREVIEW IS ACCEPTED, and the preview comes from
 * the same server code that performs the insert — a dry run of the real path,
 * not a second implementation of it. An operator approving a summary produced by
 * different logic than the logic that runs is approving something else.
 */
export function CommentImportPanel({ campaignId }: { campaignId: string }) {
  const router = useRouter();
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [sourceType, setSourceType] = useState<ImportableSourceType>("meeting");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState<number | null>(null);

  async function send(commit: boolean) {
    if (!csv) return;
    setError(null);
    setBusy(true);
    try {
      const response = await fetch(`/api/engagement/campaigns/${campaignId}/items/import`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ csv, sourceType, fileName, commit }),
      });
      const body = (await response.json().catch(() => null)) as (ImportPreview & { error?: string }) | null;

      if (!response.ok && !body?.errorCount) {
        setError(body?.error ?? "Could not read this file.");
        setPreview(null);
        return;
      }
      if (body) setPreview(body);
      if (commit && body?.committed) {
        setImported(body.importedCount);
        setCsv(null);
        setFileName(null);
        // The moderation queue and every count on this page are server-rendered.
        router.refresh();
      }
    } catch {
      setError("Could not reach OpenPlan. Nothing was imported.");
    } finally {
      setBusy(false);
    }
  }

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setPreview(null);
    setImported(null);
    setError(null);
    if (!file) {
      setCsv(null);
      setFileName(null);
      return;
    }
    setFileName(file.name);
    setCsv(await file.text());
  }

  const blocked = (preview?.errorCount ?? 0) > 0;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-foreground">CSV file</span>
          <span className="text-xs text-muted-foreground">
            One row per comment. A column named body, comment, response, feedback, text or message is
            required; title, name, category, latitude and longitude are optional.
          </span>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => void onFile(event)}
            className="mt-1 text-sm file:me-3 file:rounded-md file:border file:border-border/70 file:bg-background file:px-3 file:py-1.5 file:text-sm"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-foreground">Where these came from</span>
          <span className="text-xs text-muted-foreground">
            Applies to the whole file. This is not cosmetic — it is what the appendix and the
            representativeness reading use to tell in-person input apart from portal input.
          </span>
          <select
            value={sourceType}
            onChange={(event) => setSourceType(event.target.value as ImportableSourceType)}
            className="mt-1 w-full rounded-md border border-border/70 bg-background px-2 py-1.5 text-sm"
          >
            {IMPORTABLE_SOURCE_TYPES.map((value) => (
              <option key={value} value={value}>
                {SOURCE_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="rounded-md border border-border/60 px-3 py-2 text-xs leading-5 text-muted-foreground">
        Imported comments arrive as <strong>pending</strong> and go through the same moderation queue as
        everything else — a file is not a review. They cannot be marked as public portal submissions:
        that means somebody submitted it themselves under a rate limit and a share token, which a
        spreadsheet row cannot be given afterwards.
      </p>

      {error ? (
        <p role="alert" className="rounded-md border border-amber-300/70 bg-amber-50/70 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
          {error}
        </p>
      ) : null}

      {imported !== null ? (
        <p role="status" className="rounded-md border border-emerald-300/70 bg-emerald-50/60 px-3 py-2 text-sm dark:border-emerald-900 dark:bg-emerald-950/20">
          Imported {imported} comment{imported === 1 ? "" : "s"}. They are waiting in the moderation
          queue — nothing is on the public portal until you approve it.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void send(false)}
          disabled={!csv || busy}
          className="rounded-md border border-border/70 px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
        >
          {busy && !preview ? "Checking…" : "Check this file"}
        </button>
        <button
          type="button"
          onClick={() => void send(true)}
          disabled={!csv || busy || !preview || blocked}
          className="rounded-md bg-foreground px-3 py-1.5 text-sm font-semibold text-background disabled:opacity-50"
        >
          {busy && preview ? "Importing…" : `Import ${preview?.rowCount ?? 0} comment${preview?.rowCount === 1 ? "" : "s"}`}
        </button>
      </div>

      {preview ? (
        <div id="comment-import-preview" data-testid="comment-import-preview" className="space-y-3 rounded-md border border-border/60 p-3 text-sm">
          <p>
            <strong>{preview.rowCount}</strong> comment{preview.rowCount === 1 ? "" : "s"} readable
            {preview.geolocatedCount > 0 ? `, ${preview.geolocatedCount} with a location` : ", none with a location"}.
          </p>

          {preview.ignored.length > 0 ? (
            /* Reported rather than silently dropped: a column the operator meant
               as the comment, spelled in a way this does not recognise, is
               data loss that otherwise looks like a successful import. */
            <p className="text-xs text-muted-foreground">
              Columns not imported: {preview.ignored.join(", ")}.
            </p>
          ) : null}

          {blocked ? (
            <div>
              <p className="font-medium text-amber-900 dark:text-amber-200">
                {preview.errorCount} problem{preview.errorCount === 1 ? "" : "s"} — nothing will be
                imported until the file is fixed. Every problem is listed so you can fix them in one
                pass.
              </p>
              <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto text-xs text-muted-foreground">
                {preview.errors.map((rowError, index) => (
                  <li key={`${rowError.rowNumber}-${rowError.column}-${index}`}>
                    {rowError.rowNumber > 0 ? `Row ${rowError.rowNumber}` : "File"}
                    {rowError.column ? ` · ${rowError.column}` : ""}: {rowError.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const SOURCE_LABELS: Record<ImportableSourceType, string> = {
  meeting: "A meeting, open house, or workshop",
  email: "Email or letters to the project",
  internal: "Staff notes (not resident comment)",
};

type ImportPreview = {
  rowCount: number;
  errorCount: number;
  errors: Array<{ rowNumber: number; column: string | null; message: string }>;
  ignored: string[];
  unmatchedCategories: string[];
  geolocatedCount: number;
  committed: boolean;
  importedCount: number;
};
