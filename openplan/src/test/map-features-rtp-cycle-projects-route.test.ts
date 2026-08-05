import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { loadSchemaInventory } from "./migrations/schema-inventory";

/**
 * The projects programmed in ONE RTP cycle, as a map layer.
 *
 * What these assertions are actually protecting, in the order the damage would
 * be done:
 *
 *  1. A PROJECT WITH NO LOCATION IS COUNTED, NOT SWALLOWED. A cycle with 20
 *     projects of which 6 have no site recorded must not answer with 14
 *     features and nothing else — a map that draws 14 dots asserts that 14 is
 *     the programme, and no viewer can tell otherwise.
 *  2. A FAILED READ IS NEVER AN EMPTY LAYER. 500 (or 503 with the migration
 *     named), never a 200 carrying `features: []`.
 *  3. AN UNPRICED PROJECT STAYS UNPRICED. `estimated_cost` NULL means nobody
 *     has costed it; if that reached the client as 0 the legend and every
 *     downstream total would read as complete.
 *  4. THE CYCLE IN THE URL IS NOT TRUSTED. The workspace comes from the
 *     caller's own membership and scopes the cycle lookup.
 *  5. THE PROJECTION NAMES EVERY COLUMN THE FEATURES CARRY. The Supabase
 *     clients are untyped and a mocked one returns its fixture whatever was
 *     asked for, so only an assertion on the `.select()` string catches a
 *     column that stopped being requested.
 */

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const loadCurrentWorkspaceMembershipMock = vi.fn();
const authGetUserMock = vi.fn();

const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const CYCLE_ID = "22222222-2222-4222-8222-222222222222";
const BAND_ID = "44444444-4444-4444-8444-444444444444";
const LINK_A = "a0000001-0000-4000-8000-000000000001";
const LINK_B = "a0000001-0000-4000-8000-000000000002";
const LINK_C = "a0000001-0000-4000-8000-000000000003";
const PROJECT_A = "b0000001-0000-4000-8000-000000000001";
const PROJECT_B = "b0000001-0000-4000-8000-000000000002";
const PROJECT_C = "b0000001-0000-4000-8000-000000000003";

const cycleMaybeSingleMock = vi.fn();
const cycleWorkspaceEqMock = vi.fn(() => ({ maybeSingle: cycleMaybeSingleMock }));
const cycleIdEqMock = vi.fn(() => ({ eq: cycleWorkspaceEqMock }));
const cycleSelectMock = vi.fn(() => ({ eq: cycleIdEqMock }));

const linkLimitMock = vi.fn();
const linkOrderIdMock = vi.fn(() => ({ limit: linkLimitMock }));
const linkOrderCreatedMock = vi.fn(() => ({ order: linkOrderIdMock }));
const linkWorkspaceEqMock = vi.fn(() => ({ order: linkOrderCreatedMock }));
const linkCycleEqMock = vi.fn(() => ({ eq: linkWorkspaceEqMock }));
const linkSelectMock = vi.fn(() => ({ eq: linkCycleEqMock }));

const mockAudit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const fromMock = vi.fn((table: string) => {
  if (table === "rtp_cycles") return { select: cycleSelectMock };
  if (table === "project_rtp_cycle_links") return { select: linkSelectMock };
  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

vi.mock("@/lib/workspaces/current", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workspaces/current")>(
    "@/lib/workspaces/current"
  );
  return {
    ...actual,
    loadCurrentWorkspaceMembership: (...args: unknown[]) =>
      loadCurrentWorkspaceMembershipMock(...args),
  };
});

import { GET as getRtpCycleProjects } from "@/app/api/map-features/rtp-cycle-projects/route";
import { MAP_FEATURE_LAYER_LIMIT } from "@/lib/cartographic/layer-disclosure";
import { RTP_CYCLE_PROJECT_MAP_COLUMNS } from "@/lib/cartographic/rtp-cycle-project-layer";

function requestFor(rtpCycleId: string | null) {
  const url = rtpCycleId
    ? `http://localhost/api/map-features/rtp-cycle-projects?rtpCycleId=${rtpCycleId}`
    : "http://localhost/api/map-features/rtp-cycle-projects";
  return new NextRequest(url, { method: "GET" });
}

function asMember(role = "member") {
  authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
  loadCurrentWorkspaceMembershipMock.mockResolvedValue({
    membership: { workspace_id: WORKSPACE_ID, role },
    workspace: { id: WORKSPACE_ID, name: "Any agency" },
  });
  cycleMaybeSingleMock.mockResolvedValue({
    data: { id: CYCLE_ID, workspace_id: WORKSPACE_ID },
    error: null,
  });
}

/**
 * The embedded project, built from ONLY what the projection asks for — so a
 * column the `.select()` forgot is genuinely absent here, exactly as it would
 * be at runtime against a real database.
 */
function embeddedProject(overrides: Partial<Record<string, unknown>> = {}) {
  const asked = projectionColumns();
  const embedded = asked.embedded;
  const values: Record<string, unknown> = {
    id: PROJECT_A,
    name: "Any corridor rebuild",
    status: "active",
    latitude: 39.5,
    longitude: -82.5,
    ...overrides,
  };
  return Object.fromEntries(embedded.filter((column) => column in values).map((c) => [c, values[c]]));
}

function linkRow(overrides: Partial<Record<string, unknown>> = {}) {
  const asked = projectionColumns().top;
  const values: Record<string, unknown> = {
    id: LINK_A,
    project_id: PROJECT_A,
    portfolio_role: "constrained",
    horizon_band_id: BAND_ID,
    estimated_cost: "12500000.00",
    cost_basis_year: 2026,
    ...overrides,
  };
  const row = Object.fromEntries(asked.filter((column) => column in values).map((c) => [c, values[c]]));
  return { ...row, projects: overrides.projects === undefined ? embeddedProject() : overrides.projects };
}

/** Split the projection into its top-level columns and its embedded ones. */
function projectionColumns(): { top: string[]; embedded: string[] } {
  const embeddedMatch = RTP_CYCLE_PROJECT_MAP_COLUMNS.match(/projects\(([^)]*)\)/);
  const embedded = (embeddedMatch?.[1] ?? "").split(",").map((c) => c.trim()).filter(Boolean);
  const top = RTP_CYCLE_PROJECT_MAP_COLUMNS.replace(/projects\([^)]*\)/, "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  return { top, embedded };
}

describe("GET /api/map-features/rtp-cycle-projects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
  });

  it("returns 401 when the request is anonymous", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null } });

    const response = await getRtpCycleProjects(requestFor(CYCLE_ID));

    expect(response.status).toBe(401);
    expect(loadCurrentWorkspaceMembershipMock).not.toHaveBeenCalled();
  });

  it("refuses a missing or malformed cycle id before touching the database", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });

    const missing = await getRtpCycleProjects(requestFor(null));
    expect(missing.status).toBe(400);

    const malformed = await getRtpCycleProjects(requestFor("not-a-uuid"));
    expect(malformed.status).toBe(400);

    expect(createClientMock).not.toHaveBeenCalled();
    expect(cycleSelectMock).not.toHaveBeenCalled();
  });

  /**
   * The sibling backdrop layers answer an EMPTY FeatureCollection here, because
   * they have no subject and "your workspace has none of these" is true. This
   * route names a cycle in its URL, so an empty collection would be a claim
   * about THAT plan's portfolio. Refusing is the only honest answer.
   */
  it("refuses rather than answering an empty layer when the caller has no workspace", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({ membership: null, workspace: null });

    const response = await getRtpCycleProjects(requestFor(CYCLE_ID));

    expect(response.status).toBe(403);
    expect(cycleSelectMock).not.toHaveBeenCalled();
  });

  it("scopes the cycle lookup by the caller's own workspace and 404s a cycle it does not find", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({
      membership: { workspace_id: WORKSPACE_ID, role: "viewer" },
      workspace: { id: WORKSPACE_ID, name: "Any agency" },
    });
    cycleMaybeSingleMock.mockResolvedValue({ data: null, error: null });

    const response = await getRtpCycleProjects(requestFor(CYCLE_ID));

    expect(response.status).toBe(404);
    expect(cycleIdEqMock).toHaveBeenCalledWith("id", CYCLE_ID);
    // The workspace is taken from the membership, never from the request.
    expect(cycleWorkspaceEqMock).toHaveBeenCalledWith("workspace_id", WORKSPACE_ID);
    expect(linkSelectMock).not.toHaveBeenCalled();
  });

  it("draws the located projects and COUNTS the ones with no location instead of dropping them silently", async () => {
    asMember();
    linkLimitMock.mockResolvedValue({
      data: [
        linkRow(),
        // Programmed, real, and never given a site. Must not be drawn and must
        // not vanish.
        linkRow({
          id: LINK_B,
          project_id: PROJECT_B,
          portfolio_role: "illustrative",
          projects: embeddedProject({ id: PROJECT_B, name: "Unplaced project", latitude: null, longitude: null }),
        }),
        // The link's project row could not be read at all — a database fact,
        // reported apart from "no location recorded".
        linkRow({ id: LINK_C, project_id: PROJECT_C, projects: null }),
      ],
      error: null,
      count: 3,
    });

    const response = await getRtpCycleProjects(requestFor(CYCLE_ID));

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      features: Array<{ id: string; geometry: { coordinates: [number, number] }; properties: Record<string, unknown> }>;
      withoutGeometry: number;
      withoutReadableProject: number;
      droppedCount: number;
      matchedCount: number;
      truncated: boolean;
    };

    expect(payload.features).toHaveLength(1);
    expect(payload.withoutGeometry).toBe(1);
    expect(payload.withoutReadableProject).toBe(1);
    expect(payload.droppedCount).toBe(2);
    expect(payload.matchedCount).toBe(3);
    // Fetched-but-undrawable is not the same fact as truncated-by-the-cap.
    expect(payload.truncated).toBe(false);

    // GeoJSON order is [lng, lat]; swapping them puts a US project in the sea.
    expect(payload.features[0].geometry.coordinates).toEqual([-82.5, 39.5]);
    expect(payload.features[0].id).toBe(LINK_A);
    expect(payload.features[0].properties).toMatchObject({
      kind: "rtp_cycle_project",
      linkId: LINK_A,
      projectId: PROJECT_A,
      projectName: "Any corridor rebuild",
      portfolioRole: "constrained",
      horizonBandId: BAND_ID,
      estimatedCost: 12500000,
      costBasisYear: 2026,
    });

    expect(linkCycleEqMock).toHaveBeenCalledWith("rtp_cycle_id", CYCLE_ID);
    expect(linkWorkspaceEqMock).toHaveBeenCalledWith("workspace_id", WORKSPACE_ID);
    expect(linkLimitMock).toHaveBeenCalledWith(MAP_FEATURE_LAYER_LIMIT);
    // The route must ASK with the shared projection, not an inline string of
    // its own. Without this the projection assertions below would check a
    // constant nothing uses — the exact vacuity the extraction could have
    // introduced.
    expect(linkSelectMock).toHaveBeenCalledWith(RTP_CYCLE_PROJECT_MAP_COLUMNS, { count: "exact" });
  });

  /**
   * NULL means UNPRICED and 0 means a project deliberately programmed at zero
   * dollars. If the first became the second, a cycle with twelve uncosted
   * projects would total as though it were complete.
   */
  it("keeps an unpriced project unpriced and a genuine zero at zero", async () => {
    asMember();
    linkLimitMock.mockResolvedValue({
      data: [
        linkRow({ estimated_cost: null, cost_basis_year: null }),
        linkRow({
          id: LINK_B,
          estimated_cost: "0.00",
          projects: embeddedProject({ id: PROJECT_B, latitude: 40, longitude: -83 }),
        }),
      ],
      error: null,
      count: 2,
    });

    const response = await getRtpCycleProjects(requestFor(CYCLE_ID));
    const payload = (await response.json()) as {
      features: Array<{ properties: { estimatedCost: number | null } }>;
    };

    expect(payload.features[0].properties.estimatedCost).toBeNull();
    expect(payload.features[1].properties.estimatedCost).toBe(0);
  });

  /**
   * A coordinate outside the globe is not a location the route may pass on. The
   * row-level CHECKs in 20260421000065 already refuse them, so one arriving here
   * means the value came from somewhere those constraints did not govern — and
   * drawing it puts a dot in a place the project is not, while nothing on screen
   * says the dot is wrong. Counting it into `withoutGeometry` is what makes the
   * panel say a project is missing instead of showing a false one.
   *
   * Added after a mutation removed the range half of `coerceLat` and the whole
   * suite stayed green: the guard was real code no test was protecting.
   */
  it("counts an out-of-range coordinate as unlocated instead of drawing it somewhere", async () => {
    asMember();
    linkLimitMock.mockResolvedValue({
      data: [
        // Latitude past the pole.
        linkRow({ projects: embeddedProject({ latitude: 91, longitude: -82.5 }) }),
        // Longitude past the antimeridian.
        linkRow({
          id: LINK_B,
          project_id: PROJECT_B,
          projects: embeddedProject({ id: PROJECT_B, latitude: 39.5, longitude: -181 }),
        }),
        // The only one that is actually on the planet.
        linkRow({
          id: LINK_C,
          project_id: PROJECT_C,
          projects: embeddedProject({ id: PROJECT_C, latitude: 39.5, longitude: -82.5 }),
        }),
      ],
      error: null,
      count: 3,
    });

    const response = await getRtpCycleProjects(requestFor(CYCLE_ID));

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      features: Array<{ id: string }>;
      withoutGeometry: number;
      withoutReadableProject: number;
    };

    expect(payload.features.map((f) => f.id)).toEqual([LINK_C]);
    // Refused, and REPORTED — not quietly subtracted from the programme.
    expect(payload.withoutGeometry).toBe(2);
    expect(payload.withoutReadableProject).toBe(0);
  });

  it("discloses truncation against the shared map-feature cap", async () => {
    asMember();
    linkLimitMock.mockResolvedValue({ data: [linkRow()], error: null, count: 640 });

    const response = await getRtpCycleProjects(requestFor(CYCLE_ID));
    const payload = (await response.json()) as {
      returnedCount: number;
      matchedCount: number;
      truncated: boolean;
      limit: number;
    };

    expect(payload).toMatchObject({
      returnedCount: 1,
      matchedCount: 640,
      truncated: true,
      limit: MAP_FEATURE_LAYER_LIMIT,
    });
  });

  it("answers 500 rather than an empty layer when the project query fails", async () => {
    asMember();
    linkLimitMock.mockResolvedValue({
      data: null,
      error: { message: "connection reset by peer", code: "08006" },
      count: null,
    });

    const response = await getRtpCycleProjects(requestFor(CYCLE_ID));

    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: string; features?: unknown };
    expect(body.features).toBeUndefined();
    expect(mockAudit.error).toHaveBeenCalledWith(
      "rtp_cycle_projects_query_failed",
      expect.objectContaining({ rtpCycleId: CYCLE_ID, workspaceId: WORKSPACE_ID })
    );
  });

  it("names the migration when the financial columns have not been applied yet", async () => {
    asMember();
    linkLimitMock.mockResolvedValue({
      data: null,
      error: { message: 'column project_rtp_cycle_links.estimated_cost does not exist', code: "42703" },
      count: null,
    });

    const response = await getRtpCycleProjects(requestFor(CYCLE_ID));

    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: string; hint?: string };
    expect(body.hint).toContain("20260805000003_rtp_financial_element.sql");
  });

  it("answers the cycle read's own status when the cycle lookup itself fails", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({
      membership: { workspace_id: WORKSPACE_ID, role: "member" },
      workspace: { id: WORKSPACE_ID, name: "Any agency" },
    });
    cycleMaybeSingleMock.mockResolvedValue({ data: null, error: { message: "permission denied" } });

    const response = await getRtpCycleProjects(requestFor(CYCLE_ID));

    // Not 404: "no such cycle" is a claim, and a read that never ran cannot
    // support it.
    expect(response.status).toBe(500);
    expect(linkSelectMock).not.toHaveBeenCalled();
  });

  it("audits through createApiAuditLogger under its own route name", async () => {
    asMember();
    linkLimitMock.mockResolvedValue({ data: [linkRow()], error: null, count: 1 });

    await getRtpCycleProjects(requestFor(CYCLE_ID));

    expect(createApiAuditLoggerMock).toHaveBeenCalledWith(
      "map-features.rtp-cycle-projects",
      expect.anything()
    );
  });
});

describe("the rtp-cycle-projects projection", () => {
  const { top, embedded } = projectionColumns();

  /**
   * Every property a feature carries is derived from a column, and a mocked
   * Supabase client hands back its fixture whatever was asked for — so the
   * `.select()` STRING is the only thing that catches a column that stopped
   * being requested.
   */
  it("asks for every column the features are built from", () => {
    for (const column of [
      "id",
      "project_id",
      "portfolio_role",
      "horizon_band_id",
      "estimated_cost",
      "cost_basis_year",
    ]) {
      expect(top).toContain(column);
    }
    for (const column of ["id", "name", "status", "latitude", "longitude"]) {
      expect(embedded).toContain(column);
    }
  });

  /** And every one of them exists on the table the migrations declare. */
  it("names only columns the migrations actually declare", () => {
    const schema = loadSchemaInventory();
    for (const column of top) {
      expect(
        { column, onTable: schema.hasColumn("project_rtp_cycle_links", column) }
      ).toEqual({ column, onTable: true });
    }
    for (const column of embedded) {
      expect({ column, onTable: schema.hasColumn("projects", column) }).toEqual({
        column,
        onTable: true,
      });
    }
  });

  /**
   * `rtp_cycles.anchor_latitude/longitude` are display-only by their own
   * migration's words. Reading them here would draw one dot for a whole plan
   * and call it a project map.
   */
  it("does not read the cycle anchor as project geometry", () => {
    expect(RTP_CYCLE_PROJECT_MAP_COLUMNS).not.toContain("anchor_latitude");
    expect(RTP_CYCLE_PROJECT_MAP_COLUMNS).not.toContain("anchor_longitude");
  });
});
