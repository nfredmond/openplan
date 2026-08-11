import { describe, expect, it } from "vitest";
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
    // Knowledge Base retrieval; not the subject here, and it swallows by contract.
    rpc: () => Promise.resolve({ data: [], error: null }),
  };
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
