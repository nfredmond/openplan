import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The workspace storage limit (storage-quota.ts). Room by default; a test that
// is about the limit sets the answer and checks what the route asked.
const checkWorkspaceStorageRoomMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/workspaces/storage-quota", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/workspaces/storage-quota")>()),
  checkWorkspaceStorageRoom: (...args: unknown[]) =>
    checkWorkspaceStorageRoomMock(...args) ?? Promise.resolve({ status: "room", usedBytes: 0, quotaBytes: 5 * 1024 ** 3 }),
}));
// Every test starts from the default (room), whatever ran before it.
beforeEach(() => checkWorkspaceStorageRoomMock.mockReset());

/**
 * THE GTFS UPLOAD THAT NEVER RIDES IN A FUNCTION BODY.
 *
 * `upload/start` issues a signed Storage URL; `upload/complete` reads the
 * stored object back and runs the existing ingest. Both use the service role
 * for the feed lookup and for Storage, so the `.eq("workspace_id", ...)` filter
 * and the staged-path check are the access control, entire. The fake below
 * records every query and APPLIES its filters, and holds a feed in another
 * workspace, so deleting a filter changes the answer instead of passing.
 */

type Row = Record<string, unknown>;
type Filter = { column: string; value: unknown };
type Query = { client: "rls" | "service"; table: string; columns: string | null; filters: Filter[] };
type StorageError = { message: string } | null;
type SignedUrlResult = { data: { signedUrl: string } | null; error: StorageError };
type IngestCall = {
  workspaceId: string;
  feedId: string | null;
  requestedBy: string | null;
  provisionalName: string;
  source: { kind: string; bytes?: Uint8Array; contentType?: string; filename?: string | null };
};
type IngestResult = Record<string, unknown>;

const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_USER_ID = "12121212-1212-4212-8212-121212121212";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const OWN_FEED_ID = "44444444-4444-4444-8444-444444444444";
const FOREIGN_FEED_ID = "55555555-5555-4555-8555-555555555555";
const UPLOAD_ID = "66666666-6666-4666-8666-666666666666";
const STAGED_PATH = `${WORKSPACE_ID}/staged/${USER_ID}/${UPLOAD_ID}.zip`;
const MAX = 200 * 1024 * 1024;

const mocks = vi.hoisted(() => ({
  getUser: vi.fn<() => Promise<{ data: { user: { id: string } | null } }>>(),
  runGtfsIngest: vi.fn<(params: IngestCall) => Promise<IngestResult>>(),
  createSignedUploadUrl: vi.fn<(path: string, options?: { upsert?: boolean }) => Promise<SignedUrlResult>>(),
  createSignedUrl: vi.fn<(path: string, ttl: number) => Promise<SignedUrlResult>>(),
  remove: vi.fn<(paths: string[]) => Promise<{ data: unknown; error: StorageError }>>(),
  fetch: vi.fn<(url: string) => Promise<{ ok: boolean; status: number; body: ReadableStream<Uint8Array> | null }>>(),
  buckets: [] as string[],
}));

let tables: Record<string, Row[]> = {};
let queries: Query[] = [];
let objects = new Map<string, Uint8Array | { repeat: Uint8Array; times: number }>();

function makeClient(client: "rls" | "service") {
  return {
    from(table: string) {
      const query: Query = { client, table, columns: null, filters: [] };
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
          const rows = (tables[table] ?? []).filter((row) => query.filters.every((f) => row[f.column] === f.value));
          return { data: rows[0] ?? null, error: null };
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
        };
      },
    },
  }),
}));

vi.mock("@/lib/gtfs/ingest", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/gtfs/ingest")>();
  return { ...actual, runGtfsIngest: mocks.runGtfsIngest };
});

import { POST as start } from "@/app/api/gtfs/feeds/upload/start/route";
import { POST as complete } from "@/app/api/gtfs/feeds/upload/complete/route";
import { BODY_LIMITS } from "@/lib/http/body-limit";

function post(path: string, body: unknown) {
  return new NextRequest(`http://127.0.0.1:3210/api/gtfs/feeds/upload/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const startBody = (overrides: Record<string, unknown> = {}) => ({
  workspaceId: WORKSPACE_ID,
  filename: "cta.zip",
  byteSize: 94 * 1024 * 1024,
  contentType: "application/zip",
  ...overrides,
});

const completeBody = (overrides: Record<string, unknown> = {}) => ({
  workspaceId: WORKSPACE_ID,
  objectPath: STAGED_PATH,
  byteSize: 5,
  filename: "cta.zip",
  ...overrides,
});

function streamOf(stored: Uint8Array | { repeat: Uint8Array; times: number }): ReadableStream<Uint8Array> {
  let sent = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (stored instanceof Uint8Array) {
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
  vi.stubEnv("OPENPLAN_GTFS_MANAGED_INGESTION", undefined);
  queries = [];
  mocks.buckets = [];
  objects = new Map([[STAGED_PATH, new Uint8Array([80, 75, 3, 4, 9])]]);
  tables = {
    workspace_members: [
      { workspace_id: WORKSPACE_ID, user_id: USER_ID, role: "member" },
      { workspace_id: OTHER_WORKSPACE_ID, user_id: USER_ID, role: "owner" },
    ],
    gtfs_feeds: [
      { id: OWN_FEED_ID, workspace_id: WORKSPACE_ID },
      { id: FOREIGN_FEED_ID, workspace_id: OTHER_WORKSPACE_ID },
    ],
  };
  mocks.getUser.mockReset().mockResolvedValue({ data: { user: { id: USER_ID } } });
  mocks.runGtfsIngest.mockReset().mockResolvedValue({
    ok: true,
    feedId: OWN_FEED_ID,
    versionId: "77777777-7777-4777-8777-777777777777",
    createdFeed: true,
    adoption: { adopted: true },
    displayName: "CTA",
    routeServiceLevelRows: 3,
    stopServiceLevelRows: 9,
    droppedForMissingCoordinates: 0,
    warnings: [],
    caveats: ["caveat"],
    checksumSha256: "a".repeat(64),
    byteSize: 5,
    bytesStored: true,
    bytesNotStoredReason: null,
  });
  mocks.createSignedUploadUrl.mockReset().mockImplementation(async (path) => ({
    data: { signedUrl: `https://storage.example.test/object/upload/sign/gtfs-uploads/${path}?token=t` },
    error: null,
  }));
  mocks.createSignedUrl.mockReset().mockImplementation(async (path) =>
    objects.has(path)
      ? { data: { signedUrl: `https://storage.example.test/object/sign/gtfs-uploads/${path}?token=t` }, error: null }
      : { data: null, error: { message: "Object not found" } }
  );
  mocks.remove.mockReset().mockImplementation(async (paths) => {
    for (const path of paths) objects.delete(path);
    return { data: [], error: null };
  });
  mocks.fetch.mockReset().mockImplementation(async (url) => {
    const path = decodeURIComponent(new URL(url).pathname.replace("/object/sign/gtfs-uploads/", ""));
    const stored = objects.get(path);
    return stored
      ? { ok: true, status: 200, body: streamOf(stored) }
      : { ok: false, status: 404, body: null };
  });
  vi.stubGlobal("fetch", mocks.fetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("POST /api/gtfs/feeds/upload/start", () => {
  it("refuses an anonymous caller before signing anything", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    expect((await start(post("start", startBody()))).status).toBe(401);
    expect(mocks.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("checks membership in the named workspace for the signed-in user", async () => {
    tables.workspace_members = [{ workspace_id: OTHER_WORKSPACE_ID, user_id: USER_ID, role: "owner" }];
    expect((await start(post("start", startBody()))).status).toBe(404);
    expect(queries).toContainEqual({
      client: "rls",
      table: "workspace_members",
      columns: "role",
      filters: [
        { column: "workspace_id", value: WORKSPACE_ID },
        { column: "user_id", value: USER_ID },
      ],
    });
    expect(mocks.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("refuses a viewer", async () => {
    tables.workspace_members = [{ workspace_id: WORKSPACE_ID, user_id: USER_ID, role: "viewer" }];
    expect((await start(post("start", startBody()))).status).toBe(403);
    expect(mocks.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("refuses a declared size over the limit and signs one at the limit", async () => {
    const over = await start(post("start", startBody({ byteSize: BODY_LIMITS.gtfsFeedRaw + 1 })));
    expect(over.status).toBe(413);
    expect(await over.json()).toMatchObject({ maxBytes: MAX });
    expect(mocks.createSignedUploadUrl).not.toHaveBeenCalled();

    expect((await start(post("start", startBody({ byteSize: MAX })))).status).toBe(200);
    expect(mocks.createSignedUploadUrl).toHaveBeenCalledTimes(1);
  });

  it("refuses a file that is not a zip", async () => {
    const response = await start(post("start", startBody({ filename: "notes.txt", contentType: "text/plain" })));
    expect(response.status).toBe(415);
    expect(mocks.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("answers 404 for a feed in another workspace, by filtering on this one", async () => {
    expect((await start(post("start", startBody({ feedId: FOREIGN_FEED_ID })))).status).toBe(404);
    expect(queries).toContainEqual({
      client: "service",
      table: "gtfs_feeds",
      columns: "id",
      filters: [
        { column: "id", value: FOREIGN_FEED_ID },
        { column: "workspace_id", value: WORKSPACE_ID },
      ],
    });
    expect(mocks.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("signs one new object under this user's staged folder in this workspace", async () => {
    const response = await start(post("start", startBody({ feedId: OWN_FEED_ID })));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { uploadUrl: string; objectPath: string; contentType: string };
    expect(body.objectPath).toMatch(new RegExp(`^${WORKSPACE_ID}/staged/${USER_ID}/[0-9a-f-]{36}\\.zip$`));
    expect(body.uploadUrl).toContain(body.objectPath);
    expect(body.contentType).toBe("application/zip");
    expect(mocks.createSignedUploadUrl).toHaveBeenCalledWith(body.objectPath, { upsert: false });
    expect(mocks.buckets).toEqual(["gtfs-uploads"]);
  });

  it("stays out of the way when managed import is on", async () => {
    vi.stubEnv("OPENPLAN_GTFS_MANAGED_INGESTION", "1");
    expect((await start(post("start", startBody()))).status).toBe(409);
    expect(mocks.createSignedUploadUrl).not.toHaveBeenCalled();
  });
});

describe("POST /api/gtfs/feeds/upload/start: the workspace storage limit", () => {
  it("refuses before a URL exists when the declared archive would go over the limit", async () => {
    checkWorkspaceStorageRoomMock.mockResolvedValue({
      status: "full",
      usedBytes: 4.95 * 1024 ** 3,
      quotaBytes: 5 * 1024 ** 3,
      message: "This file would put the workspace over its 5 GiB storage limit (5 GiB used).",
    });
    const response = await start(post("start", startBody()));
    expect(response.status).toBe(413);
    expect((await response.json()).error).toBe(
      "This file would put the workspace over its 5 GiB storage limit (5 GiB used)."
    );
    expect(mocks.createSignedUploadUrl).not.toHaveBeenCalled();
    // The declared size, against the workspace the caller is a member of.
    expect(checkWorkspaceStorageRoomMock).toHaveBeenCalledWith(expect.anything(), WORKSPACE_ID, 94 * 1024 * 1024);
  });

  it("refuses before a URL exists when the workspace's use cannot be read", async () => {
    checkWorkspaceStorageRoomMock.mockResolvedValue({
      status: "unreadable",
      message: "Storage use could not be checked, so nothing was uploaded. Try again in a minute.",
      detail: "permission denied",
    });
    expect((await start(post("start", startBody()))).status).toBe(503);
    expect(mocks.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("signs the URL while the workspace has room", async () => {
    checkWorkspaceStorageRoomMock.mockResolvedValue({ status: "room", usedBytes: 0, quotaBytes: 5 * 1024 ** 3 });
    expect((await start(post("start", startBody()))).status).toBe(200);
    expect(mocks.createSignedUploadUrl).toHaveBeenCalledTimes(1);
  });

  it("checks nothing for a viewer, who is refused first", async () => {
    tables.workspace_members = [{ workspace_id: WORKSPACE_ID, user_id: USER_ID, role: "viewer" }];
    expect((await start(post("start", startBody()))).status).toBe(403);
    expect(checkWorkspaceStorageRoomMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/gtfs/feeds/upload/complete", () => {
  it("refuses an anonymous caller and a viewer before reading Storage", async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: null } });
    expect((await complete(post("complete", completeBody()))).status).toBe(401);
    tables.workspace_members = [{ workspace_id: WORKSPACE_ID, user_id: USER_ID, role: "viewer" }];
    expect((await complete(post("complete", completeBody()))).status).toBe(403);
    expect(mocks.createSignedUrl).not.toHaveBeenCalled();
    expect(mocks.runGtfsIngest).not.toHaveBeenCalled();
  });

  it.each([
    ["another workspace", `${OTHER_WORKSPACE_ID}/staged/${USER_ID}/${UPLOAD_ID}.zip`],
    ["another member", `${WORKSPACE_ID}/staged/${OTHER_USER_ID}/${UPLOAD_ID}.zip`],
    ["an ingested archive", `${WORKSPACE_ID}/${OWN_FEED_ID}/${UPLOAD_ID}.zip`],
  ])("will not read a path staged in %s", async (_name, objectPath) => {
    objects.set(objectPath, new Uint8Array([1, 2, 3, 4, 5]));
    const response = await complete(post("complete", completeBody({ objectPath })));
    expect(response.status).toBe(404);
    expect(mocks.createSignedUrl).not.toHaveBeenCalled();
    expect(mocks.runGtfsIngest).not.toHaveBeenCalled();
  });

  it("answers 404 for a feed in another workspace, by filtering on this one", async () => {
    expect((await complete(post("complete", completeBody({ feedId: FOREIGN_FEED_ID })))).status).toBe(404);
    expect(queries).toContainEqual({
      client: "service",
      table: "gtfs_feeds",
      columns: "id",
      filters: [
        { column: "id", value: FOREIGN_FEED_ID },
        { column: "workspace_id", value: WORKSPACE_ID },
      ],
    });
    expect(mocks.runGtfsIngest).not.toHaveBeenCalled();
  });

  it("says the archive is missing when nothing was stored", async () => {
    objects.clear();
    const response = await complete(post("complete", completeBody()));
    expect(response.status).toBe(409);
    expect(mocks.runGtfsIngest).not.toHaveBeenCalled();
  });

  it("refuses and removes an object that is not the declared size", async () => {
    const response = await complete(post("complete", completeBody({ byteSize: 6 })));
    expect(response.status).toBe(409);
    expect(mocks.remove).toHaveBeenCalledWith([STAGED_PATH]);
    expect(mocks.runGtfsIngest).not.toHaveBeenCalled();
  });

  it("stops reading an object that runs past the limit", async () => {
    const chunk = new Uint8Array(8 * 1024 * 1024);
    objects.set(STAGED_PATH, { repeat: chunk, times: 26 });
    const response = await complete(post("complete", completeBody({ byteSize: MAX })));
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ maxBytes: MAX });
    expect(mocks.remove).toHaveBeenCalledWith([STAGED_PATH]);
    expect(mocks.runGtfsIngest).not.toHaveBeenCalled();
  });

  it("ingests the stored bytes once, through the existing ingest", async () => {
    const response = await complete(post("complete", completeBody({ feedId: OWN_FEED_ID, label: "Chicago" })));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ feedId: OWN_FEED_ID, caveats: ["caveat"], byteSize: 5 });

    expect(mocks.runGtfsIngest).toHaveBeenCalledTimes(1);
    const call = mocks.runGtfsIngest.mock.calls[0][0];
    expect(call).toMatchObject({
      workspaceId: WORKSPACE_ID,
      feedId: OWN_FEED_ID,
      requestedBy: USER_ID,
      provisionalName: "Chicago",
      source: { kind: "upload", contentType: "application/zip", filename: "cta.zip" },
    });
    expect(Array.from(call.source.bytes ?? [])).toEqual([80, 75, 3, 4, 9]);
    expect(mocks.createSignedUrl).toHaveBeenCalledWith(STAGED_PATH, expect.any(Number));
    expect(mocks.buckets.every((bucket) => bucket === "gtfs-uploads")).toBe(true);

    // The staged object is consumed before the ingest, so a repeat finds nothing.
    expect(mocks.remove).toHaveBeenCalledWith([STAGED_PATH]);
    expect(mocks.remove.mock.invocationCallOrder[0]).toBeLessThan(mocks.runGtfsIngest.mock.invocationCallOrder[0]);
    expect((await complete(post("complete", completeBody()))).status).toBe(409);
    expect(mocks.runGtfsIngest).toHaveBeenCalledTimes(1);
  });

  it("passes an ingest refusal through with its status", async () => {
    mocks.runGtfsIngest.mockResolvedValue({
      ok: false,
      status: 422,
      code: "not_a_zip",
      detail: "This is not a ZIP archive.",
      feedId: null,
      versionId: null,
      createdFeed: false,
    });
    const response = await complete(post("complete", completeBody()));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "not_a_zip" });
  });

  it("stays out of the way when managed import is on", async () => {
    vi.stubEnv("OPENPLAN_GTFS_MANAGED_INGESTION", "1");
    expect((await complete(post("complete", completeBody()))).status).toBe(409);
    expect(mocks.runGtfsIngest).not.toHaveBeenCalled();
  });
});
