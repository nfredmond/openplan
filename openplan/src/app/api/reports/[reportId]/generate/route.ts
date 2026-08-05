import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { assistantActionAuditIdentity, recordAssistantActionExecution } from "@/lib/observability/action-audit";
import { verifyAssistantActionApproval } from "@/lib/assistant/action-approval-server";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import { BODY_LIMITS, readJsonWithLimit } from "@/lib/http/body-limit";
import {
  checkMonthlyRunCap,
  isRunCapExceeded,
  isRunCapLookupError,
  RUN_WEIGHTS,
} from "@/lib/config/run-cap";
import { buildSourceTransparency } from "@/lib/analysis/source-transparency";
import { evaluateReportArtifactGate } from "@/lib/stage-gates/report-artifacts";
import { loadCountyRunModelingEvidence } from "@/lib/models/evidence-backbone";
import { buildRtpExportHtml, normalizeRtpLinkedProjects } from "@/lib/rtp/export";
import { buildRtpCycleReadiness, buildRtpCycleWorkflowSummary, buildRtpPublicReviewSummary } from "@/lib/rtp/catalog";
import {
  buildPortfolioFundingSnapshot,
  buildProjectFundingProfileScan,
  buildProjectFundingSnapshot,
  buildProjectFundingStackSummary,
} from "@/lib/projects/funding";
import { getRtpPacketPresetAlignment } from "@/lib/reports/catalog";
import {
  looksLikePendingStageGateProjectScope,
  PROJECT_STAGE_GATE_DECISION_COLUMNS,
  type ProjectStageGateDecisionRow,
} from "@/lib/stage-gates/decision-queries";
import {
  buildProjectStageGateSnapshot,
  buildProjectStageGateSummary,
} from "@/lib/stage-gates/summary";
import {
  buildReportEngagementSummary,
  buildReportEngagementSynthesis,
  extractEngagementHandoffProvenance,
  extractEngagementCampaignId,
} from "@/lib/reports/engagement";
import {
  buildCampaignReportHtml,
  buildReportHtml,
  CAMPAIGN_NOT_APPLICABLE_SECTION_KEYS,
} from "@/lib/reports/html";
import { renderReportPdf, type ReportPdfEngine } from "@/lib/reports/pdf";
import { buildEvidenceChainSummary } from "@/lib/reports/evidence-chain";
import { summarizeEngagementItems } from "@/lib/engagement/summary";
import { loadSentimentHotspots, negativeItemIdsFromSyntheses } from "@/lib/engagement/hotspots";
import { loadSelfReportedDemographicsSource } from "@/lib/engagement/demographics";
import type { EngagementSynthesis } from "@/lib/engagement/ai-synthesis";
import type { CampaignRepresentativeness } from "@/lib/engagement/representativeness";
import {
  loadReportScenarioSetLinks,
  type ReportScenarioSupabaseLike,
} from "@/lib/reports/scenario-provenance";
import {
  extractReportModelingEvidenceClaimStatuses,
  summarizeReportModelingEvidenceForMetadata,
  type ReportModelingEvidence,
} from "@/lib/reports/modeling-evidence";
import {
  buildAcceptedSectionNarratives,
  buildReportSectionFacts,
  factsHash,
  type ReportSectionFactsInput,
  type ReportSectionFactsRun,
} from "@/lib/reports/narrative-drafts";
import {
  buildReportAerialEvidenceReadFailureContext,
  buildReportAerialEvidenceSourceContext,
} from "@/lib/reports/aerial-source-context";
// Aerial rows are loaded through the aerial module's own provider, never a raw
// `.from("aerial_missions")` here — see the separability boundary in
// `src/lib/aerial/public.ts`.
import { loadAerialSourceContextRowsForProject } from "@/lib/aerial/queries";
import type { ReportCitedCountyRun, ReportCitedModelRun } from "@/lib/reports/html";
import { withCitedModelRunClaimTiers } from "@/lib/reports/run-citations";
import { looksLikePendingSchema } from "@/lib/supabase/pending-schema";
import { classifyRouteReadFailure } from "@/lib/http/read-outcome";

/**
 * A read whose ABSENCE is honest when the schema is genuinely not there: no
 * table means no rows, so substituting the empty fallback states nothing the
 * deployment has not established.
 *
 * THE `Unexpected table:` BRANCH IS GONE, and its removal is the point. That
 * phrasing is not a database message — it is the string this route's own test
 * harness throws for a table its `from()` double does not know about
 * (`throw new Error(\`Unexpected table: ${table}\`)`). Production code was
 * classifying a TEST FIXTURE'S wording as a benign absence, which had two costs:
 * any real thrown error containing that phrase would have been laundered into an
 * empty result, and — the one that actually bit — the accepted-narrative read
 * (`document_narrative_drafts`) was never mocked at all, so every test in this
 * file exercised it as "no accepted narratives" while believing it had exercised
 * the feature. A harness that cannot fail a named read proves nothing about the
 * failure path, and this branch is what made that harness impossible.
 *
 * The remaining classification is `looksLikePendingSchema` alone. Its widening
 * (see `src/lib/supabase/pending-schema.ts`) does reach this wrapper: a missing
 * TABLE now classifies here where the older reports-route pattern only matched a
 * missing column. That direction is accepted for the reads still routed through
 * here — a missing table means the rows genuinely do not exist — but it is NOT
 * accepted for anything the packet TOTALS or COUNTS. Those reads were moved off
 * this wrapper below and refuse instead, because a total is a number a reader
 * cannot see a gap in.
 */
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

const paramsSchema = z.object({
  reportId: z.string().uuid(),
});

const REPORT_GENERATE_MAX_BODY_BYTES = BODY_LIMITS.documentJson;

const generateSchema = z.object({
  format: z.enum(["html", "pdf"]).default("html"),
});

type RouteContext = {
  params: Promise<{ reportId: string }>;
};

type ProjectRecordSnapshotEntry = {
  count: number;
  latestTitle: string | null;
  latestAt: string | null;
};

type FundingSourceContextReadinessStatus = "ready" | "attention" | "blocked";

const FUNDING_SOURCE_CONTEXT_OPERATOR_CAVEAT =
  "Operator review required. This funding/source-context scan supports planning packet review only; it is not legal compliance automation, award prediction, or autonomous approval.";

type ReportCountyRunEvidenceRow = {
  id: string;
  workspace_id: string;
  run_name: string | null;
  geography_label: string | null;
  stage: string | null;
  updated_at: string | null;
};

type ReportsGenerateSupabase = Awaited<ReturnType<typeof createClient>>;
type ReportsGenerateAudit = Pick<ReturnType<typeof createApiAuditLogger>, "warn">;

type ArtifactHistoryEntry = {
  artifactId: string;
  artifactKind: string;
  generatedAt: string;
  generatedBy: string;
  generationMode: string;
  sourceContextSummary: {
    reportOrigin: string | null;
    reportReason: string | null;
    linkedRunCount: number | null;
    modelingEvidenceCount: number | null;
    engagementItemCount: number | null;
  };
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function buildArtifactHistoryEntry(input: {
  artifactId: string;
  artifactKind: string;
  generatedAt: string;
  generatedBy: string;
  generationMode: string;
  sourceContext: Record<string, unknown>;
}): ArtifactHistoryEntry {
  const numberOrNull = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
  const stringOrNull = (value: unknown) => (typeof value === "string" && value.trim().length > 0 ? value : null);

  return {
    artifactId: input.artifactId,
    artifactKind: input.artifactKind,
    generatedAt: input.generatedAt,
    generatedBy: input.generatedBy,
    generationMode: input.generationMode,
    sourceContextSummary: {
      reportOrigin: stringOrNull(input.sourceContext.reportOrigin),
      reportReason: stringOrNull(input.sourceContext.reportReason),
      linkedRunCount: numberOrNull(input.sourceContext.linkedRunCount),
      modelingEvidenceCount: numberOrNull(input.sourceContext.modelingEvidenceCount),
      engagementItemCount: numberOrNull(input.sourceContext.engagementItemCount),
    },
  };
}

function appendArtifactHistory(metadata: unknown, entry: ArtifactHistoryEntry) {
  const metadataRecord = asRecord(metadata) ?? {};
  const existingHistory = Array.isArray(metadataRecord.artifactHistory)
    ? metadataRecord.artifactHistory.filter((item) => asRecord(item))
    : [];

  return {
    ...metadataRecord,
    artifactHistory: [...existingHistory, entry].slice(-10),
  };
}

function maxTimestamp(values: Array<string | null | undefined>) {
  const timestamps = values
    .map((value) => (value ? new Date(value).getTime() : Number.NaN))
    .filter((value) => Number.isFinite(value));

  if (timestamps.length === 0) {
    return null;
  }

  return new Date(Math.max(...timestamps)).toISOString();
}

function buildProjectRecordSnapshot(entries: {
  deliverables: Array<{ title: string; due_date: string | null; created_at: string }>;
  risks: Array<{ title: string; created_at: string }>;
  issues: Array<{ title: string; created_at: string }>;
  decisions: Array<{ title: string; decided_at: string | null; created_at: string }>;
  meetings: Array<{ title: string; meeting_at: string | null; created_at: string }>;
}) {
  const buildEntry = <T extends { title: string; created_at: string }>(
    items: T[],
    getAt: (item: T) => string | null
  ): ProjectRecordSnapshotEntry => ({
    count: items.length,
    latestTitle: items[0]?.title ?? null,
    latestAt: items[0] ? getAt(items[0]) : null,
  });

  return {
    deliverables: buildEntry(entries.deliverables, (item) => item.due_date ?? item.created_at),
    risks: buildEntry(entries.risks, (item) => item.created_at),
    issues: buildEntry(entries.issues, (item) => item.created_at),
    decisions: buildEntry(entries.decisions, (item) => item.decided_at ?? item.created_at),
    meetings: buildEntry(entries.meetings, (item) => item.meeting_at ?? item.created_at),
  };
}

function hasReadyScenarioComparisonEvidence(
  scenarioSetLinks: Array<{
    comparisonSummary?: { readyAlternatives?: number } | null;
    matchedEntries?: Array<{ comparisonReady?: boolean }> | null;
    comparisonSnapshots?: Array<{ status?: string; sourceContext?: { exportReady?: boolean } | null }> | null;
  }>
) {
  return scenarioSetLinks.some((link) => {
    if ((link.comparisonSummary?.readyAlternatives ?? 0) > 0) {
      return true;
    }

    if ((link.matchedEntries ?? []).some((entry) => entry.comparisonReady === true)) {
      return true;
    }

    return (link.comparisonSnapshots ?? []).some(
      (snapshot) => snapshot.status === "ready" || snapshot.sourceContext?.exportReady === true
    );
  });
}

function buildFundingSourceContextReadiness(input: {
  hasComparisonEvidence: boolean;
  linkedRunCount: number;
  modelingEvidenceCount: number;
  engagementReadyForHandoffCount: number;
  stageGateHoldCount?: number;
  fundingScanStatus?: string | null;
}) {
  const stageGateHoldCount = input.stageGateHoldCount ?? 0;
  const sourceEvidenceCount =
    (input.hasComparisonEvidence ? 1 : 0) +
    input.linkedRunCount +
    input.modelingEvidenceCount +
    input.engagementReadyForHandoffCount;
  const fundingBlocked = input.fundingScanStatus === "blocked" || input.fundingScanStatus === "not_started";

  let status: FundingSourceContextReadinessStatus = "ready";
  let label = "Funding source context ready for operator review";
  let detail =
    "Generation captured funding posture together with linked analysis, scenario, engagement, and governance context for a supervised review packet.";

  if (fundingBlocked || stageGateHoldCount > 0) {
    status = "blocked";
    label = "Funding source context has review blockers";
    detail =
      "Generation captured the funding scan, but unresolved funding setup or governance holds must be reviewed before relying on the packet outside OpenPlan.";
  } else if (sourceEvidenceCount === 0 || input.fundingScanStatus === "attention") {
    status = "attention";
    label = "Funding source context needs operator review";
    detail =
      "Generation captured the funding scan, but source context is incomplete or mixed; keep grant and RTP language provisional until an operator reviews the basis.";
  }

  return {
    capturedAt: new Date().toISOString(),
    status,
    label,
    detail,
    hasComparisonEvidence: input.hasComparisonEvidence,
    linkedRunCount: input.linkedRunCount,
    modelingEvidenceCount: input.modelingEvidenceCount,
    engagementReadyForHandoffCount: input.engagementReadyForHandoffCount,
    stageGateHoldCount,
    fundingScanStatus: input.fundingScanStatus ?? null,
    operatorReviewCaveat: FUNDING_SOURCE_CONTEXT_OPERATOR_CAVEAT,
  };
}

function summarizeRtpFundingProfileScanReadiness(
  scans: Array<{ scan: { status: string; label: string; nextAction: string } }>,
  input: {
    modelingEvidenceCount: number;
    engagementReadyForHandoffCount: number;
    enabledSectionCount: number;
  }
) {
  const blockedCount = scans.filter(
    (item) => item.scan.status === "blocked" || item.scan.status === "not_started"
  ).length;
  const attentionCount = scans.filter((item) => item.scan.status === "attention").length;
  const readyCount = scans.filter((item) => item.scan.status === "ready").length;

  let status: FundingSourceContextReadinessStatus = "ready";
  let label = "RTP funding source context ready for operator review";
  let detail =
    "Generation captured linked-project funding scans, cycle readiness, public-review posture, and packet source context for supervised RTP review.";

  if (blockedCount > 0) {
    status = "blocked";
    label = "RTP funding source context has project blockers";
    detail = `${blockedCount} linked project funding scan${blockedCount === 1 ? "" : "s"} need setup or blocker resolution before the RTP funding basis is used outside OpenPlan.`;
  } else if (attentionCount > 0 || scans.length === 0) {
    status = "attention";
    label = "RTP funding source context needs operator review";
    detail = scans.length === 0
      ? "No linked project funding scans were available when this RTP artifact was generated."
      : `${attentionCount} linked project funding scan${attentionCount === 1 ? "" : "s"} need operator review before strong RTP funding language is reused.`;
  }

  return {
    capturedAt: new Date().toISOString(),
    status,
    label,
    detail,
    linkedProjectScanCount: scans.length,
    readyProjectScanCount: readyCount,
    attentionProjectScanCount: attentionCount,
    blockedProjectScanCount: blockedCount,
    modelingEvidenceCount: input.modelingEvidenceCount,
    engagementReadyForHandoffCount: input.engagementReadyForHandoffCount,
    enabledSectionCount: input.enabledSectionCount,
    operatorReviewCaveat: FUNDING_SOURCE_CONTEXT_OPERATOR_CAVEAT,
  };
}

/**
 * The result of trying to read the modeling evidence a packet reports on —
 * RETURNED, not decided here.
 *
 * WHY THIS SHAPE. Every read below used to be answered with `audit.warn()` and
 * an empty list, and the two are not the same act. The warning is something an
 * OPERATOR may find in host logs; the empty list becomes
 * `modelingEvidenceCount: 0` in the artifact record and "0 modeling evidence
 * item(s)" in the RTP packet's funding readiness line — a sentence a board or a
 * funder reads as established fact about the agency's own modeling work. A count
 * derived from a read that failed is a falsehood no downstream reader can see
 * the gap in, because zero looks exactly like zero.
 *
 * So this loader follows the seam the rest of the repo already uses for library
 * reads (`loadOpportunityPursuitContext`, `loadSurveyDefinition`): it neither
 * swallows nor throws. It hands the failure up, and the ROUTE decides whether a
 * document may be produced.
 */
type ReportModelingEvidenceRead = {
  items: ReportModelingEvidence[];
  error: { message: string; code: string | null } | null;
};

async function loadReportModelingEvidence(input: {
  supabase: ReportsGenerateSupabase;
  audit: ReportsGenerateAudit;
  reportId: string;
  workspaceId: string;
  modelingCountyRunId?: string | null;
  auditEventPrefix: "rtp_modeling" | "report_modeling";
}): Promise<ReportModelingEvidenceRead> {
  const { supabase, audit, reportId, workspaceId, modelingCountyRunId, auditEventPrefix } = input;
  let countyRuns: ReportCountyRunEvidenceRow[] = [];

  if (modelingCountyRunId) {
    // BOTH county-run reads here are deliberately NOT wrapped in
    // `safeOptionalQuery`. These rows are what the evidence count is counted
    // FROM, so substituting the empty fallback for a classified failure answers
    // "there is no modeling evidence" on the strength of a query that never ran.
    // A missing COLUMN on an existing `county_runs` table is the realistic case,
    // and there the runs are sitting right there while the packet prints zero.
    // The report even names this run explicitly — `modeling_county_run_id` — so
    // the packet would be contradicting its own report record.
    const countyRunResult = await supabase
      .from("county_runs")
      .select("id, workspace_id, run_name, geography_label, stage, updated_at")
      .eq("id", modelingCountyRunId)
      .maybeSingle();

    if (countyRunResult.error) {
      audit.warn(`${auditEventPrefix}_county_run_lookup_failed`, {
        reportId,
        workspaceId,
        countyRunId: modelingCountyRunId,
        message: countyRunResult.error.message,
        code: countyRunResult.error.code ?? null,
      });
      return {
        items: [],
        error: { message: countyRunResult.error.message, code: countyRunResult.error.code ?? null },
      };
    }

    if (!countyRunResult.data) {
      // A SUCCESSFUL read that found nothing. The linked run is genuinely gone,
      // and "no modeling evidence" is a fact this path established.
      audit.warn(`${auditEventPrefix}_county_run_missing`, {
        reportId,
        workspaceId,
        countyRunId: modelingCountyRunId,
      });
    } else if (countyRunResult.data.workspace_id !== workspaceId) {
      audit.warn(`${auditEventPrefix}_county_run_workspace_mismatch`, {
        reportId,
        workspaceId,
        countyRunId: modelingCountyRunId,
        countyRunWorkspaceId: countyRunResult.data.workspace_id,
      });
    } else {
      countyRuns = [countyRunResult.data];
    }
  } else {
    const countyRunsResult = await supabase
      .from("county_runs")
      .select("id, workspace_id, run_name, geography_label, stage, updated_at")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false })
      .limit(5);

    if (countyRunsResult.error) {
      audit.warn(`${auditEventPrefix}_county_runs_lookup_failed`, {
        reportId,
        workspaceId,
        message: countyRunsResult.error.message,
        code: countyRunsResult.error.code ?? null,
      });
      return {
        items: [],
        error: { message: countyRunsResult.error.message, code: countyRunsResult.error.code ?? null },
      };
    }

    countyRuns = (countyRunsResult.data ?? []) as ReportCountyRunEvidenceRow[];
  }

  const evidenceReads = await Promise.all(
    countyRuns.map(async (countyRun) => {
      const evidenceResult = await loadCountyRunModelingEvidence({
        supabase,
        countyRunId: countyRun.id,
        track: "assignment",
      });

      if (evidenceResult.error) {
        audit.warn(`${auditEventPrefix}_evidence_lookup_failed`, {
          reportId,
          workspaceId,
          countyRunId: countyRun.id,
          message: evidenceResult.error.message,
          code: evidenceResult.error.code ?? null,
          missingSchema: evidenceResult.error.missingSchema ?? false,
        });
      }

      return { countyRun, evidenceResult };
    })
  );

  // `evidence: null` reads in the packet as "this run carries no claim decision,
  // no source manifests, and no validation checks" — which is the honesty
  // firewall's own vocabulary, stated about a run whose evidence nobody could
  // read. It is the worst of the three shapes here, so it refuses too.
  const failedEvidenceRead = evidenceReads.find((read) => read.evidenceResult.error)?.evidenceResult.error;

  if (failedEvidenceRead) {
    return {
      items: [],
      error: { message: failedEvidenceRead.message, code: failedEvidenceRead.code ?? null },
    };
  }

  return {
    items: evidenceReads.map(({ countyRun, evidenceResult }) => ({
      countyRunId: countyRun.id,
      runName: countyRun.run_name,
      geographyLabel: countyRun.geography_label,
      stage: countyRun.stage,
      updatedAt: countyRun.updated_at,
      evidence: evidenceResult.evidence,
    })),
    error: null,
  };
}

/**
 * One refusal for both packet branches, so the RTP path and the project path
 * cannot drift into disagreeing about whether an unreadable evidence table is
 * fatal. A pending migration answers 503 (come back after migrating); anything
 * else answers 500 (this deployment cannot describe what happened) — never a 200
 * carrying a count nobody established.
 */
function classifyModelingEvidenceReadFailure(read: ReportModelingEvidenceRead) {
  return classifyRouteReadFailure("the modeling evidence this packet reports on", read, {
    pendingError: "This packet's modeling evidence cannot be read yet",
    pendingHint:
      "Apply the latest Supabase migrations, then generate again. Generating without them would print a modeling-evidence count this deployment never established.",
  });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("reports.generate", request);
  const startedAt = Date.now();

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);

    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid report id" }, { status: 400 });
    }

    const bodyRead = await readJsonWithLimit(request, REPORT_GENERATE_MAX_BODY_BYTES);
    if (!bodyRead.ok) {
      audit.warn("request_body_too_large", {
        reportId: parsedParams.data.reportId,
        byteLength: bodyRead.byteLength,
        maxBytes: REPORT_GENERATE_MAX_BODY_BYTES,
      });
      return bodyRead.response;
    }

    const payload = bodyRead.data ?? {};
    const parsed = generateSchema.safeParse(payload);

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid generation request" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let reportLookupResult = await supabase
      .from("reports")
      .select("id, workspace_id, project_id, rtp_cycle_id, engagement_campaign_id, modeling_county_run_id, title, summary, report_type, status, created_at, generated_at, metadata_json")
      .eq("id", parsedParams.data.reportId)
      .maybeSingle();

    if (reportLookupResult.error && looksLikePendingSchema(reportLookupResult.error.message)) {
      // The campaign-target column (migration 20260727000008) is the newest;
      // retry without it before falling back to the oldest column set.
      reportLookupResult = await supabase
        .from("reports")
        .select("id, workspace_id, project_id, rtp_cycle_id, modeling_county_run_id, title, summary, report_type, status, created_at, generated_at, metadata_json")
        .eq("id", parsedParams.data.reportId)
        .maybeSingle();
    }

    if (reportLookupResult.error && looksLikePendingSchema(reportLookupResult.error.message)) {
      reportLookupResult = await supabase
        .from("reports")
        .select("id, workspace_id, project_id, rtp_cycle_id, title, summary, report_type, status, created_at, generated_at")
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

    // The workspace billing lookup that stood here is gone with the plan
    // concept: report generation is free, so there was nothing for it to
    // decide and it cost a round trip on every export.
    const runCap = await checkMonthlyRunCap(supabase, {
      workspaceId: report.workspace_id,
      tableName: "runs",
      weight: RUN_WEIGHTS.DEFAULT,
    });

    if (isRunCapLookupError(runCap)) {
      audit.error("run_cap_count_failed", {
        workspaceId: report.workspace_id,
        userId: user.id,
        message: runCap.message,
        code: runCap.code,
      });
      return NextResponse.json({ error: "Failed to validate the run limit" }, { status: 500 });
    }

    if (isRunCapExceeded(runCap)) {
      audit.warn("run_cap_reached", {
        workspaceId: report.workspace_id,
        userId: user.id,
        usedRuns: runCap.usedRuns,
        cap: runCap.cap,
      });
      return NextResponse.json({ error: runCap.message }, { status: 429 });
    }

    if (report.rtp_cycle_id) {
      const modelingEvidencePromise = loadReportModelingEvidence({
        supabase,
        audit,
        reportId: report.id,
        workspaceId: report.workspace_id,
        modelingCountyRunId: report.modeling_county_run_id,
        auditEventPrefix: "rtp_modeling",
      });
      const [workspaceResult, cycleResult, sectionsResult, chaptersResult, linksResult, campaignsResult] = await Promise.all([
        supabase.from("workspaces").select("id, name").eq("id", report.workspace_id).maybeSingle(),
        supabase
          .from("rtp_cycles")
          .select(
            "id, workspace_id, title, status, geography_label, horizon_start_year, horizon_end_year, adoption_target_date, public_review_open_at, public_review_close_at, summary, updated_at"
          )
          .eq("id", report.rtp_cycle_id)
          .maybeSingle(),
        supabase
          .from("report_sections")
          .select("id, section_key, title, enabled, sort_order, config_json")
          .eq("report_id", report.id)
          .order("sort_order", { ascending: true }),
        supabase
          .from("rtp_cycle_chapters")
          .select("id, title, section_type, status, summary, guidance, content_markdown, sort_order")
          .eq("rtp_cycle_id", report.rtp_cycle_id)
          .order("sort_order", { ascending: true }),
        supabase
          .from("project_rtp_cycle_links")
          .select("id, project_id, portfolio_role, priority_rationale, projects(id, name, status, delivery_phase, summary, updated_at)")
          .eq("rtp_cycle_id", report.rtp_cycle_id)
          .order("created_at", { ascending: false }),
        supabase
          .from("engagement_campaigns")
          .select("id, title, status, engagement_type, summary, rtp_cycle_chapter_id")
          .eq("rtp_cycle_id", report.rtp_cycle_id)
          .order("updated_at", { ascending: false }),
      ]);

      const loadErrors = [
        workspaceResult.error,
        cycleResult.error,
        sectionsResult.error,
        chaptersResult.error,
        linksResult.error,
        campaignsResult.error,
      ].filter(Boolean);

      if (loadErrors.length > 0 || !cycleResult.data) {
        const firstError = loadErrors[0];
        audit.error("rtp_report_generation_load_failed", {
          reportId: report.id,
          message: firstError?.message ?? "RTP cycle not found",
          code: firstError?.code ?? null,
        });
        return NextResponse.json({ error: "Failed to load RTP packet source records" }, { status: 500 });
      }

      const cycle = cycleResult.data;
      const sections = sectionsResult.data ?? [];
      const chapters = chaptersResult.data ?? [];
      const linkedProjects = normalizeRtpLinkedProjects(linksResult.data ?? []);
      const campaigns = campaignsResult.data ?? [];
      // The packet prints "N modeling evidence item(s)" in its funding readiness
      // line and freezes `modelingEvidenceCount` into the artifact record. A
      // failed read reaching either as 0 tells a board the cycle has no modeling
      // basis — so the generation refuses instead, in the same shape as the
      // funding and engagement gates above it.
      const modelingEvidenceRead = await modelingEvidencePromise;
      const modelingEvidenceFailure = classifyModelingEvidenceReadFailure(modelingEvidenceRead);

      if (modelingEvidenceFailure) {
        audit.error("rtp_report_modeling_evidence_load_failed", {
          reportId: report.id,
          message: modelingEvidenceFailure.message,
          pendingSchema: modelingEvidenceFailure.pending,
        });
        return NextResponse.json(modelingEvidenceFailure.body, { status: modelingEvidenceFailure.status });
      }

      const modelingEvidence = modelingEvidenceRead.items;
      const modelingEvidenceMetadata = summarizeReportModelingEvidenceForMetadata(modelingEvidence);
      const modelingEvidenceClaimStatuses = extractReportModelingEvidenceClaimStatuses(modelingEvidence);
      const linkedProjectIds = linkedProjects
        .map((link) => link.project?.id ?? null)
        .filter((value): value is string => Boolean(value));
      const [fundingProfilesResult, fundingAwardsResult, fundingOpportunitiesResult, billingInvoicesResult] =
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

      // Same gate as the source records above, and for a sharper reason: these
      // four reads are TOTALLED into the packet's funding snapshot. A failure
      // read as `?? []` does not leave a gap a reader could notice — it prints
      // $0 committed and a fully unfunded portfolio, under the agency's name, in
      // a document a funder or a board keeps. Refuse the generation instead.
      const fundingLoadErrors = [
        fundingProfilesResult.error,
        fundingAwardsResult.error,
        fundingOpportunitiesResult.error,
        billingInvoicesResult.error,
      ].filter(Boolean);

      if (fundingLoadErrors.length > 0) {
        const firstError = fundingLoadErrors[0];
        audit.error("rtp_report_funding_load_failed", {
          reportId: report.id,
          message: firstError?.message ?? "unknown",
          code: firstError?.code ?? null,
        });
        return NextResponse.json({ error: "Failed to load RTP packet funding records" }, { status: 500 });
      }

      const fundingProfileByProjectId = new Map(
        ((fundingProfilesResult.data ?? []) as Array<{ project_id: string; funding_need_amount: number | null; local_match_need_amount: number | null; updated_at: string | null }>).map((profile) => [profile.project_id, profile])
      );
      const fundingAwardsByProjectId = new Map<string, Array<{ awarded_amount: number | string | null; match_amount: number | string | null; risk_flag: string | null; obligation_due_at: string | null; updated_at: string | null; created_at: string | null }>>();
      const fundingOpportunitiesByProjectId = new Map<string, Array<{ expected_award_amount: number | string | null; decision_state: string | null; opportunity_status: string | null; closes_at: string | null; updated_at: string | null; created_at: string | null }>>();
      const fundingInvoicesByProjectId = new Map<string, Array<{ status: string | null; amount: number | string | null; retention_percent: number | string | null; retention_amount: number | string | null; net_amount: number | string | null; due_date: string | null; invoice_date: string | null; created_at: string | null }>>();
      for (const award of (fundingAwardsResult.data ?? []) as Array<{ project_id: string; awarded_amount: number | string | null; match_amount: number | string | null; risk_flag: string | null; obligation_due_at: string | null; updated_at: string | null; created_at: string | null }>) {
        const current = fundingAwardsByProjectId.get(award.project_id) ?? [];
        current.push(award);
        fundingAwardsByProjectId.set(award.project_id, current);
      }
      for (const opportunity of (fundingOpportunitiesResult.data ?? []) as Array<{ project_id: string; expected_award_amount: number | string | null; decision_state: string | null; opportunity_status: string | null; closes_at: string | null; updated_at: string | null; created_at: string | null }>) {
        const current = fundingOpportunitiesByProjectId.get(opportunity.project_id) ?? [];
        current.push(opportunity);
        fundingOpportunitiesByProjectId.set(opportunity.project_id, current);
      }
      for (const invoice of (billingInvoicesResult.data ?? []) as Array<{ project_id: string; status: string | null; amount: number | string | null; retention_percent: number | string | null; retention_amount: number | string | null; net_amount: number | string | null; due_date: string | null; invoice_date: string | null; created_at: string | null }>) {
        const current = fundingInvoicesByProjectId.get(invoice.project_id) ?? [];
        current.push(invoice);
        fundingInvoicesByProjectId.set(invoice.project_id, current);
      }
      const portfolioFundingSnapshot = buildPortfolioFundingSnapshot({
        projects: linkedProjectIds.map((projectId) => ({
          projectUpdatedAt: linkedProjects.find((link) => link.project?.id === projectId)?.project?.updated_at ?? null,
          profile: fundingProfileByProjectId.get(projectId) ?? null,
          awards: fundingAwardsByProjectId.get(projectId) ?? [],
          opportunities: fundingOpportunitiesByProjectId.get(projectId) ?? [],
          invoices: fundingInvoicesByProjectId.get(projectId) ?? [],
        })),
        capturedAt: report.generated_at ?? new Date().toISOString(),
      });
      const rtpFundingProfileScans = linkedProjects.map((link) => {
        const projectId = link.project?.id ?? link.project_id;
        const summary = buildProjectFundingStackSummary(
          fundingProfileByProjectId.get(projectId) ?? null,
          fundingAwardsByProjectId.get(projectId) ?? [],
          fundingOpportunitiesByProjectId.get(projectId) ?? [],
          fundingInvoicesByProjectId.get(projectId) ?? []
        );
        const scan = buildProjectFundingProfileScan({
          summary,
          hasComparisonEvidence: false,
        });

        return {
          projectId,
          projectName: link.project?.name ?? null,
          portfolioRole: link.portfolio_role,
          priorityRationale: link.priority_rationale,
          latestFundingSourceUpdatedAt: buildProjectFundingSnapshot({
            profile: fundingProfileByProjectId.get(projectId) ?? null,
            awards: fundingAwardsByProjectId.get(projectId) ?? [],
            opportunities: fundingOpportunitiesByProjectId.get(projectId) ?? [],
            invoices: fundingInvoicesByProjectId.get(projectId) ?? [],
            capturedAt: report.generated_at ?? null,
            projectUpdatedAt: link.project?.updated_at ?? null,
          }).latestSourceUpdatedAt,
          scan,
        };
      });
      const campaignIds = campaigns.map((campaign) => campaign.id);
      const engagementItemsResult = campaignIds.length
        ? await supabase
            .from("engagement_items")
            .select(
              "id, campaign_id, category_id, status, source_type, latitude, longitude, moderation_notes, created_at, updated_at"
            )
            .in("campaign_id", campaignIds)
        : { data: [], error: null };

      // These rows become the packet's public-review comment counts. A failed
      // read carried through as `?? []` tells a board the cycle drew no comments
      // — the sentence this product has already published twice on the strength
      // of a query that never ran.
      const engagementItemsError = engagementItemsResult.error;
      if (engagementItemsError) {
        audit.error("rtp_report_engagement_load_failed", {
          reportId: report.id,
          message: engagementItemsError.message ?? "unknown",
          code: engagementItemsError.code ?? null,
        });
        return NextResponse.json({ error: "Failed to load RTP packet engagement records" }, { status: 500 });
      }

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
      const chapterLevelCampaignCount = campaigns.length - cycleLevelCampaignCount;
      const enabledSectionKeys = sections.filter((section) => section.enabled).map((section) => section.section_key);
      const packetPresetAlignment = getRtpPacketPresetAlignment({
        cycleStatus: cycle.status,
        sections: sections.map((section) => ({
          sectionKey: section.section_key,
          enabled: section.enabled,
          sortOrder: section.sort_order,
        })),
      });
      const readiness = buildRtpCycleReadiness({
        geographyLabel: cycle.geography_label,
        horizonStartYear: cycle.horizon_start_year,
        horizonEndYear: cycle.horizon_end_year,
        adoptionTargetDate: cycle.adoption_target_date,
        publicReviewOpenAt: cycle.public_review_open_at,
        publicReviewCloseAt: cycle.public_review_close_at,
      });
      const workflow = buildRtpCycleWorkflowSummary({ status: cycle.status, readiness });
      const publicReviewSummary = buildRtpPublicReviewSummary({
        status: cycle.status,
        publicReviewOpenAt: cycle.public_review_open_at,
        publicReviewCloseAt: cycle.public_review_close_at,
        cycleLevelCampaignCount,
        chapterCampaignCount: chapterLevelCampaignCount,
        packetRecordCount: 1,
        generatedPacketCount: 1,
        pendingCommentCount: engagementCounts.moderationQueue.pendingCount,
        approvedCommentCount: engagementCounts.moderationQueue.approvedCount,
        readyCommentCount: engagementCounts.moderationQueue.readyForHandoffCount,
      });
      const rtpFundingSourceContextReadiness = summarizeRtpFundingProfileScanReadiness(
        rtpFundingProfileScans,
        {
          modelingEvidenceCount: modelingEvidenceMetadata.length,
          engagementReadyForHandoffCount: engagementCounts.moderationQueue.readyForHandoffCount,
          enabledSectionCount: sections.filter((section) => section.enabled).length,
        }
      );
      const format = parsed.data.format;
      const chapterCompleteCount = chapters.filter((chapter) => chapter.status === "complete").length;
      const chapterReadyForReviewCount = chapters.filter((chapter) => chapter.status === "ready_for_review").length;
      const html = buildRtpExportHtml({
        cycle,
        chapters,
        linkedProjects,
        campaigns,
        options: {
          sectionKeys: enabledSectionKeys,
          titleSuffix: "OpenPlan RTP Packet",
          publicReviewSummary: {
            ...publicReviewSummary,
            cycleLevelCampaignCount,
            chapterLevelCampaignCount,
            pendingCommentCount: engagementCounts.moderationQueue.pendingCount,
            readyCommentCount: engagementCounts.moderationQueue.readyForHandoffCount,
          },
          modelingEvidence,
          fundingSnapshot: portfolioFundingSnapshot,
          fundingProfileScans: rtpFundingProfileScans,
          fundingSourceContextReadiness: rtpFundingSourceContextReadiness,
        },
      });
      const generatedAt = new Date().toISOString();
      const artifactId = crypto.randomUUID();
      let rtpPdfStoragePath: string | null = null;
      let pdfEngine: ReportPdfEngine | null = null;
      const reportTitleForPdf = typeof report.title === "string" && report.title.trim()
        ? report.title.trim()
        : "OpenPlan report";
      if (format === "pdf") {
        // `renderReportPdf` falls back to the built-in typesetter rather than
        // throwing, so a deployment with no browser engine still produces a
        // COMPLETE packet. Only an upload failure below is fatal now — a
        // missing Chrome is a typesetting tier, not a failed deliverable.
        const rendered = await renderReportPdf(html, {
          title: reportTitleForPdf,
          generatedAt,
          footerLabel: "OpenPlan",
        });
        pdfEngine = rendered.engine;
        if (rendered.engine === "builtin") {
          audit.warn("report_pdf_builtin_typesetter_used", {
            reportId: report.id,
            pageCount: rendered.pageCount,
          });
        }
        const pdfBuffer = Buffer.from(rendered.bytes);
        const storagePath = `${report.workspace_id}/${report.id}/${artifactId}.pdf`;
        const { error: uploadError } = await supabase.storage
          .from("report-artifacts")
          .upload(storagePath, pdfBuffer, { contentType: "application/pdf", upsert: false });
        if (uploadError) {
          audit.error("report_pdf_upload_failed", {
            reportId: report.id,
            message: uploadError.message,
          });
          return NextResponse.json({ error: "Failed to upload PDF artifact" }, { status: 500 });
        }
        rtpPdfStoragePath = storagePath;
      }
      const artifactMetadata = {
        htmlContent: html,
        generatedAt,
        // Which typesetting tier produced the stored file, so the record can
        // answer "why does this PDF look different" without re-rendering it.
        pdfEngine,
        auditability: {
          posture: "rtp_packet_v1",
          note: "This output assembles RTP cycle narrative, portfolio posture, and engagement targets into a packet record artifact.",
        },
        sourceContext: {
          reportOrigin: "rtp_cycle_packet",
          reportReason: "board_packet_record",
          rtpCycleId: cycle.id,
          rtpCycleTitle: cycle.title,
          rtpCycleUpdatedAt: cycle.updated_at,
          chapterCount: chapters.length,
          chapterCompleteCount,
          chapterReadyForReviewCount,
          linkedProjectCount: linkedProjects.length,
          engagementCampaignCount: campaigns.length,
          cycleLevelCampaignCount,
          chapterLevelCampaignCount,
          engagementPendingCommentCount: engagementCounts.moderationQueue.pendingCount,
          engagementApprovedCommentCount: engagementCounts.moderationQueue.approvedCount,
          engagementReadyCommentCount: engagementCounts.moderationQueue.readyForHandoffCount,
          publicReviewSummary,
          rtpFundingSnapshot: portfolioFundingSnapshot,
          rtpFundingProfileScans,
          rtpFundingSourceContextReadiness,
          readiness,
          workflow,
          modelingEvidence: modelingEvidenceMetadata,
          modelingEvidenceCount: modelingEvidenceMetadata.length,
          modelingEvidenceClaimStatuses,
          enabledSectionCount: sections.filter((section) => section.enabled).length,
          enabledSectionKeys,
          packetPresetAlignment,
        },
        generationMode: format === "pdf" ? "rtp_pdf_packet" : "rtp_html_packet",
      };

      const { data: artifact, error: artifactError } = await supabase
        .from("report_artifacts")
        .insert({
          id: artifactId,
          report_id: report.id,
          artifact_kind: format,
          storage_path: rtpPdfStoragePath,
          generated_by: user.id,
          generated_at: generatedAt,
          metadata_json: artifactMetadata,
        })
        .select("id, report_id, artifact_kind, generated_at, metadata_json")
        .single();

      if (artifactError || !artifact) {
        audit.error("artifact_insert_failed", {
          reportId: report.id,
          message: artifactError?.message ?? "unknown",
          code: artifactError?.code ?? null,
        });
        return NextResponse.json({ error: "Failed to persist report artifact" }, { status: 500 });
      }

      // A link to the FILE when there is one. This was an in-app anchor to a
      // row in the composition-audit table, which meant a generated PDF sat in
      // private storage with nothing able to retrieve it.
      const latestArtifactUrl = rtpPdfStoragePath
        ? `/api/reports/${report.id}/artifacts/${artifact.id}/download`
        : `/reports/${report.id}#artifact-${artifact.id}`;
      const artifactHistoryEntry = buildArtifactHistoryEntry({
        artifactId: artifact.id,
        artifactKind: format,
        generatedAt,
        generatedBy: user.id,
        generationMode: artifactMetadata.generationMode,
        sourceContext: artifactMetadata.sourceContext,
      });
      const nextMetadataJson = {
        ...appendArtifactHistory(report.metadata_json, artifactHistoryEntry),
        queueTrace: {
          action: report.generated_at ? "refresh_artifact" : "generate_first_artifact",
          actedAt: generatedAt,
          actorUserId: user.id,
          source: "reports.generate",
          detail: report.generated_at ? "Refreshed RTP packet artifact." : "Generated first RTP packet artifact.",
        },
      };

      let reportUpdateResult = await supabase
        .from("reports")
        .update({
          status: "generated",
          generated_at: generatedAt,
          latest_artifact_kind: format,
          latest_artifact_url: latestArtifactUrl,
          metadata_json: nextMetadataJson,
          rtp_basis_stale: false,
          rtp_basis_stale_reason: null,
          rtp_basis_stale_run_id: null,
          rtp_basis_stale_marked_at: null,
        })
        .eq("id", report.id);

      if (reportUpdateResult.error && looksLikePendingSchema(reportUpdateResult.error.message)) {
        reportUpdateResult = await supabase
          .from("reports")
          .update({
            status: "generated",
            generated_at: generatedAt,
            latest_artifact_kind: format,
            latest_artifact_url: latestArtifactUrl,
          })
          .eq("id", report.id);
      }

      const { error: reportUpdateError } = reportUpdateResult;

      if (reportUpdateError) {
        audit.error("report_update_failed", {
          reportId: report.id,
          message: reportUpdateError.message,
          code: reportUpdateError.code ?? null,
        });
        return NextResponse.json({ error: "Failed to update report generation status" }, { status: 500 });
      }

      audit.info("rtp_report_generated", {
        reportId: report.id,
        artifactId: artifact.id,
        format,
        storagePath: rtpPdfStoragePath,
        userId: user.id,
        linkedProjectCount: linkedProjects.length,
        modelingEvidenceCount: modelingEvidenceMetadata.length,
        modelingEvidenceClaimStatuses,
        durationMs: Date.now() - startedAt,
      });

      return NextResponse.json(
        {
          reportId: report.id,
          artifactId: artifact.id,
          format,
          latestArtifactUrl,
          storagePath: rtpPdfStoragePath,
          warnings: [],
        },
        { status: 200 }
      );
    }

    // A campaign-targeted report (project_id and rtp_cycle_id both null)
    // generates from the campaign's own engagement records and cited typed
    // runs. Before this branch existed, every non-RTP report fell through to
    // the project loader below and a standalone campaign packet answered 500.
    const campaignTargetId: string | null =
      !report.project_id && !report.rtp_cycle_id
        ? ((report as { engagement_campaign_id?: string | null }).engagement_campaign_id ?? null)
        : null;

    if (campaignTargetId) {
      const [workspaceResult, campaignResult, sectionsResult, campaignReportRunsResult] = await Promise.all([
        supabase.from("workspaces").select("id, name").eq("id", report.workspace_id).maybeSingle(),
        supabase
          .from("engagement_campaigns")
          // demographics_enabled is the campaign's own opt-in switch, and it has
          // to be SELECTED to be read: these clients are untyped, so a column
          // left out of this string is silently `undefined` at runtime, which
          // would charge every campaign with "not collecting demographics".
          .select(
            "id, workspace_id, title, summary, status, engagement_type, share_token, updated_at, ai_synthesis_json, representativeness_json, demographics_enabled"
          )
          .eq("workspace_id", report.workspace_id)
          .eq("id", campaignTargetId)
          .maybeSingle(),
        supabase
          .from("report_sections")
          .select("id, section_key, title, enabled, sort_order, config_json")
          .eq("report_id", report.id)
          .order("sort_order", { ascending: true }),
        // Typed citations only: campaign targets refuse legacy runIds at
        // create, so run_id is always null on these rows. safeOptionalQuery
        // keeps a pre-typed-evidence database honest — no columns means no
        // citations, not a failed packet.
        safeOptionalQuery(
          () =>
            supabase
              .from("report_runs")
              .select("id, run_id, model_run_id, county_run_id, sort_order")
              .eq("report_id", report.id)
              .order("sort_order", { ascending: true }),
          [] as Array<Record<string, unknown>>
        ),
      ]);

      const campaignLoadErrors = [
        workspaceResult.error,
        campaignResult.error,
        sectionsResult.error,
        campaignReportRunsResult.error,
      ].filter(Boolean);

      if (campaignLoadErrors.length > 0) {
        const firstError = campaignLoadErrors[0];
        audit.error("report_generation_load_failed", {
          reportId: report.id,
          message: firstError?.message ?? "unknown",
          code: firstError?.code ?? null,
        });
        return NextResponse.json({ error: "Failed to load report source records" }, { status: 500 });
      }

      if (!campaignResult.data) {
        audit.error("report_campaign_target_missing", {
          reportId: report.id,
          engagementCampaignId: campaignTargetId,
        });
        return NextResponse.json({ error: "Engagement campaign not found for this report" }, { status: 404 });
      }

      const campaignRow = campaignResult.data as {
        id: string;
        workspace_id: string;
        title: string;
        summary: string | null;
        status: string;
        engagement_type: string;
        share_token: string | null;
        updated_at: string;
        ai_synthesis_json?: unknown;
        representativeness_json?: CampaignRepresentativeness | null;
        // Not optional: the column is NOT NULL since 20260719000094 and is named
        // in the select above, so PostgREST errors the whole read rather than
        // omitting it. Declaring it optional would invite a `?? false` that
        // turns a schema problem into "this campaign collects no demographics".
        demographics_enabled: boolean;
      };

      const [campaignCategoriesResult, campaignItemsResult] = await Promise.all([
        supabase
          .from("engagement_categories")
          .select("id, label, slug, description, sort_order, created_at, updated_at")
          .eq("campaign_id", campaignRow.id)
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: true }),
        supabase
          .from("engagement_items")
          .select(
            "id, campaign_id, category_id, status, source_type, latitude, longitude, moderation_notes, created_at, updated_at"
          )
          .eq("campaign_id", campaignRow.id)
          .order("updated_at", { ascending: false }),
      ]);

      if (campaignCategoriesResult.error || campaignItemsResult.error) {
        const firstError = campaignCategoriesResult.error ?? campaignItemsResult.error;
        audit.error("report_engagement_load_failed", {
          reportId: report.id,
          campaignId: campaignRow.id,
          message: firstError?.message ?? "unknown",
          code: firstError?.code ?? null,
        });
        return NextResponse.json({ error: "Failed to load engagement campaign records" }, { status: 500 });
      }

      // E3 spatial hotspots are screening-grade extras; a hotspot failure
      // never blocks the packet (mirrors the project path).
      let campaignHotspots = null;
      try {
        const storedSynthesis = (campaignRow.ai_synthesis_json ?? null) as EngagementSynthesis | null;
        const { analysis } = await loadSentimentHotspots(supabase, {
          workspaceId: report.workspace_id,
          campaignId: campaignRow.id,
          negativeItemIds: negativeItemIdsFromSyntheses([storedSynthesis]),
        });
        campaignHotspots = analysis;
      } catch {
        campaignHotspots = null;
      }

      // E5a — the k-anonymized self-reported aggregate. Read through the RLS
      // client on purpose: engagement_demographics_summary is SECURITY DEFINER
      // and answers a non-member with zero rows rather than an error, so the
      // service-role client (auth.uid() null) would hand back an empty summary
      // that reads exactly like "nobody answered". This client carries the
      // generating user, whose workspace membership the route already proved.
      const campaignSelfReported = await loadSelfReportedDemographicsSource(supabase, campaignRow.id, {
        collectionEnabled: campaignRow.demographics_enabled,
      });

      const engagement = buildReportEngagementSummary({
        campaign: campaignRow,
        categories: campaignCategoriesResult.data ?? [],
        items: campaignItemsResult.data ?? [],
        hotspots: campaignHotspots,
        // Cached E5b screening only (never recomputed in the report path).
        representativeness: campaignRow.representativeness_json ?? null,
        // E5a/E5c — the self-reported side and the joint reading across both.
        // A failed read arrives here as `unreadable` and is disclosed as
        // unknown; it must never reach the packet as an absence.
        selfReported: campaignSelfReported,
        // E1 synthesis prose is export-gated inside the builder.
        synthesis: buildReportEngagementSynthesis(campaignRow.ai_synthesis_json ?? null),
      });

      if (!engagement) {
        // Unreachable with a loaded campaign row; kept for type narrowing.
        return NextResponse.json({ error: "Failed to assemble engagement summary" }, { status: 500 });
      }

      const campaignRunLinkRows = (campaignReportRunsResult.data ?? []) as Array<{
        id: string;
        run_id?: string | null;
        model_run_id?: string | null;
        county_run_id?: string | null;
        sort_order: number;
      }>;
      const campaignCitedModelRunIds = campaignRunLinkRows
        .map((item) => item.model_run_id ?? null)
        .filter((value): value is string => Boolean(value));
      const campaignCitedCountyRunIds = campaignRunLinkRows
        .map((item) => item.county_run_id ?? null)
        .filter((value): value is string => Boolean(value));

      const [campaignModelRunsResult, campaignCountyRunsResult] = await Promise.all([
        campaignCitedModelRunIds.length
          ? safeOptionalQuery(
              () =>
                supabase
                  .from("model_runs")
                  .select("id, run_title, engine_key, status, result_summary_json")
                  .in("id", campaignCitedModelRunIds),
              [] as Array<Record<string, unknown>>
            )
          : Promise.resolve({ data: [] as Array<Record<string, unknown>>, error: null }),
        campaignCitedCountyRunIds.length
          ? safeOptionalQuery(
              () =>
                supabase
                  .from("county_runs")
                  .select("id, run_name, stage, validation_summary_json")
                  .in("id", campaignCitedCountyRunIds),
              [] as Array<Record<string, unknown>>
            )
          : Promise.resolve({ data: [] as Array<Record<string, unknown>>, error: null }),
      ]);

      if (campaignModelRunsResult.error || campaignCountyRunsResult.error) {
        const firstRunError = campaignModelRunsResult.error ?? campaignCountyRunsResult.error;
        audit.error("report_runs_load_failed", {
          reportId: report.id,
          message: firstRunError?.message ?? "unknown",
          code: firstRunError?.code ?? null,
        });
        return NextResponse.json({ error: "Failed to load cited runs" }, { status: 500 });
      }

      const campaignModelRunMap = new Map(
        ((campaignModelRunsResult.data ?? []) as Array<{
          id: string;
          run_title: string;
          engine_key: string;
          status: string;
          result_summary_json: Record<string, unknown> | null;
        }>).map((run) => [run.id, run])
      );
      const campaignCountyRunMap = new Map(
        ((campaignCountyRunsResult.data ?? []) as Array<{
          id: string;
          run_name: string | null;
          stage: string | null;
          validation_summary_json: Record<string, unknown> | null;
        }>).map((run) => [run.id, run])
      );
      // Same shared claim-tier lookup as the standard packet below. A campaign
      // packet citing a model run is still a packet an agency hands someone.
      const citedModelRuns = await withCitedModelRunClaimTiers(
        supabase,
        campaignRunLinkRows
          .map((item) => (item.model_run_id ? campaignModelRunMap.get(item.model_run_id) ?? null : null))
          .filter((item): item is NonNullable<typeof item> => Boolean(item))
      );
      const citedCountyRuns = campaignRunLinkRows
        .map((item) => (item.county_run_id ? campaignCountyRunMap.get(item.county_run_id) ?? null : null))
        .filter((item): item is NonNullable<typeof item> => Boolean(item));

      const sections = (sectionsResult.data ?? []) as Array<{
        id: string;
        section_key: string;
        title: string;
        enabled: boolean;
        sort_order: number;
        config_json: Record<string, unknown> | null;
      }>;
      const engagementProvenance = extractEngagementHandoffProvenance(sections);
      const enabledSectionKeys = sections
        .filter((section) => section.enabled)
        .map((section) => section.section_key);

      const html = buildCampaignReportHtml({
        report,
        workspace: workspaceResult.data,
        engagement,
        sections,
        citedModelRuns,
        citedCountyRuns,
      });

      const format = parsed.data.format;
      const generatedAt = new Date().toISOString();
      const artifactId = crypto.randomUUID();
      let campaignPdfStoragePath: string | null = null;
      let pdfEngine: ReportPdfEngine | null = null;
      const reportTitleForPdf = typeof report.title === "string" && report.title.trim()
        ? report.title.trim()
        : "OpenPlan report";
      if (format === "pdf") {
        // See the RTP branch above: a missing browser engine is a typesetting
        // tier, not a failed deliverable.
        const rendered = await renderReportPdf(html, {
          title: reportTitleForPdf,
          generatedAt,
          footerLabel: "OpenPlan",
        });
        pdfEngine = rendered.engine;
        if (rendered.engine === "builtin") {
          audit.warn("report_pdf_builtin_typesetter_used", {
            reportId: report.id,
            pageCount: rendered.pageCount,
          });
        }
        const pdfBuffer = Buffer.from(rendered.bytes);
        const storagePath = `${report.workspace_id}/${report.id}/${artifactId}.pdf`;
        const { error: uploadError } = await supabase.storage
          .from("report-artifacts")
          .upload(storagePath, pdfBuffer, { contentType: "application/pdf", upsert: false });
        if (uploadError) {
          audit.error("report_pdf_upload_failed", {
            reportId: report.id,
            message: uploadError.message,
          });
          return NextResponse.json({ error: "Failed to upload PDF artifact" }, { status: 500 });
        }
        campaignPdfStoragePath = storagePath;
      }

      const artifactMetadata = {
        metadata_schema_version: "2026-04",
        htmlContent: html,
        generatedAt,
        // Which typesetting tier produced the stored file, so the record can
        // answer "why does this PDF look different" without re-rendering it.
        pdfEngine,
        auditability: {
          posture: "campaign_packet_v1",
          note: "This output assembles a single engagement campaign's structured records and cited run evidence as a review packet with explicit provenance.",
        },
        sourceContext: {
          reportOrigin: engagementProvenance?.origin ?? "report_builder",
          reportReason: engagementProvenance?.reason ?? null,
          engagementCampaignId: campaignRow.id,
          engagementCampaignTitle: campaignRow.title,
          engagementCampaignStatus: campaignRow.status,
          engagementCampaignUpdatedAt: campaignRow.updated_at,
          engagementItemCount: engagement.counts.totalItems,
          engagementReadyForHandoffCount: engagement.counts.moderationQueue.readyForHandoffCount,
          engagementActionableCount: engagement.counts.moderationQueue.actionableCount,
          engagementUncategorizedCount: engagement.counts.uncategorizedItems,
          engagementSnapshotCapturedAt: engagementProvenance?.capturedAt || null,
          engagementCountsSnapshot: engagementProvenance?.counts ?? null,
          citedModelRunCount: citedModelRuns.length,
          citedCountyRunCount: citedCountyRuns.length,
          citedModelRuns: citedModelRuns.map((run) => ({
            id: run.id,
            runTitle: run.run_title,
            engineKey: run.engine_key,
            status: run.status,
          })),
          citedCountyRuns: citedCountyRuns.map((run) => ({
            id: run.id,
            runName: run.run_name,
            stage: run.stage,
          })),
          enabledSectionCount: enabledSectionKeys.length,
          enabledSectionKeys,
          // Sections the campaign packet disclosed as not applicable, so the
          // record can answer "why is this section a notice" later.
          notApplicableSectionKeys: enabledSectionKeys.filter((key) =>
            CAMPAIGN_NOT_APPLICABLE_SECTION_KEYS.has(key)
          ),
        },
        generationMode: format === "pdf" ? "campaign_pdf_packet" : "campaign_html_packet",
      };

      const { data: artifact, error: artifactError } = await supabase
        .from("report_artifacts")
        .insert({
          id: artifactId,
          report_id: report.id,
          artifact_kind: format,
          storage_path: campaignPdfStoragePath,
          generated_by: user.id,
          generated_at: generatedAt,
          metadata_json: artifactMetadata,
        })
        .select("id, report_id, artifact_kind, generated_at, metadata_json")
        .single();

      if (artifactError || !artifact) {
        audit.error("artifact_insert_failed", {
          reportId: report.id,
          message: artifactError?.message ?? "unknown",
          code: artifactError?.code ?? null,
        });
        return NextResponse.json({ error: "Failed to persist report artifact" }, { status: 500 });
      }

      // See the RTP branch: a link to the FILE when one was stored.
      const latestArtifactUrl = campaignPdfStoragePath
        ? `/api/reports/${report.id}/artifacts/${artifact.id}/download`
        : `/reports/${report.id}#artifact-${artifact.id}`;
      const artifactHistoryEntry = buildArtifactHistoryEntry({
        artifactId: artifact.id,
        artifactKind: format,
        generatedAt,
        generatedBy: user.id,
        generationMode: artifactMetadata.generationMode,
        sourceContext: artifactMetadata.sourceContext,
      });
      const nextMetadataJson = {
        ...appendArtifactHistory(report.metadata_json, artifactHistoryEntry),
        queueTrace: {
          action: report.generated_at ? "refresh_artifact" : "generate_first_artifact",
          actedAt: generatedAt,
          actorUserId: user.id,
          source: "reports.generate",
          detail: report.generated_at
            ? "Refreshed campaign packet artifact."
            : "Generated first campaign packet artifact.",
        },
      };

      let reportUpdateResult = await supabase
        .from("reports")
        .update({
          status: "generated",
          generated_at: generatedAt,
          latest_artifact_kind: format,
          latest_artifact_url: latestArtifactUrl,
          metadata_json: nextMetadataJson,
        })
        .eq("id", report.id);

      if (reportUpdateResult.error && looksLikePendingSchema(reportUpdateResult.error.message)) {
        reportUpdateResult = await supabase
          .from("reports")
          .update({
            status: "generated",
            generated_at: generatedAt,
            latest_artifact_kind: format,
            latest_artifact_url: latestArtifactUrl,
          })
          .eq("id", report.id);
      }

      const { error: reportUpdateError } = reportUpdateResult;

      if (reportUpdateError) {
        audit.error("report_update_failed", {
          reportId: report.id,
          message: reportUpdateError.message,
          code: reportUpdateError.code ?? null,
        });
        return NextResponse.json({ error: "Failed to update report generation status" }, { status: 500 });
      }

      audit.info("campaign_report_generated", {
        reportId: report.id,
        artifactId: artifact.id,
        format,
        storagePath: campaignPdfStoragePath,
        userId: user.id,
        engagementCampaignId: campaignRow.id,
        engagementItemCount: engagement.counts.totalItems,
        citedModelRunCount: citedModelRuns.length,
        citedCountyRunCount: citedCountyRuns.length,
        durationMs: Date.now() - startedAt,
      });

      const executionCompletedAt = new Date().toISOString();
      const executionStartedAt = new Date(startedAt).toISOString();
      const serviceSupabase = createServiceRoleClient();
      const approval = await verifyAssistantActionApproval({
        request,
        serviceSupabase,
        userId: user.id,
        workspaceId: report.workspace_id,
        action: {
          kind: "generate_report_artifact",
          reportId: report.id,
        },
      });
      const { error: executionAuditError } = await recordAssistantActionExecution(serviceSupabase, {
        workspaceId: report.workspace_id,
        userId: user.id,
        actionKind: "generate_report_artifact",
        auditEvent: "planner_agent.generate_report_artifact",
        approval: "safe",
        regrounding: "refresh_preview",
        outcome: "succeeded",
        ...assistantActionAuditIdentity(approval),
        inputSummary: {
          reportId: report.id,
          artifactId: artifact.id,
          engagementCampaignId: campaignRow.id,
        },
        startedAt: executionStartedAt,
        completedAt: executionCompletedAt,
      });

      if (executionAuditError) {
        audit.warn("assistant_action_execution_audit_failed", {
          reportId: report.id,
          artifactId: artifact.id,
          message: executionAuditError.message,
          code: executionAuditError.code ?? null,
        });
      }

      return NextResponse.json(
        {
          reportId: report.id,
          artifactId: artifact.id,
          format,
          latestArtifactUrl,
          storagePath: campaignPdfStoragePath,
          warnings: [],
        },
        { status: 200 }
      );
    }

    if (!report.project_id) {
      // Exactly one target exists per report (reports_target_presence), and
      // the project and RTP branches did not claim this row — so it targets a
      // campaign the lookup could not see: the campaign-target migration is
      // pending or the schema cache is stale. Say so instead of failing on a
      // project load that can never succeed.
      audit.warn("report_campaign_target_schema_pending", { reportId: report.id });
      return NextResponse.json(
        {
          error: "This report targets an engagement campaign, but the database does not expose campaign targets yet.",
          hint: "Apply migration 20260727000008_reports_engagement_campaign_target (or wait for the schema cache to refresh), then generate again.",
        },
        { status: 503 }
      );
    }

    const projectModelingEvidencePromise = loadReportModelingEvidence({
      supabase,
      audit,
      reportId: report.id,
      workspaceId: report.workspace_id,
      modelingCountyRunId: report.modeling_county_run_id,
      auditEventPrefix: "report_modeling",
    });

    const [
      workspaceResult,
      projectResult,
      sectionsResult,
      reportRunsResult,
      stageGateDecisionsResult,
      deliverablesResult,
      risksResult,
      issuesResult,
      decisionsResult,
      meetingsResult,
      fundingProfileResult,
      fundingAwardsResult,
      fundingOpportunitiesResult,
      billingInvoicesResult,
    ] = await Promise.all([
      supabase.from("workspaces").select("id, name").eq("id", report.workspace_id).maybeSingle(),
      supabase
        .from("projects")
        .select("id, workspace_id, name, summary, status, plan_type, delivery_phase, created_at, updated_at")
        .eq("id", report.project_id)
        .maybeSingle(),
      supabase
        .from("report_sections")
        .select("id, section_key, title, enabled, sort_order, config_json")
        .eq("report_id", report.id)
        .order("sort_order", { ascending: true }),
      supabase
        .from("report_runs")
        .select("id, run_id, model_run_id, county_run_id, sort_order")
        .eq("report_id", report.id)
        .order("sort_order", { ascending: true }),
      // Scoped to the project, and this is the most consequential of the three
      // reads that were not: the snapshot built from these rows is frozen into
      // a packet an agency sends to a funder or a board, where a gate that
      // passed on a NEIGHBOURING project in the same workspace would be
      // asserted, permanently, as this project's. `report.project_id` is
      // non-null here — the RTP and campaign targets returned above.
      //
      // The read stays inline rather than going through
      // `loadProjectStageGateBoard` on purpose: a failure must reach
      // `loadErrors` below and refuse the whole generation with its audit
      // event, not be softened into an "unreadable" board that a packet would
      // then have to decide what to do with.
      supabase
        .from("stage_gate_decisions")
        .select(PROJECT_STAGE_GATE_DECISION_COLUMNS)
        .eq("workspace_id", report.workspace_id)
        .eq("project_id", report.project_id)
        .order("decided_at", { ascending: false })
        .limit(200),
      supabase
        .from("project_deliverables")
        .select("id, title, summary, status, due_date, created_at")
        .eq("project_id", report.project_id)
        .order("updated_at", { ascending: false })
        .limit(8),
      supabase
        .from("project_risks")
        .select("id, title, description, status, created_at")
        .eq("project_id", report.project_id)
        .order("updated_at", { ascending: false })
        .limit(8),
      supabase
        .from("project_issues")
        .select("id, title, description, status, created_at")
        .eq("project_id", report.project_id)
        .order("updated_at", { ascending: false })
        .limit(8),
      supabase
        .from("project_decisions")
        .select("id, title, rationale, status, decided_at, created_at")
        .eq("project_id", report.project_id)
        .order("updated_at", { ascending: false })
        .limit(8),
      supabase
        .from("project_meetings")
        .select("id, title, notes, meeting_at, created_at")
        .eq("project_id", report.project_id)
        .order("updated_at", { ascending: false })
        .limit(8),
      // THESE FOUR ARE NO LONGER OPTIONAL, and the reason is the sibling branch:
      // the RTP packet reads the same four tables and refuses on any failure,
      // because the rows are TOTALLED. This branch wrapped them in
      // `safeOptionalQuery`, so a classified failure produced `$0 committed` and
      // a fully unfunded project in a packet a funder keeps — the identical
      // falsehood, one code path over. The classification also widened when
      // `looksLikePendingSchema` was consolidated, so the set of failures that
      // silently zeroed this project's funding had quietly GROWN. Refuse
      // instead; a pending migration still gets its own 503 below.
      supabase
        .from("project_funding_profiles")
        .select("id, funding_need_amount, local_match_need_amount, updated_at")
        .eq("project_id", report.project_id)
        .maybeSingle(),
      supabase
        .from("funding_awards")
        .select("id, awarded_amount, match_amount, risk_flag, obligation_due_at, updated_at, created_at")
        .eq("project_id", report.project_id)
        .order("updated_at", { ascending: false }),
      supabase
        .from("funding_opportunities")
        .select("id, expected_award_amount, decision_state, opportunity_status, closes_at, updated_at, created_at")
        .eq("project_id", report.project_id)
        .order("updated_at", { ascending: false }),
      supabase
        .from("billing_invoice_records")
        .select("id, funding_award_id, status, amount, retention_percent, retention_amount, net_amount, due_date, invoice_date, created_at")
        .eq("project_id", report.project_id)
        .order("created_at", { ascending: false }),
    ]);

    // Typed-evidence fallback: a database without the report_runs typed-
    // evidence migration answers the widened select with a missing-column
    // error, so re-query with the legacy column set.
    let reportRunLinksResult = reportRunsResult;
    if (reportRunLinksResult.error && looksLikePendingSchema(reportRunLinksResult.error.message)) {
      reportRunLinksResult = (await supabase
        .from("report_runs")
        .select("id, run_id, sort_order")
        .eq("report_id", report.id)
        .order("sort_order", { ascending: true })) as unknown as typeof reportRunLinksResult;
    }

    const loadErrors = [
      workspaceResult.error,
      projectResult.error,
      sectionsResult.error,
      reportRunLinksResult.error,
      stageGateDecisionsResult.error,
      deliverablesResult.error,
      risksResult.error,
      issuesResult.error,
      decisionsResult.error,
      meetingsResult.error,
    ].filter(Boolean);

    // The gate read is scoped by `project_id`, a column 20260728000011 added, and
    // code deploys ahead of migrations. Refusing generation is still correct in
    // that window — falling back to a workspace-wide read would freeze another
    // project's gate verdict into a funder-facing packet — but the refusal names
    // the missing migration instead of arriving as a generic 500, in the same
    // shape as the campaign-target branch above.
    if (looksLikePendingStageGateProjectScope(stageGateDecisionsResult.error?.message)) {
      audit.warn("report_stage_gate_project_scope_schema_pending", {
        reportId: report.id,
        message: stageGateDecisionsResult.error?.message ?? null,
        code: stageGateDecisionsResult.error?.code ?? null,
      });
      return NextResponse.json(
        {
          error:
            "This packet's stage-gate snapshot cannot be built yet, because the database cannot say which project a gate decision belongs to.",
          hint: "Apply migration 20260728000011_stage_gate_decisions_project_scope (or wait for the schema cache to refresh), then generate again. Generating without it could record another project's gate decision as this one's.",
        },
        { status: 503 }
      );
    }

    // The funding reads get their OWN gate rather than joining `loadErrors`, so
    // an unapplied migration answers 503 with a migration hint instead of a
    // generic 500 an operator cannot act on — the shape this route already uses
    // for the campaign target and the stage-gate project scope.
    const fundingReadFailure =
      classifyRouteReadFailure("this project's funding records", fundingProfileResult) ??
      classifyRouteReadFailure("this project's funding records", fundingAwardsResult) ??
      classifyRouteReadFailure("this project's funding records", fundingOpportunitiesResult) ??
      classifyRouteReadFailure("this project's funding records", billingInvoicesResult);

    if (fundingReadFailure) {
      audit.error("report_funding_load_failed", {
        reportId: report.id,
        projectId: report.project_id,
        message: fundingReadFailure.message,
        pendingSchema: fundingReadFailure.pending,
      });
      return NextResponse.json(fundingReadFailure.body, { status: fundingReadFailure.status });
    }

    if (loadErrors.length > 0 || !projectResult.data) {
      const firstError = loadErrors[0];
      audit.error("report_generation_load_failed", {
        reportId: report.id,
        message: firstError?.message ?? "Project not found",
        code: firstError?.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load report source records" }, { status: 500 });
    }

    const engagementCampaignId = extractEngagementCampaignId(sectionsResult.data ?? []);
    const engagementProvenance = extractEngagementHandoffProvenance(sectionsResult.data ?? []);
    const [engagementCampaignResult, engagementCategoriesResult, engagementItemsResult] =
      engagementCampaignId
        ? await Promise.all([
            supabase
              .from("engagement_campaigns")
              // demographics_enabled must be selected to be read — see the
              // campaign-packet path above; an unselected column comes back
              // `undefined` on these untyped clients, not as an error.
              .select(
                "id, title, summary, status, engagement_type, share_token, updated_at, ai_synthesis_json, representativeness_json, demographics_enabled"
              )
              .eq("workspace_id", report.workspace_id)
              .eq("id", engagementCampaignId)
              .maybeSingle(),
            supabase
              .from("engagement_categories")
              .select("id, label, slug, description, sort_order, created_at, updated_at")
              .eq("campaign_id", engagementCampaignId)
              .order("sort_order", { ascending: true })
              .order("created_at", { ascending: true }),
            supabase
              .from("engagement_items")
              .select("id, campaign_id, category_id, status, source_type, latitude, longitude, moderation_notes, created_at, updated_at")
              .eq("campaign_id", engagementCampaignId)
              .order("updated_at", { ascending: false }),
          ])
        : [
            { data: null, error: null },
            { data: [], error: null },
            { data: [], error: null },
          ];

    const engagementLoadErrors = [
      engagementCampaignResult.error,
      engagementCategoriesResult.error,
      engagementItemsResult.error,
    ].filter(Boolean);

    if (engagementLoadErrors.length > 0) {
      const firstError = engagementLoadErrors[0];
      audit.error("report_engagement_load_failed", {
        reportId: report.id,
        campaignId: engagementCampaignId,
        message: firstError?.message ?? "unknown",
        code: firstError?.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load engagement handoff context" }, { status: 500 });
    }

    // E3 — screening-grade spatial hotspots for the report's engagement section.
    // Sentiment is AI-derived from the campaign's E1 synthesis (a proxy). Never
    // let a hotspot failure block report generation.
    let engagementHotspots = null;
    if (engagementCampaignId && engagementCampaignResult.data) {
      try {
        const synthesis =
          (engagementCampaignResult.data as { ai_synthesis_json?: EngagementSynthesis | null }).ai_synthesis_json ??
          null;
        const { analysis } = await loadSentimentHotspots(supabase, {
          workspaceId: report.workspace_id,
          campaignId: engagementCampaignId,
          negativeItemIds: negativeItemIdsFromSyntheses([synthesis]),
        });
        engagementHotspots = analysis;
      } catch {
        engagementHotspots = null;
      }
    }

    // E5a — the self-reported aggregate for the linked campaign, when there is
    // one. A project report with no linked campaign stays at `not_loaded`, which
    // is silence: this path has read nothing, so it may not say a campaign
    // collected nothing. Same RLS-client reasoning as the campaign packet above.
    const linkedCampaign = engagementCampaignResult.data as { id: string; demographics_enabled: boolean } | null;
    const engagementSelfReported = linkedCampaign
      ? await loadSelfReportedDemographicsSource(supabase, linkedCampaign.id, {
          collectionEnabled: linkedCampaign.demographics_enabled,
        })
      : ({ state: "not_loaded" } as const);

    const engagement = buildReportEngagementSummary({
      campaign: engagementCampaignResult.data,
      categories: engagementCategoriesResult.data ?? [],
      items: engagementItemsResult.data ?? [],
      hotspots: engagementHotspots,
      // Read the cached E5b screening (never recompute in the report path).
      representativeness:
        (engagementCampaignResult.data as { representativeness_json?: CampaignRepresentativeness | null } | null)
          ?.representativeness_json ?? null,
      // E5a/E5c — the self-reported side and the joint reading across both, so
      // the half of the representativeness picture that describes actual people
      // reaches the packet instead of stopping at the campaign page.
      selfReported: engagementSelfReported,
      // E1 synthesis prose is export-gated inside the builder (a report
      // artifact is an export path; ungrounded narratives are withheld).
      synthesis: buildReportEngagementSynthesis(
        (engagementCampaignResult.data as { ai_synthesis_json?: unknown } | null)?.ai_synthesis_json ??
          null
      ),
    });

    const reportRunLinkRows = (reportRunLinksResult.data ?? []) as Array<{
      id: string;
      run_id: string | null;
      model_run_id?: string | null;
      county_run_id?: string | null;
      sort_order: number;
    }>;
    const runIds = reportRunLinkRows
      .map((item) => item.run_id)
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
            .select("id, title, query_text, summary_text, ai_interpretation, metrics, created_at")
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
      const firstRunError = runsResult.error ?? citedModelRunsResult.error ?? citedCountyRunsResult.error;
      audit.error("report_runs_load_failed", {
        reportId: report.id,
        message: firstRunError?.message ?? "unknown",
        code: firstRunError?.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load linked runs" }, { status: 500 });
    }

    const runMap = new Map((runsResult.data ?? []).map((run) => [run.id, run]));
    const linkedRuns = reportRunLinkRows
      .map((item) => (item.run_id ? runMap.get(item.run_id) ?? null : null))
      .filter((item): item is NonNullable<(typeof runsResult.data)[number]> => Boolean(item));
    // Cited typed evidence, in citation order. The document renders these
    // alongside legacy run cards with their honest engine/status framing.
    const citedModelRunMap = new Map(
      ((citedModelRunsResult.data ?? []) as Array<{
        id: string;
        run_title: string;
        engine_key: string;
        status: string;
        result_summary_json: Record<string, unknown> | null;
      }>).map((run) => [run.id, run])
    );
    const citedCountyRunMap = new Map(
      ((citedCountyRunsResult.data ?? []) as Array<{
        id: string;
        run_name: string | null;
        stage: string | null;
        validation_summary_json: Record<string, unknown> | null;
      }>).map((run) => [run.id, run])
    );
    // A CITED RUN TRAVELS WITH ITS CLAIM TIER — including into the packet, which
    // is the artifact an agency hands a funder and therefore the surface where an
    // undisclosed tier costs the most. This route cannot reuse `resolveCitedRuns`
    // (it needs `result_summary_json`, which that resolver does not select), so it
    // wraps its own rows in the SAME shared lookup rather than growing a second,
    // weaker one here. Best-effort: a failed claim read marks every row
    // `claimReadFailed`, so the packet says the tier COULD NOT BE READ rather
    // than that no claim decision exists.
    const citedModelRuns = await withCitedModelRunClaimTiers(
      supabase,
      reportRunLinkRows
        .map((item) => (item.model_run_id ? citedModelRunMap.get(item.model_run_id) ?? null : null))
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
    );
    const citedCountyRuns = reportRunLinkRows
      .map((item) => (item.county_run_id ? citedCountyRunMap.get(item.county_run_id) ?? null : null))
      .filter((item): item is NonNullable<typeof item> => Boolean(item));

    const runAudit = linkedRuns.map((run) => ({
      runId: run.id,
      gate: evaluateReportArtifactGate(run),
      transparency: buildSourceTransparency(run.metrics ?? {}, typeof run.ai_interpretation === "string" ? "ai" : "fallback"),
    }));
    const linkedRunContext = linkedRuns.map((run) => ({
      id: run.id,
      title: run.title ?? "Untitled run",
      created_at: run.created_at ?? report.created_at,
    }));
    const scenarioSetLinksResult = await loadReportScenarioSetLinks({
      supabase: supabase as unknown as ReportScenarioSupabaseLike,
      linkedRuns: linkedRunContext,
      onSchemaPending: (warning) => {
        audit.warn("scenario_spine_schema_pending", {
          reportId: report.id,
          source: warning.source,
          message: warning.message,
        });
      },
    });

    if (scenarioSetLinksResult.error) {
      audit.error("report_scenario_context_load_failed", {
        reportId: report.id,
        message: scenarioSetLinksResult.error.message,
        code: scenarioSetLinksResult.error.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load scenario provenance" }, { status: 500 });
    }

    const scenarioSetLinks = scenarioSetLinksResult.data;
    // Same refusal as the RTP branch, for the same reason: `modelingEvidence`
    // becomes a COUNT and a claim-tier list in a packet an agency hands a
    // funder, and a zero derived from a failed read is indistinguishable from a
    // zero that is true.
    const modelingEvidenceRead = await projectModelingEvidencePromise;
    const modelingEvidenceFailure = classifyModelingEvidenceReadFailure(modelingEvidenceRead);

    if (modelingEvidenceFailure) {
      audit.error("report_modeling_evidence_load_failed", {
        reportId: report.id,
        message: modelingEvidenceFailure.message,
        pendingSchema: modelingEvidenceFailure.pending,
      });
      return NextResponse.json(modelingEvidenceFailure.body, { status: modelingEvidenceFailure.status });
    }

    const modelingEvidence = modelingEvidenceRead.items;
    const modelingEvidenceMetadata = summarizeReportModelingEvidenceForMetadata(modelingEvidence);
    const modelingEvidenceClaimStatuses = extractReportModelingEvidenceClaimStatuses(modelingEvidence);

    const projectRecordsSnapshot = buildProjectRecordSnapshot({
      deliverables: deliverablesResult.data ?? [],
      risks: risksResult.data ?? [],
      issues: issuesResult.data ?? [],
      decisions: decisionsResult.data ?? [],
      meetings: meetingsResult.data ?? [],
    });
    const projectFundingSnapshot = buildProjectFundingSnapshot({
      profile: fundingProfileResult.data,
      awards: fundingAwardsResult.data ?? [],
      opportunities: fundingOpportunitiesResult.data ?? [],
      invoices: billingInvoicesResult.data ?? [],
      capturedAt: new Date().toISOString(),
      projectUpdatedAt: projectResult.data.updated_at,
    });
    const projectFundingStackSummary = buildProjectFundingStackSummary(
      fundingProfileResult.data,
      fundingAwardsResult.data ?? [],
      fundingOpportunitiesResult.data ?? [],
      billingInvoicesResult.data ?? []
    );
    const billingInvoices = (billingInvoicesResult.data ?? []) as Array<{
      funding_award_id?: string | null;
      amount?: number | string | null;
      net_amount?: number | string | null;
    }>;
    const unlinkedFundingInvoices = billingInvoices.filter((invoice) => !invoice.funding_award_id);
    const unlinkedInvoiceAmount = unlinkedFundingInvoices.reduce((sum, invoice) => {
      const value = invoice.net_amount ?? invoice.amount ?? 0;
      const parsed = typeof value === "number" ? value : Number.parseFloat(String(value));
      return sum + (Number.isFinite(parsed) ? parsed : 0);
    }, 0);
    const hasComparisonEvidence = hasReadyScenarioComparisonEvidence(scenarioSetLinks);
    const projectFundingProfileScan = buildProjectFundingProfileScan({
      summary: projectFundingStackSummary,
      hasComparisonEvidence,
      unlinkedInvoiceCount: unlinkedFundingInvoices.length,
      unlinkedInvoiceAmount,
    });
    const stageGateSnapshot = buildProjectStageGateSnapshot(
      buildProjectStageGateSummary(
        (stageGateDecisionsResult.data ?? []) as ProjectStageGateDecisionRow[],
        { projectId: report.project_id }
      )
    );

    const evidenceChainSummary = buildEvidenceChainSummary({
      linkedRunCount: linkedRuns.length,
      scenarioSetLinks,
      projectRecordsSnapshot,
      engagementCampaignCurrent: engagement
        ? {
            status: engagement.campaign.status,
          }
        : null,
      engagementItemCount: engagement?.counts.totalItems ?? 0,
      engagementReadyForHandoffCount:
        engagement?.counts.moderationQueue.readyForHandoffCount ?? 0,
      stageGateSnapshot,
      modelingEvidenceCount: modelingEvidence.length,
      modelingEvidenceClaimStatuses,
    });

    // Aerial provenance for the packet. The report detail page already parses
    // and renders this key; until it was written here the read side always
    // parsed `undefined` and every packet reported "no aerial evidence source
    // context captured", including packets whose project had operator-reviewed
    // evidence packages sitting right there.
    //
    // A failed read is recorded AS a failed read. Both a project with no aerial
    // work and a database that could not answer produce zero rows, and only one
    // of them means "there is none"; conflating them would let the artifact
    // state an absence it never established.
    const aerialSourceRows = await loadAerialSourceContextRowsForProject(
      supabase,
      report.project_id
    );
    if (aerialSourceRows.unreadableReason) {
      audit.warn("report_aerial_source_context_unreadable", {
        reportId: report.id,
        projectId: report.project_id,
        reason: aerialSourceRows.unreadableReason,
      });
    }
    const aerialEvidenceSourceContext = aerialSourceRows.unreadableReason
      ? buildReportAerialEvidenceReadFailureContext(aerialSourceRows.unreadableReason)
      : buildReportAerialEvidenceSourceContext({
          missions: aerialSourceRows.missions,
          packages: aerialSourceRows.packages,
        });

    const scenarioSpineSummary = {
      assumptionSetCount: scenarioSetLinks.reduce(
        (sum, link) => sum + (link.sharedSpine?.assumptionSetCount ?? 0),
        0
      ),
      dataPackageCount: scenarioSetLinks.reduce(
        (sum, link) => sum + (link.sharedSpine?.dataPackageCount ?? 0),
        0
      ),
      indicatorSnapshotCount: scenarioSetLinks.reduce(
        (sum, link) => sum + (link.sharedSpine?.indicatorSnapshotCount ?? 0),
        0
      ),
      pendingCount: scenarioSetLinks.filter((link) => link.sharedSpine?.schemaPending).length,
      latestAssumptionSetUpdatedAt: maxTimestamp(
        scenarioSetLinks.map((link) => link.sharedSpine?.latestAssumptionSetUpdatedAt ?? null)
      ),
      latestDataPackageUpdatedAt: maxTimestamp(
        scenarioSetLinks.map((link) => link.sharedSpine?.latestDataPackageUpdatedAt ?? null)
      ),
      latestIndicatorSnapshotAt: maxTimestamp(
        scenarioSetLinks.map((link) => link.sharedSpine?.latestIndicatorSnapshotAt ?? null)
      ),
    };
    const fundingSourceContextReadiness = buildFundingSourceContextReadiness({
      hasComparisonEvidence,
      linkedRunCount: linkedRuns.length,
      modelingEvidenceCount: modelingEvidenceMetadata.length,
      engagementReadyForHandoffCount:
        engagement?.counts.moderationQueue.readyForHandoffCount ?? 0,
      stageGateHoldCount: stageGateSnapshot.holdCount,
      fundingScanStatus: projectFundingProfileScan.status,
    });

    // Operator-ACCEPTED AI narrative blocks. Generation stays deterministic:
    // only status='accepted' rows are read (drafts and dismissed rows are
    // ignored), staleness is recomputed against the LIVE fact list via
    // facts_hash, and a mismatch renders a visible disclosure in the packet —
    // never a silent drop and never a silent regeneration. safeOptionalQuery
    // keeps a pre-20260727000013 database honest: no table means no blocks.
    const acceptedNarrativeRowsResult = await safeOptionalQuery(
      () =>
        supabase
          .from("document_narrative_drafts")
          .select(
            "id, workspace_id, target_kind, target_id, section_key, draft_markdown, model, grounding_json, grounded_sentence_count, total_sentence_count, facts_hash, status, accepted_markdown, accepted_by, accepted_at, created_by, created_at"
          )
          .eq("target_kind", "report_section")
          .eq("target_id", report.id)
          .eq("status", "accepted")
          .order("accepted_at", { ascending: true }),
      [] as Array<Record<string, unknown>>
    );

    if (acceptedNarrativeRowsResult.error) {
      audit.error("report_narrative_drafts_load_failed", {
        reportId: report.id,
        message: acceptedNarrativeRowsResult.error.message,
        code: acceptedNarrativeRowsResult.error.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load accepted narrative drafts" }, { status: 500 });
    }

    const sectionFactsInput: ReportSectionFactsInput = {
      report: {
        title: report.title,
        summary: report.summary ?? null,
        report_type: report.report_type,
      },
      project: projectResult.data,
      runs: linkedRuns as ReportSectionFactsRun[],
      citedModelRuns: citedModelRuns as ReportCitedModelRun[],
      citedCountyRuns: citedCountyRuns as ReportCitedCountyRun[],
      projectFundingSnapshot,
    };
    const acceptedNarratives = buildAcceptedSectionNarratives(
      acceptedNarrativeRowsResult.data ?? [],
      (sectionKey) => factsHash(buildReportSectionFacts(sectionFactsInput, sectionKey))
    );

    const html = buildReportHtml({
      report,
      workspace: workspaceResult.data,
      project: projectResult.data,
      runs: linkedRuns,
      sections: sectionsResult.data ?? [],
      deliverables: (deliverablesResult.data ?? []).map((item) => ({
        id: item.id,
        title: item.title,
        detail: item.summary,
        status: item.status,
        at: item.due_date ?? item.created_at,
      })),
      risks: (risksResult.data ?? []).map((item) => ({
        id: item.id,
        title: item.title,
        detail: item.description,
        status: item.status,
        at: item.created_at,
      })),
      issues: (issuesResult.data ?? []).map((item) => ({
        id: item.id,
        title: item.title,
        detail: item.description,
        status: item.status,
        at: item.created_at,
      })),
      decisions: (decisionsResult.data ?? []).map((item) => ({
        id: item.id,
        title: item.title,
        detail: item.rationale,
        status: item.status,
        at: item.decided_at ?? item.created_at,
      })),
      meetings: (meetingsResult.data ?? []).map((item) => ({
        id: item.id,
        title: item.title,
        detail: item.notes,
        at: item.meeting_at ?? item.created_at,
      })),
      engagement,
      scenarioSetLinks,
      projectFundingSnapshot,
      projectRecordsSnapshot,
      stageGateSnapshot,
      modelingEvidence,
      citedModelRuns,
      citedCountyRuns,
      acceptedNarratives,
    });

    const format = parsed.data.format;
    const generatedAt = new Date().toISOString();
    const artifactId = crypto.randomUUID();
    let projectPdfStoragePath: string | null = null;
    let pdfEngine: ReportPdfEngine | null = null;
    const reportTitleForPdf = typeof report.title === "string" && report.title.trim()
      ? report.title.trim()
      : "OpenPlan report";
    if (format === "pdf") {
      // See the RTP branch above: a missing browser engine is a typesetting
      // tier, not a failed deliverable.
      const rendered = await renderReportPdf(html, {
        title: reportTitleForPdf,
        generatedAt,
        footerLabel: "OpenPlan",
      });
      pdfEngine = rendered.engine;
      if (rendered.engine === "builtin") {
        audit.warn("report_pdf_builtin_typesetter_used", {
          reportId: report.id,
          pageCount: rendered.pageCount,
        });
      }
      const pdfBuffer = Buffer.from(rendered.bytes);
      const storagePath = `${report.workspace_id}/${report.id}/${artifactId}.pdf`;
      const { error: uploadError } = await supabase.storage
        .from("report-artifacts")
        .upload(storagePath, pdfBuffer, { contentType: "application/pdf", upsert: false });
      if (uploadError) {
        audit.error("report_pdf_upload_failed", {
          reportId: report.id,
          message: uploadError.message,
        });
        return NextResponse.json({ error: "Failed to upload PDF artifact" }, { status: 500 });
      }
      projectPdfStoragePath = storagePath;
    }
    const artifactMetadata = {
      metadata_schema_version: "2026-04",
      htmlContent: html,
      generatedAt,
      // Which typesetting tier produced the stored file, so the record can
      // answer "why does this PDF look different" without re-rendering it.
      pdfEngine,
      auditability: {
        posture: "structured_packet_v1",
        note: "This output assembles structured records and linked run evidence as a review packet with explicit provenance.",
      },
      sourceContext: {
        reportOrigin: engagementProvenance?.origin ?? "report_builder",
        reportReason: engagementProvenance?.reason ?? null,
        projectUpdatedAt: projectResult.data.updated_at,
        linkedRunCount: linkedRuns.length,
        citedModelRunCount: citedModelRuns.length,
        citedCountyRunCount: citedCountyRuns.length,
        citedModelRuns: citedModelRuns.map((run) => ({
          id: run.id,
          runTitle: run.run_title,
          engineKey: run.engine_key,
          status: run.status,
        })),
        citedCountyRuns: citedCountyRuns.map((run) => ({
          id: run.id,
          runName: run.run_name,
          stage: run.stage,
        })),
        scenarioSetLinkCount: scenarioSetLinks.length,
        scenarioSetLinks,
        scenarioSpineSummary,
        deliverableCount: deliverablesResult.data?.length ?? 0,
        riskCount: risksResult.data?.length ?? 0,
        issueCount: issuesResult.data?.length ?? 0,
        decisionCount: decisionsResult.data?.length ?? 0,
        meetingCount: meetingsResult.data?.length ?? 0,
        stageGateSnapshot,
        projectRecordsSnapshot,
        projectFundingSnapshot,
        projectFundingProfileScan,
        fundingSourceContextReadiness,
        evidenceChainSummary,
        aerialEvidenceSourceContext,
        modelingEvidence: modelingEvidenceMetadata,
        modelingEvidenceCount: modelingEvidenceMetadata.length,
        modelingEvidenceClaimStatuses,
        // Which sections carry an operator-accepted AI narrative, with the
        // grounding stats and the staleness verdict computed at THIS
        // generation — the artifact record can answer "was that block
        // AI-assisted, and was it current?" without re-deriving anything.
        acceptedAiNarratives: acceptedNarratives.map((narrative) => ({
          draftId: narrative.draftId,
          sectionKey: narrative.sectionKey,
          model: narrative.model,
          groundedSentenceCount: narrative.groundedSentenceCount,
          totalSentenceCount: narrative.totalSentenceCount,
          acceptedAt: narrative.acceptedAt,
          operatorEdited: narrative.operatorEdited,
          staleAtGeneration: narrative.stale,
        })),
        acceptedAiNarrativeCount: acceptedNarratives.length,
        engagementCampaignId:
          engagement?.campaign.id ?? engagementProvenance?.campaign.id ?? null,
        engagementCampaignSnapshot: engagementProvenance?.campaign ?? null,
        engagementSnapshotCapturedAt: engagementProvenance?.capturedAt || null,
        engagementCountsSnapshot: engagementProvenance?.counts ?? null,
        engagementCampaignCurrent:
          engagement?.campaign
            ? {
                id: engagement.campaign.id,
                title: engagement.campaign.title,
                summary: engagement.campaign.summary,
                status: engagement.campaign.status,
                engagementType: engagement.campaign.engagement_type,
                updatedAt: engagement.campaign.updated_at,
              }
            : null,
        engagementItemCount: engagement?.counts.totalItems ?? 0,
        engagementReadyForHandoffCount:
          engagement?.counts.moderationQueue.readyForHandoffCount ?? 0,
        auditWarningCount: runAudit.reduce(
          (count, item) => count + item.gate.missingArtifacts.length,
          0
        ),
      },
      runAudit,
      generationMode: format === "pdf" ? "structured_pdf_packet" : "structured_html_packet",
    };

    const { data: artifact, error: artifactError } = await supabase
      .from("report_artifacts")
      .insert({
        id: artifactId,
        report_id: report.id,
        artifact_kind: format,
        storage_path: projectPdfStoragePath,
        generated_by: user.id,
        generated_at: generatedAt,
        metadata_json: artifactMetadata,
      })
      .select("id, report_id, artifact_kind, generated_at, metadata_json")
      .single();

    if (artifactError || !artifact) {
      audit.error("artifact_insert_failed", {
        reportId: report.id,
        message: artifactError?.message ?? "unknown",
        code: artifactError?.code ?? null,
      });
      return NextResponse.json({ error: "Failed to persist report artifact" }, { status: 500 });
    }

    // See the RTP branch: a link to the FILE when one was stored.
    const latestArtifactUrl = projectPdfStoragePath
      ? `/api/reports/${report.id}/artifacts/${artifact.id}/download`
      : `/reports/${report.id}#artifact-${artifact.id}`;
    const artifactHistoryEntry = buildArtifactHistoryEntry({
      artifactId: artifact.id,
      artifactKind: format,
      generatedAt,
      generatedBy: user.id,
      generationMode: artifactMetadata.generationMode,
      sourceContext: artifactMetadata.sourceContext,
    });
    const nextMetadataJson = {
      ...appendArtifactHistory(report.metadata_json, artifactHistoryEntry),
      queueTrace: {
        action: report.generated_at ? "refresh_artifact" : "generate_first_artifact",
        actedAt: generatedAt,
        actorUserId: user.id,
        source: "reports.generate",
        detail: report.generated_at ? "Refreshed report artifact." : "Generated first report artifact.",
      },
    };

    let reportUpdateResult = await supabase
      .from("reports")
      .update({
        status: "generated",
        generated_at: generatedAt,
        latest_artifact_kind: format,
        latest_artifact_url: latestArtifactUrl,
        metadata_json: nextMetadataJson,
        rtp_basis_stale: false,
        rtp_basis_stale_reason: null,
        rtp_basis_stale_run_id: null,
        rtp_basis_stale_marked_at: null,
      })
      .eq("id", report.id);

    if (reportUpdateResult.error && looksLikePendingSchema(reportUpdateResult.error.message)) {
      reportUpdateResult = await supabase
        .from("reports")
        .update({
          status: "generated",
          generated_at: generatedAt,
          latest_artifact_kind: format,
          latest_artifact_url: latestArtifactUrl,
        })
        .eq("id", report.id);
    }

    const { error: reportUpdateError } = reportUpdateResult;

    if (reportUpdateError) {
      audit.error("report_update_failed", {
        reportId: report.id,
        message: reportUpdateError.message,
        code: reportUpdateError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to update report generation status" }, { status: 500 });
    }

    audit.info("report_generated", {
      reportId: report.id,
      artifactId: artifact.id,
      format,
      storagePath: projectPdfStoragePath,
      userId: user.id,
      linkedRunCount: linkedRuns.length,
      modelingEvidenceCount: modelingEvidenceMetadata.length,
      modelingEvidenceClaimStatuses,
      durationMs: Date.now() - startedAt,
    });

    const executionCompletedAt = new Date().toISOString();
    const executionStartedAt = new Date(startedAt).toISOString();
    const serviceSupabase = createServiceRoleClient();
    const approval = await verifyAssistantActionApproval({
      request,
      serviceSupabase,
      userId: user.id,
      workspaceId: report.workspace_id,
      action: {
        kind: "generate_report_artifact",
        reportId: report.id,
      },
    });
    const { error: executionAuditError } = await recordAssistantActionExecution(serviceSupabase, {
      workspaceId: report.workspace_id,
      userId: user.id,
      actionKind: "generate_report_artifact",
      auditEvent: "planner_agent.generate_report_artifact",
      approval: "safe",
      regrounding: "refresh_preview",
      outcome: "succeeded",
      ...assistantActionAuditIdentity(approval),
      inputSummary: {
        reportId: report.id,
        artifactId: artifact.id,
        linkedRunCount: linkedRuns.length,
      },
      startedAt: executionStartedAt,
      completedAt: executionCompletedAt,
    });

    if (executionAuditError) {
      audit.warn("assistant_action_execution_audit_failed", {
        reportId: report.id,
        artifactId: artifact.id,
        message: executionAuditError.message,
        code: executionAuditError.code ?? null,
      });
    }

    return NextResponse.json(
      {
        reportId: report.id,
        artifactId: artifact.id,
        format,
        latestArtifactUrl,
        storagePath: projectPdfStoragePath,
        warnings: runAudit.flatMap((item) =>
          item.gate.missingArtifacts.map((missingArtifact) => ({
            runId: item.runId,
            missingArtifact,
          }))
        ),
      },
      { status: 200 }
    );
  } catch (error) {
    audit.error("reports_generate_unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json({ error: "Unexpected error while generating report" }, { status: 500 });
  }
}
