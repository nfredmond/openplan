import { describe, expect, it } from "vitest";
import {
  buildWorkspaceOperationsSummary,
  loadWorkspaceOperationsSummaryForWorkspace,
  type WorkspaceOperationsSupabaseLike,
} from "@/lib/operations/workspace-summary";

/**
 * Models a PostgREST filter builder the way the loader now uses one: every
 * filter returns the builder again, and the builder itself is awaitable. The
 * previous stub returned a fixed `.eq().order().limit()` shape, which could not
 * express the workspace-lane reads (a status filter after an embedded-table
 * filter, or a head-only count that ends at `.eq()`).
 *
 * A table may be given plain rows — in which case the stub reports an exact
 * count equal to the row count, the honest reading of an uncapped read — or a
 * `{ rows, count, error }` record, so a test can stage a read that FAILED or one
 * whose workspace holds more rows than the read returned.
 */
type WorkspaceOperationsStubTable =
  | unknown[]
  | { rows?: unknown[]; count?: number | null; error?: { message: string } };

function createWorkspaceOperationsSupabaseStub(dataByTable: Record<string, WorkspaceOperationsStubTable>) {
  const buildResult = (table: string) => {
    const entry = dataByTable[table];

    if (entry === undefined || Array.isArray(entry)) {
      const rows = entry ?? [];
      return { data: rows, count: rows.length, error: null };
    }

    if (entry.error) {
      return { data: null, count: null, error: entry.error };
    }

    const rows = entry.rows ?? [];
    return { data: rows, count: entry.count ?? rows.length, error: null };
  };

  const chain = (table: string) => {
    const self = {
      eq: () => self,
      in: () => self,
      order: () => self,
      limit: () => self,
      then: (
        onfulfilled?: ((value: ReturnType<typeof buildResult>) => unknown) | null,
        onrejected?: ((reason: unknown) => unknown) | null
      ) => Promise.resolve(buildResult(table)).then(onfulfilled, onrejected),
    };

    return self;
  };

  return {
    from: (table: string) => ({
      select: () => chain(table),
    }),
  } as unknown as WorkspaceOperationsSupabaseLike;
}

describe("workspace summary RTP funding review", () => {
  it("counts current RTP packets that still need funding-backed release review", () => {
    const summary = buildWorkspaceOperationsSummary({
      projects: [],
      plans: [],
      programs: [],
      reports: [
        {
          id: "report-rtp-1",
          title: "Nevada County RTP packet",
          status: "generated",
          latestArtifactKind: "html",
          generatedAt: "2026-04-12T20:00:00.000Z",
          updatedAt: "2026-04-12T20:00:00.000Z",
          metadataJson: {
            sourceContext: {
              rtpFundingSnapshot: {
                linkedProjectCount: 2,
                gapProjectCount: 1,
                likelyCoveredProjectCount: 0,
                outstandingReimbursementAmount: 0,
                uninvoicedAwardAmount: 0,
              },
            },
          },
        },
      ],
      fundingOpportunities: [],
      fundingAwards: [],
      fundingInvoices: [],
      projectSubmittals: [],
      projectFundingProfiles: [],
    });

    expect(summary.counts.reportPacketCurrent).toBe(1);
    expect(summary.counts.rtpFundingReviewPackets).toBe(1);
    expect(summary.nextCommand?.key).toBe("review-current-report-packets");
    expect(summary.nextCommand?.title).toBe("Run Grants follow-through on current packets");
    expect(summary.nextCommand?.moduleLabel).toBe("Grants");
    expect(summary.nextCommand?.tone).toBe("warning");
    expect(summary.nextCommand?.href).toBe("/grants#grants-gap-resolution-lane");
    expect(summary.nextCommand?.detail).toMatch(/funding sorted out in Grants/i);
  });

  it("uses stored RTP source timestamps instead of report.updatedAt when judging packet freshness", () => {
    const summary = buildWorkspaceOperationsSummary({
      projects: [],
      plans: [],
      programs: [],
      reports: [
        {
          id: "report-rtp-2",
          title: "Nevada County RTP packet",
          status: "generated",
          latestArtifactKind: "html",
          generatedAt: "2026-04-12T20:00:00.000Z",
          updatedAt: "2026-04-12T20:05:00.000Z",
          metadataJson: {
            sourceContext: {
              rtpCycleUpdatedAt: "2026-04-12T19:55:00.000Z",
              rtpFundingSnapshot: {
                linkedProjectCount: 1,
                gapProjectCount: 0,
                likelyCoveredProjectCount: 1,
                outstandingReimbursementAmount: 0,
                uninvoicedAwardAmount: 0,
              },
            },
          },
        },
      ],
      fundingOpportunities: [],
      fundingAwards: [],
      fundingInvoices: [],
      projectSubmittals: [],
      projectFundingProfiles: [],
    });

    expect(summary.counts.reportRefreshRecommended).toBe(0);
    expect(summary.counts.reportPacketCurrent).toBe(1);
    expect(summary.counts.rtpFundingReviewPackets).toBe(1);
    expect(summary.nextCommand?.key).toBe("review-current-report-packets");
    expect(summary.nextCommand?.moduleLabel).toBe("Grants");
  });

  it("keeps current RTP packets in a warning lane when the stored review loop is still open", () => {
    const summary = buildWorkspaceOperationsSummary({
      projects: [],
      plans: [],
      programs: [],
      reports: [
        {
          id: "report-rtp-open-review",
          title: "Nevada County RTP packet",
          status: "generated",
          latestArtifactKind: "html",
          generatedAt: "2026-04-12T20:00:00.000Z",
          updatedAt: "2026-04-12T20:00:00.000Z",
          metadataJson: {
            sourceContext: {
              publicReviewSummary: {
                label: "Public review active",
                detail: "1 comment is still waiting for operator review while 2 approved items are already ready for packet handoff.",
                tone: "warning",
                actionItems: ["Resolve pending comments before closeout."],
              },
            },
          },
        },
      ],
      fundingOpportunities: [],
      fundingAwards: [],
      fundingInvoices: [],
      projectSubmittals: [],
      projectFundingProfiles: [],
    });

    expect(summary.counts.reportPacketCurrent).toBe(1);
    expect(summary.counts.rtpFundingReviewPackets).toBe(0);
    expect(summary.nextCommand?.key).toBe("review-current-report-packets");
    expect(summary.nextCommand?.title).toBe("Review the packets that are ready");
    expect(summary.nextCommand?.tone).toBe("warning");
    expect(summary.nextCommand?.detail).toMatch(/review loop still open/i);
    expect(summary.nextCommand?.detail).toMatch(/1 comment is still waiting for operator review/i);
    expect(summary.counts.rtpReviewLoopOpenPackets).toBe(1);
  });

  /**
   * A CURRENT PACKET WITH AN APPROVED COMMENT BASIS IS NOT AN OPEN REVIEW LOOP.
   *
   * This is the counter-case to the test above, and it is the one that carries
   * the proof. `rtpReviewLoopOpenPackets` used to be computed by comparing the
   * release-review summary's `label` to the literal words "Release review
   * ready". Rewording that user-facing label — the kind of change made for
   * clarity, by someone with no reason to suspect behaviour hangs on it — made
   * every settled packet in every workspace fall out of the "ready" set: this
   * count would read 1 instead of 0, the dashboard would raise a warning-tone
   * next command telling the agency to close a review loop that is already
   * closed, and no test would have failed.
   *
   * MUTATION THAT PROVES IT: change `label: "Release review ready"` in
   * `src/lib/rtp/catalog.ts` to any other wording. Against the label
   * comparison this test fails (received 1, expected 0). Against the `state`
   * discriminant it passes unchanged — which is the whole point of the field.
   */
  it("does not count a settled RTP packet as an open review loop, whatever its label is worded as", () => {
    const summary = buildWorkspaceOperationsSummary({
      projects: [],
      plans: [],
      programs: [],
      reports: [
        {
          id: "report-rtp-settled-review",
          title: "Nevada County RTP packet",
          status: "generated",
          latestArtifactKind: "html",
          generatedAt: "2026-04-12T20:00:00.000Z",
          updatedAt: "2026-04-12T20:00:00.000Z",
          metadataJson: {
            sourceContext: {
              publicReviewSummary: {
                label: "Comment-response foundation ready",
                detail:
                  "5 approved comments are ready for packet handoff and the current RTP packet is in place for review closure.",
                tone: "success",
                actionItems: ["Carry approved comments into the board-ready response summary."],
              },
            },
          },
        },
      ],
      fundingOpportunities: [],
      fundingAwards: [],
      fundingInvoices: [],
      projectSubmittals: [],
      projectFundingProfiles: [],
    });

    expect(summary.counts.reportPacketCurrent).toBe(1);
    expect(summary.counts.rtpReviewLoopOpenPackets).toBe(0);
    // And the agency is not told to close a loop that is already closed.
    expect(summary.nextCommand?.detail ?? "").not.toMatch(/review loop/i);
  });

  it("prefers latest report artifact timing when loading workspace operations summary", async () => {
    const supabase = createWorkspaceOperationsSupabaseStub({
      projects: [],
      plans: [],
      programs: [],
      reports: [
        {
          id: "report-rtp-3",
          title: "Nevada County RTP packet",
          status: "generated",
          latest_artifact_kind: "html",
          generated_at: null,
          updated_at: "2026-04-12T20:05:00.000Z",
          metadata_json: null,
        },
      ],
      report_artifacts: [
        {
          report_id: "report-rtp-3",
          generated_at: "2026-04-12T20:00:00.000Z",
          metadata_json: {
            sourceContext: {
              rtpCycleUpdatedAt: "2026-04-12T19:55:00.000Z",
              rtpFundingSnapshot: {
                linkedProjectCount: 0,
                gapProjectCount: 0,
                likelyCoveredProjectCount: 0,
                outstandingReimbursementAmount: 0,
                uninvoicedAwardAmount: 0,
              },
            },
          },
        },
      ],
      funding_opportunities: [],
      funding_awards: [],
      billing_invoice_records: [],
      project_submittals: [],
      project_funding_profiles: [],
    });

    const summary = await loadWorkspaceOperationsSummaryForWorkspace(supabase, "workspace-1");

    expect(summary.counts.reportNoPacket).toBe(0);
    expect(summary.counts.reportRefreshRecommended).toBe(0);
    expect(summary.counts.reportPacketCurrent).toBe(1);
    expect(summary.nextCommand?.key).toBe("review-current-report-packets");
  });

  it("caveats comparison-backed reports as planning support in the workspace queue", () => {
    const summary = buildWorkspaceOperationsSummary({
      projects: [
        {
          id: "project-1",
          name: "Modeled Project",
          status: "active",
          deliveryPhase: "delivery",
          updatedAt: "2026-04-12T20:00:00.000Z",
        },
        {
          id: "project-2",
          name: "Unmodeled Project",
          status: "active",
          deliveryPhase: "delivery",
          updatedAt: "2026-04-12T19:00:00.000Z",
        },
      ],
      plans: [],
      programs: [],
      reports: [
        {
          id: "report-comparison-1",
          projectId: "project-1",
          title: "Grant Strategy Packet",
          status: "generated",
          latestArtifactKind: "html",
          generatedAt: "2026-04-12T20:00:00.000Z",
          updatedAt: "2026-04-12T20:00:00.000Z",
          metadataJson: {
            sourceContext: {
              scenarioSetLinks: [
                {
                  scenarioSetId: "scenario-set-1",
                  comparisonSnapshots: [
                    {
                      comparisonSnapshotId: "comparison-1",
                      status: "ready",
                      indicatorDeltaCount: 3,
                      updatedAt: "2026-04-12T19:45:00.000Z",
                      candidateEntryLabel: "Bundled delivery scenario",
                    },
                  ],
                },
              ],
            },
          },
        },
      ],
      fundingOpportunities: [
        {
          id: "opp-1",
          title: "ATP Cycle 8",
          opportunityStatus: "open",
          decisionState: "monitor",
          expectedAwardAmount: 100000,
          closesAt: "2026-05-12T00:00:00.000Z",
          decisionDueAt: null,
          programId: null,
          projectId: "project-1",
          updatedAt: "2026-04-12T20:00:00.000Z",
        },
        {
          id: "opp-2",
          title: "SB1 Local Partnership",
          opportunityStatus: "open",
          decisionState: "monitor",
          expectedAwardAmount: 80000,
          closesAt: "2026-05-16T00:00:00.000Z",
          decisionDueAt: null,
          programId: null,
          projectId: "project-2",
          updatedAt: "2026-04-12T19:00:00.000Z",
        },
      ],
      fundingAwards: [],
      fundingInvoices: [],
      projectSubmittals: [],
      projectFundingProfiles: [],
    });

    const comparisonCommand = summary.fullCommandQueue.find(
      (item) => item.key === "review-comparison-backed-reports"
    );

    expect(comparisonCommand?.detail).toContain(
      "saved comparison context that can support grant planning language or prioritization framing"
    );
    expect(summary.grantModelingSummary?.breakdownSummary).toBe(
      "2 opportunity-linked projects: 1 appears decision-ready, 0 refresh recommended, 0 appears thin, 1 without visible support."
    );
    expect(summary.grantModelingSummary?.operatorDetail).toContain(
      "opportunity-linked projects with modeling support that appears decision-ready rise ahead of refresh-recommended, thin, or unsupported work"
    );
    expect(summary.grantModelingSummary?.operatorDetail).toContain(
      "Treat it as planning support only, not proof of award likelihood or a replacement for funding-source review."
    );
    expect(comparisonCommand?.detail).toContain(
      "Across 2 opportunity-linked projects: 1 appears decision-ready, 0 refresh recommended, 0 appears thin, 1 without visible support."
    );
    expect(comparisonCommand?.detail).toContain(
      "not proof of award likelihood or a replacement for funding-source review"
    );
    expect(comparisonCommand?.badges).toContainEqual({
      label: "Modeling triage",
      value: "1 ready · 0 refresh · 0 thin · 1 none",
    });
  });
});

/**
 * THE SPINE READS MAY NOT ANSWER A FAILURE AS AN EMPTY WORKSPACE.
 *
 * The nine reads behind `counts` were spelled `(result.data ?? []) as Row[]`,
 * which gives a permission error, a missing table and a genuinely empty
 * workspace the same answer: zero of everything, no queue item, and a summary
 * whose headline says the command queue is clear. That summary is read by the
 * Dashboard, the Command Center, `/api/analysis/context`, the Data Hub and five
 * assistant contexts, so one swallowed error becomes "this workspace has no
 * projects" everywhere at once — including inside a grant narrative.
 *
 * A MOCKED SUPABASE CLIENT CANNOT FIND THIS BY ITSELF: it returns its fixture
 * whatever the code asks for, so the failure path is unreachable unless the
 * harness is taught to fail a NAMED table. The stub above takes
 * `{ error: { message } }` per table, which is what makes these tests real.
 *
 * Each one asserts both halves — the honest new disclosure is present AND the
 * old false claim is gone — because a test that only checks the new sentence
 * would pass with the old one still printed beside it.
 */
describe("workspace summary reads that failed", () => {
  const failedRead = (table: string) => ({ error: { message: `permission denied for table ${table}` } });

  it("names a failed projects read instead of reporting a workspace with no projects", async () => {
    const supabase = createWorkspaceOperationsSupabaseStub({
      projects: failedRead("projects"),
    });

    const summary = await loadWorkspaceOperationsSummaryForWorkspace(supabase, "workspace-1");

    expect(summary.moduleObservations?.unreadable).toContainEqual({
      label: "projects",
      message: "permission denied for table projects",
    });
    // The old answers, both gone.
    expect(summary.headline).not.toBe("Workspace command queue is clear");
    expect(summary.detail).not.toMatch(/create the next project/i);
    expect(summary.headline).toBe("Workspace command queue could not be read in full");
    expect(summary.detail).toContain("could not read projects");
    expect(summary.detail).toMatch(/not the same as nothing needing attention/i);
  });

  it("names every spine read it could not make, not only the first", async () => {
    const supabase = createWorkspaceOperationsSupabaseStub({
      projects: failedRead("projects"),
      plans: failedRead("plans"),
      programs: failedRead("programs"),
      reports: failedRead("reports"),
      funding_opportunities: failedRead("funding_opportunities"),
      funding_awards: failedRead("funding_awards"),
      billing_invoice_records: failedRead("billing_invoice_records"),
      project_submittals: failedRead("project_submittals"),
      project_funding_profiles: failedRead("project_funding_profiles"),
    });

    const summary = await loadWorkspaceOperationsSummaryForWorkspace(supabase, "workspace-1");

    expect(summary.moduleObservations?.unreadable.map((failure) => failure.label)).toEqual(
      expect.arrayContaining([
        "projects",
        "plans",
        "programs",
        "report records",
        "funding opportunities",
        "funding awards",
        "grant reimbursement invoices",
        "project submittals",
        "project funding profiles",
      ])
    );
    expect(summary.moduleObservations?.unreadable.map((failure) => failure.message)).toContain(
      "permission denied for table billing_invoice_records"
    );
    expect(summary.headline).toBe("Workspace command queue could not be read in full");

    // THE HALF OF THIS DEFECT THAT IS NOT CLOSED, PINNED SO IT CANNOT BE
    // MISTAKEN FOR CLOSED. `counts` is a non-nullable `number` read by a dozen
    // surfaces outside this module, so a failed read still lands there as a
    // zero. Everything a planner READS about that zero now carries the
    // disclosure; the field itself still lies, and making it `number | null` is
    // a change to every consumer.
    expect(summary.counts.projects).toBe(0);
    expect(summary.counts.fundingOpportunities).toBe(0);
  });

  it("says the report packet artifacts could not be read rather than dating packets silently", async () => {
    // Freshness, the RTP funding review and the comparison-backed count are all
    // taken off the artifact metadata this read supplies. When it fails they
    // fall back to the report row, which IS written at generation — so the
    // numbers are computable but potentially a generation stale, and that is
    // what has to be said out loud.
    const supabase = createWorkspaceOperationsSupabaseStub({
      reports: [
        {
          id: "report-artifact-read-failed",
          title: "Regional packet",
          status: "generated",
          latest_artifact_kind: "html",
          generated_at: "2026-04-12T20:00:00.000Z",
          updated_at: "2026-04-12T20:00:00.000Z",
          metadata_json: null,
        },
      ],
      report_artifacts: failedRead("report_artifacts"),
    });

    const summary = await loadWorkspaceOperationsSummaryForWorkspace(supabase, "workspace-1");

    expect(summary.moduleObservations?.unreadable).toContainEqual({
      label: "report packet artifacts",
      message: "permission denied for table report_artifacts",
    });
  });

  it("still calls a genuinely empty workspace empty when every read succeeded", async () => {
    // The control that keeps the fix from being "hedge everything". Without it,
    // replacing the whole branch with the disclosure would pass every test
    // above while making the summary useless on a working deployment.
    const supabase = createWorkspaceOperationsSupabaseStub({});

    const summary = await loadWorkspaceOperationsSummaryForWorkspace(supabase, "workspace-1");

    expect(summary.moduleObservations?.unreadable).toEqual([]);
    expect(summary.headline).toBe("Workspace command queue is clear");
    expect(summary.detail).toMatch(/create the next project/i);
  });

  it("keeps saying a lane it could not read is unreadable, alongside the spine", async () => {
    // The spine reads joined a log the workspace lanes already used. Both must
    // still arrive, or extending the mechanism traded one blind spot for
    // another.
    const supabase = createWorkspaceOperationsSupabaseStub({
      plans: failedRead("plans"),
      model_runs: failedRead("model_runs"),
    });

    const summary = await loadWorkspaceOperationsSummaryForWorkspace(supabase, "workspace-1");

    expect(summary.moduleObservations?.unreadable.map((failure) => failure.label)).toEqual(
      expect.arrayContaining(["plans", "model runs"])
    );
    expect(summary.moduleObservations?.modeling.modelRuns).toBeNull();
    expect(summary.detail).toContain("plans");
    expect(summary.detail).toContain("model runs");
  });
});
