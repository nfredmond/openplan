import { redirect } from "next/navigation";
import { ArrowRight, Compass, FolderKanban, Route as RouteIcon, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/ui/state-block";
import { WorkspaceMembershipRequired } from "@/components/workspaces/workspace-membership-required";
import { RtpCycleCreator } from "@/components/rtp/rtp-cycle-creator";
import { StatusBadge } from "@/components/ui/status-badge";
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

export default async function RtpPage({ searchParams }: { searchParams: RtpPageSearchParams }) {
  const filters = await searchParams;
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

  const typedCycles = ((rtpCyclesData ?? []) as RtpCycleRow[])
    .map((cycle) => {
      const readiness = buildRtpCycleReadiness({
        geographyLabel: cycle.geography_label,
        horizonStartYear: cycle.horizon_start_year,
        horizonEndYear: cycle.horizon_end_year,
        adoptionTargetDate: cycle.adoption_target_date,
        publicReviewOpenAt: cycle.public_review_open_at,
        publicReviewCloseAt: cycle.public_review_close_at,
      });

      return {
        ...cycle,
        readiness,
        workflow: buildRtpCycleWorkflowSummary({ status: cycle.status, readiness }),
      };
    })
    .filter((cycle) => (filters.status ? cycle.status === filters.status : true));

  const draftCount = typedCycles.filter((cycle) => cycle.status === "draft").length;
  const publicReviewCount = typedCycles.filter((cycle) => cycle.status === "public_review").length;
  const adoptedCount = typedCycles.filter((cycle) => cycle.status === "adopted").length;
  const readyFoundationCount = typedCycles.filter((cycle) => cycle.readiness.ready).length;

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

          <div className="module-summary-grid cols-4">
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
                  Keep the update cadence and public-review posture visible before adding deeper portfolio and chapter structure.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {RTP_CYCLE_STATUS_OPTIONS.map((option) => {
                  const active = filters.status === option.value;
                  return (
                    <Link
                      key={option.value}
                      href={active ? "/rtp" : `/rtp?status=${option.value}`}
                      className={active ? "openplan-inline-label" : "openplan-inline-label openplan-inline-label-muted"}
                    >
                      {option.label}
                    </Link>
                  );
                })}
              </div>
            </div>

            {typedCycles.length === 0 ? (
              <EmptyState
                title="No RTP cycles yet"
                description="Create the first RTP cycle so the regional plan update has one shared parent object instead of fragmented records."
              />
            ) : (
              <div className="space-y-3">
                {typedCycles.map((cycle) => (
                  <article key={cycle.id} className="module-row-card gap-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-base font-semibold tracking-tight">{cycle.title}</h3>
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
                  </article>
                ))}
              </div>
            )}
          </article>
        </section>

        <aside className="space-y-4">
          <RtpCycleCreator />

          <article className="module-section-surface">
            <div className="module-section-header">
              <div className="module-section-heading">
                <p className="module-section-label">Next slice</p>
                <h2 className="module-section-title">What comes next</h2>
                <p className="module-section-description">
                  With the cycle object in place, the next implementation slice can safely attach portfolio and chapter state.
                </p>
              </div>
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-500/12 text-sky-700 dark:text-sky-300">
                <Compass className="h-5 w-5" />
              </span>
            </div>

            <div className="module-operator-list mt-1">
              <div className="module-operator-item">Add project-to-cycle linkage for constrained vs illustrative portfolio tracking.</div>
              <div className="module-operator-item">Add chapter scaffolding so policy, action, and financial sections live under one RTP cycle.</div>
              <div className="module-operator-item">Extend engagement campaigns so whole-plan, chapter, and project comments can point back to the same cycle.</div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="module-metric-card">
                <p className="module-metric-label">Next domain</p>
                <p className="module-metric-value text-sm">Project portfolio linkage</p>
                <p className="mt-1 text-xs text-muted-foreground">Constrained / illustrative status, sponsor, rationale, and funding posture.</p>
              </div>
              <div className="module-metric-card">
                <p className="module-metric-label">Next output</p>
                <p className="module-metric-value text-sm">Digital RTP shell</p>
                <p className="mt-1 text-xs text-muted-foreground">A narrative surface that can later carry chapter-level comments and board packet exports.</p>
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
