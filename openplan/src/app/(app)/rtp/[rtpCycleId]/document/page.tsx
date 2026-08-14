import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, BookOpenText } from "lucide-react";
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
import { looksLikePendingSchema } from "@/lib/supabase/pending-schema";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";

/**
 * THE READING-SURFACE RULE, applied in one place instead of forty.
 *
 * A planner prints this page and carries it into a board meeting, so it is
 * typeset rather than laid out: one prose column about 36rem wide, which at
 * 17px lands each line between 62 and 78 characters — the range typographers
 * have measured people read fastest at. Before this, the same paragraphs ran
 * 126 characters per line (measured in Chrome at 1600×900, 2026-08-13), which
 * is a wall, not a page.
 *
 * The heading scale has four steps and NO heading is smaller than body text.
 * The old page set section titles in 14px against 14.7px prose, so the labels
 * above a paragraph were smaller than the paragraph and the hierarchy read
 * upside down.
 *
 * `jsdom` cannot check any of this — it applies no stylesheet and has no box
 * model. It is measured in a real browser by
 * `qa-harness/openplan-local-card-nesting-audit.js`.
 */
const READING_COLUMN = "max-w-[36rem]";
const READING_PROSE = "text-[1.0625rem] leading-[1.65]";
const SECTION_HEADING = "text-[1.5rem] font-semibold leading-snug tracking-tight";
const ITEM_HEADING = "text-[1.25rem] font-semibold leading-snug tracking-tight";
const SIDE_HEADING = "text-[1.0625rem] font-semibold leading-snug text-foreground";
/** Space above a section ÷ space below its heading ≥ 3, so a heading belongs to what follows it. */
const SECTION_SPACING = "mt-14";

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
        title="Digital RTP document needs a workspace"
        description="This document is assembled from a cycle that belongs to a workspace. You are signed in, but no workspace membership was found for this account."
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
              Back to your RTP cycles
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

      {/*
        A MASTHEAD, NOT TWO CARDS. This page is read — often printed, often
        carried into a board meeting — so it opens the way a document opens:
        title, one sentence saying what it is, then the plan. The card that used
        to sit beside the title explained the page to itself ("the compiled
        reading view", "one compiled narrative surface"); a reader who can see
        the plan does not need to be told the page exists.
      */}
      <header className={READING_COLUMN}>
        <div className="flex flex-wrap gap-3">
          <Link href={`/rtp/${cycle.id}`} className="module-inline-action w-fit">
            <ArrowLeft className="h-4 w-4" />
            Back to this plan&apos;s working page
          </Link>
          <Link href={`/api/rtp-cycles/${cycle.id}/export?format=html`} target="_blank" className="module-inline-action w-fit">
            Open as a web page
          </Link>
          <Link href={`/api/rtp-cycles/${cycle.id}/export?format=pdf`} target="_blank" className="module-inline-action w-fit">
            Open as a PDF
          </Link>
        </div>

        <p className="mt-8 flex items-center gap-2 text-[0.78rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          <BookOpenText className="h-3.5 w-3.5" />
          Regional Transportation Plan
        </p>
        <h1 className="mt-3 text-[2rem] font-semibold leading-tight tracking-tight sm:text-[2.35rem]">{cycle.title}</h1>
        <p className={`mt-4 ${READING_PROSE} text-muted-foreground`}>
          The whole plan on one page: what it covers, the projects it pays for, where the public
          was asked, and every chapter written so far. To change any of it, go back to the plan&apos;s
          working page.
        </p>

        <div className="mt-6 flex flex-wrap gap-2">
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
            {campaignsState === "failed"
              ? "Public input unavailable"
              : `${campaigns.length} ${campaigns.length === 1 ? "place people were asked" : "places people were asked"}`}
          </StatusBadge>
        </div>

        <p className={`mt-6 ${READING_PROSE} whitespace-pre-wrap`}>
          {cycle.summary?.trim() ||
            "No summary yet. On the plan's working page, write a few lines about what this update covers and why it matters — it is the first thing a board member reads."}
        </p>
        <p className="mt-3 text-sm text-muted-foreground">Last changed {formatRtpDateTime(cycle.updated_at)}</p>
      </header>

      <div className="mt-12 grid gap-10 xl:grid-cols-[15rem_minmax(0,1fr)]">
        {/*
          Contents, unboxed. A table of contents in a bordered card reads as a
          widget beside the document; the same links under a heading read as
          part of it.
        */}
        <aside className="xl:order-none">
          <nav aria-label="On this page" className="sticky top-6">
            <h2 className={SIDE_HEADING}>On this page</h2>
            <ol className="mt-3 space-y-2 text-[0.95rem] text-muted-foreground">
              <li><a href="#about-this-plan" className="block hover:text-foreground">What this plan covers</a></li>
              <li><a href="#projects" className="block hover:text-foreground">Projects in this plan</a></li>
              <li><a href="#public-input" className="block hover:text-foreground">Where the public was asked</a></li>
              {chapters.map((chapter) => (
                <li key={chapter.id}>
                  <a href={`#${slugify(chapter.chapter_key || chapter.title)}`} className="block hover:text-foreground">
                    {chapter.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        </aside>

        <div className={READING_COLUMN}>
          {/*
            Four facts, as a plain list. They were four bordered metric cards,
            which made the shortest section on the page the busiest.
          */}
          <section id="about-this-plan">
            <h2 className={SECTION_HEADING}>What this plan covers</h2>
            <dl className={`mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2 ${READING_PROSE}`}>
              <div>
                <dt className="text-sm text-muted-foreground">Area covered</dt>
                <dd>{cycle.geography_label?.trim() || "Not set yet"}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">Years covered</dt>
                <dd>
                  {typeof cycle.horizon_start_year === "number" && typeof cycle.horizon_end_year === "number"
                    ? `${cycle.horizon_start_year}–${cycle.horizon_end_year}`
                    : "Not set yet"}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">Planned adoption</dt>
                <dd>{formatRtpDate(cycle.adoption_target_date)}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">Public review</dt>
                <dd>
                  {cycle.public_review_open_at && cycle.public_review_close_at
                    ? `${formatRtpDate(cycle.public_review_open_at)} → ${formatRtpDate(cycle.public_review_close_at)}`
                    : "Not set yet"}
                </dd>
              </div>
            </dl>
          </section>

          <section id="projects" className={SECTION_SPACING}>
            <h2 className={SECTION_HEADING}>Projects in this plan</h2>
            <p className={`mt-3 ${READING_PROSE} text-muted-foreground`}>
              The projects this plan pays for, and the reason each one is on the list.
            </p>

            {linksState === "failed" ? (
              <div className="mt-5">
                <StateBlock
                  tone="danger"
                  title="The list of projects could not be read"
                  description="The projects linked to this plan could not be read, so this section is blank. It is not a finding that the plan has no projects, and this document must not be exported or circulated in this state."
                />
              </div>
            ) : linkedProjects.length === 0 ? (
              <div className="mt-5">
                <EmptyState
                  title="No projects on this plan yet"
                  description="Add projects to this plan from its working page, and each one will appear here with the reason it made the list."
                />
              </div>
            ) : (
              <ol className="mt-6 border-t border-border/60">
                {linkedProjects.map((link) => (
                  <li key={link.id} className="border-b border-border/60 pb-5 pt-6">
                    <h3 className={ITEM_HEADING}>{link.project?.name ?? "Linked project"}</h3>
                    <p className="mt-2 flex flex-wrap items-center gap-2">
                      <StatusBadge tone={rtpPortfolioRoleTone(link.portfolio_role)}>{formatRtpPortfolioRoleLabel(link.portfolio_role)}</StatusBadge>
                      {link.project?.status ? <StatusBadge tone="neutral">{titleizeRtpValue(link.project.status)}</StatusBadge> : null}
                    </p>
                    <p className={`mt-3 ${READING_PROSE} whitespace-pre-wrap text-muted-foreground`}>
                      {link.priority_rationale?.trim() ||
                        link.project?.summary?.trim() ||
                        "Nobody has written down yet why this project is on the list."}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section id="public-input" className={SECTION_SPACING}>
            <h2 className={SECTION_HEADING}>Where the public was asked</h2>
            <p className={`mt-3 ${READING_PROSE} text-muted-foreground`}>
              The places people could comment on this plan — some about the plan as a whole, some
              about a single chapter.
            </p>

            {campaignsState === "failed" ? (
              <div className="mt-5">
                <StateBlock
                  tone="danger"
                  title="The public engagement on this plan could not be read"
                  description="It could not be read, so this section is blank and no chapter below lists where people were asked. It is not a finding that no public engagement was carried out."
                />
              </div>
            ) : campaigns.length === 0 ? (
              <div className="mt-5">
                <EmptyState
                  title="Nobody has been asked yet"
                  description="Ask the public from this plan's working page, and what they say will show up here alongside the question they were asked."
                />
              </div>
            ) : (
              <ol className="mt-6 border-t border-border/60">
                {campaigns.map((campaign) => (
                  <li key={campaign.id} className="border-b border-border/60 pb-5 pt-6">
                    <h3 className={ITEM_HEADING}>{campaign.title}</h3>
                    <p className="mt-2 flex flex-wrap items-center gap-2">
                      <StatusBadge tone={engagementStatusTone(campaign.status)}>{titleizeEngagementValue(campaign.status)}</StatusBadge>
                      <StatusBadge tone="neutral">{titleizeEngagementValue(campaign.engagement_type)}</StatusBadge>
                      {campaign.rtp_cycle_chapter_id ? (
                        <StatusBadge tone="info">About one chapter</StatusBadge>
                      ) : (
                        <StatusBadge tone="neutral">About the whole plan</StatusBadge>
                      )}
                    </p>
                    <p className={`mt-3 ${READING_PROSE} whitespace-pre-wrap text-muted-foreground`}>
                      {campaign.summary?.trim() || "Nobody has written down yet what people were asked about."}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </section>

          {/*
            Chapters have no empty state of their own — they simply stop
            rendering — so a failed read would silently produce a plan document
            with no chapter text at all, which is the most convincing lie this
            page can tell.
          */}
          {chaptersState === "failed" ? (
            <div className={SECTION_SPACING}>
              <StateBlock
                tone="danger"
                title="The chapters of this plan could not be read"
                description="No chapter text is shown below because the chapters could not be loaded, not because the plan has none. This document is incomplete in an unknown way — do not export it, and do not start rewriting sections that may already exist."
              />
            </div>
          ) : null}

          {chapters.map((chapter, index) => {
            const chapterCampaigns = campaignsByChapter.get(chapter.id) ?? [];
            return (
              <article
                key={chapter.id}
                id={slugify(chapter.chapter_key || chapter.title)}
                className={SECTION_SPACING}
              >
                <p className="text-[0.78rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Chapter {index + 1} · {titleizeRtpValue(chapter.section_type)}
                </p>
                <h2 className={`mt-3 ${SECTION_HEADING}`}>{chapter.title}</h2>
                <p className="mt-3 flex flex-wrap items-center gap-2">
                  <StatusBadge tone={rtpChapterStatusTone(chapter.status)}>{formatRtpChapterStatusLabel(chapter.status)}</StatusBadge>
                  {chapter.required ? <StatusBadge tone="success">Required</StatusBadge> : null}
                  {chapterCampaigns.length > 0 ? (
                    <StatusBadge tone="neutral">
                      {chapterCampaigns.length === 1
                        ? "1 place people were asked"
                        : `${chapterCampaigns.length} places people were asked`}
                    </StatusBadge>
                  ) : null}
                </p>

                {/*
                  The draft text is the chapter. It used to sit in the second of
                  three bordered panels, the same size and weight as the note
                  about it — so the writing looked like an attachment to its own
                  metadata. It now reads first and widest; the staff note and the
                  writing guidance follow it as asides.
                */}
                {chapter.content_markdown?.trim() ? (
                  <div
                    className={`chapter-markdown mt-6 ${READING_PROSE} text-foreground/90`}
                    dangerouslySetInnerHTML={{
                      __html: renderChapterMarkdownToHtml(chapter.content_markdown),
                    }}
                  />
                ) : (
                  <p className={`mt-6 ${READING_PROSE} text-muted-foreground`}>
                    Nothing has been written for this chapter yet.
                  </p>
                )}

                <div className="mt-6 border-l-2 border-border/70 pl-4">
                  <h3 className={SIDE_HEADING}>Where this chapter stands</h3>
                  <p className={`mt-2 ${READING_PROSE} whitespace-pre-wrap text-muted-foreground`}>
                    {chapter.summary?.trim() || "Nobody has written a note about where this chapter stands."}
                  </p>

                  <h3 className={`mt-6 ${SIDE_HEADING}`}>Notes for whoever writes this chapter</h3>
                  <p className={`mt-2 ${READING_PROSE} whitespace-pre-wrap text-muted-foreground`}>
                    {chapter.guidance?.trim() || "No writing notes for this chapter."}
                  </p>

                  {chapterCampaigns.length > 0 ? (
                    <>
                      <h3 className={`mt-6 ${SIDE_HEADING}`}>Where the public was asked about this chapter</h3>
                      <ul className={`mt-2 space-y-3 ${READING_PROSE} text-muted-foreground`}>
                        {chapterCampaigns.map((campaign) => (
                          <li key={campaign.id}>
                            <span className="font-semibold text-foreground">{campaign.title}</span>
                            {" — "}
                            {titleizeEngagementValue(campaign.engagement_type)},{" "}
                            {titleizeEngagementValue(campaign.status).toLowerCase()}.{" "}
                            {campaign.summary?.trim() || "Nobody has written down what people were asked about."}
                          </li>
                        ))}
                      </ul>
                    </>
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
