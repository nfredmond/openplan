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
      ? "Create draft packet record"
      : presetStage === "public_review"
        ? "Create public review packet record"
        : presetStage === "adopted"
          ? "Create adoption packet record"
          : presetStage === "archived"
            ? "Create archive packet record"
            : "Create board packet record";

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

      router.push(`/reports/${payload.reportId}`);
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to create RTP board packet record");
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
      <p className="text-xs text-muted-foreground">{describeRtpPacketPresetStage(presetStage)} will be applied automatically based on the current RTP cycle phase.</p>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
