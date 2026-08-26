import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const loadProjectAccessMock = vi.fn();
const buildProjectGeoPackageMock = vi.fn();
const audit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

vi.mock("@/lib/supabase/server", () => ({ createClient: () => createClientMock() }));
vi.mock("@/lib/programs/api", () => ({
  loadProjectAccess: (...args: unknown[]) => loadProjectAccessMock(...args),
}));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => audit }));
vi.mock("@/lib/projects/project-geopackage", () => ({
  buildProjectGeoPackage: (...args: unknown[]) => buildProjectGeoPackageMock(...args),
  projectGeoPackageFilename: () => "openplan-main-street-2026-08-26.gpkg",
}));

import { GET } from "@/app/api/projects/[projectId]/export/geopackage/route";

const USER_ID = "22222222-2222-4222-8222-222222222222";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID = "44444444-4444-4444-8444-444444444444";

function fakeClient() {
  const seen: Record<string, Array<[string, unknown]>> = { projects: [], project_corridors: [] };
  const project = {
    id: PROJECT_ID,
    workspace_id: WORKSPACE_ID,
    name: "Main Street",
    summary: null,
    status: "active",
    plan_type: "corridor_plan",
    delivery_phase: "planning",
    latitude: 40,
    longitude: -83,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-26T00:00:00Z",
  };
  return {
    seen,
    client: {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }) },
      from: (table: "projects" | "project_corridors") => {
        const filters = seen[table];
        const chain = {
          select: () => chain,
          eq: (column: string, value: unknown) => { filters.push([column, value]); return chain; },
          order: async () => ({ data: [], error: null }),
          maybeSingle: async () => ({ data: project, error: null }),
        };
        return chain;
      },
    },
  };
}

function request() {
  return new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/export/geopackage`);
}

const params = { params: Promise.resolve({ projectId: PROJECT_ID }) };

beforeEach(() => {
  vi.clearAllMocks();
  loadProjectAccessMock.mockResolvedValue({
    project: { id: PROJECT_ID, workspace_id: WORKSPACE_ID, name: "Main Street" },
    membership: { workspace_id: WORKSPACE_ID, role: "member" },
    allowed: true,
    error: null,
  });
  buildProjectGeoPackageMock.mockReturnValue({
    bytes: Buffer.from("gpkg"),
    summary: { projectAreaCount: 1, projectLocationCount: 1, corridorCount: 0, omittedCorridorCount: 0, coverageLimits: [] },
  });
});

describe("GET /api/projects/[projectId]/export/geopackage", () => {
  it("rejects a malformed project id before opening the database", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/projects/not-a-project/export/geopackage"),
      { params: Promise.resolve({ projectId: "not-a-project" }) }
    );

    expect(response.status).toBe(400);
    expect(createClientMock).not.toHaveBeenCalled();
    expect(buildProjectGeoPackageMock).not.toHaveBeenCalled();
  });

  it("scopes the project and corridor reads to the authorized workspace", async () => {
    const fake = fakeClient();
    createClientMock.mockResolvedValue(fake.client);

    const response = await GET(request(), params);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/geopackage+sqlite3");
    expect(response.headers.get("content-disposition")).toContain("openplan-main-street-2026-08-26.gpkg");
    expect(fake.seen.projects).toEqual([
      ["id", PROJECT_ID],
      ["workspace_id", WORKSPACE_ID],
    ]);
    expect(fake.seen.project_corridors).toEqual([
      ["project_id", PROJECT_ID],
      ["workspace_id", WORKSPACE_ID],
    ]);
    expect(buildProjectGeoPackageMock).toHaveBeenCalledOnce();
  });

  it("rejects cross-workspace access before reading export data", async () => {
    const fake = fakeClient();
    createClientMock.mockResolvedValue(fake.client);
    loadProjectAccessMock.mockResolvedValue({
      project: { id: PROJECT_ID, workspace_id: WORKSPACE_ID, name: "Main Street" },
      membership: null,
      allowed: false,
      error: null,
    });

    const response = await GET(request(), params);

    expect(response.status).toBe(403);
    expect(fake.seen.projects).toEqual([]);
    expect(fake.seen.project_corridors).toEqual([]);
    expect(buildProjectGeoPackageMock).not.toHaveBeenCalled();
  });
});
