import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const loadCurrentWorkspaceMembershipMock = vi.fn();
const authGetUserMock = vi.fn();

const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "11111111-1111-4111-8111-111111111111";

type CountResult = { count: number | null; error: { message: string; code?: string } | null };

function buildQueryChain(result: CountResult) {
  const chain: Record<string, unknown> & PromiseLike<CountResult> = {
    eq: vi.fn(() => chain),
    not: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    then: (onFulfilled?: (value: CountResult) => unknown, onRejected?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(onFulfilled, onRejected),
  } as never;
  return chain;
}

let projectsChain: ReturnType<typeof buildQueryChain>;
let projectAreasChain: ReturnType<typeof buildQueryChain>;
let aerialChain: ReturnType<typeof buildQueryChain>;
let corridorsChain: ReturnType<typeof buildQueryChain>;
let rtpChain: ReturnType<typeof buildQueryChain>;
let equityChain: ReturnType<typeof buildQueryChain>;
let engagementChain: ReturnType<typeof buildQueryChain>;
let crashesChain: ReturnType<typeof buildQueryChain>;
let crashIngestsChain: ReturnType<typeof buildQueryChain>;

/**
 * `projects` is queried TWICE — once for site markers, once for stated project
 * areas — so the mock hands back a different chain per call in the order the
 * route issues them. Keying off call order rather than off the filter args is
 * deliberate: both queries select the same columns, and asserting on `.not()`
 * arguments to tell them apart would make this fixture depend on filter details
 * the individual tests already assert.
 */
let projectsSelectCallCount = 0;
const projectsSelectMock = vi.fn(() => {
  projectsSelectCallCount += 1;
  return projectsSelectCallCount === 1 ? projectsChain : projectAreasChain;
});
const aerialSelectMock = vi.fn(() => aerialChain);
const corridorsSelectMock = vi.fn(() => corridorsChain);
const rtpSelectMock = vi.fn(() => rtpChain);
const equitySelectMock = vi.fn(() => equityChain);
const engagementSelectMock = vi.fn(() => engagementChain);
const crashesSelectMock = vi.fn(() => crashesChain);
const crashIngestsSelectMock = vi.fn(() => crashIngestsChain);

const mockAudit = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const workspaceMaybeSingleMock = vi.fn();
const workspaceEqMock = vi.fn(() => ({ maybeSingle: workspaceMaybeSingleMock }));
const workspaceSelectMock = vi.fn(() => ({ eq: workspaceEqMock }));

const NEVADA_COUNTY_ROW = {
  home_geography_source: "tigerweb",
  home_geography_kind: "county",
  home_geography_ref: "06057",
  home_geography_label: "Nevada County, CA",
  home_country_code: "US",
};

const fromMock = vi.fn((table: string) => {
  if (table === "workspaces") return { select: workspaceSelectMock };
  if (table === "projects") return { select: projectsSelectMock };
  if (table === "aerial_missions") return { select: aerialSelectMock };
  if (table === "project_corridors") return { select: corridorsSelectMock };
  if (table === "rtp_cycles") return { select: rtpSelectMock };
  if (table === "census_tracts_map") return { select: equitySelectMock };
  if (table === "engagement_items") return { select: engagementSelectMock };
  if (table === "safety_crashes") return { select: crashesSelectMock };
  if (table === "safety_crash_ingests") return { select: crashIngestsSelectMock };
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

import { GET as getCounts } from "@/app/api/map-features/counts/route";

function bareRequest() {
  return new NextRequest("http://localhost/api/map-features/counts", { method: "GET" });
}

describe("GET /api/map-features/counts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
    projectsSelectCallCount = 0;
    projectsChain = buildQueryChain({ count: 0, error: null });
    projectAreasChain = buildQueryChain({ count: 0, error: null });
    aerialChain = buildQueryChain({ count: 0, error: null });
    corridorsChain = buildQueryChain({ count: 0, error: null });
    rtpChain = buildQueryChain({ count: 0, error: null });
    equityChain = buildQueryChain({ count: 0, error: null });
    engagementChain = buildQueryChain({ count: 0, error: null });
    crashesChain = buildQueryChain({ count: 0, error: null });
    crashIngestsChain = buildQueryChain({ count: 0, error: null });
    workspaceMaybeSingleMock.mockResolvedValue({ data: NEVADA_COUNTY_ROW, error: null });
  });

  it("returns 401 when the request is anonymous", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null } });

    const response = await getCounts(bareRequest());

    expect(response.status).toBe(401);
    expect(loadCurrentWorkspaceMembershipMock).not.toHaveBeenCalled();
  });

  it("returns zero counts when the user has no workspace membership", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({ membership: null, workspace: null });

    const response = await getCounts(bareRequest());

    expect(response.status).toBe(200);
    const payload = await response.json();
    // equity is NULL, not 0: with no workspace there is no geography to scope
    // tracts to, so nothing was counted — and census tracts are public data, so
    // "no workspace" is not evidence that zero tracts exist.
    expect(payload).toEqual({
      projects: 0,
      projectAreas: 0,
      aerial: 0,
      corridors: 0,
      rtp: 0,
      equity: null,
      engagement: 0,
      // Same reasoning as equity, applied to the most dangerous zero on the
      // map: with no workspace there is no acquired crash record, and "0
      // crashes" would read as a statement about the roads.
      crashes: null,
    });
    expect(projectsSelectMock).not.toHaveBeenCalled();
    expect(aerialSelectMock).not.toHaveBeenCalled();
    expect(corridorsSelectMock).not.toHaveBeenCalled();
    expect(rtpSelectMock).not.toHaveBeenCalled();
    expect(equitySelectMock).not.toHaveBeenCalled();
    expect(engagementSelectMock).not.toHaveBeenCalled();
    expect(crashesSelectMock).not.toHaveBeenCalled();
    expect(crashIngestsSelectMock).not.toHaveBeenCalled();
  });

  it("returns live counts across every layer when queries succeed", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({
      membership: { workspace_id: WORKSPACE_ID, role: "editor" },
      workspace: { id: WORKSPACE_ID, name: "NCTC demo" },
    });
    projectsChain = buildQueryChain({ count: 1, error: null });
    projectAreasChain = buildQueryChain({ count: 2, error: null });
    aerialChain = buildQueryChain({ count: 3, error: null });
    corridorsChain = buildQueryChain({ count: 2, error: null });
    rtpChain = buildQueryChain({ count: 1, error: null });
    equityChain = buildQueryChain({ count: 4, error: null });
    engagementChain = buildQueryChain({ count: 5, error: null });
    crashesChain = buildQueryChain({ count: 912, error: null });
    crashIngestsChain = buildQueryChain({ count: 1, error: null });

    const response = await getCounts(bareRequest());

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual({
      projects: 1,
      projectAreas: 2,
      aerial: 3,
      corridors: 2,
      rtp: 1,
      equity: 4,
      engagement: 5,
      crashes: 912,
    });
    // The area count must be scoped to the same rows the layer can draw: a
    // project with no stated area is not a blank area, it is no area.
    expect(projectAreasChain.not).toHaveBeenCalledWith("place_geometry_geojson", "is", null);
    expect(crashesSelectMock).toHaveBeenCalledWith("id", { count: "exact", head: true });
    expect(crashesChain.eq).toHaveBeenCalledWith("workspace_id", WORKSPACE_ID);
    expect(projectsSelectMock).toHaveBeenCalledWith("id", { count: "exact", head: true });
    expect(aerialSelectMock).toHaveBeenCalledWith("id", { count: "exact", head: true });
    expect(corridorsSelectMock).toHaveBeenCalledWith("id", { count: "exact", head: true });
    expect(rtpSelectMock).toHaveBeenCalledWith("id", { count: "exact", head: true });
    expect(equitySelectMock).toHaveBeenCalledWith("geoid", { count: "exact", head: true });
    // The chip must count the SAME tracts the choropleth can draw. It used to
    // count census_tracts_map with no filter at all — a NATIONAL total rendered
    // beside this workspace's own map.
    expect(equityChain.eq).toHaveBeenCalledWith("state_fips", "06");
    expect(equityChain.eq).toHaveBeenCalledWith("county_fips", "057");
    expect(engagementSelectMock).toHaveBeenCalledWith(
      "id, engagement_campaigns!inner(id)",
      { count: "exact", head: true }
    );
    expect(engagementChain.eq).toHaveBeenCalledWith(
      "engagement_campaigns.workspace_id",
      WORKSPACE_ID
    );
    expect(engagementChain.eq).toHaveBeenCalledWith("status", "approved");
    expect(engagementChain.not).toHaveBeenCalledWith("latitude", "is", null);
    expect(engagementChain.not).toHaveBeenCalledWith("longitude", "is", null);
    expect(mockAudit.info).toHaveBeenCalledWith(
      "map_feature_counts_loaded",
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        counts: {
          projects: 1,
          projectAreas: 2,
          aerial: 3,
          corridors: 2,
          rtp: 1,
          equity: 4,
          engagement: 5,
          crashes: 912,
        },
      })
    );
  });

  /**
   * The crash chip's whole reason for existing in `null` form. A workspace that
   * has never acquired crash data has zero crash rows — but reporting "0" beside
   * a crash layer states a finding about collisions, when the only fact in
   * evidence is that nobody has asked a source yet.
   */
  it("reports crashes as not-known, rather than zero, when no acquisition has ever run", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({
      membership: { workspace_id: WORKSPACE_ID, role: "editor" },
      workspace: { id: WORKSPACE_ID, name: "Any workspace" },
    });
    crashesChain = buildQueryChain({ count: 0, error: null });
    crashIngestsChain = buildQueryChain({ count: 0, error: null });

    const response = await getCounts(bareRequest());

    const payload = (await response.json()) as { crashes: number | null };
    expect(payload.crashes).toBeNull();
  });

  it("reports a genuine zero once an acquisition exists and stored nothing", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({
      membership: { workspace_id: WORKSPACE_ID, role: "editor" },
      workspace: { id: WORKSPACE_ID, name: "Any workspace" },
    });
    crashesChain = buildQueryChain({ count: 0, error: null });
    crashIngestsChain = buildQueryChain({ count: 1, error: null });

    const response = await getCounts(bareRequest());

    const payload = (await response.json()) as { crashes: number | null };
    expect(payload.crashes).toBe(0);
  });

  it("returns null for the failing layer and logs a partial-failure warning", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({
      membership: { workspace_id: WORKSPACE_ID, role: "editor" },
      workspace: { id: WORKSPACE_ID, name: "NCTC demo" },
    });
    projectsChain = buildQueryChain({ count: 1, error: null });
    aerialChain = buildQueryChain({ count: null, error: { message: "boom", code: "42P01" } });
    corridorsChain = buildQueryChain({ count: 2, error: null });
    rtpChain = buildQueryChain({ count: 1, error: null });
    equityChain = buildQueryChain({ count: 4, error: null });
    engagementChain = buildQueryChain({ count: 5, error: null });

    const response = await getCounts(bareRequest());

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual({
      projects: 1,
      projectAreas: 0,
      aerial: null,
      corridors: 2,
      rtp: 1,
      equity: 4,
      engagement: 5,
      crashes: null,
    });
    expect(mockAudit.warn).toHaveBeenCalledWith(
      "map_feature_counts_partial_failure",
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        aerialError: "boom",
        projectsError: null,
        corridorsError: null,
        rtpError: null,
        equityError: null,
        engagementError: null,
      })
    );
  });

  it("returns null for the rtp layer and logs a partial-failure warning when rtp_cycles fails", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({
      membership: { workspace_id: WORKSPACE_ID, role: "editor" },
      workspace: { id: WORKSPACE_ID, name: "NCTC demo" },
    });
    projectsChain = buildQueryChain({ count: 1, error: null });
    aerialChain = buildQueryChain({ count: 3, error: null });
    corridorsChain = buildQueryChain({ count: 2, error: null });
    rtpChain = buildQueryChain({ count: null, error: { message: "no anchor column", code: "42703" } });
    equityChain = buildQueryChain({ count: 4, error: null });
    engagementChain = buildQueryChain({ count: 5, error: null });

    const response = await getCounts(bareRequest());

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual({
      projects: 1,
      projectAreas: 0,
      aerial: 3,
      corridors: 2,
      rtp: null,
      equity: 4,
      engagement: 5,
      crashes: null,
    });
    expect(mockAudit.warn).toHaveBeenCalledWith(
      "map_feature_counts_partial_failure",
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        rtpError: "no anchor column",
        aerialError: null,
        projectsError: null,
        corridorsError: null,
        equityError: null,
        engagementError: null,
      })
    );
  });

  it("returns null for the equity layer and logs a partial-failure warning when census_tracts_map fails", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({
      membership: { workspace_id: WORKSPACE_ID, role: "editor" },
      workspace: { id: WORKSPACE_ID, name: "NCTC demo" },
    });
    projectsChain = buildQueryChain({ count: 1, error: null });
    aerialChain = buildQueryChain({ count: 3, error: null });
    corridorsChain = buildQueryChain({ count: 2, error: null });
    rtpChain = buildQueryChain({ count: 1, error: null });
    equityChain = buildQueryChain({ count: null, error: { message: "view missing", code: "42P01" } });
    engagementChain = buildQueryChain({ count: 5, error: null });

    const response = await getCounts(bareRequest());

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual({
      projects: 1,
      projectAreas: 0,
      aerial: 3,
      corridors: 2,
      rtp: 1,
      equity: null,
      engagement: 5,
      crashes: null,
    });
    expect(mockAudit.warn).toHaveBeenCalledWith(
      "map_feature_counts_partial_failure",
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        equityError: "view missing",
        projectsError: null,
        aerialError: null,
        corridorsError: null,
        rtpError: null,
        engagementError: null,
      })
    );
  });

  it("returns null for engagement and logs a partial-failure warning when engagement count fails", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({
      membership: { workspace_id: WORKSPACE_ID, role: "editor" },
      workspace: { id: WORKSPACE_ID, name: "NCTC demo" },
    });
    projectsChain = buildQueryChain({ count: 1, error: null });
    aerialChain = buildQueryChain({ count: 3, error: null });
    corridorsChain = buildQueryChain({ count: 2, error: null });
    rtpChain = buildQueryChain({ count: 1, error: null });
    equityChain = buildQueryChain({ count: 4, error: null });
    engagementChain = buildQueryChain({
      count: null,
      error: { message: "engagement join failed", code: "42703" },
    });

    const response = await getCounts(bareRequest());

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual({
      projects: 1,
      projectAreas: 0,
      aerial: 3,
      corridors: 2,
      rtp: 1,
      equity: 4,
      engagement: null,
      crashes: null,
    });
    expect(mockAudit.warn).toHaveBeenCalledWith(
      "map_feature_counts_partial_failure",
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        engagementError: "engagement join failed",
        projectsError: null,
        aerialError: null,
        corridorsError: null,
        rtpError: null,
        equityError: null,
      })
    );
  });

  it("coerces a null count from Supabase to 0 on the happy path", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({
      membership: { workspace_id: WORKSPACE_ID, role: "editor" },
      workspace: { id: WORKSPACE_ID, name: "NCTC demo" },
    });
    projectsChain = buildQueryChain({ count: null, error: null });
    projectAreasChain = buildQueryChain({ count: null, error: null });
    aerialChain = buildQueryChain({ count: null, error: null });
    corridorsChain = buildQueryChain({ count: null, error: null });
    rtpChain = buildQueryChain({ count: null, error: null });
    equityChain = buildQueryChain({ count: null, error: null });
    engagementChain = buildQueryChain({ count: null, error: null });
    crashesChain = buildQueryChain({ count: null, error: null });
    crashIngestsChain = buildQueryChain({ count: null, error: null });

    const response = await getCounts(bareRequest());

    expect(response.status).toBe(200);
    const payload = await response.json();
    // equity is NULL, not 0: with no workspace there is no geography to scope
    // tracts to, so nothing was counted — and census tracts are public data, so
    // "no workspace" is not evidence that zero tracts exist.
    expect(payload).toEqual({
      projects: 0,
      projectAreas: 0,
      aerial: 0,
      corridors: 0,
      rtp: 0,
      equity: null,
      engagement: 0,
      // A null acquisition count is not evidence that an acquisition ran, so the
      // crash chip stays unknown rather than coercing to a confident zero.
      crashes: null,
    });
    expect(mockAudit.warn).not.toHaveBeenCalled();
  });
});
