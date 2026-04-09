import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, FileStack, FolderKanban, Route as RouteIcon, ShieldCheck } from "lucide-react";
import { EmptyState } from "@/components/ui/state-block";
import { StatusBadge } from "@/components/ui/status-badge";
import { WorkspaceMembershipRequired } from "@/components/workspaces/workspace-membership-required";
import {
  buildRtpCycleReadiness,
  buildRtpCycleWorkflowSummary,
  formatRtpChapterStatusLabel,
  formatRtpCycleStatusLabel,
  formatRtpDate,
  formatRtpDateTime,
  formatRtpPortfolioRoleLabel,
  RTP_CHAPTER_TEMPLATES,
  rtpChapterStatusTone,
  rtpCycleStatusTone,
  rtpPortfolioRoleTone,
  titleizeRtpValue,
} from "@/lib/rtp/catalog";
import { createClient } from "@/lib/supabase/server";
import {
  CURRENT_WORKSPACE_MEMBERSHIP_SELECT,
  type WorkspaceMembershipRow,
  unwrapWorkspaceRecord,
} from "@/lib/workspaces/current";

type RouteContext = {
  params: Promise<{ rtpCycleId: string }>;
};

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

type RtpCycleChapterRow = {
  id: string;
  chapter_key: string;
  title: string;
  section_type: string;
  status: string;
  sort_order: number;
  required: boolean;
  guidance: string | null;
  summary: string | null;
  updated_at: string;
};

type ProjectLinkProjectRow = {
  id: string;
  name: string;
  status: string;
  delivery_phase: string;
  summary: string | null;
};

type ProjectRtpLinkRow = {
  id: string;
  project_id: string;
  portfolio_role: string;
  priority_rationale: string | null;
  created_at: string;
  projects:
    | ProjectLinkProjectRow
    | ProjectLinkProjectRow[]
    | null;
};

function looksLikePendingSchema(message: string | null | undefined): boolean {
  return /relation .* does not exist|could not find the table|schema cache/i.test(message ?? "");
}

function formatProjectStatusLabel(value: string | null | undefined): string {
  return titleizeRtpValue(value);
}

function projectStatusTone(status: string | null | undefined): "info" | "success" | "warning" | "danger" | "neutral" {
  if (status === "active") return "success";
  if (status === "on_hold") return "warning";
  if (status === "complete") return "info";
  if (status === "draft") return "neutral";
  return "neutral";
}

export default async function RtpCycleDetailPage({ params }: RouteContext) {
  const { rtpCycleId } = await params;
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
        description="RTP cycle detail only appears inside a real workspace. You are signed in, but no workspace membership was found for this account."
      />
    );
  }

  const { data: cycleData } = await supabase
    .from("rtp_cycles")
    .select(
      "id, workspace_id, title, status, geography_label, horizon_start_year, horizon_end_year, adoption_target_date, public_review_open_at, public_review_close_at, summary, created_at, updated_at"
    )
    .eq("id", rtpCycleId)
    .eq("workspace_id", membership.workspace_id)
    .maybeSingle();

  const cycle = cycleData as RtpCycleRow | null;

  if (!cycle) {
    notFound();
  }

  const [chaptersResult, projectLinksResult] = await Promise.all([
    supabase
      .from("rtp_cycle_chapters")
      .select("id, chapter_key, title, section_type, status, sort_order, required, guidance, summary, updated_at")
      .eq("rtp_cycle_id", cycle.id)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("project_rtp_cycle_links")
      .select("id, project_id, portfolio_role, priority_rationale, created_at, projects(id, name, status, delivery_phase, summary)")
      .eq("rtp_cycle_id", cycle.id)
      .order("created_at", { ascending: false }),
  ]);

  const chapters = looksLikePendingSchema(chaptersResult.error?.message)
    ? RTP_CHAPTER_TEMPLATES.map((template) => ({
        id: `template-${template.chapterKey}`,
        chapter_key: template.chapterKey,
        title: template.title,
        section_type: template.sectionType,
        status: "not_started",
        sort_order: template.sortOrder,
        required: template.required,
        guidance: template.guidance,
        summary: null,
        updated_at: cycle.updated_at,
      }))
    : ((chaptersResult.data ?? []) as RtpCycleChapterRow[]);

  const projectLinks = looksLikePendingSchema(projectLinksResult.error?.message)
    ? []
    : ((projectLinksResult.data ?? []) as ProjectRtpLinkRow[]).map((link) => ({
        ...link,
        project: Array.isArray(link.projects) ? (link.projects[0] ?? null) : link.projects,
      }));

  const readiness = buildRtpCycleReadiness({
    geographyLabel: cycle.geography_label,
    horizonStartYear: cycle.horizon_start_year,
    horizonEndYear: cycle.horizon_end_year,
    adoptionTargetDate: cycle.adoption_target_date,
    publicReviewOpenAt: cycle.public_review_open_at,
    publicReviewCloseAt: cycle.public_review_close_at,
  });
  const workflow = buildRtpCycleWorkflowSummary({ status: cycle.status, readiness });

  const chapterReadyForReviewCount = chapters.filter((chapter) => chapter.status === "ready_for_review").length;
  const chapterCompleteCount = chapters.filter((chapter) => chapter.status === "complete").length;
  const constrainedProjectCount = projectLinks.filter((link) => link.portfolio_role === "constrained").length;
  const illustrativeProjectCount = projectLinks.filter((link) => link.portfolio_role === "illustrative").length;

  return (
    <section className="module-page">
      <header className="module-header-grid">
        <article className="module-intro-card">
          <Link href="/rtp" className="module-inline-action w-fit">
            <ArrowLeft className="h-4 w-4" />
            Back to RTP registry
          </Link>

          <div className="module-intro-kicker mt-4">
            <RouteIcon className="h-3.5 w-3.5" />
            RTP cycle shell
          </div>
          <div className="module-intro-body">
            <h1 className="module-intro-title">{cycle.title}</h1>
            <p className="module-intro-description">
              One cycle now anchors portfolio posture and the first digital RTP chapter shell for this update.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <StatusBadge tone={rtpCycleStatusTone(cycle.status)}>{formatRtpCycleStatusLabel(cycle.status)}</StatusBadge>
            <StatusBadge tone={readiness.tone}>{readiness.label}</StatusBadge>
          </div>

          <p className="text-sm text-muted-foreground">
            {cycle.summary?.trim() || "No cycle summary yet. Add the planning scope, board posture, and intended public-facing narrative for this update."}
          </p>

          <div className="module-summary-grid cols-5">
            <div className="module-summary-card">
              <p className="module-summary-label">Chapters</p>
              <p className="module-summary-value">{chapters.length}</p>
              <p className="module-summary-detail">Initial RTP shell sections seeded for this cycle.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Ready for review</p>
              <p className="module-summary-value">{chapterReadyForReviewCount}</p>
              <p className="module-summary-detail">Sections that can move into coordinated review.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Complete</p>
              <p className="module-summary-value">{chapterCompleteCount}</p>
              <p className="module-summary-detail">Sections already marked complete.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Linked projects</p>
              <p className="module-summary-value">{projectLinks.length}</p>
              <p className="module-summary-detail">Portfolio records currently attached to this cycle.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Constrained / illustrative</p>
              <p className="module-summary-value">{constrainedProjectCount} / {illustrativeProjectCount}</p>
              <p className="module-summary-detail">Quick fiscal posture view for the visible portfolio.</p>
            </div>
          </div>
        </article>

        <article className="module-operator-card">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05]">
              <ShieldCheck className="h-5 w-5 text-emerald-200" />
            </span>
            <div>
              <p className="module-operator-eyebrow">Digital RTP shell</p>
              <h2 className="module-operator-title">Chapter structure is now a first-class operating surface</h2>
            </div>
          </div>
          <p className="module-operator-copy">{workflow.detail}</p>
          <div className="module-operator-list">
            {workflow.actionItems.map((item) => (
              <div key={item} className="module-operator-item">{item}</div>
            ))}
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
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
        </article>
      </header>

      <div className="module-grid-layout mt-6 gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(24rem,0.9fr)]">
        <section className="space-y-4">
          <article className="module-section-surface">
            <div className="module-section-header">
              <div className="module-section-heading">
                <p className="module-section-label">Chapter shell</p>
                <h2 className="module-section-title">Seeded RTP sections</h2>
                <p className="module-section-description">
                  This first shell mirrors the required RTP narrative lanes so comments, evidence, and exports can attach to explicit chapters later.
                </p>
              </div>
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-500/12 text-sky-700 dark:text-sky-300">
                <FileStack className="h-5 w-5" />
              </span>
            </div>

            {chapters.length === 0 ? (
              <EmptyState
                title="No chapter shell yet"
                description="This cycle does not have seeded chapter scaffolding yet. Apply the latest migration and reopen the cycle."
              />
            ) : (
              <div className="space-y-3">
                {chapters.map((chapter) => (
                  <article key={chapter.id} className="module-row-card gap-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-base font-semibold tracking-tight">{chapter.title}</h3>
                          <StatusBadge tone={rtpChapterStatusTone(chapter.status)}>
                            {formatRtpChapterStatusLabel(chapter.status)}
                          </StatusBadge>
                          <StatusBadge tone="neutral">{titleizeRtpValue(chapter.section_type)}</StatusBadge>
                          {chapter.required ? <StatusBadge tone="success">Required</StatusBadge> : null}
                        </div>
                        <p className="text-sm text-muted-foreground">{chapter.guidance?.trim() || "No guidance yet."}</p>
                      </div>
                      <div className="text-right text-xs text-muted-foreground">
                        <div>Updated {formatRtpDateTime(chapter.updated_at)}</div>
                        <div>Key {chapter.chapter_key}</div>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-border/70 bg-muted/25 px-4 py-3">
                      <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Current shell posture</p>
                      <p className="mt-2 text-sm text-muted-foreground">
                        {chapter.summary?.trim() || "No chapter summary yet. This shell is ready for chapter-level narrative, evidence, and comment threading."}
                      </p>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </article>
        </section>

        <aside className="space-y-4">
          <article className="module-section-surface">
            <div className="module-section-header">
              <div className="module-section-heading">
                <p className="module-section-label">Portfolio posture</p>
                <h2 className="module-section-title">Cycle-linked projects</h2>
                <p className="module-section-description">
                  The RTP chapter shell and the project portfolio now sit under the same cycle record.
                </p>
              </div>
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-500/12 text-emerald-700 dark:text-emerald-300">
                <FolderKanban className="h-5 w-5" />
              </span>
            </div>

            {projectLinks.length === 0 ? (
              <EmptyState
                title="No linked projects yet"
                description="Attach projects to this cycle from the project detail view so constrained and illustrative portfolio posture becomes visible here."
              />
            ) : (
              <div className="space-y-3">
                {projectLinks.map((link) => {
                  const project = link.project;
                  return (
                    <article key={link.id} className="module-row-card gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge tone={rtpPortfolioRoleTone(link.portfolio_role)}>
                          {formatRtpPortfolioRoleLabel(link.portfolio_role)}
                        </StatusBadge>
                        {project?.status ? (
                          <StatusBadge tone={projectStatusTone(project.status)}>{formatProjectStatusLabel(project.status)}</StatusBadge>
                        ) : null}
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold tracking-tight">{project?.name ?? "Linked project"}</h3>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {link.priority_rationale?.trim() || project?.summary?.trim() || "No prioritization rationale recorded yet."}
                        </p>
                      </div>
                      {project?.id ? (
                        <Link href={`/projects/${project.id}`} className="module-inline-action w-fit">
                          Open project workspace
                        </Link>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            )}
          </article>

          <article className="module-section-surface">
            <div className="module-section-header">
              <div className="module-section-heading">
                <p className="module-section-label">Next layer</p>
                <h2 className="module-section-title">Where this goes next</h2>
                <p className="module-section-description">
                  This is enough structure to start digital RTP assembly without pretending the full editorial workflow is done.
                </p>
              </div>
            </div>

            <div className="module-operator-list mt-1">
              <div className="module-operator-item">Add chapter editing and status updates so each section can move from shell to real content.</div>
              <div className="module-operator-item">Attach engagement campaigns to whole-cycle, chapter, and project comment targets.</div>
              <div className="module-operator-item">Connect the financial element to constrained and illustrative funding posture.</div>
            </div>

            <Link href="/projects" className="module-inline-action mt-4">
              Continue portfolio work
            </Link>
          </article>
        </aside>
      </div>
    </section>
  );
}
