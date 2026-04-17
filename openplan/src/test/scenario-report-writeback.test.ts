import { describe, expect, it, vi } from "vitest";
import {
  markScenarioLinkedReportsBasisStale,
  touchScenarioLinkedReportPackets,
  type ScenarioReportWritebackSupabaseLike,
} from "@/lib/reports/scenario-writeback";

describe("touchScenarioLinkedReportPackets", () => {
  it("touches reports linked to runs from the changed scenario set", async () => {
    const entriesEqMock = vi.fn().mockResolvedValue({
      data: [
        { attached_run_id: "run-1" },
        { attached_run_id: "run-2" },
        { attached_run_id: "run-1" },
        { attached_run_id: null },
      ],
      error: null,
    });
    const reportRunsInMock = vi.fn().mockResolvedValue({
      data: [
        { report_id: "report-1" },
        { report_id: "report-2" },
        { report_id: "report-1" },
      ],
      error: null,
    });
    const reportsEqMock = vi.fn().mockResolvedValue({ error: null });
    const reportsInMock = vi.fn(() => ({ eq: reportsEqMock }));
    const reportsUpdateMock = vi.fn(() => ({ in: reportsInMock }));

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "scenario_entries") {
          return {
            select: vi.fn(() => ({ eq: entriesEqMock })),
            update: vi.fn(),
          };
        }
        if (table === "report_runs") {
          return {
            select: vi.fn(() => ({ in: reportRunsInMock })),
            update: vi.fn(),
          };
        }
        if (table === "reports") {
          return {
            select: vi.fn(),
            update: reportsUpdateMock,
          };
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    };

    const result = await touchScenarioLinkedReportPackets({
      supabase: supabase as unknown as ScenarioReportWritebackSupabaseLike,
      scenarioSetId: "scenario-set-1",
      workspaceId: "workspace-1",
      touchedAt: "2026-04-14T10:00:00.000Z",
    });

    expect(result).toEqual({ touchedReportIds: ["report-1", "report-2"], error: null });
    expect(entriesEqMock).toHaveBeenCalledWith("scenario_set_id", "scenario-set-1");
    expect(reportRunsInMock).toHaveBeenCalledWith("run_id", ["run-1", "run-2"]);
    expect(reportsUpdateMock).toHaveBeenCalledWith({ updated_at: "2026-04-14T10:00:00.000Z" });
    expect(reportsInMock).toHaveBeenCalledWith("id", ["report-1", "report-2"]);
    expect(reportsEqMock).toHaveBeenCalledWith("workspace_id", "workspace-1");
  });

  it("does not touch reports when no scenario entries have attached runs", async () => {
    const reportsUpdateMock = vi.fn();
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "scenario_entries") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockResolvedValue({
                data: [{ attached_run_id: null }],
                error: null,
              }),
            })),
            update: vi.fn(),
          };
        }
        if (table === "reports") {
          return {
            select: vi.fn(),
            update: reportsUpdateMock,
          };
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    };

    const result = await touchScenarioLinkedReportPackets({
      supabase: supabase as unknown as ScenarioReportWritebackSupabaseLike,
      scenarioSetId: "scenario-set-1",
      workspaceId: "workspace-1",
    });

    expect(result).toEqual({ touchedReportIds: [], error: null });
    expect(reportsUpdateMock).not.toHaveBeenCalled();
  });
});

describe("markScenarioLinkedReportsBasisStale", () => {
  it("marks linked reports stale with the run id, reason, and timestamp", async () => {
    const entriesEqMock = vi.fn().mockResolvedValue({
      data: [
        { attached_run_id: "run-1" },
        { attached_run_id: "run-2" },
        { attached_run_id: null },
      ],
      error: null,
    });
    const reportRunsInMock = vi.fn().mockResolvedValue({
      data: [{ report_id: "report-1" }, { report_id: "report-2" }],
      error: null,
    });
    const reportsEqMock = vi.fn().mockResolvedValue({ error: null });
    const reportsInMock = vi.fn(() => ({ eq: reportsEqMock }));
    const reportsUpdateMock = vi.fn(() => ({ in: reportsInMock }));

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "scenario_entries") {
          return {
            select: vi.fn(() => ({ eq: entriesEqMock })),
            update: vi.fn(),
          };
        }
        if (table === "report_runs") {
          return {
            select: vi.fn(() => ({ in: reportRunsInMock })),
            update: vi.fn(),
          };
        }
        if (table === "reports") {
          return {
            select: vi.fn(),
            update: reportsUpdateMock,
          };
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    };

    const result = await markScenarioLinkedReportsBasisStale({
      supabase: supabase as unknown as ScenarioReportWritebackSupabaseLike,
      scenarioSetId: "scenario-set-1",
      workspaceId: "workspace-1",
      runId: "model-run-7",
      reason: "Linked model run Corridor Refresh succeeded",
      markedAt: "2026-04-16T12:00:00.000Z",
    });

    expect(result).toEqual({ staleReportIds: ["report-1", "report-2"], error: null });
    expect(reportsUpdateMock).toHaveBeenCalledWith({
      rtp_basis_stale: true,
      rtp_basis_stale_reason: "Linked model run Corridor Refresh succeeded",
      rtp_basis_stale_run_id: "model-run-7",
      rtp_basis_stale_marked_at: "2026-04-16T12:00:00.000Z",
      updated_at: "2026-04-16T12:00:00.000Z",
    });
    expect(reportsInMock).toHaveBeenCalledWith("id", ["report-1", "report-2"]);
    expect(reportsEqMock).toHaveBeenCalledWith("workspace_id", "workspace-1");
  });

  it("returns no stale reports when scenario entries have no attached runs", async () => {
    const reportsUpdateMock = vi.fn();
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "scenario_entries") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockResolvedValue({
                data: [{ attached_run_id: null }],
                error: null,
              }),
            })),
            update: vi.fn(),
          };
        }
        if (table === "reports") {
          return {
            select: vi.fn(),
            update: reportsUpdateMock,
          };
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    };

    const result = await markScenarioLinkedReportsBasisStale({
      supabase: supabase as unknown as ScenarioReportWritebackSupabaseLike,
      scenarioSetId: "scenario-set-1",
      workspaceId: "workspace-1",
      runId: "model-run-7",
      reason: "Linked model run Corridor Refresh succeeded",
    });

    expect(result).toEqual({ staleReportIds: [], error: null });
    expect(reportsUpdateMock).not.toHaveBeenCalled();
  });
});
