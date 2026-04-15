"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileCog, Loader2, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createRtpPacketRecord, generateReportArtifact } from "@/lib/reports/client";

export function RtpRegistryPacketQueueCommandBoard({
  resetCycleIds,
  missingCycleIds,
  generateFirstReportIds,
  refreshReportIds,
  resetCount,
  missingCount,
}: {
  resetCycleIds: string[];
  missingCycleIds: string[];
  generateFirstReportIds: string[];
  refreshReportIds: string[];
  resetCount: number;
  missingCount: number;
}) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const firstArtifactWorkload = generateFirstReportIds.length + missingCycleIds.length;
  const refreshWorkload = refreshReportIds.length;
  const hasActionableQueue =
    resetCycleIds.length > 0 || firstArtifactWorkload > 0 || refreshWorkload > 0;

  async function handleClearQueue() {
    setIsSubmitting(true);
    setMessage(null);
    setError(null);

    let resetUpdatedCount = 0;
    let createdReportCount = 0;
    let generatedFirstArtifactCount = 0;
    let refreshedArtifactCount = 0;
    let warningCount = 0;
    const reportIdsToGenerateFirst = [...generateFirstReportIds];
    const reportIdsToRefresh = [...refreshReportIds];

    try {
      for (const cycleId of missingCycleIds) {
        const createResult = await createRtpPacketRecord({
          rtpCycleId: cycleId,
        });

        createdReportCount += 1;
        reportIdsToGenerateFirst.push(createResult.reportId);
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

      for (const reportId of [...new Set(reportIdsToGenerateFirst)]) {
        const generation = await generateReportArtifact(reportId);
        generatedFirstArtifactCount += 1;
        warningCount += generation.warningCount;
      }

      for (const reportId of [...new Set(reportIdsToRefresh)]) {
        const generation = await generateReportArtifact(reportId);
        refreshedArtifactCount += 1;
        warningCount += generation.warningCount;
      }

      const fragments = [] as string[];
      if (createdReportCount > 0) {
        fragments.push(`created ${createdReportCount} first packet ${createdReportCount === 1 ? "record" : "records"}`);
      }
      if (resetUpdatedCount > 0) {
        fragments.push(`reset ${resetUpdatedCount} packet ${resetUpdatedCount === 1 ? "layout" : "layouts"}`);
      }
      if (generatedFirstArtifactCount > 0) {
        fragments.push(
          `generated ${generatedFirstArtifactCount} first packet ${generatedFirstArtifactCount === 1 ? "artifact" : "artifacts"}`
        );
      }
      if (refreshedArtifactCount > 0) {
        fragments.push(
          `refreshed ${refreshedArtifactCount} stale packet ${refreshedArtifactCount === 1 ? "artifact" : "artifacts"}`
        );
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
        <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-sky-500/12 text-sky-700 dark:text-sky-300">
          <FileCog className="h-5 w-5" />
        </span>
      </div>

      <div className="mt-5 space-y-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
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
            <p className="module-metric-label">Step 3: generate first</p>
            <p className="module-metric-value text-sm">{firstArtifactWorkload}</p>
            <p className="mt-1 text-xs text-muted-foreground">First packet artifacts to generate after missing-record creation completes.</p>
          </div>
          <div className="module-metric-card">
            <p className="module-metric-label">Step 4: refresh</p>
            <p className="module-metric-value text-sm">{refreshWorkload}</p>
            <p className="mt-1 text-xs text-muted-foreground">Existing packet artifacts that should be regenerated from current cycle state.</p>
          </div>
        </div>

        <div className="rounded-[0.5rem] border border-border/70 bg-muted/25 px-4 py-4 text-sm text-muted-foreground">
          <p className="font-semibold text-foreground">Recommended sequence</p>
          <ol className="mt-2 space-y-2">
            <li>1. Create first packet records for cycles that still have none.</li>
            <li>2. Reset all cycles marked as needing a phase-aligned packet layout.</li>
            <li>3. Generate first artifacts for packet records that exist but have never rendered yet.</li>
            <li>4. Refresh packet artifacts whose source cycle changed after generation.</li>
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
