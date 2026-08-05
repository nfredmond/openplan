import { readFileSync } from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A REPORT-LANE RUN CITATION MUST TRAVEL WITH ITS CLAIM TIER, AND A CITATION
 * MAY NEVER SILENTLY DISAPPEAR.
 *
 * Two defects, one file, because they are the same seam.
 *
 * 1. THE TIER. `loadRtpEvidenceRunDisclosures` has resolved engine + status +
 *    claim tier for cited runs since the RTP lane settled "disclose, never
 *    restrict", and the PUBLIC plan page renders that line beside every
 *    citation. The report lane cited the same `model_runs` rows carrying engine
 *    and status only — so one run described itself with a claim tier on the
 *    public page and without one in the packet an agency hands a funder. The
 *    fix wires the SHARED loader in rather than growing a second, weaker
 *    disclosure in the report lane.
 *
 * 2. THE SILENT LOSS. `resolveCitedRuns` answered `[]` on a query error and
 *    `buildTypedRunCitations` dropped every link whose row was missing, so a
 *    broken `model_runs` read deleted citations from a report's own list of what
 *    it cited — with nothing on screen to say so. "No cited runs" is a claim
 *    about the world; a failed read cannot make it.
 *
 * NOTHING HERE STUBS THE THING IT IS NAMED FOR. The page test drives the REAL
 * `/reports/[reportId]` page through the REAL `resolveCitedRuns` against a fake
 * Supabase client that answers by TABLE NAME, so a named table can be made to
 * fail the way a real outage does. The packet tests run the REAL
 * `withCitedModelRunClaimTiers` against that same client and feed its OUTPUT
 * into the REAL `buildReportHtml` — the tier the packet renders is one the
 * loader actually produced, not one a fixture described.
 *
 * MUTATIONS RUN (2026-08-04), each reverted after:
 *   - restoring `if (!modelRun) return null;` in `buildTypedRunCitations`
 *     -> "surfaces a cited model run whose lookup failed" fails: the citation is
 *        absent from the rendered page.
 *   - deleting the `loadRtpEvidenceRunDisclosures` call from `resolveCitedRuns`
 *     -> "asks modeling_claim_decisions for the tier it discloses" and the tier
 *        assertions fail: the claim read never happens.
 *   - removing the `claimTierLine` row from `citedModelRunMarkup`
 *     -> the two packet tests fail: the tier is missing from the generated HTML.
 *   - making `citedModelRunClaimTierLine` return the label on a failed read
 *     -> "a failed claim-tier read is not rendered as 'not recorded'" fails.
 */

// ---------------------------------------------------------------------------
// A fake Supabase client that routes on TABLE NAME and records every select
// string. A mocked client hands back the fixture whatever columns were asked
// for, so asserting the PROJECTION is the only way to catch a dropped column;
// and a named table can be made to answer with an error, which is the only way
// to exercise the failure path a planner actually hits.
// ---------------------------------------------------------------------------

const selectCalls: Record<string, string[]> = {};
let tableData: Record<string, unknown>;
let tableErrors: Record<string, { message: string; code?: string }>;

type FakeResult = { data: unknown; error: { message: string; code?: string } | null };

function fakeQuery(tableName: string) {
  const resolveResult = (): FakeResult => {
    const error = tableErrors[tableName];
    // A failed read carries no rows. Returning the fixture AND an error would
    // let a surface look correct while ignoring the error entirely.
    if (error) return { data: null, error };
    const seeded = tableData[tableName];
    return { data: seeded === undefined ? [] : seeded, error: null };
  };
  const q: Record<string, unknown> = {};
  for (const method of ["eq", "in", "order", "limit", "not", "is", "gte", "lte", "or", "neq"]) {
    q[method] = () => q;
  }
  q.maybeSingle = async () => resolveResult();
  q.single = async () => resolveResult();
  q.then = (resolve: (value: FakeResult) => unknown) => Promise.resolve(resolveResult()).then(resolve);
  return q;
}

function makeFakeClient() {
  return {
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
    from: (tableName: string) => ({
      select: (columns: string) => {
        (selectCalls[tableName] ??= []).push(columns);
        return fakeQuery(tableName);
      },
    }),
  };
}

const createClientMock = vi.fn(async () => makeFakeClient());
const notFoundMock = vi.fn(() => {
  throw new Error("notFound");
});
const redirectMock = vi.fn((..._args: unknown[]) => {
  throw new Error("redirect");
});
const loadWorkspaceOperationsSummaryForWorkspaceMock = vi.fn();

vi.mock("next/navigation", () => ({
  notFound: () => notFoundMock(),
  redirect: (...args: unknown[]) => redirectMock(...args),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClientMock(),
}));

vi.mock("@/lib/operations/workspace-summary", async () => {
  const actual = await vi.importActual<typeof import("@/lib/operations/workspace-summary")>(
    "@/lib/operations/workspace-summary"
  );
  return {
    ...actual,
    loadWorkspaceOperationsSummaryForWorkspace: (...args: unknown[]) =>
      loadWorkspaceOperationsSummaryForWorkspaceMock(...args),
  };
});

vi.mock("@/components/reports/report-detail-controls", () => ({
  ReportDetailControls: () => <div data-testid="report-detail-controls" />,
}));

import ReportDetailPage from "@/app/(app)/reports/[reportId]/page";
import {
  buildProjectStageGateSnapshot,
  buildProjectStageGateSummary,
} from "@/lib/stage-gates/summary";
import { buildReportHtml, type ReportGenerationData } from "@/lib/reports/html";
import {
  buildTypedRunCitations,
  resolveCitedRuns,
  withCitedModelRunClaimTiers,
  type ReportRunCitationLink,
} from "@/lib/reports/run-citations";

const REPORT_ROW = {
  id: "report-1",
  workspace_id: "workspace-1",
  project_id: "project-1",
  rtp_cycle_id: null,
  engagement_campaign_id: null,
  title: "Corridor Screening Packet",
  report_type: "project_status",
  status: "generated",
  summary: "Screening packet.",
  generated_at: "2026-05-01T12:00:00.000Z",
  latest_artifact_url: null,
  latest_artifact_kind: "html",
  created_at: "2026-04-01T12:00:00.000Z",
  updated_at: "2026-05-01T12:00:00.000Z",
};

const PROJECT_ROW = {
  id: "project-1",
  workspace_id: "workspace-1",
  name: "Downtown Corridor",
  summary: "Corridor study.",
  status: "active",
  plan_type: "corridor",
  delivery_phase: "planning",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-04-01T00:00:00.000Z",
};

/** One report_runs link citing one worker model run. */
const CITATION_LINK: ReportRunCitationLink = {
  id: "report-run-1",
  report_id: "report-1",
  run_id: null,
  model_run_id: "model-run-1",
  county_run_id: null,
  sort_order: 0,
};

const MODEL_RUN_ROW = {
  id: "model-run-1",
  run_title: "2050 Baseline Assignment",
  engine_key: "sketch_abm",
  status: "succeeded",
  created_at: "2026-04-15T00:00:00.000Z",
  result_summary_json: { vmt_per_capita: 21.4 },
};

function seedPage(overrides: Record<string, unknown> = {}) {
  tableData = {
    reports: REPORT_ROW,
    projects: PROJECT_ROW,
    workspaces: { id: "workspace-1", name: "Region Agency" },
    report_sections: [],
    report_runs: [CITATION_LINK],
    report_artifacts: [],
    runs: [],
    model_runs: [MODEL_RUN_ROW],
    county_runs: [],
    modeling_claim_decisions: [{ model_run_id: "model-run-1", claim_status: "screening_grade" }],
    ...overrides,
  };
  tableErrors = {};
}

async function renderReportPage() {
  render(await ReportDetailPage({ params: Promise.resolve({ reportId: "report-1" }) }));
}

/** The fake client, used directly by the loader-level tests. */
function client() {
  return makeFakeClient() as unknown as Parameters<typeof resolveCitedRuns>[0];
}

describe("report-lane run citations carry their claim tier", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(selectCalls)) delete selectCalls[key];
    seedPage();
    loadWorkspaceOperationsSummaryForWorkspaceMock.mockResolvedValue({
      posture: "under control",
      headline: "Workspace clear",
      detail: "No workspace command pressure in this fixture.",
      nextCommand: null,
      nextActions: [],
      commandQueue: [],
      fullCommandQueue: [],
      counts: {},
    });
  });

  describe("the real /reports/[reportId] page", () => {
    it("asks modeling_claim_decisions for the tier it discloses", async () => {
      await renderReportPage();

      // The projection, not the fixture: an untyped client answers whatever was
      // asked for, so only the select string proves the column was requested.
      const claimSelects = selectCalls.modeling_claim_decisions ?? [];
      expect(claimSelects.length).toBeGreaterThan(0);
      expect(claimSelects.join(" | ")).toContain("claim_status");
      expect(claimSelects.join(" | ")).toContain("model_run_id");
    });

    it("surfaces a cited model run whose lookup failed instead of dropping it", async () => {
      // The whole model_runs read fails, the way an outage or an RLS change
      // presents. The link in report_runs still says this report cited a run.
      tableErrors = { model_runs: { message: "connection reset by peer" } };

      await renderReportPage();

      expect(screen.getByText(/Cited run — could not be resolved/i)).toBeInTheDocument();
      // And the operator's database message is not leaked onto the surface.
      expect(screen.queryByText(/connection reset by peer/i)).not.toBeInTheDocument();
    });

    it("renders the resolved citation by its own title when the read succeeds", async () => {
      await renderReportPage();

      expect(screen.getByText("2050 Baseline Assignment")).toBeInTheDocument();
      expect(screen.queryByText(/could not be resolved/i)).not.toBeInTheDocument();
    });

    /**
     * THE REACHABILITY ASSERTION. Resolving the tier and rendering it are two
     * different achievements, and this lane shipped the first without the
     * second: `resolveCitedRuns` carried `claimStatus` and `disclosureLine`
     * onto every citation while `ReportCompositionAudit` rendered
     * `${engineLabel} · ${status}` and read neither — so the tier was correct,
     * tested, and reached no planner. That is the shipped-invisible class, and
     * only an assertion against the RENDERED page can catch it.
     */
    it("puts the resolved claim tier on the planner's screen, not just on the object", async () => {
      await renderReportPage();

      // The whole shared disclosure line, engine + status + tier, as one
      // sentence — not three facts a panel reassembled its own way.
      expect(screen.getByText(/Sketch Activity Model · Succeeded · Screening-grade/i)).toBeInTheDocument();
      // And the engine caveat that travels with it.
      expect(screen.getByText(/roughly 56% below the CARB reference/i)).toBeInTheDocument();
    });

    it("says on screen that a tier could not be READ, rather than that none exists", async () => {
      tableErrors = { modeling_claim_decisions: { message: "permission denied for table modeling_claim_decisions" } };

      await renderReportPage();

      expect(screen.getByText(/claim tier could not be read/i)).toBeInTheDocument();
      expect(screen.queryByText(/no claim tier recorded/i)).not.toBeInTheDocument();
      // Operator detail stays off the surface even on an internal page here:
      // this sentence is for a planner deciding what the packet may claim.
      expect(screen.queryByText(/permission denied/i)).not.toBeInTheDocument();
    });
  });

  describe("resolveCitedRuns + buildTypedRunCitations, driven for real", () => {
    it("puts the recorded claim tier on the citation's disclosure line", async () => {
      const resolution = await resolveCitedRuns(client(), [CITATION_LINK]);
      const citations = buildTypedRunCitations(
        [CITATION_LINK],
        resolution.citedModelRuns,
        resolution.citedCountyRuns,
        resolution
      );

      expect(citations).toHaveLength(1);
      expect(citations[0].claimStatus).toBe("screening_grade");
      expect(citations[0].disclosureLine).toContain("Screening-grade");
      // The same one-line shape the public plan page renders: engine, status, tier.
      expect(citations[0].disclosureLine).toContain("Succeeded");
      expect(citations[0].unresolved).toBeNull();
      // Disclose, never restrict: the engine's standing caveat rides along.
      expect(citations[0].warnings.length).toBeGreaterThan(0);
    });

    it("says a claim tier could not be READ, not that none is recorded", async () => {
      tableErrors = { modeling_claim_decisions: { message: "permission denied" } };

      const resolution = await resolveCitedRuns(client(), [CITATION_LINK]);
      const citations = buildTypedRunCitations(
        [CITATION_LINK],
        resolution.citedModelRuns,
        resolution.citedCountyRuns,
        resolution
      );

      expect(resolution.claimReadFailed).toBe(true);
      expect(citations[0].claimReadFailed).toBe(true);
      expect(citations[0].disclosureLine).toContain("could not be read");
      expect(citations[0].disclosureLine).not.toContain("not recorded");
    });

    it("reports no recorded tier as an absence, distinct from a failure", async () => {
      seedPage({ modeling_claim_decisions: [] });

      const resolution = await resolveCitedRuns(client(), [CITATION_LINK]);
      const citations = buildTypedRunCitations(
        [CITATION_LINK],
        resolution.citedModelRuns,
        resolution.citedCountyRuns,
        resolution
      );

      expect(resolution.claimReadFailed).toBe(false);
      expect(citations[0].claimStatus).toBeNull();
      expect(citations[0].disclosureLine).toContain("Claim tier not recorded");
      expect(citations[0].disclosureLine).not.toContain("could not be read");
    });

    it("names WHY a citation is unresolved when it is given the resolution", async () => {
      tableErrors = { model_runs: { message: "connection reset by peer" } };

      const resolution = await resolveCitedRuns(client(), [CITATION_LINK]);
      const citations = buildTypedRunCitations(
        [CITATION_LINK],
        resolution.citedModelRuns,
        resolution.citedCountyRuns,
        resolution
      );

      expect(resolution.modelRunsUnreadable).toBe(true);
      expect(resolution.modelRunsUnavailable).toBe(false);
      expect(citations).toHaveLength(1);
      expect(citations[0].unresolved).toBe("read-failed");
      expect(citations[0].disclosureLine).toContain("lookup failure");
    });

    it("keeps a deployment without the modeling tables distinct from a failure", async () => {
      // The pending-schema wording PostgREST answers with when the table is not
      // in the schema cache. That is "this deployment has no such module", which
      // is a different sentence from "the read broke".
      tableErrors = { model_runs: { message: 'relation "public.model_runs" does not exist' } };

      const resolution = await resolveCitedRuns(client(), [CITATION_LINK]);
      const citations = buildTypedRunCitations(
        [CITATION_LINK],
        resolution.citedModelRuns,
        resolution.citedCountyRuns,
        resolution
      );

      expect(resolution.modelRunsUnavailable).toBe(true);
      expect(resolution.modelRunsUnreadable).toBe(false);
      expect(citations[0].unresolved).toBe("module-unavailable");
    });
  });

  describe("the generated packet", () => {
    /** Minimal but REAL ReportGenerationData; only cited runs matter here. */
    function packetData(citedModelRuns: ReportGenerationData["citedModelRuns"]): ReportGenerationData {
      return {
        report: {
          id: "report-1",
          title: "Corridor Screening Packet",
          summary: null,
          report_type: "project_status",
          created_at: "2026-04-01T12:00:00.000Z",
        },
        workspace: { id: "workspace-1", name: "Region Agency" },
        project: PROJECT_ROW,
        runs: [],
        sections: [
          {
            id: "section-1",
            section_key: "run_summaries",
            title: "Run summaries",
            enabled: true,
            sort_order: 0,
            config_json: null,
          },
        ],
        deliverables: [],
        risks: [],
        issues: [],
        decisions: [],
        meetings: [],
        engagement: null,
        scenarioSetLinks: [],
        projectFundingSnapshot: null,
        projectRecordsSnapshot: {
          deliverables: { count: 0, latestTitle: null, latestAt: null },
          risks: { count: 0, latestTitle: null, latestAt: null },
          issues: { count: 0, latestTitle: null, latestAt: null },
          decisions: { count: 0, latestTitle: null, latestAt: null },
          meetings: { count: 0, latestTitle: null, latestAt: null },
        },
        // Built by the REAL stage-gate builders, not described: a hand-written
        // snapshot proves the assertion, only a built one proves the packet.
        stageGateSnapshot: buildProjectStageGateSnapshot(buildProjectStageGateSummary([], { templateId: "ca_stage_gates_v0_1" })),
        modelingEvidence: [],
        citedModelRuns,
      };
    }

    it("renders the tier the REAL loader resolved, not one a fixture described", async () => {
      const cited = await withCitedModelRunClaimTiers(client(), [
        {
          id: MODEL_RUN_ROW.id,
          run_title: MODEL_RUN_ROW.run_title,
          engine_key: MODEL_RUN_ROW.engine_key,
          status: MODEL_RUN_ROW.status,
          result_summary_json: MODEL_RUN_ROW.result_summary_json,
        },
      ]);

      expect(cited[0].claimStatus).toBe("screening_grade");

      const html = buildReportHtml(packetData(cited));
      expect(html).toContain("Claim tier: Screening-grade");
    });

    it("a failed claim-tier read is not rendered as 'not recorded'", async () => {
      tableErrors = { modeling_claim_decisions: { message: "permission denied" } };

      const cited = await withCitedModelRunClaimTiers(client(), [
        {
          id: MODEL_RUN_ROW.id,
          run_title: MODEL_RUN_ROW.run_title,
          engine_key: MODEL_RUN_ROW.engine_key,
          status: MODEL_RUN_ROW.status,
          result_summary_json: MODEL_RUN_ROW.result_summary_json,
        },
      ]);

      expect(cited[0].claimReadFailed).toBe(true);

      const html = buildReportHtml(packetData(cited));
      expect(html).toContain("Claim tier could not be read");
      expect(html).not.toContain("Claim tier not recorded");
      // Operator detail never reaches the packet body.
      expect(html).not.toContain("permission denied");
    });

    it("stays silent about the tier when the packet builder never resolved one", () => {
      // A caller that predates the lookup must not have its packet start
      // asserting "not recorded" about a question it never asked.
      const html = buildReportHtml(
        packetData([
          {
            id: MODEL_RUN_ROW.id,
            run_title: MODEL_RUN_ROW.run_title,
            engine_key: MODEL_RUN_ROW.engine_key,
            status: MODEL_RUN_ROW.status,
            result_summary_json: MODEL_RUN_ROW.result_summary_json,
          },
        ])
      );

      expect(html).toContain(MODEL_RUN_ROW.run_title);
      expect(html).not.toContain("Claim tier");
    });
  });

  /**
   * THE ROUTE THAT ACTUALLY BUILDS THE PACKET MUST ASK FOR THE TIER.
   *
   * Everything above proves `buildReportHtml` renders a tier it is GIVEN, and
   * that `withCitedModelRunClaimTiers` resolves one. Neither proves the packet
   * a planner downloads carries it — and for one session it did not: the
   * generate route assembled `citedModelRuns` from its own `model_runs`
   * projection at two separate sites and wrapped neither, so
   * `citedModelRunClaimTierLine` was dead code in production while every test
   * above was green. That is the shipped-invisible class, and only a check at
   * the CALL SITE catches it.
   *
   * This is deliberately a source assertion rather than a driven route test:
   * the generate route needs ~40 tables' worth of fixtures to reach the HTML
   * builder, and the fact worth guarding is one mechanical thing — that no
   * `citedModelRuns` is built without the shared lookup. A driven test is
   * better and would supersede this; a missing test is worse than both.
   */
  describe("the generate route's own call sites", () => {
    it("wraps every citedModelRuns it builds in the shared claim-tier lookup", () => {
      const source = readFileSync(
        path.join(process.cwd(), "src", "app", "api", "reports", "[reportId]", "generate", "route.ts"),
        "utf8"
      );

      const assignments = source.match(/const\s+citedModelRuns\s*=\s*(await\s+)?[A-Za-z_$][\w$]*/g) ?? [];

      // Guard the guard: if this finds nothing the assertion below passes
      // vacuously, and the route was refactored out from under it.
      expect(assignments.length, "no `const citedModelRuns =` found — this scan is stale").toBeGreaterThanOrEqual(2);

      const unwrapped = assignments.filter(
        (assignment) => !assignment.includes("withCitedModelRunClaimTiers")
      );
      expect(
        unwrapped,
        "a packet built from these rows renders no claim tier — wrap them in withCitedModelRunClaimTiers"
      ).toEqual([]);
    });
  });
});
