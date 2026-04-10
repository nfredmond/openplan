import Link from "next/link";
import { BookOpenText, FileOutput, Route as RouteIcon, ScrollText } from "lucide-react";
import { ReportDetailControls } from "@/components/reports/report-detail-controls";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/state-block";
import { formatRtpCycleStatusLabel, rtpCycleStatusTone } from "@/lib/rtp/catalog";
import {
  describeReportSectionKey,
  formatDateTime,
  formatReportStatusLabel,
  formatReportTypeLabel,
  getReportPacketFreshness,
  reportStatusTone,
} from "@/lib/reports/catalog";

function compareCountMetric(label: string, generated: number | null, current: number | null) {
  if (generated === null && current === null) {
    return null;
  }

  if (generated === current) {
    return {
      label,
      status: "unchanged" as const,
      detail: `Still ${current ?? generated ?? 0}.`,
    };
  }

  return {
    label,
    status: "count_changed" as const,
    detail: `Generated with ${generated ?? 0}, current source is ${current ?? 0}.`,
  };
}

function normalizeKeys(keys: string[]) {
  return [...new Set(keys.map((key) => key.trim()).filter(Boolean))].sort();
}

function areKeySetsEqual(left: string[], right: string[]) {
  const leftKeys = normalizeKeys(left);
  const rightKeys = normalizeKeys(right);

  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  return leftKeys.every((key, index) => key === rightKeys[index]);
}

function driftStatusTone(status: "unchanged" | "updated" | "count_changed") {
  if (status === "updated") return "warning" as const;
  if (status === "count_changed") return "info" as const;
  return "success" as const;
}

function driftStatusLabel(status: "unchanged" | "updated" | "count_changed") {
  if (status === "updated") return "Updated";
  if (status === "count_changed") return "Count changed";
  return "Unchanged";
}

export function RtpReportDetail({
  report,
  workspace,
  cycle,
  sections,
  artifacts,
  latestHtml,
  generationContext,
  currentContext,
}: {
  report: {
    id: string;
    title: string;
    report_type: string;
    status: string;
    summary: string | null;
    latest_artifact_kind: string | null;
    generated_at: string | null;
    updated_at: string;
  };
  workspace: { id: string; name: string | null; slug: string | null } | null;
  cycle: {
    id: string;
    title: string;
    status: string;
    summary: string | null;
    geography_label: string | null;
    horizon_start_year: number | null;
    horizon_end_year: number | null;
    updated_at: string;
  } | null;
  sections: Array<{
    id: string;
    section_key: string;
    title: string;
    enabled: boolean;
    sort_order: number;
  }>;
  artifacts: Array<{
    id: string;
    artifact_kind: string;
    generated_at: string;
  }>;
  latestHtml: string | null;
  generationContext: {
    generatedAt: string | null;
    enabledSectionKeys: string[];
    readinessLabel: string | null;
    readinessReason: string | null;
    workflowLabel: string | null;
    workflowDetail: string | null;
    chapterCount: number | null;
    chapterCompleteCount: number | null;
    chapterReadyForReviewCount: number | null;
    linkedProjectCount: number | null;
    engagementCampaignCount: number | null;
  };
  currentContext: {
    enabledSectionKeys: string[];
    readinessLabel: string | null;
    readinessReason: string | null;
    workflowLabel: string | null;
    workflowDetail: string | null;
    chapterCount: number | null;
    chapterCompleteCount: number | null;
    chapterReadyForReviewCount: number | null;
    linkedProjectCount: number | null;
    engagementCampaignCount: number | null;
    cycleUpdatedAt: string | null;
  };
}) {
  const enabledSections = sections.filter((section) => section.enabled).length;
  const packetFreshness = getReportPacketFreshness({
    latestArtifactKind: report.latest_artifact_kind,
    generatedAt: report.generated_at,
    updatedAt: cycle?.updated_at ?? report.updated_at,
  });
  const driftItems = [
    compareCountMetric("Chapters in scope", generationContext.chapterCount, currentContext.chapterCount),
    compareCountMetric(
      "Review-ready chapters",
      generationContext.chapterReadyForReviewCount,
      currentContext.chapterReadyForReviewCount
    ),
    compareCountMetric(
      "Complete chapters",
      generationContext.chapterCompleteCount,
      currentContext.chapterCompleteCount
    ),
    compareCountMetric("Linked projects", generationContext.linkedProjectCount, currentContext.linkedProjectCount),
    compareCountMetric(
      "Engagement targets",
      generationContext.engagementCampaignCount,
      currentContext.engagementCampaignCount
    ),
    generationContext.readinessLabel || currentContext.readinessLabel
      ? {
          label: "Readiness posture",
          status:
            generationContext.readinessLabel === currentContext.readinessLabel &&
            generationContext.readinessReason === currentContext.readinessReason
              ? ("unchanged" as const)
              : ("updated" as const),
          detail:
            generationContext.readinessLabel === currentContext.readinessLabel &&
            generationContext.readinessReason === currentContext.readinessReason
              ? `Still ${currentContext.readinessLabel ?? generationContext.readinessLabel ?? "unknown"}.`
              : `Generated as ${generationContext.readinessLabel ?? "unknown"}; current source is ${currentContext.readinessLabel ?? "unknown"}.`,
        }
      : null,
    generationContext.workflowLabel || currentContext.workflowLabel
      ? {
          label: "Workflow posture",
          status:
            generationContext.workflowLabel === currentContext.workflowLabel &&
            generationContext.workflowDetail === currentContext.workflowDetail
              ? ("unchanged" as const)
              : ("updated" as const),
          detail:
            generationContext.workflowLabel === currentContext.workflowLabel &&
            generationContext.workflowDetail === currentContext.workflowDetail
              ? `Still ${currentContext.workflowLabel ?? generationContext.workflowLabel ?? "unknown"}.`
              : `Generated as ${generationContext.workflowLabel ?? "unknown"}; current source is ${currentContext.workflowLabel ?? "unknown"}.`,
        }
      : null,
    generationContext.enabledSectionKeys.length > 0 || currentContext.enabledSectionKeys.length > 0
      ? {
          label: "Section composition",
          status: areKeySetsEqual(generationContext.enabledSectionKeys, currentContext.enabledSectionKeys)
            ? ("unchanged" as const)
            : ("updated" as const),
          detail: areKeySetsEqual(generationContext.enabledSectionKeys, currentContext.enabledSectionKeys)
            ? "Enabled section set still matches the packet artifact."
            : `Generated with ${generationContext.enabledSectionKeys.length} sections; current source has ${currentContext.enabledSectionKeys.length}.`,
        }
      : null,
  ].filter(
    (
      item
    ): item is {
      label: string;
      status: "unchanged" | "updated" | "count_changed";
      detail: string;
    } => Boolean(item)
  );
  const changedDriftItems = driftItems.filter((item) => item.status !== "unchanged");

  return (
    <section className="module-page">
      <header className="module-header-grid">
        <article className="module-intro-card">
          <div className="module-intro-kicker">
            <ScrollText className="h-3.5 w-3.5" />
            RTP board packet record
          </div>
          <div className="module-intro-body">
            <h1 className="module-intro-title">{report.title}</h1>
            <p className="module-intro-description">
              This report record is anchored to an RTP cycle and points at the compiled digital document and export surfaces.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <StatusBadge tone={reportStatusTone(report.status)}>{formatReportStatusLabel(report.status)}</StatusBadge>
            <StatusBadge tone="info">{formatReportTypeLabel(report.report_type)}</StatusBadge>
            {cycle ? <StatusBadge tone={rtpCycleStatusTone(cycle.status)}>{formatRtpCycleStatusLabel(cycle.status)}</StatusBadge> : null}
            {report.latest_artifact_kind ? <StatusBadge tone="neutral">{report.latest_artifact_kind.toUpperCase()}</StatusBadge> : null}
            <StatusBadge tone={packetFreshness.tone}>{packetFreshness.label}</StatusBadge>
          </div>

          <p className="text-sm text-muted-foreground">
            {report.summary?.trim() || cycle?.summary?.trim() || "No packet summary yet. Use this record to track the RTP cycle packet and generation history."}
          </p>

          <div className="mt-4 flex flex-wrap gap-3">
            {cycle ? (
              <>
                <Link href={`/rtp/${cycle.id}`} className="module-inline-action">
                  Open RTP cycle control room
                </Link>
                <Link href={`/rtp/${cycle.id}/document`} className="module-inline-action">
                  Open compiled digital RTP
                </Link>
                <Link href={`/api/rtp-cycles/${cycle.id}/export?format=html`} target="_blank" className="module-inline-action">
                  Open HTML export
                </Link>
                <Link href={`/api/rtp-cycles/${cycle.id}/export?format=pdf`} target="_blank" className="module-inline-action">
                  Open PDF export
                </Link>
              </>
            ) : null}
          </div>
        </article>

        <article className="module-operator-card">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05]">
              <RouteIcon className="h-5 w-5 text-emerald-200" />
            </span>
            <div>
              <p className="module-operator-eyebrow">Cycle packet bridge</p>
              <h2 className="module-operator-title">Reports can now hold RTP packet records</h2>
            </div>
          </div>
          <p className="module-operator-copy">
            This is the bridge between RTP document assembly and the broader packet registry. It gives the cycle a report record, packet history, and generation status without pretending the RTP is just another project packet.
          </p>
          <div className="module-operator-list">
            <div className="module-operator-item">Workspace: {workspace?.name ?? "Unknown workspace"}</div>
            <div className="module-operator-item">Enabled sections: {enabledSections}</div>
            <div className="module-operator-item">Artifacts: {artifacts.length}</div>
          </div>
        </article>
      </header>

      <div className="mt-6 grid gap-6 xl:grid-cols-[22rem_minmax(0,1fr)]">
        <div className="space-y-6">
          <ReportDetailControls
            report={{
              id: report.id,
              title: report.title,
              summary: report.summary,
              status: report.status,
              hasGeneratedArtifact: Boolean(report.latest_artifact_kind),
            }}
          />

          <article className="module-section-surface">
            <div className="module-section-header">
              <div className="module-section-heading">
                <p className="module-section-label">Packet posture</p>
                <h2 className="module-section-title">Freshness against RTP source</h2>
                <p className="module-section-description">This compares the latest packet artifact against the current RTP cycle state.</p>
              </div>
            </div>
            <div className="rounded-2xl border border-border/70 bg-muted/25 px-4 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone={packetFreshness.tone}>{packetFreshness.label}</StatusBadge>
                {cycle ? <StatusBadge tone="neutral">Cycle updated {formatDateTime(cycle.updated_at)}</StatusBadge> : null}
                {report.generated_at ? <StatusBadge tone="neutral">Packet generated {formatDateTime(report.generated_at)}</StatusBadge> : null}
              </div>
              <p className="mt-3 text-sm text-muted-foreground">{packetFreshness.detail}</p>
              {generationContext.readinessLabel || generationContext.workflowLabel ? (
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="rounded-xl border border-border/70 bg-background px-3 py-3">
                    <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Generation-time readiness</p>
                    <p className="mt-2 text-sm font-semibold text-foreground">{generationContext.readinessLabel ?? "Unknown"}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{generationContext.readinessReason ?? "No readiness reason captured."}</p>
                  </div>
                  <div className="rounded-xl border border-border/70 bg-background px-3 py-3">
                    <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Generation-time workflow</p>
                    <p className="mt-2 text-sm font-semibold text-foreground">{generationContext.workflowLabel ?? "Unknown"}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{generationContext.workflowDetail ?? "No workflow detail captured."}</p>
                  </div>
                </div>
              ) : null}
            </div>
          </article>

          <article className="module-section-surface">
            <div className="module-section-header">
              <div className="module-section-heading">
                <p className="module-section-label">Source drift</p>
                <h2 className="module-section-title">What changed since this packet was generated</h2>
                <p className="module-section-description">Explicit comparison between the saved packet snapshot and the current RTP source state.</p>
              </div>
            </div>
            <div className="rounded-2xl border border-border/70 bg-muted/25 px-4 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone={changedDriftItems.length === 0 ? "success" : "warning"}>
                  {changedDriftItems.length === 0
                    ? "No source drift detected"
                    : `${changedDriftItems.length} drift ${changedDriftItems.length === 1 ? "signal" : "signals"}`}
                </StatusBadge>
                {currentContext.cycleUpdatedAt ? (
                  <StatusBadge tone="neutral">Current source updated {formatDateTime(currentContext.cycleUpdatedAt)}</StatusBadge>
                ) : null}
              </div>
              <div className="mt-4 space-y-2">
                {driftItems.map((item) => (
                  <div key={item.label} className="module-row-card gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone={driftStatusTone(item.status)}>{driftStatusLabel(item.status)}</StatusBadge>
                    </div>
                    <p className="text-sm font-semibold tracking-tight text-foreground">{item.label}</p>
                    <p className="text-xs text-muted-foreground">{item.detail}</p>
                  </div>
                ))}
              </div>
            </div>
          </article>

          <article className="module-section-surface">
            <div className="module-section-header">
              <div className="module-section-heading">
                <p className="module-section-label">Packet source trace</p>
                <h2 className="module-section-title">What this packet was built from</h2>
                <p className="module-section-description">Snapshot of the RTP cycle posture captured at generation time.</p>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <div className="module-metric-card">
                <p className="module-metric-label">Packet generated</p>
                <p className="module-metric-value text-sm">{formatDateTime(generationContext.generatedAt)}</p>
              </div>
              <div className="module-metric-card">
                <p className="module-metric-label">Chapters in scope</p>
                <p className="module-metric-value text-sm">{generationContext.chapterCount ?? 0}</p>
              </div>
              <div className="module-metric-card">
                <p className="module-metric-label">Review-ready chapters</p>
                <p className="module-metric-value text-sm">{generationContext.chapterReadyForReviewCount ?? 0}</p>
              </div>
              <div className="module-metric-card">
                <p className="module-metric-label">Complete chapters</p>
                <p className="module-metric-value text-sm">{generationContext.chapterCompleteCount ?? 0}</p>
              </div>
              <div className="module-metric-card">
                <p className="module-metric-label">Linked projects</p>
                <p className="module-metric-value text-sm">{generationContext.linkedProjectCount ?? 0}</p>
              </div>
              <div className="module-metric-card">
                <p className="module-metric-label">Engagement targets</p>
                <p className="module-metric-value text-sm">{generationContext.engagementCampaignCount ?? 0}</p>
              </div>
            </div>
            <div className="mt-4 rounded-2xl border border-border/70 bg-muted/25 px-4 py-4">
              <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Section composition at generation time</p>
              <p className="mt-2 text-sm text-muted-foreground">
                {generationContext.enabledSectionKeys.length > 0
                  ? generationContext.enabledSectionKeys.join(", ")
                  : "No section composition captured on this artifact."}
              </p>
            </div>
            <div className="mt-4 rounded-2xl border border-border/70 bg-background px-4 py-4">
              <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Current source composition</p>
              <p className="mt-2 text-sm text-muted-foreground">
                {currentContext.enabledSectionKeys.length > 0
                  ? currentContext.enabledSectionKeys.join(", ")
                  : "No enabled section composition is currently configured on this packet record."}
              </p>
            </div>
          </article>

          <article className="module-section-surface">
            <div className="module-section-header">
              <div className="module-section-heading">
                <p className="module-section-label">Sections</p>
                <h2 className="module-section-title">Packet structure</h2>
                <p className="module-section-description">This record still uses the shared report section system.</p>
              </div>
            </div>
            {sections.length === 0 ? (
              <EmptyState title="No sections configured" description="This packet record has no sections yet." compact />
            ) : (
              <div className="space-y-2">
                {sections.map((section) => (
                  <div key={section.id} className="module-row-card gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone={section.enabled ? "success" : "neutral"}>{section.enabled ? "Enabled" : "Disabled"}</StatusBadge>
                      <StatusBadge tone="neutral">Sort {section.sort_order}</StatusBadge>
                    </div>
                    <p className="text-sm font-semibold tracking-tight">{section.title}</p>
                    <p className="text-xs text-muted-foreground">{section.section_key}</p>
                    <p className="text-xs text-muted-foreground">{describeReportSectionKey(section.section_key)}</p>
                  </div>
                ))}
              </div>
            )}
          </article>

          <article className="module-section-surface">
            <div className="module-section-header">
              <div className="module-section-heading">
                <p className="module-section-label">Artifacts</p>
                <h2 className="module-section-title">Generation history</h2>
                <p className="module-section-description">Generated packet artifacts attached to this RTP cycle report record.</p>
              </div>
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-500/12 text-sky-700 dark:text-sky-300">
                <FileOutput className="h-5 w-5" />
              </span>
            </div>
            {artifacts.length === 0 ? (
              <EmptyState title="No packet artifacts yet" description="Generate the report to persist a packet artifact to this record." compact />
            ) : (
              <div className="space-y-2">
                {artifacts.map((artifact) => (
                  <div key={artifact.id} id={`artifact-${artifact.id}`} className="module-row-card gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone="neutral">{artifact.artifact_kind.toUpperCase()}</StatusBadge>
                    </div>
                    <p className="text-sm text-muted-foreground">Generated {formatDateTime(artifact.generated_at)}</p>
                  </div>
                ))}
              </div>
            )}
          </article>
        </div>

        <div className="space-y-6">
          <article className="module-section-surface">
            <div className="module-section-header">
              <div className="module-section-heading">
                <p className="module-section-label">Cycle context</p>
                <h2 className="module-section-title">RTP cycle source</h2>
                <p className="module-section-description">The underlying RTP cycle this packet record is representing.</p>
              </div>
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-500/12 text-emerald-700 dark:text-emerald-300">
                <BookOpenText className="h-5 w-5" />
              </span>
            </div>
            {cycle ? (
              <div className="space-y-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="module-metric-card">
                    <p className="module-metric-label">Geography</p>
                    <p className="module-metric-value text-sm">{cycle.geography_label?.trim() || "Not set"}</p>
                  </div>
                  <div className="module-metric-card">
                    <p className="module-metric-label">Horizon</p>
                    <p className="module-metric-value text-sm">
                      {typeof cycle.horizon_start_year === "number" && typeof cycle.horizon_end_year === "number"
                        ? `${cycle.horizon_start_year}–${cycle.horizon_end_year}`
                        : "Not set"}
                    </p>
                  </div>
                </div>
                <div className="rounded-2xl border border-border/70 bg-muted/25 px-4 py-4">
                  <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Cycle summary</p>
                  <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">
                    {cycle.summary?.trim() || "No cycle summary recorded yet."}
                  </p>
                  <p className="mt-3 text-xs text-muted-foreground">Updated {formatDateTime(cycle.updated_at)}</p>
                </div>
              </div>
            ) : (
              <EmptyState title="Cycle source missing" description="The RTP cycle attached to this packet record could not be loaded." compact />
            )}
          </article>

          <article className="module-section-surface">
            <div className="module-section-header">
              <div className="module-section-heading">
                <p className="module-section-label">Preview</p>
                <h2 className="module-section-title">Latest HTML packet</h2>
                <p className="module-section-description">Most recent generated packet artifact preview.</p>
              </div>
            </div>
            {latestHtml ? (
              <div className="overflow-hidden rounded-2xl border border-border/70 bg-background">
                <div className="max-h-[70vh] overflow-auto p-0" dangerouslySetInnerHTML={{ __html: latestHtml }} />
              </div>
            ) : (
              <EmptyState title="No generated HTML yet" description="Generate the report to attach an HTML packet preview here." compact />
            )}
          </article>
        </div>
      </div>
    </section>
  );
}
