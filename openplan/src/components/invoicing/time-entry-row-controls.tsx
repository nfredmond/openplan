"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type TimeEntryRowControlsProps = {
  workspaceId: string;
  timeEntryId: string;
  entryDate: string | null;
  hours: number;
  billable: boolean;
  /** A billed entry is part of an invoice's backup and may not be corrected here. */
  billed: boolean;
  canWrite: boolean;
};

/**
 * CORRECTING A TIME ENTRY, from the register where the mistake is visible.
 *
 * `PATCH`/`DELETE /api/invoicing/time-entries/[timeEntryId]` were built, audited
 * and protected against editing billed time — and nothing called either one. The
 * register listed every entry and offered no way to change one, so eight hours
 * typed as eighty stayed eighty, and the only remedy was a second, negative
 * entry that no rate table can price.
 *
 * Only the two fields a person actually mistypes are editable here — the date
 * and the hours. Re-assigning an entry to different staff or a different
 * engagement is a different act with different consequences for an invoice, and
 * belongs to a fuller editor, not to an inline row fix.
 *
 * A billed entry renders nothing at all. The route refuses it with a 409 and the
 * reason is structural (it is on an invoice already), so offering the control
 * and then explaining the refusal would be an invitation to a dead end.
 */
export function TimeEntryRowControls({
  workspaceId,
  timeEntryId,
  entryDate,
  hours,
  billable,
  billed,
  canWrite,
}: TimeEntryRowControlsProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [dateDraft, setDateDraft] = useState(entryDate ?? "");
  const [hoursDraft, setHoursDraft] = useState(String(hours));
  const [billableDraft, setBillableDraft] = useState(billable);
  const [busy, setBusy] = useState<"save" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!canWrite || billed) {
    return null;
  }

  async function save() {
    setError(null);
    setBusy("save");
    try {
      const response = await fetch(`/api/invoicing/time-entries/${timeEntryId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          entryDate: dateDraft,
          hours: Number(hoursDraft),
          billable: billableDraft,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; details?: string }
        | null;
      if (!response.ok) {
        throw new Error(payload?.details || payload?.error || "Could not save this correction.");
      }
      setOpen(false);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this correction.");
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setError(null);
    setBusy("delete");
    try {
      const response = await fetch(
        `/api/invoicing/time-entries/${timeEntryId}?workspaceId=${encodeURIComponent(workspaceId)}`,
        { method: "DELETE" }
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error || "Could not remove this entry.");
      }
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not remove this entry.");
    } finally {
      setBusy(null);
    }
  }

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="openplan-inline-label" onClick={() => setOpen(true)}>
          Correct
        </button>
        <button
          type="button"
          className="openplan-inline-label openplan-inline-label-muted"
          onClick={() => void remove()}
          disabled={busy === "delete"}
        >
          {busy === "delete" ? "Removing…" : "Remove"}
        </button>
        {error ? <span className="text-xs text-red-700 dark:text-red-200">{error}</span> : null}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Corrected date"
          type="date"
          className="h-8 w-[9.5rem]"
          value={dateDraft}
          onChange={(event) => setDateDraft(event.target.value)}
        />
        <Input
          aria-label="Corrected hours"
          type="number"
          min="0.25"
          max="24"
          step="0.25"
          className="h-8 w-24"
          value={hoursDraft}
          onChange={(event) => setHoursDraft(event.target.value)}
        />
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={billableDraft}
            onChange={(event) => setBillableDraft(event.target.checked)}
          />
          Billable
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" onClick={() => void save()} disabled={busy === "save"}>
          {busy === "save" ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving…
            </span>
          ) : (
            "Save correction"
          )}
        </Button>
        <button
          type="button"
          className="openplan-inline-label openplan-inline-label-muted"
          onClick={() => {
            setOpen(false);
            setError(null);
            setDateDraft(entryDate ?? "");
            setHoursDraft(String(hours));
            setBillableDraft(billable);
          }}
        >
          Cancel
        </button>
      </div>
      {error ? <p className="text-xs text-red-700 dark:text-red-200">{error}</p> : null}
    </div>
  );
}
