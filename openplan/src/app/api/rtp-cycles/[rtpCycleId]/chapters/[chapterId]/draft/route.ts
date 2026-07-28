import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { checkAiUsageRateLimit, recordAiUsageEvent } from "@/lib/runtime/ai-rate-limit";
import { buildAnalysisCostThresholdWarning } from "@/lib/ai/cost-threshold";
import { validateGroundedNarrative } from "@/lib/planner-pack/grounding";
import {
  factClaimTextMap,
  renderNarrativeFactPromptLines,
  summarizeNarrativeGrounding,
} from "@/lib/grants/narrative-grounding";
import { ENGAGEMENT_NARRATIVE_CAVEAT } from "@/lib/grants/engagement-evidence";
import { KB_NARRATIVE_CAVEAT, buildKnowledgeBaseFactClaims } from "@/lib/grants/kb-evidence";
import { retrieveKnowledgeBaseExcerpts } from "@/lib/knowledge-base/retrieval";
import { loadCountyRunModelingEvidence } from "@/lib/models/evidence-backbone";
import {
  buildPortfolioFundingSnapshot,
  type FundingAwardLike,
  type FundingInvoiceLike,
  type FundingOpportunityLike,
} from "@/lib/projects/funding";
import { summarizeEngagementItems } from "@/lib/engagement/summary";
import { factsHash, parseStoredDraft } from "@/lib/reports/narrative-drafts";
import type { ReportModelingEvidence } from "@/lib/reports/modeling-evidence";
import { buildRtpCycleReadiness, buildRtpCycleWorkflowSummary } from "@/lib/rtp/catalog";
import { buildRtpChapterFacts } from "@/lib/rtp/narrative-facts";

/**
 * RTP chapter draft assist.
 *
 * POST drafts grounded prose for ONE chapter from the same deterministic
 * summaries the RTP packet path renders (cycle readiness/workflow, linked
 * projects and their funding, engagement posture, county-run modeling
 * evidence) plus Knowledge Base excerpts matched to the chapter.
 *
 * PATCH records the operator's review of a stored draft. Unlike the
 * report-section accept gate, a chapter acceptance is PROVENANCE ONLY: the
 * draft's text reaches the plan exclusively through the chapter editor's
 * "insert into editor" action, where it lands in the content_markdown
 * textarea the operator edits and saves — `content_markdown` remains the sole
 * published chapter content, and inserted text is operator-authored by
 * construction. Dismissal is terminal.
 */

const DEFAULT_NARRATIVE_MODEL_ID = "claude-opus-4-8";

const MODEL_PRICING_USD_PER_MTOKEN: Record<string, { input: number; output: number }> = {
  "claude-opus-4-8": { input: 5.0, output: 25.0 },
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
};

const paramsSchema = z.object({
  rtpCycleId: z.string().uuid(),
  chapterId: z.string().uuid(),
});

// The generate action takes no meaningful input yet; accept an empty JSON
// object (or an empty body) and reject anything else so future fields stay
// deliberate.
const draftRequestSchema = z.object({}).strict().nullable();

const reviewSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("accept"),
    draftId: z.string().uuid(),
    acceptedMarkdown: z.string().trim().min(1).max(40000).optional(),
  }),
  z.object({ action: z.literal("dismiss"), draftId: z.string().uuid() }),
]);

type RouteContext = {
  params: Promise<{ rtpCycleId: string; chapterId: string }>;
};

const DRAFT_COLUMNS =
  "id, workspace_id, target_kind, target_id, section_key, draft_markdown, model, grounding_json, grounded_sentence_count, total_sentence_count, facts_hash, status, accepted_markdown, accepted_by, accepted_at, created_by, created_at";

function looksLikePendingSchema(message: string | null | undefined) {
  return /column .* does not exist|schema cache|relation .* does not exist/i.test(message ?? "");
}

function nullIfUndefined(value: number | undefined): number | null {
  return typeof value === "number" ? value : null;
}

function estimateCostUsd(
  modelId: string,
  inputTokens: number | null,
  outputTokens: number | null
): number | null {
  const pricing = MODEL_PRICING_USD_PER_MTOKEN[modelId];
  if (!pricing) return null;
  if (inputTokens === null && outputTokens === null) return null;
  const raw =
    ((inputTokens ?? 0) / 1_000_000) * pricing.input +
    ((outputTokens ?? 0) / 1_000_000) * pricing.output;
  return Math.round(raw * 1_000_000) / 1_000_000;
}

type ChapterAccess = {
  response: NextResponse | null;
  chapter: {
    id: string;
    workspace_id: string;
    rtp_cycle_id: string;
    title: string;
    section_type: string | null;
    status: string | null;
    summary: string | null;
    guidance: string | null;
  } | null;
  userId: string | null;
};

async function resolveChapterAccess(
  supabase: Awaited<ReturnType<typeof createClient>>,
  audit: ReturnType<typeof createApiAuditLogger>,
  params: { rtpCycleId: string; chapterId: string }
): Promise<ChapterAccess> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      chapter: null,
      userId: null,
    };
  }

  const { data: chapter, error: chapterError } = await supabase
    .from("rtp_cycle_chapters")
    .select("id, workspace_id, rtp_cycle_id, title, section_type, status, summary, guidance")
    .eq("id", params.chapterId)
    .eq("rtp_cycle_id", params.rtpCycleId)
    .maybeSingle();

  if (chapterError) {
    audit.error("chapter_lookup_failed", {
      chapterId: params.chapterId,
      message: chapterError.message,
      code: chapterError.code ?? null,
    });
    return {
      response: NextResponse.json({ error: "Failed to load RTP chapter" }, { status: 500 }),
      chapter: null,
      userId: user.id,
    };
  }
  if (!chapter) {
    return {
      response: NextResponse.json({ error: "RTP chapter not found" }, { status: 404 }),
      chapter: null,
      userId: user.id,
    };
  }

  const { data: membership, error: membershipError } = await supabase
    .from("workspace_members")
    .select("workspace_id, role")
    .eq("workspace_id", chapter.workspace_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (membershipError) {
    audit.error("membership_lookup_failed", {
      chapterId: chapter.id,
      message: membershipError.message,
      code: membershipError.code ?? null,
    });
    return {
      response: NextResponse.json({ error: "Failed to resolve workspace membership" }, { status: 500 }),
      chapter: null,
      userId: user.id,
    };
  }
  if (!membership || !canAccessWorkspaceAction("plans.write", membership.role)) {
    return {
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
      chapter: null,
      userId: user.id,
    };
  }

  return { response: null, chapter, userId: user.id };
}

export async function POST(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("rtp_cycles.chapters.draft", request);
  const startedAt = Date.now();

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);
    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid RTP cycle chapter id" }, { status: 400 });
    }

    const payloadBody = await readJsonOrNullWithLimit(request, BODY_LIMITS.smallJson);
    if (!payloadBody.ok) return payloadBody.response;

    const parsedBody = draftRequestSchema.safeParse(payloadBody.data ?? null);
    if (!parsedBody.success) {
      audit.warn("validation_failed", { issues: parsedBody.error.issues });
      return NextResponse.json({ error: "Invalid chapter draft payload" }, { status: 400 });
    }

    const supabase = await createClient();

    if (!process.env.ANTHROPIC_API_KEY?.trim()) {
      audit.warn("ai_offline", { chapterId: parsedParams.data.chapterId });
      return NextResponse.json({ error: "ai_offline" }, { status: 503 });
    }

    const access = await resolveChapterAccess(supabase, audit, parsedParams.data);
    if (access.response || !access.chapter || !access.userId) {
      return access.response ?? NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const chapter = access.chapter;

    const rateLimit = await checkAiUsageRateLimit(chapter.workspace_id);
    if (!rateLimit.allowed) {
      audit.warn("chapter_draft_rate_limited", {
        chapterId: chapter.id,
        workspaceId: chapter.workspace_id,
        recentCount: rateLimit.count,
      });
      return NextResponse.json(
        { error: "Too many AI requests in a short window. Please wait a moment and try again." },
        { status: 429, headers: { "retry-after": String(rateLimit.retryAfterSeconds) } }
      );
    }

    // Deterministic cycle context — the same summaries the RTP packet renders.
    const [cycleResult, linksResult, campaignsResult, countyRunsResult] = await Promise.all([
      supabase
        .from("rtp_cycles")
        .select(
          "id, title, status, geography_label, horizon_start_year, horizon_end_year, adoption_target_date, public_review_open_at, public_review_close_at"
        )
        .eq("id", chapter.rtp_cycle_id)
        .maybeSingle(),
      supabase
        .from("project_rtp_cycle_links")
        .select("id, project_id, portfolio_role, projects(id, name, status, updated_at)")
        .eq("rtp_cycle_id", chapter.rtp_cycle_id),
      supabase
        .from("engagement_campaigns")
        .select("id, rtp_cycle_chapter_id")
        .eq("workspace_id", chapter.workspace_id)
        .eq("rtp_cycle_id", chapter.rtp_cycle_id),
      supabase
        .from("county_runs")
        .select("id, workspace_id, run_name, geography_label, stage, updated_at")
        .eq("workspace_id", chapter.workspace_id)
        .order("updated_at", { ascending: false })
        .limit(3),
    ]);

    if (cycleResult.error || !cycleResult.data) {
      audit.error("chapter_draft_cycle_load_failed", {
        chapterId: chapter.id,
        message: cycleResult.error?.message ?? "RTP cycle not found",
      });
      return NextResponse.json({ error: "Failed to load RTP cycle context" }, { status: 500 });
    }
    const cycle = cycleResult.data;

    type LinkRow = {
      project_id: string;
      portfolio_role: string | null;
      projects:
        | { id: string; name: string; status: string | null; updated_at: string | null }
        | Array<{ id: string; name: string; status: string | null; updated_at: string | null }>
        | null;
    };
    const linkRows = (linksResult.data ?? []) as LinkRow[];
    const linkedProjects = linkRows.map((link) => {
      const project = Array.isArray(link.projects) ? (link.projects[0] ?? null) : link.projects;
      return {
        projectId: link.project_id,
        name: project?.name ?? null,
        portfolioRole: link.portfolio_role,
        projectUpdatedAt: project?.updated_at ?? null,
      };
    });
    const linkedProjectIds = linkedProjects.map((link) => link.projectId).filter(Boolean);

    const [fundingProfilesResult, fundingAwardsResult, fundingOpportunitiesResult, invoicesResult] =
      linkedProjectIds.length > 0
        ? await Promise.all([
            supabase
              .from("project_funding_profiles")
              .select("project_id, funding_need_amount, local_match_need_amount, updated_at")
              .in("project_id", linkedProjectIds),
            supabase
              .from("funding_awards")
              .select("project_id, awarded_amount, match_amount, risk_flag, obligation_due_at, updated_at, created_at")
              .in("project_id", linkedProjectIds),
            supabase
              .from("funding_opportunities")
              .select("project_id, expected_award_amount, decision_state, opportunity_status, closes_at, updated_at, created_at")
              .in("project_id", linkedProjectIds),
            supabase
              .from("billing_invoice_records")
              .select("project_id, status, amount, retention_percent, retention_amount, net_amount, due_date, invoice_date, created_at")
              .in("project_id", linkedProjectIds),
          ])
        : [
            { data: [], error: null },
            { data: [], error: null },
            { data: [], error: null },
            { data: [], error: null },
          ];

    type ByProject<T> = Map<string, T[]>;
    const groupByProject = <T extends { project_id: string }>(rows: T[] | null | undefined): ByProject<T> => {
      const map: ByProject<T> = new Map();
      for (const row of rows ?? []) {
        const current = map.get(row.project_id) ?? [];
        current.push(row);
        map.set(row.project_id, current);
      }
      return map;
    };
    const profilesByProject = new Map(
      ((fundingProfilesResult.data ?? []) as Array<{ project_id: string; funding_need_amount: number | null; local_match_need_amount: number | null; updated_at: string | null }>).map(
        (profile) => [profile.project_id, profile]
      )
    );
    const awardsByProject = groupByProject(fundingAwardsResult.data as Array<{ project_id: string }> | null);
    const opportunitiesByProject = groupByProject(
      fundingOpportunitiesResult.data as Array<{ project_id: string }> | null
    );
    const invoicesByProject = groupByProject(invoicesResult.data as Array<{ project_id: string }> | null);

    const portfolioFunding =
      linkedProjectIds.length > 0
        ? buildPortfolioFundingSnapshot({
            projects: linkedProjects.map((link) => ({
              projectUpdatedAt: link.projectUpdatedAt,
              profile: profilesByProject.get(link.projectId) ?? null,
              awards: (awardsByProject.get(link.projectId) ?? []) as FundingAwardLike[],
              opportunities: (opportunitiesByProject.get(link.projectId) ?? []) as FundingOpportunityLike[],
              invoices: (invoicesByProject.get(link.projectId) ?? []) as FundingInvoiceLike[],
            })),
            capturedAt: new Date().toISOString(),
          })
        : null;

    const campaigns = (campaignsResult.data ?? []) as Array<{ id: string; rtp_cycle_chapter_id: string | null }>;
    const campaignIds = campaigns.map((campaign) => campaign.id);
    const engagementItemsResult = campaignIds.length
      ? await supabase
          .from("engagement_items")
          .select(
            "id, campaign_id, category_id, status, source_type, latitude, longitude, moderation_notes, created_at, updated_at"
          )
          .in("campaign_id", campaignIds)
      : { data: [], error: null };
    const engagementCounts = summarizeEngagementItems(
      [],
      (engagementItemsResult.data ?? []) as Array<{
        id: string;
        campaign_id: string;
        category_id: string | null;
        status: string | null;
        source_type: string | null;
        latitude: number | null;
        longitude: number | null;
        moderation_notes: string | null;
        created_at: string | null;
        updated_at: string | null;
      }>
    );
    const cycleLevelCampaignCount = campaigns.filter((campaign) => !campaign.rtp_cycle_chapter_id).length;

    // Modeling evidence via the same per-run loader the RTP packet path uses.
    const countyRuns = (countyRunsResult.data ?? []) as Array<{
      id: string;
      run_name: string | null;
      geography_label: string | null;
      stage: string | null;
      updated_at: string | null;
    }>;
    const modelingEvidence: ReportModelingEvidence[] = await Promise.all(
      countyRuns.map(async (countyRun) => {
        const evidenceResult = await loadCountyRunModelingEvidence({
          supabase,
          countyRunId: countyRun.id,
          track: "assignment",
        });
        return {
          countyRunId: countyRun.id,
          runName: countyRun.run_name,
          geographyLabel: countyRun.geography_label,
          stage: countyRun.stage,
          updatedAt: countyRun.updated_at,
          evidence: evidenceResult.evidence,
        };
      })
    );

    // Knowledge Base excerpts matched to this chapter. Best-effort — [] when
    // the KB schema is unavailable or nothing matches.
    const kbQuery = [chapter.title, chapter.guidance, cycle.title]
      .filter((part): part is string => Boolean(part && part.trim()))
      .join(". ");
    const kbExcerpts = await retrieveKnowledgeBaseExcerpts({
      supabase,
      workspaceId: chapter.workspace_id,
      query: kbQuery,
      limit: 4,
    });
    const kbClaims = buildKnowledgeBaseFactClaims(kbExcerpts, null);

    const readiness = buildRtpCycleReadiness({
      geographyLabel: cycle.geography_label,
      horizonStartYear: cycle.horizon_start_year,
      horizonEndYear: cycle.horizon_end_year,
      adoptionTargetDate: cycle.adoption_target_date,
      publicReviewOpenAt: cycle.public_review_open_at,
      publicReviewCloseAt: cycle.public_review_close_at,
    });
    const workflow = buildRtpCycleWorkflowSummary({ status: cycle.status, readiness });

    const facts = buildRtpChapterFacts({
      chapter,
      cycle,
      readiness,
      workflow,
      linkedProjects,
      portfolioFunding,
      engagement:
        campaigns.length > 0
          ? {
              campaignCount: campaigns.length,
              cycleLevelCampaignCount,
              chapterLevelCampaignCount: campaigns.length - cycleLevelCampaignCount,
              totalItems: engagementCounts.totalItems,
              approvedCount: engagementCounts.moderationQueue.approvedCount,
              readyForHandoffCount: engagementCounts.moderationQueue.readyForHandoffCount,
              pendingCount: engagementCounts.moderationQueue.pendingCount,
            }
          : null,
      modelingEvidence,
      kbClaims,
    });
    const factIds = facts.map((fact) => fact.fact_id);
    const draftFactsHash = factsHash(facts);

    const modelId = process.env.OPENPLAN_ASSISTANT_MODEL?.trim() || DEFAULT_NARRATIVE_MODEL_ID;

    const promptSections = [
      `Draft the narrative for the RTP chapter "${chapter.title}" of the RTP cycle "${cycle.title}".`,
      "",
      "REQUIREMENTS:",
      "- Write 2-5 paragraphs of professional long-range-plan prose in markdown (paragraphs only; no headings, no bullet lists).",
      "- Ground every statement STRICTLY in the numbered WORKSPACE FACTS below. Do not invent numbers, dollar amounts, dates, project names, comment counts, or model results that are not present in the facts.",
      "- CITATIONS ARE MANDATORY: every sentence that states a workspace-specific fact MUST end with one or more inline citation tokens of the form [fact:fact_N] naming the fact(s) it draws on.",
      "- Only cite fact ids that appear in the WORKSPACE FACTS list. A purely transitional sentence may go uncited ONLY if it asserts nothing factual — when in doubt, prefer citing.",
      "- If a figure or fact is not provided, describe it qualitatively or note that it is still being documented — never fabricate it.",
      "- NEVER upgrade a claim: modeling facts below carry their claim-registry framing (screening-grade, prototype-only, etc.) — keep that framing verbatim whenever you reference them, and never present screening results as forecasts or calibrated models.",
      "- If (and only if) you reference the community-engagement facts below, you MUST include the following caveat sentence verbatim in the same paragraph, and you must never describe comment counts or sentiment as community consensus, a survey result, or completed public-participation requirements:",
      `  "${ENGAGEMENT_NARRATIVE_CAVEAT}"`,
      "- If (and only if) you reference the uploaded-document facts below, you MUST include the following caveat sentence verbatim in the same paragraph, attribute the content to the named document, and never present it as OpenPlan's own finding or as independently verified:",
      `  "${KB_NARRATIVE_CAVEAT}"`,
      "- This draft is writing assistance for a chapter an operator edits and publishes; do not promise adoption outcomes, approvals, or funding awards.",
      "",
      "WORKSPACE FACTS (the only citable claims; cite as [fact:fact_N]):",
      ...renderNarrativeFactPromptLines(facts),
    ].join("\n");

    let draftText: string;
    let usage: Awaited<ReturnType<typeof generateText>>["usage"] | undefined;

    try {
      const generation = await generateText({
        model: anthropic(modelId),
        maxOutputTokens: 2000,
        system:
          "You are a long-range transportation plan writer supporting a public planning agency. You draft RTP chapter narratives from structured workspace records. You only use facts provided to you; you never fabricate figures, statuses, or outcomes, and you never upgrade screening-grade results.",
        prompt: promptSections,
      });
      draftText = generation.text.trim();
      usage = generation.usage;
    } catch (generationError) {
      audit.error("chapter_draft_generation_failed", {
        chapterId: chapter.id,
        model: modelId,
        message: generationError instanceof Error ? generationError.message : String(generationError),
      });
      return NextResponse.json({ error: "narrative_generation_failed" }, { status: 502 });
    }

    // Fire-and-forget spend metering after a successful model call only.
    void recordAiUsageEvent({
      workspaceId: chapter.workspace_id,
      bucketKey: "document_narrative_draft",
      eventKey: "rtp_chapter_narrative_draft",
      sourceRoute: "/api/rtp-cycles/[rtpCycleId]/chapters/[chapterId]/draft",
      metadataJson: { model: modelId, chapterId: chapter.id },
    });

    if (!draftText) {
      audit.error("chapter_draft_generation_empty", { chapterId: chapter.id, model: modelId });
      return NextResponse.json({ error: "narrative_generation_failed" }, { status: 502 });
    }

    const grounding = summarizeNarrativeGrounding(
      validateGroundedNarrative(draftText, factIds, "annotated", factClaimTextMap(facts)),
      facts
    );

    const { data: draft, error: insertError } = await supabase
      .from("document_narrative_drafts")
      .insert({
        workspace_id: chapter.workspace_id,
        target_kind: "rtp_chapter",
        target_id: chapter.id,
        section_key: null,
        draft_markdown: draftText,
        model: modelId,
        grounding_json: grounding,
        grounded_sentence_count: grounding.grounded_sentence_count,
        total_sentence_count: grounding.total_sentence_count,
        facts_hash: draftFactsHash,
        status: "draft",
        created_by: access.userId,
      })
      .select(DRAFT_COLUMNS)
      .single();

    if (insertError || !draft) {
      if (insertError && looksLikePendingSchema(insertError.message)) {
        return NextResponse.json(
          {
            error: "Chapter drafts cannot be stored yet: the document_narrative_drafts table is missing.",
            hint: "Apply migration 20260727000013_document_narrative_drafts, then draft again.",
          },
          { status: 503 }
        );
      }
      audit.error("chapter_draft_insert_failed", {
        chapterId: chapter.id,
        message: insertError?.message ?? "chapter_draft_insert_returned_no_row",
      });
      return NextResponse.json({ error: "Failed to store chapter draft" }, { status: 500 });
    }

    const inputTokens = nullIfUndefined(usage?.inputTokens);
    const outputTokens = nullIfUndefined(usage?.outputTokens);
    const estimatedCostUsd = estimateCostUsd(modelId, inputTokens, outputTokens);
    const costWarning = buildAnalysisCostThresholdWarning(estimatedCostUsd);
    if (costWarning) {
      audit.warn("chapter_draft_cost_threshold_exceeded", {
        chapterId: chapter.id,
        workspaceId: chapter.workspace_id,
        model: modelId,
        ...costWarning,
      });
    }

    audit.info("chapter_draft_created", {
      chapterId: chapter.id,
      rtpCycleId: chapter.rtp_cycle_id,
      workspaceId: chapter.workspace_id,
      model: modelId,
      inputTokens,
      outputTokens,
      groundedSentenceCount: grounding.grounded_sentence_count,
      totalSentenceCount: grounding.total_sentence_count,
      isFullyGrounded: grounding.is_fully_grounded,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(
      {
        draft,
        usage: {
          inputTokens,
          outputTokens,
          totalTokens: nullIfUndefined(usage?.totalTokens),
          estimatedCostUsd,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    audit.error("chapter_draft_unhandled_error", { error, durationMs: Date.now() - startedAt });
    return NextResponse.json({ error: "Unexpected error while drafting chapter" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("rtp_cycles.chapters.draft.review", request);
  const startedAt = Date.now();

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);
    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid RTP cycle chapter id" }, { status: 400 });
    }

    const payloadBody = await readJsonOrNullWithLimit(request, BODY_LIMITS.normalJson);
    if (!payloadBody.ok) return payloadBody.response;

    const parsedBody = reviewSchema.safeParse(payloadBody.data ?? null);
    if (!parsedBody.success) {
      audit.warn("validation_failed", { issues: parsedBody.error.issues });
      return NextResponse.json({ error: "Invalid draft review payload" }, { status: 400 });
    }

    const supabase = await createClient();
    const access = await resolveChapterAccess(supabase, audit, parsedParams.data);
    if (access.response || !access.chapter || !access.userId) {
      return access.response ?? NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const chapter = access.chapter;

    const { data: draftRow, error: draftError } = await supabase
      .from("document_narrative_drafts")
      .select(DRAFT_COLUMNS)
      .eq("id", parsedBody.data.draftId)
      .eq("target_kind", "rtp_chapter")
      .eq("target_id", chapter.id)
      .maybeSingle();

    if (draftError) {
      audit.error("draft_lookup_failed", {
        draftId: parsedBody.data.draftId,
        message: draftError.message,
        code: draftError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load chapter draft" }, { status: 500 });
    }

    const draft = parseStoredDraft(draftRow);
    if (!draft) {
      return NextResponse.json({ error: "Chapter draft not found" }, { status: 404 });
    }

    if (draft.status !== "draft") {
      return NextResponse.json(
        {
          error:
            draft.status === "dismissed"
              ? "This draft was dismissed; dismissal is terminal. Generate a new draft instead."
              : "This draft was already accepted. Generate a new draft to revise it.",
        },
        { status: 409 }
      );
    }

    // Chapter acceptance is PROVENANCE ONLY: the inserted text lands in the
    // operator's own editor and content_markdown remains the sole published
    // chapter content, so there is no as-is export gate here.
    const updates =
      parsedBody.data.action === "dismiss"
        ? { status: "dismissed" }
        : {
            status: "accepted",
            accepted_markdown: parsedBody.data.acceptedMarkdown ?? draft.draft_markdown,
            accepted_by: access.userId,
            accepted_at: new Date().toISOString(),
          };

    const { data: updatedRow, error: updateError } = await supabase
      .from("document_narrative_drafts")
      .update(updates)
      .eq("id", draft.id)
      .select(DRAFT_COLUMNS)
      .single();

    if (updateError || !updatedRow) {
      audit.error("draft_review_update_failed", {
        draftId: draft.id,
        message: updateError?.message ?? "draft_review_update_returned_no_row",
      });
      return NextResponse.json({ error: "Failed to update chapter draft" }, { status: 500 });
    }

    audit.info("chapter_draft_reviewed", {
      draftId: draft.id,
      chapterId: chapter.id,
      action: parsedBody.data.action,
      userId: access.userId,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ draft: updatedRow });
  } catch (error) {
    audit.error("draft_review_unhandled_error", { error, durationMs: Date.now() - startedAt });
    return NextResponse.json({ error: "Unexpected error while reviewing chapter draft" }, { status: 500 });
  }
}
