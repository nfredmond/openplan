import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const authGetUserMock = vi.fn();
const fromMock = vi.fn();
const loadProjectAccessMock = vi.fn();

const mockAudit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: authGetUserMock }, from: fromMock }),
  createServiceRoleClient: () => {
    throw new Error("the project record route must not use the service-role client");
  },
}));

vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => mockAudit }));

vi.mock("@/lib/programs/api", () => ({
  loadProjectAccess: (...args: unknown[]) => loadProjectAccessMock(...args),
}));

import { DELETE as deleteProject, PATCH as patchProject } from "@/app/api/projects/[projectId]/route";
import { PROJECT_DELETE_RELATIONS } from "@/lib/projects/project-delete-preconditions";

const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";

const params = { params: Promise.resolve({ projectId: PROJECT_ID }) };

function patchRequest(payload: unknown) {
  return new NextRequest(`http://localhost/api/projects/${PROJECT_ID}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function deleteRequest() {
  return new NextRequest(`http://localhost/api/projects/${PROJECT_ID}`, { method: "DELETE" });
}

/** Counts returned for every relation, overridable per table. */
function withCounts(counts: Record<string, number>, options: { failing?: string[] } = {}) {
  fromMock.mockImplementation((table: string) => {
    if (table === "projects") {
      return {
        update: () => ({
          eq: () => ({
            select: () => ({
              single: async () => ({
                data: {
                  id: PROJECT_ID,
                  name: "Renamed",
                  summary: null,
                  status: "active",
                  plan_type: "corridor_plan",
                  delivery_phase: "scoping",
                  updated_at: "2026-07-28T00:00:00Z",
                },
                error: null,
              }),
            }),
          }),
        }),
        delete: () => ({ eq: async () => ({ error: null }) }),
      };
    }

    return {
      select: () => ({
        eq: async () =>
          options.failing?.includes(table)
            ? { count: null, error: { message: "relation does not exist", code: "42P01" } }
            : { count: counts[table] ?? 0, error: null },
      }),
    };
  });
}

describe("project record route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    loadProjectAccessMock.mockResolvedValue({
      project: { id: PROJECT_ID, workspace_id: WORKSPACE_ID, name: "Main Street Corridor" },
      membership: { workspace_id: WORKSPACE_ID, role: "member" },
      allowed: true,
      error: null,
    });
    withCounts({});
  });

  describe("PATCH", () => {
    it("renames a project", async () => {
      const response = await patchProject(patchRequest({ name: "Renamed" }), params);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ project: { id: PROJECT_ID } });
    });

    it("gates on the project access matrix", async () => {
      loadProjectAccessMock.mockResolvedValue({
        project: { id: PROJECT_ID, workspace_id: WORKSPACE_ID },
        membership: { workspace_id: WORKSPACE_ID, role: "viewer" },
        allowed: false,
        error: null,
      });

      const response = await patchProject(patchRequest({ name: "Renamed" }), params);
      expect(response.status).toBe(403);
    });

    it("401s an anonymous caller", async () => {
      authGetUserMock.mockResolvedValue({ data: { user: null } });
      const response = await patchProject(patchRequest({ name: "Renamed" }), params);
      expect(response.status).toBe(401);
    });

    it("404s a project that is not visible", async () => {
      loadProjectAccessMock.mockResolvedValue({ project: null, membership: null, allowed: false, error: null });
      const response = await patchProject(patchRequest({ name: "Renamed" }), params);
      expect(response.status).toBe(404);
    });

    it("refuses an empty patch instead of reporting a silent no-op", async () => {
      const response = await patchProject(patchRequest({}), params);
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: expect.stringContaining("at least one field"),
      });
    });

    it("rejects a status outside the vocabulary with a 400, not a database error", async () => {
      const response = await patchProject(patchRequest({ status: "archived" }), params);
      expect(response.status).toBe(400);
    });

    it("accepts clearing the summary but not clearing a vocabulary field", async () => {
      expect((await patchProject(patchRequest({ summary: null }), params)).status).toBe(200);
      expect((await patchProject(patchRequest({ status: null }), params)).status).toBe(400);
    });
  });

  describe("DELETE", () => {
    it("deletes a project that carries nothing", async () => {
      const response = await deleteProject(deleteRequest(), params);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ deleted: { id: PROJECT_ID } });
    });

    it("refuses a project that carries work, and names it", async () => {
      withCounts({ reports: 2, model_runs: 1 });

      const response = await deleteProject(deleteRequest(), params);
      expect(response.status).toBe(409);

      const body = (await response.json()) as {
        blockers: Array<{ table: string; count: number; href: string }>;
        alternative: string;
      };
      expect(body.blockers.map((blocker) => blocker.table)).toEqual(["reports", "model_runs"]);
      expect(body.alternative).toContain("status to complete");
    });

    it("refuses hardest when a funder-facing invoice is attached", async () => {
      withCounts({ billing_invoice_records: 1 });

      const response = await deleteProject(deleteRequest(), params);
      expect(response.status).toBe(409);

      const body = (await response.json()) as {
        headline: string;
        blockers: Array<{ severity: string }>;
      };
      expect(body.blockers[0]?.severity).toBe("blocking");
      expect(body.headline).toContain("meant to outlive");
    });

    it("refuses rather than guesses when a relation cannot be counted", async () => {
      // A table the caller cannot read is not a table that is empty. Deleting on
      // an incomplete count is how work disappears without anyone being told.
      withCounts({}, { failing: ["reports"] });

      const response = await deleteProject(deleteRequest(), params);
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({ unreadable: ["reports"] });
    });

    it("counts every known relation before allowing a delete", async () => {
      const counted: string[] = [];
      fromMock.mockImplementation((table: string) => {
        if (table === "projects") return { delete: () => ({ eq: async () => ({ error: null }) }) };
        counted.push(table);
        return { select: () => ({ eq: async () => ({ count: 0, error: null }) }) };
      });

      await deleteProject(deleteRequest(), params);

      expect(counted.sort()).toEqual(PROJECT_DELETE_RELATIONS.map((r) => r.table).sort());
    });

    it("gates deletion on the same write action as editing", async () => {
      loadProjectAccessMock.mockResolvedValue({
        project: { id: PROJECT_ID, workspace_id: WORKSPACE_ID },
        membership: { workspace_id: WORKSPACE_ID, role: "viewer" },
        allowed: false,
        error: null,
      });

      const response = await deleteProject(deleteRequest(), params);
      expect(response.status).toBe(403);
      expect(loadProjectAccessMock).toHaveBeenCalledWith(
        expect.anything(),
        PROJECT_ID,
        USER_ID,
        "programs.write"
      );
    });
  });
});
