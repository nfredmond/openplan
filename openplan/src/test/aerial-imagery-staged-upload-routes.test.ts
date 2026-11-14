import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AERIAL_IMAGE_MAX_BYTES_ENV, AERIAL_IMAGERY_COLUMNS } from "@/lib/aerial/imagery";
import { buildJpegWithExif } from "./helpers/exif-fixture";

// The workspace storage limit (storage-quota.ts). Room by default; a test that
// is about the limit sets the answer and checks what the route asked.
const checkWorkspaceStorageRoomMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/workspaces/storage-quota", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/workspaces/storage-quota")>()),
  checkWorkspaceStorageRoom: (...args: unknown[]) =>
    checkWorkspaceStorageRoomMock(...args) ?? Promise.resolve({ status: "room", usedBytes: 0, quotaBytes: 5 * 1024 ** 3 }),
}));

/**
 * AERIAL PHOTOS THAT NEVER RIDE IN A FUNCTION BODY.
 *
 * `imagery/upload/start` issues a signed Storage URL; `imagery/upload/complete`
 * reads the staged object back and runs the same `storeAerialImage` the body
 * route runs. Storage, the dedupe probe and the insert all use the service
 * role, so the mission lookup, the membership filter on the MISSION'S
 * workspace and the staged-path check are the access control. The fake below
 * applies the filters it is given and holds a mission in a workspace the
 * caller does not belong to, so dropping a filter changes the answer.
 */

type Row = Record<string, unknown>;
type Filter = { column: string; value: unknown };
type Query = { client: "rls" | "service"; table: string; columns: string | null; filters: Filter[] };
type StorageError = { message: string } | null;
type Stored = Uint8Array | { repeat: Uint8Array; times: number };

const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_USER_ID = "12121212-1212-4212-8212-121212121212";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const MISSION_ID = "44444444-4444-4444-8444-444444444444";
const FOREIGN_MISSION_ID = "55555555-5555-4555-8555-555555555555";
const SECOND_MISSION_ID = "57575757-5757-4757-8757-575757575757";
const UPLOAD_ID = "66666666-6666-4666-8666-666666666666";
const STAGED_PATH = `${WORKSPACE_ID}/staged/${USER_ID}/${UPLOAD_ID}`;
const DEFAULT_MAX = 64 * 1024 * 1024;

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

const mocks = vi.hoisted(() => ({
  getUser: vi.fn<() => Promise<{ data: { user: { id: string } | null } }>>(),
  createSignedUploadUrl: vi.fn<(path: string, options?: { upsert?: boolean }) => Promise<{ data: { signedUrl: string } | null; error: StorageError }>>(),
  createSignedUrl: vi.fn<(path: string, ttl: number) => Promise<{ data: { signedUrl: string } | null; error: StorageError }>>(),
  remove: vi.fn<(paths: string[]) => Promise<{ data: unknown; error: StorageError }>>(),
  upload: vi.fn<(path: string, bytes: Uint8Array, options: Record<string, unknown>) => Promise<{ error: StorageError }>>(),
  fetch: vi.fn<(url: string) => Promise<{ ok: boolean; status: number; body: ReadableStream<Uint8Array> | null }>>(),
  buckets: [] as string[],
}));

let tables: Record<string, Row[]> = {};
let queries: Query[] = [];
let inserts: Array<{ table: string; row: Row; columns: string | null }> = [];
let objects = new Map<string, Stored>();
let uploaded = new Map<string, Uint8Array>();

function makeClient(client: "rls" | "service") {
  return {
    from(table: string) {
      const query: Query = { client, table, columns: null, filters: [] };
      const matches = () =>
        (tables[table] ?? []).filter((row) => query.filters.every((f) => row[f.column] === f.value));
      const chain = {
        select(columns: string) {
          query.columns = columns;
          return chain;
        },
        eq(column: string, value: unknown) {
          query.filters.push({ column, value });
          return chain;
        },
        async maybeSingle() {
          queries.push(query);
          return { data: matches()[0] ?? null, error: null };
        },
        insert(row: Row) {
          const record = { table, row, columns: null as string | null };
          inserts.push(record);
          return {
            select(columns: string) {
              record.columns = columns;
              return {
                async single() {
                  const stored = { ...row, created_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-01T00:00:00Z" };
                  (tables[table] ??= []).push(stored);
                  return { data: stored, error: null };
                },
              };
            },
          };
        },
      };
      return chain;
    },
  };
}

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), requestId: "test" }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ ...makeClient("rls"), auth: { getUser: mocks.getUser } }),
  createServiceRoleClient: () => ({
    ...makeClient("service"),
    storage: {
      from: (bucket: string) => {
        mocks.buckets.push(bucket);
        return {
          createSignedUploadUrl: mocks.createSignedUploadUrl,
          createSignedUrl: mocks.createSignedUrl,
          remove: mocks.remove,
          upload: mocks.upload,
        };
      },
    },
  }),
}));

import { POST as start } from "@/app/api/aerial/missions/[missionId]/imagery/upload/start/route";
import { POST as complete } from "@/app/api/aerial/missions/[missionId]/imagery/upload/complete/route";

function post(step: "start" | "complete", body: unknown, missionId = MISSION_ID) {
  const request = new NextRequest(
    `http://127.0.0.1:3210/api/aerial/missions/${missionId}/imagery/upload/${step}`,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
  );
  return [request, { params: Promise.resolve({ missionId }) }] as const;
}

const startBody = (overrides: Record<string, unknown> = {}) => ({
  filename: "DJI_0042.JPG",
  byteSize: 24 * 1024 * 1024,
  contentType: "image/jpeg",
  ...overrides,
});

const completeBody = (overrides: Record<string, unknown> = {}) => ({
  objectPath: STAGED_PATH,
  byteSize: JPEG_BYTES.byteLength,
  filename: "DJI_0042.JPG",
  ...overrides,
});

function streamOf(stored: Stored): ReadableStream<Uint8Array> {
  let sent = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      // By shape, not `instanceof`: TextEncoder output can come from another realm.
      if (!("repeat" in stored)) {
        controller.enqueue(stored);
        controller.close();
        return;
      }
      if (sent >= stored.times) {
        controller.close();
        return;
      }
      sent += 1;
      controller.enqueue(stored.repeat);
    },
  });
}

beforeEach(() => {
  vi.unstubAllEnvs();
  checkWorkspaceStorageRoomMock.mockReset();
  queries = [];
  inserts = [];
  mocks.buckets = [];
  uploaded = new Map();
  objects = new Map([[STAGED_PATH, JPEG_BYTES]]);
  tables = {
    aerial_missions: [
      { id: MISSION_ID, workspace_id: WORKSPACE_ID },
      { id: SECOND_MISSION_ID, workspace_id: OTHER_WORKSPACE_ID },
      { id: FOREIGN_MISSION_ID, workspace_id: "99999999-9999-4999-8999-999999999999" },
    ],
    workspace_members: [
      { workspace_id: WORKSPACE_ID, user_id: USER_ID, role: "member" },
      { workspace_id: OTHER_WORKSPACE_ID, user_id: USER_ID, role: "owner" },
    ],
    aerial_imagery: [],
  };
  mocks.getUser.mockReset().mockResolvedValue({ data: { user: { id: USER_ID } } });
  mocks.createSignedUploadUrl.mockReset().mockImplementation(async (path) => ({
    data: { signedUrl: `https://storage.example.test/object/upload/sign/aerial-imagery/${path}?token=t` },
    error: null,
  }));
  mocks.createSignedUrl.mockReset().mockImplementation(async (path) =>
    objects.has(path)
      ? { data: { signedUrl: `https://storage.example.test/object/sign/aerial-imagery/${path}?token=t` }, error: null }
      : { data: null, error: { message: "Object not found" } }
  );
  mocks.remove.mockReset().mockImplementation(async (paths) => {
    for (const path of paths) objects.delete(path);
    return { data: [], error: null };
  });
  mocks.upload.mockReset().mockImplementation(async (path, bytes) => {
    uploaded.set(path, bytes);
    return { error: null };
  });
  mocks.fetch.mockReset().mockImplementation(async (url) => {
    const path = decodeURIComponent(new URL(url).pathname.replace("/object/sign/aerial-imagery/", ""));
    const stored = objects.get(path);
    return stored ? { ok: true, status: 200, body: streamOf(stored) } : { ok: false, status: 404, body: null };
  });
  vi.stubGlobal("fetch", mocks.fetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** Nothing reached the final bucket path and no photo row was written. */
function expectNothingStored() {
  expect(mocks.upload).not.toHaveBeenCalled();
  expect(inserts).toEqual([]);
}

describe("POST /api/aerial/missions/[missionId]/imagery/upload/start", () => {
  it("refuses an anonymous caller before signing anything", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    expect((await start(...post("start", startBody()))).status).toBe(401);
    expect(mocks.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("checks membership in the MISSION'S workspace, and refuses a mission there the caller does not belong to", async () => {
    expect((await start(...post("start", startBody(), FOREIGN_MISSION_ID))).status).toBe(403);
    expect(queries).toContainEqual({
      client: "rls",
      table: "workspace_members",
      columns: "role",
      filters: [
        { column: "workspace_id", value: "99999999-9999-4999-8999-999999999999" },
        { column: "user_id", value: USER_ID },
      ],
    });
    expect(mocks.createSignedUploadUrl).not.toHaveBeenCalled();
    expect(checkWorkspaceStorageRoomMock).not.toHaveBeenCalled();
  });

  it("refuses a viewer before the storage check", async () => {
    tables.workspace_members = [{ workspace_id: WORKSPACE_ID, user_id: USER_ID, role: "viewer" }];
    expect((await start(...post("start", startBody()))).status).toBe(403);
    expect(mocks.createSignedUploadUrl).not.toHaveBeenCalled();
    expect(checkWorkspaceStorageRoomMock).not.toHaveBeenCalled();
  });

  it("refuses a declared size over the ceiling, naming the setting, and signs one at it", async () => {
    const over = await start(...post("start", startBody({ byteSize: DEFAULT_MAX + 1 })));
    expect(over.status).toBe(413);
    const body = await over.json();
    expect(body.maxBytes).toBe(DEFAULT_MAX);
    expect(body.error).toContain(AERIAL_IMAGE_MAX_BYTES_ENV);
    expect(mocks.createSignedUploadUrl).not.toHaveBeenCalled();

    expect((await start(...post("start", startBody({ byteSize: DEFAULT_MAX })))).status).toBe(200);
    expect(mocks.createSignedUploadUrl).toHaveBeenCalledTimes(1);
  });

  it("enforces the operator's ceiling, not the default", async () => {
    vi.stubEnv(AERIAL_IMAGE_MAX_BYTES_ENV, String(1024));
    expect((await start(...post("start", startBody({ byteSize: 1025 })))).status).toBe(413);
    expect(mocks.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("refuses an empty file", async () => {
    expect((await start(...post("start", startBody({ byteSize: 0 })))).status).toBe(400);
    expect(mocks.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("refuses before a URL exists when the declared photo would go over the workspace limit", async () => {
    checkWorkspaceStorageRoomMock.mockResolvedValue({
      status: "full",
      usedBytes: 4.99 * 1024 ** 3,
      quotaBytes: 5 * 1024 ** 3,
      message: "This file would put the workspace over its 5 GiB storage limit (5 GiB used).",
    });
    const response = await start(...post("start", startBody()));
    expect(response.status).toBe(413);
    expect(mocks.createSignedUploadUrl).not.toHaveBeenCalled();
    expect(checkWorkspaceStorageRoomMock).toHaveBeenCalledWith(expect.anything(), WORKSPACE_ID, 24 * 1024 * 1024);
  });

  it("refuses before a URL exists when the workspace's use cannot be read", async () => {
    checkWorkspaceStorageRoomMock.mockResolvedValue({ status: "unreadable", message: "Storage use could not be checked.", detail: "x" });
    expect((await start(...post("start", startBody()))).status).toBe(503);
    expect(mocks.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("signs one new object under this user's staged folder in the mission's workspace", async () => {
    const response = await start(...post("start", startBody(), SECOND_MISSION_ID));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { uploadUrl: string; objectPath: string; contentType: string };
    expect(body.objectPath).toMatch(new RegExp(`^${OTHER_WORKSPACE_ID}/staged/${USER_ID}/[0-9a-f-]{36}$`));
    expect(body.uploadUrl).toContain(body.objectPath);
    expect(body.contentType).toBe("application/octet-stream");
    expect(mocks.createSignedUploadUrl).toHaveBeenCalledWith(body.objectPath, { upsert: false });
    expect(mocks.buckets).toEqual(["aerial-imagery"]);
  });
});

describe("POST /api/aerial/missions/[missionId]/imagery/upload/complete", () => {
  it("refuses an anonymous caller and a viewer before reading Storage", async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: null } });
    expect((await complete(...post("complete", completeBody()))).status).toBe(401);
    tables.workspace_members = [{ workspace_id: WORKSPACE_ID, user_id: USER_ID, role: "viewer" }];
    expect((await complete(...post("complete", completeBody()))).status).toBe(403);
    expect(mocks.createSignedUrl).not.toHaveBeenCalled();
    expectNothingStored();
  });

  it.each([
    ["another workspace the caller also belongs to", `${OTHER_WORKSPACE_ID}/staged/${USER_ID}/${UPLOAD_ID}`],
    ["another member", `${WORKSPACE_ID}/staged/${OTHER_USER_ID}/${UPLOAD_ID}`],
    ["a stored mission photo", `${WORKSPACE_ID}/${MISSION_ID}/${UPLOAD_ID}/photo.jpg`],
  ])("will not read a path staged in %s", async (_name, objectPath) => {
    objects.set(objectPath, JPEG_BYTES);
    const response = await complete(...post("complete", completeBody({ objectPath })));
    expect(response.status).toBe(404);
    expect(mocks.createSignedUrl).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
    expectNothingStored();
  });

  it("says the photo is missing when nothing was stored", async () => {
    objects.clear();
    const response = await complete(...post("complete", completeBody()));
    expect(response.status).toBe(409);
    expectNothingStored();
  });

  it("refuses and removes an object that is not the declared size", async () => {
    const response = await complete(...post("complete", completeBody({ byteSize: JPEG_BYTES.byteLength + 1 })));
    expect(response.status).toBe(409);
    expect(mocks.remove).toHaveBeenCalledWith([STAGED_PATH]);
    expect(objects.has(STAGED_PATH)).toBe(false);
    expectNothingStored();
  });

  it("stops reading, refuses and removes an object over the operator's ceiling", async () => {
    vi.stubEnv(AERIAL_IMAGE_MAX_BYTES_ENV, String(1024));
    objects.set(STAGED_PATH, { repeat: new Uint8Array(512), times: 3 });
    // Declared at the ceiling: the stored object is what is measured.
    const response = await complete(...post("complete", completeBody({ byteSize: 1024 })));
    expect(response.status).toBe(413);
    expect((await response.json()).error).toContain(AERIAL_IMAGE_MAX_BYTES_ENV);
    expect(mocks.remove).toHaveBeenCalledWith([STAGED_PATH]);
    expectNothingStored();
  });

  it("refuses and removes bytes that are not a JPEG, PNG or TIFF, whatever the name says", async () => {
    const notAPhoto = new TextEncoder().encode("%PDF-1.7 not a photo");
    objects.set(STAGED_PATH, notAPhoto);
    const response = await complete(...post("complete", completeBody({ byteSize: notAPhoto.byteLength })));
    expect(response.status).toBe(415);
    expect(mocks.remove).toHaveBeenCalledWith([STAGED_PATH]);
    expect(objects.has(STAGED_PATH)).toBe(false);
    expectNothingStored();
  });

  it("re-checks the workspace limit with the measured size after removing the staged copy", async () => {
    checkWorkspaceStorageRoomMock.mockResolvedValue({
      status: "full",
      usedBytes: 5 * 1024 ** 3,
      quotaBytes: 5 * 1024 ** 3,
      message: "This file would put the workspace over its 5 GiB storage limit (5 GiB used).",
    });
    const response = await complete(...post("complete", completeBody()));
    expect(response.status).toBe(413);
    expect(checkWorkspaceStorageRoomMock).toHaveBeenCalledWith(expect.anything(), WORKSPACE_ID, JPEG_BYTES.byteLength);
    // Removed before the check, so the check never counts the staged copy.
    expect(mocks.remove.mock.invocationCallOrder[0]).toBeLessThan(checkWorkspaceStorageRoomMock.mock.invocationCallOrder[0]);
    expect(objects.has(STAGED_PATH)).toBe(false);
    expectNothingStored();
  });

  it("answers the existing row for the same bytes on the same mission, and keeps no copy", async () => {
    tables.aerial_imagery = [{ id: "existing", mission_id: MISSION_ID, checksum_sha256: JPEG_SHA256 }];
    const response = await complete(...post("complete", completeBody()));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ deduped: true, imagery: { id: "existing" } });
    expect(queries).toContainEqual({
      client: "service",
      table: "aerial_imagery",
      columns: AERIAL_IMAGERY_COLUMNS,
      filters: [
        { column: "mission_id", value: MISSION_ID },
        { column: "checksum_sha256", value: JPEG_SHA256 },
      ],
    });
    expect(objects.has(STAGED_PATH)).toBe(false);
    expectNothingStored();
  });

  it("stores the measured bytes once, with their checksum and EXIF, through the shared write", async () => {
    const response = await complete(...post("complete", completeBody()));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ deduped: false, imagery: { gps_lat: 12.5, gps_lon: 45.25 } });

    expect(mocks.upload).toHaveBeenCalledTimes(1);
    const [finalPath, bytes, options] = mocks.upload.mock.calls[0];
    expect(finalPath).toMatch(new RegExp(`^${WORKSPACE_ID}/${MISSION_ID}/[0-9a-f-]{36}/DJI_0042\\.JPG$`));
    expect(Array.from(bytes)).toEqual(Array.from(JPEG_BYTES));
    expect(options).toEqual({ contentType: "image/jpeg", upsert: false });

    expect(inserts).toHaveLength(1);
    expect(inserts[0].columns).toBe(AERIAL_IMAGERY_COLUMNS);
    expect(inserts[0].row).toMatchObject({
      workspace_id: WORKSPACE_ID,
      mission_id: MISSION_ID,
      storage_bucket: "aerial-imagery",
      storage_path: finalPath,
      original_filename: "DJI_0042.JPG",
      byte_size: JPEG_BYTES.byteLength,
      checksum_sha256: JPEG_SHA256,
      content_type: "image/jpeg",
      captured_at: "2026-06-01T14:30:00-07:00",
      camera_make: "ExampleMaker",
      uploaded_by: USER_ID,
    });

    // The staged object is consumed before the stored copy is written, so a
    // repeated complete call finds nothing to store twice.
    expect(mocks.remove).toHaveBeenCalledWith([STAGED_PATH]);
    expect(mocks.remove.mock.invocationCallOrder[0]).toBeLessThan(mocks.upload.mock.invocationCallOrder[0]);
    expect((await complete(...post("complete", completeBody()))).status).toBe(409);
    expect(mocks.upload).toHaveBeenCalledTimes(1);
  });
});
