/**
 * THE DRAFT PLAN ITSELF, READ BY A MEMBER OF THE PUBLIC.
 *
 * Its sibling `/plan/[shareToken]` answers "what are you funding and why".
 * This page answers the question a public-review notice actually asks a
 * resident to answer: *here is the document — tell us what you think of it.*
 * So it renders the chapter narrative in reading order, the financial element
 * beside it, and the project lists the narrative refers to.
 *
 * FIVE RULES THIS PAGE IS BUILT AROUND, each because the reader is a member of
 * the public and has no way to tell a broken query from an empty plan:
 *
 *  1. A READ THAT FAILED MAY NOT RENDER AS AN ABSENCE. Every read is bound,
 *     checked into `ReadFailureLog`, and disclosed. `reads.describe()` only —
 *     never `reads.messages()`, which is the database's own words and belongs
 *     in operator surfaces, not on a page a resident reads.
 *  2. A FAILED GATE READ IS NOT A MISSING PLAN. A wrong, revoked, or switched-
 *     off token is a genuine absence and still 404s. A read that FAILED tells
 *     us nothing about whether the plan exists, so it gets a shell that denies
 *     the inference rather than a 404 that asserts it.
 *  3. THE FISCAL VERDICT IS SUPPRESSED WHOLESALE IF ANY OF ITS INPUTS FAILED.
 *     `buildRtpFiscalConstraint` is honest about missing DATA but cannot know a
 *     READ failed: a failed project-link read looks exactly like a plan with no
 *     constrained projects, which computes to zero cost against real revenue
 *     and publishes "fiscally constrained" — the single figure a funder
 *     verifies — on the strength of a dropped column. So the verdict is not
 *     computed at all unless the links, the bands and the ledger all loaded.
 *  4. THE REVIEW WINDOW IS STATED, NEVER IMPLIED. A resident must not have to
 *     guess whether a comment would count. And the window NEVER blocks reading
 *     the document: a closed review is a reason to say so, not to hide the plan.
 *  5. THE SHARE TOKEN IS THE CREDENTIAL, so `robots: { index: false, follow:
 *     false }` rides on BOTH metadata branches. An indexed token-bearing URL
 *     hands anyone who searches a link the agency chose to give to specific
 *     people.
 *
 * WHY THIS DOES NOT REUSE `RtpProgrammeLists`. Its props do not fit, and the
 * misfit is not cosmetic. It requires a `funding` block per project (pipeline
 * status, committed dollars, still-to-raise) sourced from
 * `project_funding_profiles` — the agency's internal grant-seeking posture,
 * which is not the public's business and would need a read this page has no
 * reason to make — and it renders each project as a `<Link>` into
 * `/projects/{id}`, an authenticated route a resident cannot open. So the lists
 * here are a read-only summary. It deliberately does NOT re-derive subtotals:
 * per-period money comes from the fiscal engine, computed once, rather than a
 * second arithmetic over the same rows that could quietly disagree with it.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { looksLikePendingSchema } from "@/lib/supabase/pending-schema";
import { ReadFailureLog } from "@/lib/ui/read-failures";
import { renderChapterMarkdownToHtml } from "@/lib/markdown/render";
import { parseOptionalAmount } from "@/lib/money/optional-amount";
import {
  formatRtpChapterStatusLabel,
  formatRtpCycleStatusLabel,
  formatRtpPortfolioRoleLabel,
  titleizeRtpValue,
} from "@/lib/rtp/catalog";
import {
  buildRtpFiscalConstraint,
  describeRtpFiscalConstraint,
  rtpFiscalVerdictLabel,
  type RtpFiscalConstraintSummary,
} from "@/lib/rtp/fiscal-constraint";
import {
  loadRtpFinancialElement,
  type RtpFinancialElementSupabaseLike,
} from "@/lib/rtp/financial-element-queries";
import {
  indexTranscriptions,
  loadRtpTranscriptionProvenance,
  type RtpTranscriptionSupabaseLike,
} from "@/lib/rtp/extraction/provenance-queries";
import { ExtractionProvenanceCitation } from "@/components/rtp/extraction-provenance-chip";
import { formatMoney } from "@/lib/money/format";

/** The columns the gate needs, and every one of them is rendered below. */
const CYCLE_COLUMNS =
  "id, title, status, geography_label, horizon_start_year, horizon_end_year, summary, " +
  "public_review_open_at, public_review_close_at, financial_basis_year, annual_inflation_rate";

/**
 * The same projection MINUS the two columns migration 20260805000003 adds.
 *
 * BOTH SIDES OF A DEPLOY/MIGRATE WINDOW MUST DEGRADE, and this is the read
 * where the asymmetry would hurt most. Every other read on this page fails
 * softly on a deployment that has not migrated yet — the bands, the ledger and
 * the measures each disclose themselves and the fiscal summary is suppressed —
 * but the CYCLE read is the gate, so one unknown column would take the entire
 * public draft down during a review period. Falling back to the pre-migration
 * projection keeps the document, the review window and the project lists
 * readable, and the money simply reports an unstated base year, which is what
 * the fiscal engine already says when it does not know one.
 */
const CYCLE_COLUMNS_BEFORE_FINANCIAL_ELEMENT =
  "id, title, status, geography_label, horizon_start_year, horizon_end_year, summary, " +
  "public_review_open_at, public_review_close_at";

/**
 * `guidance` is deliberately NOT selected. It is the editorial instruction an
 * agency writes to its own staff ("Assemble checklist, resolutions, comment-
 * response materials") and publishing it to residents would put internal
 * process notes inside the plan they are being asked to comment on.
 */
const CHAPTER_COLUMNS =
  "id, chapter_key, title, section_type, status, summary, content_markdown, sort_order, required";

const LINK_COLUMNS =
  "id, portfolio_role, priority_rationale, horizon_band_id, estimated_cost, cost_basis_year, " +
  "projects(id, name, summary)";

/**
 * A deadline stated in an unnamed time zone is a deadline a resident can miss.
 *
 * The server's zone is an accident of deployment and is invisible to the
 * reader, and no agency time zone is recorded anywhere in the schema — so
 * inventing one would be guessing at the very moment precision matters. UTC is
 * named explicitly instead: unambiguous, convertible by anyone, and identical
 * on every machine that renders this page.
 */
const INSTANT = new Intl.DateTimeFormat("en-US", {
  // Spelled out component by component rather than with `dateStyle`/
  // `timeStyle`, which the Intl spec forbids combining with `timeZoneName` —
  // and the zone name is the entire point of this formatter.
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
});

function formatInstant(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : INSTANT.format(parsed);
}

type CycleRow = {
  id: string;
  title: string;
  status: string;
  geography_label: string | null;
  horizon_start_year: number | null;
  horizon_end_year: number | null;
  summary: string | null;
  public_review_open_at: string | null;
  public_review_close_at: string | null;
  financial_basis_year: number | null;
  annual_inflation_rate: number | string | null;
};

type ChapterRow = {
  id: string;
  chapter_key: string;
  title: string;
  section_type: string;
  status: string;
  summary: string | null;
  content_markdown: string | null;
  sort_order: number;
  required: boolean;
};

type ProjectRef = { id: string; name: string; summary: string | null };

type LinkRow = {
  id: string;
  portfolio_role: string;
  priority_rationale: string | null;
  horizon_band_id: string | null;
  estimated_cost: number | string | null;
  cost_basis_year: number | null;
  projects: ProjectRef | ProjectRef[] | null;
};

function normalizeProject(value: ProjectRef | ProjectRef[] | null): ProjectRef | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

// ---------------------------------------------------------------------------
// The public-review window
// ---------------------------------------------------------------------------

/**
 * NOTHING IN THIS SECTION IS EXPORTED, and that is a Next.js constraint rather
 * than a preference: a page module may only export the fields the App Router
 * recognises, so a named export here fails `next build` with "is not a valid
 * Page export field". The window logic is therefore proven through the rendered
 * page — which is where it has to be right anyway.
 *
 * IF A SECOND SURFACE NEEDS THIS (the comment-intake lane is the obvious one),
 * MOVE IT TO `src/lib/rtp/` RATHER THAN COPYING IT. A shared capability living
 * inside one of its callers gets reimplemented wrongly by the next one, and
 * "would my comment count?" is not a question two surfaces may answer
 * differently.
 */
type PublicReviewWindowState = "open" | "not_yet_open" | "closed" | "not_scheduled";

interface PublicReviewWindowDisclosure {
  state: PublicReviewWindowState;
  headline: string;
  detail: string;
  /**
   * Set when the agency's recorded STATUS and its recorded DATES disagree. Not
   * resolved by precedence, on purpose: picking a winner would publish one of
   * two contradictory facts as though it were the truth, and neither is
   * knowable from here.
   */
  conflict: string | null;
}

/**
 * Whether a comment submitted right now would land inside the review period.
 *
 * Pure, and takes `now` as an argument, so the awkward cases — the day before
 * it opens, the hour after it closes, a plan adopted while its window still
 * reads open — are exercisable directly rather than by moving a clock.
 *
 * `not_scheduled` is a first-class answer for the same reason `not_determined`
 * is one in the fiscal engine: an agency that has published a draft without
 * recording its window has told the reader nothing about the deadline, and
 * "closed" would be a confident wrong answer to the one question this section
 * exists to settle.
 */
function describePublicReviewWindow({
  status,
  openAt,
  closeAt,
  now,
}: {
  status: string | null;
  openAt: string | null;
  closeAt: string | null;
  now: Date;
}): PublicReviewWindowDisclosure {
  const opensAt = openAt ? new Date(openAt) : null;
  const closesAt = closeAt ? new Date(closeAt) : null;
  const opens = opensAt && !Number.isNaN(opensAt.getTime()) ? opensAt : null;
  const closes = closesAt && !Number.isNaN(closesAt.getTime()) ? closesAt : null;
  const opensLabel = formatInstant(openAt);
  const closesLabel = formatInstant(closeAt);

  const state: PublicReviewWindowState = !opens && !closes
    ? "not_scheduled"
    : opens && now < opens
      ? "not_yet_open"
      : closes && now > closes
        ? "closed"
        : "open";

  const settled = status === "adopted" || status === "archived";
  const conflict =
    settled && state === "open"
      ? "The agency has recorded this plan as adopted or archived, but the review dates on record say the comment period is still open. These two facts disagree — contact the agency before relying on either."
      : status === "public_review" && state === "closed"
        ? "The agency has recorded this plan as being in public review, but the review dates on record have passed. These two facts disagree — contact the agency before relying on either."
        : null;

  if (state === "not_scheduled") {
    return {
      state,
      headline: "No public review dates have been published for this plan",
      detail:
        "The agency has not recorded when comments on this draft open or close, so this page cannot tell you whether a comment submitted now would be counted. Ask the agency that published this plan before relying on a deadline.",
      conflict,
    };
  }

  if (state === "not_yet_open") {
    return {
      state,
      headline: "Public review has not opened yet",
      detail: `${
        opensLabel ? `Comments open ${opensLabel}` : "Comments are not open yet"
      }${closesLabel ? ` and close ${closesLabel}` : ""}. You can read the whole draft now; a comment submitted before the period opens may not be counted.`,
      conflict,
    };
  }

  if (state === "closed") {
    return {
      state,
      headline: "Public review has closed",
      detail: `${
        closesLabel ? `The comment period closed ${closesLabel}` : "The comment period has closed"
      }. The draft is still shown in full, but a comment submitted now would arrive after the deadline and may not be counted.`,
      conflict,
    };
  }

  return {
    state,
    headline: "Public review is open",
    detail: `${opensLabel ? `Comments opened ${opensLabel}` : "Comments are open"}${
      closesLabel
        ? ` and close ${closesLabel}.`
        : ". No closing date has been published, so ask the agency how long the period will run."
    }`,
    conflict,
  };
}

// ---------------------------------------------------------------------------
// Small presentational pieces
// ---------------------------------------------------------------------------

function Notice({
  tone,
  title,
  children,
}: {
  tone: "warning" | "neutral";
  title?: string;
  children: React.ReactNode;
}) {
  const className =
    tone === "warning"
      ? "rounded-lg border border-amber-300/60 bg-amber-50/60 p-4 dark:border-amber-900/50 dark:bg-amber-950/30"
      : "rounded-lg border border-border bg-muted/30 p-4";
  const textClassName =
    tone === "warning" ? "text-sm text-amber-900/90 dark:text-amber-200/90" : "text-sm text-muted-foreground";

  return (
    <section role="status" className={className}>
      {title ? (
        <h2
          className={
            tone === "warning"
              ? "text-sm font-semibold text-amber-900 dark:text-amber-200"
              : "text-sm font-semibold text-foreground"
          }
        >
          {title}
        </h2>
      ) : null}
      <div className={`${title ? "mt-1 " : ""}${textClassName} space-y-1`}>{children}</div>
    </section>
  );
}

/**
 * A measure's value is NOT money and must not go through `parseOptionalAmount`:
 * that helper treats a negative as a data-entry error and returns null, which is
 * right for a cost and wrong for a target like "change in transit travel time".
 * Zero is a real measurement here, not an absence.
 */
function formatMeasureValue(value: number | string | null, unit: string | null): string {
  if (value === null || value === undefined) return "Not recorded";
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return "Not recorded";
  const formatted = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(parsed);
  return unit?.trim() ? `${formatted} ${unit.trim()}` : formatted;
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

const NO_INDEX = { index: false, follow: false } as const;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ shareToken: string }>;
}): Promise<Metadata> {
  const { shareToken } = await params;

  // Both branches carry `robots`. The share token IS the credential, so an
  // indexed token-bearing URL publishes a link the agency handed to specific
  // people — and the NOT-FOUND branch matters just as much as the found one,
  // because a crawler that reaches a revoked token still records the URL.
  if (!shareToken || shareToken.length < 8) {
    return { title: "Draft plan for public review", robots: NO_INDEX };
  }

  const supabase = createServiceRoleClient();
  const cycleResult = await supabase
    .from("rtp_cycles")
    .select("title")
    .eq("public_share_token", shareToken)
    .eq("public_share_enabled", true)
    .maybeSingle();

  if (cycleResult.error) {
    return { title: "Draft plan for public review", robots: NO_INDEX };
  }

  const cycle = cycleResult.data as { title: string } | null;
  if (!cycle) {
    return { title: "Draft plan for public review", robots: NO_INDEX };
  }

  return {
    title: `${cycle.title} · Draft for public review`,
    description: "The draft Regional Transportation Plan, published by the agency for public review.",
    robots: NO_INDEX,
  };
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

export default async function PublicRtpDocumentPage({
  params,
}: {
  params: Promise<{ shareToken: string }>;
}) {
  const { shareToken } = await params;
  if (!shareToken || shareToken.length < 8) {
    notFound();
  }

  const supabase = createServiceRoleClient();
  const reads = new ReadFailureLog();

  // THESE TWO `.eq()`s ARE THE ACCESS CONTROL, not a refinement of a query.
  // This is the service-role client, so RLS enforces nothing here: the token
  // filter is what makes the page about THIS plan, and `public_share_enabled`
  // is what makes unpublishing work at all. The same pair rides on the
  // pre-migration retry below and on `generateMetadata`, and all three — plus
  // the `rtp_cycle_id` scope on every child read — are asserted by name in
  // `public-rtp-document-page.test.tsx` ("the filters are the access control"),
  // because a mocked client answers with the fixture whatever it was filtered
  // on and no render assertion can see a filter go missing.
  const wideCycleResult = await supabase
    .from("rtp_cycles")
    .select(CYCLE_COLUMNS)
    .eq("public_share_token", shareToken)
    .eq("public_share_enabled", true)
    .maybeSingle();

  // A RETRY, NOT A SWALLOW. The narrower read runs only when the failure is a
  // migration this deployment has not applied; every other failure keeps the
  // ORIGINAL result — error and all — which is what gets checked below.
  const cycleSchemaPending = looksLikePendingSchema(wideCycleResult.error?.message);
  const cycleResult = cycleSchemaPending
    ? await supabase
        .from("rtp_cycles")
        .select(CYCLE_COLUMNS_BEFORE_FINANCIAL_ELEMENT)
        .eq("public_share_token", shareToken)
        .eq("public_share_enabled", true)
        .maybeSingle()
    : wideCycleResult;

  // "This plan does not exist" and "this plan could not be read" are DIFFERENT
  // FACTS, and a 404 states the first one. Answering 404 over a dropped column
  // tells a resident that an agency's published draft is gone.
  if (reads.check("this plan", cycleResult)) {
    return (
      <article className="mx-auto w-full max-w-3xl px-4 py-10 sm:py-14">
        <header className="border-b border-border pb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Regional Transportation Plan · Draft for public review
          </p>
          <h1 className="mt-2 text-2xl font-semibold text-foreground sm:text-3xl">
            This plan could not be loaded
          </h1>
        </header>
        {/*
          The database's own message is deliberately NOT rendered. That is
          operator detail; a resident needs the fact that the page failed,
          stated so it cannot be mistaken for the draft being withdrawn.
        */}
        <div className="mt-6">
          <Notice tone="warning">
            <p>
              Something went wrong reading this plan, so none of it is shown. This is a problem
              loading the page — it does not mean the plan is missing, unpublished, or withdrawn,
              and it does not mean the public review period has ended.
            </p>
            <p>Please try again shortly, or contact the agency that published this plan.</p>
          </Notice>
        </div>
      </article>
    );
  }

  const cycleData = cycleResult.data as CycleRow | null;
  if (!cycleData) {
    notFound();
  }
  const cycle = cycleData;

  const [chaptersResult, linksResult] = await Promise.all([
    supabase
      .from("rtp_cycle_chapters")
      .select(CHAPTER_COLUMNS)
      .eq("rtp_cycle_id", cycle.id)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase.from("project_rtp_cycle_links").select(LINK_COLUMNS).eq("rtp_cycle_id", cycle.id),
  ]);

  const chaptersFailed = reads.check("the chapters of this plan", chaptersResult);
  const chapters = (chaptersResult.data ?? []) as ChapterRow[];
  const linksFailed = reads.check("the projects in this plan", linksResult);
  // `as unknown as` because the embedded `projects(...)` join makes supabase-js
  // infer `GenericStringError[]` for the whole row; the clients here are
  // deliberately untyped, so query results are cast (see CLAUDE.md).
  const links = (linksResult.data ?? []) as unknown as LinkRow[];

  // The shared loader, not a private copy of the same three reads — the export,
  // the board packet and this page must not drift in how they map a NUMERIC
  // that PostgREST returns as a string, or in treating an absent cost as absent.
  const financial = await loadRtpFinancialElement(
    supabase as unknown as RtpFinancialElementSupabaseLike,
    cycle.id
  );
  const bandsFailed = reads.check("the funding periods for this plan", financial.results.bands);
  const ledgerFailed = reads.check(
    "the revenue and cost assumptions for this plan",
    financial.results.lines
  );
  const measuresFailed = reads.check(
    "the performance measures for this plan",
    financial.results.measures
  );

  /*
    WHICH PUBLISHED FIGURES WERE COPIED OUT OF THE PLAN DOCUMENT, and from which
    page. Nathaniel's Q2 decision, 2026-08-11: provenance EVERYWHERE, including
    the public plan page — a resident reading a baseline is owed the page it was
    read off, in the agency's own document, quoted.

    Read separately from the financial element for the reason the loader's own
    header gives: naming a not-yet-migrated column in those shared projections
    would take this whole page's financial element down across a deploy window.
    A failure HERE costs the citations and nothing else, and it is disclosed —
    a missing chip is indistinguishable from a figure the agency typed, so
    swallowing this error would silently delete a disclosure the agency made.
  */
  const transcriptionProvenance = await loadRtpTranscriptionProvenance(
    supabase as unknown as RtpTranscriptionSupabaseLike,
    cycle.id
  );
  reads.check(
    "the pages this plan's figures were copied from",
    transcriptionProvenance.results.candidates
  );
  reads.check(
    "the documents this plan's figures were copied from",
    transcriptionProvenance.results.runs
  );

  // Row id -> its citation. The comparison behind this is the same one the
  // review screen uses, so a figure the agency revised after copying says so on
  // the published page instead of citing a page that no longer matches it.
  const citationByRowId = indexTranscriptions(transcriptionProvenance.transcriptions, {
    lines: financial.lines,
    measures: financial.measures,
    bands: financial.bands,
    programmedProjects: links.map((link) => ({
      id: link.id,
      projectId: normalizeProject(link.projects)?.id ?? link.id,
      projectName: normalizeProject(link.projects)?.name ?? null,
      horizonBandId: link.horizon_band_id,
      portfolioRole: link.portfolio_role,
      estimatedCost: link.estimated_cost,
      costBasisYear: link.cost_basis_year,
    })),
    cycle: { id: cycle.id, financialBasisYear: cycle.financial_basis_year ?? null },
  });

  /*
    RULE 3, IN ONE LINE. The fiscal engine is scrupulous about missing DATA and
    blind to a failed READ: an empty project-link array from a broken query is
    indistinguishable, to it, from a plan that programmes nothing — which
    computes to zero cost against real revenue and publishes "Fiscally
    constrained" on a public page. So the verdict is not computed unless every
    input loaded.
  */
  const fiscalReadable = !linksFailed && !bandsFailed && !ledgerFailed;
  const fiscal: RtpFiscalConstraintSummary | null = fiscalReadable
    ? buildRtpFiscalConstraint({
        // `?? null` because the pre-migration fallback projection does not carry
        // these two, and the engine's answer to "no basis year" is already the
        // honest one: it reports constant dollars of an unstated base year.
        cycleFinancialBasisYear: cycle.financial_basis_year ?? null,
        annualInflationRate: cycle.annual_inflation_rate ?? null,
        bands: financial.bands,
        lines: financial.lines,
        projects: links.map((link) => ({
          linkId: link.id,
          projectId: normalizeProject(link.projects)?.id ?? link.id,
          projectName: normalizeProject(link.projects)?.name ?? null,
          portfolioRole: link.portfolio_role,
          horizonBandId: link.horizon_band_id,
          estimatedCost: link.estimated_cost,
          costBasisYear: link.cost_basis_year,
        })),
      })
    : null;

  /*
    Projects grouped by the period that pays for them. A project in no period is
    not hidden — it gets its own group, because a plan that programmes a cost
    against no period is something a reviewer should be able to see.

    UNLESS THE PERIODS THEMSELVES COULD NOT BE READ, which is the case this
    guards. Grouping against an empty band list resolves every project to "No
    period assigned" — a specific claim about the plan, made on the strength of
    a failed query, about projects whose period is recorded perfectly well. So a
    failed band read produces ONE ungrouped list that says why it is ungrouped.
  */
  const bandOrder = financial.bands.map((band) => band.id);
  const groups: Array<{ key: string; label: string | null; years: string | null; links: LinkRow[] }> =
    bandsFailed
      ? links.length > 0
        ? [{ key: "__periods_unreadable__", label: null, years: null, links }]
        : []
      : [
          ...financial.bands.map((band) => ({
            key: band.id,
            label: band.label as string | null,
            years: `${band.startYear}–${band.endYear}` as string | null,
            links: links.filter((link) => link.horizon_band_id === band.id),
          })),
          {
            key: "__unassigned__",
            label: "No period assigned" as string | null,
            years: null as string | null,
            links: links.filter(
              (link) => !link.horizon_band_id || !bandOrder.includes(link.horizon_band_id)
            ),
          },
        ].filter((group) => group.links.length > 0);

  const reviewWindow = describePublicReviewWindow({
    status: cycle.status,
    openAt: cycle.public_review_open_at,
    closeAt: cycle.public_review_close_at,
    now: new Date(),
  });

  const horizon =
    typeof cycle.horizon_start_year === "number" && typeof cycle.horizon_end_year === "number"
      ? `${cycle.horizon_start_year}–${cycle.horizon_end_year}`
      : null;

  const anyAssumedExpenditureYear = fiscal?.bands.some((band) => band.expenditureYearAssumed) ?? false;

  return (
    <article className="mx-auto w-full max-w-3xl px-4 py-10 sm:py-14">
      <header className="border-b border-border pb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Regional Transportation Plan · Draft for public review
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-foreground sm:text-3xl">{cycle.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {formatRtpCycleStatusLabel(cycle.status)}
          {cycle.geography_label ? ` · ${cycle.geography_label}` : ""}
          {horizon ? ` · Horizon ${horizon}` : ""}
        </p>
        {cycle.summary?.trim() ? (
          <p className="mt-3 text-sm text-muted-foreground">{cycle.summary}</p>
        ) : null}
        <p className="mt-3 text-sm">
          <Link href={`/plan/${shareToken}`} className="underline underline-offset-4">
            What this plan funds, and why
          </Link>
        </p>
      </header>

      {/*
        Disclosed to the reader, not merely logged — and `describe()` only. The
        database's own message is operator detail, and this page is public.
      */}
      {reads.any ? (
        <div className="mt-6">
          <Notice tone="warning" title="Part of this plan could not be loaded">
            <p>{reads.describe()}</p>
            <p>Please check back, or contact the agency that published this plan.</p>
          </Notice>
        </div>
      ) : null}

      {/* RULE 4. Stated plainly, and never a reason to hide the document. */}
      <section id="public-review" className="mt-6">
        <div
          className={
            reviewWindow.state === "open"
              ? "rounded-lg border border-emerald-300/50 bg-emerald-50/50 p-4 dark:border-emerald-900/40 dark:bg-emerald-950/20"
              : "rounded-lg border border-border bg-muted/30 p-4"
          }
        >
          <h2 className="text-sm font-semibold text-foreground">{reviewWindow.headline}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{reviewWindow.detail}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            The whole draft is readable below whether or not the comment period is open.
          </p>
        </div>
        {reviewWindow.conflict ? (
          <div className="mt-2">
            <Notice tone="warning" title="The recorded status and the recorded dates disagree">
              <p>{reviewWindow.conflict}</p>
            </Notice>
          </div>
        ) : null}
      </section>

      {/* --- Financial element ------------------------------------------- */}
      <section id="financial-element" className="mt-10">
        <h2 className="text-lg font-semibold text-foreground">Financial element</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          What the plan expects to receive, what it expects to spend, and whether the two meet.
        </p>

        {fiscal === null ? (
          <div className="mt-3">
            <Notice tone="warning" title="The financial summary could not be assembled">
              <p>
                Part of the financial record could not be read, so no funding total and no fiscal
                verdict is shown. A total calculated from a partial read could report this plan as
                affordable when it is not, which is worse than showing nothing.
              </p>
              <p>This is not a finding that the plan has no revenue, no costs, or no funding periods.</p>
            </Notice>
          </div>
        ) : (
          <>
            <div className="mt-3 rounded-lg border border-border bg-background/60 p-4">
              <p className="text-sm font-semibold text-foreground">
                {rtpFiscalVerdictLabel(fiscal.verdict)}
              </p>
              {/*
                The engine's own sentence, not a re-worded one. It carries the
                dollar basis with the number — constant dollars presented as
                year-of-expenditure is the misstatement 23 CFR 450.324(f)(11)(iv)
                is about — and on `not_determined` it names every reason.
              */}
              <p className="mt-1 text-sm text-muted-foreground">{describeRtpFiscalConstraint(fiscal)}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                {fiscal.constrainedProjectCount === 1
                  ? "1 project is in the fiscally constrained programme"
                  : `${fiscal.constrainedProjectCount} projects are in the fiscally constrained programme`}
                {fiscal.illustrativeProjectCount > 0
                  ? `, and ${fiscal.illustrativeProjectCount} ${
                      fiscal.illustrativeProjectCount === 1 ? "is" : "are"
                    } on the illustrative list — projects the agency would build if more funding became available, which are outside the constrained programme by regulation`
                  : ""}
                .
              </p>
            </div>

            {fiscal.bands.length > 0 ? (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[34rem] border-collapse text-sm">
                  <caption className="sr-only">
                    Revenue, cost, and balance for each period of this plan
                  </caption>
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th scope="col" className="py-2 pr-3 font-medium">Period</th>
                      <th scope="col" className="py-2 pr-3 font-medium">Revenue</th>
                      <th scope="col" className="py-2 pr-3 font-medium">Cost</th>
                      <th scope="col" className="py-2 pr-3 font-medium">Balance</th>
                      <th scope="col" className="py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fiscal.bands.map((band) => (
                      <tr key={band.bandId} className="border-b border-border/50 align-top">
                        <td className="py-2 pr-3">
                          <span className="font-medium text-foreground">{band.label}</span>
                          <span className="block text-xs text-muted-foreground">
                            {band.startYear}–{band.endYear}
                          </span>
                        </td>
                        <td className="py-2 pr-3 tabular-nums">{formatMoney(band.revenue, { precision: "whole" })}</td>
                        <td className="py-2 pr-3 tabular-nums">{formatMoney(band.totalCost, { precision: "whole" })}</td>
                        <td className="py-2 pr-3 tabular-nums">{formatMoney(band.balance, { precision: "whole" })}</td>
                        <td className="py-2 text-xs text-muted-foreground">
                          {rtpFiscalVerdictLabel(band.verdict)}
                          {band.blockers.map((blocker) => (
                            <span key={blocker.code} className="block">
                              {blocker.detail}
                            </span>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {anyAssumedExpenditureYear ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Where the agency did not record the year a period&apos;s money is expected to be
                spent, the midpoint of the period was assumed.
              </p>
            ) : null}
          </>
        )}
      </section>

      {/* --- Performance measures ---------------------------------------- */}
      <section id="performance-measures" className="mt-10">
        <h2 className="text-lg font-semibold text-foreground">Performance measures</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          What the agency will measure to tell whether this plan worked.
        </p>
        {measuresFailed ? (
          <div className="mt-3">
            <Notice tone="warning">
              <p>
                The performance measures could not be read, so none are shown. This does not mean
                the plan has none.
              </p>
            </Notice>
          </div>
        ) : financial.measures.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No performance measures have been published for this plan yet.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {financial.measures.map((measure) => (
              <li key={measure.id} className="rounded-lg border border-border bg-background/60 p-4">
                <p className="text-sm font-semibold text-foreground">{measure.label}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Baseline: {formatMeasureValue(measure.baselineValue, measure.unit)}
                  {measure.baselineYear ? ` (${measure.baselineYear})` : ""} · Target:{" "}
                  {formatMeasureValue(measure.targetValue, measure.unit)}
                  {measure.targetYear ? ` (${measure.targetYear})` : ""}
                </p>
                {measure.dataSource?.trim() ? (
                  <p className="mt-1 text-xs text-muted-foreground">Source: {measure.dataSource}</p>
                ) : null}
                {measure.notes?.trim() ? (
                  <p className="mt-1 text-xs text-muted-foreground">{measure.notes}</p>
                ) : null}
                {/*
                  WHERE THIS BASELINE CAME FROM. A measure copied out of the
                  agency's own adopted document names it, names the page, and
                  prints the sentence — a resident cannot open the document, so
                  the quote on the page IS the check available to them. A
                  measure somebody typed shows nothing at all, which is the
                  truth about it.
                */}
                <ExtractionProvenanceCitation
                  record={citationByRowId.get(measure.id)}
                  audience="public"
                  className="mt-2"
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* --- Project lists ------------------------------------------------ */}
      <section id="project-lists" className="mt-10">
        <h2 className="text-lg font-semibold text-foreground">Project lists</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          What this plan commits to, grouped by the period that pays for it. Money totals for each
          period are in the financial element above.
        </p>

        {linksFailed ? (
          <div className="mt-3">
            <Notice tone="warning">
              <p>
                The project lists could not be read, so they are not shown. This does not mean the
                plan has no projects.
              </p>
            </Notice>
          </div>
        ) : groups.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No projects have been published for this plan yet.
          </p>
        ) : (
          <div className="mt-3 space-y-5">
            {groups.map((group) => (
              <section key={group.key}>
                {group.label === null ? (
                  <p className="text-sm text-muted-foreground">
                    The funding periods for this plan could not be read, so these projects are
                    listed without the period that pays for them. This does not mean they have no
                    period.
                  </p>
                ) : (
                  <h3 className="text-base font-semibold text-foreground">
                    {group.label}
                    {group.years ? (
                      <span className="ml-1.5 font-normal text-muted-foreground">{group.years}</span>
                    ) : null}
                  </h3>
                )}
                <ul className="mt-2 space-y-2">
                  {group.links.map((link) => {
                    const project = normalizeProject(link.projects);
                    // Absent is NOT zero. A cost that was never entered reads as
                    // unpriced here and blocks the fiscal determination above.
                    const cost = parseOptionalAmount(link.estimated_cost);
                    return (
                      <li key={link.id} className="rounded-lg border border-border bg-background/60 p-4">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <p className="text-sm font-semibold text-foreground">
                            {project?.name ?? "Project"}
                          </p>
                          <p className="text-sm tabular-nums">
                            {cost === null ? (
                              <span className="text-muted-foreground">No cost recorded</span>
                            ) : (
                              <>
                                {formatMoney(cost, { precision: "whole" })}
                                {link.cost_basis_year ? (
                                  <span className="ml-1 text-xs text-muted-foreground">
                                    ({link.cost_basis_year} dollars)
                                  </span>
                                ) : null}
                              </>
                            )}
                          </p>
                        </div>
                        <p className="mt-1 text-xs font-medium text-muted-foreground">
                          {formatRtpPortfolioRoleLabel(link.portfolio_role)}
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {link.priority_rationale?.trim() ||
                            project?.summary?.trim() ||
                            "No description has been published for this project yet."}
                        </p>
                        <ExtractionProvenanceCitation
                          record={citationByRowId.get(link.id)}
                          audience="public"
                          className="mt-2"
                        />
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </section>

      {/* --- The document itself ------------------------------------------ */}
      <section id="chapters" className="mt-10">
        <h2 className="text-lg font-semibold text-foreground">The plan</h2>

        {/*
          Chapters have no empty state of their own — they simply stop
          rendering — so a failed read would otherwise produce a plan document
          with no text in it at all, which is the most convincing false thing
          this page can say.
        */}
        {chaptersFailed ? (
          <div className="mt-3">
            <Notice tone="warning" title="The chapters of this plan could not be read">
              <p>
                No chapter text is shown below because the chapters could not be loaded, not
                because the plan has none. What you can see on this page is incomplete in a way
                nobody can currently describe, so please do not treat it as the whole draft.
              </p>
            </Notice>
          </div>
        ) : chapters.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No chapters have been published for this plan yet.
          </p>
        ) : (
          <>
            <nav aria-label="Contents" className="mt-3 rounded-lg border border-border bg-muted/30 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Contents
              </p>
              <ol className="mt-2 space-y-1 text-sm">
                {chapters.map((chapter, index) => (
                  <li key={chapter.id}>
                    <a
                      href={`#${slugify(chapter.chapter_key || chapter.title)}`}
                      className="underline underline-offset-4"
                    >
                      {index + 1}. {chapter.title}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>

            <div className="mt-6 space-y-8">
              {chapters.map((chapter, index) => (
                <section key={chapter.id} id={slugify(chapter.chapter_key || chapter.title)}>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Chapter {index + 1} · {titleizeRtpValue(chapter.section_type)}
                  </p>
                  <h3 className="mt-1 text-xl font-semibold text-foreground">{chapter.title}</h3>
                  {/*
                    The chapter's drafting state is disclosed rather than hidden.
                    A reviewer who cannot tell a finished chapter from an empty
                    one cannot tell whether a subject is missing from the plan or
                    simply not written yet — and only one of those is worth a
                    comment.
                  */}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatRtpChapterStatusLabel(chapter.status)}
                    {chapter.required ? " · Required section" : ""}
                  </p>

                  {chapter.content_markdown?.trim() ? (
                    // Sanitised by `renderChapterMarkdownToHtml`, which strips
                    // script/style/iframe/object/embed/link blocks, escapes raw
                    // HTML to text, and refuses any link or image protocol
                    // outside http/https/mailto/tel. Never hand it raw markdown.
                    <div
                      className="chapter-markdown mt-3 text-sm leading-7 text-foreground/90"
                      dangerouslySetInnerHTML={{
                        __html: renderChapterMarkdownToHtml(chapter.content_markdown),
                      }}
                    />
                  ) : (
                    <div className="mt-3 space-y-2">
                      {chapter.summary?.trim() ? (
                        <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                          {chapter.summary}
                        </p>
                      ) : null}
                      <p className="text-sm text-muted-foreground">
                        No draft text has been published for this chapter yet.
                      </p>
                    </div>
                  )}
                </section>
              ))}
            </div>
          </>
        )}
      </section>

      <footer className="mt-12 border-t border-border pt-4 text-xs text-muted-foreground">
        <p>
          This is a read-only public view of a draft plan, published by the agency that wrote it.
          Costs and revenue are the agency&apos;s own recorded figures; where a figure has not been
          entered it is shown as not recorded rather than as zero. The adopted board packet remains
          the official record.
        </p>
      </footer>
    </article>
  );
}
