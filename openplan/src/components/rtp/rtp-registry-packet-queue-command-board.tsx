"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileCog, Loader2, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

export function RtpRegistryPacketQueueCommandBoard({
  resetCycleIds,
  missingCycleIds,
  generateReportIds,
  resetCount,
  missingCount,
}: {
  resetCycleIds: string[];
  missingCycleIds: string[];
  generateReportIds: string[];
  resetCount: number;
  missingCount: number;
}) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const actionableReportCount = generateReportIds.length;
  const totalGenerateWorkload = actionableReportCount + missingCycleIds.length;
  const hasActionableQueue = resetCycleIds.length > 0 || actionableReportCount > 0 || missingCycleIds.length > 0;

  async function handleClearQueue() {
    setIsSubmitting(true);
    setMessage(null);
    setError(null);

    let resetUpdatedCount = 0;
    let createdReportCount = 0;
    let regenerateSuccessCount = 0;
    let warningCount = 0;
    const reportIdsToGenerate = [...generateReportIds];

    try {
      for (const cycleId of missingCycleIds) {
        const createResponse = await fetch("/api/reports", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            rtpCycleId: cycleId,
            reportType: "board_packet",
          }),
        });

        const createPayload = (await createResponse.json()) as {
          error?: string;
          reportId?: string;
        };

        if (!createResponse.ok || !createPayload.reportId) {
          throw new Error(createPayload.error || "Failed while creating RTP packet records for missing cycles");
        }

        createdReportCount += 1;
        reportIdsToGenerate.push(createPayload.reportId);
      }

      if (resetCycleIds.length > 0) {
        const resetResponse = await fetch("/api/rtp-cycles/packet-presets", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cycleIds: resetCycleIds }),
        });

        const resetPayload = (await resetResponse.json()) as {
          error?: string;
          updatedReportCount?: number;
        };

        if (!resetResponse.ok) {
          throw new Error(resetPayload.error || "Failed while resetting RTP packet presets");
        }

        resetUpdatedCount = resetPayload.updatedReportCount ?? 0;
      }

      for (const reportId of [...new Set(reportIdsToGenerate)]) {
        const response = await fetch(`/api/reports/${reportId}/generate`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ format: "html" }),
        });

        const payload = (await response.json()) as {
          error?: string;
          warnings?: Array<unknown>;
        };

        if (!response.ok) {
          throw new Error(payload.error || "Failed while regenerating RTP packets");
        }

        regenerateSuccessCount += 1;
        warningCount += payload.warnings?.length ?? 0;
      }

      const fragments = [] as string[];
      if (createdReportCount > 0) {
        fragments.push(`created ${createdReportCount} first packet ${createdReportCount === 1 ? "record" : "records"}`);
      }
      if (resetUpdatedCount > 0) {
        fragments.push(`reset ${resetUpdatedCount} packet ${resetUpdatedCount === 1 ? "layout" : "layouts"}`);
      }
      if (regenerateSuccessCount > 0) {
        fragments.push(`regenerated ${regenerateSuccessCount} packet ${regenerateSuccessCount === 1 ? "record" : "records"}`);
      }
      if (missingCount > 0) {
        const remainingMissingCount = Math.max(missingCount - createdReportCount, 0);
        if (remainingMissingCount > 0) {
          fragments.push(`${remainingMissingCount} cycle${remainingMissingCount === 1 ? " still needs" : "s still need"} a first packet record`);
        }
      }

      setMessage(
        `${fragments.length > 0 ? fragments.join("; ") : "No actionable packet queue items were found."}.${warningCount > 0 ? ` ${warningCount} generation warning${warningCount === 1 ? " was" : "s were"} returned across the queue.` : ""}`
      );
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to clear the RTP packet queue");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <article className="module-section-surface">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Packet queue command board</p>
          <h2 className="module-section-title">Clear the RTP packet queue</h2>
          <p className="module-section-description">
            Run the recommended packet-queue sequence from the registry: create missing records, reset stale customized layouts, then generate every queued packet artifact.
          </p>
        </div>
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-500/12 text-sky-700 dark:text-sky-300">
          <FileCog className="h-5 w-5" />
        </span>
      </div>

      <div className="mt-5 space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="module-metric-card">
            <p className="module-metric-label">Step 1: create</p>
            <p className="module-metric-value text-sm">{missingCount}</p>
            <p className="mt-1 text-xs text-muted-foreground">Cycles that still need their first RTP board packet record.</p>
          </div>
          <div className="module-metric-card">
            <p className="module-metric-label">Step 2: reset</p>
            <p className="module-metric-value text-sm">{resetCount}</p>
            <p className="mt-1 text-xs text-muted-foreground">Reapply the recommended phase preset before generation when layout drift exists.</p>
          </div>
          <div className="module-metric-card">
            <p className="module-metric-label">Step 3: generate</p>
            <p className="module-metric-value text-sm">{totalGenerateWorkload}</p>
            <p className="mt-1 text-xs text-muted-foreground">Total packet artifacts that will be generated after create/reset work completes.</p>
          </div>
        </div>

        <div className="rounded-2xl border border-border/70 bg-muted/25 px-4 py-4 text-sm text-muted-foreground">
          <p className="font-semibold text-foreground">Recommended sequence</p>
          <ol className="mt-2 space-y-2">
            <li>1. Create first packet records for cycles that still have none.</li>
            <li>2. Reset all cycles marked as needing a phase-aligned packet layout.</li>
            <li>3. Generate every packet still flagged for first-artifact or refresh work.</li>
          </ol>
        </div>

        <Button type="button" onClick={handleClearQueue} disabled={isSubmitting || !hasActionableQueue}>
          {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <WandSparkles className="h-4 w-4" />}
          Clear packet queue
        </Button>

        {message ? <p className="text-sm text-emerald-700 dark:text-emerald-300">{message}</p> : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>
    </article>
  );
}
