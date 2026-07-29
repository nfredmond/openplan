import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The write paths for the cartographic backdrop.
 *
 * Three of the six backdrop layers used to be unreachable: `projects.latitude/
 * longitude`, `rtp_cycles.anchor_latitude/_longitude`, and `project_corridors`
 * were read by the map and written by nothing but a demo seed. These routes are
 * that missing half, so the tests below are mostly about the ways a write can
 * appear to succeed while leaving the map empty or wrong.
 */

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();
const loadProjectAccessMock = vi.fn();

const PROJECT_ID = "44444444-4444-4444-8444-444444444444";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const CORRIDOR_ID = "55555555-5555-4555-8555-555555555555";
const USER_ID = "22222222-2222-4222-8222-222222222222";

const mockAudit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
  createServiceRoleClient: vi.fn(),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

vi.mock("@/lib/programs/api", () => ({
  loadProjectAccess: (...args: unknown[]) => loadProjectAccessMock(...args),
}));

import { PATCH as patchLocation } from "@/app/api/projects/[projectId]/location/route";
import { POST as createCorridor } from "@/app/api/projects/[projectId]/corridors/route";
import {
  DELETE as deleteCorridor,
  PATCH as patchCorridor,
} from "@/app/api/projects/[projectId]/corridors/[corridorId]/route";

const LINE = { type: "LineString", coordinates: [[-83.1, 39.9], [-83.0, 40.0]] };

/** A minimal chainable Supabase double for the calls these routes make. */
function buildSupabase(overrides: {
  projectUpdateResult?: { data: unknown; error: unknown };
  corridorInsertResult?: { data: unknown; error: unknown };
  corridorLookupResult?: { data: unknown; error: unknown };
  corridorUpdateResult?: { data: unknown; error: unknown };
  corridorDeleteResult?: { error: unknown };
}) {
  const projectUpdateSpy = vi.fn();
  const corridorInsertSpy = vi.fn();
  const corridorUpdateSpy = vi.fn();
  const corridorDeleteEqSpy = vi.fn();
  const corridorLookupEqSpies: Array<[string, unknown]> = [];

  const client = {
    auth: { getUser: authGetUserMock },
    from: vi.fn((table: string) => {
      if (table === "projects") {
        return {
          update: (payload: unknown) => {
            projectUpdateSpy(payload);
            return {
              eq: () => ({
                select: () => ({
                  single: async () =>
                    overrides.projectUpdateResult ?? {
                      data: { id: PROJECT_ID, latitude: 39.9, longitude: -83.0, updated_at: "2026-07-28T00:00:00Z" },
                      error: null,
                    },
                }),
              }),
            };
          },
        };
      }

      if (table === "project_corridors") {
        return {
          insert: (payload: unknown) => {
            corridorInsertSpy(payload);
            return {
              select: () => ({
                single: async () =>
                  overrides.corridorInsertResult ?? {
                    data: {
                      id: CORRIDOR_ID,
                      workspace_id: WORKSPACE_ID,
                      project_id: PROJECT_ID,
                      name: "Main Street",
                      corridor_type: "arterial",
                      los_grade: "D",
                      geometry_geojson: LINE,
                      created_at: "2026-07-28T00:00:00Z",
                      updated_at: "2026-07-28T00:00:00Z",
                    },
                    error: null,
                  },
              }),
            };
          },
          update: (payload: unknown) => {
            corridorUpdateSpy(payload);
            return {
              eq: () => ({
                select: () => ({
                  single: async () =>
                    overrides.corridorUpdateResult ?? {
                      data: {
                        id: CORRIDOR_ID,
                        workspace_id: WORKSPACE_ID,
                        project_id: PROJECT_ID,
                        name: "Main Street",
                        corridor_type: "arterial",
                        los_grade: "C",
                        geometry_geojson: LINE,
                        created_at: "2026-07-28T00:00:00Z",
                        updated_at: "2026-07-28T01:00:00Z",
                      },
                      error: null,
                    },
                }),
              }),
            };
          },
          select: () => {
            const chain = {
              eq: (column: string, value: unknown) => {
                corridorLookupEqSpies.push([column, value]);
                return chain;
              },
              maybeSingle: async () =>
                overrides.corridorLookupResult ?? {
                  data: {
                    id: CORRIDOR_ID,
                    workspace_id: WORKSPACE_ID,
                    project_id: PROJECT_ID,
                    name: "Main Street",
                    corridor_type: "arterial",
                    los_grade: "D",
                    geometry_geojson: LINE,
                    created_at: "2026-07-28T00:00:00Z",
                    updated_at: "2026-07-28T00:00:00Z",
                  },
                  error: null,
                },
            };
            return chain;
          },
          delete: () => ({
            eq: async (column: string, value: unknown) => {
              corridorDeleteEqSpy(column, value);
              return overrides.corridorDeleteResult ?? { error: null };
            },
          }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
  };

  return {
    client,
    projectUpdateSpy,
    corridorInsertSpy,
    corridorUpdateSpy,
    corridorDeleteEqSpy,
    corridorLookupEqSpies,
  };
}

function locationRequest(body: unknown) {
  return new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/location`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function corridorRequest(body: unknown) {
  return new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/corridors`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function corridorPatchRequest(body: unknown) {
  return new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/corridors/${CORRIDOR_ID}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const projectParams = { params: Promise.resolve({ projectId: PROJECT_ID }) };
const corridorParams = { params: Promise.resolve({ projectId: PROJECT_ID, corridorId: CORRIDOR_ID }) };

beforeEach(() => {
  vi.clearAllMocks();
  createApiAuditLoggerMock.mockReturnValue(mockAudit);
  authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
  loadProjectAccessMock.mockResolvedValue({
    supabase: null,
    project: { id: PROJECT_ID, workspace_id: WORKSPACE_ID },
    membership: { workspace_id: WORKSPACE_ID, role: "member" },
    error: null,
    allowed: true,
  });
});

describe("PATCH /api/projects/[projectId]/location", () => {
  it("writes both coordinates so the project appears on the backdrop", async () => {
    const { client, projectUpdateSpy } = buildSupabase({});
    createClientMock.mockResolvedValue(client);

    const response = await patchLocation(locationRequest({ latitude: 39.9612, longitude: -82.9988 }), projectParams);

    expect(response.status).toBe(200);
    expect(projectUpdateSpy).toHaveBeenCalledWith({ latitude: 39.9612, longitude: -82.9988 });
  });

  it("clears the location when both are null", async () => {
    const { client, projectUpdateSpy } = buildSupabase({
      projectUpdateResult: {
        data: { id: PROJECT_ID, latitude: null, longitude: null, updated_at: "2026-07-28T00:00:00Z" },
        error: null,
      },
    });
    createClientMock.mockResolvedValue(client);

    const response = await patchLocation(locationRequest({ latitude: null, longitude: null }), projectParams);

    expect(response.status).toBe(200);
    expect(projectUpdateSpy).toHaveBeenCalledWith({ latitude: null, longitude: null });
  });

  /**
   * Half a coordinate pair is the quiet failure this route exists to prevent:
   * the map-features route requires BOTH to be non-null, so a lone latitude
   * saves cleanly and renders nothing, with no error anywhere.
   */
  it("rejects one coordinate without the other", async () => {
    const { client, projectUpdateSpy } = buildSupabase({});
    createClientMock.mockResolvedValue(client);

    for (const body of [{ latitude: 39.9, longitude: null }, { latitude: null, longitude: -83.0 }]) {
      const response = await patchLocation(locationRequest(body), projectParams);
      expect(response.status).toBe(400);
    }
    expect(projectUpdateSpy).not.toHaveBeenCalled();
  });

  it("rejects coordinates outside WGS84 bounds rather than letting Postgres 500", async () => {
    const { client, projectUpdateSpy } = buildSupabase({});
    createClientMock.mockResolvedValue(client);

    for (const body of [{ latitude: 91, longitude: 0 }, { latitude: 0, longitude: 181 }]) {
      const response = await patchLocation(locationRequest(body), projectParams);
      expect(response.status).toBe(400);
    }
    expect(projectUpdateSpy).not.toHaveBeenCalled();
  });

  it("refuses a caller with read-only access", async () => {
    loadProjectAccessMock.mockResolvedValue({
      supabase: null,
      project: { id: PROJECT_ID, workspace_id: WORKSPACE_ID },
      membership: { workspace_id: WORKSPACE_ID, role: "viewer" },
      error: null,
      allowed: false,
    });
    const { client, projectUpdateSpy } = buildSupabase({});
    createClientMock.mockResolvedValue(client);

    const response = await patchLocation(locationRequest({ latitude: 39.9, longitude: -83.0 }), projectParams);

    expect(response.status).toBe(403);
    expect(projectUpdateSpy).not.toHaveBeenCalled();
  });

  it("401s an unauthenticated caller", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null } });
    const { client } = buildSupabase({});
    createClientMock.mockResolvedValue(client);

    const response = await patchLocation(locationRequest({ latitude: 39.9, longitude: -83.0 }), projectParams);
    expect(response.status).toBe(401);
  });

  /**
   * PGRST116 is PostgREST saying the UPDATE matched no rows — an outcome, not a
   * server fault. `loadProjectAccess` read this project through the caller's own
   * client a moment earlier, so the refusal came from below the application and
   * the response says so instead of "Failed to update project location".
   */
  it("names the refused write when the update matched no rows", async () => {
    const { client } = buildSupabase({
      projectUpdateResult: { data: null, error: { code: "PGRST116", message: "no rows returned" } },
    });
    createClientMock.mockResolvedValue(client);

    const response = await patchLocation(locationRequest({ latitude: 39.9, longitude: -83.0 }), projectParams);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ error: "The project location was not saved" });
    expect(mockAudit.error).toHaveBeenCalledWith(
      "project_location_update_matched_no_rows",
      expect.objectContaining({ projectId: PROJECT_ID, workspaceId: WORKSPACE_ID })
    );
  });
});

describe("POST /api/projects/[projectId]/corridors", () => {
  it("creates a corridor and inherits the project's workspace", async () => {
    const { client, corridorInsertSpy } = buildSupabase({});
    createClientMock.mockResolvedValue(client);

    const response = await createCorridor(
      corridorRequest({ name: "Main Street", corridorType: "arterial", losGrade: "D", geometry: LINE }),
      projectParams
    );

    expect(response.status).toBe(201);
    expect(corridorInsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: WORKSPACE_ID,
        project_id: PROJECT_ID,
        name: "Main Street",
        corridor_type: "arterial",
        los_grade: "D",
        geometry_geojson: LINE,
      })
    );
  });

  it("defaults the type and leaves LOS ungraded", async () => {
    const { client, corridorInsertSpy } = buildSupabase({});
    createClientMock.mockResolvedValue(client);

    await createCorridor(corridorRequest({ name: "Unnamed route", geometry: LINE }), projectParams);

    expect(corridorInsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ corridor_type: "arterial", los_grade: null })
    );
  });

  /**
   * The read route and the backdrop both drop geometry that fails
   * `isCorridorLineGeoJson`. If this route accepted a shape they reject, the
   * corridor would save, return 201, and never appear — the worst outcome,
   * because nothing reports it.
   */
  it("rejects geometry the map would silently refuse to draw", async () => {
    const { client, corridorInsertSpy } = buildSupabase({});
    createClientMock.mockResolvedValue(client);

    const badGeometries = [
      { type: "Point", coordinates: [-83, 39] },
      { type: "Polygon", coordinates: [[[-83, 39], [-83, 40], [-82, 40], [-83, 39]]] },
      { type: "LineString", coordinates: [[-83, 39]] },
      { type: "LineString", coordinates: [[-83, 39], [-200, 40]] },
      { type: "LineString", coordinates: "nope" },
    ];

    for (const geometry of badGeometries) {
      const response = await createCorridor(corridorRequest({ name: "Bad", geometry }), projectParams);
      expect(response.status, JSON.stringify(geometry)).toBe(400);
    }
    expect(corridorInsertSpy).not.toHaveBeenCalled();
  });

  it("rejects a corridor type or LOS grade the database CHECK would refuse", async () => {
    const { client, corridorInsertSpy } = buildSupabase({});
    createClientMock.mockResolvedValue(client);

    const badType = await createCorridor(
      corridorRequest({ name: "X", corridorType: "monorail", geometry: LINE }),
      projectParams
    );
    expect(badType.status).toBe(400);

    const badGrade = await createCorridor(
      corridorRequest({ name: "X", losGrade: "G", geometry: LINE }),
      projectParams
    );
    expect(badGrade.status).toBe(400);
    expect(corridorInsertSpy).not.toHaveBeenCalled();
  });

  it("caps vertices so a client cannot push unbounded geometry into jsonb", async () => {
    const { client, corridorInsertSpy } = buildSupabase({});
    createClientMock.mockResolvedValue(client);

    const huge = {
      type: "LineString",
      coordinates: Array.from({ length: 201 }, (_, index) => [-83 + index / 1000, 39]),
    };
    const response = await createCorridor(corridorRequest({ name: "Long", geometry: huge }), projectParams);

    expect(response.status).toBe(400);
    expect(corridorInsertSpy).not.toHaveBeenCalled();
  });

  it("refuses a caller with read-only access", async () => {
    loadProjectAccessMock.mockResolvedValue({
      supabase: null,
      project: { id: PROJECT_ID, workspace_id: WORKSPACE_ID },
      membership: { workspace_id: WORKSPACE_ID, role: "viewer" },
      error: null,
      allowed: false,
    });
    const { client, corridorInsertSpy } = buildSupabase({});
    createClientMock.mockResolvedValue(client);

    const response = await createCorridor(corridorRequest({ name: "X", geometry: LINE }), projectParams);

    expect(response.status).toBe(403);
    expect(corridorInsertSpy).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/projects/[projectId]/corridors/[corridorId]", () => {
  it("edits a corridor that belongs to the project", async () => {
    const { client, corridorUpdateSpy } = buildSupabase({});
    createClientMock.mockResolvedValue(client);

    const response = await patchCorridor(corridorPatchRequest({ losGrade: "C" }), corridorParams);

    expect(response.status).toBe(200);
    expect(corridorUpdateSpy).toHaveBeenCalledWith(expect.objectContaining({ los_grade: "C" }));
  });

  /**
   * The lookup in `resolveCorridorContext` read this corridor row itself through
   * the caller's client, so a write that then matches nothing is a refusal below
   * the application — reported as such rather than as "Failed to update corridor".
   */
  it("names the refused write when the update matched no rows", async () => {
    const { client } = buildSupabase({
      corridorUpdateResult: { data: null, error: { code: "PGRST116", message: "no rows returned" } },
    });
    createClientMock.mockResolvedValue(client);

    const response = await patchCorridor(corridorPatchRequest({ losGrade: "C" }), corridorParams);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ error: "The corridor was not saved" });
    expect(mockAudit.error).toHaveBeenCalledWith(
      "project_corridor_update_matched_no_rows",
      expect.objectContaining({ corridorId: CORRIDOR_ID, projectId: PROJECT_ID })
    );
  });
});

describe("DELETE /api/projects/[projectId]/corridors/[corridorId]", () => {
  it("deletes a corridor that belongs to the project", async () => {
    const { client, corridorDeleteEqSpy } = buildSupabase({});
    createClientMock.mockResolvedValue(client);

    const response = await deleteCorridor(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/corridors/${CORRIDOR_ID}`, { method: "DELETE" }),
      corridorParams
    );

    expect(response.status).toBe(200);
    expect(corridorDeleteEqSpy).toHaveBeenCalledWith("id", CORRIDOR_ID);
  });

  /**
   * The lookup is scoped by BOTH ids, so a URL naming a project cannot reach a
   * corridor belonging to a different one — a 404, not a silent cross-edit.
   */
  it("scopes the lookup to the project in the URL", async () => {
    const { client, corridorLookupEqSpies } = buildSupabase({});
    createClientMock.mockResolvedValue(client);

    await deleteCorridor(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/corridors/${CORRIDOR_ID}`, { method: "DELETE" }),
      corridorParams
    );

    expect(corridorLookupEqSpies).toEqual([
      ["id", CORRIDOR_ID],
      ["project_id", PROJECT_ID],
    ]);
  });

  it("404s when the corridor does not belong to this project", async () => {
    const { client, corridorDeleteEqSpy } = buildSupabase({
      corridorLookupResult: { data: null, error: null },
    });
    createClientMock.mockResolvedValue(client);

    const response = await deleteCorridor(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/corridors/${CORRIDOR_ID}`, { method: "DELETE" }),
      corridorParams
    );

    expect(response.status).toBe(404);
    expect(corridorDeleteEqSpy).not.toHaveBeenCalled();
  });
});
