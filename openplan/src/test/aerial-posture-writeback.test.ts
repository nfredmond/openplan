import { describe, expect, it, vi } from "vitest";

import { rebuildAerialProjectPosture } from "@/lib/aerial/posture-writeback";

type ProjectsUpdateValues = {
  aerial_posture: {
    missionCount: number;
    activeMissionCount: number;
    completeMissionCount: number;
    readyPackageCount: number;
    verificationReadiness: "none" | "pending" | "partial" | "ready";
  };
  aerial_posture_updated_at: string;
};

function buildSupabase({
  missions,
  packages,
  updateError,
}: {
  missions: Array<{ id: string; status: string }>;
  packages: Array<{ status: string; verification_readiness: string }>;
  updateError?: { message: string; code?: string } | null;
}) {
  const capturedUpdate: { values?: ProjectsUpdateValues; where: Array<[string, string]> } = {
    values: undefined,
    where: [],
  };

  const from = vi.fn((table: string) => {
    if (table === "aerial_missions") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn((col1: string, val1: string) => ({
            eq: vi.fn(async (col2: string, val2: string) => {
              void col1;
              void val1;
              void col2;
              void val2;
              return { data: missions, error: null };
            }),
          })),
        })),
      };
    }

    if (table === "aerial_evidence_packages") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn((col: string, val: string) => ({
            in: vi.fn(async (col2: string, ids: string[]) => {
              void col;
              void val;
              void col2;
              void ids;
              return { data: packages, error: null };
            }),
          })),
        })),
      };
    }

    if (table === "projects") {
      return {
        update: vi.fn((values: ProjectsUpdateValues) => {
          capturedUpdate.values = values;
          return {
            eq: vi.fn((col1: string, val1: string) => {
              capturedUpdate.where.push([col1, val1]);
              return {
                eq: vi.fn(async (col2: string, val2: string) => {
                  capturedUpdate.where.push([col2, val2]);
                  return { error: updateError ?? null };
                }),
              };
            }),
          };
        }),
      };
    }

    throw new Error(`Unexpected table: ${table}`);
  });

  return {
    supabase: { from } as unknown as Parameters<typeof rebuildAerialProjectPosture>[0]["supabase"],
    capturedUpdate,
  };
}

describe("rebuildAerialProjectPosture", () => {
  it("computes posture from missions + packages and writes it to projects", async () => {
    const { supabase, capturedUpdate } = buildSupabase({
      missions: [
        { id: "m1", status: "complete" },
        { id: "m2", status: "active" },
      ],
      packages: [
        { status: "ready", verification_readiness: "ready" },
        { status: "shared", verification_readiness: "ready" },
        { status: "qa_pending", verification_readiness: "pending" },
      ],
    });

    const now = new Date("2026-04-16T14:30:00.000Z");
    const result = await rebuildAerialProjectPosture({
      supabase,
      projectId: "project-1",
      workspaceId: "workspace-1",
      now: () => now,
    });

    expect(result.error).toBeNull();
    expect(result.posture).toEqual({
      missionCount: 2,
      activeMissionCount: 1,
      completeMissionCount: 1,
      readyPackageCount: 2,
      verificationReadiness: "partial",
    });
    expect(result.updatedAt).toBe("2026-04-16T14:30:00.000Z");
    expect(capturedUpdate.values).toEqual({
      aerial_posture: {
        missionCount: 2,
        activeMissionCount: 1,
        completeMissionCount: 1,
        readyPackageCount: 2,
        verificationReadiness: "partial",
      },
      aerial_posture_updated_at: "2026-04-16T14:30:00.000Z",
    });
    expect(capturedUpdate.where).toEqual([
      ["id", "project-1"],
      ["workspace_id", "workspace-1"],
    ]);
  });

  it("writes a zero posture when the project has no missions", async () => {
    const { supabase, capturedUpdate } = buildSupabase({
      missions: [],
      packages: [],
    });

    const result = await rebuildAerialProjectPosture({
      supabase,
      projectId: "project-1",
      workspaceId: "workspace-1",
      now: () => new Date("2026-04-16T00:00:00.000Z"),
    });

    expect(result.error).toBeNull();
    expect(result.posture).toEqual({
      missionCount: 0,
      activeMissionCount: 0,
      completeMissionCount: 0,
      readyPackageCount: 0,
      verificationReadiness: "none",
    });
    expect(capturedUpdate.values?.aerial_posture.missionCount).toBe(0);
    expect(capturedUpdate.values?.aerial_posture.verificationReadiness).toBe("none");
  });

  it("surfaces the update error when the projects write fails", async () => {
    const { supabase } = buildSupabase({
      missions: [{ id: "m1", status: "complete" }],
      packages: [{ status: "ready", verification_readiness: "ready" }],
      updateError: { message: "permission denied", code: "42501" },
    });

    const result = await rebuildAerialProjectPosture({
      supabase,
      projectId: "project-1",
      workspaceId: "workspace-1",
    });

    expect(result.error).toEqual({ message: "permission denied", code: "42501" });
    expect(result.posture).not.toBeNull();
    expect(result.updatedAt).toBeNull();
  });
});
