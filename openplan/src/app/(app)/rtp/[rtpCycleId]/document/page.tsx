import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, BookOpenText, FolderKanban, MessageSquare, Route as RouteIcon } from "lucide-react";
import { CartographicSurfaceWide } from "@/components/cartographic/cartographic-surface-wide";
import { EmptyState, StateBlock } from "@/components/ui/state-block";
import { StatusBadge } from "@/components/ui/status-badge";
import { ReadFailureLog } from "@/lib/ui/read-failures";
import { WorkspaceMembershipRequired } from "@/components/workspaces/workspace-membership-required";
import { engagementStatusTone, titleizeEngagementValue } from "@/lib/engagement/catalog";
import { renderChapterMarkdownToHtml } from "@/lib/markdown/render";
import {
  buildRtpCycleReadiness,
  formatRtpChapterStatusLabel,
  formatRtpCycleStatusLabel,
  formatRtpDate,
  formatRtpDateTime,
  formatRtpPortfolioRoleLabel,
  rtpChapterStatusTone,
  rtpCycleStatusTone,
  rtpPortfolioRoleTone,
  titleizeRtpValue,
} from "@/lib/rtp/catalog";
import { createClient } from "@/lib/supabase/server";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";

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
  updated_at: string;
};

type ChapterRow = {
  id: string;
  chapter_key: string;
  title: string;
  section_type: string;
  status: string;
  summary: string | null;
  guidance: string | null;
  content_markdown: string | null;
  sort_order: number;
  required: boolean;
};

type LinkedProjectRow = {
  id: string;
  portfolio_role: string;
  priority_rationale: string | null;
  projects:
    | {
        id: string;
        name: string;
        status: string | null;
        delivery_phase: string | null;
        summary: string | null;
      }
    | Array<{
        id: string;
        name: string;
        status: string | null;
        delivery_phase: string | null;
        summary: string | null;
      }>
    | null;
};

type CampaignRow = {
  id: string;
  title: string;
  status: string;
  engagement_type: string;
  summary: string | null;
  rtp_cycle_chapter_id: string | null;
};

function looksLikePendingSchema(message: string | null | undefined): boolean {
  return /relation .* does not exist|could not find the table|schema cache|column .* does not exist/i.test(message ?? "");
}

/**
 * What happened to one read on this page. `pending_schema` is a deployment that
 * has not run a migration yet — already classified, so it keeps its existing
 * fallback and stays out of the failure log. Everything else is collected: this
 * page is the compiled reading view of the plan, and a chapter list that failed
 * to load renders here as a document with no chapters in it.
 */
type SectionReadState = "ok" | "pending_schema" | "failed";

function classifyRead(
  reads: ReadFailureLog,
  label: string,
  result: { error?: { message?: string | null } | null } | null | undefined
): SectionReadState {
  if (looksLikePendingSchema(result?.error?.message)) return "pending_schema";
  return reads.check(label, result) ? "failed" : "ok";
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export default async function RtpCycleDocumentPage({ params }: RouteContext) {
  const { rtpCycleId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const { membership, workspace } = await loadCurrentWorkspaceMembership(supabase, user.id);

  if (!membership || !workspace) {
    return (
      <WorkspaceMembershipRequired
        moduleLabel="RTP"
        title="Digital RTP document needs a provisioned workspace"
        description="This document view only appears inside a real workspace. You are signed in, but no workspace membership was found for this account."
      />
    );
  }

  const cycleResult = await supabase
    .from("rtp_cycles")
    .select(
      "id, workspace_id, title, status, geography_label, horizon_start_year, horizon_end_year, adoption_target_date, public_review_open_at, public_review_close_at, summary, updated_at"
    )
    .eq("id", rtpCycleId)
    .eq("workspace_id", membership.workspace_id)
    .maybeSingle();

  // A FAILED READ IS NOT A MISSING CYCLE. The error and the empty row shared one
  // branch, so a database failure rendered the 404 page and told a planner that
  // the RTP cycle behind this document does not exist. A genuine absence still
  // 404s; a read that failed says it failed.
  if (cycleResult.error) {
    return (
      <section className="module-page">
        <div className="mx-auto w-full max-w-2xl px-2 py-10">
          <StateBlock
            tone="danger"
            title="This RTP cycle could not be read"
            description={`The query for this cycle did not complete: ${
              cycleResult.error.message ?? "no reason was returned"
            }. That is not the same as the cycle not existing — OpenPlan cannot tell you either way right now, so do not treat this page as evidence the cycle or its document is gone.`}
          />
          <div className="mt-4">
            <Link href="/rtp" className="module-inline-action w-fit">
              <ArrowLeft className="h-4 w-4" />
              Back to RTP registry
            </Link>
          </div>
        </div>
      </section>
    );
  }

  const cycle = cycleResult.data as RtpCycleRow | null;
  if (!cycle) notFound();

  // Collected rather than swallowed, so the assembled document can say which of
  // its sections failed to load instead of reading as a plan that has none.
  const reads = new ReadFailureLog();

  const [chaptersResult, linksResult, campaignsResult] = await Promise.all([
    supabase
      .from("rtp_cycle_chapters")
      .select("id, chapter_key, title, section_type, status, summary, guidance, content_markdown, sort_order, required")
      .eq("rtp_cycle_id", cycle.id)
      .order("sort_order", { ascending: true }),
    supabase
      .from("project_rtp_cycle_links")
      .select("id, portfolio_role, priority_rationale, projects(id, name, status, delivery_phase, summary)")
      .eq("rtp_cycle_id", cycle.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("engagement_campaigns")
      .select("id, title, status, engagement_type, summary, rtp_cycle_chapter_id")
      .eq("rtp_cycle_id", cycle.id)
      .order("updated_at", { ascending: false }),
  ]);

  const chaptersState = classifyRead(reads, "the chapters of this plan", chaptersResult);
  const chapters = chaptersResult.error ? [] : ((chaptersResult.data ?? []) as ChapterRow[]);
  const linksState = classifyRead(reads, "the projects linked to this plan", linksResult);
  const linkedProjects = linksResult.error
    ? []
    : ((linksResult.data ?? []) as LinkedProjectRow[]).map((link) => ({
        ...link,
        project: Array.isArray(link.projects) ? (link.projects[0] ?? null) : link.projects,
      }));
  const campaignsState = classifyRead(reads, "the engagement targets for this plan", campaignsResult);
  const campaigns = campaignsResult.error ? [] : ((campaignsResult.data ?? []) as CampaignRow[]);

  const campaignsByChapter = new Map<string, CampaignRow[]>();
  const cycleLevelCampaigns: CampaignRow[] = [];
  for (const campaign of campaigns) {
    if (campaign.rtp_cycle_chapter_id) {
      const current = campaignsByChapter.get(campaign.rtp_cycle_chapter_id) ?? [];
      current.push(campaign);
      campaignsByChapter.set(campaign.rtp_cycle_chapter_id, current);
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

  return (
    <section className="module-page">
      <CartographicSurfaceWide />

      {/*
        This page reads as the plan itself, which makes a silent gap worse here
        than anywhere else in the module: a chapter list that failed to load
        renders as a document with no chapters. The database's own message is
        shown because this is an internal surface and an operator can act on it.
      */}
      {reads.any ? (
        <StateBlock
          tone="danger"
          title="Part of this document could not be assembled"
          description={`${reads.describe()} ${reads.messages().join(" · ")}`}
        />
      ) : null}

      <header className="module-header-grid">
        <article className="module-intro-card">
          <div className="flex flex-wrap gap-3">
            <Link href={`/rtp/${cycle.id}`} className="module-inline-action w-fit">
              <ArrowLeft className="h-4 w-4" />
              Back to RTP cycle
            </Link>
            <Link href={`/api/rtp-cycles/${cycle.id}/export?format=html`} target="_blank" className="module-inline-action w-fit">
              Open HTML export
            </Link>
            <Link href={`/api/rtp-cycles/${cycle.id}/export?format=pdf`} target="_blank" className="module-inline-action w-fit">
              Open PDF export
            </Link>
          </div>

          <div className="module-intro-kicker mt-4">
            <BookOpenText className="h-3.5 w-3.5" />
            Compiled digital RTP
          </div>
          <div className="module-intro-body">
            <h1 className="module-intro-title">{cycle.title}</h1>
            <p className="module-intro-description">
              A readable assembled RTP view pulling together cycle metadata, chapter drafts, portfolio posture, and engagement targets.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <StatusBadge tone={rtpCycleStatusTone(cycle.status)}>{formatRtpCycleStatusLabel(cycle.status)}</StatusBadge>
            <StatusBadge tone={readiness.tone}>{readiness.label}</StatusBadge>
            {/* A count is an assertion; "0 chapters" from a failed read is a lie. */}
            <StatusBadge tone={chaptersState === "failed" ? "danger" : "neutral"}>
              {chaptersState === "failed" ? "Chapters unavailable" : `${chapters.length} chapters`}
            </StatusBadge>
            <StatusBadge tone={linksState === "failed" ? "danger" : "neutral"}>
              {linksState === "failed" ? "Linked projects unavailable" : `${linkedProjects.length} linked projects`}
            </StatusBadge>
            <StatusBadge tone={campaignsState === "failed" ? "danger" : "neutral"}>
              {campaignsState === "failed" ? "Engagement targets unavailable" : `${campaigns.length} engagement targets`}
            </StatusBadge>
          </div>

          <p className="text-sm text-muted-foreground">
            {cycle.summary?.trim() || "No cycle summary yet. Use the control room to add the board posture, planning scope, and why this RTP cycle matters."}
          </p>
        </article>

        <article className="module-operator-card">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] border border-white/10 bg-white/[0.05]">
              <RouteIcon className="h-5 w-5 text-emerald-200" />
            </span>
            <div>
              <p className="module-operator-eyebrow">Document assembly view</p>
              <h2 className="module-operator-title">This is the nearest thing to the actual RTP, not just its metadata</h2>
            </div>
          </div>
          <p className="module-operator-copy">
            Treat this as the compiled reading view. The control room remains the editing surface, but this page shows how the RTP is starting to read as a whole document.
          </p>
          <div className="module-operator-list">
            <div className="module-operator-item">Chapter draft content appears in reading order.</div>
            <div className="module-operator-item">Portfolio and engagement sit inside the same assembled document context.</div>
            <div className="module-operator-item">Exports and future board-packet generation can now converge on one compiled narrative surface.</div>
          </div>
        </article>
      </header>

      <div className="mt-6 grid gap-6 xl:grid-cols-[18rem_minmax(0,1fr)]">
        <aside className="space-y-4">
          <article className="module-section-surface sticky top-6">
            <div className="module-section-header">
              <div className="module-section-heading">
                <p className="module-section-label">Contents</p>
                <h2 className="module-section-title">Document map</h2>
                <p className="module-section-description">Quick navigation through the assembled RTP.</p>
              </div>
            </div>
            <nav className="space-y-2 text-sm text-muted-foreground">
              <a href="#cycle-overview" className="block hover:text-foreground">Cycle overview</a>
              <a href="#portfolio-posture" className="block hover:text-foreground">Portfolio posture</a>
              <a href="#engagement-posture" className="block hover:text-foreground">Engagement posture</a>
              {chapters.map((chapter) => (
                <a key={chapter.id} href={`#${slugify(chapter.chapter_key || chapter.title)}`} className="block hover:text-foreground">
                  {chapter.title}
                </a>
              ))}
            </nav>
          </article>
        </aside>

        <div className="space-y-6">
          <article id="cycle-overview" className="module-section-surface">
            <div className="module-section-header">
              <div className="module-section-heading">
                <p className="module-section-label">Overview</p>
                <h2 className="module-section-title">Cycle overview</h2>
                <p className="module-section-description">Core posture for the current RTP update cycle.</p>
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

            <div className="mt-4 rounded-[0.5rem] border border-border/70 bg-muted/25 px-4 py-4">
              <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Current cycle summary</p>
              <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">
                {cycle.summary?.trim() || "No cycle summary recorded yet."}
              </p>
              <p className="mt-3 text-xs text-muted-foreground">Updated {formatRtpDateTime(cycle.updated_at)}</p>
            </div>
          </article>

          <article id="portfolio-posture" className="module-section-surface">
            <div className="module-section-header">
              <div className="module-section-heading">
                <p className="module-section-label">Portfolio</p>
                <h2 className="module-section-title">Portfolio posture</h2>
                <p className="module-section-description">The projects currently tied to this RTP cycle and how they are framed.</p>
              </div>
              <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-emerald-500/12 text-emerald-700 dark:text-emerald-300">
                <FolderKanban className="h-5 w-5" />
              </span>
            </div>

            {linksState === "failed" ? (
              <StateBlock
                tone="danger"
                title="The portfolio section could not be assembled"
                description="The projects linked to this plan could not be read, so this section is blank. It is not a finding that the plan has no portfolio, and this document must not be exported or circulated in this state."
              />
            ) : linkedProjects.length === 0 ? (
              <EmptyState title="No linked projects yet" description="Attach projects in the cycle workspace to populate the portfolio section of this RTP document." />
            ) : (
              <div className="space-y-3">
                {linkedProjects.map((link) => (
                  <article key={link.id} className="module-row-card gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone={rtpPortfolioRoleTone(link.portfolio_role)}>{formatRtpPortfolioRoleLabel(link.portfolio_role)}</StatusBadge>
                      {link.project?.status ? <StatusBadge tone="neutral">{titleizeRtpValue(link.project.status)}</StatusBadge> : null}
                    </div>
                    <h3 className="text-sm font-semibold tracking-tight">{link.project?.name ?? "Linked project"}</h3>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                      {link.priority_rationale?.trim() || link.project?.summary?.trim() || "No prioritization rationale recorded yet."}
                    </p>
                  </article>
                ))}
              </div>
            )}
          </article>

          <article id="engagement-posture" className="module-section-surface">
            <div className="module-section-header">
              <div className="module-section-heading">
                <p className="module-section-label">Engagement</p>
                <h2 className="module-section-title">Engagement posture</h2>
                <p className="module-section-description">Cycle-wide and chapter-specific engagement targets attached to this RTP update.</p>
              </div>
              <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-violet-500/12 text-violet-700 dark:text-violet-300">
                <MessageSquare className="h-5 w-5" />
              </span>
            </div>

            {campaignsState === "failed" ? (
              <StateBlock
                tone="danger"
                title="The engagement section could not be assembled"
                description="The engagement targets attached to this plan could not be read, so this section is blank and no chapter below lists its campaigns. It is not a finding that no public engagement was carried out."
              />
            ) : campaigns.length === 0 ? (
              <EmptyState title="No engagement targets yet" description="Create RTP-linked engagement campaigns from the cycle workspace to make this section meaningful." />
            ) : (
              <div className="space-y-3">
                {campaigns.map((campaign) => (
                  <article key={campaign.id} className="module-row-card gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone={engagementStatusTone(campaign.status)}>{titleizeEngagementValue(campaign.status)}</StatusBadge>
                      <StatusBadge tone="neutral">{titleizeEngagementValue(campaign.engagement_type)}</StatusBadge>
                      {campaign.rtp_cycle_chapter_id ? <StatusBadge tone="info">Chapter target</StatusBadge> : <StatusBadge tone="neutral">Cycle target</StatusBadge>}
                    </div>
                    <h3 className="text-sm font-semibold tracking-tight">{campaign.title}</h3>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                      {campaign.summary?.trim() || "No engagement summary recorded yet."}
                    </p>
                  </article>
                ))}
              </div>
            )}
          </article>

          {/*
            Chapters have no empty state of their own — they simply stop
            rendering — so a failed read would silently produce a plan document
            with no chapter text at all, which is the most convincing lie this
            page can tell.
          */}
          {chaptersState === "failed" ? (
            <StateBlock
              tone="danger"
              title="The chapters of this plan could not be read"
              description="No chapter text is shown below because the chapter records could not be loaded, not because the plan has none. This document is incomplete in an unknown way — do not export it, and do not start rewriting sections that may already exist."
            />
          ) : null}

          {chapters.map((chapter, index) => {
            const chapterCampaigns = campaignsByChapter.get(chapter.id) ?? [];
            return (
              <article key={chapter.id} id={slugify(chapter.chapter_key || chapter.title)} className="module-section-surface">
                <div className="module-section-header">
                  <div className="module-section-heading">
                    <p className="module-section-label">Chapter {index + 1}</p>
                    <h2 className="module-section-title">{chapter.title}</h2>
                    <p className="module-section-description">{titleizeRtpValue(chapter.section_type)} section</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <StatusBadge tone={rtpChapterStatusTone(chapter.status)}>{formatRtpChapterStatusLabel(chapter.status)}</StatusBadge>
                    {chapter.required ? <StatusBadge tone="success">Required</StatusBadge> : null}
                    <StatusBadge tone="neutral">{chapterCampaigns.length} campaigns</StatusBadge>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="rounded-[0.5rem] border border-border/70 bg-muted/25 px-4 py-4">
                    <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Working summary</p>
                    <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">
                      {chapter.summary?.trim() || "No working summary recorded yet."}
                    </p>
                  </div>

                  <div className="rounded-[0.5rem] border border-border/70 bg-background px-4 py-4">
                    <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Draft section text</p>
                    {chapter.content_markdown?.trim() ? (
                      <div
                        className="chapter-markdown mt-3 text-sm leading-7 text-foreground/90"
                        dangerouslySetInnerHTML={{
                          __html: renderChapterMarkdownToHtml(chapter.content_markdown),
                        }}
                      />
                    ) : (
                      <div className="mt-3 text-sm leading-7 text-foreground/90">
                        No draft section content yet.
                      </div>
                    )}
                  </div>

                  <div className="rounded-[0.5rem] border border-border/70 bg-background px-4 py-4">
                    <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Editorial guidance</p>
                    <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">
                      {chapter.guidance?.trim() || "No editorial guidance recorded yet."}
                    </p>
                  </div>

                  {chapterCampaigns.length > 0 ? (
                    <div className="rounded-[0.5rem] border border-border/70 bg-background px-4 py-4">
                      <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Chapter engagement targets</p>
                      <div className="mt-3 space-y-3">
                        {chapterCampaigns.map((campaign) => (
                          <div key={campaign.id} className="rounded-xl border border-border/70 bg-muted/20 px-3 py-3">
                            <div className="flex flex-wrap gap-2">
                              <StatusBadge tone={engagementStatusTone(campaign.status)}>{titleizeEngagementValue(campaign.status)}</StatusBadge>
                              <StatusBadge tone="neutral">{titleizeEngagementValue(campaign.engagement_type)}</StatusBadge>
                            </div>
                            <p className="mt-2 text-sm font-semibold text-foreground">{campaign.title}</p>
                            <p className="mt-1 text-sm text-muted-foreground">{campaign.summary?.trim() || "No campaign summary recorded yet."}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
