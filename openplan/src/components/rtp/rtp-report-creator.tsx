"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FilePlus2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { describeRtpPacketPresetStage } from "@/lib/reports/catalog";
import { createRtpPacketRecord } from "@/lib/reports/client";

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
      const result = await createRtpPacketRecord({
        rtpCycleId,
        title: defaultTitle,
        generateAfterCreate: true,
      });

      router.push(`/reports/${result.reportId}`);
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
