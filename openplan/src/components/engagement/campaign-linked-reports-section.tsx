import Link from "next/link";
import { ArrowRight, FileStack } from "lucide-react";

import { MetaItem, MetaList } from "@/components/ui/meta-item";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState, StateBlock } from "@/components/ui/state-block";
import {
  formatDateTime,
  formatReportStatusLabel,
  formatReportTypeLabel,
  getReportPacketActionLabel,
  reportStatusTone,
  type ReportPacketFreshness,
} from "@/lib/reports/catalog";

/**
 * "Which reports already carry this campaign" — the report-awareness section of
 * the engagement campaign console.
 *
 * IT LIVES HERE RATHER THAN INLINE FOR TWO REASONS. The console page is at the
 * repo's 1,200-line ceiling, and this section is the most self-contained thing
 * on it: it is pure presentation over values the page has already computed.
 *
 * AND ITS EMPTY STATES ARE THE POINT. Each of the four branches below is a
 * different fact and they were once one: a failed read of the project, or of
 * the reports, rendered "No reports linked through this project yet" — a
 * campaign told its reporting lane is empty because a query never returned.
 * A read that failed may not be rendered as an answer, so the branches are
 * ordered failure-first: unreadable, then genuinely absent.
 */

export type CampaignLinkedReport = {
  id: string;
  title: string;
  report_type: string;
  status: string;
  generated_at: string | null;
  updated_at: string;
  isExplicitCampaignSource: boolean;
  packetFreshness: ReportPacketFreshness;
};

export function CampaignLinkedReportsSection({
  projectUnreadable,
  reportsUnreadable,
  reportSectionLinksUnreadable,
  projectLinked,
  reports,
  explicitlyLinkedReportCount,
  projectOnlyReportCount,
  packetAttentionCount,
  recommendedReport,
  latestArtifactGeneratedAtByReportId,
}: {
  projectUnreadable: boolean;
  reportsUnreadable: boolean;
  reportSectionLinksUnreadable: boolean;
  projectLinked: boolean;
  reports: CampaignLinkedReport[];
  explicitlyLinkedReportCount: number;
  projectOnlyReportCount: number;
  packetAttentionCount: number;
  recommendedReport: CampaignLinkedReport | null;
  latestArtifactGeneratedAtByReportId: Map<string, string | null>;
}) {
  return (
    <article className="module-section-surface">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Report Awareness</p>
          <h2 className="module-section-title">Project-linked reports</h2>
          <p className="module-section-description">
            Linked project reports remain visible so campaigns do not sit outside the broader Planning OS record.
          </p>
        </div>
        <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-[color:var(--pine)]/10 text-[color:var(--pine)]">
          <FileStack className="h-5 w-5" />
        </span>
      </div>

      {projectUnreadable ? (
        <div className="mt-5">
          <StateBlock
            tone="danger"
            title="The linked project could not be read, so its reports were not looked up"
            description="This campaign is linked to a project. Because that record could not be read, OpenPlan cannot say which reports exist on it — this is not a campaign without reporting."
            compact
          />
        </div>
      ) : reportsUnreadable ? (
        <div className="mt-5">
          <StateBlock
            tone="danger"
            title="Reports on this project could not be listed"
            description="The report list could not be read, so OpenPlan cannot say whether this project has reports. This is not a statement that none exist."
            compact
          />
        </div>
      ) : !projectLinked ? (
        <div className="mt-5">
          <EmptyState
            title="No linked project yet"
            description="Attach this campaign to a project before expecting report-aware handoff cues."
            compact
          />
        </div>
      ) : reports.length === 0 ? (
        <div className="mt-5">
          <EmptyState
            title="No reports linked through this project yet"
            description="Project-linked reports will appear here once reporting catches up with the campaign."
            compact
          />
        </div>
      ) : (
        <div className="mt-5 space-y-3">
          <MetaList>
            <MetaItem>{explicitlyLinkedReportCount} explicit campaign-source reports</MetaItem>
            <MetaItem>{projectOnlyReportCount} project-linked only</MetaItem>
            <MetaItem>{packetAttentionCount} packet issue{packetAttentionCount === 1 ? "" : "s"}</MetaItem>
          </MetaList>
          {/* Without the section links every report below is labelled
              "project-linked only" — a statement that no report sources this
              campaign, made by a query that failed rather than by the record. */}
          {reportSectionLinksUnreadable ? (
            <StateBlock
              tone="danger"
              title="Which reports source this campaign could not be read"
              description="The report sections could not be read, so every report below is shown as project-linked only. That is the fallback label, not a finding — a report may well already name this campaign as a source."
              compact
            />
          ) : null}
          <div
            className={`module-note ${
              packetAttentionCount > 0
                ? "border-amber-400/40 bg-amber-50/80 dark:border-amber-900 dark:bg-amber-950/20"
                : "border-emerald-400/35 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/20"
            }`}
          >
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Campaign reporting posture
            </p>
            <h3 className="mt-2 text-sm font-semibold text-foreground">
              {packetAttentionCount > 0 && recommendedReport
                ? `${recommendedReport.title} needs packet attention`
                : "Linked campaign packets look current"}
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {recommendedReport
                ? getReportPacketActionLabel(recommendedReport.packetFreshness.label)
                : "Open reports to create the first linked packet for this campaign's project context."}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {recommendedReport?.packetFreshness.detail ??
                "No project-linked reports are available for this campaign yet."}
            </p>
          </div>
          {reports.slice(0, 4).map((report) => {
            const generatedAt = latestArtifactGeneratedAtByReportId.get(report.id) ?? report.generated_at;
            return (
              <Link key={report.id} href={`/reports/${report.id}`} className="module-record-row is-interactive group block">
                <div className="module-record-head">
                  <div className="module-record-main">
                    <div className="module-record-kicker">
                      <StatusBadge tone={reportStatusTone(report.status)}>{formatReportStatusLabel(report.status)}</StatusBadge>
                      <StatusBadge tone={report.packetFreshness.tone}>{report.packetFreshness.label}</StatusBadge>
                    </div>
                    <h3 className="module-record-title text-[1rem] transition group-hover:text-primary">{report.title}</h3>
                    <p className="module-record-summary">{formatReportTypeLabel(report.report_type)} · {report.isExplicitCampaignSource ? "Campaign source linked" : "Project-linked only"}</p>
                    <p className="module-record-summary">
                      {report.isExplicitCampaignSource
                        ? "This report explicitly includes this campaign as an engagement source section."
                        : "This report shares the project context, but does not explicitly source this campaign yet."}
                    </p>
                    <p className="module-record-summary">{report.packetFreshness.detail}</p>
                    <p className="module-record-summary">{getReportPacketActionLabel(report.packetFreshness.label)}</p>
                    <p className="module-record-summary">
                      Updated {formatDateTime(report.updated_at)}
                      {generatedAt ? ` • Generated ${formatDateTime(generatedAt)}` : " • Draft report record"}
                    </p>
                  </div>
                  <ArrowRight className="mt-0.5 h-4.5 w-4.5 text-muted-foreground transition group-hover:text-primary" />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </article>
  );
}
