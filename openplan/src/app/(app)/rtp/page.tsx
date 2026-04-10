import { redirect } from "next/navigation";
import { ArrowRight, Compass, FolderKanban, Route as RouteIcon, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/ui/state-block";
import { WorkspaceMembershipRequired } from "@/components/workspaces/workspace-membership-required";
import { RtpCycleCreator } from "@/components/rtp/rtp-cycle-creator";
import { RtpRegistryPacketBulkGenerateActions } from "@/components/rtp/rtp-registry-packet-bulk-generate-actions";
import { RtpRegistryPacketBulkActions } from "@/components/rtp/rtp-registry-packet-bulk-actions";
import { RtpRegistryPacketQueueCommandBoard } from "@/components/rtp/rtp-registry-packet-queue-command-board";
import { RtpRegistryPacketRowAction } from "@/components/rtp/rtp-registry-packet-row-action";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  formatReportStatusLabel,
  getReportNavigationHref,
  getReportPacketFreshness,
  getRtpPacketPresetAlignment,
} from "@/lib/reports/catalog";
import { createClient } from "@/lib/supabase/server";
import {
  buildRtpCycleReadiness,
  buildRtpCycleWorkflowSummary,
  formatRtpDate,
  formatRtpDateTime,
  formatRtpCycleStatusLabel,
  rtpCycleStatusTone,
  RTP_CYCLE_STATUS_OPTIONS,
} from "@/lib/rtp/catalog";
import {
  CURRENT_WORKSPACE_MEMBERSHIP_SELECT,
  type WorkspaceMembershipRow,
  unwrapWorkspaceRecord,
} from "@/lib/workspaces/current";

type RtpPageSearchParams = Promise<{
  status?: string;
  packet?: string;
}>;

type RtpCycleRow = {
  id: string;
  workspace_id: string;
  title: string;
  status: string;
  geography_label: string | null;
  horizon_start_year: number | null;
  horizon_end_year: number | null;
  adoption_target_date: string | null;
  public_review_open_at: string | null;
  public_review_close_at: string | null;
  summary: string | null;
  created_at: string;
  updated_at: string;
};

type ProjectRtpLinkRow = {
  id: string;
  project_id: string;
  rtp_cycle_id: string;
  portfolio_role: string;
};

type RtpPacketReportRow = {
  id: string;
  rtp_cycle_id: string;
  title: string;
  report_type: string;
  status: string;
  generated_at: string | null;
  latest_artifact_kind: string | null;
  updated_at: string;
};

type ReportSectionRow = {
  id: string;
  report_id: string;
  section_key: string;
  enabled: boolean;
  sort_order: number;
};

type PacketAttentionFilter = "all" | "refresh" | "missing" | "reset" | "current";

function looksLikePendingSchema(message: string | null | undefined): boolean {
  return /relation .* does not exist|could not find the table|schema cache|column .* does not exist/i.test(message ?? "");
}

function normalizePacketAttentionFilter(value: string | null | undefined): PacketAttentionFilter {
  switch (value) {
    case "refresh":
    case "missing":
    case "reset":
    case "current":
      return value;
    default:
      return "all";
  }
}

function buildRtpRegistryHref(filters: { status?: string | null; packet?: PacketAttentionFilter | null }) {
  const params = new URLSearchParams();
  if (filters.status) {
    params.set("status", filters.status);
  }
  if (filters.packet && filters.packet !== "all") {
    params.set("packet", filters.packet);
  }
  const query = params.toString();
  return query ? `/rtp?${query}` : "/rtp";
}

function getPacketAttentionPriority(packetAttention: Exclude<PacketAttentionFilter, "all">) {
  switch (packetAttention) {
    case "reset":
      return 0;
    case "missing":
      return 1;
    case "refresh":
      return 2;
    default:
      return 3;
  }
}

function matchesPacketAttentionFilter(filter: PacketAttentionFilter, packetAttention: Exclude<PacketAttentionFilter, "all">) {
  if (filter === "all") {
    return true;
  }
  return filter === packetAttention;
}

function buildPacketOperatorStatus(input: {
  packetReport: RtpPacketReportRow | null;
  packetFreshness: { label: string };
  packetPresetPosture: { label: string };
}) {
  if (!input.packetReport) {
    return {
      label: "Queue-ready",
      tone: "warning" as const,
      detail: "Create the first RTP packet record from the queue board.",
    };
  }

  if (input.packetPresetPosture.label === "Needs reset") {
    return {
      label: "Intervention needed",
      tone: "warning" as const,
      detail: "Reset the packet layout, then regenerate the stale artifact.",
    };
  }

  if (input.packetFreshness.label === "Refresh recommended") {
    return {
      label: "Ready to regenerate",
      tone: "info" as const,
      detail: "The packet layout is usable, but the artifact should be regenerated from current source state.",
    };
  }

  if (input.packetFreshness.label === "No packet") {
    return {
      label: "Record ready",
      tone: "info" as const,
      detail: "A packet record exists, but it still needs its first generated artifact.",
    };
  }

  return {
    label: "Queue clear",
    tone: "success" as const,
    detail: "Packet record and latest artifact are aligned with current cycle state.",
  };
}

export default async function RtpPage({ searchParams }: { searchParams: RtpPageSearchParams }) {
  const filters = await searchParams;
  const selectedPacketFilter = normalizePacketAttentionFilter(filters.packet);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const { data: memberships } = await supabase
    .from("workspace_members")
    .select(CURRENT_WORKSPACE_MEMBERSHIP_SELECT)
    .eq("user_id", user.id)
    .limit(1);

  const membership = memberships?.[0] as WorkspaceMembershipRow | undefined;
  const workspace = unwrapWorkspaceRecord(membership?.workspaces);

  if (!membership || !workspace) {
    return (
      <WorkspaceMembershipRequired
        moduleLabel="RTP"
        title="RTP cycles need a provisioned workspace"
        description="RTP cycles only appear inside a real workspace. You are signed in, but no workspace membership was found for this account, so the registry would otherwise look empty for ambiguous reasons."
      />
    );
  }

  const { data: rtpCyclesData } = await supabase
    .from("rtp_cycles")
    .select(
      "id, workspace_id, title, status, geography_label, horizon_start_year, horizon_end_year, adoption_target_date, public_review_open_at, public_review_close_at, summary, created_at, updated_at"
    )
    .order("updated_at", { ascending: false });

  const rtpCycleIds = ((rtpCyclesData ?? []) as RtpCycleRow[]).map((cycle) => cycle.id);
  const [projectRtpLinksResult, packetReportsResult] = await Promise.all([
    rtpCycleIds.length
      ? supabase
          .from("project_rtp_cycle_links")
          .select("id, project_id, rtp_cycle_id, portfolio_role")
          .in("rtp_cycle_id", rtpCycleIds)
      : Promise.resolve({ data: [], error: null }),
    rtpCycleIds.length
      ? supabase
          .from("reports")
          .select("id, rtp_cycle_id, title, report_type, status, generated_at, latest_artifact_kind, updated_at")
          .in("rtp_cycle_id", rtpCycleIds)
          .eq("report_type", "board_packet")
          .order("updated_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);

  const projectRtpLinks = looksLikePendingSchema(projectRtpLinksResult.error?.message)
    ? []
    : ((projectRtpLinksResult.data ?? []) as ProjectRtpLinkRow[]);
  const linksByCycleId = new Map<string, ProjectRtpLinkRow[]>();
  for (const link of projectRtpLinks) {
    const current = linksByCycleId.get(link.rtp_cycle_id) ?? [];
    current.push(link);
    linksByCycleId.set(link.rtp_cycle_id, current);
  }

  const packetReports = looksLikePendingSchema(packetReportsResult.error?.message)
    ? []
    : ((packetReportsResult.data ?? []) as RtpPacketReportRow[]);
  const latestPacketReportByCycleId = new Map<string, RtpPacketReportRow>();
  for (const report of packetReports) {
    if (!latestPacketReportByCycleId.has(report.rtp_cycle_id)) {
      latestPacketReportByCycleId.set(report.rtp_cycle_id, report);
    }
  }

  const latestPacketReportIds = [...latestPacketReportByCycleId.values()].map((report) => report.id);
  const packetSectionsResult = latestPacketReportIds.length
    ? await supabase
        .from("report_sections")
        .select("id, report_id, section_key, enabled, sort_order")
        .in("report_id", latestPacketReportIds)
    : { data: [], error: null };

  const packetSections = looksLikePendingSchema(packetSectionsResult.error?.message)
    ? []
    : ((packetSectionsResult.data ?? []) as ReportSectionRow[]);
  const packetSectionsByReportId = new Map<string, ReportSectionRow[]>();
  for (const section of packetSections) {
    const current = packetSectionsByReportId.get(section.report_id) ?? [];
    current.push(section);
    packetSectionsByReportId.set(section.report_id, current);
  }

  const allCycles = ((rtpCyclesData ?? []) as RtpCycleRow[])
    .map((cycle) => {
      const cycleLinks = linksByCycleId.get(cycle.id) ?? [];
      const packetReport = latestPacketReportByCycleId.get(cycle.id) ?? null;
      const packetSectionsForReport = packetReport ? packetSectionsByReportId.get(packetReport.id) ?? [] : [];
      const readiness = buildRtpCycleReadiness({
        geographyLabel: cycle.geography_label,
        horizonStartYear: cycle.horizon_start_year,
        horizonEndYear: cycle.horizon_end_year,
        adoptionTargetDate: cycle.adoption_target_date,
        publicReviewOpenAt: cycle.public_review_open_at,
        publicReviewCloseAt: cycle.public_review_close_at,
      });
      const packetFreshness = packetReport
        ? getReportPacketFreshness({
            latestArtifactKind: packetReport.latest_artifact_kind,
            generatedAt: packetReport.generated_at,
            updatedAt: cycle.updated_at,
          })
        : {
            label: "No packet",
            tone: "warning" as const,
            detail: "No RTP board packet record exists for this cycle yet.",
          };
      const packetPresetAlignment = packetReport
        ? getRtpPacketPresetAlignment({
            cycleStatus: cycle.status,
            sections: packetSectionsForReport.map((section) => ({
              sectionKey: section.section_key,
              enabled: section.enabled,
              sortOrder: section.sort_order,
            })),
          })
        : null;
      const packetPresetPosture = !packetReport
        ? {
            label: "No packet record",
            tone: "warning" as const,
            detail:
              "Create a linked RTP board packet record so phase-specific packet posture stays visible from the registry.",
          }
        : packetFreshness.label === "Refresh recommended" && packetPresetAlignment && !packetPresetAlignment.aligned
          ? {
              label: "Needs reset",
              tone: "warning" as const,
              detail: `The latest packet is stale and its structure has diverged from the ${packetPresetAlignment.presetLabel.toLowerCase()} for this cycle phase.`,
            }
          : packetPresetAlignment
            ? {
                label: packetPresetAlignment.statusLabel,
                tone: packetPresetAlignment.tone,
                detail: packetPresetAlignment.detail,
              }
            : {
                label: "Preset unknown",
                tone: "neutral" as const,
                detail: "Packet structure could not be compared against the recommended phase preset.",
              };
      const packetNavigationHref = packetReport
        ? getReportNavigationHref(packetReport.id, packetFreshness.label)
        : `/rtp/${cycle.id}`;
      const packetAttention = !packetReport
        ? ("missing" as const)
        : packetPresetPosture.label === "Needs reset"
          ? ("reset" as const)
          : packetFreshness.label === "Refresh recommended" || packetFreshness.label === "No packet"
            ? ("refresh" as const)
            : ("current" as const);

      return {
        ...cycle,
        linkedProjectCount: cycleLinks.length,
        constrainedProjectCount: cycleLinks.filter((link) => link.portfolio_role === "constrained").length,
        illustrativeProjectCount: cycleLinks.filter((link) => link.portfolio_role === "illustrative").length,
        packetReport,
        packetFreshness,
        packetPresetPosture,
        packetAttention,
        packetOperatorStatus: buildPacketOperatorStatus({
          packetReport,
          packetFreshness,
          packetPresetPosture,
        }),
        packetNavigationHref,
        readiness,
        workflow: buildRtpCycleWorkflowSummary({ status: cycle.status, readiness }),
      };
    })
    .filter((cycle) => (filters.status ? cycle.status === filters.status : true));

  const packetAttentionCounts = {
    reset: allCycles.filter((cycle) => cycle.packetAttention === "reset").length,
    refresh: allCycles.filter((cycle) => cycle.packetAttention === "refresh").length,
    missing: allCycles.filter((cycle) => cycle.packetAttention === "missing").length,
    current: allCycles.filter((cycle) => cycle.packetAttention === "current").length,
  };

  const typedCycles = [...allCycles]
    .filter((cycle) => matchesPacketAttentionFilter(selectedPacketFilter, cycle.packetAttention))
    .sort((left, right) => {
      const priorityDelta = getPacketAttentionPriority(left.packetAttention) - getPacketAttentionPriority(right.packetAttention);
      if (priorityDelta !== 0) {
        return priorityDelta;
      }
      return new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime();
    });

  const draftCount = typedCycles.filter((cycle) => cycle.status === "draft").length;
  const publicReviewCount = typedCycles.filter((cycle) => cycle.status === "public_review").length;
  const adoptedCount = typedCycles.filter((cycle) => cycle.status === "adopted").length;
  const readyFoundationCount = typedCycles.filter((cycle) => cycle.readiness.ready).length;
  const linkedProjectCount = typedCycles.reduce((sum, cycle) => sum + cycle.linkedProjectCount, 0);

  return (
    <section className="module-page">
      <header className="module-header-grid">
        <article className="module-intro-card">
          <div className="module-intro-kicker">
            <RouteIcon className="h-3.5 w-3.5" />
            RTP cycle foundation live
          </div>
          <div className="module-intro-body">
            <h1 className="module-intro-title">RTP Cycles</h1>
            <p className="module-intro-description">
              Register each RTP update as one parent control object so portfolio, chapter, engagement, and funding work can hang off a shared spine.
            </p>
          </div>

          <div className="module-summary-grid cols-5">
            <div className="module-summary-card">
              <p className="module-summary-label">Cycles</p>
              <p className="module-summary-value">{typedCycles.length}</p>
              <p className="module-summary-detail">RTP update cycles tracked in the current workspace.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Draft / review</p>
              <p className="module-summary-value">{draftCount + publicReviewCount}</p>
              <p className="module-summary-detail">{publicReviewCount} currently marked in public review posture.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Adopted</p>
              <p className="module-summary-value">{adoptedCount}</p>
              <p className="module-summary-detail">Cycles already marked as adopted.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Foundation ready</p>
              <p className="module-summary-value">{readyFoundationCount}</p>
              <p className="module-summary-detail">Cycles with core metadata in place for portfolio build-out.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Linked projects</p>
              <p className="module-summary-value">{linkedProjectCount}</p>
              <p className="module-summary-detail">Project-to-cycle portfolio links now visible across the registry.</p>
            </div>
          </div>
        </article>

        <article className="module-operator-card">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05]">
              <ShieldCheck className="h-5 w-5 text-emerald-200" />
            </span>
            <div>
              <p className="module-operator-eyebrow">Regional planning control room</p>
              <h2 className="module-operator-title">Make the RTP update a first-class operating object</h2>
            </div>
          </div>
          <p className="module-operator-copy">
            This is the foundation for project portfolio, chapter narrative, public review, and financial traceability. Keep one cycle per update instead of scattering state across plans and engagement records.
          </p>
          <div className="module-operator-list">
            <div className="module-operator-item">One cycle can later anchor project, chapter, and funding linkage.</div>
            <div className="module-operator-item">Public review dates stay explicit instead of buried in a memo or draft PDF.</div>
            <div className="module-operator-item">The next implementation slice will attach portfolio and chapter records to this parent.</div>
          </div>
        </article>
      </header>

      <div className="module-grid-layout mt-6 gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(24rem,0.9fr)]">
        <section className="space-y-4">
          <article className="module-section-surface">
            <div className="module-section-header">
              <div className="module-section-heading">
                <p className="module-section-label">Registry</p>
                <h2 className="module-section-title">Tracked RTP cycles</h2>
                <p className="module-section-description">
                  Keep the update cadence, public-review posture, and linked packet recommendation posture visible from the same registry.
                </p>
              </div>
              <div className="space-y-3 text-right">
                <div>
                  <p className="mb-2 text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Cycle status</p>
                  <div className="flex flex-wrap justify-end gap-2">
                    {RTP_CYCLE_STATUS_OPTIONS.map((option) => {
                      const active = filters.status === option.value;
                      return (
                        <Link
                          key={option.value}
                          href={buildRtpRegistryHref({
                            status: active ? null : option.value,
                            packet: selectedPacketFilter,
                          })}
                          className={active ? "openplan-inline-label" : "openplan-inline-label openplan-inline-label-muted"}
                        >
                          {option.label}
                        </Link>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Packet attention</p>
                  <div className="flex flex-wrap justify-end gap-2">
                    {[
                      { value: "all" as const, label: "All", count: allCycles.length },
                      { value: "reset" as const, label: "Needs reset", count: packetAttentionCounts.reset },
                      { value: "refresh" as const, label: "Generate / refresh", count: packetAttentionCounts.refresh },
                      { value: "missing" as const, label: "Missing", count: packetAttentionCounts.missing },
                      { value: "current" as const, label: "Current", count: packetAttentionCounts.current },
                    ].map((option) => {
                      const active = selectedPacketFilter === option.value;
                      return (
                        <Link
                          key={option.value}
                          href={buildRtpRegistryHref({
                            status: filters.status ?? null,
                            packet: active ? "all" : option.value,
                          })}
                          className={active ? "openplan-inline-label" : "openplan-inline-label openplan-inline-label-muted"}
                        >
                          {option.label} · {option.count}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="module-metric-card">
                <p className="module-metric-label">Needs reset</p>
                <p className="module-metric-value text-sm">{packetAttentionCounts.reset}</p>
                <p className="mt-1 text-xs text-muted-foreground">Stale packet plus phase-preset divergence.</p>
              </div>
              <div className="module-metric-card">
                <p className="module-metric-label">Refresh</p>
                <p className="module-metric-value text-sm">{packetAttentionCounts.refresh}</p>
                <p className="mt-1 text-xs text-muted-foreground">Packet record exists, but it still needs a first artifact or a fresh regeneration.</p>
              </div>
              <div className="module-metric-card">
                <p className="module-metric-label">Missing packet</p>
                <p className="module-metric-value text-sm">{packetAttentionCounts.missing}</p>
                <p className="mt-1 text-xs text-muted-foreground">Cycle still lacks a linked RTP board packet record.</p>
              </div>
              <div className="module-metric-card">
                <p className="module-metric-label">Packet current</p>
                <p className="module-metric-value text-sm">{packetAttentionCounts.current}</p>
                <p className="mt-1 text-xs text-muted-foreground">Packet is current with the cycle, whether preset-aligned or intentionally customized.</p>
              </div>
            </div>

            <p className="text-sm text-muted-foreground">
              Showing {typedCycles.length} cycle{typedCycles.length === 1 ? "" : "s"}
              {filters.status ? ` in ${formatRtpCycleStatusLabel(filters.status).toLowerCase()} posture` : " across all cycle phases"}
              {selectedPacketFilter !== "all" ? ` with packet attention set to ${selectedPacketFilter.replace("_", " ")}` : ""}.
            </p>

            {typedCycles.length === 0 ? (
              <EmptyState
                title={allCycles.length > 0 ? "No cycles match the current filter" : "No RTP cycles yet"}
                description={
                  allCycles.length > 0
                    ? "Try a different status or packet-attention filter to resume triage across the RTP registry."
                    : "Create the first RTP cycle so the regional plan update has one shared parent object instead of fragmented records."
                }
              />
            ) : (
              <div className="space-y-3">
                {typedCycles.map((cycle) => (
                  <article key={cycle.id} className="module-row-card gap-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link href={`/rtp/${cycle.id}`} className="text-base font-semibold tracking-tight transition hover:text-foreground/80">
                            {cycle.title}
                          </Link>
                          <StatusBadge tone={rtpCycleStatusTone(cycle.status)}>{formatRtpCycleStatusLabel(cycle.status)}</StatusBadge>
                          <StatusBadge tone={cycle.readiness.tone}>{cycle.readiness.label}</StatusBadge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {cycle.summary?.trim() || "No cycle summary yet. Add the planning scope, board/adoption posture, and intended review frame."}
                        </p>
                      </div>
                      <div className="text-right text-xs text-muted-foreground">
                        <div>Updated {formatRtpDateTime(cycle.updated_at)}</div>
                        <div>Created {formatRtpDateTime(cycle.created_at)}</div>
                      </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
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
                      <div className="module-metric-card">
                        <p className="module-metric-label">Adoption target</p>
                        <p className="module-metric-value text-sm">{formatRtpDate(cycle.adoption_target_date)}</p>
                      </div>
                      <div className="module-metric-card">
                        <p className="module-metric-label">Public review</p>
                        <p className="module-metric-value text-sm">
                          {cycle.public_review_open_at && cycle.public_review_close_at
                            ? `${formatRtpDate(cycle.public_review_open_at)} → ${formatRtpDate(cycle.public_review_close_at)}`
                            : "Not set"}
                        </p>
                      </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="module-metric-card">
                        <p className="module-metric-label">Linked projects</p>
                        <p className="module-metric-value text-sm">{cycle.linkedProjectCount}</p>
                      </div>
                      <div className="module-metric-card">
                        <p className="module-metric-label">Constrained</p>
                        <p className="module-metric-value text-sm">{cycle.constrainedProjectCount}</p>
                      </div>
                      <div className="module-metric-card">
                        <p className="module-metric-label">Illustrative</p>
                        <p className="module-metric-value text-sm">{cycle.illustrativeProjectCount}</p>
                      </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="module-metric-card">
                        <p className="module-metric-label">Linked packet</p>
                        <p className="module-metric-value text-sm">{cycle.packetReport?.title ?? "Not created"}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {cycle.packetReport
                            ? `${formatReportStatusLabel(cycle.packetReport.status)} record updated ${formatRtpDateTime(cycle.packetReport.updated_at)}.`
                            : "Create the first RTP board packet record to keep report posture visible from the registry."}
                        </p>
                      </div>
                      <div className="module-metric-card">
                        <p className="module-metric-label">Packet freshness</p>
                        <div className="mt-1">
                          <StatusBadge tone={cycle.packetFreshness.tone}>{cycle.packetFreshness.label}</StatusBadge>
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground">{cycle.packetFreshness.detail}</p>
                      </div>
                      <div className="module-metric-card">
                        <p className="module-metric-label">Packet preset</p>
                        <div className="mt-1">
                          <StatusBadge tone={cycle.packetPresetPosture.tone}>{cycle.packetPresetPosture.label}</StatusBadge>
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground">{cycle.packetPresetPosture.detail}</p>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-border/70 bg-background px-4 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                            Operator status
                          </p>
                          <p className="mt-2 text-sm font-medium">{cycle.packetOperatorStatus.label}</p>
                          <p className="mt-1 text-sm text-muted-foreground">{cycle.packetOperatorStatus.detail}</p>
                        </div>
                        <div className="flex flex-col items-end gap-2 text-right">
                          <StatusBadge tone={cycle.packetOperatorStatus.tone}>{cycle.packetOperatorStatus.label}</StatusBadge>
                          <p className="text-xs text-muted-foreground">
                            {cycle.packetReport?.generated_at
                              ? `Last generated ${formatRtpDateTime(cycle.packetReport.generated_at)}`
                              : cycle.packetReport
                                ? "No generated artifact yet"
                                : "No packet record yet"}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
                      <div className="rounded-2xl border border-border/70 bg-muted/25 px-4 py-3">
                        <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                          Workflow posture
                        </p>
                        <p className="mt-2 text-sm font-medium">{cycle.workflow.label}</p>
                        <p className="mt-1 text-sm text-muted-foreground">{cycle.workflow.detail}</p>
                      </div>

                      <div className="rounded-2xl border border-border/70 bg-background px-4 py-3">
                        <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                          Next actions
                        </p>
                        <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
                          {cycle.workflow.actionItems.length > 0 ? (
                            cycle.workflow.actionItems.map((item) => <li key={item}>• {item}</li>)
                          ) : (
                            <li>• Keep the cycle linked to downstream portfolio and board outputs.</li>
                          )}
                        </ul>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-3">
                      <Link href={`/rtp/${cycle.id}`} className="module-inline-action w-fit">
                        Open RTP cycle shell
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                      {cycle.packetReport ? (
                        <Link href={cycle.packetNavigationHref} className="module-inline-action w-fit">
                          Open linked packet
                          <ArrowRight className="h-4 w-4" />
                        </Link>
                      ) : null}
                      <RtpRegistryPacketRowAction
                        cycleId={cycle.id}
                        reportId={cycle.packetReport?.id ?? null}
                        packetAttention={cycle.packetAttention}
                        needsFirstArtifact={cycle.packetFreshness.label === "No packet"}
                      />
                    </div>
                  </article>
                ))}
              </div>
            )}
          </article>
        </section>

        <aside className="space-y-4">
          {packetAttentionCounts.reset > 0 || packetAttentionCounts.refresh > 0 || packetAttentionCounts.missing > 0 ? (
            <RtpRegistryPacketQueueCommandBoard
              resetCycleIds={allCycles.filter((cycle) => cycle.packetAttention === "reset").map((cycle) => cycle.id)}
              missingCycleIds={allCycles.filter((cycle) => cycle.packetAttention === "missing").map((cycle) => cycle.id)}
              generateReportIds={[
                ...new Set(
                  allCycles
                    .filter((cycle) => cycle.packetAttention === "reset" || cycle.packetAttention === "refresh")
                    .map((cycle) => cycle.packetReport?.id)
                    .filter((reportId): reportId is string => Boolean(reportId))
                ),
              ]}
              resetCount={packetAttentionCounts.reset}
              missingCount={packetAttentionCounts.missing}
            />
          ) : null}

          {packetAttentionCounts.reset > 0 ? (
            <RtpRegistryPacketBulkActions
              cycleIds={allCycles.filter((cycle) => cycle.packetAttention === "reset").map((cycle) => cycle.id)}
              cycleCount={packetAttentionCounts.reset}
            />
          ) : null}

          {packetAttentionCounts.refresh > 0 ? (
            <RtpRegistryPacketBulkGenerateActions
              reportIds={allCycles
                .filter((cycle) => cycle.packetAttention === "refresh")
                .map((cycle) => cycle.packetReport?.id)
                .filter((reportId): reportId is string => Boolean(reportId))}
              reportCount={packetAttentionCounts.refresh}
            />
          ) : null}

          <RtpCycleCreator />

          <article className="module-section-surface">
            <div className="module-section-header">
              <div className="module-section-heading">
                <p className="module-section-label">Next slice</p>
                <h2 className="module-section-title">What comes next</h2>
                <p className="module-section-description">
                  The cycle now carries portfolio links and a first chapter shell. The next slice can move from structure into editable RTP content.
                </p>
              </div>
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-500/12 text-sky-700 dark:text-sky-300">
                <Compass className="h-5 w-5" />
              </span>
            </div>

            <div className="module-operator-list mt-1">
              <div className="module-operator-item">Add chapter editing so policy, action, and financial sections can move from shell to working draft.</div>
              <div className="module-operator-item">Keep constrained, illustrative, and candidate project posture visible from the same cycle.</div>
              <div className="module-operator-item">Extend engagement campaigns so whole-plan, chapter, and project comments can point back to the same cycle.</div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="module-metric-card">
                <p className="module-metric-label">Next domain</p>
                <p className="module-metric-value text-sm">Editable chapter workflow</p>
                <p className="mt-1 text-xs text-muted-foreground">Section summaries, chapter status, and chapter-specific evidence posture.</p>
              </div>
              <div className="module-metric-card">
                <p className="module-metric-label">Next output</p>
                <p className="module-metric-value text-sm">Comment-ready digital RTP</p>
                <p className="mt-1 text-xs text-muted-foreground">A narrative surface that can carry chapter-level comments and board packet exports.</p>
              </div>
            </div>

            <Link href="/projects" className="module-inline-action mt-4">
              Review linked project control room posture
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/plans" className="module-inline-action mt-3">
              Review existing plan records
              <FolderKanban className="h-4 w-4" />
            </Link>
          </article>
        </aside>
      </div>
    </section>
  );
}
