"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileCog, FilePlus2, Loader2, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

export type DominantActionKey =
  | "createPacket"
  | "resetAndRegenerate"
  | "generateFirstArtifact"
  | "refreshArtifact"
  | "releaseReview"
  | "traceFollowUp";

export function RtpRegistryNextActionShortcut({
  actionKey,
  cycleIds,
  reportIds,
}: {
  actionKey: DominantActionKey;
  cycleIds: string[];
  reportIds: string[];
}) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (actionKey === "traceFollowUp" || actionKey === "releaseReview") {
    return null;
  }

  async function generateReport(targetReportId: string) {
    const response = await fetch(`/api/reports/${targetReportId}/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ format: "html" }),
    });

    const payload = (await response.json()) as {
      error?: string;
      warnings?: Array<unknown>;
    };

    if (!response.ok) {
      throw new Error(payload.error || "Failed to generate one or more RTP packets");
    }

    return payload.warnings?.length ?? 0;
  }

  async function handleApply() {
    setIsSubmitting(true);
    setMessage(null);
    setError(null);

    try {
      let warningCount = 0;

      if (actionKey === "createPacket") {
        let createdCount = 0;

        for (const cycleId of cycleIds) {
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
            throw new Error(createPayload.error || "Failed to create one or more RTP packet records");
          }

          createdCount += 1;
          warningCount += await generateReport(createPayload.reportId);
        }

        setMessage(
          `Created and generated ${createdCount} first RTP packet ${createdCount === 1 ? "record" : "records"}.${warningCount > 0 ? ` ${warningCount} generation warning${warningCount === 1 ? " was" : "s were"} returned.` : ""}`
        );
      } else if (actionKey === "resetAndRegenerate") {
        const resetResponse = await fetch("/api/rtp-cycles/packet-presets", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cycleIds }),
        });

        const resetPayload = (await resetResponse.json()) as {
          error?: string;
        };

        if (!resetResponse.ok) {
          throw new Error(resetPayload.error || "Failed to reset RTP packet presets");
        }

        let regeneratedCount = 0;
        for (const reportId of [...new Set(reportIds)]) {
          warningCount += await generateReport(reportId);
          regeneratedCount += 1;
        }

        setMessage(
          `Reset and regenerated ${regeneratedCount} RTP packet ${regeneratedCount === 1 ? "artifact" : "artifacts"}.${warningCount > 0 ? ` ${warningCount} generation warning${warningCount === 1 ? " was" : "s were"} returned.` : ""}`
        );
      } else {
        let generatedCount = 0;
        for (const reportId of [...new Set(reportIds)]) {
          warningCount += await generateReport(reportId);
          generatedCount += 1;
        }

        setMessage(
          `${actionKey === "generateFirstArtifact" ? "Generated" : "Refreshed"} ${generatedCount} RTP packet ${generatedCount === 1 ? "artifact" : "artifacts"}.${warningCount > 0 ? ` ${warningCount} generation warning${warningCount === 1 ? " was" : "s were"} returned.` : ""}`
        );
      }

      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to run the dominant RTP queue action");
    } finally {
      setIsSubmitting(false);
    }
  }

  const buttonLabel =
    actionKey === "createPacket"
      ? "Run dominant create lane"
      : actionKey === "resetAndRegenerate"
        ? "Run dominant reset lane"
        : actionKey === "generateFirstArtifact"
          ? "Run dominant generate lane"
          : "Run dominant refresh lane";

  const Icon =
    actionKey === "createPacket"
      ? FilePlus2
      : actionKey === "resetAndRegenerate"
        ? WandSparkles
        : FileCog;

  const isDisabled =
    isSubmitting || (actionKey === "createPacket" ? cycleIds.length === 0 : reportIds.length === 0);

  return (
    <div className="space-y-2">
      <Button type="button" variant="outline" onClick={handleApply} disabled={isDisabled}>
        {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
        {buttonLabel}
      </Button>
      {message ? <p className="text-xs text-emerald-700 dark:text-emerald-300">{message}</p> : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
