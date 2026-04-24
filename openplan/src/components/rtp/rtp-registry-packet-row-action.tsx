"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, FileCog, FilePlus2, Loader2, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getReportNavigationHref,
  getRtpPacketActionButtonLabel,
  type RtpPacketAttention,
} from "@/lib/reports/catalog";
import { PACKET_FRESHNESS_LABELS } from "@/lib/reports/packet-labels";
import { createRtpPacketRecord, generateReportArtifact } from "@/lib/reports/client";

export function RtpRegistryPacketRowAction({
  cycleId,
  reportId,
  packetAttention,
  needsFirstArtifact = false,
  modelingCountyRunId,
}: {
  cycleId: string;
  reportId: string | null;
  packetAttention: RtpPacketAttention;
  needsFirstArtifact?: boolean;
  modelingCountyRunId?: string | null;
}) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (packetAttention === "current") {
    if (!reportId) {
      return null;
    }

    return (
      <div className="space-y-2">
        <Link href={getReportNavigationHref(reportId, PACKET_FRESHNESS_LABELS.CURRENT)} className="module-inline-action w-fit">
          {getRtpPacketActionButtonLabel({ packetAttention: "current" })}
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    );
  }

  async function handleClick() {
    setIsSubmitting(true);
    setMessage(null);
    setError(null);

    try {
      let activeReportId = reportId;
      let warningCount = 0;

      if (packetAttention === "missing") {
        const createResult = await createRtpPacketRecord({
          rtpCycleId: cycleId,
          modelingCountyRunId,
          generateAfterCreate: true,
        });

        activeReportId = createResult.reportId;
        warningCount = createResult.warningCount;
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

        warningCount = (await generateReportArtifact(activeReportId)).warningCount;
        setMessage(
          `Reset the packet to its recommended phase preset and regenerated it.${warningCount > 0 ? ` ${warningCount} generation warning${warningCount === 1 ? " was" : "s were"} returned.` : ""}`
        );
      } else {
        if (!activeReportId) {
          throw new Error("No RTP packet record was found to regenerate");
        }

        warningCount = (await generateReportArtifact(activeReportId)).warningCount;
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

  const buttonCopy = getRtpPacketActionButtonLabel({
    packetAttention,
    needsFirstArtifact,
  });

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
