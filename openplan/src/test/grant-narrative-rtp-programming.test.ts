import { describe, expect, it } from "vitest";
import {
  assembleOpportunityEvidence,
  buildOpportunityFactList,
  type NarrativeEvidenceOpportunity,
} from "@/lib/grants/narrative-evidence";

/**
 * RTP/MTP PROGRAMMING REACHES GRANT NARRATIVES AS FACTS, NEVER AS INVENTION.
 *
 * "Is this project in the fiscally constrained RTP/MTP" is a scored criterion
 * in most federal programs. These tests prove the evidence bundle reads the
 * project's cycle links (joined to the cycle and its horizon band) and turns
 * them into citable facts; that a project with NO links yields an EXPLICIT
 * "no programming recorded" fact rather than silence; and that a failed read
 * is reported in `readFailures` and yields NEITHER a programming fact NOR the
 * absence fact — a failed read may never be stated as absence.
 *
 * The fake client resolves on table name and records `.in()` filter values, so
 * the tests can prove the dependent cycle/band reads are scoped to the ids the
 * link rows actually named — a fixture that could not tell "threads the id"
 * from "reads everything" would prove nothing.
 */

type ReadResult = { data: unknown; error: { message: string } | null };

const OPPORTUNITY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID = "44444444-4444-4444-8444-444444444444";
const CYCLE_A_ID = "77777777-7777-4777-8777-777777777771";
const CYCLE_B_ID = "77777777-7777-4777-8777-777777777772";
const BAND_ID = "88888888-8888-4888-8888-888888888881";

function opportunity(
  overrides: Partial<NarrativeEvidenceOpportunity> = {}
): NarrativeEvidenceOpportunity {
  return {
    id: OPPORTUNITY_ID,
    workspace_id: WORKSPACE_ID,
    program_id: null,
    project_id: PROJECT_ID,
    title: "RAISE FY2027 capital construction call",
    opportunity_status: "open",
    decision_state: "pursue",
    ...overrides,
  };
}

/**
 * Two link rows in two cycles with DIFFERENT roles, statuses, horizons, and
 * band linkage, so a fact that hardcoded any of those values fails on the
 * other row.
 */
const LINK_ROWS = [
  {
    rtp_cycle_id: CYCLE_A_ID,
    portfolio_role: "constrained",
    horizon_band_id: BAND_ID,
    created_at: "2026-06-01T00:00:00.000Z",
  },
  {
    rtp_cycle_id: CYCLE_B_ID,
    portfolio_role: "illustrative",
    horizon_band_id: null,
    created_at: "2026-01-01T00:00:00.000Z",
  },
];

const CYCLE_ROWS = [
  {
    id: CYCLE_A_ID,
    title: "2050 Valley Mobility Plan",
    status: "adopted",
    horizon_start_year: 2026,
    horizon_end_year: 2050,
    adoption_target_date: null,
  },
  {
    id: CYCLE_B_ID,
    title: "2045 Coastal RTP Update",
    status: "public_review",
    horizon_start_year: null,
    horizon_end_year: null,
    adoption_target_date: "2027-03-15",
  },
];

const BAND_ROWS = [{ id: BAND_ID, label: "First ten years" }];

type Resolver = (table: string, columns: string, inFilters: Record<string, unknown[]>) => ReadResult;

function succeedingWith(fixtures: {
  links?: unknown;
  cycles?: unknown;
  bands?: unknown;
}): Resolver {
  return (table, columns) => {
    if (table === "projects" && !columns.includes("updated_at")) {
      return { data: { id: PROJECT_ID, name: "Main St Bridge Replacement" }, error: null };
    }
    if (table === "project_funding_profiles") return { data: null, error: null };
    if (table === "project_rtp_cycle_links") return { data: fixtures.links ?? [], error: null };
    if (table === "rtp_cycles") return { data: fixtures.cycles ?? [], error: null };
    if (table === "rtp_horizon_bands") return { data: fixtures.bands ?? [], error: null };
    return { data: [], error: null };
  };
}

/** Records every `.in()` filter so scoping can be asserted, not assumed. */
function clientResolving(resolve: Resolver) {
  const inFiltersByTable: Record<string, Record<string, unknown[]>> = {};
  return {
    inFiltersByTable,
    from(table: string) {
      let columns = "";
      const inFilters: Record<string, unknown[]> = {};
      const chain: Record<string, unknown> = {
        select: (cols: string) => {
          columns = cols;
          return chain;
        },
        in: (column: string, values: unknown[]) => {
          inFilters[column] = values;
          inFiltersByTable[table] = inFilters;
          return chain;
        },
        maybeSingle: () => Promise.resolve(resolve(table, columns, inFilters)),
        then: (ok: (value: unknown) => unknown, err?: (reason: unknown) => unknown) =>
          Promise.resolve(resolve(table, columns, inFilters)).then(ok, err),
      };
      for (const method of ["eq", "neq", "not", "order", "limit"]) {
        chain[method] = () => chain;
      }
      return chain;
    },
    rpc: () => Promise.resolve({ data: [], error: null }),
  };
}

function claims(bundle: Awaited<ReturnType<typeof assembleOpportunityEvidence>>): string[] {
  return buildOpportunityFactList(bundle).map((fact) => fact.claim_text);
}

describe("grant narrative evidence — RTP/MTP programming", () => {
  it("states each recorded cycle link as a fact, threading role, status, horizon, and band per row", async () => {
    const client = clientResolving(
      succeedingWith({ links: LINK_ROWS, cycles: CYCLE_ROWS, bands: BAND_ROWS })
    );
    const bundle = await assembleOpportunityEvidence(client, opportunity());

    expect(bundle.readFailures).toEqual([]);
    expect(bundle.rtpProgramming).toEqual([
      {
        cycleTitle: "2050 Valley Mobility Plan",
        cycleStatus: "adopted",
        horizonStartYear: 2026,
        horizonEndYear: 2050,
        adoptionTargetDate: null,
        portfolioRole: "constrained",
        horizonBandLabel: "First ten years",
      },
      {
        cycleTitle: "2045 Coastal RTP Update",
        cycleStatus: "public_review",
        horizonStartYear: null,
        horizonEndYear: null,
        adoptionTargetDate: "2027-03-15",
        portfolioRole: "illustrative",
        horizonBandLabel: null,
      },
    ]);

    // The dependent reads are scoped to the ids the LINK ROWS named.
    expect(client.inFiltersByTable["rtp_cycles"]).toEqual({ id: [CYCLE_A_ID, CYCLE_B_ID] });
    expect(client.inFiltersByTable["rtp_horizon_bands"]).toEqual({ id: [BAND_ID] });

    const facts = claims(bundle);
    const constrainedFact = facts.find((claim) => claim.includes("2050 Valley Mobility Plan"));
    expect(constrainedFact).toBeDefined();
    expect(constrainedFact).toContain("Main St Bridge Replacement");
    expect(constrainedFact).toContain(`cycle status "adopted"`);
    expect(constrainedFact).toContain(`portfolio role "constrained"`);
    expect(constrainedFact).toContain("fiscally constrained project list");
    expect(constrainedFact).toContain("plan horizon 2026–2050");
    expect(constrainedFact).toContain(`"First ten years" horizon band`);

    const illustrativeFact = facts.find((claim) => claim.includes("2045 Coastal RTP Update"));
    expect(illustrativeFact).toBeDefined();
    expect(illustrativeFact).toContain(`cycle status "public_review"`);
    expect(illustrativeFact).toContain(`portfolio role "illustrative"`);
    expect(illustrativeFact).toContain("NOT part of the fiscally constrained list");
    expect(illustrativeFact).toContain("recorded adoption target date 2027-03-15");
    expect(illustrativeFact).not.toContain("plan horizon");
    expect(illustrativeFact).not.toContain("horizon band");

    expect(facts.some((claim) => claim.includes("No regional transportation plan"))).toBe(false);
  });

  it("states an EXPLICIT absence fact when the reads succeed and no link is recorded", async () => {
    const bundle = await assembleOpportunityEvidence(
      clientResolving(succeedingWith({})),
      opportunity()
    );

    expect(bundle.readFailures).toEqual([]);
    expect(bundle.rtpProgramming).toEqual([]);

    const facts = claims(bundle);
    const absence = facts.find((claim) =>
      claim.includes("No regional transportation plan (RTP/MTP) programming is on record")
    );
    expect(absence).toBeDefined();
    expect(absence).toContain("Main St Bridge Replacement");
    expect(facts.some((claim) => claim.includes("is listed in the regional transportation plan cycle"))).toBe(
      false
    );
  });

  it("reports a failed links read and emits NEITHER a programming fact NOR the absence fact", async () => {
    const resolve: Resolver = (table, columns, inFilters) =>
      table === "project_rtp_cycle_links"
        ? { data: null, error: { message: "permission denied for table project_rtp_cycle_links" } }
        : succeedingWith({})(table, columns, inFilters);
    const bundle = await assembleOpportunityEvidence(clientResolving(resolve), opportunity());

    expect(bundle.readFailures).toEqual([
      {
        subject: "the project's RTP programming record",
        message: "permission denied for table project_rtp_cycle_links",
      },
    ]);
    expect(bundle.rtpProgramming).toBeNull();

    const facts = claims(bundle);
    expect(facts.some((claim) => claim.includes("regional transportation plan"))).toBe(false);
  });

  it("reports a failed cycles read after links succeed, and still claims nothing", async () => {
    const resolve: Resolver = (table, columns, inFilters) =>
      table === "rtp_cycles"
        ? { data: null, error: { message: "could not read rtp_cycles" } }
        : succeedingWith({ links: LINK_ROWS, bands: BAND_ROWS })(table, columns, inFilters);
    const bundle = await assembleOpportunityEvidence(clientResolving(resolve), opportunity());

    expect(bundle.readFailures).toEqual([
      { subject: "the RTP cycles the project is programmed in", message: "could not read rtp_cycles" },
    ]);
    expect(bundle.rtpProgramming).toBeNull();
    expect(claims(bundle).some((claim) => claim.includes("regional transportation plan"))).toBe(false);
  });

  it("reports a failed horizon-bands read after links succeed, and still claims nothing", async () => {
    const resolve: Resolver = (table, columns, inFilters) =>
      table === "rtp_horizon_bands"
        ? { data: null, error: { message: "could not read rtp_horizon_bands" } }
        : succeedingWith({ links: LINK_ROWS, cycles: CYCLE_ROWS })(table, columns, inFilters);
    const bundle = await assembleOpportunityEvidence(clientResolving(resolve), opportunity());

    expect(bundle.readFailures).toEqual([
      {
        subject: "the RTP horizon bands the project is programmed in",
        message: "could not read rtp_horizon_bands",
      },
    ]);
    expect(bundle.rtpProgramming).toBeNull();
    expect(claims(bundle).some((claim) => claim.includes("regional transportation plan"))).toBe(false);
  });

  it("says nothing about RTP programming when no project is linked", async () => {
    const bundle = await assembleOpportunityEvidence(
      clientResolving(succeedingWith({})),
      opportunity({ project_id: null })
    );

    expect(bundle.readFailures).toEqual([]);
    expect(bundle.rtpProgramming).toBeNull();
    expect(claims(bundle).some((claim) => claim.includes("regional transportation plan"))).toBe(false);
  });

  it("scopes the facts: citable under project and funding sections, excluded elsewhere", async () => {
    const bundle = await assembleOpportunityEvidence(
      clientResolving(succeedingWith({ links: LINK_ROWS, cycles: CYCLE_ROWS, bands: BAND_ROWS })),
      opportunity()
    );

    const inScope = (kinds: ("project" | "funding" | "kb" | "modeling")[]) =>
      buildOpportunityFactList(bundle, { suggestedEvidence: kinds }).some((fact) =>
        fact.claim_text.includes("regional transportation plan cycle")
      );

    expect(inScope(["project"])).toBe(true);
    expect(inScope(["funding"])).toBe(true);
    expect(inScope(["kb"])).toBe(false);
    expect(inScope(["modeling"])).toBe(false);
  });
});
