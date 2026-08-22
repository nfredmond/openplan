import { afterEach, describe, expect, it } from "vitest";
import {
  assembleOpportunityEvidence,
  type NarrativeEvidenceOpportunity,
} from "@/lib/grants/narrative-evidence";

/**
 * A FAILED EVIDENCE READ IS NOT AN EMPTY EVIDENCE FAMILY.
 *
 * `assembleOpportunityEvidence` fans out eleven reads (plus dependent RTP
 * cycle/band reads exercised in grant-narrative-rtp-programming.test.ts) and
 * hands the result to the
 * grant-drafting prompts, which turn an empty family into a literal order to the
 * model — "Do not reference community input, public comments, or outreach
 * results." Every one of those reads answers a failure with the same empty value
 * it answers a genuine absence with, so unless the failure is REPORTED, the
 * prompt cannot tell "this agency ran no outreach" from "this query failed" and
 * states the first as fact inside a competitive federal grant application.
 *
 * WHY THE HARNESS RESOLVES ON `(table, columns)` RATHER THAN TABLE ALONE. A
 * mocked Supabase client hands back its fixture whatever the code asked for,
 * which is exactly why this defect class shipped undetected — a test that cannot
 * FAIL A NAMED READ never reaches the failure path and proves nothing. Two of
 * the ten reads are both `from("projects")` (the linked project, and the
 * workspace's completed-projects history for a proposal pursuit), so keying on
 * the table alone would fail them together and could not tell which subject the
 * loader named.
 */

type ReadResult = { data: unknown; error: { message: string } | null };

const OPPORTUNITY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID = "44444444-4444-4444-8444-444444444444";
const REPORT_ID = "66666666-6666-4666-8666-666666666666";

function opportunity(
  overrides: Partial<NarrativeEvidenceOpportunity> = {}
): NarrativeEvidenceOpportunity {
  return {
    id: OPPORTUNITY_ID,
    workspace_id: WORKSPACE_ID,
    program_id: null,
    project_id: PROJECT_ID,
    title: "2027 ATP countywide active transportation call",
    opportunity_status: "open",
    decision_state: "pursue",
    agency_name: "CTC / Caltrans",
    expected_award_amount: 750000,
    summary: "Countywide ATP package opportunity.",
    ...overrides,
  };
}

/** The one read every failure case is measured against: everything succeeds, empty. */
function succeeding(table: string, columns: string): ReadResult {
  if (table === "projects" && !columns.includes("updated_at")) {
    return { data: { id: PROJECT_ID, name: "Main St Bridge" }, error: null };
  }
  if (table === "project_funding_profiles") return { data: null, error: null };
  // Reports must return a row, or the report_artifacts read never happens and
  // the artifacts lane below could not be exercised at all.
  if (table === "reports") {
    return {
      data: [
        {
          id: REPORT_ID,
          project_id: PROJECT_ID,
          title: "Corridor screening",
          updated_at: "2026-07-01T00:00:00.000Z",
          generated_at: "2026-07-01T00:00:00.000Z",
          latest_artifact_kind: null,
        },
      ],
      error: null,
    };
  }
  return { data: [], error: null };
}

/**
 * Every read the loader performs, with the subject it must report the failure
 * under. `matches` is what tells the two `projects` reads apart.
 */
const READS: ReadonlyArray<{
  subject: string;
  table: string;
  matches?: (columns: string) => boolean;
  proposalOnly?: boolean;
}> = [
  { subject: "the linked project", table: "projects", matches: (c) => !c.includes("updated_at") },
  { subject: "the project's funding profile", table: "project_funding_profiles" },
  { subject: "the project's funding awards", table: "funding_awards" },
  { subject: "the project's other funding opportunities", table: "funding_opportunities" },
  { subject: "the project's grant invoices", table: "billing_invoice_records" },
  { subject: "the project's reports", table: "reports" },
  { subject: "the project's benefit-cost screenings", table: "project_bca_screenings" },
  { subject: "the project's engagement campaigns", table: "engagement_campaigns" },
  { subject: "the project's report artifacts", table: "report_artifacts" },
  { subject: "the project's RTP programming record", table: "project_rtp_cycle_links" },
  {
    subject: "the workspace's completed projects",
    table: "projects",
    matches: (c) => c.includes("updated_at"),
    proposalOnly: true,
  },
];

function clientResolving(resolve: (table: string, columns: string) => ReadResult) {
  return {
    from(table: string) {
      let columns = "";
      const chain: Record<string, unknown> = {
        select: (cols: string) => {
          columns = cols;
          return chain;
        },
        maybeSingle: () => Promise.resolve(resolve(table, columns)),
        then: (ok: (value: unknown) => unknown, err?: (reason: unknown) => unknown) =>
          Promise.resolve(resolve(table, columns)).then(ok, err),
      };
      for (const method of ["eq", "neq", "not", "in", "order", "limit"]) {
        chain[method] = () => chain;
      }
      return chain;
    },
    // Knowledge Base retrieval swallows by contract; the crash-proximity read
    // does NOT, so it is dispatched by name and answered by `rpcResolver`.
    rpc: (name: string) =>
      Promise.resolve(
        name === "engagement_items_with_nearby_crashes"
          ? rpcResolver(name)
          : { data: [], error: null }
      ),
  };
}

/** What the crash-proximity RPC answers. Swapped per test; reset by default. */
let rpcResolver: (name: string) => ReadResult = () => ({ data: [], error: null });

/** One campaign on the linked project, so the lead-campaign read actually happens. */
function withLeadCampaign(table: string, columns: string): ReadResult {
  if (table === "engagement_campaigns") {
    return {
      data: [
        {
          id: "campaign-1",
          project_id: PROJECT_ID,
          title: "Ridge Road Listening Campaign",
          status: "active",
          updated_at: "2026-08-01T00:00:00.000Z",
          ai_synthesis_json: null,
          ai_synthesized_at: null,
          representativeness_json: null,
          representativeness_computed_at: null,
        },
      ],
      error: null,
    };
  }
  return succeeding(table, columns);
}

/** Every read succeeds except the one named — the only way to reach the failure path. */
function clientFailing(read: (typeof READS)[number], message: string) {
  return clientResolving((table, columns) => {
    const isSubject = table === read.table && (read.matches ? read.matches(columns) : true);
    return isSubject ? { data: null, error: { message } } : succeeding(table, columns);
  });
}

describe("assembleOpportunityEvidence — a failed read is reported, never answered as absence", () => {
  it("reports no failures when every read succeeds and genuinely finds nothing", async () => {
    const bundle = await assembleOpportunityEvidence(clientResolving(succeeding), opportunity());

    expect(bundle.readFailures).toEqual([]);
    // The evidence families really are empty — which is what makes the prompt's
    // "do not reference community input" instruction honest in THIS case, and
    // only in this case.
    expect(bundle.engagementEvidence).toBeNull();
    expect(bundle.bcaScreening).toBeNull();
  });

  it("reports a failed engagement-campaigns read, which is otherwise indistinguishable from no outreach", async () => {
    const read = READS.find((entry) => entry.table === "engagement_campaigns")!;
    const bundle = await assembleOpportunityEvidence(
      clientFailing(read, "permission denied for table engagement_campaigns"),
      opportunity()
    );

    expect(bundle.readFailures).toEqual([
      {
        subject: "the project's engagement campaigns",
        message: "permission denied for table engagement_campaigns",
      },
    ]);
    // THE POINT OF THE FIELD: the evidence itself looks exactly like an agency
    // that ran no outreach. Only `readFailures` separates the two.
    expect(bundle.engagementEvidence).toBeNull();
  });

  it.each(READS.filter((read) => !read.proposalOnly).map((read) => [read.subject, read] as const))(
    "reports a failed read of %s",
    async (subject, read) => {
      const bundle = await assembleOpportunityEvidence(
        clientFailing(read, `could not read ${read.table}`),
        opportunity()
      );

      expect(bundle.readFailures.map((failure) => failure.subject)).toEqual([subject]);
      expect(bundle.readFailures[0].message).toBe(`could not read ${read.table}`);
    }
  );

  it("reports a failed completed-projects read on a proposal pursuit", async () => {
    const read = READS.find((entry) => entry.proposalOnly)!;
    const bundle = await assembleOpportunityEvidence(
      clientFailing(read, "could not read the completed-projects history"),
      opportunity({ pursuit_kind: "proposal" })
    );

    expect(bundle.readFailures).toEqual([
      {
        subject: "the workspace's completed projects",
        message: "could not read the completed-projects history",
      },
    ]);
    // Null past performance and a failed read are the same value; the list is
    // what stops "this firm has completed nothing" being written into a proposal.
    expect(bundle.completedProjects).toBeNull();
  });

  it("names an error with no message rather than dropping the failure", async () => {
    const read = READS.find((entry) => entry.table === "engagement_campaigns")!;
    const bundle = await assembleOpportunityEvidence(clientFailing(read, "   "), opportunity());

    expect(bundle.readFailures).toEqual([
      { subject: "the project's engagement campaigns", message: "no message reported" },
    ]);
  });

  it("attempts no project reads, and so reports no failures, when no project is linked", async () => {
    const bundle = await assembleOpportunityEvidence(
      clientResolving(() => ({ data: null, error: { message: "should never be read" } })),
      opportunity({ project_id: null })
    );

    expect(bundle.readFailures).toEqual([]);
  });
});

describe("assembleOpportunityEvidence — the crash-proximity reading", () => {
  const CRASH_SUBJECT = "reported collisions near the lead engagement campaign's mapped comments";

  afterEach(() => {
    rpcResolver = () => ({ data: [], error: null });
  });

  it("reports a failed crash read instead of drafting as though nothing was near", async () => {
    // The whole point of the seam: an error and an empty campaign look
    // identical downstream. A drafter that cannot tell them apart writes a
    // federal application asserting a clean collision history it never read.
    rpcResolver = () => ({ data: null, error: { message: "permission denied for safety_crashes" } });

    const bundle = await assembleOpportunityEvidence(clientResolving(withLeadCampaign), opportunity());

    expect(bundle.readFailures.map((failure) => failure.subject)).toContain(CRASH_SUBJECT);
    expect(bundle.engagementEvidence?.leadCampaign.crashCorroboration).toBeNull();
  });

  it("attaches the reading when the crash read succeeds, and reports no failure", async () => {
    rpcResolver = () => ({
      data: [
        {
          id: "item-1",
          campaign_id: "campaign-1",
          category_id: null,
          title: null,
          body: "the crossing here is dangerous",
          latitude: 38.5968,
          longitude: -121.49,
          votes_count: 0,
          covered_by_ingest: true,
          coverage_years: [2024, 2025],
          coverage_severity_completeness: ["kabco_full"],
          crash_total: 5,
          fatal_count: 0,
          severe_injury_count: 1,
          injury_count: 2,
          pdo_count: 2,
          killed_total: 0,
          injured_total: 3,
          pedestrian_crashes: 1,
          bicyclist_crashes: 0,
          nearest_crash_meters: 12.4,
          earliest_crash_year: 2024,
          latest_crash_year: 2025,
        },
      ],
      error: null,
    });

    const bundle = await assembleOpportunityEvidence(clientResolving(withLeadCampaign), opportunity());

    expect(bundle.readFailures.map((failure) => failure.subject)).not.toContain(CRASH_SUBJECT);
    const corroboration = bundle.engagementEvidence?.leadCampaign.crashCorroboration;
    expect(corroboration?.coveredTotal).toBe(1);
    expect(corroboration?.withAnyCrash).toBe(1);
    // The radius is fixed for a citable fact and travels with the reading.
    expect(corroboration?.radiusMeters).toBe(100);
  });

  it("does not break grant drafting on a deployment that has not applied the migration", async () => {
    // THE DEFECT THIS PREVENTS, and it was live until the gate caught it.
    // PostgREST answers a missing function with "Could not find the function
    // … in the schema cache". This route REFUSES TO DRAFT when any read failed,
    // so classifying that as a failure would 500 every grant narrative on every
    // deployment during its migrate window — to protect an evidence family that
    // deployment cannot possibly have.
    rpcResolver = () => ({
      data: null,
      error: {
        message:
          "Could not find the function public.engagement_items_with_nearby_crashes(p_campaign_id, p_from_year, p_radius_meters, p_to_year, p_workspace_id) in the schema cache",
      },
    });

    const bundle = await assembleOpportunityEvidence(clientResolving(withLeadCampaign), opportunity());

    // No failure reported: this is a named operator step, not an outage.
    expect(bundle.readFailures).toEqual([]);
    // And no reading invented from it — nothing false is stated, exactly as for
    // a workspace that has acquired no crash data.
    expect(bundle.engagementEvidence?.leadCampaign.crashCorroboration).toBeNull();
  });

  it("reports a client that cannot make the call at all, rather than throwing through the bundle", async () => {
    // The assembler's contract is NEVER THROWS AND NEVER SWALLOWS. A throw here
    // would take every other evidence family down with it.
    const client = clientResolving(withLeadCampaign) as Record<string, unknown>;
    client.rpc = () => {
      throw new Error("rpc unavailable");
    };

    const bundle = await assembleOpportunityEvidence(client, opportunity());

    expect(bundle.readFailures.map((failure) => failure.subject)).toContain(CRASH_SUBJECT);
    expect(bundle.engagementEvidence?.leadCampaign.crashCorroboration).toBeNull();
    // The rest of the bundle survived.
    expect(bundle.engagementEvidence?.leadCampaign.title).toBe("Ridge Road Listening Campaign");
  });

  it("attempts no crash read at all when the project has no engagement campaign", async () => {
    const names: string[] = [];
    rpcResolver = (name) => {
      names.push(name);
      return { data: [], error: null };
    };

    const bundle = await assembleOpportunityEvidence(clientResolving(succeeding), opportunity());

    expect(bundle.engagementEvidence).toBeNull();
    expect(names).toEqual([]);
    expect(bundle.readFailures).toEqual([]);
  });
});
