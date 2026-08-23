import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createServiceRoleClientMock = vi.fn();
const loadCurrentWorkspaceMembershipMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const MISSION_ID = "33333333-3333-4333-8333-333333333333";
const CUSTODY_ID = "44444444-4444-4444-8444-444444444444";

const authGetUser = vi.fn();
const filters: Array<[string, unknown]> = [];
const selects: string[] = [];
let queryResult: { data: unknown[] | null; error: { message: string } | null };

function queryBuilder() {
  const builder = {
    select: (columns: string) => {
      selects.push(columns);
      return builder;
    },
    eq: (column: string, value: unknown) => {
      filters.push([column, value]);
      return builder;
    },
    order: () => builder,
    limit: () => builder,
    then: (resolve: (value: typeof queryResult) => unknown) => Promise.resolve(queryResult).then(resolve),
  };
  return builder;
}

const createSignedUrl = vi.fn();
const audit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
  createServiceRoleClient: (...args: unknown[]) => createServiceRoleClientMock(...args),
}));
vi.mock("@/lib/workspaces/current", () => ({
  loadCurrentWorkspaceMembership: (...args: unknown[]) =>
    loadCurrentWorkspaceMembershipMock(...args),
}));
vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

import { GET } from "@/app/api/map-layers/aerial-orthos/route";

function request(custodyId?: string) {
  const suffix = custodyId ? `?custodyId=${custodyId}` : "";
  return new NextRequest(`http://localhost/api/map-layers/aerial-orthos${suffix}`);
}

function heldRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CUSTODY_ID,
    workspace_id: WORKSPACE_ID,
    mission_id: MISSION_ID,
    kind: "ortho_preview",
    state: "held",
    storage_bucket: "aerial-artifacts",
    storage_path: `${WORKSPACE_ID}/${MISSION_ID}/job/ortho_preview.png`,
    byte_size: 4096,
    checksum_sha256: "a".repeat(64),
    content_type: "image/png",
    held_at: "2026-08-23T12:00:00Z",
    created_at: "2026-08-23T11:59:00Z",
    bounds_west: 7.1,
    bounds_south: 45.1,
    bounds_east: 7.2,
    bounds_north: 45.2,
    crs: "EPSG:32632",
    pixel_size_m: 0.04,
    aerial_missions: {
      id: MISSION_ID,
      workspace_id: WORKSPACE_ID,
      project_id: null,
      title: "River crossing survey",
      collected_at: null,
      projects: null,
    },
    ...overrides,
  };
}

describe("GET /api/map-layers/aerial-orthos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    filters.length = 0;
    selects.length = 0;
    queryResult = { data: [], error: null };
    createApiAuditLoggerMock.mockReturnValue(audit);
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUser },
      from: vi.fn(() => queryBuilder()),
    });
    createServiceRoleClientMock.mockReturnValue({
      storage: { from: vi.fn(() => ({ createSignedUrl })) },
    });
    authGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({
      membership: { workspace_id: WORKSPACE_ID, role: "editor" },
    });
    createSignedUrl.mockResolvedValue({
      data: { signedUrl: "https://storage.example/preview.png?token=secret" },
      error: null,
    });
  });

  it("refuses an anonymous request before reading or signing anything", async () => {
    authGetUser.mockResolvedValue({ data: { user: null } });
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(loadCurrentWorkspaceMembershipMock).not.toHaveBeenCalled();
    expect(createServiceRoleClientMock).not.toHaveBeenCalled();
  });

  it("lists verified metadata without signing unselected previews", async () => {
    queryResult = { data: [heldRow()], error: null };
    const response = await GET(request());
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ state: "verified", layers: [{ custodyId: CUSTODY_ID }] });
    expect(filters).toContainEqual(["workspace_id", WORKSPACE_ID]);
    expect(filters).toContainEqual(["kind", "ortho_preview"]);
    expect(selects[0]).toMatch(/checksum_sha256/);
    expect(selects[0]).toMatch(/aerial_missions!inner/);
    expect(createServiceRoleClientMock).not.toHaveBeenCalled();
  });

  it("re-verifies one selected custody row before signing its exact storage path", async () => {
    queryResult = { data: [heldRow()], error: null };
    const response = await GET(request(CUSTODY_ID));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      state: "verified",
      layer: { custodyId: CUSTODY_ID, url: expect.stringContaining("token=secret") },
    });
    expect(filters).toContainEqual(["workspace_id", WORKSPACE_ID]);
    expect(filters).toContainEqual(["id", CUSTODY_ID]);
    expect(createSignedUrl).toHaveBeenCalledWith(
      `${WORKSPACE_ID}/${MISSION_ID}/job/ortho_preview.png`,
      900,
    );
  });

  it("will not sign a row whose embedded mission belongs to another workspace", async () => {
    queryResult = {
      data: [
        heldRow({
          aerial_missions: {
            id: MISSION_ID,
            workspace_id: "99999999-9999-4999-8999-999999999999",
            title: "Other workspace",
          },
        }),
      ],
      error: null,
    };
    const response = await GET(request(CUSTODY_ID));
    expect(response.status).toBe(422);
    expect(createServiceRoleClientMock).not.toHaveBeenCalled();
  });

  it("keeps a failed catalog read distinct from an empty catalog", async () => {
    queryResult = { data: null, error: { message: "permission denied" } };
    const response = await GET(request());
    const payload = await response.json();
    expect(response.status).toBe(500);
    expect(payload.state).toBe("unreadable");
    expect(payload.notes.join(" ")).toMatch(/not a finding that no imagery exists/);
  });
});
