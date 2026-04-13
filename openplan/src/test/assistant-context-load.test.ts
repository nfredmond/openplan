import { describe, expect, it, vi } from "vitest";

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
import { buildAssistantPreview } from "@/lib/assistant/respond";

function createSupabaseStub() {
  const reportMaybeSingle = async () => ({
    data: {
      id: "report-1",
      workspace_id: "workspace-1",
      project_id: null,
      rtp_cycle_id: "cycle-1",
      title: "Nevada County RTP Packet",
      report_type: "board_packet",
      status: "generated",
      summary: "Packet ready for review.",
      generated_at: null,
      latest_artifact_kind: "html",
      updated_at: "2026-03-28T17:45:00.000Z",
    },
  });

  const workspaceMembershipMaybeSingle = async () => ({
    data: {
      workspace_id: "workspace-1",
      role: "owner",
      workspaces: {
        id: "workspace-1",
        name: "OpenPlan QA",
        plan: "starter",
      },
    },
  });

  const rtpCycleMaybeSingle = async () => ({
    data: {
      id: "cycle-1",
      title: "2027 RTP",
      status: "draft",
      updated_at: "2026-03-28T17:30:00.000Z",
    },
  });

  const emptyOrdered = async () => ({ data: [] });

  const artifactOrder = async () => ({
    data: [
      {
        id: "artifact-1",
        artifact_kind: "html",
        generated_at: "2026-03-28T18:00:00.000Z",
        metadata_json: {},
      },
    ],
  });

  return {
    from(table: string) {
      if (table === "reports") {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: reportMaybeSingle,
                };
              },
            };
          },
        };
      }

      if (table === "workspace_members") {
        return {
          select() {
            return {
              eq() {
                return {
                  eq() {
                    return {
                      maybeSingle: workspaceMembershipMaybeSingle,
                    };
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
                return {
                  maybeSingle: rtpCycleMaybeSingle,
                };
              },
            };
          },
        };
      }

      if (table === "projects") {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: async () => ({ data: null }),
                };
              },
            };
          },
        };
      }

      if (table === "report_sections" || table === "report_runs") {
        return {
          select() {
            return {
              eq() {
                return {
                  order: emptyOrdered,
                };
              },
            };
          },
        };
      }

      if (table === "report_artifacts") {
        return {
          select() {
            return {
              eq() {
                return {
                  order: artifactOrder,
                };
              },
            };
          },
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

function createRtpRegistrySupabaseStub() {
  const workspaceMembershipMaybeSingle = async () => ({
    data: {
      workspace_id: "workspace-1",
      role: "owner",
      workspaces: {
        id: "workspace-1",
        name: "OpenPlan QA",
        plan: "starter",
      },
    },
  });

  const cyclesLimit = async () => ({
    data: [
      {
        id: "cycle-1",
        title: "2027 RTP",
        status: "draft",
        updated_at: "2026-03-28T17:30:00.000Z",
      },
    ],
  });

  const reportsOrder = async () => ({
    data: [
      {
        id: "report-1",
        rtp_cycle_id: "cycle-1",
        title: "2027 RTP Packet",
        generated_at: null,
        latest_artifact_kind: "html",
        updated_at: "2026-03-28T17:35:00.000Z",
      },
    ],
  });

  const artifactsIn = async () => ({
    data: [{ report_id: "report-1", generated_at: "2026-03-28T18:00:00.000Z" }],
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
                return {
                  order() {
                    return { limit: cyclesLimit };
                  },
                };
              },
            };
          },
        };
      }

      if (table === "reports") {
        return {
          select() {
            return {
              in() {
                return {
                  eq() {
                    return { order: reportsOrder };
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
            return {
              in: artifactsIn,
            };
          },
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

function createRtpCycleSupabaseStub() {
  const workspaceMembershipMaybeSingle = async () => ({
    data: {
      workspace_id: "workspace-1",
      role: "owner",
      workspaces: {
        id: "workspace-1",
        name: "OpenPlan QA",
        plan: "starter",
      },
    },
  });

  const cycleMaybeSingle = async () => ({
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
            return {
              in: artifactsIn,
            };
          },
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

describe("loadAssistantContext", () => {
  it("prefers the latest artifact timestamp for report assistant preview posture", async () => {
    const context = await loadAssistantContext(createSupabaseStub(), "user-1", {
      kind: "report",
      id: "report-1",
      workspaceId: null,
      runId: null,
      baselineRunId: null,
    });

    expect(context).not.toBeNull();
    expect(context?.kind).toBe("rtp_packet_report");

    if (!context || (context.kind !== "report" && context.kind !== "rtp_packet_report")) {
      throw new Error("Expected report context");
    }

    expect(context.report.generatedAt).toBe("2026-03-28T18:00:00.000Z");
    expect(context.latestArtifact?.generatedAt).toBe("2026-03-28T18:00:00.000Z");

    const preview = buildAssistantPreview(context);

    expect(preview.stats).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: "Packet", value: "Packet current" })])
    );
  });

  it("prefers latest artifact timing in RTP registry posture", async () => {
    const context = await loadAssistantContext(createRtpRegistrySupabaseStub(), "user-1", {
      kind: "rtp_registry",
      id: null,
      workspaceId: "workspace-1",
      runId: null,
      baselineRunId: null,
    });

    expect(context).not.toBeNull();
    expect(context?.kind).toBe("rtp_registry");

    if (!context || context.kind !== "rtp_registry") {
      throw new Error("Expected RTP registry context");
    }

    expect(context.counts.noPacketCount).toBe(0);
    expect(context.recommendedCycle?.packetFreshnessLabel).toBe("Packet current");

    const preview = buildAssistantPreview(context);
    expect(preview.facts).toEqual(
      expect.arrayContaining([expect.stringMatching(/Recommended cycle anchor: 2027 RTP \(Packet current\)/i)])
    );
  });

  it("prefers latest artifact timing in RTP cycle packet posture", async () => {
    const context = await loadAssistantContext(createRtpCycleSupabaseStub(), "user-1", {
      kind: "rtp_cycle",
      id: "cycle-1",
      workspaceId: "workspace-1",
      runId: null,
      baselineRunId: null,
    });

    expect(context).not.toBeNull();
    expect(context?.kind).toBe("rtp_cycle");

    if (!context || context.kind !== "rtp_cycle") {
      throw new Error("Expected RTP cycle context");
    }

    expect(context.packetSummary.noPacketCount).toBe(0);
    expect(context.packetSummary.recommendedReport?.packetFreshness.label).toBe("Packet current");

    const preview = buildAssistantPreview(context);
    expect(preview.facts).toEqual(
      expect.arrayContaining([expect.stringMatching(/Recommended packet anchor: 2027 RTP Packet \(Packet current\)/i)])
    );
  });
});
