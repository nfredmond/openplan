import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  campaignCoverageOrFilter,
  desiredCampaignProjectIds,
  diffCampaignProjectLinks,
  loadCampaignIdsCoveringProject,
  loadEngagementCampaignsCoveringProject,
  PROJECT_ENGAGEMENT_LANE_SELECT,
} from "@/lib/engagement/campaign-projects";

/**
 * The coverage-set arithmetic (20260810000003), plus the two pages that read
 * it. The pure helpers are what the PATCH route and its tests share, so what
 * "the full set includes the lead" means is decided exactly once.
 */

describe("desiredCampaignProjectIds", () => {
  it("always unions the lead in, so a request cannot unlink it", () => {
    expect(
      desiredCampaignProjectIds({ leadProjectId: "lead", requestedProjectIds: ["b", "c"] })
    ).toEqual(["b", "c", "lead"]);
    expect(desiredCampaignProjectIds({ leadProjectId: "lead", requestedProjectIds: [] })).toEqual([
      "lead",
    ]);
  });

  it("with no lead, the requested set stands alone, deduplicated", () => {
    expect(
      desiredCampaignProjectIds({ leadProjectId: null, requestedProjectIds: ["b", "b", "a"] })
    ).toEqual(["a", "b"]);
    expect(desiredCampaignProjectIds({ leadProjectId: null, requestedProjectIds: [] })).toEqual([]);
  });
});

describe("diffCampaignProjectLinks", () => {
  it("adds only what is missing and removes only what is extra", () => {
    expect(diffCampaignProjectLinks(["a", "b"], ["b", "c"])).toEqual({
      toAdd: ["c"],
      toRemove: ["a"],
    });
  });

  it("a set already right changes nothing — no delete-all-reinsert churn", () => {
    expect(diffCampaignProjectLinks(["a", "b"], ["a", "b"])).toEqual({ toAdd: [], toRemove: [] });
  });
});

describe("campaignCoverageOrFilter", () => {
  it("carries the project binding, not a fixed value", () => {
    // Two different projects produce two different filters: a hardcoded
    // project id would pass a single-fixture test and fail this one.
    expect(campaignCoverageOrFilter("p-1", [])).toBe("project_id.eq.p-1");
    expect(campaignCoverageOrFilter("p-2", [])).toBe("project_id.eq.p-2");
  });

  it("keeps the lead branch even when join rows exist — pre-backfill campaigns have none", () => {
    expect(campaignCoverageOrFilter("p-1", ["c-1", "c-2"])).toBe(
      "project_id.eq.p-1,id.in.(c-1,c-2)"
    );
  });
});

describe("loadCampaignIdsCoveringProject", () => {
  function fakeSupabase(result: { data: unknown[] | null; error: { message?: string } | null }) {
    const calls: Array<{ table: string; columns: string; column: string; value: string }> = [];
    return {
      calls,
      client: {
        from: (table: string) => ({
          select: (columns: string) => ({
            eq: (column: string, value: string) => {
              calls.push({ table, columns, column, value });
              return Promise.resolve(result);
            },
          }),
        }),
      },
    };
  }

  it("asks the join table for the campaigns covering THIS project", async () => {
    const fake = fakeSupabase({ data: [{ campaign_id: "c-9" }], error: null });

    const read = await loadCampaignIdsCoveringProject(fake.client, "p-77");

    expect(read).toEqual({
      campaignIds: ["c-9"],
      failed: false,
      pendingSchema: false,
      errorMessage: null,
    });
    // TWO calls with TWO ids: one fixture cannot tell "threads the binding"
    // from "hardcodes its value" — a `.eq("project_id", "p-77")` hardcode
    // passed the single-call version of this test on 2026-08-10.
    await loadCampaignIdsCoveringProject(fake.client, "p-going-somewhere-else");
    expect(fake.calls).toEqual([
      { table: "engagement_campaign_projects", columns: "campaign_id", column: "project_id", value: "p-77" },
      {
        table: "engagement_campaign_projects",
        columns: "campaign_id",
        column: "project_id",
        value: "p-going-somewhere-else",
      },
    ]);
  });

  it("treats a missing join table as the deploy window, not a failure", async () => {
    const fake = fakeSupabase({
      data: null,
      error: { message: 'relation "public.engagement_campaign_projects" does not exist' },
    });

    const read = await loadCampaignIdsCoveringProject(fake.client, "p-1");

    expect(read.pendingSchema).toBe(true);
    expect(read.failed).toBe(false);
    expect(read.campaignIds).toEqual([]);
  });

  it("reports a real failure as failed, with the database's own message", async () => {
    const fake = fakeSupabase({
      data: null,
      error: { message: "permission denied for table engagement_campaign_projects" },
    });

    const read = await loadCampaignIdsCoveringProject(fake.client, "p-1");

    expect(read.failed).toBe(true);
    expect(read.pendingSchema).toBe(false);
    expect(read.errorMessage).toContain("permission denied");
  });
});

describe("loadEngagementCampaignsCoveringProject", () => {
  function fakeLaneClient(options: {
    coverage: { data: unknown[] | null; error: { message?: string } | null };
    campaigns?: { data: unknown[] | null; error: { message?: string } | null };
  }) {
    const calls: Array<Record<string, unknown>> = [];
    return {
      calls,
      client: {
        from: (table: string) => ({
          select: (columns: string) => ({
            eq: (column: string, value: string) => {
              calls.push({ kind: "coverage", table, columns, column, value });
              return Promise.resolve(options.coverage);
            },
            or: (filter: string) => ({
              order: (orderColumn: string, orderOptions: { ascending: boolean }) => ({
                limit: (count: number) => {
                  calls.push({ kind: "campaigns", table, columns, filter, orderColumn, ...orderOptions, count });
                  return Promise.resolve(options.campaigns ?? { data: [], error: null });
                },
              }),
            }),
          }),
        }),
      },
    };
  }

  function fakeReads() {
    const disclosed: string[] = [];
    return { disclosed, check: (label: string) => (disclosed.push(label), true) };
  }

  it("queries campaigns by lead OR join membership, threading the project binding", async () => {
    const fake = fakeLaneClient({ coverage: { data: [{ campaign_id: "c-2" }], error: null } });

    await loadEngagementCampaignsCoveringProject(fake.client, "p-lane-1", fakeReads());
    await loadEngagementCampaignsCoveringProject(fake.client, "p-lane-2", fakeReads());

    const campaignCalls = fake.calls.filter((call) => call.kind === "campaigns");
    // Two calls, two different filters: a hardcoded binding cannot pass.
    expect(campaignCalls.map((call) => call.filter)).toEqual([
      "project_id.eq.p-lane-1,id.in.(c-2)",
      "project_id.eq.p-lane-2,id.in.(c-2)",
    ]);
    expect(campaignCalls[0]).toMatchObject({
      table: "engagement_campaigns",
      columns: PROJECT_ENGAGEMENT_LANE_SELECT,
      orderColumn: "updated_at",
      ascending: false,
      count: 6,
    });
  });

  it("discloses a real coverage failure and still reads the lead-linked campaigns", async () => {
    const fake = fakeLaneClient({
      coverage: { data: null, error: { message: "permission denied" } },
      campaigns: { data: [{ id: "c-lead" }], error: null },
    });
    const reads = fakeReads();

    const result = await loadEngagementCampaignsCoveringProject(fake.client, "p-9", reads);

    expect(reads.disclosed).toEqual(["campaigns covering this project"]);
    expect(result.data).toEqual([{ id: "c-lead" }]);
    const campaignCall = fake.calls.find((call) => call.kind === "campaigns");
    expect(campaignCall?.filter).toBe("project_id.eq.p-9");
  });

  it("treats the missing join table as the deploy window — no disclosure, lead-only filter", async () => {
    const fake = fakeLaneClient({
      coverage: { data: null, error: { message: 'relation "engagement_campaign_projects" does not exist' } },
    });
    const reads = fakeReads();

    await loadEngagementCampaignsCoveringProject(fake.client, "p-9", reads);

    expect(reads.disclosed).toEqual([]);
    expect(fake.calls.find((call) => call.kind === "campaigns")?.filter).toBe("project_id.eq.p-9");
  });
});

/**
 * WIRING. The two catalog surfaces must actually consult coverage — a helper
 * nobody calls is the shipped-invisible defect class. Source-level assertions,
 * with the BINDING asserted (which variable is passed), so a page that calls
 * the helper with the wrong id cannot pass.
 */
describe("the coverage helper is wired into both reading surfaces", () => {
  const read = (relative: string) => readFileSync(path.join(process.cwd(), relative), "utf8");

  it("the project page merges join-covered campaigns into its engagement lane", () => {
    const source = read("src/app/(app)/projects/[projectId]/page.tsx");
    // The page hands the loader its OWN project id and its OWN disclosure
    // log; the loader owns the coverage-aware filter and the failure
    // disclosure (asserted directly on the loader below).
    expect(source).toMatch(
      /await loadEngagementCampaignsCoveringProject\(supabase, project\.id, reads\)/
    );
    // And no bare lead-only read of the lane survives beside it.
    expect(source).not.toMatch(/from\("engagement_campaigns"\)/);
  });

  it("the engagement catalog's project filter includes join-covered campaigns", () => {
    const source = read("src/app/(app)/engagement/page.tsx");
    expect(source).toMatch(
      /loadCampaignIdsCoveringProject\(\s*supabase as unknown as CampaignProjectsSupabaseLike,\s*projectFilterId\s*\)/
    );
    expect(source).toMatch(
      /campaign\.project_id === projectFilterId \|\| coveredCampaignIds\.has\(campaign\.id\)/
    );
    expect(source).toMatch(/projectFilterCoverage\?\.failed/);
  });
});
