import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, FileStack, FolderKanban, MessageSquare, Route as RouteIcon, ShieldCheck } from "lucide-react";
import { RtpChapterControls } from "@/components/rtp/rtp-chapter-controls";
import { RtpEngagementCampaignCreator } from "@/components/rtp/rtp-engagement-campaign-creator";
import { RtpReportCreator } from "@/components/rtp/rtp-report-creator";
import { EmptyState } from "@/components/ui/state-block";
import { StatusBadge } from "@/components/ui/status-badge";
import { WorkspaceMembershipRequired } from "@/components/workspaces/workspace-membership-required";
import { engagementStatusTone, titleizeEngagementValue } from "@/lib/engagement/catalog";
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
  content_markdown: string | null;
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
  projects: ProjectLinkProjectRow | ProjectLinkProjectRow[] | null;
};

type CampaignProjectRow = {
  id: string;
  name: string;
};

type EngagementCampaignRow = {
  id: string;
  title: string;
  summary: string | null;
  status: string;
  engagement_type: string;
  rtp_cycle_chapter_id: string | null;
  updated_at: string;
  projects: CampaignProjectRow | CampaignProjectRow[] | null;
};

function looksLikePendingSchema(message: string | null | undefined): boolean {
  return /relation .* does not exist|could not find the table|schema cache|column .* does not exist/i.test(message ?? "");
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

  const [chaptersResult, projectLinksResult, campaignsResult] = await Promise.all([
    supabase
      .from("rtp_cycle_chapters")
      .select("id, chapter_key, title, section_type, status, sort_order, required, guidance, summary, content_markdown, updated_at")
      .eq("rtp_cycle_id", cycle.id)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("project_rtp_cycle_links")
      .select("id, project_id, portfolio_role, priority_rationale, created_at, projects(id, name, status, delivery_phase, summary)")
      .eq("rtp_cycle_id", cycle.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("engagement_campaigns")
      .select("id, title, summary, status, engagement_type, rtp_cycle_chapter_id, updated_at, projects(id, name)")
      .eq("rtp_cycle_id", cycle.id)
      .order("updated_at", { ascending: false }),
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
        content_markdown: null,
        updated_at: cycle.updated_at,
      }))
    : ((chaptersResult.data ?? []) as RtpCycleChapterRow[]);

  const projectLinks = looksLikePendingSchema(projectLinksResult.error?.message)
    ? []
    : ((projectLinksResult.data ?? []) as ProjectRtpLinkRow[]).map((link) => ({
        ...link,
        project: Array.isArray(link.projects) ? (link.projects[0] ?? null) : link.projects,
      }));

  const engagementCampaigns = looksLikePendingSchema(campaignsResult.error?.message)
    ? []
    : ((campaignsResult.data ?? []) as EngagementCampaignRow[]).map((campaign) => ({
        ...campaign,
        project: Array.isArray(campaign.projects) ? (campaign.projects[0] ?? null) : campaign.projects,
      }));

  const campaignsByChapterId = new Map<string, Array<(typeof engagementCampaigns)[number]>>();
  const cycleLevelCampaigns: Array<(typeof engagementCampaigns)[number]> = [];
  for (const campaign of engagementCampaigns) {
    if (campaign.rtp_cycle_chapter_id) {
      const current = campaignsByChapterId.get(campaign.rtp_cycle_chapter_id) ?? [];
      current.push(campaign);
      campaignsByChapterId.set(campaign.rtp_cycle_chapter_id, current);
    } else {
      cycleLevelCampaigns.push(campaign);
    }
  }

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
              One cycle now anchors portfolio posture, editable chapter workflow, and RTP-targeted engagement entry points.
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
              <p className="module-summary-label">Engagement targets</p>
              <p className="module-summary-value">{engagementCampaigns.length}</p>
              <p className="module-summary-detail">Cycle-level or chapter-level campaigns tied to this RTP update.</p>
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
                <h2 className="module-section-title">Editable RTP sections</h2>
                <p className="module-section-description">
                  The shell is no longer just seeded structure. Each chapter can now carry explicit workflow status, working summary, and guidance.
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
              <div className="space-y-4">
                {chapters.map((chapter) => {
                  const chapterCampaigns = campaignsByChapterId.get(chapter.id) ?? [];
                  return (
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
                            <StatusBadge tone="neutral">{chapterCampaigns.length} campaign{chapterCampaigns.length === 1 ? "" : "s"}</StatusBadge>
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

                      <div className="rounded-2xl border border-border/70 bg-background px-4 py-3">
                        <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Draft content</p>
                        <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                          {chapter.content_markdown?.trim() || "No draft chapter content yet. Start writing the actual RTP section text here."}
                        </p>
                      </div>

                      {chapterCampaigns.length > 0 ? (
                        <div className="space-y-2 rounded-2xl border border-border/70 bg-background px-4 py-3">
                          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Chapter engagement targets</p>
                          {chapterCampaigns.map((campaign) => (
                            <div key={campaign.id} className="rounded-xl border border-border/70 bg-muted/20 px-3 py-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <Link href={`/engagement/${campaign.id}`} className="text-sm font-semibold tracking-tight hover:text-foreground/80">
                                  {campaign.title}
                                </Link>
                                <StatusBadge tone={engagementStatusTone(campaign.status)}>{titleizeEngagementValue(campaign.status)}</StatusBadge>
                                <StatusBadge tone="neutral">{titleizeEngagementValue(campaign.engagement_type)}</StatusBadge>
                              </div>
                              <p className="mt-1 text-sm text-muted-foreground">
                                {campaign.summary?.trim() || "No campaign summary yet."}
                              </p>
                            </div>
                          ))}
                        </div>
                      ) : null}

                      {String(chapter.id).startsWith("template-") ? null : (
                        <RtpChapterControls
                          rtpCycleId={cycle.id}
                          chapter={{
                            id: chapter.id,
                            title: chapter.title,
                            status: chapter.status,
                          guidance: chapter.guidance,
                          summary: chapter.summary,
                          contentMarkdown: chapter.content_markdown,
                        }}
                      />
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </article>
        </section>

        <aside className="space-y-4">
          <article className="module-section-surface">
            <div className="module-section-header">
              <div className="module-section-heading">
                <p className="module-section-label">Export</p>
                <h2 className="module-section-title">RTP cycle output snapshot</h2>
                <p className="module-section-description">
                  Export the current cycle, chapter, portfolio, and engagement posture without waiting for deeper report-model integration.
                </p>
              </div>
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-500/12 text-amber-700 dark:text-amber-300">
                <FileStack className="h-5 w-5" />
              </span>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <RtpReportCreator rtpCycleId={cycle.id} defaultTitle={`${cycle.title} Board / Binder`} cycleStatus={cycle.status} />
              <Link href={`/rtp/${cycle.id}/document`} className="module-inline-action">
                Open digital RTP document
              </Link>
              <Link href={`/api/rtp-cycles/${cycle.id}/export?format=html`} target="_blank" className="module-inline-action">
                Open HTML export
              </Link>
              <Link href={`/api/rtp-cycles/${cycle.id}/export?format=pdf`} target="_blank" className="module-inline-action">
                Open PDF export
              </Link>
            </div>
          </article>

          <RtpEngagementCampaignCreator
            rtpCycleId={cycle.id}
            chapterOptions={chapters
              .filter((chapter) => !String(chapter.id).startsWith("template-"))
              .map((chapter) => ({ id: chapter.id, title: chapter.title }))}
          />

          <article className="module-section-surface">
            <div className="module-section-header">
              <div className="module-section-heading">
                <p className="module-section-label">Portfolio posture</p>
                <h2 className="module-section-title">Cycle-linked projects</h2>
                <p className="module-section-description">
                  The RTP chapter workflow and the project portfolio now sit under the same cycle record.
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
                <p className="module-section-label">Cycle-wide engagement</p>
                <h2 className="module-section-title">Whole-plan campaign targets</h2>
                <p className="module-section-description">
                  Use whole-cycle campaigns for planwide public review, then point deeper campaigns at specific chapters as needed.
                </p>
              </div>
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-500/12 text-violet-700 dark:text-violet-300">
                <MessageSquare className="h-5 w-5" />
              </span>
            </div>

            {cycleLevelCampaigns.length === 0 ? (
              <EmptyState
                title="No whole-cycle campaigns yet"
                description="Create one above if you want a planwide comment or review target for this RTP update."
              />
            ) : (
              <div className="space-y-3">
                {cycleLevelCampaigns.map((campaign) => (
                  <article key={campaign.id} className="module-row-card gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone={engagementStatusTone(campaign.status)}>{titleizeEngagementValue(campaign.status)}</StatusBadge>
                      <StatusBadge tone="neutral">{titleizeEngagementValue(campaign.engagement_type)}</StatusBadge>
                    </div>
                    <div>
                      <Link href={`/engagement/${campaign.id}`} className="text-sm font-semibold tracking-tight hover:text-foreground/80">
                        {campaign.title}
                      </Link>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {campaign.summary?.trim() || "No campaign summary yet."}
                      </p>
                    </div>
                    {campaign.project ? (
                      <p className="text-xs text-muted-foreground">Linked project: {campaign.project.name}</p>
                    ) : null}
                  </article>
                ))}
              </div>
            )}
          </article>
        </aside>
      </div>
    </section>
  );
}
