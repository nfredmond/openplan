/**
 * THE BAND-SCAFFOLD OFFER RENDERS FROM A CONTEXT THE REAL LOADER BUILT.
 *
 * `record_stage_gate_hold` shipped with an offer condition no board could
 * satisfy, and its reachability test passed anyway — because the fixture
 * described a state the product cannot produce. So this file builds the RTP
 * cycle context through the REAL `loadAssistantContext` over a stubbed
 * PostgREST client, asserts the loader's own output produced the state the
 * offer keys on (`fiscal.summary.blockers` containing `no_horizon_bands`,
 * computed by the real fiscal engine from an empty bands read and a declared
 * horizon) BEFORE asserting the offer, and then drives the real
 * `buildAssistantOperations`.
 *
 * The withheld cases matter as much as the offered one:
 *   - a plan that already HAS periods gets no offer (and the route would 409);
 *   - a plan with no declared horizon gets no offer (the route would 422);
 *   - a FAILED bands read nulls `fiscal.summary`, and the offer must not
 *     render — offering a scaffold over a failed read treats "could not read
 *     the periods" as "there are none", the exact confusion the null exists
 *     to prevent.
 */
import { describe, expect, it, vi } from "vitest";

// The workspace operations summary is another module's surface with its own
// tests; the offer under test keys on `rtpCycle` and `fiscal`, both of which
// stay REAL below. Same mock the assistant-context-load harness uses.
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

import { loadAssistantContext } from "@/lib/assistant/context";
import { buildAssistantOperations } from "@/lib/assistant/operations";
import { resolveQuickLinkApproval } from "@/lib/runtime/action-metadata";

type StubOverrides = {
  horizonStartYear?: number | null;
  horizonEndYear?: number | null;
  bands?: unknown[];
  bandsReadError?: { message: string } | null;
};

/**
 * Every table the RTP cycle loader reads, mirroring the stub in
 * `assistant-context-load.test.ts` (whose "Unexpected table" throw is what
 * keeps this enumeration honest — a new read fails loudly here too).
 */
function createRtpCycleSupabaseStub(overrides: StubOverrides = {}) {
  const workspaceMembershipMaybeSingle = async () => ({
    data: {
      workspace_id: "workspace-1",
      role: "owner",
      workspaces: { id: "workspace-1", name: "OpenPlan QA", plan: "starter" },
    },
  });

  const cycleMaybeSingle = async () => ({
    data: {
      id: "cycle-1",
      workspace_id: "workspace-1",
      title: "2027 RTP",
      summary: "Countywide RTP update",
      status: "draft",
      geography_label: "Example County",
      horizon_start_year: overrides.horizonStartYear === undefined ? 2027 : overrides.horizonStartYear,
      horizon_end_year: overrides.horizonEndYear === undefined ? 2050 : overrides.horizonEndYear,
      adoption_target_date: null,
      public_review_open_at: null,
      public_review_close_at: null,
      updated_at: "2026-03-28T17:30:00.000Z",
    },
  });

  const eqArray = async (data: unknown[]) => ({ data, error: null });
  const packetReportsOrder = async () => ({
    data: [
      {
        id: "report-1",
        title: "2027 RTP Packet",
        generated_at: null,
        latest_artifact_kind: "html",
        updated_at: "2026-03-28T17:35:00.000Z",
      },
    ],
    error: null,
  });
  const artifactsIn = async () => ({
    data: [{ report_id: "report-1", generated_at: "2026-03-28T18:00:00.000Z" }],
    error: null,
  });

  return {
    from(table: string) {
      if (table === "workspace_members") {
        return {
          select() {
            return {
              eq() {
                return {
                  eq() {
                    return { maybeSingle: workspaceMembershipMaybeSingle };
                  },
                };
              },
            };
          },
        };
      }

      if (table === "rtp_cycles") {
        return {
          select() {
            return {
              eq() {
                return { maybeSingle: cycleMaybeSingle };
              },
            };
          },
        };
      }

      if (table === "rtp_cycle_chapters") {
        return {
          select() {
            return {
              eq() {
                return eqArray([{ id: "chapter-1", status: "ready_for_review" }]);
              },
            };
          },
        };
      }

      if (table === "project_rtp_cycle_links") {
        return {
          select() {
            return {
              eq() {
                return eqArray([{ id: "link-1" }]);
              },
            };
          },
        };
      }

      if (table === "engagement_campaigns") {
        return {
          select() {
            return {
              eq() {
                return eqArray([]);
              },
            };
          },
        };
      }

      if (table === "reports") {
        return {
          select() {
            return {
              eq() {
                return {
                  eq() {
                    return { order: packetReportsOrder };
                  },
                };
              },
            };
          },
        };
      }

      if (table === "report_artifacts") {
        return {
          select() {
            return { in: artifactsIn };
          },
        };
      }

      if (table === "modeling_claim_decisions") {
        const limit = async () => ({ data: [{ county_run_id: "county-run-1" }], error: null });
        const chain: Record<string, unknown> = {
          eq: () => chain,
          not: () => chain,
          order: () => ({ limit }),
        };
        return { select: () => chain };
      }

      if (table === "projects") {
        // The fiscal engine's project-cost read: an empty, successful list.
        const chain: Record<string, unknown> = {
          eq: () => chain,
          in: () => chain,
          order: () => chain,
          limit: () => chain,
          then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
            Promise.resolve({ data: [], error: null }).then(resolve),
        };
        return { select: () => chain };
      }

      if (
        table === "rtp_horizon_bands" ||
        table === "rtp_financial_assumptions" ||
        table === "rtp_performance_measures"
      ) {
        const rows =
          table === "rtp_horizon_bands" ? (overrides.bands ?? []) : [];
        const error = table === "rtp_horizon_bands" ? (overrides.bandsReadError ?? null) : null;
        const ordered: Record<string, unknown> = {
          order: () => ordered,
          limit: () => ordered,
          eq: () => ordered,
          then: (resolve: (value: { data: unknown[] | null; error: unknown }) => unknown) =>
            Promise.resolve({ data: error ? null : rows, error }).then(resolve),
        };
        return {
          select() {
            return { eq: () => ordered };
          },
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

async function loadCycleContext(overrides: StubOverrides = {}) {
  const context = await loadAssistantContext(
    createRtpCycleSupabaseStub(overrides) as never,
    "user-1",
    {
      kind: "rtp_cycle",
      id: "cycle-1",
      workspaceId: "workspace-1",
      runId: null,
      baselineRunId: null,
    }
  );
  if (!context || context.kind !== "rtp_cycle") {
    throw new Error("Expected RTP cycle context");
  }
  return context;
}

const SCAFFOLD_LINK_ID = "rtp-scaffold-horizon-bands";

describe("the band-scaffold offer", () => {
  it("renders when the REAL loader reports a declared horizon and no periods", async () => {
    const context = await loadCycleContext();

    // The keyed-on state must come out of the real loader + real fiscal
    // engine before the offer is even examined — a fixture describing this
    // state proves the assertion, not the feature.
    expect(context.fiscal?.summary).not.toBeNull();
    expect(context.fiscal?.summary?.blockers.map((blocker) => blocker.code)).toContain(
      "no_horizon_bands"
    );

    const links = buildAssistantOperations(context);
    const offer = links.find((link) => link.id === SCAFFOLD_LINK_ID);
    expect(offer, "the scaffold quick link did not render").toBeTruthy();
    expect(offer?.executeAction).toEqual(
      expect.objectContaining({
        kind: "create_rtp_horizon_bands_from_cycle_horizon",
        workspaceId: "workspace-1",
        rtpCycleId: "cycle-1",
        bandingProfileKey: "near_term_then_outyears",
      })
    );
    // The approval tier resolves from the registry, not from the link literal.
    expect(offer && resolveQuickLinkApproval(offer)).toBe("approval_required");
    // The offer names the plan's own horizon — the reason is derived, like
    // everything else about this action.
    expect(offer?.reason).toContain("2027–2050");
  });

  it("is withheld when the plan already has periods", async () => {
    const context = await loadCycleContext({
      bands: [
        {
          id: "band-1",
          label: "2027–2036",
          start_year: 2027,
          end_year: 2036,
          escalation_target_year: null,
          cost_estimate_basis: "itemized",
          sort_order: 0,
        },
      ],
    });

    expect(context.fiscal?.summary?.blockers.map((blocker) => blocker.code) ?? []).not.toContain(
      "no_horizon_bands"
    );
    expect(buildAssistantOperations(context).find((link) => link.id === SCAFFOLD_LINK_ID)).toBeUndefined();
  });

  it("is withheld when the plan has not declared its horizon", async () => {
    const context = await loadCycleContext({ horizonStartYear: null, horizonEndYear: null });
    expect(buildAssistantOperations(context).find((link) => link.id === SCAFFOLD_LINK_ID)).toBeUndefined();
  });

  it("is withheld when the bands read FAILED — a failed read is not an empty plan", async () => {
    const context = await loadCycleContext({
      bandsReadError: { message: "permission denied for table rtp_horizon_bands" },
    });

    expect(context.fiscal?.summary ?? null).toBeNull();
    expect(buildAssistantOperations(context).find((link) => link.id === SCAFFOLD_LINK_ID)).toBeUndefined();
  });
});
