import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { KB_DOCUMENT_COLUMNS, KB_DOCUMENT_MAX_BYTES_ENV } from "@/lib/knowledge-base/documents";

// The workspace storage limit (storage-quota.ts). Room by default; a test that
// is about the limit sets the answer and checks what the route asked.
const checkWorkspaceStorageRoomMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/workspaces/storage-quota", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/workspaces/storage-quota")>()),
  checkWorkspaceStorageRoom: (...args: unknown[]) =>
    checkWorkspaceStorageRoomMock(...args) ?? Promise.resolve({ status: "room", usedBytes: 0, quotaBytes: 5 * 1024 ** 3 }),
}));
vi.mock("server-only", () => ({}));

/**
 * KNOWLEDGE BASE DOCUMENTS THAT NEVER RIDE IN A FUNCTION BODY.
 *
 * An adopted RTP runs 40 to 80 MB and the hosted platform refuses a function
 * body above about 4.5 MB, so the app's uploaders use `documents/upload/start`
 * (signed Storage URL) and `documents/upload/complete` (read the staged object
 * back, then the same `storeKbDocument` the body route runs). Storage, the
 * dedup probe and every write use the service role, so the membership filter,
 * the linked-project filter and the staged-path check are the access control.
 * The fake below applies `eq`, `is` and `in` filters and holds rows in another
 * workspace, so dropping a filter changes the answer.
 */

type Row = Record<string, unknown>;
type Filter = { op: "eq" | "is" | "in"; column: string; value: unknown };
type Query = { client: "rls" | "service"; table: string; columns: string | null; filters: Filter[] };
type StorageError = { message: string } | null;
type Stored = Uint8Array | { repeat: Uint8Array; times: number };

const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_USER_ID = "12121212-1212-4212-8212-121212121212";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID = "44444444-4444-4444-8444-444444444444";
const FOREIGN_PROJECT_ID = "55555555-5555-4555-8555-555555555555";
const UPLOAD_ID = "66666666-6666-4666-8666-666666666666";
const STAGED_PATH = `${WORKSPACE_ID}/staged/${USER_ID}/${UPLOAD_ID}`;
const DEFAULT_MAX = 100 * 1024 * 1024;

const TEXT = "Chapter 4. Action element. The region will fund 12 miles of protected bikeway by 2035.";
const TEXT_BYTES = new TextEncoder().encode(TEXT);
const TEXT_SHA256 = createHash("sha256").update(TEXT_BYTES).digest("hex");
const PDF_BYTES = new TextEncoder().encode("%PDF-1.7\n1 0 obj << >> endobj\n%%EOF");

const mocks = vi.hoisted(() => ({
  getUser: vi.fn<() => Promise<{ data: { user: { id: string } | null } }>>(),
  createSignedUploadUrl: vi.fn<(path: string, options?: { upsert?: boolean }) => Promise<{ data: { signedUrl: string } | null; error: StorageError }>>(),
  createSignedUrl: vi.fn<(path: string, ttl: number) => Promise<{ data: { signedUrl: string } | null; error: StorageError }>>(),
  remove: vi.fn<(paths: string[]) => Promise<{ data: unknown; error: StorageError }>>(),
  upload: vi.fn<(path: string, bytes: Uint8Array, options: Record<string, unknown>) => Promise<{ error: StorageError }>>(),
  fetch: vi.fn<(url: string) => Promise<{ ok: boolean; status: number; body: ReadableStream<Uint8Array> | null }>>(),
  enqueueExtraction: vi.fn<(documentId: string, actorId: string, mode: string, origin: string) => Promise<Row>>(),
  buckets: [] as string[],
}));

let tables: Record<string, Row[]> = {};
let queries: Query[] = [];
let inserts: Array<{ table: string; rows: Row | Row[]; columns: string | null }> = [];
let objects = new Map<string, Stored>();

function matchesFilter(row: Row, filter: Filter): boolean {
  if (filter.op === "eq") return row[filter.column] === filter.value;
  if (filter.op === "is") return (row[filter.column] ?? null) === filter.value;
  return (filter.value as unknown[]).includes(row[filter.column]);
}

function makeClient(client: "rls" | "service") {
  return {
    from(table: string) {
      const query: Query = { client, table, columns: null, filters: [] };
      const matches = () => (tables[table] ?? []).filter((row) => query.filters.every((f) => matchesFilter(row, f)));
      const chain = {
        select(columns: string) {
          query.columns = columns;
          return chain;
        },
        eq(column: string, value: unknown) {
          query.filters.push({ op: "eq", column, value });
          return chain;
        },
        is(column: string, value: unknown) {
          query.filters.push({ op: "is", column, value });
          return chain;
        },
        in(column: string, value: unknown[]) {
          query.filters.push({ op: "in", column, value });
          return chain;
        },
        limit() {
          return chain;
        },
        async maybeSingle() {
          queries.push(query);
          return { data: matches()[0] ?? null, error: null };
        },
        insert(rows: Row | Row[]) {
          const record = { table, rows, columns: null as string | null };
          inserts.push(record);
          for (const row of Array.isArray(rows) ? rows : [rows]) (tables[table] ??= []).push(row);
          return {
            select(columns: string) {
              record.columns = columns;
              return { single: async () => ({ data: Array.isArray(rows) ? rows[0] : rows, error: null }) };
            },
            then: (resolve: (value: { error: null }) => unknown) => resolve({ error: null }),
          };
        },
        update() {
          return { eq: async () => ({ error: null }) };
        },
      };
      return chain;
    },
  };
}

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), requestId: "test" }),
}));

vi.mock("@/lib/knowledge-base/extraction-jobs", () => ({
  enqueueExtraction: (...args: [string, string, string, string]) => mocks.enqueueExtraction(...args),
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

import { POST as start } from "@/app/api/knowledge-base/documents/upload/start/route";
import { POST as complete } from "@/app/api/knowledge-base/documents/upload/complete/route";

function post(step: "start" | "complete", body: unknown) {
  return new NextRequest(`https://planning.example.test/api/knowledge-base/documents/upload/${step}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const startBody = (overrides: Record<string, unknown> = {}) => ({
  workspaceId: WORKSPACE_ID,
  filename: "2045-rtp.txt",
  byteSize: 48 * 1024 * 1024,
  contentType: "text/plain",
  ...overrides,
});

const completeBody = (overrides: Record<string, unknown> = {}) => ({
  workspaceId: WORKSPACE_ID,
  objectPath: STAGED_PATH,
  byteSize: TEXT_BYTES.byteLength,
  filename: "2045-rtp.txt",
  contentType: "text/plain",
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
  objects = new Map([[STAGED_PATH, TEXT_BYTES]]);
  tables = {
    workspace_members: [
      { workspace_id: WORKSPACE_ID, user_id: USER_ID, role: "member" },
      { workspace_id: OTHER_WORKSPACE_ID, user_id: USER_ID, role: "owner" },
    ],
    projects: [
      { id: PROJECT_ID, workspace_id: WORKSPACE_ID },
      { id: FOREIGN_PROJECT_ID, workspace_id: OTHER_WORKSPACE_ID },
    ],
    kb_documents: [],
    kb_document_chunks: [],
  };
  mocks.getUser.mockReset().mockResolvedValue({ data: { user: { id: USER_ID } } });
  mocks.createSignedUploadUrl.mockReset().mockImplementation(async (path) => ({
    data: { signedUrl: `https://storage.example.test/object/upload/sign/kb-documents/${path}?token=t` },
    error: null,
  }));
  mocks.createSignedUrl.mockReset().mockImplementation(async (path) =>
    objects.has(path)
      ? { data: { signedUrl: `https://storage.example.test/object/sign/kb-documents/${path}?token=t` }, error: null }
      : { data: null, error: { message: "Object not found" } }
  );
  mocks.remove.mockReset().mockImplementation(async (paths) => {
    for (const path of paths) objects.delete(path);
    return { data: [], error: null };
  });
  mocks.upload.mockReset().mockResolvedValue({ error: null });
  mocks.enqueueExtraction.mockReset().mockResolvedValue({ id: "job-1", status: "queued" });
  mocks.fetch.mockReset().mockImplementation(async (url) => {
    const path = decodeURIComponent(new URL(url).pathname.replace("/object/sign/kb-documents/", ""));
    const stored = objects.get(path);
    return stored ? { ok: true, status: 200, body: streamOf(stored) } : { ok: false, status: 404, body: null };
  });
  vi.stubGlobal("fetch", mocks.fetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** Nothing reached a document path and no document row was written. */
function expectNothingStored() {
  expect(mocks.upload).not.toHaveBeenCalled();
  expect(inserts).toEqual([]);
}

describe("POST /api/knowledge-base/documents/upload/start", () => {
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
        { op: "eq", column: "workspace_id", value: WORKSPACE_ID },
        { op: "eq", column: "user_id", value: USER_ID },
      ],
    });
    expect(mocks.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("refuses a viewer before the storage check", async () => {
    tables.workspace_members = [{ workspace_id: WORKSPACE_ID, user_id: USER_ID, role: "viewer" }];
    expect((await start(post("start", startBody()))).status).toBe(403);
    expect(mocks.createSignedUploadUrl).not.toHaveBeenCalled();
    expect(checkWorkspaceStorageRoomMock).not.toHaveBeenCalled();
  });

  it("answers 404 for a project in another workspace, by filtering on this one", async () => {
    expect((await start(post("start", startBody({ projectId: FOREIGN_PROJECT_ID })))).status).toBe(404);
    expect(queries).toContainEqual({
      client: "rls",
      table: "projects",
      columns: "id",
      filters: [
        { op: "eq", column: "id", value: FOREIGN_PROJECT_ID },
        { op: "eq", column: "workspace_id", value: WORKSPACE_ID },
      ],
    });
    expect(mocks.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("refuses a type neither accept list names", async () => {
    const response = await start(post("start", startBody({ filename: "model.exe", contentType: "application/x-msdownload" })));
    expect(response.status).toBe(415);
    expect(mocks.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("refuses an empty file", async () => {
    expect((await start(post("start", startBody({ byteSize: 0 })))).status).toBe(400);
    expect(mocks.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("refuses a declared size over the ceiling, naming the setting, and signs one at it", async () => {
    const over = await start(post("start", startBody({ byteSize: DEFAULT_MAX + 1 })));
    expect(over.status).toBe(413);
    const body = await over.json();
    expect(body.maxBytes).toBe(DEFAULT_MAX);
    expect(body.error).toContain(KB_DOCUMENT_MAX_BYTES_ENV);
    expect(mocks.createSignedUploadUrl).not.toHaveBeenCalled();

    expect((await start(post("start", startBody({ byteSize: DEFAULT_MAX })))).status).toBe(200);
    expect(mocks.createSignedUploadUrl).toHaveBeenCalledTimes(1);
  });

  it("refuses before a URL exists when the declared file would go over the workspace limit", async () => {
    checkWorkspaceStorageRoomMock.mockResolvedValue({
      status: "full",
      usedBytes: 4.99 * 1024 ** 3,
      quotaBytes: 5 * 1024 ** 3,
      message: "This file would put the workspace over its 5 GiB storage limit (5 GiB used).",
    });
    expect((await start(post("start", startBody()))).status).toBe(413);
    expect(mocks.createSignedUploadUrl).not.toHaveBeenCalled();
    expect(checkWorkspaceStorageRoomMock).toHaveBeenCalledWith(expect.anything(), WORKSPACE_ID, 48 * 1024 * 1024);
  });

  it("refuses before a URL exists when the workspace's use cannot be read", async () => {
    checkWorkspaceStorageRoomMock.mockResolvedValue({ status: "unreadable", message: "Storage use could not be checked.", detail: "x" });
    expect((await start(post("start", startBody()))).status).toBe(503);
    expect(mocks.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("signs one new object under this user's staged folder in this workspace", async () => {
    const response = await start(post("start", startBody({ projectId: PROJECT_ID })));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { uploadUrl: string; objectPath: string; contentType: string };
    expect(body.objectPath).toMatch(new RegExp(`^${WORKSPACE_ID}/staged/${USER_ID}/[0-9a-f-]{36}$`));
    expect(body.uploadUrl).toContain(body.objectPath);
    expect(body.contentType).toBe("application/octet-stream");
    expect(mocks.createSignedUploadUrl).toHaveBeenCalledWith(body.objectPath, { upsert: false });
    expect(mocks.buckets).toEqual(["kb-documents"]);
  });
});

describe("POST /api/knowledge-base/documents/upload/complete", () => {
  it("refuses an anonymous caller and a viewer before reading Storage", async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: null } });
    expect((await complete(post("complete", completeBody()))).status).toBe(401);
    tables.workspace_members = [{ workspace_id: WORKSPACE_ID, user_id: USER_ID, role: "viewer" }];
    expect((await complete(post("complete", completeBody()))).status).toBe(403);
    expect(mocks.createSignedUrl).not.toHaveBeenCalled();
    expectNothingStored();
  });

  it.each([
    ["another workspace the caller also belongs to", `${OTHER_WORKSPACE_ID}/staged/${USER_ID}/${UPLOAD_ID}`],
    ["another member", `${WORKSPACE_ID}/staged/${OTHER_USER_ID}/${UPLOAD_ID}`],
    ["a stored document", `${WORKSPACE_ID}/${UPLOAD_ID}/2045-rtp.txt`],
  ])("will not read or remove a path staged in %s", async (_name, objectPath) => {
    objects.set(objectPath, TEXT_BYTES);
    const response = await complete(post("complete", completeBody({ objectPath })));
    expect(response.status).toBe(404);
    expect(mocks.createSignedUrl).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
    expectNothingStored();
  });

  it("refuses a project in another workspace before reading Storage", async () => {
    expect((await complete(post("complete", completeBody({ projectId: FOREIGN_PROJECT_ID })))).status).toBe(404);
    expect(mocks.createSignedUrl).not.toHaveBeenCalled();
    expectNothingStored();
  });

  it("refuses an unsupported declared type and removes the staged object", async () => {
    const response = await complete(post("complete", completeBody({ filename: "model.exe", contentType: "application/x-msdownload" })));
    expect(response.status).toBe(415);
    expect(mocks.remove).toHaveBeenCalledWith([STAGED_PATH]);
    expect(objects.has(STAGED_PATH)).toBe(false);
    expectNothingStored();
  });

  it("says the document is missing when nothing was stored", async () => {
    objects.clear();
    expect((await complete(post("complete", completeBody()))).status).toBe(409);
    expectNothingStored();
  });

  it("refuses and removes an object that is not the declared size", async () => {
    const response = await complete(post("complete", completeBody({ byteSize: TEXT_BYTES.byteLength - 1 })));
    expect(response.status).toBe(409);
    expect(mocks.remove).toHaveBeenCalledWith([STAGED_PATH]);
    expect(objects.has(STAGED_PATH)).toBe(false);
    expectNothingStored();
  });

  it("stops reading, refuses and removes an object over the operator's ceiling", async () => {
    vi.stubEnv(KB_DOCUMENT_MAX_BYTES_ENV, String(1024));
    objects.set(STAGED_PATH, { repeat: new Uint8Array(512), times: 3 });
    const response = await complete(post("complete", completeBody({ byteSize: 1024 })));
    expect(response.status).toBe(413);
    expect((await response.json()).error).toContain(KB_DOCUMENT_MAX_BYTES_ENV);
    expect(mocks.remove).toHaveBeenCalledWith([STAGED_PATH]);
    expect(objects.has(STAGED_PATH)).toBe(false);
    expectNothingStored();
  });

  it("refuses and removes a file labeled as an image whose bytes are not one", async () => {
    const response = await complete(post("complete", completeBody({ filename: "exhibit.jpg", contentType: "image/jpeg" })));
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
    const response = await complete(post("complete", completeBody()));
    expect(response.status).toBe(413);
    expect(checkWorkspaceStorageRoomMock).toHaveBeenCalledWith(expect.anything(), WORKSPACE_ID, TEXT_BYTES.byteLength);
    expect(mocks.remove.mock.invocationCallOrder[0]).toBeLessThan(checkWorkspaceStorageRoomMock.mock.invocationCallOrder[0]);
    expect(objects.has(STAGED_PATH)).toBe(false);
    expectNothingStored();
  });

  it("answers the existing document at the same scope, and keeps no copy", async () => {
    tables.kb_documents = [
      // Same bytes, but attached to a project: not the workspace-wide scope asked for.
      { id: "project-copy", workspace_id: WORKSPACE_ID, project_id: PROJECT_ID, checksum: TEXT_SHA256, status: "ready" },
      { id: "workspace-copy", workspace_id: WORKSPACE_ID, project_id: null, checksum: TEXT_SHA256, status: "ready" },
    ];
    const response = await complete(post("complete", completeBody()));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ deduped: true, document: { id: "workspace-copy" } });
    expect(queries).toContainEqual({
      client: "service",
      table: "kb_documents",
      columns: KB_DOCUMENT_COLUMNS,
      filters: [
        { op: "eq", column: "workspace_id", value: WORKSPACE_ID },
        { op: "eq", column: "checksum", value: TEXT_SHA256 },
        { op: "is", column: "project_id", value: null },
        { op: "in", column: "status", value: ["ready", "stored"] },
      ],
    });
    expect(objects.has(STAGED_PATH)).toBe(false);
    expectNothingStored();
  });

  it("stores, extracts and indexes the measured bytes once, through the shared write", async () => {
    const response = await complete(post("complete", completeBody({ projectId: PROJECT_ID, title: "2045 RTP", docKind: "rtp" })));
    expect(response.status).toBe(201);

    expect(mocks.upload).toHaveBeenCalledTimes(1);
    const [finalPath, bytes, options] = mocks.upload.mock.calls[0];
    expect(finalPath).toMatch(new RegExp(`^${WORKSPACE_ID}/[0-9a-f-]{36}/2045-rtp\\.txt$`));
    expect(new TextDecoder().decode(bytes)).toBe(TEXT);
    expect(options).toEqual({ contentType: "text/plain", upsert: false });

    const documentInsert = inserts.find((entry) => entry.table === "kb_documents");
    expect(documentInsert?.columns).toBe(KB_DOCUMENT_COLUMNS);
    expect(documentInsert?.rows).toMatchObject({
      workspace_id: WORKSPACE_ID,
      project_id: PROJECT_ID,
      uploaded_by: USER_ID,
      title: "2045 RTP",
      doc_kind: "rtp",
      source_kind: "uploaded_txt",
      original_filename: "2045-rtp.txt",
      byte_size: TEXT_BYTES.byteLength,
      checksum: TEXT_SHA256,
      status: "ready",
      storage_ref: `storage://kb-documents/${finalPath}`,
    });
    expect(inserts.some((entry) => entry.table === "kb_document_chunks")).toBe(true);

    // Consumed before the stored copy is written; a repeat finds nothing.
    expect(mocks.remove).toHaveBeenCalledWith([STAGED_PATH]);
    expect(mocks.remove.mock.invocationCallOrder[0]).toBeLessThan(mocks.upload.mock.invocationCallOrder[0]);
    expect((await complete(post("complete", completeBody()))).status).toBe(409);
    expect(mocks.upload).toHaveBeenCalledTimes(1);
  });

  it("retains a PDF and queues its reading, with the app's own origin for the callback", async () => {
    objects.set(STAGED_PATH, PDF_BYTES);
    const response = await complete(
      post("complete", completeBody({ filename: "2045-rtp.pdf", contentType: "application/pdf", byteSize: PDF_BYTES.byteLength }))
    );
    expect(response.status).toBe(202);
    expect(inserts[0].rows).toMatchObject({ source_kind: "uploaded_pdf", status: "stored", content_type: "application/pdf" });
    const documentId = (inserts[0].rows as Row).id;
    expect(mocks.enqueueExtraction).toHaveBeenCalledWith(documentId, USER_ID, "text", "https://planning.example.test");
  });
});
