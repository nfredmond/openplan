"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileCog, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { generateReportArtifact } from "@/lib/reports/client";

export function RtpRegistryPacketBulkArtifactActions({
  reportIds,
  reportCount,
  queueLabel,
  title,
  description,
  queuedDetail,
  buttonLabel,
  completionVerb,
}: {
  reportIds: string[];
  reportCount: number;
  queueLabel: string;
  title: string;
  description: string;
  queuedDetail: string;
  buttonLabel: string;
  completionVerb: string;
}) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    setIsSubmitting(true);
    setMessage(null);
    setError(null);

    let successCount = 0;
    let warningCount = 0;

    try {
      for (const reportId of reportIds) {
        const generation = await generateReportArtifact(reportId);
        successCount += 1;
        warningCount += generation.warningCount;
      }

      setMessage(
        `${completionVerb} ${successCount} RTP packet ${successCount === 1 ? "artifact" : "artifacts"}.${warningCount > 0 ? ` ${warningCount} generation warning${warningCount === 1 ? " was" : "s were"} returned across the batch.` : ""}`
      );
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to generate RTP packets");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <article className="module-section-surface">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">{queueLabel}</p>
          <h2 className="module-section-title">{title}</h2>
          <p className="module-section-description">{description}</p>
        </div>
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-500/12 text-sky-700 dark:text-sky-300">
          <FileCog className="h-5 w-5" />
        </span>
      </div>

      <div className="mt-5 space-y-4">
        <div className="rounded-2xl border border-border/70 bg-muted/25 px-4 py-4">
          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Queued packets</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{reportCount}</p>
          <p className="mt-1 text-sm text-muted-foreground">{queuedDetail}</p>
        </div>

        <Button type="button" onClick={handleGenerate} disabled={isSubmitting || reportIds.length === 0}>
          {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileCog className="h-4 w-4" />}
          {buttonLabel}
        </Button>

        {message ? <p className="text-sm text-emerald-700 dark:text-emerald-300">{message}</p> : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>
    </article>
  );
}
