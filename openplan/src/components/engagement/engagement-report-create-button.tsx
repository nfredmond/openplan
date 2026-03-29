"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, FileStack, Loader2 } from "lucide-react";
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
  existingReportGuidance?: {
    reportCount: number;
    packetAttentionCount: number;
    recommendedReportId: string;
    recommendedReportTitle: string;
    recommendedAction: string;
    recommendedDetail: string;
  } | null;
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

function buildSnapshotPreview({
  readyForHandoffCount,
  totalItems,
  actionableCount,
  uncategorizedItems,
}: {
  readyForHandoffCount: number;
  totalItems: number;
  actionableCount: number;
  uncategorizedItems: number;
}) {
  return `${readyForHandoffCount} ready for handoff • ${totalItems} total items • ${actionableCount} actionable review • ${uncategorizedItems} uncategorized`;
}

export function EngagementReportCreateButton({
  campaign,
  counts,
  existingReportGuidance = null,
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
    <div className="space-y-3">
      <div className="rounded-2xl border border-border/60 bg-muted/35 p-3 text-xs text-muted-foreground">
        <p className="font-semibold text-foreground">What this creates</p>
        <p className="mt-1">
          A project status packet with a frozen engagement handoff snapshot tied to this campaign.
        </p>
        <p className="mt-1">
          {buildSnapshotPreview({
            readyForHandoffCount: counts.moderationQueue.readyForHandoffCount,
            totalItems: counts.totalItems,
            actionableCount: counts.moderationQueue.actionableCount,
            uncategorizedItems: counts.uncategorizedItems,
          })}
        </p>
        {existingReportGuidance ? (
          <div
            className={`mt-3 rounded-xl border px-3 py-2 ${
              existingReportGuidance.packetAttentionCount > 0
                ? "border-amber-400/40 bg-amber-50/80 text-amber-950 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-100"
                : "border-border/70 bg-background/70 text-foreground"
            }`}
          >
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div className="space-y-1">
                <p className="font-semibold">
                  This project already has {existingReportGuidance.reportCount} report record{existingReportGuidance.reportCount === 1 ? "" : "s"}.
                </p>
                <p className="text-[0.72rem] leading-relaxed text-current/80">
                  {existingReportGuidance.recommendedAction} {existingReportGuidance.recommendedDetail}
                </p>
                <Link
                  href={`/reports/${existingReportGuidance.recommendedReportId}`}
                  className="inline-flex items-center gap-1 rounded-full border border-current/20 bg-background/70 px-2.5 py-1 text-[0.68rem] font-medium text-current transition-colors hover:border-current/35"
                >
                  Open {existingReportGuidance.recommendedReportTitle}
                </Link>
              </div>
            </div>
          </div>
        ) : null}
        {!campaign.project_id ? (
          <p className="mt-1 text-red-600 dark:text-red-300">
            Link this campaign to a project before creating a handoff report.
          </p>
        ) : null}
      </div>
      <Button type="button" variant="outline" onClick={() => void handleCreateReport()} disabled={isSubmitting || !campaign.project_id}>
        {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileStack className="h-4 w-4" />}
        Create handoff report
      </Button>
      {error ? <p className="text-xs text-red-600 dark:text-red-300">{error}</p> : null}
    </div>
  );
}
