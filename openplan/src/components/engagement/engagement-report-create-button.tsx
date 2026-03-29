"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileStack, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildEngagementHandoffProvenance } from "@/lib/reports/engagement";

type EngagementReportCreateButtonProps = {
  campaign: {
    id: string;
    title: string;
    summary: string | null;
    status: string | null;
    engagement_type: string | null;
    project_id: string | null;
    created_at: string;
    updated_at: string;
  };
  counts: {
    moderationQueue: {
      actionableCount: number;
      readyForHandoffCount: number;
    };
    uncategorizedItems: number;
    totalItems: number;
  };
};

function buildReportSummary({
  campaignTitle,
  summary,
  readyForHandoffCount,
  actionableCount,
  uncategorizedItems,
}: {
  campaignTitle: string;
  summary: string | null;
  readyForHandoffCount: number;
  actionableCount: number;
  uncategorizedItems: number;
}) {
  return [
    `Engagement handoff packet for ${campaignTitle}.`,
    summary?.trim() || null,
    `${readyForHandoffCount} approved and categorized items are ready for planning review.`,
    actionableCount > 0
      ? `${actionableCount} items still need moderation attention.`
      : "No items are currently blocked in the moderation queue.",
    uncategorizedItems > 0
      ? `${uncategorizedItems} items still need category assignment before downstream reporting is complete.`
      : "Category assignment is complete for all current items.",
  ]
    .filter(Boolean)
    .join(" ");
}

export function EngagementReportCreateButton({
  campaign,
  counts,
}: EngagementReportCreateButtonProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreateReport() {
    if (!campaign.project_id) {
      setError("Link this campaign to a project before creating a handoff report.");
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const handoffProvenance = buildEngagementHandoffProvenance({
        capturedAt: new Date().toISOString(),
        campaign: {
          id: campaign.id,
          projectId: campaign.project_id,
          title: campaign.title,
          summary: campaign.summary,
          status: campaign.status,
          engagementType: campaign.engagement_type,
          createdAt: campaign.created_at,
          updatedAt: campaign.updated_at,
        },
        counts: {
          totalItems: counts.totalItems,
          readyForHandoffCount: counts.moderationQueue.readyForHandoffCount,
          actionableCount: counts.moderationQueue.actionableCount,
          uncategorizedItems: counts.uncategorizedItems,
        },
      });

      const response = await fetch("/api/reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: campaign.project_id,
          reportType: "project_status",
          title: `${campaign.title} Engagement Handoff Packet`,
          summary: buildReportSummary({
            campaignTitle: campaign.title,
            summary: campaign.summary,
            readyForHandoffCount: counts.moderationQueue.readyForHandoffCount,
            actionableCount: counts.moderationQueue.actionableCount,
            uncategorizedItems: counts.uncategorizedItems,
          }),
          sections: [
            {
              sectionKey: "project_overview",
              title: "Project overview",
              enabled: true,
              sortOrder: 0,
            },
            {
              sectionKey: "status_snapshot",
              title: "Campaign and project snapshot",
              enabled: true,
              sortOrder: 1,
              configJson: {
                campaignId: campaign.id,
                provenance: handoffProvenance,
              },
            },
            {
              sectionKey: "engagement_summary",
              title: "Engagement campaign summary",
              enabled: true,
              sortOrder: 2,
              configJson: {
                campaignId: campaign.id,
                provenance: handoffProvenance,
              },
            },
            {
              sectionKey: "methods_assumptions",
              title: "Methods and provenance",
              enabled: true,
              sortOrder: 3,
            },
          ],
        }),
      });

      const payload = (await response.json()) as { error?: string; reportId?: string };
      if (!response.ok || !payload.reportId) {
        throw new Error(payload.error || "Failed to create handoff report");
      }

      router.push(`/reports/${payload.reportId}`);
      router.refresh();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create handoff report");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button type="button" variant="outline" onClick={() => void handleCreateReport()} disabled={isSubmitting || !campaign.project_id}>
        {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileStack className="h-4 w-4" />}
        Create handoff report
      </Button>
      {error ? <p className="text-xs text-red-600 dark:text-red-300">{error}</p> : null}
    </div>
  );
}
