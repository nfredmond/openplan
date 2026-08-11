import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * DELETE /api/aerial/missions/[missionId]/imagery/[imageryId] and its
 * /download sibling.
 *
 * The delete precondition under test is the honest one the route header
 * argues: once ANY processing job exists for the mission, OpenPlan cannot
 * prove a photo is NOT part of the evidence under a processed output, so it
 * refuses — and a FAILED job count is a 500, never treated as zero, because
 * deleting evidence on the strength of an unanswered question is the
 * read-failure-as-empty defect with real destruction behind it.
 */

const createClientMock = vi.fn();
const createServiceRoleClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const mockAudit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const authGetUserMock = vi.fn();
const userMissionMaybeSingleMock = vi.fn();
const membershipMaybeSingleMock = vi.fn();
const serviceMissionMaybeSingleMock = vi.fn();
const imageryMaybeSingleMock = vi.fn();
const jobCountResultMock = vi.fn();
const deleteEqMock = vi.fn();
const storageRemoveMock = vi.fn();
const createSignedUrlMock = vi.fn();

let capturedImageryFilters: Array<Record<string, unknown>> = [];
let capturedDeleteIds: unknown[] = [];
let capturedRemovePaths: string[][] = [];
let capturedSignRequests: Array<{ bucket: string; path: string; ttl: number; options: unknown }> = [];
let capturedMembershipWorkspaceIds: unknown[] = [];

const userFromMock = vi.fn((table: string) => {
  if (table === "aerial_missions") {
    return { select: () => ({ eq: () => ({ maybeSingle: userMissionMaybeSingleMock }) }) };
  }
  if (table === "workspace_members") {
    return {
      select: () => ({
        eq: (_column: string, workspaceId: unknown) => {
          capturedMembershipWorkspaceIds.push(workspaceId);
          return { eq: () => ({ maybeSingle: membershipMaybeSingleMock }) };
        },
      }),
    };
  }
  throw new Error(`Unexpected user-client table: ${table}`);
});

let signBucket = "";
const serviceFromMock = vi.fn((table: string) => {
  if (table === "aerial_missions") {
    return { select: () => ({ eq: () => ({ maybeSingle: serviceMissionMaybeSingleMock }) }) };
  }
  if (table === "aerial_imagery") {
    return {
      select: () => ({
        eq: (column1: string, value1: unknown) => ({
          eq: (column2: string, value2: unknown) => {
            capturedImageryFilters.push({ [column1]: value1, [column2]: value2 });
            return { maybeSingle: imageryMaybeSingleMock };
          },
        }),
      }),
      delete: () => ({
        eq: (_column: string, id: unknown) => {
          capturedDeleteIds.push(id);
          return deleteEqMock();
        },
      }),
    };
  }
  if (table === "aerial_processing_jobs") {
    return { select: () => ({ eq: jobCountResultMock }) };
  }
  throw new Error(`Unexpected service-client table: ${table}`);
});

const serviceStorageFromMock = vi.fn((bucket: string) => {
  signBucket = bucket;
  return {
    remove: (paths: string[]) => {
      capturedRemovePaths.push(paths);
      return storageRemoveMock();
    },
    createSignedUrl: (path: string, ttl: number, options: unknown) => {
      capturedSignRequests.push({ bucket: signBucket, path, ttl, options });
      return createSignedUrlMock();
    },
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
  createServiceRoleClient: (...args: unknown[]) => createServiceRoleClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

import { DELETE as deleteImagery } from "@/app/api/aerial/missions/[missionId]/imagery/[imageryId]/route";
import { GET as downloadImagery } from "@/app/api/aerial/missions/[missionId]/imagery/[imageryId]/download/route";

const MISSION_ID = "22222222-2222-4222-8222-222222222222";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const IMAGERY_ID = "44444444-4444-4444-8444-444444444444";
const USER_ID = "00000000-0000-4000-8000-000000000001";

function context() {
  return { params: Promise.resolve({ missionId: MISSION_ID, imageryId: IMAGERY_ID }) };
}

function deleteRequest() {
  return new NextRequest(`http://localhost/api/aerial/missions/${MISSION_ID}/imagery/${IMAGERY_ID}`, {
    method: "DELETE",
  });
}

function downloadRequest() {
  return new NextRequest(
    `http://localhost/api/aerial/missions/${MISSION_ID}/imagery/${IMAGERY_ID}/download`
  );
}

function imageryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: IMAGERY_ID,
    workspace_id: WORKSPACE_ID,
    mission_id: MISSION_ID,
    storage_bucket: "aerial-imagery",
    storage_path: `${WORKSPACE_ID}/${MISSION_ID}/${IMAGERY_ID}/photo.jpg`,
    original_filename: "photo.jpg",
    byte_size: 123456,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  capturedImageryFilters = [];
  capturedDeleteIds = [];
  capturedRemovePaths = [];
  capturedSignRequests = [];
  capturedMembershipWorkspaceIds = [];

  createApiAuditLoggerMock.mockReturnValue(mockAudit);
  createClientMock.mockResolvedValue({ auth: { getUser: authGetUserMock }, from: userFromMock });
  createServiceRoleClientMock.mockReturnValue({
    from: serviceFromMock,
    storage: { from: serviceStorageFromMock },
  });
  authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
  userMissionMaybeSingleMock.mockResolvedValue({
    data: { id: MISSION_ID, workspace_id: WORKSPACE_ID },
    error: null,
  });
  serviceMissionMaybeSingleMock.mockResolvedValue({
    data: { id: MISSION_ID, workspace_id: WORKSPACE_ID },
    error: null,
  });
  membershipMaybeSingleMock.mockResolvedValue({ data: { role: "editor" }, error: null });
  imageryMaybeSingleMock.mockResolvedValue({ data: imageryRow(), error: null });
  jobCountResultMock.mockResolvedValue({ count: 0, error: null });
  deleteEqMock.mockResolvedValue({ error: null });
  storageRemoveMock.mockResolvedValue({ error: null });
  createSignedUrlMock.mockResolvedValue({
    data: { signedUrl: "https://storage.example.test/signed/photo.jpg?token=abc" },
    error: null,
  });
});

describe("DELETE /api/aerial/missions/[missionId]/imagery/[imageryId]", () => {
  it("deletes a photo no processing job could have consumed: row first, bytes second", async () => {
    const response = await deleteImagery(deleteRequest(), context());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: true });
    expect(capturedDeleteIds).toEqual([IMAGERY_ID]);
    expect(capturedRemovePaths).toEqual([[`${WORKSPACE_ID}/${MISSION_ID}/${IMAGERY_ID}/photo.jpg`]]);
    // Scoped lookup: the imagery id was dereferenced through ITS mission.
    expect(capturedImageryFilters[0]).toEqual({ id: IMAGERY_ID, mission_id: MISSION_ID });
    expect(mockAudit.info).toHaveBeenCalledWith(
      "aerial_imagery_deleted",
      expect.objectContaining({ missionId: MISSION_ID, imageryId: IMAGERY_ID })
    );
  });

  it("refuses once processing has been dispatched — the photo may be evidence under an output", async () => {
    jobCountResultMock.mockResolvedValue({ count: 2, error: null });
    const response = await deleteImagery(deleteRequest(), context());
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toBe("photo_is_potential_processing_evidence");
    expect(body.detail).toMatch(/source evidence/i);
    expect(capturedDeleteIds).toEqual([]);
    expect(capturedRemovePaths).toEqual([]);
  });

  it("treats a FAILED job count as a refusal, never as zero", async () => {
    jobCountResultMock.mockResolvedValue({ count: null, error: { message: "boom" } });
    const response = await deleteImagery(deleteRequest(), context());
    expect(response.status).toBe(500);
    expect((await response.json()).error).toMatch(/not deleted/i);
    expect(capturedDeleteIds).toEqual([]);
  });

  it("denies a viewer", async () => {
    membershipMaybeSingleMock.mockResolvedValue({ data: { role: "viewer" }, error: null });
    const response = await deleteImagery(deleteRequest(), context());
    expect(response.status).toBe(403);
    expect(capturedDeleteIds).toEqual([]);
  });

  it("denies a non-member", async () => {
    membershipMaybeSingleMock.mockResolvedValue({ data: null, error: null });
    const response = await deleteImagery(deleteRequest(), context());
    expect(response.status).toBe(403);
    expect(capturedDeleteIds).toEqual([]);
  });

  it("checks membership against the mission's own workspace", async () => {
    await deleteImagery(deleteRequest(), context());
    expect(capturedMembershipWorkspaceIds).toEqual([WORKSPACE_ID]);
  });

  it("answers 404 for a photo that is not this mission's", async () => {
    imageryMaybeSingleMock.mockResolvedValue({ data: null, error: null });
    const response = await deleteImagery(deleteRequest(), context());
    expect(response.status).toBe(404);
    expect(capturedDeleteIds).toEqual([]);
  });

  it("refuses a forged row whose workspace does not match the mission's", async () => {
    imageryMaybeSingleMock.mockResolvedValue({
      data: imageryRow({ workspace_id: "55555555-5555-4555-8555-555555555555" }),
      error: null,
    });
    const response = await deleteImagery(deleteRequest(), context());
    expect(response.status).toBe(404);
    expect(capturedDeleteIds).toEqual([]);
  });

  it("still answers deleted when only the object removal fails, and says so in the audit", async () => {
    storageRemoveMock.mockResolvedValue({ error: { message: "gone already" } });
    const response = await deleteImagery(deleteRequest(), context());
    expect(response.status).toBe(200);
    expect(mockAudit.warn).toHaveBeenCalledWith(
      "aerial_imagery_object_remove_failed",
      expect.objectContaining({ imageryId: IMAGERY_ID })
    );
  });
});

describe("GET /api/aerial/missions/[missionId]/imagery/[imageryId]/download", () => {
  it("redirects a member to a short-lived signed URL scoped to the row's own bucket and path", async () => {
    const response = await downloadImagery(downloadRequest(), context());
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://storage.example.test/signed/photo.jpg?token=abc"
    );
    expect(capturedSignRequests).toEqual([
      {
        bucket: "aerial-imagery",
        path: `${WORKSPACE_ID}/${MISSION_ID}/${IMAGERY_ID}/photo.jpg`,
        ttl: 15 * 60,
        options: { download: "photo.jpg" },
      },
    ]);
  });

  it("lets a viewer download — reads include every workspace role", async () => {
    membershipMaybeSingleMock.mockResolvedValue({ data: { role: "viewer" }, error: null });
    const response = await downloadImagery(downloadRequest(), context());
    expect(response.status).toBe(307);
  });

  it("denies a non-member before signing anything", async () => {
    membershipMaybeSingleMock.mockResolvedValue({ data: null, error: null });
    const response = await downloadImagery(downloadRequest(), context());
    expect(response.status).toBe(403);
    expect(capturedSignRequests).toEqual([]);
  });

  it("will not sign for an object outside the row's own prefix", async () => {
    imageryMaybeSingleMock.mockResolvedValue({
      data: imageryRow({ storage_path: `${WORKSPACE_ID}/other-mission/${IMAGERY_ID}/photo.jpg` }),
      error: null,
    });
    const response = await downloadImagery(downloadRequest(), context());
    expect(response.status).toBe(404);
    expect(capturedSignRequests).toEqual([]);
  });

  it("will not sign for another bucket", async () => {
    imageryMaybeSingleMock.mockResolvedValue({
      data: imageryRow({ storage_bucket: "aerial-artifacts" }),
      error: null,
    });
    const response = await downloadImagery(downloadRequest(), context());
    expect(response.status).toBe(404);
    expect(capturedSignRequests).toEqual([]);
  });

  it("will not sign for a traversal-shaped path", async () => {
    imageryMaybeSingleMock.mockResolvedValue({
      data: imageryRow({
        storage_path: `${WORKSPACE_ID}/${MISSION_ID}/${IMAGERY_ID}/../../../secrets`,
      }),
      error: null,
    });
    const response = await downloadImagery(downloadRequest(), context());
    expect(response.status).toBe(404);
    expect(capturedSignRequests).toEqual([]);
  });

  it("answers 404 for a photo that is not this mission's", async () => {
    imageryMaybeSingleMock.mockResolvedValue({ data: null, error: null });
    const response = await downloadImagery(downloadRequest(), context());
    expect(response.status).toBe(404);
  });

  it("does not present a failed row read as an absent photo", async () => {
    imageryMaybeSingleMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    const response = await downloadImagery(downloadRequest(), context());
    expect(response.status).toBe(500);
  });
});
