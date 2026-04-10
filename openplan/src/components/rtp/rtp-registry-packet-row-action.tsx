"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileCog, FilePlus2, Loader2, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

type PacketAttention = "missing" | "reset" | "refresh" | "current";

export function RtpRegistryPacketRowAction({
  cycleId,
  reportId,
  packetAttention,
  needsFirstArtifact = false,
}: {
  cycleId: string;
  reportId: string | null;
  packetAttention: PacketAttention;
  needsFirstArtifact?: boolean;
}) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (packetAttention === "current") {
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
      throw new Error(payload.error || "Failed to generate RTP packet");
    }

    return payload.warnings?.length ?? 0;
  }

  async function handleClick() {
    setIsSubmitting(true);
    setMessage(null);
    setError(null);

    try {
      let activeReportId = reportId;
      let warningCount = 0;

      if (packetAttention === "missing") {
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
          throw new Error(createPayload.error || "Failed to create the first RTP packet record");
        }

        activeReportId = createPayload.reportId;
        warningCount = await generateReport(activeReportId);
        setMessage(
          `Created and generated the first RTP packet.${warningCount > 0 ? ` ${warningCount} generation warning${warningCount === 1 ? " was" : "s were"} returned.` : ""}`
        );
      } else if (packetAttention === "reset") {
        const resetResponse = await fetch("/api/rtp-cycles/packet-presets", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cycleIds: [cycleId] }),
        });

        const resetPayload = (await resetResponse.json()) as {
          error?: string;
        };

        if (!resetResponse.ok) {
          throw new Error(resetPayload.error || "Failed to reset the RTP packet preset");
        }

        if (!activeReportId) {
          throw new Error("No RTP packet record was found to regenerate after preset reset");
        }

        warningCount = await generateReport(activeReportId);
        setMessage(
          `Reset the packet to its recommended phase preset and regenerated it.${warningCount > 0 ? ` ${warningCount} generation warning${warningCount === 1 ? " was" : "s were"} returned.` : ""}`
        );
      } else {
        if (!activeReportId) {
          throw new Error("No RTP packet record was found to regenerate");
        }

        warningCount = await generateReport(activeReportId);
        setMessage(
          `${needsFirstArtifact ? "Generated the first RTP packet artifact." : "Regenerated the RTP packet from current source state."}${warningCount > 0 ? ` ${warningCount} generation warning${warningCount === 1 ? " was" : "s were"} returned.` : ""}`
        );
      }

      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to update RTP packet state");
    } finally {
      setIsSubmitting(false);
    }
  }

  const buttonCopy =
    packetAttention === "missing"
      ? "Create and generate packet"
      : packetAttention === "reset"
        ? "Reset and regenerate packet"
        : needsFirstArtifact
          ? "Generate first artifact"
          : "Regenerate packet";

  const Icon =
    packetAttention === "missing" ? FilePlus2 : packetAttention === "reset" ? WandSparkles : FileCog;

  return (
    <div className="space-y-2">
      <Button type="button" variant="outline" onClick={handleClick} disabled={isSubmitting}>
        {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
        {buttonCopy}
      </Button>
      {message ? <p className="text-xs text-emerald-700 dark:text-emerald-300">{message}</p> : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
