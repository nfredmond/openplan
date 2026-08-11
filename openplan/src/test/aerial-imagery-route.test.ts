import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { AERIAL_IMAGE_MAX_BYTES_ENV, AERIAL_IMAGERY_COLUMNS } from "@/lib/aerial/imagery";
import { buildJpegWithExif } from "./helpers/exif-fixture";

/**
 * GET/POST /api/aerial/missions/[missionId]/imagery — the photo list and the
 * upload door.
 *
 * The service-role fakes RECORD what was asked of them (projections, inserted
 * rows, storage paths, the workspace the membership check named), because the
 * `.eq()` chain and the explicit checks ARE the access control on a
 * service-role write path — a fake that records nothing proves none of it.
 */

const createClientMock = vi.fn();
const createServiceRoleClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const mockAudit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const authGetUserMock = vi.fn();
const missionMaybeSingleMock = vi.fn();
const membershipMaybeSingleMock = vi.fn();
const listResultMock = vi.fn();
const dedupeMaybeSingleMock = vi.fn();
const insertSingleMock = vi.fn();
const storageUploadMock = vi.fn();
const storageRemoveMock = vi.fn();

let capturedListSelects: string[] = [];
let capturedServiceSelects: string[] = [];
let capturedInsertSelects: string[] = [];
let capturedInserts: Array<Record<string, unknown>> = [];
let capturedMembershipWorkspaceIds: unknown[] = [];
let capturedDedupeFilters: Array<Record<string, unknown>> = [];
let capturedStorageBuckets: string[] = [];
let capturedUploadPaths: Array<{ path: string; options: Record<string, unknown> }> = [];
let capturedRemovePaths: string[][] = [];

const userFromMock = vi.fn((table: string) => {
  if (table === "aerial_missions") {
    return { select: () => ({ eq: () => ({ maybeSingle: missionMaybeSingleMock }) }) };
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
  if (table === "aerial_imagery") {
    return {
      select: (columns: string) => {
        capturedListSelects.push(columns);
        return { eq: () => ({ order: listResultMock }) };
      },
    };
  }
  throw new Error(`Unexpected user-client table: ${table}`);
});

const serviceFromMock = vi.fn((table: string) => {
  if (table === "aerial_imagery") {
    return {
      select: (columns: string) => {
        capturedServiceSelects.push(columns);
        return {
          eq: (column1: string, value1: unknown) => ({
            eq: (column2: string, value2: unknown) => {
              capturedDedupeFilters.push({ [column1]: value1, [column2]: value2 });
              return { maybeSingle: dedupeMaybeSingleMock };
            },
          }),
        };
      },
      insert: (row: Record<string, unknown>) => {
        capturedInserts.push(row);
        return {
          select: (columns: string) => {
            capturedInsertSelects.push(columns);
            return { single: insertSingleMock };
          },
        };
      },
    };
  }
  throw new Error(`Unexpected service-client table: ${table}`);
});

const serviceStorageFromMock = vi.fn((bucket: string) => {
  capturedStorageBuckets.push(bucket);
  return {
    upload: (path: string, _bytes: unknown, options: Record<string, unknown>) => {
      capturedUploadPaths.push({ path, options });
      return storageUploadMock();
    },
    remove: (paths: string[]) => {
      capturedRemovePaths.push(paths);
      return storageRemoveMock();
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

import { GET as listImagery, POST as uploadImagery } from "@/app/api/aerial/missions/[missionId]/imagery/route";

const MISSION_ID = "22222222-2222-4222-8222-222222222222";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "00000000-0000-4000-8000-000000000001";

// A real JPEG with real EXIF (synthetic coordinates: 12°30'N, 45°15'E).
const JPEG_BYTES = buildJpegWithExif({
  make: "ExampleMaker",
  model: "ExampleModel 3",
  dateTimeOriginal: "2026:06:01 14:30:00",
  offsetTimeOriginal: "-07:00",
  gps: {
    latDms: [
      [12, 1],
      [30, 1],
      [0, 1],
    ],
    latRef: "N",
    lonDms: [
      [45, 1],
      [15, 1],
      [0, 1],
    ],
    lonRef: "E",
  },
});
const JPEG_SHA256 = createHash("sha256").update(JPEG_BYTES).digest("hex");

function context() {
  return { params: Promise.resolve({ missionId: MISSION_ID }) };
}

function getRequest() {
  return new NextRequest(`http://localhost/api/aerial/missions/${MISSION_ID}/imagery`);
}

function postRequest(bytes: Uint8Array, filename = "photo.jpg") {
  return new NextRequest(
    `http://localhost/api/aerial/missions/${MISSION_ID}/imagery?filename=${encodeURIComponent(filename)}`,
    { method: "POST", body: Buffer.from(bytes) }
  );
}

function storedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    workspace_id: WORKSPACE_ID,
    mission_id: MISSION_ID,
    storage_bucket: "aerial-imagery",
    storage_path: `${WORKSPACE_ID}/${MISSION_ID}/11111111-1111-4111-8111-111111111111/photo.jpg`,
    original_filename: "photo.jpg",
    byte_size: JPEG_BYTES.length,
    checksum_sha256: JPEG_SHA256,
    content_type: "image/jpeg",
    captured_at: "2026-06-01T14:30:00-07:00",
    gps_lat: 12.5,
    gps_lon: 45.25,
    gps_altitude_m: null,
    camera_make: "ExampleMaker",
    camera_model: "ExampleModel 3",
    uploaded_by: USER_ID,
    created_at: "2026-08-11T09:00:00Z",
    updated_at: "2026-08-11T09:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  capturedListSelects = [];
  capturedServiceSelects = [];
  capturedInsertSelects = [];
  capturedInserts = [];
  capturedMembershipWorkspaceIds = [];
  capturedDedupeFilters = [];
  capturedStorageBuckets = [];
  capturedUploadPaths = [];
  capturedRemovePaths = [];

  createApiAuditLoggerMock.mockReturnValue(mockAudit);
  createClientMock.mockResolvedValue({ auth: { getUser: authGetUserMock }, from: userFromMock });
  createServiceRoleClientMock.mockReturnValue({
    from: serviceFromMock,
    storage: { from: serviceStorageFromMock },
  });
  authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
  missionMaybeSingleMock.mockResolvedValue({
    data: { id: MISSION_ID, workspace_id: WORKSPACE_ID },
    error: null,
  });
  membershipMaybeSingleMock.mockResolvedValue({ data: { role: "editor" }, error: null });
  listResultMock.mockResolvedValue({ data: [storedRow()], error: null });
  dedupeMaybeSingleMock.mockResolvedValue({ data: null, error: null });
  insertSingleMock.mockResolvedValue({ data: storedRow(), error: null });
  storageUploadMock.mockResolvedValue({ error: null });
  storageRemoveMock.mockResolvedValue({ error: null });
});

afterEach(() => {
  delete process.env[AERIAL_IMAGE_MAX_BYTES_ENV];
});

describe("GET /api/aerial/missions/[missionId]/imagery", () => {
  it("lists the mission's photos with the full projection, by name", async () => {
    const response = await listImagery(getRequest(), context());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.imagery).toHaveLength(1);
    expect(body.imagery[0].gps_lat).toBe(12.5);
    expect(capturedListSelects).toEqual([AERIAL_IMAGERY_COLUMNS]);
  });

  it("checks membership against the MISSION'S OWN workspace, not anything client-supplied", async () => {
    await listImagery(getRequest(), context());
    expect(capturedMembershipWorkspaceIds).toEqual([WORKSPACE_ID]);
  });

  it("does not present a failed read as an empty photo list", async () => {
    listResultMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    const response = await listImagery(getRequest(), context());
    expect(response.status).toBe(500);
    expect(mockAudit.error).toHaveBeenCalledWith(
      "aerial_imagery_list_failed",
      expect.objectContaining({ missionId: MISSION_ID })
    );
  });

  it("denies a non-member", async () => {
    membershipMaybeSingleMock.mockResolvedValue({ data: null, error: null });
    const response = await listImagery(getRequest(), context());
    expect(response.status).toBe(403);
  });

  it("lets a viewer read — this is workspace content", async () => {
    membershipMaybeSingleMock.mockResolvedValue({ data: { role: "viewer" }, error: null });
    const response = await listImagery(getRequest(), context());
    expect(response.status).toBe(200);
  });
});

describe("POST /api/aerial/missions/[missionId]/imagery", () => {
  it("stores the photo and records what the FILE said — checksum, sniffed type, EXIF evidence", async () => {
    const response = await uploadImagery(postRequest(JPEG_BYTES), context());
    expect(response.status).toBe(201);
    expect((await response.json()).deduped).toBe(false);

    expect(capturedInserts).toHaveLength(1);
    const row = capturedInserts[0];
    expect(row).toMatchObject({
      workspace_id: WORKSPACE_ID,
      mission_id: MISSION_ID,
      storage_bucket: "aerial-imagery",
      original_filename: "photo.jpg",
      byte_size: JPEG_BYTES.length,
      checksum_sha256: JPEG_SHA256,
      // The BYTES decide the type, not the request header.
      content_type: "image/jpeg",
      captured_at: "2026-06-01T14:30:00-07:00",
      gps_lat: 12.5,
      gps_lon: 45.25,
      camera_make: "ExampleMaker",
      camera_model: "ExampleModel 3",
      uploaded_by: USER_ID,
    });

    // Path shape: <workspace>/<mission>/<imagery uuid>/<sanitized filename>.
    expect(capturedStorageBuckets).toContain("aerial-imagery");
    expect(capturedUploadPaths).toHaveLength(1);
    expect(capturedUploadPaths[0].path).toMatch(
      new RegExp(`^${WORKSPACE_ID}/${MISSION_ID}/${String(row.id)}/photo\\.jpg$`)
    );
    expect(capturedInsertSelects).toEqual([AERIAL_IMAGERY_COLUMNS]);
    expect(mockAudit.info).toHaveBeenCalledWith(
      "aerial_imagery_uploaded",
      expect.objectContaining({ missionId: MISSION_ID, hasLocation: true })
    );
  });

  it("stores nulls, not inventions, for a photo whose file recorded nothing", async () => {
    const bare = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const response = await uploadImagery(postRequest(bare, "no-exif.jpg"), context());
    expect(response.status).toBe(201);
    const row = capturedInserts[0];
    expect(row.gps_lat).toBeNull();
    expect(row.gps_lon).toBeNull();
    expect(row.captured_at).toBeNull();
    expect(row.camera_make).toBeNull();
  });

  it("answers the existing row as a no-op when the same bytes are uploaded twice", async () => {
    dedupeMaybeSingleMock.mockResolvedValue({ data: storedRow(), error: null });
    const response = await uploadImagery(postRequest(JPEG_BYTES), context());
    expect(response.status).toBe(200);
    expect((await response.json()).deduped).toBe(true);
    expect(capturedDedupeFilters[0]).toEqual({
      mission_id: MISSION_ID,
      checksum_sha256: JPEG_SHA256,
    });
    expect(capturedUploadPaths).toHaveLength(0);
    expect(capturedInserts).toHaveLength(0);
  });

  it("refuses a file whose bytes are not an image, whatever the header claimed", async () => {
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
    const response = await uploadImagery(postRequest(zip, "photos.zip"), context());
    expect(response.status).toBe(415);
    expect(capturedUploadPaths).toHaveLength(0);
    expect(capturedInserts).toHaveLength(0);
  });

  it("refuses an empty body", async () => {
    const response = await uploadImagery(postRequest(new Uint8Array(0)), context());
    expect(response.status).toBe(400);
    expect(capturedInserts).toHaveLength(0);
  });

  it("enforces the operator's ceiling and names the env var in the refusal", async () => {
    process.env[AERIAL_IMAGE_MAX_BYTES_ENV] = "4";
    const response = await uploadImagery(postRequest(JPEG_BYTES), context());
    expect(response.status).toBe(413);
    const body = await response.json();
    expect(body.error).toContain(AERIAL_IMAGE_MAX_BYTES_ENV);
    expect(capturedUploadPaths).toHaveLength(0);
    expect(capturedInserts).toHaveLength(0);
  });

  it("honours a raised ceiling — the env RAISES the enforced limit, it does not just lower it", async () => {
    process.env[AERIAL_IMAGE_MAX_BYTES_ENV] = String(JPEG_BYTES.length + 10);
    const response = await uploadImagery(postRequest(JPEG_BYTES), context());
    expect(response.status).toBe(201);
  });

  it("denies a viewer before reading a byte of the body", async () => {
    membershipMaybeSingleMock.mockResolvedValue({ data: { role: "viewer" }, error: null });
    const response = await uploadImagery(postRequest(JPEG_BYTES), context());
    expect(response.status).toBe(403);
    expect((await response.json()).error).toMatch(/read-only/i);
    expect(capturedUploadPaths).toHaveLength(0);
    expect(capturedInserts).toHaveLength(0);
  });

  it("denies a non-member", async () => {
    membershipMaybeSingleMock.mockResolvedValue({ data: null, error: null });
    const response = await uploadImagery(postRequest(JPEG_BYTES), context());
    expect(response.status).toBe(403);
    expect(capturedInserts).toHaveLength(0);
  });

  it("requires the filename parameter", async () => {
    const request = new NextRequest(`http://localhost/api/aerial/missions/${MISSION_ID}/imagery`, {
      method: "POST",
      body: Buffer.from(JPEG_BYTES),
    });
    const response = await uploadImagery(request, context());
    expect(response.status).toBe(400);
  });

  it("removes the orphaned object when the row insert fails", async () => {
    insertSingleMock.mockResolvedValue({ data: null, error: { message: "refused", code: "23514" } });
    const response = await uploadImagery(postRequest(JPEG_BYTES), context());
    expect(response.status).toBe(500);
    expect(capturedRemovePaths).toHaveLength(1);
    expect(capturedRemovePaths[0][0]).toBe(capturedUploadPaths[0].path);
    expect(mockAudit.error).toHaveBeenCalledWith(
      "aerial_imagery_insert_failed",
      expect.objectContaining({ missionId: MISSION_ID, code: "23514" })
    );
  });

  it("treats losing the unique-constraint race as the dedupe outcome arriving late", async () => {
    insertSingleMock.mockResolvedValue({ data: null, error: { message: "duplicate", code: "23505" } });
    // The re-select after the race finds the winner.
    dedupeMaybeSingleMock
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: storedRow(), error: null });
    const response = await uploadImagery(postRequest(JPEG_BYTES), context());
    expect(response.status).toBe(200);
    expect((await response.json()).deduped).toBe(true);
    // And the losing upload's bytes were cleaned up.
    expect(capturedRemovePaths).toHaveLength(1);
  });
});
