"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FilePlus2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { describeRtpPacketPresetStage } from "@/lib/reports/catalog";

export function RtpReportCreator({
  rtpCycleId,
  defaultTitle,
  cycleStatus,
}: {
  rtpCycleId: string;
  defaultTitle: string;
  cycleStatus: string | null;
}) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const presetStage =
    cycleStatus === "draft" ||
    cycleStatus === "public_review" ||
    cycleStatus === "adopted" ||
    cycleStatus === "archived"
      ? cycleStatus
      : "default";
  const buttonLabel =
    presetStage === "draft"
      ? "Create and generate draft packet"
      : presetStage === "public_review"
        ? "Create and generate public review packet"
        : presetStage === "adopted"
          ? "Create and generate adoption packet"
          : presetStage === "archived"
            ? "Create and generate archive packet"
            : "Create and generate board packet";

  async function handleCreate() {
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/reports", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          rtpCycleId,
          reportType: "board_packet",
          title: defaultTitle,
        }),
      });

      const payload = (await response.json()) as { reportId?: string; error?: string };
      if (!response.ok || !payload.reportId) {
        throw new Error(payload.error || "Failed to create RTP board packet record");
      }

      const generateResponse = await fetch(`/api/reports/${payload.reportId}/generate`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ format: "html" }),
      });

      const generatePayload = (await generateResponse.json().catch(() => null)) as
        | { error?: string }
        | null;

      if (!generateResponse.ok) {
        throw new Error(generatePayload?.error || "Failed to generate the first RTP packet artifact");
      }

      router.push(`/reports/${payload.reportId}`);
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to create and generate the RTP board packet");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button type="button" variant="outline" onClick={handleCreate} disabled={isSubmitting}>
        {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FilePlus2 className="h-4 w-4" />}
        {buttonLabel}
      </Button>
      <p className="text-xs text-muted-foreground">{describeRtpPacketPresetStage(presetStage)} will be applied automatically based on the current RTP cycle phase, then the first packet artifact will be generated immediately.</p>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
