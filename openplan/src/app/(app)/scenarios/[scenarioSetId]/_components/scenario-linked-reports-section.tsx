import Link from "next/link";
import { AlertTriangle, ArrowRight, FileStack } from "lucide-react";
import { MetaItem, MetaList } from "@/components/ui/meta-item";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  formatReportStatusLabel,
  formatReportTypeLabel,
  getReportPacketActionLabel,
  getReportPacketFreshness,
  reportStatusTone,
} from "@/lib/reports/catalog";
import { buildScenarioLinkedReports } from "@/lib/scenarios/catalog";

export type ScenarioLinkedReportWithFreshness = ReturnType<
  typeof buildScenarioLinkedReports
>["linkedReports"][number] & {
  packetFreshness: ReturnType<typeof getReportPacketFreshness>;
};

/**
 * The reports that already cite this scenario set's attached runs.
 *
 * Moved out of the scenario set page unchanged when that page became a record
 * hub. `linkedReportsUnreadable` must stay a prop: an empty list after a failed
 * read is not a statement that no report uses these runs, and only the page
 * knows whether the reads behind the list succeeded.
 */
export function ScenarioLinkedReportsSection({
  linkedReportsUnreadable,
  linkedReportsWithFreshness,
  linkedReportAttentionCount,
  recommendedLinkedReport,
  latestArtifactByReportId,
}: {
  linkedReportsUnreadable: boolean;
  linkedReportsWithFreshness: ScenarioLinkedReportWithFreshness[];
  linkedReportAttentionCount: number;
  recommendedLinkedReport: ScenarioLinkedReportWithFreshness | null;
  latestArtifactByReportId: Map<string, { generated_at: string | null }>;
}) {
  return (
    <article className="module-section-surface">
      <div className="module-section-header">
        <div className="module-section-heading">
          <h2 className="module-section-title">Scenario-linked report records</h2>
          <p className="module-section-description">
            Lightweight linkage only: reports are shown when they already reference this scenario set&apos;s attached runs.
          </p>
        </div>
        <div className="module-record-kicker">
          <StatusBadge tone={linkedReportsUnreadable ? "warning" : "neutral"}>
            <FileStack className="h-3.5 w-3.5" />
            {linkedReportsUnreadable ? "Linkage unreadable" : `${linkedReportsWithFreshness.length} linked`}
          </StatusBadge>
          {linkedReportAttentionCount > 0 ? (
            <StatusBadge tone="warning">
              <AlertTriangle className="h-3.5 w-3.5" />
              {linkedReportAttentionCount} need{linkedReportAttentionCount === 1 ? "s" : ""} packet attention
            </StatusBadge>
          ) : null}
        </div>
      </div>

      {linkedReportsUnreadable ? (
        <div className="module-empty-state mt-5 text-sm">
          Report linkage could not be resolved for this render — this project&apos;s reports or their run links could
          not be read. Nothing is listed below, and that is not a statement that no report uses this scenario
          set&apos;s runs.
        </div>
      ) : linkedReportsWithFreshness.length === 0 ? (
        <div className="module-empty-state mt-5 text-sm">
          No linked reports yet. When comparison-ready evidence exists, create an analysis summary report from an alternative card.
        </div>
      ) : (
        <>
          <div
            className={`module-note mt-5 ${
              linkedReportAttentionCount > 0
                ? "border-amber-400/40 bg-amber-50/80 dark:border-amber-900 dark:bg-amber-950/20"
                : "border-emerald-400/35 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/20"
            }`}
          >
            <p className="text-xs font-semibold text-muted-foreground">
              Reports built on this scenario set
            </p>
            <h3 className="mt-2 text-sm font-semibold text-foreground">
              {linkedReportAttentionCount > 0 && recommendedLinkedReport
                ? `${recommendedLinkedReport.title ?? "Linked report"} needs packet attention`
                : "Linked packets look current"}
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {recommendedLinkedReport
                ? getReportPacketActionLabel(recommendedLinkedReport.packetFreshness.label)
                : "Open reports to create the first packet tied to this scenario evidence."}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {recommendedLinkedReport?.packetFreshness.detail ??
                "No linked reports use this scenario set's runs yet."}
            </p>
          </div>

          <div className="mt-5 module-record-list">
            {linkedReportsWithFreshness.map((report) => (
              <Link key={report.id} href={`/reports/${report.id}`} className="module-record-row is-interactive group block">
                <div className="module-record-head">
                  <div className="module-record-main">
                    <div className="module-record-kicker">
                      <StatusBadge tone={reportStatusTone(report.status ?? "draft")}>
                        {formatReportStatusLabel(report.status)}
                      </StatusBadge>
                      <StatusBadge tone={report.packetFreshness.tone}>
                        {report.packetFreshness.label}
                      </StatusBadge>
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <h3 className="module-record-title text-[1.05rem] transition group-hover:text-primary">{report.title ?? "Untitled report"}</h3>
                        <p className="module-record-stamp">Updated {report.updated_at ?? report.generated_at ?? "Unknown"}</p>
                      </div>
                      <p className="module-record-summary line-clamp-2">
                        {report.comparisonReady
                          ? `Grounded by baseline + alternative runs from this set: ${report.matchedEntryLabels.join(" · ")}`
                          : report.matchedBaselineRun
                            ? `Includes the baseline run from this set, but no comparison-ready alternative yet: ${report.matchedEntryLabels.join(" · ")}`
                            : `Shares alternative runs with this set, but not enough evidence for a comparison-ready packet: ${report.matchedEntryLabels.join(" · ")}`}
                      </p>
                      <p className="text-label text-muted-foreground">{formatReportTypeLabel(report.report_type)} · {report.comparisonReady ? "Comparison-ready" : "Run-linked only"} · {report.packetFreshness.detail}</p>
                      <p className="text-sm font-medium text-foreground/80">
                        {getReportPacketActionLabel(report.packetFreshness.label)}
                      </p>
                    </div>
                  </div>
                  <ArrowRight className="mt-0.5 h-4.5 w-4.5 text-muted-foreground transition group-hover:text-primary" />
                </div>
                <MetaList>
                  <MetaItem>{report.matchedRunIds.length} matching runs</MetaItem>
                  <MetaItem>
                    {latestArtifactByReportId.get(report.id)?.generated_at ?? report.generated_at
                      ? `Generated ${latestArtifactByReportId.get(report.id)?.generated_at ?? report.generated_at}`
                      : "Draft packet"}
                  </MetaItem>
                </MetaList>
              </Link>
            ))}
          </div>
        </>
      )}
    </article>
  );
}
