"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FilePlus2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RTP_CYCLE_STATUS_OPTIONS } from "@/lib/rtp/catalog";

type CreateResponse = {
  rtpCycleId: string;
  error?: string;
};

function FormError({ error }: { error: string | null }) {
  if (!error) return null;

  return (
    <p className="rounded-[0.5rem] border border-red-300/80 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
      {error}
    </p>
  );
}

export function RtpCycleCreator() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<(typeof RTP_CYCLE_STATUS_OPTIONS)[number]["value"]>("draft");
  const [geographyLabel, setGeographyLabel] = useState("");
  const [horizonStartYear, setHorizonStartYear] = useState("");
  const [horizonEndYear, setHorizonEndYear] = useState("");
  const [adoptionTargetDate, setAdoptionTargetDate] = useState("");
  const [publicReviewOpenAt, setPublicReviewOpenAt] = useState("");
  const [publicReviewCloseAt, setPublicReviewCloseAt] = useState("");
  const [summary, setSummary] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/rtp-cycles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          status,
          geographyLabel: geographyLabel || undefined,
          horizonStartYear: horizonStartYear ? Number(horizonStartYear) : undefined,
          horizonEndYear: horizonEndYear ? Number(horizonEndYear) : undefined,
          adoptionTargetDate: adoptionTargetDate || undefined,
          publicReviewOpenAt: publicReviewOpenAt ? new Date(publicReviewOpenAt).toISOString() : undefined,
          publicReviewCloseAt: publicReviewCloseAt ? new Date(publicReviewCloseAt).toISOString() : undefined,
          summary: summary || undefined,
        }),
      });

      const payload = (await response.json()) as CreateResponse;
      if (!response.ok) {
        throw new Error(payload.error || "Failed to create RTP cycle");
      }

      setTitle("");
      setStatus("draft");
      setGeographyLabel("");
      setHorizonStartYear("");
      setHorizonEndYear("");
      setAdoptionTargetDate("");
      setPublicReviewOpenAt("");
      setPublicReviewCloseAt("");
      setSummary("");
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to create RTP cycle");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <article className="module-section-surface">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Create</p>
          <h2 className="module-section-title">New RTP cycle</h2>
          <p className="module-section-description">
            Register the cycle now so projects, chapters, engagement windows, and funding logic can hang off one clear parent object.
          </p>
        </div>
        <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-emerald-500/12 text-emerald-700 dark:text-emerald-300">
          <FilePlus2 className="h-5 w-5" />
        </span>
      </div>

      <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-1.5">
          <label htmlFor="rtp-cycle-title" className="text-[0.82rem] font-semibold">
            Title
          </label>
          <Input
            id="rtp-cycle-title"
            placeholder="Nevada County Regional Transportation Plan 2028"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="rtp-cycle-status" className="text-[0.82rem] font-semibold">
              Status
            </label>
            <select
              id="rtp-cycle-status"
              className="flex h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35"
              value={status}
              onChange={(event) => setStatus(event.target.value as (typeof RTP_CYCLE_STATUS_OPTIONS)[number]["value"])}
            >
              {RTP_CYCLE_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="rtp-cycle-geography" className="text-[0.82rem] font-semibold">
              Geography label
              <span className="ml-1.5 text-[0.72rem] font-normal text-muted-foreground">optional</span>
            </label>
            <Input
              id="rtp-cycle-geography"
              placeholder="Nevada County / regional unincorporated area"
              value={geographyLabel}
              onChange={(event) => setGeographyLabel(event.target.value)}
            />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="rtp-cycle-horizon-start" className="text-[0.82rem] font-semibold">
              Horizon start year
              <span className="ml-1.5 text-[0.72rem] font-normal text-muted-foreground">optional</span>
            </label>
            <Input
              id="rtp-cycle-horizon-start"
              type="number"
              min={1900}
              max={2200}
              placeholder="2028"
              value={horizonStartYear}
              onChange={(event) => setHorizonStartYear(event.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="rtp-cycle-horizon-end" className="text-[0.82rem] font-semibold">
              Horizon end year
              <span className="ml-1.5 text-[0.72rem] font-normal text-muted-foreground">optional</span>
            </label>
            <Input
              id="rtp-cycle-horizon-end"
              type="number"
              min={1900}
              max={2200}
              placeholder="2048"
              value={horizonEndYear}
              onChange={(event) => setHorizonEndYear(event.target.value)}
            />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="rtp-cycle-adoption-target" className="text-[0.82rem] font-semibold">
              Adoption target
              <span className="ml-1.5 text-[0.72rem] font-normal text-muted-foreground">optional</span>
            </label>
            <Input
              id="rtp-cycle-adoption-target"
              type="date"
              value={adoptionTargetDate}
              onChange={(event) => setAdoptionTargetDate(event.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="rtp-cycle-summary" className="text-[0.82rem] font-semibold md:hidden">
              Summary
            </label>
            <div className="rounded-[0.5rem] border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
              Treat this as the parent control object for portfolio, chapters, public review, and funding traceability.
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="rtp-cycle-review-open" className="text-[0.82rem] font-semibold">
              Public review opens
              <span className="ml-1.5 text-[0.72rem] font-normal text-muted-foreground">optional</span>
            </label>
            <Input
              id="rtp-cycle-review-open"
              type="datetime-local"
              value={publicReviewOpenAt}
              onChange={(event) => setPublicReviewOpenAt(event.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="rtp-cycle-review-close" className="text-[0.82rem] font-semibold">
              Public review closes
              <span className="ml-1.5 text-[0.72rem] font-normal text-muted-foreground">optional</span>
            </label>
            <Input
              id="rtp-cycle-review-close"
              type="datetime-local"
              value={publicReviewCloseAt}
              onChange={(event) => setPublicReviewCloseAt(event.target.value)}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="rtp-cycle-summary" className="text-[0.82rem] font-semibold">
            Summary
            <span className="ml-1.5 text-[0.72rem] font-normal text-muted-foreground">optional</span>
          </label>
          <Textarea
            id="rtp-cycle-summary"
            placeholder="What RTP update is being assembled, for which geography, toward which board/adoption milestone, and under what review window?"
            rows={4}
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
          />
        </div>

        <FormError error={error} />

        <Button type="submit" size="lg" disabled={isSubmitting}>
          {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Create RTP cycle
        </Button>
      </form>
    </article>
  );
}
