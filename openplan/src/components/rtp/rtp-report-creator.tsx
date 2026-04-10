"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FilePlus2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function RtpReportCreator({
  rtpCycleId,
  defaultTitle,
}: {
  rtpCycleId: string;
  defaultTitle: string;
}) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        Create board packet record
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
