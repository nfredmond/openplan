import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadFundingOpportunityAccess } from "@/lib/programs/api";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { GRANT_MODELING_PLANNING_CAVEAT } from "@/lib/grants/modeling-evidence";
import { BCA_NARRATIVE_CAVEAT } from "@/lib/bca/parameters";
import { ENGAGEMENT_NARRATIVE_CAVEAT } from "@/lib/grants/engagement-evidence";
import { KB_NARRATIVE_CAVEAT } from "@/lib/grants/kb-evidence";
import { validateGroundedNarrative } from "@/lib/planner-pack/grounding";
import { checkAiUsageRateLimit, recordAiUsageEvent } from "@/lib/runtime/ai-rate-limit";
import { buildAnalysisCostThresholdWarning } from "@/lib/ai/cost-threshold";
import {
  factClaimTextMap,
  renderNarrativeFactPromptLines,
  summarizeNarrativeGrounding,
} from "@/lib/grants/narrative-grounding";
import {
  assembleOpportunityEvidence,
  buildOpportunityFactList,
} from "@/lib/grants/narrative-evidence";
import {
  APPLICATION_PENDING_SCHEMA_ERROR,
  APPLICATION_SECTION_DRAFT_SELECT,
  APPLICATION_SECTION_SELECT,
  looksLikePendingAssemblySchema,
  parseApplicationSectionRow,
} from "@/lib/grants/application";
import { loadOpportunityPursuitContext } from "@/lib/grants/pursuit";
import type { GrantApplicationEvidenceKind } from "@/lib/grants/program-catalog";

const DEFAULT_NARRATIVE_MODEL_ID = "claude-opus-4-8";

// Per-model pricing for the cost estimate (USD per million tokens). Unknown
// models (via OPENPLAN_GRANTS_AI_MODEL) simply report a null estimate.
const MODEL_PRICING_USD_PER_MTOKEN: Record<string, { input: number; output: number }> = {
  "claude-opus-4-8": { input: 5.0, output: 25.0 },
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
};

const EVIDENCE_KIND_LABELS: Record<GrantApplicationEvidenceKind, string> = {
  project: "the opportunity and project record",
  funding: "the project funding stack",
  modeling: "the screening-grade modeling packet",
  bca: "the screening benefit-cost analysis",
  engagement: "the community-engagement synthesis",
  kb: "uploaded Knowledge Base documents",
};

const paramsSchema = z.object({
  opportunityId: z.string().uuid(),
  sectionId: z.string().uuid(),
});

// A draft call optionally revises a stored prior draft. The instructions are
// styling/emphasis input only — the citable facts are REBUILT FRESH from
// workspace evidence on every call, so instructions can reshape prose but can
// never smuggle a new claim past the deterministic validation.
const sectionDraftRequestSchema = z
  .object({
    revisionOfDraftId: z.string().uuid().optional(),
    instructions: z.string().trim().min(1).max(1000).optional(),
  })
  .strict()
  .nullable();

type RouteContext = {
  params: Promise<{ opportunityId: string; sectionId: string }>;
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
  const audit = createApiAuditLogger("funding-opportunities.sections.draft", request);
  const startedAt = Date.now();

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);
    if (!parsedParams.success) {
      audit.warn("params_validation_failed", { issues: parsedParams.error.issues });
      return NextResponse.json({ error: "Invalid section path" }, { status: 400 });
    }

    const payloadBody = await readJsonOrNullWithLimit(request, BODY_LIMITS.smallJson);
    if (!payloadBody.ok) return payloadBody.response;

    const parsedBody = sectionDraftRequestSchema.safeParse(payloadBody.data ?? null);
    if (!parsedBody.success) {
      audit.warn("validation_failed", { issues: parsedBody.error.issues });
      return NextResponse.json({ error: "Invalid section draft payload" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!process.env.ANTHROPIC_API_KEY?.trim()) {
      audit.warn("ai_offline", {
        opportunityId: parsedParams.data.opportunityId,
        userId: user.id,
        durationMs: Date.now() - startedAt,
      });
      return NextResponse.json({ error: "ai_offline" }, { status: 503 });
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

    const rateLimit = await checkAiUsageRateLimit(opportunity.workspace_id);
    if (!rateLimit.allowed) {
      audit.warn("section_draft_rate_limited", {
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

    const { data: sectionRow, error: sectionError } = await supabase
      .from("funding_opportunity_application_sections")
      .select(APPLICATION_SECTION_SELECT)
      .eq("id", parsedParams.data.sectionId)
      .eq("opportunity_id", opportunity.id)
      .maybeSingle();

    if (sectionError) {
      if (looksLikePendingAssemblySchema(sectionError.message)) {
        return NextResponse.json({ error: APPLICATION_PENDING_SCHEMA_ERROR }, { status: 503 });
      }
      return NextResponse.json({ error: "Failed to load section" }, { status: 500 });
    }

    if (!sectionRow) {
      return NextResponse.json({ error: "Section not found" }, { status: 404 });
    }

    const section = parseApplicationSectionRow(sectionRow);
    if (!section) {
      return NextResponse.json({ error: "Stored section row is malformed" }, { status: 500 });
    }

    // The never-AI rule: budget figures, cost estimates, fee schedules, and
    // certifications are operator/finance work products. A section pinned
    // non-draftable refuses generation outright — there is no override.
    if (!section.ai_drafting_enabled) {
      audit.warn("section_not_ai_draftable", {
        opportunityId: opportunity.id,
        sectionId: section.id,
        sectionKey: section.section_key,
        userId: user.id,
      });
      return NextResponse.json(
        {
          error: "section_not_ai_draftable",
          message:
            "This section is never AI-drafted (budget, fee, or certification content). Its text comes from your own estimates, records, and signatories.",
        },
        { status: 422 }
      );
    }

    // Revision base: must be a stored draft of THIS section.
    let priorDraftMarkdown: string | null = null;
    const revisionOfDraftId = parsedBody.data?.revisionOfDraftId ?? null;
    if (revisionOfDraftId) {
      const { data: priorDraft, error: priorError } = await supabase
        .from("funding_opportunity_section_drafts")
        .select("id, section_id, draft_markdown")
        .eq("id", revisionOfDraftId)
        .eq("section_id", section.id)
        .maybeSingle();

      if (priorError) {
        return NextResponse.json({ error: "Failed to load revision base draft" }, { status: 500 });
      }
      if (!priorDraft) {
        return NextResponse.json(
          { error: "Revision base draft not found for this section" },
          { status: 422 }
        );
      }
      priorDraftMarkdown = (priorDraft as { draft_markdown: string }).draft_markdown;
    }

    const instructions = parsedBody.data?.instructions ?? null;

    // Pursuit context decides which evidence a section can ground on: a
    // proposal pursuit additionally grounds on its solicitation fields, the
    // linked project's stage data, and the workspace's completed-projects
    // history. A pending pursuit schema truthfully resolves to 'grant'.
    const pursuit = await loadOpportunityPursuitContext(supabase, opportunity.id);
    if (pursuit.error) {
      audit.error("section_draft_pursuit_context_failed", {
        opportunityId: opportunity.id,
        sectionId: section.id,
        userId: user.id,
        message: pursuit.error.message,
      });
      return NextResponse.json(
        { error: "Failed to load the opportunity's pursuit kind" },
        { status: 500 }
      );
    }
    const pursuitKind = pursuit.context.pursuitKind;

    // Facts are REBUILT FRESH from live workspace evidence on every call —
    // including revisions. The prior draft is style input only; if the
    // evidence changed since it was written, the new fact list (not the old
    // prose) is what the revision may cite.
    const evidence = await assembleOpportunityEvidence(
      supabase,
      {
        ...opportunity,
        pursuit_kind: pursuitKind,
        solicitation_number: pursuit.context.solicitationNumber,
        submission_format_note: pursuit.context.submissionFormatNote,
        questions_due_at: pursuit.context.questionsDueAt,
      },
      {
        knowledgeBaseQueryHint: [section.title, section.guidance]
          .filter((part): part is string => Boolean(part && part.trim()))
          .join(". "),
      }
    );

    const scopedKinds = section.suggested_evidence;
    const included = (kind: GrantApplicationEvidenceKind) =>
      scopedKinds.length === 0 || scopedKinds.includes(kind);

    const facts = buildOpportunityFactList(evidence, {
      suggestedEvidence: scopedKinds.length > 0 ? scopedKinds : undefined,
    });
    const factIds = facts.map((fact) => fact.fact_id);

    const hasModelingFacts =
      included("modeling") && Boolean(evidence.modelingHeadline && evidence.modelingReadinessDetail);
    const hasBcaFacts = included("bca") && Boolean(evidence.bcaScreening);
    const hasEngagementFacts = included("engagement") && Boolean(evidence.engagementEvidence);
    const hasKbFacts = included("kb") && evidence.kbExcerpts.length > 0;
    const hasFundingFacts = included("funding") && Boolean(evidence.fundingSummary);

    const modelId = process.env.OPENPLAN_GRANTS_AI_MODEL?.trim() || DEFAULT_NARRATIVE_MODEL_ID;

    const emphasisKinds = (scopedKinds.length > 0 ? scopedKinds : []).map(
      (kind) => EVIDENCE_KIND_LABELS[kind]
    );

    const promptSections = [
      pursuitKind === "proposal"
        ? `Write the "${section.title}" section of a proposal (RFP/RFQ response) for the pursuit described below.`
        : `Write the "${section.title}" application section for the funding opportunity described below.`,
      "",
      ...(section.guidance
        ? [
            "SECTION GUIDANCE (orientation only — the funder's current NOFO/guidelines control what this section must contain):",
            section.guidance,
            "",
          ]
        : []),
      ...(emphasisKinds.length > 0
        ? [
            `EVIDENCE EMPHASIS: this section usually draws on ${emphasisKinds.join(", ")}. The WORKSPACE FACTS below are scoped accordingly.`,
            "",
          ]
        : []),
      ...(priorDraftMarkdown !== null
        ? [
            "PRIOR DRAFT (you are revising this text; keep the [fact:fact_N] citation discipline, and drop any claim that no longer appears in the WORKSPACE FACTS below):",
            priorDraftMarkdown,
            "",
            "REVISION INSTRUCTIONS FROM THE OPERATOR:",
            instructions ?? "(none provided — improve clarity and flow without changing the substance.)",
            "",
          ]
        : instructions
          ? ["OPERATOR INSTRUCTIONS:", instructions, ""]
          : []),
      "REQUIREMENTS:",
      "- Write 1-4 paragraphs of professional grant-application prose in markdown (paragraphs only; no headings, no bullet lists).",
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
      hasFundingFacts
        ? "A linked project funding stack backs the facts above."
        : "No project funding facts are in scope for this section. Do not state funding amounts or funding posture.",
      hasModelingFacts
        ? "Modeling-evidence facts above are deterministic, computed from stored reports, and screening-grade."
        : hasBcaFacts
          ? "No comparison-backed travel-demand modeling packet is in scope. Do not reference travel-demand model or forecasting results; the benefit-cost screening facts above are the only analysis you may cite, and only as screening-level."
          : "No modeling packet or benefit-cost screening is in scope for this section. Do not reference modeling or analysis results.",
      hasEngagementFacts
        ? "Community-engagement facts above summarize a saved synthesis of submitted public comments. Cite them only as screening-level community input."
        : "No engagement facts are in scope for this section. Do not reference community input, public comments, or outreach results.",
      hasKbFacts
        ? "Uploaded-document facts above are verbatim excerpts from this workspace's Knowledge Base, matched by keyword; cite them only as uploaded-document content attributed to the named document, never as OpenPlan analysis or a verified finding."
        : "No Knowledge Base documents are in scope for this section; do not reference uploaded documents.",
    ].join("\n");

    let draftText: string;
    let usage: Awaited<ReturnType<typeof generateText>>["usage"] | undefined;

    try {
      const generation = await generateText({
        model: anthropic(modelId),
        maxOutputTokens: 2000,
        system:
          "You are a grant writer supporting a small public transportation and planning agency. You draft individual sections of funding applications. You only use facts provided to you; you never fabricate figures, commitments, or outcomes.",
        prompt: promptSections,
      });
      draftText = generation.text.trim();
      usage = generation.usage;
    } catch (generationError) {
      audit.error("section_draft_generation_failed", {
        opportunityId: opportunity.id,
        sectionId: section.id,
        userId: user.id,
        model: modelId,
        message: generationError instanceof Error ? generationError.message : String(generationError),
      });
      return NextResponse.json({ error: "section_draft_generation_failed" }, { status: 502 });
    }

    if (!draftText) {
      audit.error("section_draft_generation_empty", {
        opportunityId: opportunity.id,
        sectionId: section.id,
        userId: user.id,
        model: modelId,
      });
      return NextResponse.json({ error: "section_draft_generation_failed" }, { status: 502 });
    }

    // Fire-and-forget spend metering: the model call succeeded (a thrown
    // generation returned 502 above without recording, so a user retry after a
    // failure is never double-counted).
    void recordAiUsageEvent({
      workspaceId: opportunity.workspace_id,
      bucketKey: "grant_narrative_draft",
      eventKey: "grant_section_draft",
      sourceRoute: "/api/funding-opportunities/[opportunityId]/sections/[sectionId]/draft",
      metadataJson: { model: modelId, sectionId: section.id },
    });

    const grounding = summarizeNarrativeGrounding(
      validateGroundedNarrative(draftText, factIds, "annotated", factClaimTextMap(facts)),
      facts
    );

    const { data: draft, error: insertError } = await supabase
      .from("funding_opportunity_section_drafts")
      .insert({
        workspace_id: opportunity.workspace_id,
        opportunity_id: opportunity.id,
        section_id: section.id,
        draft_markdown: draftText,
        model: modelId,
        grounding_json: grounding,
        grounded_sentence_count: grounding.grounded_sentence_count,
        total_sentence_count: grounding.total_sentence_count,
        revision_of: revisionOfDraftId,
        revision_instructions: instructions,
        created_by: user.id,
      })
      .select(APPLICATION_SECTION_DRAFT_SELECT)
      .single();

    if (insertError || !draft) {
      audit.error("section_draft_insert_failed", {
        opportunityId: opportunity.id,
        sectionId: section.id,
        userId: user.id,
        message: insertError?.message ?? "section_draft_insert_returned_no_row",
      });
      return NextResponse.json({ error: "Failed to store section draft" }, { status: 500 });
    }

    // Best-effort status bump: a first draft moves the section into
    // 'drafting'; later states (operator_review, final) are operator moves
    // and are never regressed by generating another draft.
    if (section.status === "not_started") {
      await supabase
        .from("funding_opportunity_application_sections")
        .update({ status: "drafting", updated_by: user.id, updated_at: new Date().toISOString() })
        .eq("id", section.id)
        .eq("opportunity_id", opportunity.id);
    }

    const inputTokens = nullIfUndefined(usage?.inputTokens);
    const outputTokens = nullIfUndefined(usage?.outputTokens);
    const estimatedCostUsd = estimateCostUsd(modelId, inputTokens, outputTokens);

    const costWarning = buildAnalysisCostThresholdWarning(estimatedCostUsd);
    if (costWarning) {
      audit.warn("section_draft_cost_threshold_exceeded", {
        opportunityId: opportunity.id,
        sectionId: section.id,
        workspaceId: opportunity.workspace_id,
        model: modelId,
        inputTokens,
        outputTokens,
        estimatedCostUsd,
        thresholdUsd: costWarning.thresholdUsd,
      });
    }

    audit.info("section_draft_created", {
      opportunityId: opportunity.id,
      sectionId: section.id,
      userId: user.id,
      workspaceId: opportunity.workspace_id,
      model: modelId,
      inputTokens,
      outputTokens,
      revisionOf: revisionOfDraftId,
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
          costWarning,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    audit.error("section_draft_unhandled_error", { error, durationMs: Date.now() - startedAt });
    return NextResponse.json({ error: "Unexpected error while drafting section" }, { status: 500 });
  }
}
