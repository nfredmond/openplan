import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The network-package routes authorized writes by row visibility alone: no
 * `auth.getUser()` at all on the create/version/zone handlers, so RLS — which
 * asks only for membership — was the whole gate. A viewer could create packages,
 * versions, zones, connectors, and corridors in a workspace they may only read.
 *
 * These tests hold both ends: a viewer is refused before any insert, and a
 * member, admin, and owner keep working exactly as before.
 */

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();

const packageMaybeSingleMock = vi.fn();
const packageEqMock = vi.fn(() => ({ maybeSingle: packageMaybeSingleMock }));
const packageSelectMock = vi.fn(() => ({ eq: packageEqMock }));

const packageInsertSingleMock = vi.fn();
const packageInsertSelectMock = vi.fn(() => ({ single: packageInsertSingleMock }));
const packageInsertMock = vi.fn(() => ({ select: packageInsertSelectMock }));

const membershipMaybeSingleMock = vi.fn();
const membershipSelectMock = vi.fn(() => ({
  eq: () => ({ eq: () => ({ maybeSingle: membershipMaybeSingleMock }) }),
}));

const zoneInsertSingleMock = vi.fn();
const zoneInsertSelectMock = vi.fn(() => ({ single: zoneInsertSingleMock }));
const zoneInsertMock = vi.fn(() => ({ select: zoneInsertSelectMock }));

const versionInsertSingleMock = vi.fn();
const versionInsertSelectMock = vi.fn(() => ({ single: versionInsertSingleMock }));
const versionInsertMock = vi.fn(() => ({ select: versionInsertSelectMock }));

const mockAudit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const fromMock = vi.fn((table: string) => {
  if (table === "network_packages") {
    return { select: packageSelectMock, insert: packageInsertMock };
  }
  if (table === "network_package_versions") {
    return { insert: versionInsertMock };
  }
  if (table === "network_zones") {
    return { insert: zoneInsertMock };
  }
  if (table === "workspace_members") {
    return { select: membershipSelectMock };
  }
  throw new Error(`Unexpected table: ${table}`);
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

import { POST as postPackage } from "@/app/api/network-packages/route";
import { POST as postVersion } from "@/app/api/network-packages/[packageId]/versions/route";
import { POST as postZone } from "@/app/api/network-packages/[packageId]/versions/[versionId]/zones/route";

const PACKAGE_ID = "11111111-1111-4111-8111-111111111111";
const VERSION_ID = "22222222-2222-4222-8222-222222222222";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "44444444-4444-4444-8444-444444444444";

function jsonRequest(url: string, payload: unknown) {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function createPackageRequest() {
  return jsonRequest("http://localhost/api/network-packages", {
    workspace_id: WORKSPACE_ID,
    name: "Regional highway network",
  });
}

function createVersionRequest() {
  return jsonRequest(`http://localhost/api/network-packages/${PACKAGE_ID}/versions`, {
    version_name: "2026 base year",
  });
}

function createZoneRequest() {
  return jsonRequest(
    `http://localhost/api/network-packages/${PACKAGE_ID}/versions/${VERSION_ID}/zones`,
    { zone_id_external: "TAZ-1", zone_type: "taz" }
  );
}

const versionContext = { params: Promise.resolve({ packageId: PACKAGE_ID }) };
const zoneContext = {
  params: Promise.resolve({ packageId: PACKAGE_ID, versionId: VERSION_ID }),
};

describe("network-package writes require more than workspace membership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createApiAuditLoggerMock.mockReturnValue(mockAudit);

    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    membershipMaybeSingleMock.mockResolvedValue({ data: { role: "member" }, error: null });
    packageMaybeSingleMock.mockResolvedValue({
      data: { id: PACKAGE_ID, workspace_id: WORKSPACE_ID },
      error: null,
    });

    packageInsertSingleMock.mockResolvedValue({ data: { id: PACKAGE_ID }, error: null });
    versionInsertSingleMock.mockResolvedValue({ data: { id: VERSION_ID }, error: null });
    zoneInsertSingleMock.mockResolvedValue({ data: { id: "zone-1" }, error: null });

    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    });
  });

  it("refuses a viewer creating a package, and inserts nothing", async () => {
    membershipMaybeSingleMock.mockResolvedValue({ data: { role: "viewer" }, error: null });

    const response = await postPackage(createPackageRequest());

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: "Viewers have read-only access to this workspace",
    });
    expect(packageInsertMock).not.toHaveBeenCalled();
  });

  it("refuses a viewer creating a version", async () => {
    membershipMaybeSingleMock.mockResolvedValue({ data: { role: "viewer" }, error: null });

    const response = await postVersion(createVersionRequest(), versionContext);

    expect(response.status).toBe(403);
    expect(versionInsertMock).not.toHaveBeenCalled();
  });

  it("refuses a viewer creating a zone under someone else's package", async () => {
    membershipMaybeSingleMock.mockResolvedValue({ data: { role: "viewer" }, error: null });

    const response = await postZone(createZoneRequest(), zoneContext);

    expect(response.status).toBe(403);
    expect(zoneInsertMock).not.toHaveBeenCalled();
  });

  it("still creates packages, versions, and zones for a member, an admin, and an owner", async () => {
    for (const role of ["member", "admin", "owner"]) {
      packageInsertMock.mockClear();
      versionInsertMock.mockClear();
      zoneInsertMock.mockClear();
      membershipMaybeSingleMock.mockResolvedValue({ data: { role }, error: null });

      const packageResponse = await postPackage(createPackageRequest());
      const versionResponse = await postVersion(createVersionRequest(), versionContext);
      const zoneResponse = await postZone(createZoneRequest(), zoneContext);

      expect(packageResponse.status, `${role} should still create packages`).toBe(200);
      expect(versionResponse.status, `${role} should still create versions`).toBe(200);
      expect(zoneResponse.status, `${role} should still create zones`).toBe(201);
      expect(packageInsertMock).toHaveBeenCalledTimes(1);
      expect(versionInsertMock).toHaveBeenCalledTimes(1);
      expect(zoneInsertMock).toHaveBeenCalledTimes(1);
    }
  });

  it("requires authentication at all — these routes previously had none", async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null } });

    expect((await postPackage(createPackageRequest())).status).toBe(401);
    expect((await postVersion(createVersionRequest(), versionContext)).status).toBe(401);
    expect((await postZone(createZoneRequest(), zoneContext)).status).toBe(401);
    expect(packageInsertMock).not.toHaveBeenCalled();
    expect(versionInsertMock).not.toHaveBeenCalled();
    expect(zoneInsertMock).not.toHaveBeenCalled();
  });

  it("does not confirm a workspace exists to a non-member", async () => {
    membershipMaybeSingleMock.mockResolvedValue({ data: null, error: null });

    const response = await postPackage(createPackageRequest());

    expect(response.status).toBe(404);
    expect(packageInsertMock).not.toHaveBeenCalled();
  });
});
