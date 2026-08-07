import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { generateText } from "ai";
import { anthropicModel, hasAnthropicAccess } from "@/lib/integrations/anthropic-access";
import { withWorkspaceIntegrationContext } from "@/lib/integrations/workspace-keys";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadFundingOpportunityAccess } from "@/lib/programs/api";
import { loadOpportunityPursuitContext, withPursuitColumns } from "@/lib/grants/pursuit";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { GRANT_MODELING_PLANNING_CAVEAT } from "@/lib/grants/modeling-evidence";
import { BCA_NARRATIVE_CAVEAT } from "@/lib/bca/parameters";
import { ENGAGEMENT_NARRATIVE_CAVEAT } from "@/lib/grants/engagement-evidence";
import { validateGroundedNarrative } from "@/lib/planner-pack/grounding";
import { checkAiUsageRateLimit, recordAiUsageEvent } from "@/lib/runtime/ai-rate-limit";
import {
  factClaimTextMap,
  renderNarrativeFactPromptLines,
  summarizeNarrativeGrounding,
} from "@/lib/grants/narrative-grounding";
import {
  assembleOpportunityEvidence,
  buildOpportunityFactList,
} from "@/lib/grants/narrative-evidence";
import { KB_NARRATIVE_CAVEAT } from "@/lib/grants/kb-evidence";
import { looksLikePendingSchema } from "@/lib/supabase/pending-schema";

const DEFAULT_NARRATIVE_MODEL_ID = "claude-opus-4-8";

// Per-model pricing for the cost estimate (USD per million tokens). Unknown
// models (via OPENPLAN_GRANTS_AI_MODEL) simply report a null estimate.
const MODEL_PRICING_USD_PER_MTOKEN: Record<string, { input: number; output: number }> = {
  "claude-opus-4-8": { input: 5.0, output: 25.0 },
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
};

const paramsSchema = z.object({
  opportunityId: z.string().uuid(),
});

// The generate action takes no meaningful input yet; accept an empty JSON
// object (or an empty body) and reject anything else so future fields stay
// deliberate.
const narrativeDraftRequestSchema = z.object({}).strict().nullable();

type RouteContext = {
  params: Promise<{ opportunityId: string }>;
};

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

export async function POST(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("funding-opportunities.narrative-draft", request);
  const startedAt = Date.now();

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);
    if (!parsedParams.success) {
      audit.warn("params_validation_failed", { issues: parsedParams.error.issues });
      return NextResponse.json({ error: "Invalid funding opportunity id" }, { status: 400 });
    }

    const payloadBody = await readJsonOrNullWithLimit(request, BODY_LIMITS.smallJson);
    if (!payloadBody.ok) return payloadBody.response;

    const parsedBody = narrativeDraftRequestSchema.safeParse(payloadBody.data ?? null);
    if (!parsedBody.success) {
      audit.warn("validation_failed", { issues: parsedBody.error.issues });
      return NextResponse.json({ error: "Invalid narrative draft payload" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const access = await loadFundingOpportunityAccess(
      supabase,
      parsedParams.data.opportunityId,
      user.id,
      "programs.write"
    );

    if (access.error) {
      audit.error("funding_opportunity_access_failed", {
        opportunityId: parsedParams.data.opportunityId,
        userId: user.id,
        message: access.error.message,
        code: access.error.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load funding opportunity" }, { status: 500 });
    }

    if (!access.opportunity) {
      return NextResponse.json({ error: "Funding opportunity not found" }, { status: 404 });
    }

    if (!access.membership || !access.allowed) {
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    const opportunity = access.opportunity;

    return await withWorkspaceIntegrationContext(opportunity.workspace_id, async () => {
      // Inside the integration context on purpose: a workspace's own key
      // counts as AI access, so the offline gate must see it.
      if (!hasAnthropicAccess()) {
        audit.warn("ai_offline", {
          opportunityId: parsedParams.data.opportunityId,
          userId: user.id,
          durationMs: Date.now() - startedAt,
        });
        return NextResponse.json({ error: "ai_offline" }, { status: 503 });
      }
      const rateLimit = await checkAiUsageRateLimit(opportunity.workspace_id);
      if (!rateLimit.allowed) {
        audit.warn("narrative_draft_rate_limited", {
          opportunityId: opportunity.id,
          workspaceId: opportunity.workspace_id,
          userId: user.id,
          recentCount: rateLimit.count,
        });
        return NextResponse.json(
          { error: "Too many AI requests in a short window. Please wait a moment and try again." },
          { status: 429, headers: { "retry-after": String(rateLimit.retryAfterSeconds) } }
        );
      }

      // THE PURSUIT COLUMNS COME BACK ON HERE, and without this the draft was
      // wrong rather than merely thin. `loadFundingOpportunityAccess` selects a
      // fixed column list that omits all four, so `isProposal` was permanently
      // false on this route: a planner answering an RFP received a draft with no
      // solicitation number, no submission-format note, no questions-due date
      // and no past-performance grounding, and nothing said anything had been
      // dropped. The per-section drafter did this already; this door did not.
      // Found by the 2026-08-06 foundation audit (SWEEP_A3).
      const pursuit = await loadOpportunityPursuitContext(supabase, opportunity.id);
      if (pursuit.error) {
        audit.error("narrative_draft_pursuit_context_failed", {
          opportunityId: opportunity.id,
          userId: user.id,
          message: pursuit.error.message,
        });
        // A transient failure must not silently degrade a proposal into a grant.
        return NextResponse.json(
          { error: "Failed to load the opportunity's pursuit kind" },
          { status: 500 }
        );
      }

      // Load the linked project's funding summary + deterministic modeling /
      // BCA / engagement / KB evidence, mirroring what the grants page computes
      // (extracted to narrative-evidence.ts so the per-section drafting route
      // rebuilds the same facts fresh on every call).
      const evidence = await assembleOpportunityEvidence(
        supabase,
        withPursuitColumns(opportunity, pursuit.context)
      );

      // A FAILED EVIDENCE READ MAY NOT BECOME AN INSTRUCTION TO OMIT EVIDENCE.
      //
      // The prompt below turns an empty evidence family into a literal order to
      // the model — "Do not reference community input, public comments, or
      // outreach results", "Do not reference modeling or analysis results". That
      // order is honest ONLY when the read succeeded and genuinely found
      // nothing. A dropped column, an RLS change, or one transient failure
      // produces the identical empty value, and the draft that comes back has
      // the agency's Title VI outreach record and its modeling evidence deleted
      // out of a competitive federal grant application, with nobody told why.
      //
      // So this refuses instead. A missing draft is recoverable; a confidently
      // weakened application submitted to a funder is not.
      //
      // 500 RATHER THAN 503, INCLUDING FOR A PENDING SCHEMA: this endpoint's 503
      // already means `ai_offline`, and the panel that calls it maps 503 to
      // "AI drafting is offline". Answering a read failure with 503 here would
      // replace one wrong sentence with another, so the pending case is carried
      // in the message instead of the status.
      if (evidence.readFailures.length > 0) {
        const subjects = evidence.readFailures.map((failure) => failure.subject);
        const pending = evidence.readFailures.some((failure) => looksLikePendingSchema(failure.message));
        audit.error("narrative_evidence_read_failed", {
          opportunityId: opportunity.id,
          workspaceId: opportunity.workspace_id,
          userId: user.id,
          failedReads: evidence.readFailures,
          durationMs: Date.now() - startedAt,
        });
        return NextResponse.json(
          {
            error: `Could not draft a narrative: OpenPlan could not read ${subjects.join(", ")}. This is a read failure, not an empty result — drafting now would tell the model to leave out evidence this workspace may hold. ${
              pending
                ? "This deployment looks mid-upgrade; apply the latest Supabase migrations, then try again."
                : "Try again in a moment."
            }`,
            failedReads: subjects,
          },
          { status: 500 }
        );
      }

      const { fundingSummary, bcaScreening, engagementEvidence, kbExcerpts } = evidence;

      const modelId = process.env.OPENPLAN_GRANTS_AI_MODEL?.trim() || DEFAULT_NARRATIVE_MODEL_ID;

      // Numbered fact list (fact_1..fact_N): every workspace-specific claim the
      // model is allowed to state, in citable form. The generated narrative must
      // cite these with inline [fact:N] tokens; the citations are validated
      // deterministically after generation (planner-pack grounding contract).
      const hasModelingEvidence = Boolean(evidence.modelingHeadline && evidence.modelingReadinessDetail);
      const facts = buildOpportunityFactList(evidence);
      const factIds = facts.map((fact) => fact.fact_id);

      const promptSections = [
        "Write a grant-application need and readiness narrative for the funding opportunity described below.",
        "",
        "REQUIREMENTS:",
        "- Write 3-5 paragraphs of professional grant-narrative prose in markdown (paragraphs only; no headings, no bullet lists).",
        "- Ground every statement STRICTLY in the numbered WORKSPACE FACTS below. Do not invent numbers, dollar amounts, dates, deadlines, commitments, partners, or project details that are not present in the facts.",
        "- CITATIONS ARE MANDATORY: every sentence that states a workspace-specific fact MUST end with one or more inline citation tokens of the form [fact:fact_N] naming the fact(s) it draws on, e.g. \"The project carries a documented funding need. [fact:fact_3]\".",
        "- Only cite fact ids that appear in the WORKSPACE FACTS list. A purely transitional sentence may go uncited ONLY if it asserts nothing factual — when in doubt, prefer citing.",
        "- If a figure or fact is not provided, describe it qualitatively or note that it is still being documented — never fabricate it.",
        "- If (and only if) you reference the modeling evidence or model results below, you MUST include the following caveat sentence verbatim in the same paragraph:",
        `  "${GRANT_MODELING_PLANNING_CAVEAT}"`,
        "- If (and only if) you reference the benefit-cost screening facts below, you MUST include the following caveat sentence verbatim in the same paragraph, and you must describe the results as screening-level — never as an application benefit-cost analysis:",
        `  "${BCA_NARRATIVE_CAVEAT}"`,
        "- If (and only if) you reference the community-engagement facts below, you MUST include the following caveat sentence verbatim in the same paragraph, and you must never describe comment counts or sentiment as community consensus, a survey result, or completed public-participation requirements:",
        `  "${ENGAGEMENT_NARRATIVE_CAVEAT}"`,
        "- If (and only if) you reference the uploaded-document facts below, you MUST include the following caveat sentence verbatim in the same paragraph, attribute the content to the named document, and never present it as OpenPlan's own finding or as independently verified:",
        `  "${KB_NARRATIVE_CAVEAT}"`,
        "- Do not promise awards, eligibility determinations, or fiscal compliance; this draft supports an operator-reviewed application.",
        "",
        "WORKSPACE FACTS (the only citable claims; cite as [fact:fact_N]):",
        ...renderNarrativeFactPromptLines(facts),
        "",
        fundingSummary
          ? "A linked project funding stack backs the facts above."
          : "No project is linked to this opportunity. Ground the narrative in the opportunity-record facts only.",
        hasModelingEvidence
          ? "Modeling-evidence facts above are deterministic, computed from stored reports, and screening-grade."
          : bcaScreening
            ? "No comparison-backed travel-demand modeling packet is visible for this project. Do not reference travel-demand model or forecasting results; the benefit-cost screening facts above are the only analysis you may cite, and only as screening-level."
            : "No comparison-backed modeling packet or benefit-cost screening is visible for this project. Do not reference modeling or analysis results.",
        engagementEvidence
          ? "Community-engagement facts above summarize a saved synthesis of submitted public comments. Cite them only as screening-level community input."
          : "No engagement campaign is linked to this project. Do not reference community input, public comments, or outreach results.",
        kbExcerpts.length > 0
          ? "Uploaded-document facts above are verbatim excerpts from this workspace's Knowledge Base, matched by keyword; cite them only as uploaded-document content attributed to the named document, never as OpenPlan analysis or a verified finding."
          : "No Knowledge Base documents matched this opportunity; do not reference uploaded documents.",
      ].join("\n");

      let draftText: string;
      let usage: Awaited<ReturnType<typeof generateText>>["usage"] | undefined;

      try {
        const generation = await generateText({
          model: anthropicModel(modelId),
          maxOutputTokens: 2000,
          system:
            "You are a grant writer supporting a small public transportation and planning agency. You draft need/readiness narratives for funding applications. You only use facts provided to you; you never fabricate figures, commitments, or outcomes.",
          prompt: promptSections,
        });
        draftText = generation.text.trim();
        usage = generation.usage;
      } catch (generationError) {
        audit.error("narrative_generation_failed", {
          opportunityId: opportunity.id,
          userId: user.id,
          model: modelId,
          message: generationError instanceof Error ? generationError.message : String(generationError),
        });
        return NextResponse.json({ error: "narrative_generation_failed" }, { status: 502 });
      }

      // Fire-and-forget spend metering: the model call succeeded (a thrown
      // generation returned 502 above without recording, so a user retry after a
      // failure is never double-counted).
      void recordAiUsageEvent({
        workspaceId: opportunity.workspace_id,
        bucketKey: "grant_narrative_draft",
        eventKey: "grant_narrative_draft",
        sourceRoute: "/api/funding-opportunities/[opportunityId]/narrative-draft",
        metadataJson: { model: modelId },
      });

      if (!draftText) {
        audit.error("narrative_generation_empty", {
          opportunityId: opportunity.id,
          userId: user.id,
          model: modelId,
        });
        return NextResponse.json({ error: "narrative_generation_failed" }, { status: 502 });
      }

      // Deterministic per-sentence citation validation (annotated mode keeps
      // every sentence and flags ungrounded ones for operator review; the raw
      // draft with its [fact:N] tokens is what gets stored).
      const grounding = summarizeNarrativeGrounding(
        validateGroundedNarrative(draftText, factIds, "annotated", factClaimTextMap(facts)),
        facts
      );

      const { data: draft, error: insertError } = await supabase
        .from("funding_opportunity_narrative_drafts")
        .insert({
          workspace_id: opportunity.workspace_id,
          opportunity_id: opportunity.id,
          draft_markdown: draftText,
          model: modelId,
          source: "ai",
          created_by: user.id,
          grounding_json: grounding,
          grounded_sentence_count: grounding.grounded_sentence_count,
          total_sentence_count: grounding.total_sentence_count,
        })
        .select(
          "id, opportunity_id, draft_markdown, model, source, created_at, grounding_json, grounded_sentence_count, total_sentence_count"
        )
        .single();

      if (insertError || !draft) {
        audit.error("narrative_draft_insert_failed", {
          opportunityId: opportunity.id,
          userId: user.id,
          message: insertError?.message ?? "narrative_draft_insert_returned_no_row",
        });
        return NextResponse.json({ error: "Failed to store narrative draft" }, { status: 500 });
      }

      const inputTokens = nullIfUndefined(usage?.inputTokens);
      const outputTokens = nullIfUndefined(usage?.outputTokens);

      audit.info("narrative_draft_created", {
        opportunityId: opportunity.id,
        userId: user.id,
        workspaceId: opportunity.workspace_id,
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
            estimatedCostUsd: estimateCostUsd(modelId, inputTokens, outputTokens),
          },
        },
        { status: 201 }
      );
    });
  } catch (error) {
    audit.error("narrative_draft_unhandled_error", { error, durationMs: Date.now() - startedAt });
    return NextResponse.json({ error: "Unexpected error while drafting narrative" }, { status: 500 });
  }
}
