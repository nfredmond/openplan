import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();

const packageMaybeSingleMock = vi.fn();
const packageEqMock = vi.fn(() => ({ maybeSingle: packageMaybeSingleMock }));
const packageSelectMock = vi.fn(() => ({ eq: packageEqMock }));

const membershipMaybeSingleMock = vi.fn();
const membershipEqUserMock = vi.fn(() => ({ maybeSingle: membershipMaybeSingleMock }));
const membershipEqWorkspaceMock = vi.fn(() => ({ eq: membershipEqUserMock }));
const membershipSelectMock = vi.fn(() => ({ eq: membershipEqWorkspaceMock }));

const workspaceMaybeSingleMock = vi.fn();
const workspaceEqMock = vi.fn(() => ({ maybeSingle: workspaceMaybeSingleMock }));
const workspaceSelectMock = vi.fn(() => ({ eq: workspaceEqMock }));

const runsCountGteMock = vi.fn().mockResolvedValue({ count: 0, error: null });
const runsCountEqMock = vi.fn(() => ({ gte: runsCountGteMock }));
const runsSelectMock = vi.fn(() => ({ eq: runsCountEqMock }));

const versionUpdateSelectMock = vi
  .fn()
  .mockResolvedValue({ data: [{ id: "22222222-2222-4222-8222-222222222222" }], error: null });
const versionUpdateEqPackageMock = vi.fn(() => ({ select: versionUpdateSelectMock }));
const versionUpdateEqIdMock = vi.fn(() => ({ eq: versionUpdateEqPackageMock }));
const versionUpdateMock = vi.fn(() => ({ eq: versionUpdateEqIdMock }));

const mockAudit = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const fromMock = vi.fn((table: string) => {
  if (table === "network_packages") {
    return { select: packageSelectMock };
  }
  if (table === "workspace_members") {
    return { select: membershipSelectMock };
  }
  if (table === "workspaces") {
    return { select: workspaceSelectMock };
  }
  if (table === "runs") {
    return { select: runsSelectMock };
  }
  if (table === "network_package_versions") {
    return { update: versionUpdateMock };
  }
  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

import { POST as postIngest } from "@/app/api/network-packages/[packageId]/versions/[versionId]/ingest/route";

const PACKAGE_ID = "11111111-1111-4111-8111-111111111111";
const VERSION_ID = "22222222-2222-4222-8222-222222222222";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "44444444-4444-4444-8444-444444444444";

function buildRequest(body: unknown = { nodes: null, links: null }): NextRequest {
  return new NextRequest(
    `http://localhost/api/network-packages/${PACKAGE_ID}/versions/${VERSION_ID}/ingest`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}

function buildContext() {
  return {
    params: Promise.resolve({ packageId: PACKAGE_ID, versionId: VERSION_ID }),
  };
}

describe("/api/network-packages/[packageId]/versions/[versionId]/ingest", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    createApiAuditLoggerMock.mockReturnValue(mockAudit);

    authGetUserMock.mockResolvedValue({
      data: { user: { id: USER_ID } },
    });

    packageMaybeSingleMock.mockResolvedValue({
      data: { id: PACKAGE_ID, workspace_id: WORKSPACE_ID },
      error: null,
    });

    membershipMaybeSingleMock.mockResolvedValue({
      data: { role: "member" },
      error: null,
    });

    workspaceMaybeSingleMock.mockResolvedValue({
      data: {
        plan: "pilot",
        subscription_plan: "pilot",
        subscription_status: "active",
      },
      error: null,
    });

    runsCountGteMock.mockResolvedValue({ count: 0, error: null });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
  });

  it("returns 401 when the request has no authenticated user", async () => {
    authGetUserMock.mockResolvedValueOnce({ data: { user: null } });

    const response = await postIngest(buildRequest(), buildContext());

    expect(response.status).toBe(401);
    expect(packageSelectMock).not.toHaveBeenCalled();
    expect(versionUpdateMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the network package does not exist", async () => {
    packageMaybeSingleMock.mockResolvedValueOnce({ data: null, error: null });

    const response = await postIngest(buildRequest(), buildContext());

    expect(response.status).toBe(404);
    expect(membershipSelectMock).not.toHaveBeenCalled();
    expect(versionUpdateMock).not.toHaveBeenCalled();
  });

  it("returns 403 when the user is not a member of the package workspace", async () => {
    membershipMaybeSingleMock.mockResolvedValueOnce({ data: null, error: null });

    const response = await postIngest(buildRequest(), buildContext());

    expect(response.status).toBe(403);
    expect(versionUpdateMock).not.toHaveBeenCalled();
    expect(mockAudit.warn).toHaveBeenCalledWith(
      "workspace_access_denied",
      expect.objectContaining({ packageId: PACKAGE_ID, workspaceId: WORKSPACE_ID, userId: USER_ID })
    );
  });

  it("runs QA and updates the version row for an authorized member", async () => {
    const response = await postIngest(
      buildRequest({
        nodes: {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              geometry: { type: "Point", coordinates: [0, 0] },
              properties: { id: "n1" },
            },
          ],
        },
        links: {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              geometry: {
                type: "LineString",
                coordinates: [
                  [0, 0],
                  [1, 1],
                ],
              },
              properties: { speed: 35, capacity: 1200 },
            },
          ],
        },
      }),
      buildContext()
    );

    expect(response.status).toBe(200);
    expect(versionUpdateMock).toHaveBeenCalledTimes(1);
    expect(versionUpdateEqIdMock).toHaveBeenCalledWith("id", VERSION_ID);
    expect(versionUpdateEqPackageMock).toHaveBeenCalledWith("package_id", PACKAGE_ID);
    expect(mockAudit.info).toHaveBeenCalledWith(
      "network_package_version_ingested",
      expect.objectContaining({
        packageId: PACKAGE_ID,
        versionId: VERSION_ID,
        userId: USER_ID,
        workspaceId: WORKSPACE_ID,
      })
    );
  });

  it("returns 404 when versionId does not belong to packageId", async () => {
    versionUpdateSelectMock.mockResolvedValueOnce({ data: [], error: null });

    const response = await postIngest(
      buildRequest({
        nodes: {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              geometry: { type: "Point", coordinates: [0, 0] },
              properties: { id: "n1" },
            },
          ],
        },
        links: { type: "FeatureCollection", features: [] },
      }),
      buildContext()
    );

    expect(response.status).toBe(404);
    expect(mockAudit.warn).toHaveBeenCalledWith(
      "network_package_version_not_found",
      expect.objectContaining({
        packageId: PACKAGE_ID,
        versionId: VERSION_ID,
      })
    );
  });

  it("returns 402 when the workspace subscription is not active", async () => {
    workspaceMaybeSingleMock.mockResolvedValueOnce({
      data: {
        plan: "pilot",
        subscription_plan: "pilot",
        subscription_status: "past_due",
      },
      error: null,
    });

    const response = await postIngest(buildRequest(), buildContext());

    expect(response.status).toBe(402);
    expect(versionUpdateMock).not.toHaveBeenCalled();
  });

  it("returns 429 when the monthly run quota is exceeded", async () => {
    runsCountGteMock.mockResolvedValueOnce({ count: 9999, error: null });

    const response = await postIngest(buildRequest(), buildContext());

    expect(response.status).toBe(429);
    expect(versionUpdateMock).not.toHaveBeenCalled();
  });
});
