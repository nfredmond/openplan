import { describe, expect, it, vi } from "vitest";

import {
  loadPlanningContext,
  planningProjectId,
  resolvePlanningContext,
  selectInitialPlanningProjectId,
  withPlanningContext,
  type PlanningContextSupabaseLike,
} from "@/lib/projects/planning-context";

function client(result: { data: { id: string; name: string | null } | null; error: { message: string } | null }) {
  const maybeSingle = vi.fn(async () => result);
  const eqId = vi.fn(() => ({ maybeSingle }));
  const eqWorkspace = vi.fn(() => ({ eq: eqId }));
  const select = vi.fn(() => ({ eq: eqWorkspace }));
  const from = vi.fn(() => ({ select }));
  return {
    supabase: { from } as unknown as PlanningContextSupabaseLike,
    from,
    select,
    eqWorkspace,
    eqId,
  };
}

describe("planning context", () => {
  it("normalizes repeatable project parameters without inventing a fallback", () => {
    expect(planningProjectId(["  project-1 ", "project-2"])).toBe("project-1");
    expect(planningProjectId("   ")).toBeNull();
    expect(planningProjectId(undefined)).toBeNull();
  });

  it("resolves the exact project through both workspace and id predicates", async () => {
    const fake = client({ data: { id: "project-1", name: " Main Street " }, error: null });

    await expect(loadPlanningContext(fake.supabase, "workspace-1", "project-1")).resolves.toEqual({
      status: "active",
      requestedProjectId: "project-1",
      project: { id: "project-1", name: "Main Street" },
    });
    expect(fake.from).toHaveBeenCalledWith("projects");
    expect(fake.select).toHaveBeenCalledWith("id, name");
    expect(fake.eqWorkspace).toHaveBeenCalledWith("workspace_id", "workspace-1");
    expect(fake.eqId).toHaveBeenCalledWith("id", "project-1");
  });

  it("rejects a missing or cross-workspace id without revealing which it was", async () => {
    const fake = client({ data: null, error: null });
    await expect(loadPlanningContext(fake.supabase, "workspace-1", "foreign-project")).resolves.toEqual({
      status: "rejected",
      requestedProjectId: "foreign-project",
      project: null,
    });
  });

  it("rejects a resolver row that does not match the requested project", () => {
    expect(resolvePlanningContext("project-1", { id: "project-2", name: "Other work" })).toEqual({
      status: "rejected",
      requestedProjectId: "project-1",
      project: null,
    });
  });

  it("keeps a failed read distinct from a rejected id", async () => {
    const fake = client({ data: null, error: { message: "connection lost" } });
    await expect(loadPlanningContext(fake.supabase, "workspace-1", "project-1")).resolves.toEqual({
      status: "unreadable",
      requestedProjectId: "project-1",
      project: null,
    });
  });

  it("preselects only a project present in the workspace-scoped creator list", () => {
    const projects = [{ id: "project-1" }, { id: "project-2" }];
    expect(selectInitialPlanningProjectId(projects, "project-2", "first")).toBe("project-2");
    expect(selectInitialPlanningProjectId(projects, "foreign-project", "first")).toBe("project-1");
    expect(selectInitialPlanningProjectId(projects, "foreign-project", "none")).toBe("");
  });

  it("preserves filters and fragments when adding project context", () => {
    expect(withPlanningContext("/models?status=approved#runs", "project 1")).toBe(
      "/models?status=approved&projectId=project+1#runs",
    );
    expect(
      withPlanningContext("/grants#awards", "project-1", { parameter: "focusProjectId" }),
    ).toBe("/grants?focusProjectId=project-1#awards");
  });
});
