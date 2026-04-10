import Link from "next/link";
import { BookOpenText, FileOutput, Route as RouteIcon, ScrollText } from "lucide-react";
import { ReportDetailControls } from "@/components/reports/report-detail-controls";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/state-block";
import { formatRtpCycleStatusLabel, rtpCycleStatusTone } from "@/lib/rtp/catalog";
import { formatDateTime, formatReportStatusLabel, formatReportTypeLabel, reportStatusTone } from "@/lib/reports/catalog";

export function RtpReportDetail({
  report,
  workspace,
  cycle,
  sections,
  artifacts,
  latestHtml,
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
}) {
  const enabledSections = sections.filter((section) => section.enabled).length;

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
