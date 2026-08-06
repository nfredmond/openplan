import { describe, expect, it, vi } from "vitest";

/**
 * A FAILED READ MAY NOT BECOME A SENTENCE THE COPILOT SPEAKS.
 *
 * WHY THIS FILE EXISTS. `src/lib/assistant/context.ts` is the grounding the
 * Planning Agent reasons from, and it reads about thirty tables to build it.
 * Every one of those reads used to answer a failure the same way it answers an
 * empty table — `result.data ?? []` — and the surfaces downstream turn that into
 * prose: "0 chapters are ready for review and 0 are complete", "No funding
 * opportunities are linked to this project yet", "Linked projects: 0". Over a
 * dropped connection, a revoked grant, or an RLS change, each of those is a
 * false statement about an agency's own work, made in the one place most likely
 * to be copied into a grant narrative or an RTP chapter.
 *
 * THE HARNESS IS THE POINT. A mocked Supabase client hands back its fixture
 * whatever the code asked for, which is exactly why this class shipped
 * undetected — the failure path is unreachable unless the harness can FAIL A
 * NAMED READ. `createSupabase` below takes a per-table result, so a test can say
 * "rtp_cycle_chapters returns a permission error and everything else answers
 * normally" and then assert on what the copilot says about chapters.
 *
 * EACH TEST ASSERTS BOTH HALVES: that the honest disclosure appeared, AND that
 * the old false claim is gone. The second half is what a later refactor would
 * quietly break.
 */

vi.mock("@/lib/operations/workspace-summary", () => ({
  loadWorkspaceOperationsSummaryForWorkspace: async () => ({
    posture: "under control",
    nextCommand: null,
    nextActions: [],
    commandQueue: [],
    counts: {
      queueDepth: 0,
      reportRefreshRecommended: 0,
      reportNoPacket: 0,
      rtpFundingReviewPackets: 0,
      projectFundingNeedAnchorProjects: 0,
      projectFundingSourcingProjects: 0,
      projectFundingDecisionProjects: 0,
      projectFundingAwardRecordProjects: 0,
      projectFundingReimbursementStartProjects: 0,
      projectFundingReimbursementActiveProjects: 0,
      projectFundingGapProjects: 0,
    },
  }),
}));

import {
  AssistantContextUnreadableError,
  loadAssistantContext,
  RTP_CYCLE_ASSISTANT_COLUMNS,
  RTP_CYCLE_LINK_ASSISTANT_COLUMNS,
} from "@/lib/assistant/context";
import { buildAssistantPreview, buildAssistantResponse } from "@/lib/assistant/respond";
import { describeRtpFiscalConstraint } from "@/lib/rtp/fiscal-constraint";

type TableResult = { data: unknown; error: { message: string } | null };

/**
 * The top-level column names of a PostgREST projection.
 *
 * `id, projects(id, name)` is two columns — `id` and `projects` — not four, so
 * the split has to respect parentheses. Used to make the double below answer
 * with what was ASKED FOR rather than with everything the fixture happens to
 * hold.
 */
function projectionColumns(columns: string): string[] {
  const tokens: string[] = [];
  let depth = 0;
  let current = "";

  for (const char of columns) {
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      tokens.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  tokens.push(current);

  return tokens
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => {
      const paren = token.indexOf("(");
      return (paren < 0 ? token : token.slice(0, paren)).trim();
    });
}

function projectRow(row: Record<string, unknown>, columns: string): Record<string, unknown> {
  if (columns.trim() === "*") return row;
  const wanted = new Set(projectionColumns(columns));
  return Object.fromEntries(Object.entries(row).filter(([key]) => wanted.has(key)));
}

function projectResult(result: TableResult, columns: string): TableResult {
  if (result.data === null || result.data === undefined) return result;
  if (Array.isArray(result.data)) {
    return {
      ...result,
      data: result.data.map((row) => projectRow(row as Record<string, unknown>, columns)),
    };
  }
  return { ...result, data: projectRow(result.data as Record<string, unknown>, columns) };
}

/**
 * A Supabase stand-in whose per-table result is chosen by the test.
 *
 * Every builder method returns the same node and the node is awaitable, which
 * covers all four shapes these loaders use: a bare `await` on the chain,
 * `.maybeSingle()`, `.order().limit()`, and a chain inside `Promise.all`. Tables
 * the test does not name answer with an empty, error-free result — a read that
 * SUCCEEDED and found nothing, so any failure an assertion sees is the one the
 * test injected.
 *
 * TWO THINGS THIS DOUBLE NOW DOES THAT IT DID NOT, AND WHY THEY MATTER MORE
 * THAN THE TESTS THAT USE THEM.
 *
 * `select` USED TO BE `select: () => node` — it threw its argument away. A
 * projection that never reaches the double is a projection no test in this file
 * could ever have had an opinion about, which is precisely how the RTP cycle
 * copilot shipped selecting neither `financial_basis_year` nor
 * `annual_inflation_rate` nor a single column of the financial element, while
 * every assertion here stayed green. `selects` now records `{ table, columns }`
 * for every read, so a test can assert on the string that actually decides what
 * the database returns.
 *
 * `projectFixtureColumns` goes further for the tables named in it: the fixture
 * row is PROJECTED DOWN to the columns the code asked for, so a column missing
 * from a `.select()` is missing from the row the loader sees — the behaviour of
 * a real client, and the only way a test can fail for the reason the real page
 * would break. It is opt-in per table rather than global because the loaders
 * this file exercises read about thirty tables and a fixture that quietly loses
 * a key elsewhere would fail for an unrelated reason.
 */
function createSupabase(
  results: Record<string, TableResult>,
  options: { projectFixtureColumns?: readonly string[] } = {}
) {
  const asked: string[] = [];
  const selects: Array<{ table: string; columns: string }> = [];
  const projected = new Set(options.projectFixtureColumns ?? []);

  return {
    asked,
    selects,
    client: {
      from(table: string) {
        asked.push(table);
        const result = results[table] ?? { data: [], error: null };
        let answer = result;
        const node: Record<string, unknown> = {
          select: (columns?: string) => {
            const projection = columns ?? "*";
            selects.push({ table, columns: projection });
            if (projected.has(table)) answer = projectResult(result, projection);
            return node;
          },
          eq: () => node,
          in: () => node,
          not: () => node,
          order: () => node,
          limit: () => node,
          maybeSingle: async () => answer,
          then: (resolve: (value: TableResult) => unknown, reject: (reason: unknown) => unknown) =>
            Promise.resolve(answer).then(resolve, reject),
        };
        return node;
      },
    },
  };
}

const MEMBERSHIP: TableResult = {
  data: {
    workspace_id: "workspace-1",
    role: "owner",
    workspaces: { name: "OpenPlan QA", created_at: "2026-01-01T00:00:00.000Z" },
  },
  error: null,
};

const RTP_CYCLE_ROW: TableResult = {
  data: {
    id: "cycle-1",
    workspace_id: "workspace-1",
    title: "2027 RTP",
    summary: "Countywide RTP update",
    status: "draft",
    geography_label: "Nevada County",
    horizon_start_year: 2027,
    horizon_end_year: 2050,
    adoption_target_date: null,
    public_review_open_at: null,
    public_review_close_at: null,
    updated_at: "2026-03-28T17:30:00.000Z",
  },
  error: null,
};

const PROJECT_ROW: TableResult = {
  data: {
    id: "project-1",
    workspace_id: "workspace-1",
    name: "Downtown Mobility Plan",
    summary: "Corridor delivery",
    status: "active",
    plan_type: "corridor",
    delivery_phase: "design",
    updated_at: "2026-03-28T17:40:00.000Z",
  },
  error: null,
};

const RTP_TARGET = {
  kind: "rtp_cycle" as const,
  id: "cycle-1",
  workspaceId: "workspace-1",
  runId: null,
  baselineRunId: null,
};

const PROJECT_TARGET = {
  kind: "project" as const,
  id: "project-1",
  workspaceId: "workspace-1",
  runId: null,
  baselineRunId: null,
};

describe("the RTP cycle copilot over a failed chapter read", () => {
  const chaptersDenied = () =>
    createSupabase({
      workspace_members: MEMBERSHIP,
      rtp_cycles: RTP_CYCLE_ROW,
      rtp_cycle_chapters: { data: null, error: { message: "permission denied for table rtp_cycle_chapters" } },
      project_rtp_cycle_links: { data: [{ id: "link-1" }], error: null },
    }).client;

  it("discloses the chapter read instead of counting zero chapters", async () => {
    const context = await loadAssistantContext(chaptersDenied(), "user-1", RTP_TARGET);
    if (!context || context.kind !== "rtp_cycle") throw new Error("Expected an RTP cycle context");

    expect(context.unreadable?.map((failure) => failure.label)).toContain("RTP chapters");
    expect(context.unreadable?.find((failure) => failure.label === "RTP chapters")?.message).toContain(
      "permission denied"
    );

    const preview = buildAssistantPreview(context);
    const facts = preview.facts.join("\n");

    // The honest half.
    expect(facts).toContain("Unknown: chapter progress for this cycle.");
    expect(facts).toContain("permission denied for table rtp_cycle_chapters");
    // The old claim, which must be gone.
    expect(facts).not.toContain("0 chapters are ready for review");
    expect(preview.stats).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: "Chapters", value: "Unknown" })])
    );
  });

  it("leads the grounding with the read failure, in both the preview and the response", async () => {
    const context = await loadAssistantContext(chaptersDenied(), "user-1", RTP_TARGET);
    if (!context || context.kind !== "rtp_cycle") throw new Error("Expected an RTP cycle context");

    expect(buildAssistantPreview(context).facts[0]).toMatch(/^Read failure — this copilot could not read RTP chapters/);

    const response = buildAssistantResponse(context, "rtp-brief");
    expect(response.findings[0]).toMatch(/^Read failure — this copilot could not read RTP chapters/);
    expect(response.caution).toContain("Do not state a count, a total, or an absence");
    expect(response.findings.join("\n")).not.toContain("0 chapters are in scope");

    // The evidence list is a SEPARATE code path from the findings, and the
    // workflow that prints a chapter count there is the packet-generate one —
    // asserting it on the default brief proved nothing, which a mutation
    // caught: reverting all four evidence lines left that assertion green.
    const generatePlan = buildAssistantResponse(context, "rtp-packet-generate");
    expect(generatePlan.evidence.join("\n")).not.toMatch(/Chapters: \d/);
    expect(generatePlan.evidence.join("\n")).toContain("Chapters: unknown — RTP chapters could not be read");
  });

  it("still counts a lane that answered — only the failed one goes unknown", async () => {
    const context = await loadAssistantContext(chaptersDenied(), "user-1", RTP_TARGET);
    if (!context || context.kind !== "rtp_cycle") throw new Error("Expected an RTP cycle context");

    expect(context.counts.linkedProjects).toBe(1);
    expect(buildAssistantPreview(context).stats).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: "Projects", value: "1" })])
    );
  });

  /**
   * CLASSIFY FIRST, THEN COLLECT. A deployment that never ran the chapter
   * migration truthfully has no chapters — the table cannot hold one — so the
   * template fallback is honest there and must NOT be disclosed as a failure.
   * Without this, the fix would trade one wrong answer for another.
   */
  it("keeps the template fallback silent when the schema is merely pending", async () => {
    const supabase = createSupabase({
      workspace_members: MEMBERSHIP,
      rtp_cycles: RTP_CYCLE_ROW,
      rtp_cycle_chapters: {
        data: null,
        error: { message: 'relation "public.rtp_cycle_chapters" does not exist' },
      },
    }).client;

    const context = await loadAssistantContext(supabase, "user-1", RTP_TARGET);
    if (!context || context.kind !== "rtp_cycle") throw new Error("Expected an RTP cycle context");

    expect(context.unreadable?.map((failure) => failure.label) ?? []).not.toContain("RTP chapters");
    expect(context.counts.chapters).toBeGreaterThan(0);
    expect(buildAssistantPreview(context).facts.join("\n")).toContain("chapters are ready for review");
  });
});

/**
 * THE FINANCIAL ELEMENT — the half of an RTP a board votes on, which the
 * copilot could not see.
 *
 * The RTP cycle page shows a revenue table, horizon periods and a
 * fiscal-constraint verdict. The copilot's projection selected none of it: no
 * `financial_basis_year`, no `annual_inflation_rate`, `project_rtp_cycle_links`
 * read as `id` alone, and `rtp_horizon_bands` / `rtp_financial_assumptions` /
 * `rtp_performance_measures` never read at all. A planner could ask the copilot
 * about a plan whose own page answers the question and be answered from chapter
 * and packet counts.
 *
 * EVERY TEST BELOW RUNS THE REAL LOADER AGAINST A DOUBLE THAT HONOURS THE
 * PROJECTION, which is the only reason any of them can fail for the reason the
 * real page would break. See `createSupabase`.
 */
describe("the RTP cycle copilot reads the financial element", () => {
  const FINANCIAL_TABLES = [
    "rtp_cycles",
    "project_rtp_cycle_links",
    "rtp_horizon_bands",
    "rtp_financial_assumptions",
    "rtp_performance_measures",
  ] as const;

  /** 2027–2050 horizon, 2026 base year, no inflation rate recorded. */
  const FINANCIAL_CYCLE_ROW: TableResult = {
    data: {
      ...(RTP_CYCLE_ROW.data as Record<string, unknown>),
      financial_basis_year: 2026,
      annual_inflation_rate: null,
    },
    error: null,
  };

  /** One period covering the whole declared horizon, so coverage is not a blocker. */
  const HORIZON_BANDS: TableResult = {
    data: [
      {
        id: "band-1",
        label: "2027–2050",
        start_year: 2027,
        end_year: 2050,
        escalation_target_year: null,
        cost_estimate_basis: "itemized",
        sort_order: 0,
      },
    ],
    error: null,
  };

  const REVENUE_LINES: TableResult = {
    data: [
      {
        id: "line-1",
        horizon_band_id: "band-1",
        entry_kind: "revenue",
        source_name: "Regional sales tax",
        amount: "500000000",
        amount_basis_year: 2026,
        notes: null,
      },
    ],
    error: null,
  };

  const PERFORMANCE_MEASURES: TableResult = {
    data: [
      {
        id: "measure-1",
        measure_key: "vmt_per_capita",
        label: "VMT per capita",
        unit: "miles",
        baseline_value: "21.4",
        baseline_year: 2024,
        target_value: "19.0",
        target_year: 2050,
        data_source: "Regional travel model, 2024 base year",
        notes: null,
        sort_order: 0,
      },
      {
        id: "measure-2",
        measure_key: "transit_mode_share",
        label: "Transit mode share",
        unit: "percent",
        baseline_value: "2.1",
        baseline_year: 2024,
        target_value: "4.0",
        target_year: 2050,
        data_source: "NTD 2024",
        notes: null,
        sort_order: 1,
      },
    ],
    error: null,
  };

  function constrainedLink(estimatedCost: string | null): TableResult {
    return {
      data: [
        {
          id: "link-1",
          project_id: "project-1",
          portfolio_role: "constrained",
          horizon_band_id: "band-1",
          estimated_cost: estimatedCost,
          cost_basis_year: estimatedCost === null ? null : 2026,
          projects: { id: "project-1", name: "Downtown Mobility Plan" },
        },
      ],
      error: null,
    };
  }

  function financialWorkspace(overrides: Record<string, TableResult> = {}) {
    return createSupabase(
      {
        workspace_members: MEMBERSHIP,
        rtp_cycles: FINANCIAL_CYCLE_ROW,
        rtp_horizon_bands: HORIZON_BANDS,
        rtp_financial_assumptions: REVENUE_LINES,
        rtp_performance_measures: PERFORMANCE_MEASURES,
        project_rtp_cycle_links: constrainedLink(null),
        ...overrides,
      },
      { projectFixtureColumns: FINANCIAL_TABLES }
    );
  }

  /**
   * THE PROJECTION IS THE ARTIFACT. The consts are asserted AND the recorded
   * `.select()` is asserted to equal them — a const nothing selects protects
   * nothing, which is exactly the state this file was in before: the columns
   * were right in the page and absent from the copilot, and no test could tell.
   */
  it("asks the database for the columns the fiscal verdict is computed from", async () => {
    const supabase = financialWorkspace();
    await loadAssistantContext(supabase.client, "user-1", RTP_TARGET);

    for (const column of ["financial_basis_year", "annual_inflation_rate"]) {
      expect(RTP_CYCLE_ASSISTANT_COLUMNS, `the cycle projection lost "${column}"`).toContain(column);
    }
    // `portfolio_role` decides which projects count as cost at all — see the
    // const's own doc block, and the test below that proves the consequence.
    for (const column of [
      "portfolio_role",
      "horizon_band_id",
      "estimated_cost",
      "cost_basis_year",
    ]) {
      expect(RTP_CYCLE_LINK_ASSISTANT_COLUMNS, `the link projection lost "${column}"`).toContain(column);
    }

    expect(supabase.selects.filter((entry) => entry.table === "rtp_cycles").map((entry) => entry.columns)).toEqual([
      RTP_CYCLE_ASSISTANT_COLUMNS,
    ]);
    expect(
      supabase.selects.filter((entry) => entry.table === "project_rtp_cycle_links").map((entry) => entry.columns)
    ).toEqual([RTP_CYCLE_LINK_ASSISTANT_COLUMNS]);

    expect(supabase.asked).toContain("rtp_horizon_bands");
    expect(supabase.asked).toContain("rtp_financial_assumptions");
    expect(supabase.asked).toContain("rtp_performance_measures");
  });

  /**
   * THE `portfolio_role` TEST. Ask for the cost columns without it and the
   * engine sees no constrained project, counts no cost, raises no blocker, and
   * answers `constrained` against real revenue — the copilot telling a planner
   * an unpriced plan is affordable. Nothing errors and nothing is empty.
   */
  it("does not report an unpriced plan as fiscally constrained", async () => {
    const context = await loadAssistantContext(financialWorkspace().client, "user-1", RTP_TARGET);
    if (!context || context.kind !== "rtp_cycle") throw new Error("Expected an RTP cycle context");

    expect(context.fiscal?.summary?.verdict).toBe("not_determined");
    expect(context.fiscal?.summary?.blockers[0]?.code).toBe("unpriced_constrained_project");
    expect(context.fiscal?.summary?.constrainedProjectCount).toBe(1);

    const facts = buildAssistantPreview(context).facts.join("\n");
    expect(facts).toContain("Fiscal constraint: not determined.");
    expect(facts).toContain("no cost recorded");
    // The three sentences an incomplete plan may never produce.
    expect(facts).not.toContain("reasonably available revenue");
    expect(facts).not.toContain("$500,000,000");
    expect(facts).not.toContain("unprogrammed");

    const findings = buildAssistantResponse(context, "rtp-brief").findings.join("\n");
    expect(findings).toContain("Fiscal constraint: not determined.");
    expect(findings).not.toContain("reasonably available revenue");
  });

  /**
   * A DETERMINED VERDICT IS QUOTED, NOT PARAPHRASED. The equality is against
   * `describeRtpFiscalConstraint` itself, so the constant-dollar caveat that
   * 23 CFR 450.324(f)(11)(iv) is about cannot be dropped or reworded here
   * without the shared sentence changing for the page and the export too.
   */
  it("quotes the regulated sentence verbatim once the plan can be determined", async () => {
    const context = await loadAssistantContext(
      financialWorkspace({ project_rtp_cycle_links: constrainedLink("100000000") }).client,
      "user-1",
      RTP_TARGET
    );
    if (!context || context.kind !== "rtp_cycle") throw new Error("Expected an RTP cycle context");
    if (!context.fiscal?.summary) throw new Error("Expected a fiscal summary");

    expect(context.fiscal.summary.verdict).toBe("constrained");
    expect(context.fiscal.summary.dollarBasis).toBe("constant");

    const sentence = describeRtpFiscalConstraint(context.fiscal.summary);
    expect(sentence).toContain("constant 2026 dollars");
    expect(buildAssistantPreview(context).facts).toContain(sentence);
    expect(buildAssistantResponse(context, "rtp-brief").findings).toContain(sentence);
  });

  /**
   * A READ FAILURE OUTRANKS THE VERDICT. With the bands unreadable the engine
   * would find no period, no cost and no revenue assigned anywhere and would
   * answer `not_determined` for the WRONG reason — a finding about the plan
   * instead of a failure of the query. There is no verdict at all here.
   */
  it("refuses a verdict when the horizon periods could not be read", async () => {
    const context = await loadAssistantContext(
      financialWorkspace({
        rtp_horizon_bands: { data: null, error: { message: "permission denied for table rtp_horizon_bands" } },
      }).client,
      "user-1",
      RTP_TARGET
    );
    if (!context || context.kind !== "rtp_cycle") throw new Error("Expected an RTP cycle context");

    expect(context.fiscal?.summary).toBeNull();
    expect(context.unreadable?.map((failure) => failure.label)).toContain("the horizon periods of this plan");

    const facts = buildAssistantPreview(context).facts.join("\n");
    expect(facts).toContain("Unknown: whether this plan is fiscally constrained.");
    expect(facts).toContain("That is a read failure, not a finding that this plan is unconstrained.");
    expect(facts).not.toContain("Fiscal constraint: not determined.");
  });

  it("refuses a verdict when the ledger could not be read", async () => {
    const context = await loadAssistantContext(
      financialWorkspace({
        rtp_financial_assumptions: { data: null, error: { message: "statement timeout" } },
      }).client,
      "user-1",
      RTP_TARGET
    );
    if (!context || context.kind !== "rtp_cycle") throw new Error("Expected an RTP cycle context");

    expect(context.fiscal?.summary).toBeNull();
    expect(context.unreadable?.map((failure) => failure.label)).toContain(
      "the revenue and cost assumptions of this plan"
    );
    expect(buildAssistantPreview(context).facts.join("\n")).toContain(
      "That is a read failure, not a finding that this plan is unconstrained."
    );
  });

  it("refuses a verdict when the linked projects could not be read", async () => {
    const context = await loadAssistantContext(
      financialWorkspace({
        project_rtp_cycle_links: { data: null, error: { message: "connection terminated unexpectedly" } },
      }).client,
      "user-1",
      RTP_TARGET
    );
    if (!context || context.kind !== "rtp_cycle") throw new Error("Expected an RTP cycle context");

    expect(context.fiscal?.summary).toBeNull();
    expect(buildAssistantPreview(context).facts.join("\n")).toContain(
      "That is a read failure, not a finding that this plan is unconstrained."
    );
  });

  /**
   * A DEPLOYMENT WITHOUT MIGRATION 20260805000003 TRULY HOLDS NO BANDS, so the
   * table's absence is not disclosed as a failure — and the engine's own
   * `no_horizon_bands` blocker is the honest answer for it. Without this the fix
   * would trade one wrong answer for another.
   */
  it("stays silent about a pending financial-element migration and still declines to determine", async () => {
    const context = await loadAssistantContext(
      financialWorkspace({
        rtp_horizon_bands: {
          data: null,
          error: { message: 'relation "public.rtp_horizon_bands" does not exist' },
        },
      }).client,
      "user-1",
      RTP_TARGET
    );
    if (!context || context.kind !== "rtp_cycle") throw new Error("Expected an RTP cycle context");

    expect(context.unreadable?.map((failure) => failure.label) ?? []).not.toContain(
      "the horizon periods of this plan"
    );
    expect(context.fiscal?.summary?.verdict).toBe("not_determined");
    expect(context.fiscal?.summary?.blockers.map((blocker) => blocker.code)).toContain("no_horizon_bands");
  });

  /**
   * READING A TABLE AND RENDERING NOTHING IS THE SHIPPED-INVISIBLE DEFECT CLASS
   * this repo counts. The measures are read, so at least one fact says so.
   */
  it("surfaces a fact from the performance measures it read", async () => {
    const context = await loadAssistantContext(financialWorkspace().client, "user-1", RTP_TARGET);
    if (!context || context.kind !== "rtp_cycle") throw new Error("Expected an RTP cycle context");

    expect(context.fiscal?.performanceMeasureCount).toBe(2);
    expect(buildAssistantPreview(context).facts.join("\n")).toContain(
      "2 performance measures are recorded for this plan."
    );
  });

  it("declines to count performance measures it could not read", async () => {
    const context = await loadAssistantContext(
      financialWorkspace({
        rtp_performance_measures: { data: null, error: { message: "permission denied for table rtp_performance_measures" } },
      }).client,
      "user-1",
      RTP_TARGET
    );
    if (!context || context.kind !== "rtp_cycle") throw new Error("Expected an RTP cycle context");

    const facts = buildAssistantPreview(context).facts.join("\n");
    expect(facts).toContain("Unknown: the performance measures of this plan.");
    expect(facts).not.toContain("0 performance measures are recorded");
    // The measures do not feed the verdict, so it survives their failure.
    expect(context.fiscal?.summary?.verdict).toBe("not_determined");
  });
});

describe("the project copilot over a failed funding read", () => {
  it("refuses to say no funding opportunities are linked", async () => {
    const supabase = createSupabase({
      workspace_members: MEMBERSHIP,
      projects: PROJECT_ROW,
      funding_opportunities: { data: null, error: { message: "connection terminated unexpectedly" } },
    }).client;

    const context = await loadAssistantContext(supabase, "user-1", PROJECT_TARGET);
    if (!context || context.kind !== "project") throw new Error("Expected a project context");

    expect(context.unreadable?.map((failure) => failure.label)).toContain("funding opportunities");

    const preview = buildAssistantPreview(context);
    const facts = preview.facts.join("\n");

    expect(facts).toContain("Unknown: the funding picture for this project.");
    expect(facts).not.toContain("No funding opportunities are linked to this project yet");
    expect(preview.stats).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: "Funding", value: "Unknown" })])
    );
  });

  it("refuses to count deliverables, decisions, and meetings it could not read", async () => {
    const supabase = createSupabase({
      workspace_members: MEMBERSHIP,
      projects: PROJECT_ROW,
      project_deliverables: { data: null, error: { message: "statement timeout" } },
    }).client;

    const context = await loadAssistantContext(supabase, "user-1", PROJECT_TARGET);
    if (!context || context.kind !== "project") throw new Error("Expected a project context");

    const facts = buildAssistantPreview(context).facts.join("\n");

    expect(facts).toContain("Unknown: the project control counts.");
    expect(facts).toContain("statement timeout");
    expect(facts).not.toContain("0 deliverables, 0 decisions, and 0 meetings");
  });

  it("marks the risk tile unknown rather than reporting zero open risks", async () => {
    const supabase = createSupabase({
      workspace_members: MEMBERSHIP,
      projects: PROJECT_ROW,
      project_risks: { data: null, error: { message: "permission denied for table project_risks" } },
    }).client;

    const context = await loadAssistantContext(supabase, "user-1", PROJECT_TARGET);
    if (!context || context.kind !== "project") throw new Error("Expected a project context");

    expect(buildAssistantPreview(context).stats).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: "Open risks", value: "Unknown" })])
    );
  });
});

/**
 * THE ANCHOR ROW IS THE ONE FAILURE THAT CANNOT BE DISCLOSED IN PROSE, because
 * there is no context left to attach the prose to. `loadAssistantContext` has
 * exactly one way to say no — `null` — and all four of its callers speak that
 * `null` as a claim: three routes answer 404 "Assistant context not found" and
 * the chat tool tells the model "No such surface is visible to this planner. It
 * may not exist or may belong to a workspace they are not a member of." A
 * dropped connection is not evidence of either.
 */
describe("a failed anchor read refuses instead of reporting the record missing", () => {
  it("throws rather than returning null when the project row could not be read", async () => {
    const supabase = createSupabase({
      workspace_members: MEMBERSHIP,
      projects: { data: null, error: { message: "connection terminated unexpectedly" } },
    }).client;

    await expect(loadAssistantContext(supabase, "user-1", PROJECT_TARGET)).rejects.toBeInstanceOf(
      AssistantContextUnreadableError
    );
  });

  it("throws rather than reporting the planner is not a member of the workspace", async () => {
    const supabase = createSupabase({
      workspace_members: { data: null, error: { message: "permission denied for table workspace_members" } },
      rtp_cycles: RTP_CYCLE_ROW,
    }).client;

    await expect(loadAssistantContext(supabase, "user-1", RTP_TARGET)).rejects.toThrow(/workspace membership/);
  });

  it("still returns null for a row that genuinely does not exist", async () => {
    const supabase = createSupabase({
      workspace_members: MEMBERSHIP,
      projects: { data: null, error: null },
    }).client;

    await expect(loadAssistantContext(supabase, "user-1", PROJECT_TARGET)).resolves.toBeNull();
  });
});

describe("the run copilot over a failed baseline read", () => {
  it("does not report the baseline as unattached when its read failed", async () => {
    const supabase = createSupabase({
      workspace_members: MEMBERSHIP,
      runs: {
        data: {
          id: "run-1",
          workspace_id: "workspace-1",
          title: "Corridor screening",
          summary_text: "Screening run",
          created_at: "2026-03-28T17:00:00.000Z",
          query_text: null,
          metrics: {},
        },
        error: null,
      },
    }).client;

    // The baseline is the SECOND read of `runs`; make that one fail while the
    // anchor read succeeds, which is the shape a transient failure takes.
    let runReads = 0;
    const client = {
      from(table: string) {
        if (table !== "runs") return supabase.from(table);
        runReads += 1;
        if (runReads === 1) return supabase.from(table);
        const failed = { data: null, error: { message: "connection terminated unexpectedly" } };
        const node: Record<string, unknown> = {
          select: () => node,
          eq: () => node,
          in: () => node,
          order: () => node,
          limit: () => node,
          maybeSingle: async () => failed,
          then: (resolve: (value: typeof failed) => unknown) => Promise.resolve(failed).then(resolve),
        };
        return node;
      },
    };

    const context = await loadAssistantContext(client, "user-1", {
      kind: "run",
      id: "run-1",
      workspaceId: "workspace-1",
      runId: "run-1",
      baselineRunId: "run-2",
    });
    if (!context || context.kind !== "run") throw new Error("Expected a run context");

    expect(context.unreadable?.map((failure) => failure.label)).toContain("the baseline run");

    const preview = buildAssistantPreview(context);
    expect(preview.facts[0]).toContain("could not read the baseline run");
  });
});

/**
 * THE GATE BOARD RENDERS UNDER THE WORKSPACE'S BOUND TEMPLATE.
 *
 * `loadProjectContext` used to call the board loader with no template id and
 * ride the registry-default fallback. With one registered template that was
 * coincidentally right; with two, the copilot would speak another template's
 * gate vocabulary over this workspace's recorded decisions. The context now
 * reads the workspace binding row first and threads the resolved template —
 * and when the binding cannot be established, the board is EXPLICITLY
 * unreadable rather than rendered on the default.
 */
describe("the project copilot's gate board renders under the workspace's BOUND template", () => {
  const CA_BOUND_WORKSPACE_ROW: TableResult = {
    data: {
      id: "workspace-1",
      stage_gate_template_id: "ca_stage_gates_v0_1",
      home_geography_source: "tigerweb",
      home_country_code: "US",
      home_subdivision_code: "CA",
    },
    error: null,
  };

  it("threads the stored binding, not the registry default", async () => {
    const supabase = createSupabase({
      workspace_members: MEMBERSHIP,
      projects: PROJECT_ROW,
      workspaces: CA_BOUND_WORKSPACE_ROW,
    }).client;

    const context = await loadAssistantContext(supabase, "user-1", PROJECT_TARGET);
    if (!context || context.kind !== "project") throw new Error("Expected a project context");

    expect(context.stageGateSummary.templateId).toBe("ca_stage_gates_v0_1");
    expect(context.stageGateSummary.decisionsRead).toEqual({ readable: true });
    // CA's nine gates, under the CA template's own ids — the fixture stores the
    // CA binding precisely so this differs from a registry default that is not CA.
    expect(context.stageGateSummary.totalGateCount).toBe(9);
    expect(context.stageGateSummary.gates.map((gate) => gate.gateId)).toContain(
      "G01_INITIATION_AUTHORIZATION"
    );
  });

  it("gives a DIFFERENTLY-bound workspace ITS board, so no caller can hardcode one", async () => {
    // The test above proves the copilot does not use the registry DEFAULT, but
    // a caller that ignored the binding and passed the literal
    // "ca_stage_gates_v0_1" would pass it too — verified by mutation, which
    // left all 14 tests in this file green. Same fixture shape, federal-aid
    // binding: the board must carry THAT template's id and its eight gates.
    const supabase = createSupabase({
      workspace_members: MEMBERSHIP,
      projects: PROJECT_ROW,
      workspaces: {
        data: {
          id: "workspace-1",
          stage_gate_template_id: "us_federal_aid_stage_gates_v0_1",
          home_geography_source: "tigerweb",
          home_country_code: "US",
          home_subdivision_code: "TX",
        },
        error: null,
      },
    }).client;

    const context = await loadAssistantContext(supabase, "user-1", PROJECT_TARGET);
    if (!context || context.kind !== "project") throw new Error("Expected a project context");

    expect(context.stageGateSummary.templateId).toBe("us_federal_aid_stage_gates_v0_1");
    expect(context.stageGateSummary.totalGateCount).toBe(8);
    expect(context.stageGateSummary.gates.map((gate) => gate.gateId)).toContain(
      "programming-eligibility"
    );
  });

  it("reports the board unreadable when the workspace binding row cannot be read", async () => {
    const supabase = createSupabase({
      workspace_members: MEMBERSHIP,
      projects: PROJECT_ROW,
      workspaces: { data: null, error: { message: "permission denied for table workspaces" } },
    }).client;

    const context = await loadAssistantContext(supabase, "user-1", PROJECT_TARGET);
    if (!context || context.kind !== "project") throw new Error("Expected a project context");

    // Every gate state is unknown: the copilot may not say "no stage gate is
    // currently on hold" from a binding nothing established.
    expect(context.stageGateSummary.decisionsRead.readable).toBe(false);
    if (context.stageGateSummary.decisionsRead.readable) throw new Error("unreachable");
    expect(context.stageGateSummary.decisionsRead.reason).toContain(
      "the workspace row that names the bound stage-gate template could not be read"
    );
    expect(context.stageGateSummary.unknownCount).toBe(context.stageGateSummary.totalGateCount);
    expect(context.stageGateSummary.blockedGate).toBeNull();
    expect(context.unreadable?.map((failure) => failure.label)).toContain(
      "the workspace row that names the bound stage-gate template"
    );
  });

  it("reports the board unreadable when the stored template is not registered, rather than substituting one", async () => {
    const supabase = createSupabase({
      workspace_members: MEMBERSHIP,
      projects: PROJECT_ROW,
      workspaces: {
        data: {
          id: "workspace-1",
          stage_gate_template_id: "not_a_registered_template_v9",
          home_geography_source: "tigerweb",
          home_country_code: "US",
          home_subdivision_code: "CA",
        },
        error: null,
      },
    }).client;

    const context = await loadAssistantContext(supabase, "user-1", PROJECT_TARGET);
    if (!context || context.kind !== "project") throw new Error("Expected a project context");

    expect(context.stageGateSummary.decisionsRead.readable).toBe(false);
    if (context.stageGateSummary.decisionsRead.readable) throw new Error("unreachable");
    expect(context.stageGateSummary.decisionsRead.reason).toContain("not_a_registered_template_v9");
    expect(context.stageGateSummary.passCount).toBe(0);
    expect(context.stageGateSummary.blockedGate).toBeNull();
  });
});
