import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { generateText } from "ai";
import { anthropicModel, hasAnthropicAccess } from "@/lib/integrations/anthropic-access";
import { withWorkspaceIntegrationContext } from "@/lib/integrations/workspace-keys";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { checkAiUsageRateLimit, recordAiUsageEvent } from "@/lib/runtime/ai-rate-limit";
import { buildAnalysisCostThresholdWarning } from "@/lib/ai/cost-threshold";
import { validateGroundedNarrative } from "@/lib/planner-pack/grounding";
import {
  buildNarrativeFactList,
  factClaimTextMap,
  renderNarrativeFactPromptLines,
  summarizeNarrativeGrounding,
} from "@/lib/grants/narrative-grounding";
import { retrieveKnowledgeBaseExcerpts } from "@/lib/knowledge-base/retrieval";
import { buildKnowledgeBaseFactClaims, KB_NARRATIVE_CAVEAT } from "@/lib/grants/kb-evidence";
import {
  buildProjectFundingSnapshot,
  type FundingAwardLike,
  type FundingInvoiceLike,
  type FundingOpportunityLike,
  type ProjectFundingProfileLike,
} from "@/lib/projects/funding";
import { formatReportTypeLabel, sectionSupportsAiNarrative, titleize } from "@/lib/reports/catalog";
import {
  buildReportSectionFacts,
  factsHash,
  type ReportSectionFactsInput,
  type ReportSectionFactsRun,
} from "@/lib/reports/narrative-drafts";
import type { ReportCitedCountyRun, ReportCitedModelRun } from "@/lib/reports/html";

/**
 * POST /api/reports/[reportId]/narrative-draft — draft ONE whitelisted report
 * section as grounded prose for operator review.
 *
 * This route does not touch generation: the packet stays 100% deterministic,
 * and a draft stored here reaches an artifact only after an operator ACCEPTS
 * it (see the [draftId] PATCH route). The fact list is built by the same
 * deterministic assembly the generate route uses (`buildReportSectionFacts`),
 * every sentence must cite `[fact:N]` tokens, and the citation validation is
 * stored with the draft alongside a facts_hash so later generation can detect
 * that the underlying data moved.
 *
 * The workspace's own uploaded documents are part of that fact list too. A
 * Knowledge Base excerpt enters as a numbered fact carrying its source document,
 * page, and KB_NARRATIVE_CAVEAT verbatim — the same shape the grant narrative
 * path uses (`@/lib/grants/kb-evidence`) — so a board packet can cite the
 * agency's prior plans on exactly the terms a grant application can, and no
 * passage reaches the model outside the citation contract.
 *
 * v1 scope: PROJECT-targeted reports only. RTP-cycle packets assemble
 * operator-authored chapters (which have their own draft assist) and campaign
 * packets render engagement records directly — both answer 405 with a plain
 * statement instead of a silent skip.
 */

const DEFAULT_NARRATIVE_MODEL_ID = "claude-opus-4-8";

// Per-model pricing for the cost estimate (USD per million tokens). Unknown
// models (via OPENPLAN_ASSISTANT_MODEL) simply report a null estimate.
const MODEL_PRICING_USD_PER_MTOKEN: Record<string, { input: number; output: number }> = {
  "claude-opus-4-8": { input: 5.0, output: 25.0 },
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
};

const paramsSchema = z.object({
  reportId: z.string().uuid(),
});

const narrativeDraftRequestSchema = z.object({
  sectionKey: z.string().trim().min(1).max(80),
});

type RouteContext = {
  params: Promise<{ reportId: string }>;
};

function looksLikePendingSchema(message: string | null | undefined) {
  return /column .* does not exist|schema cache|relation .* does not exist/i.test(message ?? "");
}

async function safeOptionalQuery<T>(
  run: () => PromiseLike<{ data: T; error: { message: string; code?: string | null } | null }>,
  fallbackData: T
) {
  try {
    const result = await run();
    if (result.error && looksLikePendingSchema(result.error.message)) {
      return { data: fallbackData, error: null };
    }
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (looksLikePendingSchema(message)) {
      return { data: fallbackData, error: null };
    }
    throw error;
  }
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

export async function POST(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("reports.narrative-draft", request);
  const startedAt = Date.now();

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);
    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid report id" }, { status: 400 });
    }

    const payloadBody = await readJsonOrNullWithLimit(request, BODY_LIMITS.smallJson);
    if (!payloadBody.ok) return payloadBody.response;

    const parsedBody = narrativeDraftRequestSchema.safeParse(payloadBody.data ?? null);
    if (!parsedBody.success) {
      audit.warn("validation_failed", { issues: parsedBody.error.issues });
      return NextResponse.json({ error: "Invalid narrative draft payload" }, { status: 400 });
    }
    const sectionKey = parsedBody.data.sectionKey;

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let reportLookupResult = await supabase
      .from("reports")
      .select(
        "id, workspace_id, project_id, rtp_cycle_id, engagement_campaign_id, title, summary, report_type"
      )
      .eq("id", parsedParams.data.reportId)
      .maybeSingle();

    if (reportLookupResult.error && looksLikePendingSchema(reportLookupResult.error.message)) {
      reportLookupResult = await supabase
        .from("reports")
        .select("id, workspace_id, project_id, rtp_cycle_id, title, summary, report_type")
        .eq("id", parsedParams.data.reportId)
        .maybeSingle();
    }

    const { data: report, error: reportError } = reportLookupResult;

    if (reportError) {
      audit.error("report_lookup_failed", {
        reportId: parsedParams.data.reportId,
        message: reportError.message,
        code: reportError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to verify report" }, { status: 500 });
    }

    if (!report) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }

    const { data: membership, error: membershipError } = await supabase
      .from("workspace_members")
      .select("workspace_id, role")
      .eq("workspace_id", report.workspace_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (membershipError) {
      audit.error("membership_lookup_failed", {
        reportId: report.id,
        userId: user.id,
        message: membershipError.message,
        code: membershipError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to verify workspace access" }, { status: 500 });
    }

    if (!membership || !canAccessWorkspaceAction("report.generate", membership.role)) {
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    return await withWorkspaceIntegrationContext(report.workspace_id, async () => {
      // Inside the integration context on purpose: a workspace's own key
      // counts as AI access, so the offline gate must see it.
      if (!hasAnthropicAccess()) {
        audit.warn("ai_offline", {
          reportId: parsedParams.data.reportId,
          userId: user.id,
          durationMs: Date.now() - startedAt,
        });
        return NextResponse.json({ error: "ai_offline" }, { status: 503 });
      }
      // v1 target exclusions — stated, never silently skipped.
      if (report.rtp_cycle_id) {
        return NextResponse.json(
          {
            error:
              "AI narrative drafting supports project-targeted reports only in this version. RTP-cycle packets assemble operator-authored chapters — use the chapter draft assist on the RTP cycle page instead.",
          },
          { status: 405 }
        );
      }
      if (!report.project_id) {
        return NextResponse.json(
          {
            error:
              "AI narrative drafting supports project-targeted reports only in this version. Campaign-targeted packets render engagement records directly and are excluded.",
          },
          { status: 405 }
        );
      }

      if (!sectionSupportsAiNarrative(report.report_type, sectionKey)) {
        audit.warn("narrative_section_not_whitelisted", {
          reportId: report.id,
          reportType: report.report_type,
          sectionKey,
          userId: user.id,
        });
        return NextResponse.json(
          {
            error: `Section "${sectionKey}" does not accept an AI narrative draft for a ${formatReportTypeLabel(
              report.report_type
            )}. Only the whitelisted summary section of each packet type can be drafted.`,
          },
          { status: 400 }
        );
      }

      const rateLimit = await checkAiUsageRateLimit(report.workspace_id);
      if (!rateLimit.allowed) {
        audit.warn("narrative_draft_rate_limited", {
          reportId: report.id,
          workspaceId: report.workspace_id,
          userId: user.id,
          recentCount: rateLimit.count,
        });
        return NextResponse.json(
          { error: "Too many AI requests in a short window. Please wait a moment and try again." },
          { status: 429, headers: { "retry-after": String(rateLimit.retryAfterSeconds) } }
        );
      }

      // Deterministic source assembly — the same records the generate route
      // reads, narrowed to what the whitelisted sections state.
      const [
        projectResult,
        reportRunsResult,
        fundingProfileResult,
        fundingAwardsResult,
        fundingOpportunitiesResult,
        billingInvoicesResult,
      ] = await Promise.all([
        supabase
          .from("projects")
          .select("id, workspace_id, name, summary, status, plan_type, delivery_phase, updated_at")
          .eq("id", report.project_id)
          .maybeSingle(),
        safeOptionalQuery(
          () =>
            supabase
              .from("report_runs")
              .select("id, run_id, model_run_id, county_run_id, sort_order")
              .eq("report_id", report.id)
              .order("sort_order", { ascending: true }),
          [] as Array<Record<string, unknown>>
        ),
        safeOptionalQuery(
          () =>
            supabase
              .from("project_funding_profiles")
              .select("id, funding_need_amount, local_match_need_amount, updated_at")
              .eq("project_id", report.project_id)
              .maybeSingle(),
          null
        ),
        safeOptionalQuery(
          () =>
            supabase
              .from("funding_awards")
              .select("id, awarded_amount, match_amount, risk_flag, obligation_due_at, updated_at, created_at")
              .eq("project_id", report.project_id),
          [] as Array<Record<string, unknown>>
        ),
        safeOptionalQuery(
          () =>
            supabase
              .from("funding_opportunities")
              .select("id, expected_award_amount, decision_state, opportunity_status, closes_at, updated_at, created_at")
              .eq("project_id", report.project_id),
          [] as Array<Record<string, unknown>>
        ),
        safeOptionalQuery(
          () =>
            supabase
              .from("billing_invoice_records")
              .select("id, funding_award_id, status, amount, retention_percent, retention_amount, net_amount, due_date, invoice_date, created_at")
              .eq("project_id", report.project_id),
          [] as Array<Record<string, unknown>>
        ),
      ]);

      // Typed-evidence fallback: pre-migration databases answer the widened
      // report_runs select with a missing-column error.
      let reportRunLinksResult = reportRunsResult;
      if (reportRunLinksResult.error && looksLikePendingSchema(reportRunLinksResult.error.message)) {
        reportRunLinksResult = (await supabase
          .from("report_runs")
          .select("id, run_id, sort_order")
          .eq("report_id", report.id)
          .order("sort_order", { ascending: true })) as unknown as typeof reportRunLinksResult;
      }

      const loadErrors = [
        projectResult.error,
        reportRunLinksResult.error,
        fundingProfileResult.error,
        fundingAwardsResult.error,
        fundingOpportunitiesResult.error,
        billingInvoicesResult.error,
      ].filter(Boolean);

      if (loadErrors.length > 0 || !projectResult.data) {
        const firstError = loadErrors[0];
        audit.error("narrative_draft_load_failed", {
          reportId: report.id,
          message: firstError?.message ?? "Project not found",
          code: firstError?.code ?? null,
        });
        return NextResponse.json({ error: "Failed to load report source records" }, { status: 500 });
      }

      const reportRunLinkRows = (reportRunLinksResult.data ?? []) as Array<{
        run_id?: string | null;
        model_run_id?: string | null;
        county_run_id?: string | null;
      }>;
      const runIds = reportRunLinkRows
        .map((item) => item.run_id ?? null)
        .filter((value): value is string => Boolean(value));
      const citedModelRunIds = reportRunLinkRows
        .map((item) => item.model_run_id ?? null)
        .filter((value): value is string => Boolean(value));
      const citedCountyRunIds = reportRunLinkRows
        .map((item) => item.county_run_id ?? null)
        .filter((value): value is string => Boolean(value));

      const [runsResult, citedModelRunsResult, citedCountyRunsResult] = await Promise.all([
        runIds.length
          ? supabase
              .from("runs")
              .select("id, title, summary_text, metrics, created_at")
              .in("id", runIds)
          : Promise.resolve({ data: [], error: null }),
        citedModelRunIds.length
          ? safeOptionalQuery(
              () =>
                supabase
                  .from("model_runs")
                  .select("id, run_title, engine_key, status, result_summary_json")
                  .in("id", citedModelRunIds),
              [] as Array<Record<string, unknown>>
            )
          : Promise.resolve({ data: [] as Array<Record<string, unknown>>, error: null }),
        citedCountyRunIds.length
          ? safeOptionalQuery(
              () =>
                supabase
                  .from("county_runs")
                  .select("id, run_name, stage, validation_summary_json")
                  .in("id", citedCountyRunIds),
              [] as Array<Record<string, unknown>>
            )
          : Promise.resolve({ data: [] as Array<Record<string, unknown>>, error: null }),
      ]);

      if (runsResult.error || citedModelRunsResult.error || citedCountyRunsResult.error) {
        const firstRunError =
          runsResult.error ?? citedModelRunsResult.error ?? citedCountyRunsResult.error;
        audit.error("narrative_draft_runs_load_failed", {
          reportId: report.id,
          message: firstRunError?.message ?? "unknown",
          code: firstRunError?.code ?? null,
        });
        return NextResponse.json({ error: "Failed to load linked runs" }, { status: 500 });
      }

      const factsInput: ReportSectionFactsInput = {
        report: {
          title: report.title,
          summary: report.summary ?? null,
          report_type: report.report_type,
        },
        project: projectResult.data,
        runs: (runsResult.data ?? []) as ReportSectionFactsRun[],
        citedModelRuns: (citedModelRunsResult.data ?? []) as ReportCitedModelRun[],
        citedCountyRuns: (citedCountyRunsResult.data ?? []) as ReportCitedCountyRun[],
        projectFundingSnapshot: buildProjectFundingSnapshot({
          profile: fundingProfileResult.data as ProjectFundingProfileLike | null,
          awards: (fundingAwardsResult.data ?? []) as FundingAwardLike[],
          opportunities: (fundingOpportunitiesResult.data ?? []) as FundingOpportunityLike[],
          invoices: (billingInvoicesResult.data ?? []) as FundingInvoiceLike[],
          capturedAt: new Date().toISOString(),
          projectUpdatedAt: projectResult.data.updated_at,
        }),
      };

      const sectionFacts = buildReportSectionFacts(factsInput, sectionKey);

      // The hash fingerprints the DETERMINISTIC section facts only — the exact
      // list `buildReportSectionFacts` returns — because that is what the
      // generate route recomputes to decide whether an accepted block went
      // stale. Knowledge Base excerpts are retrieved at drafting time and the
      // packet does not render them, so folding them into the hash would mark
      // every accepted draft stale at the next generation with nothing having
      // changed: a permanent false alarm is not a safety belt. Which excerpts
      // were citable stays on the record regardless — the full fact list,
      // including every KB claim, is persisted in `grounding_json.facts`.
      const draftFactsHash = factsHash(sectionFacts);

      // Knowledge Base grounding: the agency's own uploaded plans and policies,
      // matched against this packet. Without this the same document could be
      // cited in a grant application (via the grants narrative evidence path)
      // and not in the agency's own board packet. Best-effort by contract —
      // retrieval answers [] when the KB schema or RPC is unavailable, which
      // costs the draft some citable facts and never invents one.
      const knowledgeBaseQuery = [
        report.title,
        report.summary,
        projectResult.data.name,
        projectResult.data.summary,
        titleize(sectionKey),
      ]
        .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
        .join(". ");
      const kbExcerpts = await retrieveKnowledgeBaseExcerpts({
        supabase,
        workspaceId: report.workspace_id,
        projectId: report.project_id,
        query: knowledgeBaseQuery,
        limit: 4,
      });
      const kbClaims = buildKnowledgeBaseFactClaims(kbExcerpts, projectResult.data.name);

      // One renumbered list so KB excerpts enter the SAME [fact:N] contract the
      // citation and numeric-faithfulness validation below runs over. A KB
      // passage handed to the model outside this list would be an ungrounded
      // claim in a document an agency publishes.
      const facts =
        kbClaims.length > 0
          ? buildNarrativeFactList([
              ...sectionFacts.map((fact) => fact.claim_text),
              ...kbClaims,
            ])
          : sectionFacts;
      const factIds = facts.map((fact) => fact.fact_id);

      const modelId = process.env.OPENPLAN_ASSISTANT_MODEL?.trim() || DEFAULT_NARRATIVE_MODEL_ID;

      const promptSections = [
        `Write the "${sectionKey}" narrative for the ${formatReportTypeLabel(report.report_type)} titled "${report.title}".`,
        "",
        "REQUIREMENTS:",
        "- Write 1-3 paragraphs of clear, professional planning-report prose in markdown (paragraphs only; no headings, no bullet lists).",
        "- Ground every statement STRICTLY in the numbered WORKSPACE FACTS below. Do not invent numbers, dollar amounts, dates, statuses, run results, or project details that are not present in the facts.",
        "- CITATIONS ARE MANDATORY: every sentence that states a workspace-specific fact MUST end with one or more inline citation tokens of the form [fact:fact_N] naming the fact(s) it draws on.",
        "- Only cite fact ids that appear in the WORKSPACE FACTS list. A purely transitional sentence may go uncited ONLY if it asserts nothing factual — when in doubt, prefer citing.",
        "- If a figure or fact is not provided, describe it qualitatively or note that it is still being documented — never fabricate it.",
        "- NEVER upgrade a claim: modeling and analysis facts below are screening-grade planning support. If a fact carries a caveat sentence, repeat that caveat verbatim in the same paragraph whenever you reference that fact, and never present screening results as forecasts, calibrated models, or decisions.",
        // Stated only when uploaded-document facts actually exist: an
        // instruction about facts that are not in the list below teaches the
        // model a caveat it has nothing to attach to.
        ...(kbClaims.length > 0
          ? [
              "- If (and only if) you reference the uploaded-document facts below, you MUST include the following caveat sentence verbatim in the same paragraph, attribute the content to the named document, and never present it as OpenPlan's own finding or as independently verified:",
              `  "${KB_NARRATIVE_CAVEAT}"`,
            ]
          : []),
        "- Do not promise outcomes, approvals, or awards; this draft supports an operator-reviewed packet and will not be included until a reviewer accepts it.",
        "",
        "WORKSPACE FACTS (the only citable claims; cite as [fact:fact_N]):",
        ...renderNarrativeFactPromptLines(facts),
      ].join("\n");

      let draftText: string;
      let usage: Awaited<ReturnType<typeof generateText>>["usage"] | undefined;

      try {
        const generation = await generateText({
          model: anthropicModel(modelId),
          maxOutputTokens: 1500,
          system:
            "You are a planning-report writer supporting a public transportation and planning agency. You draft short packet narratives from structured workspace records. You only use facts provided to you; you never fabricate figures, statuses, or outcomes, and you never upgrade screening-grade results into forecasts.",
          prompt: promptSections,
        });
        draftText = generation.text.trim();
        usage = generation.usage;
      } catch (generationError) {
        audit.error("narrative_generation_failed", {
          reportId: report.id,
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
        workspaceId: report.workspace_id,
        bucketKey: "document_narrative_draft",
        eventKey: "report_section_narrative_draft",
        sourceRoute: "/api/reports/[reportId]/narrative-draft",
        metadataJson: { model: modelId, sectionKey },
      });

      if (!draftText) {
        audit.error("narrative_generation_empty", {
          reportId: report.id,
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
        .from("document_narrative_drafts")
        .insert({
          workspace_id: report.workspace_id,
          target_kind: "report_section",
          target_id: report.id,
          section_key: sectionKey,
          draft_markdown: draftText,
          model: modelId,
          grounding_json: grounding,
          grounded_sentence_count: grounding.grounded_sentence_count,
          total_sentence_count: grounding.total_sentence_count,
          facts_hash: draftFactsHash,
          status: "draft",
          created_by: user.id,
        })
        .select(
          "id, target_kind, target_id, section_key, draft_markdown, model, grounding_json, grounded_sentence_count, total_sentence_count, facts_hash, status, accepted_markdown, accepted_by, accepted_at, created_at"
        )
        .single();

      if (insertError || !draft) {
        if (insertError && looksLikePendingSchema(insertError.message)) {
          return NextResponse.json(
            {
              error:
                "Narrative drafts cannot be stored yet: the document_narrative_drafts table is missing.",
              hint: "Apply migration 20260727000013_document_narrative_drafts, then draft again.",
            },
            { status: 503 }
          );
        }
        audit.error("narrative_draft_insert_failed", {
          reportId: report.id,
          userId: user.id,
          message: insertError?.message ?? "narrative_draft_insert_returned_no_row",
        });
        return NextResponse.json({ error: "Failed to store narrative draft" }, { status: 500 });
      }

      const inputTokens = nullIfUndefined(usage?.inputTokens);
      const outputTokens = nullIfUndefined(usage?.outputTokens);
      const estimatedCostUsd = estimateCostUsd(modelId, inputTokens, outputTokens);
      const costWarning = buildAnalysisCostThresholdWarning(estimatedCostUsd);
      if (costWarning) {
        audit.warn("narrative_draft_cost_threshold_exceeded", {
          reportId: report.id,
          workspaceId: report.workspace_id,
          model: modelId,
          inputTokens,
          outputTokens,
          ...costWarning,
        });
      }

      audit.info("narrative_draft_created", {
        reportId: report.id,
        sectionKey,
        userId: user.id,
        workspaceId: report.workspace_id,
        model: modelId,
        inputTokens,
        outputTokens,
        knowledgeBaseExcerptCount: kbExcerpts.length,
        knowledgeBaseFactCount: kbClaims.length,
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
    });
  } catch (error) {
    audit.error("narrative_draft_unhandled_error", { error, durationMs: Date.now() - startedAt });
    return NextResponse.json({ error: "Unexpected error while drafting narrative" }, { status: 500 });
  }
}
