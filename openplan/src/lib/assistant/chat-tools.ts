/* eslint-disable @typescript-eslint/no-explicit-any */

import { z } from "zod";
import { tool, type Tool, type ToolSet } from "ai";
import type { AssistantContext } from "@/lib/assistant/context";
import { loadAssistantContext } from "@/lib/assistant/context";
import { buildAssistantChatContextLines } from "@/lib/assistant/chat-context";
import { buildAssistantOperations } from "@/lib/assistant/operations";
import { excerptPageLabel, retrieveKnowledgeBaseExcerpts } from "@/lib/knowledge-base/retrieval";
import {
  GRANT_PROGRAM_BUNDLES,
  listGrantProgramsWithBundle,
} from "@/lib/grants/program-catalog";
import { getReportPacketFreshness } from "@/lib/reports/catalog";
import {
  ACTION_METADATA,
  resolveQuickLinkApproval,
  type ActionApproval,
} from "@/lib/runtime/action-metadata";
import {
  assistantApprovalActionSchema,
  type AssistantApprovalAction,
} from "@/lib/assistant/action-approval-server";
import { ASSISTANT_TARGET_KINDS, type AssistantTargetKind } from "@/lib/assistant/catalog";
import { normalizeModelRunKpiComparisonItems } from "@/lib/models/kpi-comparison";
import {
  LINK_VALIDATION_NOT_SUPPORTED_CAVEAT,
  bandIntrazonalShare,
} from "@/lib/models/zone-resolution";
import {
  MODELING_CLAIM_STATUSES,
  MODELING_CLAIM_STATUS_RANK,
  isModelingClaimStatus,
  loadCountyRunModelingEvidence,
  loadModelRunClaimStatuses,
  modelingClaimReportLanguage,
  modelingClaimStatusLabel,
  type ModelingClaimDecision,
  type ModelingClaimStatus,
  type ModelingEvidenceSupabaseLike,
} from "@/lib/models/evidence-backbone";
import { isScreeningGradeStage } from "@/lib/models/caveat-gate";
import {
  getCountyRunAllowedClaim,
  getCountyRunCaveats,
  getCountyRunStageLabel,
  type CountyRunStage,
} from "@/lib/models/county-onramp";
import {
  GRANTS_GOV_DEFAULT_ROWS,
  GRANTS_GOV_SEARCH_ENDPOINT,
  GRANTS_GOV_SYNC_CAVEAT,
  buildGrantsGovSearchBody,
  parseGrantsGovSearchResponse,
  truncateForField,
  type GrantsGovSearchResult,
} from "@/lib/grants/grants-gov";
import {
  getCachedGrantsGovResult,
  setCachedGrantsGovResult,
} from "@/lib/grants/grants-gov-cache";
import { aggregateCampaignSurvey } from "@/lib/engagement/survey-responses";

/**
 * Read-only chat tools for the Planner Agent streaming endpoint.
 *
 * Every tool closes over the USER-SESSION Supabase client, so RLS applies to
 * every query — a tool can never see rows the signed-in planner cannot see.
 * The service-role client is deliberately unreachable from this module: tools
 * must not import it, and the guard test enforces that at the source level.
 *
 * Tools return small projections with hard row limits so a single chat turn
 * cannot exfiltrate a workspace or blow up the prompt budget. A per-request
 * {@link ChatToolBudget} bounds how many tool calls one chat turn may spend;
 * exhaustion produces a polite refusal payload — never a throw — so the model
 * can explain the limit instead of the stream erroring.
 */

export const ASSISTANT_CHAT_TOOL_MAX_CALLS = 12;
export const ASSISTANT_CHAT_TOOL_MAX_KB_SEARCHES = 3;

/** Hard row caps, disclosed in tool output so the model knows a list may be truncated. */
export const ASSISTANT_CHAT_TOOL_LIST_LIMIT = 25;
export const ASSISTANT_CHAT_TOOL_KB_EXCERPT_LIMIT = 8;
export const ASSISTANT_CHAT_TOOL_OPERATIONS_LIMIT = 30;
export const ASSISTANT_CHAT_TOOL_KPI_LIMIT = 100;
export const ASSISTANT_CHAT_TOOL_VALIDATION_LIMIT = 50;
export const ASSISTANT_CHAT_TOOL_COMMENT_EXCERPT_LIMIT = 10;
export const ASSISTANT_CHAT_TOOL_COMMENT_EXCERPT_MAX_CHARS = 280;
export const ASSISTANT_CHAT_TOOL_SURVEY_QUESTION_LIMIT = 25;
/** grants.gov page size — the lib default, restated here only as the disclosed cap. */
export const ASSISTANT_CHAT_TOOL_GRANTS_GOV_ROWS = GRANTS_GOV_DEFAULT_ROWS;
const GRANTS_GOV_TOOL_TIMEOUT_MS = 10_000;

export type ChatToolCallRecord = {
  toolCallId: string;
  tool: string;
  ok: boolean;
  durationMs: number;
};

export type ChatToolBudget = {
  maxCalls: number;
  maxKnowledgeBaseSearches: number;
  usedCalls: number;
  usedKnowledgeBaseSearches: number;
  /** Per-request call ledger the route drains into audit events. */
  ledger: ChatToolCallRecord[];
};

export function createChatToolBudget(overrides?: {
  maxCalls?: number;
  maxKnowledgeBaseSearches?: number;
}): ChatToolBudget {
  return {
    maxCalls: overrides?.maxCalls ?? ASSISTANT_CHAT_TOOL_MAX_CALLS,
    maxKnowledgeBaseSearches: overrides?.maxKnowledgeBaseSearches ?? ASSISTANT_CHAT_TOOL_MAX_KB_SEARCHES,
    usedCalls: 0,
    usedKnowledgeBaseSearches: 0,
    ledger: [],
  };
}

type ChatToolAuditLike = {
  info: (event: string, fields?: Record<string, unknown>) => void;
  warn: (event: string, fields?: Record<string, unknown>) => void;
  error: (event: string, fields?: Record<string, unknown>) => void;
};

/**
 * Deliberately loose Supabase shape, following the repo convention of untyped
 * clients (see src/lib/knowledge-base/documents.ts). The one hard requirement:
 * this must be the caller's SESSION client so RLS scopes every read.
 */
type ChatToolsSupabaseLike = {
  from: (table: string) => any;
  rpc?: (fn: string, args: Record<string, unknown>) => any;
};

export type BuildAssistantChatToolsParams = {
  supabase: ChatToolsSupabaseLike;
  context: AssistantContext;
  userId: string;
  audit: ChatToolAuditLike;
  budget: ChatToolBudget;
};

/* The catalog's own list, not a copy of it. This file kept the second copy; the
   API route kept a third, and the third one was seven kinds short. See
   ASSISTANT_TARGET_KINDS in catalog.ts. */
const ASSISTANT_TARGET_KIND_VALUES = ASSISTANT_TARGET_KINDS;

type ChatToolRefusal = { status: "refused"; reason: string };
type ChatToolError = { status: "error"; message: string };
type ChatToolPayload = Record<string, unknown>;

function refusal(reason: string): ChatToolRefusal {
  return { status: "refused", reason };
}

/**
 * Wraps a tool body with budget enforcement, timing, ledger recording, and
 * error containment. Refusals do not consume budget; only executed calls do.
 */
function guarded<INPUT>(params: {
  name: string;
  budget: ChatToolBudget;
  audit: ChatToolAuditLike;
  countsAsKnowledgeBaseSearch?: boolean;
  run: (input: INPUT) => Promise<ChatToolPayload>;
}): (input: INPUT, options: { toolCallId: string }) => Promise<ChatToolPayload | ChatToolRefusal | ChatToolError> {
  return async (input, options) => {
    const { budget } = params;
    if (budget.usedCalls >= budget.maxCalls) {
      return refusal(
        `The per-question tool budget (${budget.maxCalls} lookups) is spent. Answer from what has already been gathered, and tell the planner they can ask a follow-up question for more.`
      );
    }
    if (params.countsAsKnowledgeBaseSearch && budget.usedKnowledgeBaseSearches >= budget.maxKnowledgeBaseSearches) {
      return refusal(
        `The per-question knowledge-base search budget (${budget.maxKnowledgeBaseSearches} searches) is spent. Work with the excerpts already retrieved.`
      );
    }

    budget.usedCalls += 1;
    if (params.countsAsKnowledgeBaseSearch) {
      budget.usedKnowledgeBaseSearches += 1;
    }

    const startedAt = Date.now();
    try {
      const result = await params.run(input);
      budget.ledger.push({
        toolCallId: options.toolCallId,
        tool: params.name,
        ok: true,
        durationMs: Date.now() - startedAt,
      });
      return result;
    } catch (error) {
      budget.ledger.push({
        toolCallId: options.toolCallId,
        tool: params.name,
        ok: false,
        durationMs: Date.now() - startedAt,
      });
      params.audit.warn("assistant_chat_tool_failed", {
        tool: params.name,
        message: error instanceof Error ? error.message : String(error),
      });
      return {
        status: "error",
        message: `The ${params.name} tool failed while reading workspace data. Answer from the context you already have, and say what could not be verified.`,
      };
    }
  };
}

function isoOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * A structured write PROPOSAL the model can emit from chat. It never mutates
 * anything: the payload rides the stream to the copilot, where the planner's
 * "Approve & run" enters the EXISTING approval flow (mint single-use evidence
 * via /api/assistant/actions/approvals, then dispatch through the client-side
 * action registry with approval headers). The server-side approval verifier
 * stays the only gate.
 */
export type AssistantChatProposal = {
  status: "proposed";
  kind: AssistantApprovalAction["kind"];
  payload: AssistantApprovalAction;
  approval: ActionApproval;
  description: string;
};

export function isAssistantChatProposal(value: unknown): value is AssistantChatProposal {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.status === "proposed" &&
    typeof candidate.kind === "string" &&
    candidate.kind in ACTION_METADATA &&
    typeof candidate.description === "string" &&
    Boolean(candidate.payload) &&
    typeof candidate.payload === "object"
  );
}

/**
 * Post-action chaining fields are stripped from the model-facing input: they
 * feed follow-up prompts back into the agent, which a generated payload must
 * not be able to script. The proposal payload the planner approves is exactly
 * {kind, ...modelInput}.
 */
const PROPOSAL_HIDDEN_INPUT_FIELDS = ["kind", "postActionWorkflowId", "postActionPrompt", "postActionPromptLabel"] as const;

/**
 * RLS-scoped existence checks run before a proposal is emitted, so the model
 * cannot propose an action against a row the planner cannot see (or one in
 * another workspace). Kinds without an entry simply skip reference checks —
 * a new registry action still becomes a propose_ tool automatically.
 */
const PROPOSAL_REFERENCE_CHECKS: Partial<
  Record<AssistantApprovalAction["kind"], Array<{ field: string; table: string; optional?: boolean }>>
> = {
  generate_report_artifact: [{ field: "reportId", table: "reports" }],
  create_rtp_packet_record: [
    { field: "rtpCycleId", table: "rtp_cycles" },
    { field: "modelingCountyRunId", table: "county_runs", optional: true },
  ],
  create_funding_opportunity: [
    { field: "programId", table: "programs", optional: true },
    { field: "projectId", table: "projects", optional: true },
  ],
  create_project_funding_profile: [{ field: "projectId", table: "projects" }],
  update_funding_opportunity_decision: [{ field: "opportunityId", table: "funding_opportunities" }],
  create_project_record: [{ field: "projectId", table: "projects" }],
  record_stage_gate_hold: [
    { field: "projectId", table: "projects" },
    // The three run tables a gate decision may cite. Optional individually — the
    // route refuses more than one — so an uncited hold is still proposable, and
    // a hold citing a run from ANOTHER workspace is refused here rather than
    // being minted into approval evidence the route would later reject.
    { field: "runId", table: "runs", optional: true },
    { field: "modelRunId", table: "model_runs", optional: true },
    { field: "countyRunId", table: "county_runs", optional: true },
  ],
  link_billing_invoice_funding_award: [
    { field: "invoiceId", table: "billing_invoice_records" },
    { field: "fundingAwardId", table: "funding_awards" },
  ],
  /**
   * THE STOCK CHECK IS EXACTLY RIGHT HERE, AND FOR A REASON THAT WOULD BE A BUG
   * ANYWHERE ELSE — so it is written down rather than left to be rediscovered.
   *
   * The check below is `.eq("id", value).eq("workspace_id", workspaceId)`, and
   * SQL equality never matches NULL. `gtfs_feeds.workspace_id IS NULL` is how
   * this schema marks a PUBLIC PRELOADED FEED — one row every tenant on the
   * deployment reads — so a public feed resolves `not_found` here even though
   * the planner can see it on their own Data Hub.
   *
   * That is precisely the refresh route's own rule: a refresh writes a new
   * version and can move `current_version_id`, so refreshing a shared feed would
   * change what every OTHER workspace on the deployment analyses with, and the
   * route answers 403. The proposal is refused before approval evidence is
   * minted for something the route would reject anyway.
   *
   * For any table without that NULL-means-shared convention the same expression
   * would silently hide legitimate rows, which is why this note exists.
   */
  refresh_gtfs_feed: [{ field: "gtfsFeedId", table: "gtfs_feeds" }],
  // Both ids are checked against workspace-scoped rows before the proposal
  // is offered, so an agent cannot name a run in somebody else's workspace
  // and have the route be the first thing to notice.
  launch_model_run: [
    { field: "modelId", table: "models" },
    { field: "modelRunId", table: "model_runs" },
  ],
  /**
   * The campaign must belong to the workspace the approval is scoped to —
   * otherwise a draft could be proposed into another agency's survey builder,
   * where it would sit under their name waiting for one of their planners to
   * publish it. `engagement_campaigns` has a real `workspace_id` on every row,
   * so the stock `.eq("workspace_id", …)` check means what it says here (unlike
   * the feed table above, whose NULL is a deliberate shared-row marker).
   */
  create_survey_question_draft: [{ field: "campaignId", table: "engagement_campaigns" }],
  // `rtp_cycles` carries a real `workspace_id` on every row, so the stock
  // workspace-scoped check means what it says. `bandingProfileKey` is not a
  // row reference — the route parses it against the closed profile enum.
  create_rtp_horizon_bands_from_cycle_horizon: [{ field: "rtpCycleId", table: "rtp_cycles" }],
};

type ProposalSchemaBranch = z.ZodObject<Record<string, z.ZodTypeAny>>;

/**
 * Trim every string field of the model-authored input BEFORE validation, so
 * the payload the planner approves is byte-identical to what the executing
 * route hashes. Routes trim free-text fields (title, notes, …) when they
 * recompute the approval hash; an untrimmed proposal would mint single-use
 * evidence for a hash execution can never match — an inexplicable
 * post-approval 403. Trimming before Zod also means a whitespace-only
 * required field fails min-length validation instead of slipping through.
 */
function normalizeProposalInput(input: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    normalized[key] = typeof value === "string" ? value.trim() : value;
  }
  return normalized;
}

/** Resolve the per-kind branch of the approval action schema — the single source of truth. */
function proposalSchemaBranchForKind(kind: string): ProposalSchemaBranch | null {
  for (const option of assistantApprovalActionSchema.options) {
    const branch = option as ProposalSchemaBranch;
    const kindSchema = branch.shape?.kind;
    if (kindSchema && kindSchema.safeParse(kind).success) {
      return branch;
    }
  }
  return null;
}

/** The model-facing input schema: the branch minus kind and post-action chaining fields. */
function proposalInputSchema(branch: ProposalSchemaBranch): ProposalSchemaBranch {
  const mask: Record<string, true> = {};
  for (const field of PROPOSAL_HIDDEN_INPUT_FIELDS) {
    if (field in branch.shape) mask[field] = true;
  }
  return branch.omit(mask) as ProposalSchemaBranch;
}

function buildAssistantProposalTools(params: BuildAssistantChatToolsParams): Record<string, Tool<any, any>> {
  const { supabase, context, audit, budget } = params;
  const workspaceId = context.workspace.id;
  const tools: Record<string, Tool<any, any>> = {};

  for (const kind of Object.keys(ACTION_METADATA) as Array<AssistantApprovalAction["kind"]>) {
    const metadata = ACTION_METADATA[kind];
    const branch = proposalSchemaBranchForKind(kind);
    if (!branch) {
      // A registry action without a schema branch cannot be validated, so it
      // gets no propose tool. The approvals route would reject it anyway.
      audit.warn("assistant_chat_proposal_tool_skipped", { kind, reason: "no_schema_branch" });
      continue;
    }

    const toolName = `propose_${kind}`;
    tools[toolName] = tool({
      description: `PROPOSE (never execute) this Planner Agent action: ${metadata.description} Approval tier: ${metadata.approval}. The planner must approve the proposal card before anything changes.`,
      inputSchema: proposalInputSchema(branch),
      execute: guarded<Record<string, unknown>>({
        name: toolName,
        budget,
        audit,
        run: async (input) => {
          if (!workspaceId) {
            return refusal("No workspace is attached to this chat surface, so no action can be proposed.");
          }

          const parsed = branch.safeParse({ ...normalizeProposalInput(input), kind });
          if (!parsed.success) {
            return {
              status: "invalid_payload",
              message: `The proposed ${kind} payload is invalid: ${parsed.error.issues
                .map((issue) => `${issue.path.join(".") || "payload"}: ${issue.message}`)
                .join("; ")}`,
            };
          }
          const payload = parsed.data as AssistantApprovalAction;

          // Any workspaceId inside the payload must be THIS workspace.
          const payloadWorkspaceId = (payload as Record<string, unknown>).workspaceId;
          if (typeof payloadWorkspaceId === "string" && payloadWorkspaceId !== workspaceId) {
            return refusal("The proposal names a different workspace. Chat proposals only target the current workspace.");
          }

          for (const check of PROPOSAL_REFERENCE_CHECKS[kind] ?? []) {
            const value = (payload as Record<string, unknown>)[check.field];
            if (value === null || value === undefined) {
              if (check.optional) continue;
              return {
                status: "invalid_payload",
                message: `The proposed ${kind} payload is missing ${check.field}.`,
              };
            }
            const { data, error } = await supabase
              .from(check.table)
              .select("id")
              .eq("id", value)
              .eq("workspace_id", workspaceId)
              .maybeSingle();
            if (error) throw new Error(error.message ?? `${check.table} lookup failed`);
            if (!data) {
              return {
                status: "not_found",
                message: `No ${check.table} record ${String(value)} is visible in this workspace, so this action cannot be proposed. Verify the id with a list tool first.`,
              };
            }
          }

          const proposal: AssistantChatProposal = {
            status: "proposed",
            kind,
            payload,
            approval: metadata.approval,
            description: metadata.description,
          };
          return proposal as unknown as ChatToolPayload;
        },
      }),
    });
  }

  return tools;
}

/**
 * Caveat sentences stored beside a KPI value, VERBATIM.
 *
 * Producers stash their honesty text under breakdown_json keys like
 * `provenance`, `interpretation`, `zone_sample_skew_note` — the sentence IS the
 * stored record, so it travels with the number unmodified. This extracts, it
 * never composes: a caveat this function did not find is a caveat the producer
 * did not record.
 */
const KPI_CAVEAT_KEY_PATTERN = /caveat|note|provenance|interpretation/i;

function kpiBreakdownCaveats(breakdown: unknown): string[] {
  if (!breakdown || typeof breakdown !== "object" || Array.isArray(breakdown)) return [];
  const caveats: string[] = [];
  for (const [key, value] of Object.entries(breakdown as Record<string, unknown>)) {
    if (KPI_CAVEAT_KEY_PATTERN.test(key) && typeof value === "string" && value.trim().length > 0) {
      caveats.push(value);
    }
  }
  return caveats;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * What would move a recorded claim decision UP a tier, quoting the stored
 * blockers rather than inventing new ones. Evidence decides; this only reads
 * what the decision wrote down.
 */
function evidenceForHigherTier(
  status: ModelingClaimStatus,
  validationSummary: unknown,
  reasons: string[]
): string[] {
  if (status === "claim_grade_passed") {
    return ["This is the highest recorded claim tier."];
  }
  const notes: string[] = [];
  const summary =
    validationSummary && typeof validationSummary === "object"
      ? (validationSummary as { missingRequiredMetricKeys?: unknown })
      : null;
  const missing = Array.isArray(summary?.missingRequiredMetricKeys)
    ? summary.missingRequiredMetricKeys.filter((key): key is string => typeof key === "string")
    : [];
  for (const key of missing) {
    notes.push(`Record the required validation metric: ${key}`);
  }
  for (const reason of reasons) {
    notes.push(`Resolve, with recorded evidence: ${reason}`);
  }
  if (notes.length === 0) {
    notes.push(
      "The stored decision names no specific blocker. A higher tier needs a new validation pass whose required checks all pass — the agent cannot supply that evidence, only a run can."
    );
  }
  return notes;
}

const MODELING_VALIDATION_RESULT_SELECT =
  "track, metric_key, metric_label, observed_value, threshold_value, threshold_max_value, threshold_comparator, status, blocks_claim_grade, detail, evaluated_at";

/** Validation rows for chat, details VERBATIM — the detail sentence is the record. */
function projectValidationRows(rows: Array<Record<string, unknown>>) {
  return rows.map((row) => ({
    track: row.track ?? null,
    metricKey: row.metric_key ?? null,
    metricLabel: row.metric_label ?? null,
    observedValue: finiteNumber(row.observed_value),
    thresholdValue: finiteNumber(row.threshold_value),
    thresholdMaxValue: finiteNumber(row.threshold_max_value),
    thresholdComparator: row.threshold_comparator ?? null,
    status: row.status ?? null,
    blocksClaimGrade: typeof row.blocks_claim_grade === "boolean" ? row.blocks_claim_grade : null,
    detail: typeof row.detail === "string" ? row.detail : null,
    evaluatedAt: isoOrNull(row.evaluated_at),
  }));
}

/** The tier vocabulary and its ranking, so the model explains the ladder it is on. */
function claimTierLadder() {
  return MODELING_CLAIM_STATUSES.map((status) => ({
    tier: status,
    rank: MODELING_CLAIM_STATUS_RANK[status],
    label: modelingClaimStatusLabel(status),
  }));
}

/** The closed kind enum for list_workspace_records. Every table+projection pair
 * is a literal so the projection guard checks each column against the schema. */
const WORKSPACE_RECORD_LIST_KINDS = [
  "plans",
  "programs",
  "rtp_cycles",
  "scenario_sets",
  "models",
  "model_runs",
  "datasets",
  "gtfs_feeds",
  "campaigns",
  "client_invoices",
  "funding_awards",
  "billing_invoices",
] as const;

type WorkspaceRecordListKind = (typeof WORKSPACE_RECORD_LIST_KINDS)[number];

type WorkspaceRecordProjection = {
  id: unknown;
  title: unknown;
  status: unknown;
  updatedAt: string | null;
};

const WORKSPACE_RECORD_LISTS: Record<
  WorkspaceRecordListKind,
  {
    /** Starts the query. from()/select() stay literal in each entry on purpose. */
    query: (supabase: ChatToolsSupabaseLike) => any;
    orderColumn: string;
    project: (row: Record<string, unknown>) => WorkspaceRecordProjection;
    note?: string;
  }
> = {
  plans: {
    query: (supabase) => supabase.from("plans").select("id, title, status, updated_at"),
    orderColumn: "updated_at",
    project: (row) => ({ id: row.id, title: row.title ?? null, status: row.status ?? null, updatedAt: isoOrNull(row.updated_at) }),
  },
  programs: {
    query: (supabase) => supabase.from("programs").select("id, title, status, updated_at"),
    orderColumn: "updated_at",
    project: (row) => ({ id: row.id, title: row.title ?? null, status: row.status ?? null, updatedAt: isoOrNull(row.updated_at) }),
  },
  rtp_cycles: {
    query: (supabase) => supabase.from("rtp_cycles").select("id, title, status, updated_at"),
    orderColumn: "updated_at",
    project: (row) => ({ id: row.id, title: row.title ?? null, status: row.status ?? null, updatedAt: isoOrNull(row.updated_at) }),
  },
  scenario_sets: {
    query: (supabase) => supabase.from("scenario_sets").select("id, title, status, updated_at"),
    orderColumn: "updated_at",
    project: (row) => ({ id: row.id, title: row.title ?? null, status: row.status ?? null, updatedAt: isoOrNull(row.updated_at) }),
  },
  models: {
    query: (supabase) => supabase.from("models").select("id, title, status, updated_at"),
    orderColumn: "updated_at",
    project: (row) => ({ id: row.id, title: row.title ?? null, status: row.status ?? null, updatedAt: isoOrNull(row.updated_at) }),
  },
  model_runs: {
    query: (supabase) => supabase.from("model_runs").select("id, run_title, status, updated_at"),
    orderColumn: "updated_at",
    project: (row) => ({ id: row.id, title: row.run_title ?? null, status: row.status ?? null, updatedAt: isoOrNull(row.updated_at) }),
  },
  datasets: {
    query: (supabase) => supabase.from("data_datasets").select("id, name, status, updated_at"),
    orderColumn: "updated_at",
    project: (row) => ({ id: row.id, title: row.name ?? null, status: row.status ?? null, updatedAt: isoOrNull(row.updated_at) }),
  },
  gtfs_feeds: {
    // No updated_at on this table; loaded_at (when the feed data landed) is the
    // honest recency signal, with created_at as the fallback for unloaded rows.
    query: (supabase) => supabase.from("gtfs_feeds").select("id, agency_name, status, loaded_at, created_at"),
    orderColumn: "created_at",
    project: (row) => ({
      id: row.id,
      title: row.agency_name ?? null,
      status: row.status ?? null,
      updatedAt: isoOrNull(row.loaded_at) ?? isoOrNull(row.created_at),
    }),
    // NULL workspace_id marks a deployment-shared public feed; the workspace
    // equality filter cannot match NULL, so those rows are honestly out of scope
    // here — same rule the refresh proposal check documents above.
    note: "Shared public feeds (owned by no workspace) are not listed here; the Data Hub shows them.",
  },
  campaigns: {
    query: (supabase) => supabase.from("engagement_campaigns").select("id, title, status, updated_at"),
    orderColumn: "updated_at",
    project: (row) => ({ id: row.id, title: row.title ?? null, status: row.status ?? null, updatedAt: isoOrNull(row.updated_at) }),
  },
  client_invoices: {
    query: (supabase) => supabase.from("client_invoices").select("id, invoice_number, status, updated_at"),
    orderColumn: "updated_at",
    project: (row) => ({ id: row.id, title: row.invoice_number ?? null, status: row.status ?? null, updatedAt: isoOrNull(row.updated_at) }),
  },
  funding_awards: {
    query: (supabase) => supabase.from("funding_awards").select("id, title, spending_status, updated_at"),
    orderColumn: "updated_at",
    project: (row) => ({ id: row.id, title: row.title ?? null, status: row.spending_status ?? null, updatedAt: isoOrNull(row.updated_at) }),
  },
  billing_invoices: {
    query: (supabase) => supabase.from("billing_invoice_records").select("id, invoice_number, status, updated_at"),
    orderColumn: "updated_at",
    project: (row) => ({ id: row.id, title: row.invoice_number ?? null, status: row.status ?? null, updatedAt: isoOrNull(row.updated_at) }),
  },
};

function grantsGovToolPayload(
  result: GrantsGovSearchResult,
  meta: { cached: boolean; fetchedAt: number }
): ChatToolPayload {
  return {
    status: "ok",
    cached: meta.cached,
    fetchedAt: new Date(meta.fetchedAt).toISOString(),
    // The lib's own caveat sentence, verbatim — it travels with every result set.
    caveat: GRANTS_GOV_SYNC_CAVEAT,
    hitCount: result.hitCount,
    returnedCount: result.opportunities.length,
    rowCap: ASSISTANT_CHAT_TOOL_GRANTS_GOV_ROWS,
    truncated: result.hitCount > result.opportunities.length,
    opportunities: result.opportunities.map((opportunity) => ({
      id: opportunity.id,
      number: opportunity.number,
      title: opportunity.title,
      agencyCode: opportunity.agencyCode,
      agencyName: opportunity.agencyName,
      status: opportunity.status,
      openDate: opportunity.openDate,
      closeDate: opportunity.closeDate,
      cfdaList: opportunity.cfdaList,
      detailUrl: opportunity.detailUrl,
    })),
  };
}

/**
 * Evidence-reading tools: model-run results, claim-tier explanation, live
 * grants.gov search, the generic record lister, and campaign input reads.
 *
 * All of them follow the same rules as the seven tools above: USER-SESSION
 * client only (RLS scopes every read), hard disclosed row caps, refusals and
 * honest unavailability instead of throws, and no write path of any kind —
 * the tools EXPLAIN tiers, statuses and caveats but nothing they return can be
 * written back.
 */
function buildAssistantEvidenceReadTools(params: BuildAssistantChatToolsParams): Record<string, Tool<any, any>> {
  const { supabase, audit, budget, context } = params;
  const workspaceId = context.workspace.id;

  const getModelRunResults = tool({
    description:
      `Read one model run's recorded results: status, stored KPIs (max ${ASSISTANT_CHAT_TOOL_KPI_LIMIT} rows, values and units verbatim with their stored caveats), the zone-resolution diagnostic when recorded, validation checks, and the run's recorded claim tier. Nothing is recomputed — absent records are reported as absent.`,
    inputSchema: z.object({
      modelRunId: z.string().uuid().describe("The model run id (find it with list_workspace_records kind=model_runs)."),
    }),
    execute: guarded<{ modelRunId: string }>({
      name: "get_model_run_results",
      budget,
      audit,
      run: async (input) => {
        if (!workspaceId) return refusal("No workspace is attached to this chat surface.");

        const { data: run, error: runError } = await supabase
          .from("model_runs")
          .select("id, run_title, status, engine_key, error_message, started_at, completed_at, updated_at")
          .eq("id", input.modelRunId)
          .eq("workspace_id", workspaceId)
          .maybeSingle();
        if (runError) throw new Error(runError.message ?? "model_runs query failed");
        if (!run) {
          return {
            status: "not_found",
            message:
              "No model run with that id is visible in this workspace. It may not exist or may belong to a workspace this planner is not a member of.",
          };
        }
        const runRow = run as Record<string, unknown>;

        const { data: kpiData, error: kpiError } = await supabase
          .from("model_run_kpis")
          .select("kpi_name, kpi_label, kpi_category, value, unit, geometry_ref, breakdown_json")
          .eq("run_id", input.modelRunId)
          .order("kpi_category", { ascending: true })
          .order("kpi_name", { ascending: true })
          .limit(ASSISTANT_CHAT_TOOL_KPI_LIMIT);
        if (kpiError) throw new Error(kpiError.message ?? "model_run_kpis query failed");
        const kpiRows = (kpiData ?? []) as Array<Record<string, unknown>>;
        const kpiItems = normalizeModelRunKpiComparisonItems(kpiRows);

        // Zone resolution: the verdict is banded HERE from the stored share, via
        // the one lib that owns the judgement — never read back off the row.
        // (Same rule as the run page's zone-resolution panel.)
        const zoneRow = kpiRows.find((row) => row.kpi_name === "intrazonal_trip_share");
        const zoneShare = finiteNumber(zoneRow?.value);
        let zoneResolution: Record<string, unknown>;
        if (zoneRow && zoneShare !== null) {
          const breakdown =
            zoneRow.breakdown_json && typeof zoneRow.breakdown_json === "object"
              ? (zoneRow.breakdown_json as Record<string, unknown>)
              : {};
          const zoneCount = finiteNumber(breakdown.zone_count);
          const banded = bandIntrazonalShare(zoneShare * 100, zoneCount);
          zoneResolution = {
            status: "measured",
            intrazonalSharePct: banded.intrazonalSharePct,
            zoneCount,
            band: banded.band,
            supportsLinkLevelValidation: banded.supportsLinkLevelValidation,
            summary: banded.summary,
            caveat: banded.supportsLinkLevelValidation ? null : LINK_VALIDATION_NOT_SUPPORTED_CAVEAT,
          };
        } else {
          zoneResolution = {
            status: "not_recorded",
            message:
              "No zone-resolution diagnostic is recorded for this run — it may predate the diagnostic or have produced no trips. Do not treat that as a finding that the zone system is fine.",
          };
        }

        const { data: validationData, error: validationError } = await supabase
          .from("modeling_validation_results")
          .select(MODELING_VALIDATION_RESULT_SELECT)
          .eq("model_run_id", input.modelRunId)
          .order("created_at", { ascending: true })
          .limit(ASSISTANT_CHAT_TOOL_VALIDATION_LIMIT);
        if (validationError) throw new Error(validationError.message ?? "modeling_validation_results query failed");
        const validationRows = (validationData ?? []) as Array<Record<string, unknown>>;

        const claimByRun = await loadModelRunClaimStatuses({
          supabase: supabase as unknown as ModelingEvidenceSupabaseLike,
          modelRunIds: [input.modelRunId],
        });
        const claim = claimByRun.get(input.modelRunId) ?? null;

        const errorMessage =
          typeof runRow.error_message === "string" && runRow.error_message.trim().length > 0
            ? runRow.error_message
            : null;

        return {
          status: "ok",
          run: {
            id: runRow.id,
            title: runRow.run_title ?? null,
            status: runRow.status ?? null,
            engineKey: runRow.engine_key ?? null,
            startedAt: isoOrNull(runRow.started_at),
            completedAt: isoOrNull(runRow.completed_at),
            updatedAt: isoOrNull(runRow.updated_at),
            // A failed run's cause is quoted verbatim; an unrecorded cause is
            // reported as unrecorded — never invented.
            failure:
              runRow.status === "failed"
                ? {
                    errorMessage,
                    note: errorMessage
                      ? "Quote the recorded failure message verbatim."
                      : "This run failed and no failure cause was recorded. Say exactly that — do not invent a cause.",
                  }
                : null,
          },
          kpiCount: kpiRows.length,
          kpiRowCap: ASSISTANT_CHAT_TOOL_KPI_LIMIT,
          truncated: kpiRows.length === ASSISTANT_CHAT_TOOL_KPI_LIMIT,
          note:
            kpiRows.length === 0
              ? "No KPIs are recorded for this run. That is a recorded absence, not a failed read."
              : "Report each value with its unit and its caveats verbatim; never round a caveat away.",
          kpis: kpiItems.map((item, index) => ({
            name: item.name,
            label: item.label,
            category: item.category,
            value: item.currentValue,
            unit: item.unit,
            geometryRef: item.geometryRef,
            caveats: kpiBreakdownCaveats(kpiRows[index]?.breakdown_json),
          })),
          zoneResolution,
          validation: {
            resultCount: validationRows.length,
            rowCap: ASSISTANT_CHAT_TOOL_VALIDATION_LIMIT,
            note:
              validationRows.length === 0
                ? "No validation results are recorded against this run."
                : "Validation details are the stored sentences, verbatim.",
            results: projectValidationRows(validationRows),
          },
          claim: claim
            ? { tier: claim.status, label: modelingClaimStatusLabel(claim.status), reason: claim.reason }
            : {
                tier: null,
                label: modelingClaimStatusLabel(null),
                message: "No claim decision is recorded for this run — a known absence, not an unknown.",
              },
        };
      },
    }),
  });

  const explainModelClaim = tool({
    description:
      "Explain a run's modeling claim tier: the recorded tier, its stored reasons verbatim, the tier ladder, and what recorded evidence would support a higher tier. Pass exactly one of modelRunId (a model run) or countyRunId (a county onramp run). Explanation only — this tool changes nothing, and evidence decides tiers, never the agent.",
    inputSchema: z.object({
      modelRunId: z.string().uuid().nullable().optional(),
      countyRunId: z.string().uuid().nullable().optional(),
    }),
    execute: guarded<{ modelRunId?: string | null; countyRunId?: string | null }>({
      name: "explain_model_claim",
      budget,
      audit,
      run: async (input) => {
        if (!workspaceId) return refusal("No workspace is attached to this chat surface.");
        const modelRunId = input.modelRunId ?? null;
        const countyRunId = input.countyRunId ?? null;
        if ((modelRunId === null) === (countyRunId === null)) {
          return {
            status: "invalid_payload",
            message: "Pass exactly one of modelRunId or countyRunId.",
          };
        }

        if (modelRunId) {
          const { data: run, error: runError } = await supabase
            .from("model_runs")
            .select("id, run_title, status, engine_key")
            .eq("id", modelRunId)
            .eq("workspace_id", workspaceId)
            .maybeSingle();
          if (runError) throw new Error(runError.message ?? "model_runs query failed");
          if (!run) {
            return {
              status: "not_found",
              message: "No model run with that id is visible in this workspace.",
            };
          }
          const runRow = run as Record<string, unknown>;

          const { data: decisionData, error: decisionError } = await supabase
            .from("modeling_claim_decisions")
            .select("track, claim_status, status_reason, reasons_json, validation_summary_json, decided_at")
            .eq("model_run_id", modelRunId)
            .order("decided_at", { ascending: false })
            .limit(10);
          if (decisionError) throw new Error(decisionError.message ?? "modeling_claim_decisions query failed");
          const decisionRows = (decisionData ?? []) as Array<Record<string, unknown>>;

          const decisions = decisionRows
            .filter((row) => isModelingClaimStatus(row.claim_status))
            .map((row) => {
              const tier = row.claim_status as ModelingClaimStatus;
              const reasons = Array.isArray(row.reasons_json)
                ? row.reasons_json.filter((reason): reason is string => typeof reason === "string")
                : [];
              const statusReason = typeof row.status_reason === "string" ? row.status_reason : null;
              const validationSummary = row.validation_summary_json ?? null;
              return {
                track: row.track ?? null,
                tier,
                label: modelingClaimStatusLabel(tier),
                // The stored decision, quoted — not paraphrased.
                reason: statusReason,
                reasons,
                validationSummary,
                decidedAt: isoOrNull(row.decided_at),
                reportLanguage: modelingClaimReportLanguage({
                  track: row.track,
                  claimStatus: tier,
                  statusReason: statusReason ?? "",
                  reasons,
                  validationSummary,
                } as ModelingClaimDecision),
                evidenceForHigherTier: evidenceForHigherTier(tier, validationSummary, reasons),
              };
            });

          if (decisions.length === 0) {
            return {
              status: "ok",
              subject: { kind: "model_run", id: runRow.id, title: runRow.run_title ?? null },
              claimTier: null,
              label: modelingClaimStatusLabel(null),
              message:
                "No claim decision is recorded for this run. That is a known absence, not an uncertainty: nothing here has been validated, so its outputs cannot make outward planning claims until validation evidence is recorded.",
              tierLadder: claimTierLadder(),
            };
          }

          return {
            status: "ok",
            subject: { kind: "model_run", id: runRow.id, title: runRow.run_title ?? null },
            decisions,
            tierLadder: claimTierLadder(),
            note: "Quote the stored reasons verbatim. The agent may explain a tier but never change one — evidence decides.",
          };
        }

        const { data: countyRun, error: countyError } = await supabase
          .from("county_runs")
          .select("id, run_name, stage, geography_label")
          .eq("id", countyRunId)
          .eq("workspace_id", workspaceId)
          .maybeSingle();
        if (countyError) throw new Error(countyError.message ?? "county_runs query failed");
        if (!countyRun) {
          return {
            status: "not_found",
            message: "No county run with that id is visible in this workspace.",
          };
        }
        const countyRow = countyRun as Record<string, unknown>;
        const stage = typeof countyRow.stage === "string" ? (countyRow.stage as CountyRunStage) : null;

        const evidenceResult = await loadCountyRunModelingEvidence({
          supabase: supabase as unknown as ModelingEvidenceSupabaseLike,
          countyRunId: countyRunId as string,
        });

        const claimDecision = evidenceResult.evidence?.claimDecision ?? null;
        return {
          status: "ok",
          subject: {
            kind: "county_run",
            id: countyRow.id,
            title: countyRow.run_name ?? null,
            geographyLabel: countyRow.geography_label ?? null,
          },
          stagePosture: {
            stage,
            stageLabel: stage ? getCountyRunStageLabel(stage) : null,
            screeningGrade: isScreeningGradeStage(stage),
            allowedClaim: stage ? getCountyRunAllowedClaim(stage) : null,
            // The stage's caveat list, verbatim from the county-onramp lib.
            // No manifest is parsed on this path, so the caveats are the
            // stage's alone — which is why null is passed explicitly rather
            // than omitted.
            caveats: stage ? getCountyRunCaveats(stage, null) : [],
          },
          evidence: evidenceResult.error
            ? {
                status: "unavailable",
                message: `The modeling evidence record could not be read (${evidenceResult.error.message}). That is a failed read, not evidence of absence.`,
              }
            : {
                status: "ok",
                claimDecision: claimDecision
                  ? {
                      track: claimDecision.track,
                      tier: claimDecision.claimStatus,
                      label: modelingClaimStatusLabel(claimDecision.claimStatus),
                      reason: claimDecision.statusReason,
                      reasons: claimDecision.reasons,
                      validationSummary: claimDecision.validationSummary,
                      decidedAt: claimDecision.decidedAt,
                      evidenceForHigherTier: evidenceForHigherTier(
                        claimDecision.claimStatus,
                        claimDecision.validationSummary,
                        claimDecision.reasons
                      ),
                    }
                  : {
                      tier: null,
                      label: modelingClaimStatusLabel(null),
                      message: "No claim decision is recorded for this county run.",
                    },
                reportLanguage: evidenceResult.evidence?.reportLanguage ?? null,
                validationResults: (evidenceResult.evidence?.validationResults ?? [])
                  .slice(0, ASSISTANT_CHAT_TOOL_VALIDATION_LIMIT)
                  .map((result) => ({
                    track: result.track,
                    metricKey: result.metricKey,
                    metricLabel: result.metricLabel,
                    observedValue: result.observedValue,
                    thresholdValue: result.thresholdValue,
                    thresholdMaxValue: result.thresholdMaxValue,
                    thresholdComparator: result.thresholdComparator,
                    status: result.status,
                    blocksClaimGrade: result.blocksClaimGrade,
                    detail: result.detail,
                    evaluatedAt: result.evaluatedAt,
                  })),
              },
          tierLadder: claimTierLadder(),
        };
      },
    }),
  });

  const searchGrantsGov = tool({
    description:
      `Search live federal funding opportunities on grants.gov (Search2 API, transportation category, max ${ASSISTANT_CHAT_TOOL_GRANTS_GOV_ROWS} rows, results cached server-side for 30 minutes). Returns synopsis-level results with the standing caveat — the NOFO on grants.gov is the record.`,
    inputSchema: z.object({
      keyword: z.string().trim().max(120).optional().describe("Keywords, e.g. 'safe streets' or 'transit'."),
      agencies: z
        .string()
        .trim()
        .max(200)
        .optional()
        .describe('Pipe-joined sub-agency codes, e.g. "DOT-FTA|DOT-FRA".'),
      eligibilities: z
        .string()
        .trim()
        .max(200)
        .optional()
        .describe('Pipe-joined 2-digit applicant-eligibility codes, e.g. "01|02".'),
    }),
    execute: guarded<{ keyword?: string; agencies?: string; eligibilities?: string }>({
      name: "search_grants_gov",
      budget,
      audit,
      run: async (input) => {
        let searchBody: ReturnType<typeof buildGrantsGovSearchBody>;
        try {
          searchBody = buildGrantsGovSearchBody({
            keyword: input.keyword,
            agencies: input.agencies,
            eligibilities: input.eligibilities,
            rows: ASSISTANT_CHAT_TOOL_GRANTS_GOV_ROWS,
          });
        } catch (error) {
          return {
            status: "invalid_query",
            message: error instanceof Error ? error.message : "Invalid grants.gov filters.",
          };
        }

        const cacheKey = JSON.stringify(searchBody);
        const now = Date.now();
        const cached = getCachedGrantsGovResult(cacheKey, now);
        if (cached) {
          return grantsGovToolPayload(cached.result, { cached: true, fetchedAt: cached.fetchedAt });
        }

        const unavailable = (why: string): ChatToolPayload => ({
          status: "unavailable",
          message: `grants.gov could not be searched (${why}). An unreachable API is not evidence that no opportunities exist — try again later or check grants.gov directly.`,
        });

        let payload: unknown;
        try {
          const upstream = await fetch(GRANTS_GOV_SEARCH_ENDPOINT, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(searchBody),
            signal: AbortSignal.timeout(GRANTS_GOV_TOOL_TIMEOUT_MS),
            cache: "no-store",
          });
          if (!upstream.ok) {
            audit.warn("assistant_chat_grants_gov_non_ok", { status: upstream.status });
            return unavailable(`upstream answered status ${upstream.status}`);
          }
          payload = await upstream.json();
        } catch (error) {
          audit.warn("assistant_chat_grants_gov_fetch_failed", {
            message: error instanceof Error ? error.message : String(error),
          });
          return unavailable("the request failed or timed out");
        }

        const parsed = parseGrantsGovSearchResponse(payload);
        if (!parsed) {
          audit.warn("assistant_chat_grants_gov_parse_failed", {});
          return unavailable("the response failed the defensive parse");
        }

        setCachedGrantsGovResult(cacheKey, { fetchedAt: now, result: parsed });
        return grantsGovToolPayload(parsed, { cached: false, fetchedAt: now });
      },
    }),
  });

  const listWorkspaceRecords = tool({
    description:
      `List this workspace's records of one kind to find ids and current status (max ${ASSISTANT_CHAT_TOOL_LIST_LIMIT} rows, most recent first). Kinds: ${WORKSPACE_RECORD_LIST_KINDS.join(", ")}. Use it before proposing any action that needs a record id.`,
    inputSchema: z.object({
      kind: z.enum(WORKSPACE_RECORD_LIST_KINDS).describe("Which record kind to list."),
    }),
    execute: guarded<{ kind: WorkspaceRecordListKind }>({
      name: "list_workspace_records",
      budget,
      audit,
      run: async (input) => {
        if (!workspaceId) return refusal("No workspace is attached to this chat surface.");
        const config = WORKSPACE_RECORD_LISTS[input.kind];
        if (!config) {
          return {
            status: "invalid_payload",
            message: `Unknown record kind ${String(input.kind)}. Valid kinds: ${WORKSPACE_RECORD_LIST_KINDS.join(", ")}.`,
          };
        }

        const { data, error } = await config
          .query(supabase)
          .eq("workspace_id", workspaceId)
          .order(config.orderColumn, { ascending: false })
          .limit(ASSISTANT_CHAT_TOOL_LIST_LIMIT);
        if (error) throw new Error(error.message ?? `${input.kind} list query failed`);
        const rows = (data ?? []) as Array<Record<string, unknown>>;

        return {
          status: "ok",
          kind: input.kind,
          recordCount: rows.length,
          rowCap: ASSISTANT_CHAT_TOOL_LIST_LIMIT,
          truncated: rows.length === ASSISTANT_CHAT_TOOL_LIST_LIMIT,
          note: config.note ?? null,
          records: rows.map(config.project),
        };
      },
    }),
  });

  const getEngagementResponses = tool({
    description:
      `Read a campaign's public input: up to ${ASSISTANT_CHAT_TOOL_COMMENT_EXCERPT_LIMIT} approved comment excerpts (truncated to ${ASSISTANT_CHAT_TOOL_COMMENT_EXCERPT_MAX_CHARS} characters), moderation queue counts, and survey response counts per question. Individual survey answers are never surfaced in chat.`,
    inputSchema: z.object({
      campaignId: z.string().uuid().describe("The engagement campaign id (find it with list_workspace_records kind=campaigns)."),
    }),
    execute: guarded<{ campaignId: string }>({
      name: "get_engagement_responses",
      budget,
      audit,
      run: async (input) => {
        if (!workspaceId) return refusal("No workspace is attached to this chat surface.");

        const { data: campaign, error: campaignError } = await supabase
          .from("engagement_campaigns")
          .select("id, title, status")
          .eq("id", input.campaignId)
          .eq("workspace_id", workspaceId)
          .maybeSingle();
        if (campaignError) throw new Error(campaignError.message ?? "engagement_campaigns query failed");
        if (!campaign) {
          return {
            status: "not_found",
            message: "No engagement campaign with that id is visible in this workspace.",
          };
        }
        const campaignRow = campaign as Record<string, unknown>;

        const { data: commentData, error: commentError } = await supabase
          .from("engagement_items")
          .select("id, title, body, source_type, created_at")
          .eq("campaign_id", input.campaignId)
          .eq("status", "approved")
          .order("created_at", { ascending: false })
          .limit(ASSISTANT_CHAT_TOOL_COMMENT_EXCERPT_LIMIT);
        if (commentError) throw new Error(commentError.message ?? "engagement_items query failed");
        const commentRows = (commentData ?? []) as Array<Record<string, unknown>>;

        const [pendingResult, flaggedResult] = await Promise.all([
          supabase
            .from("engagement_items")
            .select("id", { count: "exact", head: true })
            .eq("campaign_id", input.campaignId)
            .eq("status", "pending"),
          supabase
            .from("engagement_items")
            .select("id", { count: "exact", head: true })
            .eq("campaign_id", input.campaignId)
            .eq("status", "flagged"),
        ]);
        const moderationFailed = Boolean(pendingResult?.error) || Boolean(flaggedResult?.error);

        // Survey reads go through the ONE confined reader lib. On deployments
        // where the response records are locked to the server-side reader, this
        // read fails under the planner's own session permissions — which is the
        // expected, honest outcome, reported as unavailable rather than as zero.
        const survey = await aggregateCampaignSurvey(supabase as never, input.campaignId);
        const surveyPayload = survey.error
          ? {
              status: "unavailable",
              message:
                `Survey response counts could not be read from this chat session (${survey.error.message}). ` +
                "On this deployment the survey response records are confined to a server-side reader, so this is expected here — " +
                "the campaign page shows the aggregated results. A failed read is not a campaign with zero responses.",
            }
          : {
              status: "ok",
              approvedResponseCount: survey.approvedResponseCount,
              questionCount: survey.questions.length,
              questionRowCap: ASSISTANT_CHAT_TOOL_SURVEY_QUESTION_LIMIT,
              questions: survey.questions.slice(0, ASSISTANT_CHAT_TOOL_SURVEY_QUESTION_LIMIT).map((question) => ({
                prompt: question.prompt,
                questionType: question.questionType,
                answeredCount: question.answeredCount,
              })),
              note: "Counts only — individual answers never appear in chat.",
            };

        return {
          status: "ok",
          campaign: { id: campaignRow.id, title: campaignRow.title ?? null, status: campaignRow.status ?? null },
          comments: {
            count: commentRows.length,
            rowCap: ASSISTANT_CHAT_TOOL_COMMENT_EXCERPT_LIMIT,
            truncated: commentRows.length === ASSISTANT_CHAT_TOOL_COMMENT_EXCERPT_LIMIT,
            note: "Approved comments only, excerpted. Attribute them as public input, not as the agency's findings.",
            excerpts: commentRows.map((row) => {
              const body = typeof row.body === "string" ? row.body : "";
              return {
                id: row.id,
                title: row.title ?? null,
                sourceType: row.source_type ?? null,
                createdAt: isoOrNull(row.created_at),
                excerpt: truncateForField(body, ASSISTANT_CHAT_TOOL_COMMENT_EXCERPT_MAX_CHARS),
                excerptTruncated: body.length > ASSISTANT_CHAT_TOOL_COMMENT_EXCERPT_MAX_CHARS,
              };
            }),
          },
          moderationQueue: moderationFailed
            ? {
                status: "unavailable",
                message: "The moderation queue could not be counted. That is a failed read, not an empty queue.",
              }
            : {
                status: "ok",
                pending: (pendingResult as { count?: number | null })?.count ?? 0,
                flagged: (flaggedResult as { count?: number | null })?.count ?? 0,
              },
          survey: surveyPayload,
        };
      },
    }),
  });

  return {
    get_model_run_results: getModelRunResults,
    explain_model_claim: explainModelClaim,
    search_grants_gov: searchGrantsGov,
    list_workspace_records: listWorkspaceRecords,
    get_engagement_responses: getEngagementResponses,
  };
}

export function buildAssistantChatTools(params: BuildAssistantChatToolsParams): ToolSet {
  const { supabase, context, userId, audit, budget } = params;
  const workspaceId = context.workspace.id;

  const searchKnowledgeBase = tool({
    description:
      "Search the workspace's uploaded-document Knowledge Base (lexical keyword search, not semantic). Use it when the planner's question likely touches uploaded plans, studies, or reports. Cite matches by document title and page.",
    inputSchema: z.object({
      query: z.string().min(2).max(200).describe("Keywords to search for in uploaded documents."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(ASSISTANT_CHAT_TOOL_KB_EXCERPT_LIMIT)
        .optional()
        .describe(`How many excerpts to return (max ${ASSISTANT_CHAT_TOOL_KB_EXCERPT_LIMIT}).`),
    }),
    execute: guarded<{ query: string; limit?: number }>({
      name: "search_knowledge_base",
      budget,
      audit,
      countsAsKnowledgeBaseSearch: true,
      run: async (input) => {
        const excerpts = await retrieveKnowledgeBaseExcerpts({
          supabase,
          workspaceId,
          query: input.query,
          limit: Math.min(input.limit ?? 6, ASSISTANT_CHAT_TOOL_KB_EXCERPT_LIMIT),
        });
        return {
          status: "ok",
          excerptCount: excerpts.length,
          note:
            excerpts.length === 0
              ? "No uploaded-document excerpts matched. That means the Knowledge Base has no matching text — not that the answer is no."
              : "Excerpts come from uploaded documents OpenPlan has not independently verified. Attribute each to its document title and page.",
          excerpts: excerpts.map((excerpt) => ({
            documentTitle: excerpt.documentTitle,
            docKind: excerpt.docKind,
            page: excerptPageLabel(excerpt.pageFrom, excerpt.pageTo) || null,
            snippet: excerpt.snippet,
          })),
        };
      },
    }),
  });

  const getSurfaceContext = tool({
    description:
      "Load the grounded context lines for another OpenPlan surface in this same workspace (a project, report, RTP cycle, plan, program, scenario set, model, or run). Use it when the planner asks about a record that is not the current surface.",
    inputSchema: z.object({
      kind: z.enum(ASSISTANT_TARGET_KIND_VALUES).describe("Which kind of surface to load."),
      id: z.string().uuid().nullable().optional().describe("The record id for id-scoped kinds (project, report, plan, program, scenario_set, model, rtp_cycle, run)."),
      runId: z.string().uuid().nullable().optional(),
      baselineRunId: z.string().uuid().nullable().optional(),
    }),
    execute: guarded<{ kind: AssistantTargetKind; id?: string | null; runId?: string | null; baselineRunId?: string | null }>({
      name: "get_surface_context",
      budget,
      audit,
      run: async (input) => {
        const other = await loadAssistantContext(supabase as any, userId, {
          kind: input.kind,
          id: input.id ?? input.runId ?? null,
          workspaceId,
          runId: input.runId ?? null,
          baselineRunId: input.baselineRunId ?? null,
        });
        if (!other) {
          return {
            status: "not_found",
            message: "No such surface is visible to this planner. It may not exist or may belong to a workspace they are not a member of.",
          };
        }
        if (other.workspace.id !== workspaceId) {
          return refusal("That surface belongs to a different workspace. Chat tools only read the current workspace.");
        }
        return {
          status: "ok",
          kind: other.kind,
          contextLines: buildAssistantChatContextLines(other),
        };
      },
    }),
  });

  const listProjects = tool({
    description: `List the workspace's projects (most recently updated first, max ${ASSISTANT_CHAT_TOOL_LIST_LIMIT}).`,
    inputSchema: z.object({}),
    execute: guarded<Record<string, never>>({
      name: "list_projects",
      budget,
      audit,
      run: async () => {
        if (!workspaceId) return refusal("No workspace is attached to this chat surface.");
        const { data, error } = await supabase
          .from("projects")
          .select("id, name, status, delivery_phase, updated_at")
          .eq("workspace_id", workspaceId)
          .order("updated_at", { ascending: false })
          .limit(ASSISTANT_CHAT_TOOL_LIST_LIMIT);
        if (error) throw new Error(error.message ?? "projects query failed");
        const rows = (data ?? []) as Array<Record<string, unknown>>;
        return {
          status: "ok",
          projectCount: rows.length,
          truncated: rows.length === ASSISTANT_CHAT_TOOL_LIST_LIMIT,
          projects: rows.map((row) => ({
            id: row.id,
            name: row.name,
            status: row.status,
            deliveryPhase: row.delivery_phase,
            updatedAt: isoOrNull(row.updated_at),
          })),
        };
      },
    }),
  });

  const listFundingOpportunities = tool({
    description: `List the workspace's funding opportunities (most recently updated first, max ${ASSISTANT_CHAT_TOOL_LIST_LIMIT}), with status, decision state, and deadline dates.`,
    inputSchema: z.object({}),
    execute: guarded<Record<string, never>>({
      name: "list_funding_opportunities",
      budget,
      audit,
      run: async () => {
        if (!workspaceId) return refusal("No workspace is attached to this chat surface.");
        const { data, error } = await supabase
          .from("funding_opportunities")
          .select("id, title, opportunity_status, decision_state, expected_award_amount, closes_at, decision_due_at, updated_at")
          .eq("workspace_id", workspaceId)
          .order("updated_at", { ascending: false })
          .limit(ASSISTANT_CHAT_TOOL_LIST_LIMIT);
        if (error) throw new Error(error.message ?? "funding_opportunities query failed");
        const rows = (data ?? []) as Array<Record<string, unknown>>;
        return {
          status: "ok",
          opportunityCount: rows.length,
          truncated: rows.length === ASSISTANT_CHAT_TOOL_LIST_LIMIT,
          opportunities: rows.map((row) => ({
            id: row.id,
            title: row.title,
            status: row.opportunity_status,
            decisionState: row.decision_state,
            expectedAwardAmount: typeof row.expected_award_amount === "number" ? row.expected_award_amount : null,
            closesAt: isoOrNull(row.closes_at),
            decisionDueAt: isoOrNull(row.decision_due_at),
            updatedAt: isoOrNull(row.updated_at),
          })),
        };
      },
    }),
  });

  const listReports = tool({
    description: `List the workspace's reports (most recently updated first, max ${ASSISTANT_CHAT_TOOL_LIST_LIMIT}), each with a packet-freshness label (whether its generated artifact is current, stale, or missing).`,
    inputSchema: z.object({}),
    execute: guarded<Record<string, never>>({
      name: "list_reports",
      budget,
      audit,
      run: async () => {
        if (!workspaceId) return refusal("No workspace is attached to this chat surface.");
        const { data, error } = await supabase
          .from("reports")
          .select("id, title, status, report_type, generated_at, latest_artifact_kind, updated_at")
          .eq("workspace_id", workspaceId)
          .order("updated_at", { ascending: false })
          .limit(ASSISTANT_CHAT_TOOL_LIST_LIMIT);
        if (error) throw new Error(error.message ?? "reports query failed");
        const rows = (data ?? []) as Array<Record<string, unknown>>;
        return {
          status: "ok",
          reportCount: rows.length,
          truncated: rows.length === ASSISTANT_CHAT_TOOL_LIST_LIMIT,
          reports: rows.map((row) => {
            const freshness = getReportPacketFreshness({
              latestArtifactKind: (row.latest_artifact_kind as string | null) ?? null,
              generatedAt: isoOrNull(row.generated_at),
              updatedAt: isoOrNull(row.updated_at),
            });
            return {
              id: row.id,
              title: row.title,
              status: row.status,
              reportType: row.report_type,
              generatedAt: isoOrNull(row.generated_at),
              updatedAt: isoOrNull(row.updated_at),
              packetFreshness: freshness.label,
            };
          }),
        };
      },
    }),
  });

  const listPendingOperations = tool({
    description:
      "List the grounded operator moves (the same operations the Planner Agent console shows) for the current surface: what needs attention, what each move would open, and whether it needs approval. Use it when the planner asks what to do next.",
    inputSchema: z.object({}),
    execute: guarded<Record<string, never>>({
      name: "list_pending_operations",
      budget,
      audit,
      run: async () => {
        const links = buildAssistantOperations(context).slice(0, ASSISTANT_CHAT_TOOL_OPERATIONS_LIMIT);
        return {
          status: "ok",
          operationCount: links.length,
          operations: links.map((link) => ({
            id: link.id,
            label: link.label,
            href: link.href,
            actionClass: link.actionClass,
            executionMode: link.executionMode,
            approval: resolveQuickLinkApproval(link),
            statusLabel: link.statusLabel ?? null,
            reason: link.reason ?? null,
          })),
        };
      },
    }),
  });

  const getGrantProgramCatalog = tool({
    description:
      // The registered bundles name themselves rather than being spelled out
      // here, so a new jurisdiction's programs are described accurately the
      // moment it is registered instead of the day someone remembers this string.
      `Read OpenPlan's static reference catalog of transportation funding programs. Registered bundles: ${GRANT_PROGRAM_BUNDLES.map((bundle) => bundle.label).join("; ")}. Each program carries the jurisdiction it is open in — a jurisdiction-scoped program is NOT available to an agency outside it, so always check the program's jurisdiction against where the workspace actually works before recommending it. This is orientation guidance, not a live opportunity feed — every entry says where to verify the current cycle.`,
    inputSchema: z.object({
      level: z.enum(["federal", "state"]).optional().describe("Optionally narrow to federal or state programs."),
    }),
    execute: guarded<{ level?: "federal" | "state" }>({
      name: "get_grant_program_catalog",
      budget,
      audit,
      run: async (input) => {
        const entries = listGrantProgramsWithBundle().filter(
          ({ program }) => !input.level || program.level === input.level
        );
        return {
          status: "ok",
          programCount: entries.length,
          note: "Static reference data. Cycle timing shifts — always tell the planner to verify against the official program page. The catalog is not filtered to this workspace's geography: name each program's jurisdiction when you cite it, and say plainly when a program is scoped somewhere the workspace does not work.",
          programs: entries.map(({ program, bundle }) => ({
            key: program.key,
            name: program.name,
            administeringAgency: program.administeringAgency,
            level: program.level,
            // Where the program is open, from the bundle's own declaration.
            jurisdiction: bundle.jurisdiction.label,
            jurisdictionCountry: bundle.jurisdiction.country,
            jurisdictionSubdivision: bundle.jurisdiction.subdivision ?? null,
            typicalApplicants: program.typicalApplicants,
            eligibleProjectTypes: program.eligibleProjectTypes,
            cycleNote: program.cycleNote,
            matchRequirement: program.matchRequirement,
            url: program.url,
          })),
        };
      },
    }),
  });

  const tools: Record<string, Tool<any, any>> = {
    search_knowledge_base: searchKnowledgeBase,
    get_surface_context: getSurfaceContext,
    list_projects: listProjects,
    list_funding_opportunities: listFundingOpportunities,
    list_reports: listReports,
    list_pending_operations: listPendingOperations,
    get_grant_program_catalog: getGrantProgramCatalog,
    ...buildAssistantEvidenceReadTools(params),
    ...buildAssistantProposalTools(params),
  };

  return tools as ToolSet;
}
