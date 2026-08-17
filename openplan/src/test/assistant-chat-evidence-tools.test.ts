import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AssistantContext } from "@/lib/assistant/context";

vi.mock("@/lib/assistant/context", () => ({
  loadAssistantContext: vi.fn(),
}));
vi.mock("@/lib/assistant/operations", () => ({
  buildAssistantOperations: vi.fn().mockReturnValue([]),
}));

import {
  ASSISTANT_CHAT_TOOL_COMMENT_EXCERPT_LIMIT,
  ASSISTANT_CHAT_TOOL_COMMENT_EXCERPT_MAX_CHARS,
  ASSISTANT_CHAT_TOOL_GRANTS_GOV_ROWS,
  ASSISTANT_CHAT_TOOL_KPI_LIMIT,
  ASSISTANT_CHAT_TOOL_LIST_LIMIT,
  buildAssistantChatTools,
  createChatToolBudget,
} from "@/lib/assistant/chat-tools";
import { LINK_VALIDATION_NOT_SUPPORTED_CAVEAT } from "@/lib/models/zone-resolution";
import { modelingClaimStatusLabel } from "@/lib/models/evidence-backbone";
import { getCountyRunAllowedClaim, getCountyRunCaveats } from "@/lib/models/county-onramp";
import { GRANTS_GOV_SYNC_CAVEAT } from "@/lib/grants/grants-gov";
import { resetGrantsGovResponseCache } from "@/lib/grants/grants-gov-cache";

/**
 * Tests for the five evidence-reading chat tools.
 *
 * THE MOCK APPLIES FILTERS. The older chat-tools mock records filters but
 * returns fixture rows regardless, which cannot catch a dropped workspace
 * filter — the decoy tests here exist precisely to fail when `.eq("workspace_id",…)`
 * is removed from a tool, so every fixture below carries the columns the real
 * query filters on, and the mock resolves only matching rows.
 */

const USER_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const RUN_ID = "44444444-4444-4444-8444-444444444444";
const DECOY_RUN_ID = "55555555-5555-4555-8555-555555555555";
const COUNTY_RUN_ID = "66666666-6666-4666-8666-666666666666";
const CAMPAIGN_ID = "77777777-7777-4777-8777-777777777777";
const DECOY_CAMPAIGN_ID = "88888888-8888-4888-8888-888888888888";

const auditMock = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

type QueryLog = {
  table: string;
  filters: Array<[string, unknown]>;
  limit: number | null;
  columns: string | null;
  head: boolean;
  order: Array<[string, boolean]>;
};

type FilteringSupabaseMock = {
  client: { from: (table: string) => unknown };
  queries: QueryLog[];
  mutations: string[];
};

/** Dotted-path lookup so PostgREST embed filters (`a.b`) resolve on fixtures. */
function fieldValue(row: Record<string, unknown>, field: string): unknown {
  return field.split(".").reduce<unknown>((value, key) => {
    if (value && typeof value === "object") return (value as Record<string, unknown>)[key];
    return undefined;
  }, row);
}

function createFilteringSupabaseMock(
  tableData: Record<string, Array<Record<string, unknown>>> = {},
  tableErrors: Record<string, { message: string }> = {}
): FilteringSupabaseMock {
  const queries: QueryLog[] = [];
  const mutations: string[] = [];

  function from(table: string) {
    const log: QueryLog = { table, filters: [], limit: null, columns: null, head: false, order: [] };
    queries.push(log);

    const chain: Record<string, unknown> = {};
    chain.select = (columns: unknown, options?: { count?: string; head?: boolean }) => {
      log.columns = String(columns ?? "");
      if (options?.head) log.head = true;
      return chain;
    };
    chain.eq = (field: unknown, value: unknown) => {
      log.filters.push([String(field), value]);
      return chain;
    };
    chain.in = (field: unknown, values: unknown) => {
      log.filters.push([`in:${String(field)}`, values]);
      return chain;
    };
    chain.gt = (field: unknown, value: unknown) => {
      log.filters.push([`gt:${String(field)}`, value]);
      return chain;
    };
    chain.order = (column: unknown, options?: { ascending?: boolean }) => {
      log.order.push([String(column), options?.ascending ?? true]);
      return chain;
    };
    chain.limit = (value: unknown) => {
      log.limit = Number(value);
      return chain;
    };
    for (const name of ["insert", "update", "delete", "upsert"]) {
      chain[name] = () => {
        mutations.push(`${table}.${name}`);
        return chain;
      };
    }

    const filteredRows = () => {
      const rows = (tableData[table] ?? []).filter((row) =>
        log.filters.every(([field, expected]) => {
          if (field.startsWith("in:")) {
            return Array.isArray(expected) && expected.includes(fieldValue(row, field.slice(3)));
          }
          if (field.startsWith("gt:")) return true;
          return fieldValue(row, field) === expected;
        })
      );
      return log.limit === null ? rows : rows.slice(0, log.limit);
    };
    const resolve = () => {
      const error = tableErrors[table] ?? null;
      if (error) return { data: null, error, count: null };
      const rows = filteredRows();
      if (log.head) return { data: null, error: null, count: rows.length };
      return { data: rows, error: null, count: rows.length };
    };
    chain.maybeSingle = () => {
      const error = tableErrors[table] ?? null;
      if (error) return Promise.resolve({ data: null, error });
      return Promise.resolve({ data: filteredRows()[0] ?? null, error: null });
    };
    chain.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
      Promise.resolve(resolve()).then(onFulfilled, onRejected);
    return chain;
  }

  return { client: { from }, queries, mutations };
}

function workspaceContextFixture(): AssistantContext {
  return {
    kind: "workspace",
    workspace: { id: WORKSPACE_ID, name: "Foothill COG", plan: null, role: "admin" },
  } as unknown as AssistantContext;
}

type ExecuteFn = (input: unknown, options: { toolCallId: string; messages: unknown[] }) => Promise<Record<string, unknown>>;

function toolExecute(tools: ReturnType<typeof buildAssistantChatTools>, name: string): ExecuteFn {
  const candidate = tools[name] as { execute?: unknown } | undefined;
  if (!candidate?.execute) throw new Error(`tool ${name} has no execute`);
  return candidate.execute as ExecuteFn;
}

function buildTools(supabase: FilteringSupabaseMock) {
  const budget = createChatToolBudget();
  const tools = buildAssistantChatTools({
    supabase: supabase.client,
    context: workspaceContextFixture(),
    userId: USER_ID,
    audit: auditMock,
    budget,
  });
  return { tools, budget };
}

const CALL_OPTIONS = { toolCallId: "tool-call-1", messages: [] };

const ZONE_SKEW_NOTE =
  "Share of the expanded household base allocated to a different zone than the ACS distribution implies.";
const VMT_PROVENANCE =
  "Screening-grade sketch output: expansion-weighted from a capped synthetic-household sample.";

function modelRunFixture() {
  return {
    model_runs: [
      {
        id: RUN_ID,
        workspace_id: WORKSPACE_ID,
        run_title: "AM peak assignment",
        status: "succeeded",
        engine_key: "aequilibrae",
        error_message: null as string | null,
        started_at: "2026-08-01T00:00:00Z",
        completed_at: "2026-08-01T01:00:00Z",
        updated_at: "2026-08-01T01:00:00Z",
      },
      {
        id: DECOY_RUN_ID,
        workspace_id: OTHER_WORKSPACE_ID,
        run_title: "Decoy run in another workspace",
        status: "succeeded",
        engine_key: "aequilibrae",
        error_message: null,
        started_at: null,
        completed_at: null,
        updated_at: "2026-08-01T01:00:00Z",
      },
    ],
    model_run_kpis: [
      {
        run_id: RUN_ID,
        kpi_name: "daily_vmt",
        kpi_label: "Daily VMT (sketch)",
        kpi_category: "sketch_abm",
        value: 1234567.89,
        unit: "vehicle miles",
        geometry_ref: null,
        breakdown_json: { provenance: VMT_PROVENANCE, zone_sample_skew_note: ZONE_SKEW_NOTE },
      },
      {
        run_id: RUN_ID,
        kpi_name: "intrazonal_trip_share",
        kpi_label: "Intrazonal trip share",
        kpi_category: "sketch_abm",
        value: 0.36,
        unit: "share",
        geometry_ref: null,
        breakdown_json: { zone_count: 26 },
      },
      {
        run_id: DECOY_RUN_ID,
        kpi_name: "daily_vmt",
        kpi_label: "Decoy KPI",
        kpi_category: "sketch_abm",
        value: 1,
        unit: "vehicle miles",
        geometry_ref: null,
        breakdown_json: {},
      },
    ],
    modeling_validation_results: [
      {
        model_run_id: RUN_ID,
        track: "assignment",
        metric_key: "median_absolute_percent_error",
        metric_label: "Median absolute percent error",
        observed_value: 42.5,
        threshold_value: 30,
        threshold_max_value: 45,
        threshold_comparator: "lte",
        status: "warn",
        blocks_claim_grade: true,
        detail: "Median APE 42.5% exceeds the 30% claim-grade threshold.",
        evaluated_at: "2026-08-01T01:00:00Z",
      },
    ],
    modeling_claim_decisions: [
      {
        model_run_id: RUN_ID,
        track: "assignment",
        claim_status: "screening_grade",
        status_reason: "Median APE 42.5% exceeds the 30% claim-grade threshold.",
        reasons_json: ["Median APE 42.5% exceeds the 30% claim-grade threshold."],
        validation_summary_json: {
          passed: 2,
          warned: 1,
          failed: 0,
          missingRequiredMetricKeys: ["critical_absolute_percent_error"],
          requiredMetricKeys: ["median_absolute_percent_error", "critical_absolute_percent_error"],
        },
        decided_at: "2026-08-01T01:00:00Z",
      },
    ],
  };
}

describe("get_model_run_results", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reports stored values, units, and caveat sentences verbatim, with disclosed caps", async () => {
    const supabase = createFilteringSupabaseMock(modelRunFixture());
    const { tools } = buildTools(supabase);

    const result = await toolExecute(tools, "get_model_run_results")({ modelRunId: RUN_ID }, CALL_OPTIONS);

    expect(result.status).toBe("ok");
    expect((result.run as { title: string }).title).toBe("AM peak assignment");

    const kpis = result.kpis as Array<{ name: string; value: number; unit: string; caveats: string[] }>;
    const vmt = kpis.find((kpi) => kpi.name === "daily_vmt");
    expect(vmt).toBeDefined();
    // The stored number and unit, untouched.
    expect(vmt!.value).toBe(1234567.89);
    expect(vmt!.unit).toBe("vehicle miles");
    // The stored caveat sentences, VERBATIM — both of them.
    expect(vmt!.caveats).toContain(VMT_PROVENANCE);
    expect(vmt!.caveats).toContain(ZONE_SKEW_NOTE);

    expect(result.kpiRowCap).toBe(ASSISTANT_CHAT_TOOL_KPI_LIMIT);

    // Zone resolution: banded from the stored share via the lib, and the
    // link-validation caveat travels because 36% cannot support link comparison.
    const zone = result.zoneResolution as {
      status: string;
      intrazonalSharePct: number;
      zoneCount: number;
      supportsLinkLevelValidation: boolean;
      summary: string;
      caveat: string | null;
    };
    expect(zone.status).toBe("measured");
    expect(zone.intrazonalSharePct).toBe(36);
    expect(zone.zoneCount).toBe(26);
    expect(zone.supportsLinkLevelValidation).toBe(false);
    expect(zone.summary).toContain("36.0");
    expect(zone.caveat).toBe(LINK_VALIDATION_NOT_SUPPORTED_CAVEAT);

    // Validation detail sentence verbatim.
    const validation = result.validation as { results: Array<{ detail: string; status: string }> };
    expect(validation.results[0].detail).toBe("Median APE 42.5% exceeds the 30% claim-grade threshold.");
    expect(validation.results[0].status).toBe("warn");

    // Claim tier + its stored reason.
    const claim = result.claim as { tier: string; label: string; reason: string };
    expect(claim.tier).toBe("screening_grade");
    expect(claim.label).toBe(modelingClaimStatusLabel("screening_grade"));
    expect(claim.reason).toBe("Median APE 42.5% exceeds the 30% claim-grade threshold.");

    // The run read was workspace-scoped and the KPI read run-scoped + capped.
    const runQuery = supabase.queries.find((entry) => entry.table === "model_runs");
    expect(runQuery!.filters).toContainEqual(["workspace_id", WORKSPACE_ID]);
    const kpiQuery = supabase.queries.find((entry) => entry.table === "model_run_kpis");
    expect(kpiQuery!.filters).toContainEqual(["run_id", RUN_ID]);
    expect(kpiQuery!.limit).toBe(ASSISTANT_CHAT_TOOL_KPI_LIMIT);
  });

  it("refuses a run from another workspace as not_found (decoy present in fixture)", async () => {
    const supabase = createFilteringSupabaseMock(modelRunFixture());
    const { tools } = buildTools(supabase);

    const result = await toolExecute(tools, "get_model_run_results")({ modelRunId: DECOY_RUN_ID }, CALL_OPTIONS);

    expect(result.status).toBe("not_found");
    expect(JSON.stringify(result)).not.toContain("Decoy run in another workspace");
  });

  it("reports a failed run's missing cause as unrecorded, never invented", async () => {
    const fixture = modelRunFixture();
    fixture.model_runs[0].status = "failed";
    fixture.model_runs[0].error_message = null;
    const supabase = createFilteringSupabaseMock(fixture);
    const { tools } = buildTools(supabase);

    const result = await toolExecute(tools, "get_model_run_results")({ modelRunId: RUN_ID }, CALL_OPTIONS);
    const failure = (result.run as { failure: { errorMessage: string | null; note: string } }).failure;
    expect(failure.errorMessage).toBeNull();
    expect(failure.note).toMatch(/no failure cause was recorded/i);
    expect(failure.note).toMatch(/do not invent/i);
  });

  it("quotes a recorded failure message verbatim", async () => {
    const fixture = modelRunFixture();
    fixture.model_runs[0].status = "failed";
    fixture.model_runs[0].error_message = "worker: network package checksum mismatch";
    const supabase = createFilteringSupabaseMock(fixture);
    const { tools } = buildTools(supabase);

    const result = await toolExecute(tools, "get_model_run_results")({ modelRunId: RUN_ID }, CALL_OPTIONS);
    const failure = (result.run as { failure: { errorMessage: string } }).failure;
    expect(failure.errorMessage).toBe("worker: network package checksum mismatch");
  });
});

describe("explain_model_claim", () => {
  beforeEach(() => vi.clearAllMocks());

  it("quotes the stored decision verbatim and derives higher-tier evidence from stored blockers", async () => {
    const supabase = createFilteringSupabaseMock(modelRunFixture());
    const { tools } = buildTools(supabase);

    const result = await toolExecute(tools, "explain_model_claim")({ modelRunId: RUN_ID }, CALL_OPTIONS);

    expect(result.status).toBe("ok");
    const decisions = result.decisions as Array<{
      tier: string;
      label: string;
      reason: string;
      reasons: string[];
      evidenceForHigherTier: string[];
    }>;
    expect(decisions).toHaveLength(1);
    expect(decisions[0].tier).toBe("screening_grade");
    expect(decisions[0].label).toBe(modelingClaimStatusLabel("screening_grade"));
    // Stored reason, verbatim.
    expect(decisions[0].reason).toBe("Median APE 42.5% exceeds the 30% claim-grade threshold.");
    expect(decisions[0].reasons).toEqual(["Median APE 42.5% exceeds the 30% claim-grade threshold."]);
    // Higher-tier guidance names the missing metric and quotes the blocker.
    expect(decisions[0].evidenceForHigherTier.join("\n")).toContain("critical_absolute_percent_error");
    expect(decisions[0].evidenceForHigherTier.join("\n")).toContain(
      "Median APE 42.5% exceeds the 30% claim-grade threshold."
    );

    const ladder = result.tierLadder as Array<{ tier: string; rank: number }>;
    expect(ladder.map((entry) => entry.tier)).toContain("claim_grade_passed");
    expect(ladder.map((entry) => entry.tier)).toContain("prototype_only");
  });

  it("reports an absent claim decision as a known absence", async () => {
    const fixture = modelRunFixture();
    fixture.modeling_claim_decisions = [];
    const supabase = createFilteringSupabaseMock(fixture);
    const { tools } = buildTools(supabase);

    const result = await toolExecute(tools, "explain_model_claim")({ modelRunId: RUN_ID }, CALL_OPTIONS);
    expect(result.status).toBe("ok");
    expect(result.claimTier).toBeNull();
    expect(result.label).toBe(modelingClaimStatusLabel(null));
    expect(String(result.message)).toMatch(/known absence/i);
  });

  it("rejects zero or two subjects", async () => {
    const supabase = createFilteringSupabaseMock(modelRunFixture());
    const { tools } = buildTools(supabase);
    const explain = toolExecute(tools, "explain_model_claim");

    expect((await explain({}, CALL_OPTIONS)).status).toBe("invalid_payload");
    expect((await explain({ modelRunId: RUN_ID, countyRunId: COUNTY_RUN_ID }, CALL_OPTIONS)).status).toBe(
      "invalid_payload"
    );
  });

  it("explains a county run's stage posture with the lib's own caveat sentences", async () => {
    const supabase = createFilteringSupabaseMock({
      county_runs: [
        {
          id: COUNTY_RUN_ID,
          workspace_id: WORKSPACE_ID,
          run_name: "Sierra County screening",
          stage: "validated-screening",
          geography_label: "Sierra County, CA",
        },
      ],
      modeling_claim_decisions: [],
      modeling_source_manifests: [],
      modeling_validation_results: [],
    });
    const { tools } = buildTools(supabase);

    const result = await toolExecute(tools, "explain_model_claim")({ countyRunId: COUNTY_RUN_ID }, CALL_OPTIONS);

    expect(result.status).toBe("ok");
    const posture = result.stagePosture as {
      stage: string;
      screeningGrade: boolean;
      allowedClaim: string;
      caveats: string[];
    };
    expect(posture.stage).toBe("validated-screening");
    expect(posture.screeningGrade).toBe(true);
    // The county-onramp lib's own sentences, verbatim.
    expect(posture.allowedClaim).toBe(getCountyRunAllowedClaim("validated-screening"));
    expect(posture.caveats).toEqual(getCountyRunCaveats("validated-screening", null));
  });

  it("refuses a county run from another workspace as not_found", async () => {
    const supabase = createFilteringSupabaseMock({
      county_runs: [
        {
          id: COUNTY_RUN_ID,
          workspace_id: OTHER_WORKSPACE_ID,
          run_name: "Decoy county run",
          stage: "validated-screening",
          geography_label: null,
        },
      ],
    });
    const { tools } = buildTools(supabase);

    const result = await toolExecute(tools, "explain_model_claim")({ countyRunId: COUNTY_RUN_ID }, CALL_OPTIONS);
    expect(result.status).toBe("not_found");
    expect(JSON.stringify(result)).not.toContain("Decoy county run");
  });

  it("has no write path: the tools module contains no supabase write verb at all", () => {
    const source = readFileSync(path.join(process.cwd(), "src/lib/assistant/chat-tools.ts"), "utf8");
    // EXPLAIN ONLY, structurally: nothing in this module can call a mutating
    // supabase verb, so no tool output can be written back through it.
    expect(source).not.toMatch(/\.(insert|update|upsert|delete)\(/);
  });
});

describe("search_grants_gov", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetGrantsGovResponseCache();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const upstreamPayload = {
    errorcode: 0,
    data: {
      hitCount: 240,
      oppHits: [
        {
          id: 358800,
          number: "693JJ3-26-NOFO-SS4A",
          title: "Safe Streets and Roads for All",
          agencyCode: "DOT-DOT X-50",
          agency: "DOT Federal Highway Administration",
          openDate: "07/06/2026",
          closeDate: "09/30/2026",
          oppStatus: "posted",
          cfdaList: ["20.939"],
        },
      ],
      agencies: [],
      eligibilities: [],
    },
  };

  it("searches live, discloses the caveat verbatim, then serves the cache on the second call", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(upstreamPayload),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { tools } = buildTools(createFilteringSupabaseMock());
    const search = toolExecute(tools, "search_grants_gov");

    const first = await search({ keyword: "safe streets" }, CALL_OPTIONS);
    expect(first.status).toBe("ok");
    expect(first.cached).toBe(false);
    expect(first.caveat).toBe(GRANTS_GOV_SYNC_CAVEAT);
    expect(first.hitCount).toBe(240);
    expect(first.rowCap).toBe(ASSISTANT_CHAT_TOOL_GRANTS_GOV_ROWS);
    expect(first.truncated).toBe(true);
    const opportunities = first.opportunities as Array<{ title: string; closeDate: string; detailUrl: string }>;
    expect(opportunities[0].title).toBe("Safe Streets and Roads for All");
    expect(opportunities[0].closeDate).toBe("2026-09-30");
    expect(opportunities[0].detailUrl).toContain("grants.gov");

    const second = await search({ keyword: "safe streets" }, { ...CALL_OPTIONS, toolCallId: "tool-call-2" });
    expect(second.status).toBe("ok");
    expect(second.cached).toBe(true);
    // The cache answered; grants.gov was fetched exactly once.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("api.grants.gov");
  });

  it("reports an unreachable upstream honestly, without throwing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const { tools } = buildTools(createFilteringSupabaseMock());

    const result = await toolExecute(tools, "search_grants_gov")({ keyword: "transit" }, CALL_OPTIONS);
    expect(result.status).toBe("unavailable");
    expect(String(result.message)).toMatch(/not evidence that no opportunities exist/i);
  });

  it("rejects a facet filter outside the code alphabet before any fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { tools } = buildTools(createFilteringSupabaseMock());

    const result = await toolExecute(tools, "search_grants_gov")(
      { keyword: "transit", agencies: "DOT-FTA|<script>" },
      CALL_OPTIONS
    );
    expect(result.status).toBe("invalid_query");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("list_workspace_records", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists a kind workspace-scoped with the shared cap, excluding another workspace's decoy", async () => {
    const supabase = createFilteringSupabaseMock({
      engagement_campaigns: [
        { id: "c1", workspace_id: WORKSPACE_ID, title: "Corridor outreach", status: "active", updated_at: "2026-08-01T00:00:00Z" },
        { id: "c2", workspace_id: OTHER_WORKSPACE_ID, title: "Decoy campaign", status: "active", updated_at: "2026-08-01T00:00:00Z" },
      ],
    });
    const { tools } = buildTools(supabase);

    const result = await toolExecute(tools, "list_workspace_records")({ kind: "campaigns" }, CALL_OPTIONS);

    expect(result.status).toBe("ok");
    const records = result.records as Array<{ id: string; title: string; status: string; updatedAt: string }>;
    expect(records).toEqual([
      { id: "c1", title: "Corridor outreach", status: "active", updatedAt: "2026-08-01T00:00:00Z" },
    ]);
    expect(JSON.stringify(result)).not.toContain("Decoy campaign");
    expect(result.rowCap).toBe(ASSISTANT_CHAT_TOOL_LIST_LIMIT);

    const query = supabase.queries.find((entry) => entry.table === "engagement_campaigns");
    expect(query!.filters).toContainEqual(["workspace_id", WORKSPACE_ID]);
    expect(query!.limit).toBe(ASSISTANT_CHAT_TOOL_LIST_LIMIT);
  });

  it("maps per-kind title/status columns (model_runs → run_title, funding_awards → spending_status)", async () => {
    const supabase = createFilteringSupabaseMock({
      model_runs: [
        { id: "r1", workspace_id: WORKSPACE_ID, run_title: "PM peak", status: "succeeded", updated_at: "2026-08-02T00:00:00Z" },
      ],
      funding_awards: [
        { id: "a1", workspace_id: WORKSPACE_ID, title: "ATP award", spending_status: "active", updated_at: "2026-08-03T00:00:00Z" },
      ],
    });
    const { tools } = buildTools(supabase);
    const list = toolExecute(tools, "list_workspace_records");

    const runs = await list({ kind: "model_runs" }, CALL_OPTIONS);
    expect((runs.records as Array<{ title: string }>)[0].title).toBe("PM peak");

    const awards = await list({ kind: "funding_awards" }, { ...CALL_OPTIONS, toolCallId: "t2" });
    expect((awards.records as Array<{ status: string }>)[0].status).toBe("active");
  });

  it("gtfs_feeds falls back to created_at recency and discloses that shared public feeds are out of scope", async () => {
    const supabase = createFilteringSupabaseMock({
      gtfs_feeds: [
        {
          id: "g1",
          workspace_id: WORKSPACE_ID,
          agency_name: "Foothill Transit",
          status: "loaded",
          loaded_at: null,
          created_at: "2026-07-01T00:00:00Z",
        },
        // The deployment-shared public feed: workspace_id NULL never equals the
        // workspace id, so it must not appear.
        { id: "g2", workspace_id: null, agency_name: "Statewide Decoy Transit", status: "loaded", loaded_at: null, created_at: "2026-07-01T00:00:00Z" },
      ],
    });
    const { tools } = buildTools(supabase);

    const result = await toolExecute(tools, "list_workspace_records")({ kind: "gtfs_feeds" }, CALL_OPTIONS);
    const records = result.records as Array<{ id: string; updatedAt: string }>;
    expect(records).toHaveLength(1);
    expect(records[0].id).toBe("g1");
    expect(records[0].updatedAt).toBe("2026-07-01T00:00:00Z");
    expect(String(result.note)).toMatch(/public feeds/i);
    expect(JSON.stringify(result)).not.toContain("Statewide Decoy Transit");
  });

  it("refuses an unknown kind without querying", async () => {
    const supabase = createFilteringSupabaseMock();
    const { tools } = buildTools(supabase);

    const result = await toolExecute(tools, "list_workspace_records")({ kind: "workspaces" }, CALL_OPTIONS);
    expect(result.status).toBe("invalid_payload");
    expect(supabase.queries).toHaveLength(0);
  });
});

describe("get_engagement_responses", () => {
  beforeEach(() => vi.clearAllMocks());

  const RESIDENT_ANSWER_TEXT = "My street floods every winter and the crossing is unsafe.";

  function campaignFixture() {
    const longBody = "B".repeat(ASSISTANT_CHAT_TOOL_COMMENT_EXCERPT_MAX_CHARS + 200);
    return {
      engagement_campaigns: [
        { id: CAMPAIGN_ID, workspace_id: WORKSPACE_ID, title: "Corridor outreach", status: "active" },
        { id: DECOY_CAMPAIGN_ID, workspace_id: OTHER_WORKSPACE_ID, title: "Decoy campaign", status: "active" },
      ],
      engagement_items: [
        {
          id: "i1",
          campaign_id: CAMPAIGN_ID,
          title: "Crosswalk request",
          body: longBody,
          status: "approved",
          source_type: "public",
          created_at: "2026-08-01T00:00:00Z",
        },
        {
          id: "i2",
          campaign_id: CAMPAIGN_ID,
          title: "Pending comment must not appear",
          body: "not yet moderated",
          status: "pending",
          source_type: "public",
          created_at: "2026-08-02T00:00:00Z",
        },
        {
          id: "i3",
          campaign_id: CAMPAIGN_ID,
          title: "Flagged comment",
          body: "flagged",
          status: "flagged",
          source_type: "public",
          created_at: "2026-08-03T00:00:00Z",
        },
      ],
      engagement_survey_questions: [
        {
          id: "q1",
          campaign_id: CAMPAIGN_ID,
          question_type: "single_choice",
          prompt: "Which improvement matters most?",
          help_text: null,
          required: true,
          is_active: true,
          status: "published",
          sort_order: 0,
          config_json: {},
          category_id: null,
        },
      ],
      engagement_survey_question_options: [
        { id: "o1", question_id: "q1", campaign_id: CAMPAIGN_ID, label: "Sidewalks", value: null, is_active: true, sort_order: 0, metadata_json: {} },
      ],
      engagement_survey_answers: [
        {
          campaign_id: CAMPAIGN_ID,
          question_id: "q1",
          question_type: "single_choice",
          answer_json: { option_id: "o1" },
          answer_text: RESIDENT_ANSWER_TEXT,
          engagement_survey_response_sessions: { status: "approved" },
        },
      ],
      engagement_survey_response_sessions: [
        {
          id: "s1",
          campaign_id: CAMPAIGN_ID,
          status: "approved",
          submitted_by: null,
          source_type: "public",
          moderation_notes: null,
          created_at: "2026-08-01T00:00:00Z",
          updated_at: "2026-08-01T00:00:00Z",
        },
      ],
    };
  }

  it("returns truncated approved excerpts, moderation counts, and survey COUNTS — never raw answers", async () => {
    const supabase = createFilteringSupabaseMock(campaignFixture());
    const { tools } = buildTools(supabase);

    const result = await toolExecute(tools, "get_engagement_responses")({ campaignId: CAMPAIGN_ID }, CALL_OPTIONS);

    expect(result.status).toBe("ok");
    const comments = result.comments as {
      rowCap: number;
      excerpts: Array<{ id: string; excerpt: string; excerptTruncated: boolean }>;
    };
    expect(comments.rowCap).toBe(ASSISTANT_CHAT_TOOL_COMMENT_EXCERPT_LIMIT);
    expect(comments.excerpts).toHaveLength(1);
    expect(comments.excerpts[0].id).toBe("i1");
    expect(comments.excerpts[0].excerpt.length).toBeLessThanOrEqual(ASSISTANT_CHAT_TOOL_COMMENT_EXCERPT_MAX_CHARS);
    expect(comments.excerpts[0].excerptTruncated).toBe(true);
    // The unmoderated comment is not excerpted.
    expect(JSON.stringify(comments)).not.toContain("Pending comment must not appear");

    const moderation = result.moderationQueue as { status: string; pending: number; flagged: number };
    expect(moderation.status).toBe("ok");
    expect(moderation.pending).toBe(1);
    expect(moderation.flagged).toBe(1);

    const survey = result.survey as {
      status: string;
      approvedResponseCount: number;
      questions: Array<{ prompt: string; answeredCount: number }>;
    };
    expect(survey.status).toBe("ok");
    expect(survey.approvedResponseCount).toBe(1);
    expect(survey.questions).toEqual([
      { prompt: "Which improvement matters most?", questionType: "single_choice", answeredCount: 1 },
    ]);
    // Counts only: the resident's own words never appear anywhere in the payload.
    expect(JSON.stringify(result)).not.toContain(RESIDENT_ANSWER_TEXT);
    expect(JSON.stringify(result)).not.toContain("Sidewalks");
  });

  it("reports survey counts as unavailable — not zero — when the confined response tables refuse the read", async () => {
    const supabase = createFilteringSupabaseMock(campaignFixture(), {
      engagement_survey_answers: { message: "permission denied for table engagement_survey_answers" },
      engagement_survey_response_sessions: { message: "permission denied for table engagement_survey_response_sessions" },
    });
    const { tools } = buildTools(supabase);

    const result = await toolExecute(tools, "get_engagement_responses")({ campaignId: CAMPAIGN_ID }, CALL_OPTIONS);

    expect(result.status).toBe("ok");
    const survey = result.survey as { status: string; message: string; approvedResponseCount?: number };
    expect(survey.status).toBe("unavailable");
    expect(survey.approvedResponseCount).toBeUndefined();
    expect(survey.message).toMatch(/not a campaign with zero responses/i);
  });

  it("refuses a campaign from another workspace as not_found", async () => {
    const supabase = createFilteringSupabaseMock(campaignFixture());
    const { tools } = buildTools(supabase);

    const result = await toolExecute(tools, "get_engagement_responses")({ campaignId: DECOY_CAMPAIGN_ID }, CALL_OPTIONS);
    expect(result.status).toBe("not_found");
    expect(JSON.stringify(result)).not.toContain("Decoy campaign");
  });

  it("never issues a mutating supabase call across all five evidence tools", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const supabase = createFilteringSupabaseMock(campaignFixture());
    const { tools } = buildTools(supabase);

    await toolExecute(tools, "get_model_run_results")({ modelRunId: RUN_ID }, CALL_OPTIONS);
    await toolExecute(tools, "explain_model_claim")({ modelRunId: RUN_ID }, { ...CALL_OPTIONS, toolCallId: "t2" });
    await toolExecute(tools, "search_grants_gov")({ keyword: "transit" }, { ...CALL_OPTIONS, toolCallId: "t3" });
    await toolExecute(tools, "list_workspace_records")({ kind: "plans" }, { ...CALL_OPTIONS, toolCallId: "t4" });
    await toolExecute(tools, "get_engagement_responses")({ campaignId: CAMPAIGN_ID }, { ...CALL_OPTIONS, toolCallId: "t5" });

    expect(supabase.mutations).toEqual([]);
    vi.unstubAllGlobals();
  });
});
