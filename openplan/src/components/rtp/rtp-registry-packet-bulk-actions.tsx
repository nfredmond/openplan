"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

export function RtpRegistryPacketBulkActions({
  cycleIds,
  cycleCount,
}: {
  cycleIds: string[];
  cycleCount: number;
}) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleApply() {
    setIsSubmitting(true);
    setMessage(null);
    setError(null);

    try {
      const response = await fetch("/api/rtp-cycles/packet-presets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cycleIds }),
      });

      const payload = (await response.json()) as {
        error?: string;
        updatedReportCount?: number;
        targetedCycleCount?: number;
        skippedCycleCount?: number;
      };

      if (!response.ok) {
        throw new Error(payload.error || "Failed to apply recommended RTP packet presets");
      }

      const updatedCount = payload.updatedReportCount ?? 0;
      const skippedCount = payload.skippedCycleCount ?? 0;
      setMessage(
        updatedCount > 0
          ? `Applied recommended presets to ${updatedCount} linked RTP packet ${updatedCount === 1 ? "record" : "records"}.${skippedCount > 0 ? ` ${skippedCount} cycle${skippedCount === 1 ? "" : "s"} had no linked packet record.` : ""}`
          : `No linked RTP packet records were found for the ${cycleCount} selected cycle${cycleCount === 1 ? "" : "s"}.`
      );
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to apply recommended RTP packet presets");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <article className="module-section-surface">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Packet reset queue</p>
          <h2 className="module-section-title">Reset stale customized packets in bulk</h2>
          <p className="module-section-description">
            Apply the recommended phase-aligned RTP packet preset to every cycle currently marked as needing a reset from the registry.
          </p>
        </div>
        <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-sky-500/12 text-sky-700 dark:text-sky-300">
          <WandSparkles className="h-5 w-5" />
        </span>
      </div>

      <div className="mt-5 space-y-4">
        <div className="rounded-[0.5rem] border border-border/70 bg-muted/25 px-4 py-4">
          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Queued cycles</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{cycleCount}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            This converts registry-level &quot;Needs reset&quot; cycles back to the recommended preset for their current RTP phase. Packet regeneration can happen afterward if freshness is still flagged.
          </p>
        </div>

        <Button type="button" onClick={handleApply} disabled={isSubmitting || cycleIds.length === 0}>
          {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <WandSparkles className="h-4 w-4" />}
          Apply recommended preset to all needs-reset cycles
        </Button>

        {message ? <p className="text-sm text-emerald-700 dark:text-emerald-300">{message}</p> : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>
    </article>
  );
}
