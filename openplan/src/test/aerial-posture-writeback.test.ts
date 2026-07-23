import { describe, expect, it, vi } from "vitest";

import { rebuildAerialProjectPosture } from "@/lib/aerial/posture-writeback";

type AerialPostureUpsertValues = {
  project_id: string;
  workspace_id: string;
  posture: {
    missionCount: number;
    activeMissionCount: number;
    completeMissionCount: number;
    readyPackageCount: number;
    verificationReadiness: "none" | "pending" | "partial" | "ready";
  };
  updated_at: string;
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
  const capturedUpsert: { values?: AerialPostureUpsertValues; options?: { onConflict?: string } } = {
    values: undefined,
    options: undefined,
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

    // Posture is written to the aerial-owned table via upsert (keyed on project_id),
    // NOT to a column on `projects`.
    if (table === "aerial_project_posture") {
      return {
        upsert: vi.fn(async (values: AerialPostureUpsertValues, options?: { onConflict?: string }) => {
          capturedUpsert.values = values;
          capturedUpsert.options = options;
          return { error: updateError ?? null };
        }),
      };
    }

    throw new Error(`Unexpected table: ${table}`);
  });

  return {
    supabase: { from } as unknown as Parameters<typeof rebuildAerialProjectPosture>[0]["supabase"],
    capturedUpsert,
  };
}

describe("rebuildAerialProjectPosture", () => {
  it("computes posture from missions + packages and upserts it to aerial_project_posture", async () => {
    const { supabase, capturedUpsert } = buildSupabase({
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
    expect(capturedUpsert.values).toEqual({
      project_id: "project-1",
      workspace_id: "workspace-1",
      posture: {
        missionCount: 2,
        activeMissionCount: 1,
        completeMissionCount: 1,
        readyPackageCount: 2,
        verificationReadiness: "partial",
      },
      updated_at: "2026-04-16T14:30:00.000Z",
    });
    expect(capturedUpsert.options).toEqual({ onConflict: "project_id" });
  });

  it("writes a zero posture when the project has no missions", async () => {
    const { supabase, capturedUpsert } = buildSupabase({
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
    expect(capturedUpsert.values?.project_id).toBe("project-1");
    expect(capturedUpsert.values?.workspace_id).toBe("workspace-1");
    expect(capturedUpsert.values?.posture.missionCount).toBe(0);
    expect(capturedUpsert.values?.posture.verificationReadiness).toBe("none");
  });

  it("surfaces the upsert error when the posture write fails", async () => {
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
