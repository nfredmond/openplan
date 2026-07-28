/* eslint-disable @typescript-eslint/no-explicit-any */

import { z } from "zod";
import { tool, type Tool, type ToolSet } from "ai";
import type { AssistantContext } from "@/lib/assistant/context";
import { loadAssistantContext } from "@/lib/assistant/context";
import { buildAssistantChatContextLines } from "@/lib/assistant/chat-context";
import { buildAssistantOperations } from "@/lib/assistant/operations";
import { excerptPageLabel, retrieveKnowledgeBaseExcerpts } from "@/lib/knowledge-base/retrieval";
import { GRANT_PROGRAM_CATALOG } from "@/lib/grants/program-catalog";
import { getReportPacketFreshness } from "@/lib/reports/catalog";
import { resolveQuickLinkApproval } from "@/lib/runtime/action-metadata";
import type { AssistantTargetKind } from "@/lib/assistant/catalog";

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

const ASSISTANT_TARGET_KIND_VALUES = [
  "workspace",
  "analysis_studio",
  "project",
  "rtp_registry",
  "rtp_cycle",
  "plan",
  "program",
  "scenario_set",
  "model",
  "report",
  "rtp_packet_report",
  "run",
] as const satisfies readonly AssistantTargetKind[];

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
      "Read OpenPlan's static reference catalog of transportation funding programs (federal and California state). This is orientation guidance, not a live opportunity feed — every entry says where to verify the current cycle.",
    inputSchema: z.object({
      level: z.enum(["federal", "state"]).optional().describe("Optionally narrow to federal or state programs."),
    }),
    execute: guarded<{ level?: "federal" | "state" }>({
      name: "get_grant_program_catalog",
      budget,
      audit,
      run: async (input) => {
        const entries = GRANT_PROGRAM_CATALOG.filter((entry) => !input.level || entry.level === input.level);
        return {
          status: "ok",
          programCount: entries.length,
          note: "Static reference data. Cycle timing shifts — always tell the planner to verify against the official program page.",
          programs: entries.map((entry) => ({
            key: entry.key,
            name: entry.name,
            administeringAgency: entry.administeringAgency,
            level: entry.level,
            typicalApplicants: entry.typicalApplicants,
            eligibleProjectTypes: entry.eligibleProjectTypes,
            cycleNote: entry.cycleNote,
            matchRequirement: entry.matchRequirement,
            url: entry.url,
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
  };

  return tools as ToolSet;
}
