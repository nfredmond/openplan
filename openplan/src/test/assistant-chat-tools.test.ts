import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AssistantContext } from "@/lib/assistant/context";
import type { AssistantQuickLink } from "@/lib/assistant/catalog";
import { PACKET_FRESHNESS_LABELS } from "@/lib/reports/packet-labels";

const loadAssistantContextMock = vi.fn();
const buildAssistantOperationsMock = vi.fn();

vi.mock("@/lib/assistant/context", () => ({
  loadAssistantContext: (...args: unknown[]) => loadAssistantContextMock(...args),
}));

vi.mock("@/lib/assistant/operations", () => ({
  buildAssistantOperations: (...args: unknown[]) => buildAssistantOperationsMock(...args),
}));

import {
  ASSISTANT_CHAT_TOOL_LIST_LIMIT,
  ASSISTANT_CHAT_TOOL_MAX_CALLS,
  ASSISTANT_CHAT_TOOL_MAX_KB_SEARCHES,
  buildAssistantChatTools,
  createChatToolBudget,
  isAssistantChatProposal,
  type ChatToolBudget,
} from "@/lib/assistant/chat-tools";
import { ACTION_METADATA } from "@/lib/runtime/action-metadata";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";

const auditMock = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

type QueryLog = {
  table: string;
  filters: Array<[string, unknown]>;
  limit: number | null;
  columns: string | null;
};

type SupabaseMock = {
  client: { from: (table: string) => unknown; rpc: (fn: string, args: Record<string, unknown>) => unknown };
  queries: QueryLog[];
  rpcCalls: Array<{ fn: string; args: Record<string, unknown> }>;
  mutations: string[];
};

function createSupabaseMock(tableData: Record<string, unknown[]> = {}, rpcData: unknown[] = []): SupabaseMock {
  const queries: QueryLog[] = [];
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const mutations: string[] = [];

  function from(table: string) {
    const log: QueryLog = { table, filters: [], limit: null, columns: null };
    queries.push(log);

    const chain: Record<string, unknown> = {};
    const passthrough = (name: string) =>
      ((...args: unknown[]) => {
        if (name === "select") log.columns = String(args[0] ?? "");
        if (name === "eq") log.filters.push([String(args[0]), args[1]]);
        if (name === "limit") log.limit = Number(args[0]);
        return chain;
      }) as unknown;

    for (const name of ["select", "eq", "in", "order", "limit", "gte", "lte", "is"]) {
      chain[name] = passthrough(name);
    }
    for (const name of ["insert", "update", "delete", "upsert"]) {
      chain[name] = ((...args: unknown[]) => {
        void args;
        mutations.push(`${table}.${name}`);
        return chain;
      }) as unknown;
    }
    const resolveRows = () => {
      const rows = (tableData[table] ?? []).slice(0, log.limit ?? undefined);
      return { data: rows, error: null };
    };
    chain.maybeSingle = (() => Promise.resolve({ data: (tableData[table] ?? [])[0] ?? null, error: null })) as unknown;
    chain.then = ((resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(resolveRows()).then(resolve, reject)) as unknown;
    return chain;
  }

  return {
    client: {
      from,
      rpc: (fn: string, args: Record<string, unknown>) => {
        rpcCalls.push({ fn, args });
        return Promise.resolve({ data: rpcData, error: null });
      },
    },
    queries,
    rpcCalls,
    mutations,
  };
}

function workspaceContextFixture(workspaceId: string = WORKSPACE_ID): AssistantContext {
  return {
    kind: "workspace",
    workspace: { id: workspaceId, name: "Foothill COG", plan: null, role: "admin" },
    recentProject: null,
    recentRuns: [],
    currentRun: null,
    baselineRun: null,
    operationsSummary: {
      posture: "stable",
      headline: "Workspace is steady.",
      detail: "No urgent pressure.",
      counts: {
        projects: 1,
        activeProjects: 1,
        plans: 0,
        plansNeedingSetup: 0,
        programs: 0,
        activePrograms: 0,
        reports: 0,
        reportRefreshRecommended: 0,
        reportNoPacket: 0,
        reportPacketCurrent: 0,
        rtpFundingReviewPackets: 0,
        comparisonBackedReports: 0,
        fundingOpportunities: 0,
        openFundingOpportunities: 0,
        closingSoonFundingOpportunities: 0,
        overdueDecisionFundingOpportunities: 0,
        projectFundingNeedAnchorProjects: 0,
        projectFundingSourcingProjects: 0,
        projectFundingDecisionProjects: 0,
        projectFundingAwardRecordProjects: 0,
        projectFundingReimbursementStartProjects: 0,
        projectFundingReimbursementActiveProjects: 0,
        projectFundingGapProjects: 0,
        queueDepth: 0,
        aerialMissions: 0,
        aerialActiveMissions: 0,
        aerialReadyPackages: 0,
      },
      nextCommand: null,
      commandQueue: [],
      fullCommandQueue: [],
    },
  } as unknown as AssistantContext;
}

type ExecuteFn = (input: unknown, options: { toolCallId: string; messages: unknown[] }) => Promise<Record<string, unknown>>;

function toolExecute(tools: ReturnType<typeof buildAssistantChatTools>, name: string): ExecuteFn {
  const candidate = tools[name] as { execute?: unknown } | undefined;
  if (!candidate?.execute) throw new Error(`tool ${name} has no execute`);
  return candidate.execute as ExecuteFn;
}

function buildTools(overrides?: { supabase?: SupabaseMock; budget?: ChatToolBudget; context?: AssistantContext }) {
  const supabase = overrides?.supabase ?? createSupabaseMock();
  const budget = overrides?.budget ?? createChatToolBudget();
  const context = overrides?.context ?? workspaceContextFixture();
  const tools = buildAssistantChatTools({
    supabase: supabase.client,
    context,
    userId: USER_ID,
    audit: auditMock,
    budget,
  });
  return { tools, supabase, budget };
}

const CALL_OPTIONS = { toolCallId: "tool-call-1", messages: [] };

describe("buildAssistantChatTools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildAssistantOperationsMock.mockReturnValue([]);
    loadAssistantContextMock.mockResolvedValue(workspaceContextFixture());
  });

  it("exposes the twelve read tools plus one propose tool per registry action", () => {
    const { tools } = buildTools();
    expect(Object.keys(tools).sort()).toEqual(
      [
        "get_grant_program_catalog",
        "get_surface_context",
        "list_funding_opportunities",
        "list_projects",
        "list_pending_operations",
        "list_reports",
        "search_knowledge_base",
        // Evidence-reading tools (same rules: session client, caps, no writes).
        "get_model_run_results",
        "explain_model_claim",
        "search_grants_gov",
        "list_workspace_records",
        "get_engagement_responses",
        ...Object.keys(ACTION_METADATA).map((kind) => `propose_${kind}`),
      ].sort()
    );
  });

  it("list_projects queries the workspace with a hard row limit and returns a small projection", async () => {
    const supabase = createSupabaseMock({
      projects: [
        {
          id: "p1",
          name: "Corridor Study",
          status: "active",
          delivery_phase: "planning",
          updated_at: "2026-07-01T00:00:00Z",
          secret_column: "must not leak",
        },
      ],
    });
    const { tools } = buildTools({ supabase });

    const result = await toolExecute(tools, "list_projects")({}, CALL_OPTIONS);

    expect(result.status).toBe("ok");
    expect(result.projects).toEqual([
      {
        id: "p1",
        name: "Corridor Study",
        status: "active",
        deliveryPhase: "planning",
        updatedAt: "2026-07-01T00:00:00Z",
      },
    ]);

    const query = supabase.queries.find((entry) => entry.table === "projects");
    expect(query).toBeDefined();
    expect(query!.filters).toContainEqual(["workspace_id", WORKSPACE_ID]);
    expect(query!.limit).toBe(ASSISTANT_CHAT_TOOL_LIST_LIMIT);
  });

  it("list_funding_opportunities is workspace-scoped and hard-limited", async () => {
    const supabase = createSupabaseMock({
      funding_opportunities: [
        {
          id: "f1",
          title: "ATP Cycle",
          opportunity_status: "open",
          decision_state: "pursue",
          expected_award_amount: 250000,
          closes_at: "2026-09-01T00:00:00Z",
          decision_due_at: null,
          updated_at: "2026-07-01T00:00:00Z",
          fit_notes: "must not leak",
        },
      ],
    });
    const { tools } = buildTools({ supabase });

    const result = await toolExecute(tools, "list_funding_opportunities")({}, CALL_OPTIONS);

    expect(result.status).toBe("ok");
    expect(result.opportunities).toEqual([
      {
        id: "f1",
        title: "ATP Cycle",
        status: "open",
        decisionState: "pursue",
        expectedAwardAmount: 250000,
        closesAt: "2026-09-01T00:00:00Z",
        decisionDueAt: null,
        updatedAt: "2026-07-01T00:00:00Z",
      },
    ]);

    const query = supabase.queries.find((entry) => entry.table === "funding_opportunities");
    expect(query!.filters).toContainEqual(["workspace_id", WORKSPACE_ID]);
    expect(query!.limit).toBe(ASSISTANT_CHAT_TOOL_LIST_LIMIT);
  });

  it("list_reports labels packet freshness for each row", async () => {
    const supabase = createSupabaseMock({
      reports: [
        {
          id: "r1",
          title: "Board Packet",
          status: "final",
          report_type: "board_packet",
          generated_at: null,
          latest_artifact_kind: null,
          updated_at: "2026-07-01T00:00:00Z",
        },
        {
          id: "r2",
          title: "Current Packet",
          status: "final",
          report_type: "board_packet",
          generated_at: "2026-07-02T00:00:00Z",
          latest_artifact_kind: "pdf",
          updated_at: "2026-07-01T00:00:00Z",
        },
      ],
    });
    const { tools } = buildTools({ supabase });

    const result = await toolExecute(tools, "list_reports")({}, CALL_OPTIONS);
    const reports = result.reports as Array<{ id: string; packetFreshness: string }>;

    expect(reports[0].packetFreshness).toBe(PACKET_FRESHNESS_LABELS.NO_PACKET);
    expect(reports[1].packetFreshness).toBe(PACKET_FRESHNESS_LABELS.CURRENT);

    const query = supabase.queries.find((entry) => entry.table === "reports");
    expect(query!.filters).toContainEqual(["workspace_id", WORKSPACE_ID]);
    expect(query!.limit).toBe(ASSISTANT_CHAT_TOOL_LIST_LIMIT);
  });

  it("search_knowledge_base clamps the excerpt limit to 8 and returns projected excerpts", async () => {
    const supabase = createSupabaseMock({}, [
      {
        chunk_id: "c1",
        document_id: "d1",
        document_title: "Regional Transportation Plan",
        doc_kind: "plan",
        page_from: 5,
        page_to: 7,
        chunk_index: 0,
        content: "The corridor carries significant freight volume.",
        rank: 0.7,
        extraction_source: "ocr",
      },
    ]);
    const { tools } = buildTools({ supabase });

    const result = await toolExecute(tools, "search_knowledge_base")({ query: "freight corridor", limit: 8 }, CALL_OPTIONS);

    expect(result.status).toBe("ok");
    expect(result.excerpts).toEqual([
      {
        documentTitle: "Regional Transportation Plan",
        docKind: "plan",
        page: "pp. 5-7",
        snippet: "The corridor carries significant freight volume.",
        // The excerpt was read by OCR, so the model is told — a possibly-misread
        // scanned figure must not reach the planner as fact.
        readWithOcr: true,
      },
    ]);
    expect(supabase.rpcCalls).toHaveLength(1);
    expect(supabase.rpcCalls[0].fn).toBe("kb_search_chunks");
    expect(supabase.rpcCalls[0].args.p_limit).toBeLessThanOrEqual(8);
    expect(supabase.rpcCalls[0].args.p_workspace_id).toBe(WORKSPACE_ID);
  });

  it("refuses the fourth knowledge-base search without consuming budget or throwing", async () => {
    const { tools, budget, supabase } = buildTools();
    const search = toolExecute(tools, "search_knowledge_base");

    for (let i = 0; i < ASSISTANT_CHAT_TOOL_MAX_KB_SEARCHES; i += 1) {
      const result = await search({ query: "corridor" }, { ...CALL_OPTIONS, toolCallId: `kb-${i}` });
      expect(result.status).toBe("ok");
    }

    const refused = await search({ query: "corridor" }, { ...CALL_OPTIONS, toolCallId: "kb-final" });
    expect(refused.status).toBe("refused");
    expect(String(refused.reason)).toMatch(/search budget/i);
    expect(budget.usedKnowledgeBaseSearches).toBe(ASSISTANT_CHAT_TOOL_MAX_KB_SEARCHES);
    expect(budget.usedCalls).toBe(ASSISTANT_CHAT_TOOL_MAX_KB_SEARCHES);
    // The refused call never reached the retrieval RPC.
    expect(supabase.rpcCalls).toHaveLength(ASSISTANT_CHAT_TOOL_MAX_KB_SEARCHES);
  });

  it("refuses politely once the total per-request call budget is spent", async () => {
    const budget = createChatToolBudget({ maxCalls: 2 });
    const { tools } = buildTools({ budget });
    const listProjects = toolExecute(tools, "list_projects");

    expect((await listProjects({}, { ...CALL_OPTIONS, toolCallId: "t1" })).status).toBe("ok");
    expect((await listProjects({}, { ...CALL_OPTIONS, toolCallId: "t2" })).status).toBe("ok");

    const refused = await listProjects({}, { ...CALL_OPTIONS, toolCallId: "t3" });
    expect(refused.status).toBe("refused");
    expect(String(refused.reason)).toMatch(/tool budget/i);
    expect(budget.usedCalls).toBe(2);
    // Refusals are not executions: the ledger only records real calls.
    expect(budget.ledger).toHaveLength(2);
  });

  it("defaults to a 12-call / 3-KB-search budget", () => {
    const budget = createChatToolBudget();
    expect(budget.maxCalls).toBe(ASSISTANT_CHAT_TOOL_MAX_CALLS);
    expect(budget.maxKnowledgeBaseSearches).toBe(ASSISTANT_CHAT_TOOL_MAX_KB_SEARCHES);
    expect(ASSISTANT_CHAT_TOOL_MAX_CALLS).toBe(12);
    expect(ASSISTANT_CHAT_TOOL_MAX_KB_SEARCHES).toBe(3);
  });

  it("records tool executions in the budget ledger with duration", async () => {
    const { tools, budget } = buildTools();

    await toolExecute(tools, "list_projects")({}, { ...CALL_OPTIONS, toolCallId: "call-42" });

    expect(budget.ledger).toHaveLength(1);
    expect(budget.ledger[0]).toMatchObject({ toolCallId: "call-42", tool: "list_projects", ok: true });
    expect(budget.ledger[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it("contains tool failures as error payloads (never throws) and records ok=false", async () => {
    const supabase = createSupabaseMock();
    supabase.client.from = () => {
      throw new Error("connection reset");
    };
    const { tools, budget } = buildTools({ supabase });

    const result = await toolExecute(tools, "list_projects")({}, CALL_OPTIONS);

    expect(result.status).toBe("error");
    expect(budget.ledger[0]).toMatchObject({ tool: "list_projects", ok: false });
    expect(auditMock.warn).toHaveBeenCalledWith(
      "assistant_chat_tool_failed",
      expect.objectContaining({ tool: "list_projects" })
    );
  });

  it("get_surface_context returns grounded context lines for a same-workspace surface", async () => {
    loadAssistantContextMock.mockResolvedValue(workspaceContextFixture(WORKSPACE_ID));
    const { tools } = buildTools();

    const result = await toolExecute(tools, "get_surface_context")({ kind: "workspace" }, CALL_OPTIONS);

    expect(result.status).toBe("ok");
    expect(Array.isArray(result.contextLines)).toBe(true);
    expect((result.contextLines as string[]).join("\n")).toContain("Foothill COG");
    expect(loadAssistantContextMock).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      expect.objectContaining({ kind: "workspace", workspaceId: WORKSPACE_ID })
    );
  });

  it("get_surface_context refuses a surface from a different workspace", async () => {
    loadAssistantContextMock.mockResolvedValue(workspaceContextFixture(OTHER_WORKSPACE_ID));
    const { tools } = buildTools();

    const result = await toolExecute(tools, "get_surface_context")(
      { kind: "project", id: "44444444-4444-4444-8444-444444444444" },
      CALL_OPTIONS
    );

    expect(result.status).toBe("refused");
    expect(String(result.reason)).toMatch(/different workspace/i);
  });

  it("get_surface_context reports not_found when RLS hides the record", async () => {
    loadAssistantContextMock.mockResolvedValue(null);
    const { tools } = buildTools();

    const result = await toolExecute(tools, "get_surface_context")(
      { kind: "project", id: "44444444-4444-4444-8444-444444444444" },
      CALL_OPTIONS
    );

    expect(result.status).toBe("not_found");
  });

  it("list_pending_operations projects the operations catalog to small fields", async () => {
    const links: AssistantQuickLink[] = [
      {
        id: "op-1",
        label: "Review the packet",
        href: "/reports/r1",
        targetKind: "report",
        actionClass: "review_packet",
        executionMode: "navigate",
        statusLabel: "Refresh recommended",
        reason: "The packet basis moved.",
        prompt: "should not leak",
        executeAction: { kind: "generate_report_artifact", reportId: "r1" },
      },
    ];
    buildAssistantOperationsMock.mockReturnValue(links);
    const { tools } = buildTools();

    const result = await toolExecute(tools, "list_pending_operations")({}, CALL_OPTIONS);

    expect(result.status).toBe("ok");
    expect(result.operations).toEqual([
      {
        id: "op-1",
        label: "Review the packet",
        href: "/reports/r1",
        actionClass: "review_packet",
        executionMode: "navigate",
        approval: "safe",
        statusLabel: "Refresh recommended",
        reason: "The packet basis moved.",
      },
    ]);
  });

  it("get_grant_program_catalog serves the static catalog with an optional level filter", async () => {
    const { tools } = buildTools();

    const all = await toolExecute(tools, "get_grant_program_catalog")({}, CALL_OPTIONS);
    const stateOnly = await toolExecute(tools, "get_grant_program_catalog")({ level: "state" }, CALL_OPTIONS);

    expect(all.status).toBe("ok");
    expect(Number(all.programCount)).toBeGreaterThan(0);
    const statePrograms = stateOnly.programs as Array<{ level: string; key: string; name: string; url: string }>;
    expect(statePrograms.length).toBeGreaterThan(0);
    expect(statePrograms.every((program) => program.level === "state")).toBe(true);
    expect(statePrograms[0].key).toBeTruthy();
    expect(statePrograms[0].url).toMatch(/^https?:\/\//);
  });

  it("never issues a mutating supabase call from any read tool", async () => {
    const supabase = createSupabaseMock({ projects: [], reports: [], funding_opportunities: [] });
    const { tools } = buildTools({ supabase });

    await toolExecute(tools, "list_projects")({}, CALL_OPTIONS);
    await toolExecute(tools, "list_reports")({}, CALL_OPTIONS);
    await toolExecute(tools, "list_funding_opportunities")({}, CALL_OPTIONS);
    await toolExecute(tools, "search_knowledge_base")({ query: "corridor" }, CALL_OPTIONS);
    await toolExecute(tools, "list_pending_operations")({}, CALL_OPTIONS);
    await toolExecute(tools, "get_grant_program_catalog")({}, CALL_OPTIONS);

    expect(supabase.mutations).toEqual([]);
  });

  it("keeps the service-role client unreachable from the tools module (source guard)", () => {
    const source = readFileSync(path.join(process.cwd(), "src/lib/assistant/chat-tools.ts"), "utf8");
    expect(source).not.toContain("createServiceRoleClient");
    expect(source).not.toContain("service_role");
    expect(source).not.toContain("SUPABASE_SERVICE_ROLE");
  });
});

describe("buildAssistantChatTools proposal tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildAssistantOperationsMock.mockReturnValue([]);
  });

  it("derives one propose_<kind> tool per registry action kind, mechanically", () => {
    const { tools } = buildTools();
    const proposeToolNames = Object.keys(tools).filter((name) => name.startsWith("propose_"));
    expect(proposeToolNames.sort()).toEqual(
      Object.keys(ACTION_METADATA)
        .map((kind) => `propose_${kind}`)
        .sort()
    );
  });

  it("hides kind and post-action chaining fields from the model-facing input schema", () => {
    const { tools } = buildTools();
    const inputSchema = (tools.propose_create_funding_opportunity as { inputSchema?: { shape?: Record<string, unknown> } })
      .inputSchema;
    const shapeKeys = Object.keys(inputSchema?.shape ?? {});
    expect(shapeKeys).toContain("title");
    expect(shapeKeys).not.toContain("kind");
    expect(shapeKeys).not.toContain("postActionWorkflowId");
    expect(shapeKeys).not.toContain("postActionPrompt");
    expect(shapeKeys).not.toContain("postActionPromptLabel");
  });

  it("proposes an approval-required action after an RLS-scoped reference check", async () => {
    const supabase = createSupabaseMock({
      funding_opportunities: [{ id: "opp-1" }],
    });
    const { tools } = buildTools({ supabase });

    const result = await toolExecute(tools, "propose_update_funding_opportunity_decision")(
      { opportunityId: "opp-1", decisionState: "pursue" },
      CALL_OPTIONS
    );

    expect(result).toEqual({
      status: "proposed",
      kind: "update_funding_opportunity_decision",
      payload: { kind: "update_funding_opportunity_decision", opportunityId: "opp-1", decisionState: "pursue" },
      approval: "approval_required",
      description: ACTION_METADATA.update_funding_opportunity_decision.description,
    });

    const query = supabase.queries.find((entry) => entry.table === "funding_opportunities");
    expect(query).toBeDefined();
    expect(query!.filters).toContainEqual(["id", "opp-1"]);
    expect(query!.filters).toContainEqual(["workspace_id", WORKSPACE_ID]);
  });

  it("carries the metadata approval tier on safe actions too", async () => {
    const supabase = createSupabaseMock({ reports: [{ id: "r1" }] });
    const { tools } = buildTools({ supabase });

    const result = await toolExecute(tools, "propose_generate_report_artifact")({ reportId: "r1" }, CALL_OPTIONS);

    expect(result.status).toBe("proposed");
    expect(result.approval).toBe("safe");
  });

  it("returns not_found instead of a proposal when the target row is not visible", async () => {
    const supabase = createSupabaseMock({ projects: [] });
    const { tools } = buildTools({ supabase });

    const result = await toolExecute(tools, "propose_create_project_funding_profile")(
      { projectId: "55555555-5555-4555-8555-555555555555" },
      CALL_OPTIONS
    );

    expect(result.status).toBe("not_found");
    expect(result.payload).toBeUndefined();
  });

  it("rejects an invalid payload against the schema branch before any query runs", async () => {
    const supabase = createSupabaseMock();
    const { tools } = buildTools({ supabase });

    const result = await toolExecute(tools, "propose_update_funding_opportunity_decision")(
      { opportunityId: "opp-1", decisionState: "definitely-not-a-state" },
      CALL_OPTIONS
    );

    expect(result.status).toBe("invalid_payload");
    expect(supabase.queries).toHaveLength(0);
  });

  it("refuses a payload that names a different workspace", async () => {
    const supabase = createSupabaseMock({
      billing_invoice_records: [{ id: "inv-1" }],
      funding_awards: [{ id: "award-1" }],
    });
    const { tools } = buildTools({ supabase });

    const result = await toolExecute(tools, "propose_link_billing_invoice_funding_award")(
      { workspaceId: OTHER_WORKSPACE_ID, invoiceId: "inv-1", fundingAwardId: "award-1" },
      CALL_OPTIONS
    );

    expect(result.status).toBe("refused");
    expect(String(result.reason)).toMatch(/different workspace/i);
  });

  it("never issues a mutating supabase call while proposing", async () => {
    const supabase = createSupabaseMock({
      reports: [{ id: "r1" }],
      projects: [{ id: "p1" }],
      funding_opportunities: [{ id: "opp-1" }],
    });
    const { tools } = buildTools({ supabase });

    await toolExecute(tools, "propose_generate_report_artifact")({ reportId: "r1" }, CALL_OPTIONS);
    await toolExecute(tools, "propose_create_project_funding_profile")({ projectId: "p1" }, CALL_OPTIONS);
    await toolExecute(tools, "propose_update_funding_opportunity_decision")(
      { opportunityId: "opp-1", decisionState: "monitor" },
      CALL_OPTIONS
    );
    await toolExecute(tools, "propose_create_funding_opportunity")({ title: "New opportunity" }, CALL_OPTIONS);

    expect(supabase.mutations).toEqual([]);
  });

  it("counts proposals against the shared per-request tool budget", async () => {
    const budget = createChatToolBudget({ maxCalls: 1 });
    const supabase = createSupabaseMock({ reports: [{ id: "r1" }] });
    const { tools } = buildTools({ supabase, budget });

    expect((await toolExecute(tools, "propose_generate_report_artifact")({ reportId: "r1" }, CALL_OPTIONS)).status).toBe(
      "proposed"
    );
    expect((await toolExecute(tools, "propose_generate_report_artifact")({ reportId: "r1" }, CALL_OPTIONS)).status).toBe(
      "refused"
    );
    expect(budget.usedCalls).toBe(1);
  });

  it("trims free-text fields before emitting the payload, so the approval hash matches execution", async () => {
    // Executing routes trim strings before recomputing the approval hash; an
    // untrimmed proposal payload would mint evidence for a hash execution can
    // never match — an inexplicable post-approval 403.
    const { tools } = buildTools();

    const result = await toolExecute(tools, "propose_create_funding_opportunity")(
      { title: "  SS4A Implementation Grant \n" },
      CALL_OPTIONS
    );

    expect(result.status).toBe("proposed");
    expect((result.payload as { title: string }).title).toBe("SS4A Implementation Grant");
  });

  it("rejects a whitespace-only required field instead of proposing an empty value", async () => {
    const { tools } = buildTools();

    const result = await toolExecute(tools, "propose_create_funding_opportunity")(
      { title: "   " },
      CALL_OPTIONS
    );

    expect(result.status).toBe("invalid_payload");
  });

  it("identifies proposal payloads with the isAssistantChatProposal guard", async () => {
    const supabase = createSupabaseMock({ reports: [{ id: "r1" }] });
    const { tools } = buildTools({ supabase });

    const proposal = await toolExecute(tools, "propose_generate_report_artifact")({ reportId: "r1" }, CALL_OPTIONS);

    expect(isAssistantChatProposal(proposal)).toBe(true);
    expect(isAssistantChatProposal({ status: "ok" })).toBe(false);
    expect(isAssistantChatProposal({ status: "proposed", kind: "not_a_kind", description: "x", payload: {} })).toBe(false);
  });
});
