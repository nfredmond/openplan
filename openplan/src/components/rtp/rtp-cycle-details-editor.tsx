"use client";

/**
 * Correcting an RTP cycle's own details after it was created.
 *
 * `PATCH /api/rtp-cycles/[rtpCycleId]` has accepted ten fields since it
 * shipped. Its only caller was the phase control, which sends `{ status }` —
 * so the other nine were settable exactly once, in the creation form, and were
 * uncorrectable forever after. An agency that mistyped its public review
 * window, its horizon years, or its plan title had no way to fix any of it,
 * and a cycle pinned at the wrong coordinates could be neither moved nor
 * un-pinned, despite the route's own comment promising it could.
 *
 * Everything here is a field the route already validated and already
 * authorized. This is the missing control, not a new capability.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, PencilLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export type RtpCycleDetailsEditorProps = {
  rtpCycleId: string;
  initialTitle: string;
  initialGeographyLabel: string | null;
  initialHorizonStartYear: number | null;
  initialHorizonEndYear: number | null;
  initialAdoptionTargetDate: string | null;
  initialPublicReviewOpenAt: string | null;
  initialPublicReviewCloseAt: string | null;
  initialSummary: string | null;
  initialAnchorLatitude: number | null;
  initialAnchorLongitude: number | null;
};

/**
 * An ISO timestamp as `datetime-local` wants it: LOCAL wall-clock, no zone.
 * `toISOString().slice(0,16)` would silently shift the agency's review window
 * by its UTC offset every time the form was opened and saved.
 */
function toLocalDateTimeInput(iso: string | null): string {
  if (!iso) return "";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
}

function toDateInput(value: string | null): string {
  if (!value) return "";
  // The column is a DATE; a full timestamp may arrive from the row.
  return value.slice(0, 10);
}

function numberToInput(value: number | null): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

export function RtpCycleDetailsEditor({
  rtpCycleId,
  initialTitle,
  initialGeographyLabel,
  initialHorizonStartYear,
  initialHorizonEndYear,
  initialAdoptionTargetDate,
  initialPublicReviewOpenAt,
  initialPublicReviewCloseAt,
  initialSummary,
  initialAnchorLatitude,
  initialAnchorLongitude,
}: RtpCycleDetailsEditorProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [title, setTitle] = useState(initialTitle);
  const [geographyLabel, setGeographyLabel] = useState(initialGeographyLabel ?? "");
  const [horizonStartYear, setHorizonStartYear] = useState(numberToInput(initialHorizonStartYear));
  const [horizonEndYear, setHorizonEndYear] = useState(numberToInput(initialHorizonEndYear));
  const [adoptionTargetDate, setAdoptionTargetDate] = useState(toDateInput(initialAdoptionTargetDate));
  const [publicReviewOpenAt, setPublicReviewOpenAt] = useState(toLocalDateTimeInput(initialPublicReviewOpenAt));
  const [publicReviewCloseAt, setPublicReviewCloseAt] = useState(toLocalDateTimeInput(initialPublicReviewCloseAt));
  const [summary, setSummary] = useState(initialSummary ?? "");
  const [anchorLatitude, setAnchorLatitude] = useState(numberToInput(initialAnchorLatitude));
  const [anchorLongitude, setAnchorLongitude] = useState(numberToInput(initialAnchorLongitude));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError("A plan needs a title.");
      return;
    }

    // Same pair rule the creator enforces, and for the same reason: it is
    // easier to understand beside the two fields than as a 400 in a toast.
    const hasLatitude = anchorLatitude.trim().length > 0;
    const hasLongitude = anchorLongitude.trim().length > 0;
    if (hasLatitude !== hasLongitude) {
      setError("Enter both a map pin latitude and longitude, or clear both to remove the pin.");
      return;
    }
    if (hasLatitude && (!Number.isFinite(Number(anchorLatitude)) || !Number.isFinite(Number(anchorLongitude)))) {
      setError("The map pin latitude and longitude must be numbers.");
      return;
    }

    const startYear = horizonStartYear.trim() ? Number(horizonStartYear) : null;
    const endYear = horizonEndYear.trim() ? Number(horizonEndYear) : null;
    if (startYear !== null && endYear !== null && endYear < startYear) {
      setError("The horizon end year cannot come before the start year.");
      return;
    }

    setIsSaving(true);

    try {
      // `null` rather than `undefined` throughout: this is an EDIT, so an
      // emptied field means "clear this", not "leave it alone". Sending
      // undefined is how a correction silently does nothing.
      const response = await fetch(`/api/rtp-cycles/${rtpCycleId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          geographyLabel: geographyLabel.trim() || null,
          horizonStartYear: startYear,
          horizonEndYear: endYear,
          adoptionTargetDate: adoptionTargetDate || null,
          publicReviewOpenAt: publicReviewOpenAt ? new Date(publicReviewOpenAt).toISOString() : null,
          publicReviewCloseAt: publicReviewCloseAt ? new Date(publicReviewCloseAt).toISOString() : null,
          summary: summary.trim() || null,
          anchorLatitude: hasLatitude ? Number(anchorLatitude) : null,
          anchorLongitude: hasLongitude ? Number(anchorLongitude) : null,
        }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to update this plan's details");
      }

      setIsOpen(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to update this plan's details");
    } finally {
      setIsSaving(false);
    }
  }

  if (!isOpen) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setIsOpen(true)}>
        <PencilLine className="mr-1.5 h-4 w-4" />
        Edit plan details
      </Button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-[0.5rem] border border-border/60 bg-muted/20 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Edit plan details</p>

      {error ? (
        <p className="rounded-[0.5rem] border border-red-300/80 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </p>
      ) : null}

      <div className="space-y-1">
        <label htmlFor="rtp-edit-title" className="text-xs font-medium text-foreground">
          Plan title
        </label>
        <Input id="rtp-edit-title" value={title} onChange={(event) => setTitle(event.target.value)} required />
      </div>

      <div className="space-y-1">
        <label htmlFor="rtp-edit-geography" className="text-xs font-medium text-foreground">
          Geography label
        </label>
        <Input
          id="rtp-edit-geography"
          value={geographyLabel}
          onChange={(event) => setGeographyLabel(event.target.value)}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="rtp-edit-horizon-start" className="text-xs font-medium text-foreground">
            Horizon start year
          </label>
          <Input
            id="rtp-edit-horizon-start"
            type="number"
            value={horizonStartYear}
            onChange={(event) => setHorizonStartYear(event.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="rtp-edit-horizon-end" className="text-xs font-medium text-foreground">
            Horizon end year
          </label>
          <Input
            id="rtp-edit-horizon-end"
            type="number"
            value={horizonEndYear}
            onChange={(event) => setHorizonEndYear(event.target.value)}
          />
        </div>
      </div>

      <div className="space-y-1">
        <label htmlFor="rtp-edit-adoption" className="text-xs font-medium text-foreground">
          Adoption target date
        </label>
        <Input
          id="rtp-edit-adoption"
          type="date"
          value={adoptionTargetDate}
          onChange={(event) => setAdoptionTargetDate(event.target.value)}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="rtp-edit-review-open" className="text-xs font-medium text-foreground">
            Public review opens
          </label>
          <Input
            id="rtp-edit-review-open"
            type="datetime-local"
            value={publicReviewOpenAt}
            onChange={(event) => setPublicReviewOpenAt(event.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="rtp-edit-review-close" className="text-xs font-medium text-foreground">
            Public review closes
          </label>
          <Input
            id="rtp-edit-review-close"
            type="datetime-local"
            value={publicReviewCloseAt}
            onChange={(event) => setPublicReviewCloseAt(event.target.value)}
          />
        </div>
      </div>

      <div className="space-y-1">
        <label htmlFor="rtp-edit-summary" className="text-xs font-medium text-foreground">
          Summary
        </label>
        <Textarea
          id="rtp-edit-summary"
          value={summary}
          rows={3}
          onChange={(event) => setSummary(event.target.value)}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="rtp-edit-lat" className="text-xs font-medium text-foreground">
            Map pin latitude
          </label>
          <Input id="rtp-edit-lat" value={anchorLatitude} onChange={(event) => setAnchorLatitude(event.target.value)} />
        </div>
        <div className="space-y-1">
          <label htmlFor="rtp-edit-lon" className="text-xs font-medium text-foreground">
            Map pin longitude
          </label>
          <Input
            id="rtp-edit-lon"
            value={anchorLongitude}
            onChange={(event) => setAnchorLongitude(event.target.value)}
          />
        </div>
        <p className="text-[0.7rem] text-muted-foreground sm:col-span-2">
          Clearing both removes this plan&apos;s pin from the shared map.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={isSaving}>
          {isSaving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
          Save details
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setIsOpen(false)} disabled={isSaving}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
