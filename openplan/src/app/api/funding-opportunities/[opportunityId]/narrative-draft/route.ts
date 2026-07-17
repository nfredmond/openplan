import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadFundingOpportunityAccess } from "@/lib/programs/api";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import {
  GRANT_MODELING_PLANNING_CAVEAT,
  buildProjectGrantModelingEvidenceByProjectId,
  describeProjectGrantModelingReadiness,
  type ProjectGrantModelingArtifactRow,
  type ProjectGrantModelingEvidence,
  type ProjectGrantModelingReportRow,
} from "@/lib/grants/modeling-evidence";
import {
  buildGrantEvidenceReadinessCues,
  summarizeGrantEvidenceReadiness,
} from "@/lib/grants/evidence-readiness";
import {
  buildProjectFundingStackSummary,
  type ProjectFundingStackSummary,
} from "@/lib/projects/funding";

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

function formatAmount(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function describeFundingSummary(summary: ProjectFundingStackSummary, projectName: string | null): string {
  return [
    `Project: ${projectName ?? "(unnamed project)"}`,
    `Funding posture: ${summary.label} — ${summary.reason}`,
    `Pipeline posture: ${summary.pipelineLabel} — ${summary.pipelineReason}`,
    `Funding need: ${summary.hasTargetNeed ? formatAmount(summary.fundingNeedAmount) : "not recorded"}`,
    `Local match need: ${summary.localMatchNeedAmount > 0 ? formatAmount(summary.localMatchNeedAmount) : "not recorded"}`,
    `Committed award dollars: ${formatAmount(summary.committedFundingAmount)} across ${summary.awardCount} award record(s)`,
    `Pursued (likely) opportunity dollars: ${formatAmount(summary.likelyFundingAmount)} across ${summary.pursuedOpportunityCount} pursued opportunit(ies)`,
    `Remaining gap after committed + pursued dollars: ${formatAmount(summary.unfundedAfterLikelyAmount)}`,
    `Reimbursement posture: ${summary.reimbursementLabel} — ${summary.reimbursementReason}`,
  ].join("\n");
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

    // Load the linked project's funding summary + deterministic modeling
    // evidence, mirroring what the grants page computes.
    let projectName: string | null = null;
    let fundingSummary: ProjectFundingStackSummary | null = null;
    let modelingReadinessDetail: string | null = null;
    let modelingHeadline: string | null = null;
    let modelingEvidence: ProjectGrantModelingEvidence | null = null;

    if (opportunity.project_id) {
      const [projectResult, profileResult, awardsResult, projectOpportunitiesResult, invoicesResult, reportsResult] =
        await Promise.all([
          supabase
            .from("projects")
            .select("id, name")
            .eq("id", opportunity.project_id)
            .maybeSingle(),
          supabase
            .from("project_funding_profiles")
            .select("project_id, funding_need_amount, local_match_need_amount, notes, updated_at")
            .eq("project_id", opportunity.project_id)
            .maybeSingle(),
          supabase
            .from("funding_awards")
            .select("id, awarded_amount, match_amount, risk_flag, obligation_due_at, updated_at, created_at")
            .eq("project_id", opportunity.project_id),
          supabase
            .from("funding_opportunities")
            .select("id, expected_award_amount, decision_state, opportunity_status, closes_at, updated_at, created_at")
            .eq("project_id", opportunity.project_id),
          supabase
            .from("billing_invoice_records")
            .select("id, funding_award_id, status, due_date, amount, retention_percent, retention_amount, net_amount")
            .eq("project_id", opportunity.project_id),
          supabase
            .from("reports")
            .select("id, project_id, title, updated_at, generated_at, latest_artifact_kind")
            .eq("project_id", opportunity.project_id)
            .order("updated_at", { ascending: false }),
        ]);

      projectName = (projectResult.data as { id: string; name: string } | null)?.name ?? null;

      type NarrativeInvoiceRow = {
        funding_award_id: string | null;
        status: string | null;
        due_date: string | null;
        amount: number | string | null;
        retention_percent: number | string | null;
        retention_amount: number | string | null;
        net_amount: number | string | null;
      };
      const awardLinkedInvoices = ((invoicesResult.data ?? []) as NarrativeInvoiceRow[]).filter(
        (invoice) => Boolean(invoice.funding_award_id)
      );

      fundingSummary = buildProjectFundingStackSummary(
        profileResult.data ?? null,
        awardsResult.data ?? [],
        projectOpportunitiesResult.data ?? [],
        awardLinkedInvoices
      );

      const reports = (reportsResult.data ?? []) as ProjectGrantModelingReportRow[];
      const reportIds = reports.map((report) => report.id);
      const { data: artifactsData } = reportIds.length
        ? await supabase
            .from("report_artifacts")
            .select("report_id, generated_at, metadata_json")
            .in("report_id", reportIds)
            .order("generated_at", { ascending: false })
        : { data: [] };

      modelingEvidence =
        buildProjectGrantModelingEvidenceByProjectId(
          reports,
          (artifactsData ?? []) as ProjectGrantModelingArtifactRow[]
        ).get(opportunity.project_id) ?? null;

      const readiness = describeProjectGrantModelingReadiness(modelingEvidence);
      modelingReadinessDetail = readiness ? `${readiness.label}: ${readiness.detail}` : null;
      modelingHeadline = modelingEvidence
        ? `${modelingEvidence.leadComparisonReport.title} — ${modelingEvidence.leadComparisonReport.comparisonDigest.headline}. ${modelingEvidence.leadComparisonReport.comparisonDigest.detail}`
        : null;
    }

    const evidenceCues = buildGrantEvidenceReadinessCues(
      {
        fit_notes: opportunity.fit_notes ?? null,
        readiness_notes: opportunity.readiness_notes ?? null,
        decision_rationale: opportunity.decision_rationale ?? null,
        expected_award_amount: opportunity.expected_award_amount ?? null,
        project_id: opportunity.project_id ?? null,
        program_id: opportunity.program_id ?? null,
        closes_at: opportunity.closes_at ?? null,
        decision_due_at: opportunity.decision_due_at ?? null,
      },
      modelingEvidence
    );
    const evidenceReadinessSummary = summarizeGrantEvidenceReadiness(evidenceCues);

    const modelId = process.env.OPENPLAN_GRANTS_AI_MODEL?.trim() || DEFAULT_NARRATIVE_MODEL_ID;

    const promptSections = [
      "Write a grant-application need and readiness narrative for the funding opportunity described below.",
      "",
      "REQUIREMENTS:",
      "- Write 3-5 paragraphs of professional grant-narrative prose in markdown (paragraphs only; no headings, no bullet lists).",
      "- Ground every statement STRICTLY in the data provided below. Do not invent numbers, dollar amounts, dates, deadlines, commitments, partners, or project details that are not present in the data.",
      "- If a figure or fact is not provided, describe it qualitatively or note that it is still being documented — never fabricate it.",
      "- If (and only if) you reference the modeling evidence or model results below, you MUST include the following caveat sentence verbatim in the same paragraph:",
      `  "${GRANT_MODELING_PLANNING_CAVEAT}"`,
      "- Do not promise awards, eligibility determinations, or fiscal compliance; this draft supports an operator-reviewed application.",
      "",
      "FUNDING OPPORTUNITY:",
      `Title: ${opportunity.title}`,
      `Administering agency: ${opportunity.agency_name ?? "not recorded"}`,
      `Status: ${opportunity.opportunity_status}; decision posture: ${opportunity.decision_state}`,
      `Expected award amount: ${opportunity.expected_award_amount != null ? formatAmount(Number(opportunity.expected_award_amount)) : "not recorded"}`,
      `Summary: ${opportunity.summary ?? "not recorded"}`,
      `Fit notes: ${opportunity.fit_notes ?? "not recorded"}`,
      `Readiness notes: ${opportunity.readiness_notes ?? "not recorded"}`,
      `Decision rationale: ${opportunity.decision_rationale ?? "not recorded"}`,
      "",
      "LINKED PROJECT FUNDING SUMMARY:",
      fundingSummary
        ? describeFundingSummary(fundingSummary, projectName)
        : "No project is linked to this opportunity. Ground the narrative in the opportunity record only.",
      "",
      "MODELING EVIDENCE (deterministic, computed from stored reports):",
      modelingHeadline && modelingReadinessDetail
        ? [modelingHeadline, modelingReadinessDetail].join("\n")
        : "No comparison-backed modeling packet is visible for this opportunity's project. Do not reference modeling or analysis results.",
      "",
      "EVIDENCE READINESS (deterministic guardrail summary):",
      evidenceReadinessSummary,
    ].join("\n");

    let draftText: string;
    let usage: Awaited<ReturnType<typeof generateText>>["usage"] | undefined;

    try {
      const generation = await generateText({
        model: anthropic(modelId),
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

    if (!draftText) {
      audit.error("narrative_generation_empty", {
        opportunityId: opportunity.id,
        userId: user.id,
        model: modelId,
      });
      return NextResponse.json({ error: "narrative_generation_failed" }, { status: 502 });
    }

    const { data: draft, error: insertError } = await supabase
      .from("funding_opportunity_narrative_drafts")
      .insert({
        workspace_id: opportunity.workspace_id,
        opportunity_id: opportunity.id,
        draft_markdown: draftText,
        model: modelId,
        source: "ai",
        created_by: user.id,
      })
      .select("id, opportunity_id, draft_markdown, model, source, created_at")
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
  } catch (error) {
    audit.error("narrative_draft_unhandled_error", { error, durationMs: Date.now() - startedAt });
    return NextResponse.json({ error: "Unexpected error while drafting narrative" }, { status: 500 });
  }
}
