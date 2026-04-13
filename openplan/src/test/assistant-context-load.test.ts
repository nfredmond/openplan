import { describe, expect, it } from "vitest";
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
});
