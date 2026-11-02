import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * KI-2026-10-12-017: A STAGED UPLOAD NOBODY COMPLETED IS REMOVED, AND NOTHING ELSE IS.
 *
 * The fake below is a Storage bucket with folders. `list()` returns one
 * folder level, folders with `id: null`, sorted by name, and never more than
 * `pageCap` entries whatever limit is asked for, so a sweep that reads one
 * page, or stops at a short page, misses objects here.
 */

type StoredObject = { created_at: string | null; updated_at: string | null };
type Entry = { name: string; id: string | null; created_at: string | null; updated_at: string | null };
type ListCall = { bucket: string; prefix: string; limit: number; offset: number };

type FakeStorageOptions = {
  pageCap?: number;
  /** Extra entries the listing returns for a folder, as a misbehaving server might. */
  inject?: (bucket: string, prefix: string) => Entry[];
  failList?: (bucket: string, prefix: string) => string | null;
  failRemove?: (bucket: string, paths: string[]) => string | null;
};

function createFakeStorage(options: FakeStorageOptions = {}) {
  const buckets = new Map<string, Map<string, StoredObject>>();
  const listCalls: ListCall[] = [];
  const removeCalls: Array<{ bucket: string; paths: string[] }> = [];
  const pageCap = options.pageCap ?? 1000;

  const objectsOf = (bucket: string) => {
    const objects = buckets.get(bucket) ?? new Map<string, StoredObject>();
    buckets.set(bucket, objects);
    return objects;
  };

  const client = {
    storage: {
      from(bucket: string) {
        const objects = objectsOf(bucket);
        return {
          async list(prefix: string, opts: { limit: number; offset: number }) {
            listCalls.push({ bucket, prefix, limit: opts.limit, offset: opts.offset });
            const failure = options.failList?.(bucket, prefix);
            if (failure) return { data: null, error: { message: failure } };
            const keyPrefix = prefix ? `${prefix}/` : "";
            const children = new Map<string, Entry>();
            for (const [key, object] of objects) {
              if (!key.startsWith(keyPrefix)) continue;
              const rest = key.slice(keyPrefix.length);
              const [name, ...deeper] = rest.split("/");
              if (deeper.length > 0) children.set(name, { name, id: null, created_at: null, updated_at: null });
              else children.set(name, { name, id: `id-${key}`, ...object });
            }
            for (const entry of options.inject?.(bucket, prefix) ?? []) children.set(entry.name, entry);
            const sorted = [...children.values()].sort((a, b) => a.name.localeCompare(b.name));
            return { data: sorted.slice(opts.offset, opts.offset + Math.min(opts.limit, pageCap)), error: null };
          },
          async remove(paths: string[]) {
            removeCalls.push({ bucket, paths: [...paths] });
            const failure = options.failRemove?.(bucket, paths);
            if (failure) return { data: null, error: { message: failure } };
            const removed = paths.filter((objectPath) => objects.delete(objectPath)).map((name) => ({ name }));
            return { data: removed, error: null };
          },
        };
      },
    },
  };

  return {
    client,
    listCalls,
    removeCalls,
    removedPaths: () => removeCalls.flatMap((call) => call.paths),
    put: (bucket: string, objectPath: string, createdAt: string | null, updatedAt: string | null = createdAt) =>
      objectsOf(bucket).set(objectPath, { created_at: createdAt, updated_at: updatedAt }),
    objects: (bucket: string) => [...objectsOf(bucket).keys()].sort(),
  };
}

let storage: ReturnType<typeof createFakeStorage>;
const auditCalls: Array<{ level: string; event: string; detail: unknown }> = [];

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
  createServiceRoleClient: () => storage.client,
}));
vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => ({
    info: (event: string, detail: unknown) => auditCalls.push({ level: "info", event, detail }),
    warn: (event: string, detail: unknown) => auditCalls.push({ level: "warn", event, detail }),
    error: (event: string, detail: unknown) => auditCalls.push({ level: "error", event, detail }),
  }),
}));

import { AERIAL_IMAGERY_BUCKET } from "@/lib/aerial/imagery";
import { KB_DOCUMENTS_BUCKET } from "@/lib/knowledge-base/documents";
import { GTFS_UPLOADS_BUCKET } from "@/lib/gtfs/persist";
import { stagedUploadPath } from "@/lib/files/staged-upload";
import { stagedGtfsUploadPath } from "@/lib/gtfs/staged-upload";
import { STAGED_UPLOAD_BUCKETS, sweepAbandonedStagedUploads } from "@/lib/files/staged-upload-sweep";
import { GET } from "@/app/api/cron/sweep-staged-uploads/route";

const NOW = new Date("2026-11-02T12:00:00.000Z");
const WS_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WS_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER_1 = "11111111-1111-4111-8111-111111111111";
const USER_2 = "22222222-2222-4222-8222-222222222222";
const MISSION = "33333333-3333-4333-8333-333333333333";

function id(n: number): string {
  return `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
}

function hoursAgo(hours: number): string {
  return new Date(NOW.getTime() - hours * 60 * 60 * 1000).toISOString();
}

// Aerial imagery
const AERIAL_OLD = stagedUploadPath(WS_A, USER_1, id(1));
const AERIAL_OLD_OTHER_USER = stagedUploadPath(WS_A, USER_2, id(2));
const AERIAL_RECENT = stagedUploadPath(WS_A, USER_1, id(3));
const AERIAL_JUST_UNDER_A_DAY = stagedUploadPath(WS_A, USER_1, id(4));
// Created long ago but written again recently: the newer time decides.
const AERIAL_UPDATED_RECENTLY = stagedUploadPath(WS_A, USER_1, id(5));
const AERIAL_NO_TIMESTAMP = stagedUploadPath(WS_A, USER_1, id(6));
const AERIAL_STORED = `${WS_A}/${MISSION}/${id(7)}.jpg`;
const AERIAL_LOOSE_IN_STAGED = `${WS_A}/staged/notes.txt`;
const AERIAL_NOT_A_STAGED_NAME = `${WS_A}/staged/${USER_1}/${id(8)}.jpg`;
const AERIAL_NESTED = `${WS_A}/staged/${USER_1}/${id(9)}/inner`;
// Knowledge Base documents
const KB_OLD = stagedUploadPath(WS_B, USER_1, id(10));
const KB_STORED = `${WS_B}/${id(11)}/plan.pdf`;
// GTFS: the door adds `.zip`; a staged-looking name without it is not its own.
const GTFS_OLD = stagedGtfsUploadPath(WS_B, USER_2, id(12));
const GTFS_WITHOUT_ZIP = stagedUploadPath(WS_B, USER_2, id(13));
const GTFS_STORED = `${WS_B}/${id(14)}/${id(15)}.zip`;

function seed(options: FakeStorageOptions = {}) {
  storage = createFakeStorage(options);
  storage.put(AERIAL_IMAGERY_BUCKET, AERIAL_OLD, hoursAgo(30));
  storage.put(AERIAL_IMAGERY_BUCKET, AERIAL_OLD_OTHER_USER, hoursAgo(72));
  storage.put(AERIAL_IMAGERY_BUCKET, AERIAL_RECENT, hoursAgo(2));
  storage.put(AERIAL_IMAGERY_BUCKET, AERIAL_JUST_UNDER_A_DAY, hoursAgo(23.9));
  storage.put(AERIAL_IMAGERY_BUCKET, AERIAL_UPDATED_RECENTLY, hoursAgo(48), hoursAgo(1));
  storage.put(AERIAL_IMAGERY_BUCKET, AERIAL_NO_TIMESTAMP, null, null);
  storage.put(AERIAL_IMAGERY_BUCKET, AERIAL_STORED, hoursAgo(500));
  storage.put(AERIAL_IMAGERY_BUCKET, AERIAL_LOOSE_IN_STAGED, hoursAgo(500));
  storage.put(AERIAL_IMAGERY_BUCKET, AERIAL_NOT_A_STAGED_NAME, hoursAgo(500));
  storage.put(AERIAL_IMAGERY_BUCKET, AERIAL_NESTED, hoursAgo(500));
  storage.put(KB_DOCUMENTS_BUCKET, KB_OLD, hoursAgo(25));
  storage.put(KB_DOCUMENTS_BUCKET, KB_STORED, hoursAgo(500));
  storage.put(GTFS_UPLOADS_BUCKET, GTFS_OLD, hoursAgo(25));
  storage.put(GTFS_UPLOADS_BUCKET, GTFS_WITHOUT_ZIP, hoursAgo(500));
  storage.put(GTFS_UPLOADS_BUCKET, GTFS_STORED, hoursAgo(500));
}

const REMOVABLE = [AERIAL_OLD, AERIAL_OLD_OTHER_USER, KB_OLD, GTFS_OLD];

describe("sweepAbandonedStagedUploads", () => {
  beforeEach(() => seed());

  it("covers each bucket a staged door writes to", () => {
    expect(STAGED_UPLOAD_BUCKETS).toEqual([
      { bucket: AERIAL_IMAGERY_BUCKET, extension: "" },
      { bucket: KB_DOCUMENTS_BUCKET, extension: "" },
      { bucket: GTFS_UPLOADS_BUCKET, extension: ".zip" },
    ]);
  });

  it("removes only staged objects older than a day", async () => {
    const result = await sweepAbandonedStagedUploads(storage.client as never, { now: NOW, rotation: 0 });

    expect(storage.removedPaths().sort()).toEqual([...REMOVABLE].sort());
    expect(storage.objects(AERIAL_IMAGERY_BUCKET)).toEqual(
      [
        AERIAL_RECENT,
        AERIAL_JUST_UNDER_A_DAY,
        AERIAL_UPDATED_RECENTLY,
        AERIAL_NO_TIMESTAMP,
        AERIAL_STORED,
        AERIAL_LOOSE_IN_STAGED,
        AERIAL_NOT_A_STAGED_NAME,
        AERIAL_NESTED,
      ].sort()
    );
    expect(storage.objects(KB_DOCUMENTS_BUCKET)).toEqual([KB_STORED]);
    expect(storage.objects(GTFS_UPLOADS_BUCKET)).toEqual([GTFS_STORED, GTFS_WITHOUT_ZIP].sort());

    expect(result.cutoff).toBe(hoursAgo(24));
    expect(result.removed).toBe(4);
    expect(result.failed).toBe(false);
    expect(result.more).toBe(false);
    const [aerial, kb, gtfs] = result.buckets;
    expect(aerial).toMatchObject({ removed: 2, tooRecent: 3, unknownAge: 1, notStaged: 3, failure: null });
    expect(kb).toMatchObject({ removed: 1, tooRecent: 0, notStaged: 0, failure: null });
    expect(gtfs).toMatchObject({ removed: 1, notStaged: 1, failure: null });
  });

  it("never removes a name outside the staged grammar, even when the listing returns one", async () => {
    const hostile = [
      `../../${MISSION}/${id(7)}.jpg`,
      `${id(20)}/../../${MISSION}`,
      "ABCDEF01-2345-4678-89AB-CDEF01234567",
      `${id(22)}.zip`,
    ];
    seed({
      inject: (bucket, prefix) =>
        prefix === `${WS_A}/staged/${USER_1}`
          ? hostile.map((name) => ({ name, id: `id-${name}`, created_at: hoursAgo(500), updated_at: hoursAgo(500) }))
          : [],
    });

    const result = await sweepAbandonedStagedUploads(storage.client as never, { now: NOW, rotation: 0 });

    expect(storage.removedPaths().sort()).toEqual([...REMOVABLE].sort());
    expect(result.buckets[0].notStaged).toBe(3 + hostile.length);
  });

  it("follows every page of every folder, whatever page size the server returns", async () => {
    seed({ pageCap: 2 });
    const many = Array.from({ length: 7 }, (_, index) => stagedUploadPath(WS_B, USER_1, id(100 + index)));
    for (const objectPath of many) storage.put(KB_DOCUMENTS_BUCKET, objectPath, hoursAgo(40));
    // More workspace folders than one page holds; the last staged one sorts last.
    for (let n = 0; n < 5; n += 1) storage.put(KB_DOCUMENTS_BUCKET, `${id(200 + n)}/${id(300 + n)}/doc.pdf`, hoursAgo(40));
    const lastPath = stagedUploadPath("ffffffff-ffff-4fff-8fff-ffffffffffff", USER_2, id(400));
    storage.put(KB_DOCUMENTS_BUCKET, lastPath, hoursAgo(40));

    const result = await sweepAbandonedStagedUploads(storage.client as never, { now: NOW, rotation: 0 });

    expect(storage.objects(KB_DOCUMENTS_BUCKET).filter((objectPath) => objectPath.includes("/staged/"))).toEqual([]);
    expect(storage.removedPaths()).toContain(lastPath);
    // KB_OLD, the seven added beside it, and the one in the last workspace.
    expect(result.buckets[1].removed).toBe(many.length + 2);
    const userFolderOffsets = storage.listCalls
      .filter((call) => call.bucket === KB_DOCUMENTS_BUCKET && call.prefix === `${WS_B}/staged/${USER_1}`)
      .map((call) => call.offset);
    expect(userFolderOffsets).toEqual([0, 2, 4, 6, 8]);
  });

  it("stops at its list budget, says so, and the next run finishes", async () => {
    const first = await sweepAbandonedStagedUploads(storage.client as never, { now: NOW, rotation: 0, maxListRequests: 3 });
    const [aerial] = first.buckets;
    expect(aerial.listRequests).toBe(3);
    expect(aerial.more).toBe(true);
    expect(first.more).toBe(true);
    expect(first.failed).toBe(false);
    expect(storage.objects(AERIAL_IMAGERY_BUCKET)).toContain(AERIAL_OLD_OTHER_USER);

    const rest = await sweepAbandonedStagedUploads(storage.client as never, { now: NOW, rotation: 0 });
    expect(rest.more).toBe(false);
    expect(storage.objects(AERIAL_IMAGERY_BUCKET)).not.toContain(AERIAL_OLD_OTHER_USER);
    expect(storage.removedPaths().sort()).toEqual([...REMOVABLE].sort());
  });

  it("removes no more than its removal budget per bucket", async () => {
    const result = await sweepAbandonedStagedUploads(storage.client as never, { now: NOW, rotation: 0, maxRemovals: 1 });
    expect(result.buckets[0]).toMatchObject({ removed: 1, more: true });
    expect(storage.removeCalls.filter((call) => call.bucket === AERIAL_IMAGERY_BUCKET).flatMap((call) => call.paths)).toHaveLength(1);
  });

  it("starts at a different workspace when the rotation moves", async () => {
    const stagedFoldersListed = async (rotation: number) => {
      seed();
      storage.put(KB_DOCUMENTS_BUCKET, stagedUploadPath(WS_A, USER_1, id(30)), hoursAgo(40));
      // Two root pages, then one staged folder, then the budget is spent.
      await sweepAbandonedStagedUploads(storage.client as never, { now: NOW, rotation, maxListRequests: 3 });
      return storage.listCalls
        .filter((call) => call.bucket === KB_DOCUMENTS_BUCKET && call.prefix.endsWith("/staged"))
        .map((call) => call.prefix);
    };
    expect(await stagedFoldersListed(0)).toEqual([`${WS_A}/staged`]);
    expect(await stagedFoldersListed(1)).toEqual([`${WS_B}/staged`]);
  });

  it("keeps what it removed and reports the bucket that failed", async () => {
    seed({ failRemove: (bucket) => (bucket === KB_DOCUMENTS_BUCKET ? "storage timeout" : null) });

    const result = await sweepAbandonedStagedUploads(storage.client as never, { now: NOW, rotation: 0 });

    expect(result.failed).toBe(true);
    expect(result.buckets[0]).toMatchObject({ removed: 2, failure: null });
    expect(result.buckets[1].failure).toMatch(/storage timeout/);
    expect(result.buckets[1].removed).toBe(0);
    // The bucket after the failure still runs.
    expect(result.buckets[2]).toMatchObject({ removed: 1, failure: null });
    expect(result.removed).toBe(3);
    expect(storage.objects(KB_DOCUMENTS_BUCKET)).toContain(KB_OLD);
  });

  it("removes nothing in a bucket whose listing fails", async () => {
    seed({ failList: (bucket, prefix) => (bucket === GTFS_UPLOADS_BUCKET && prefix === "" ? "bad gateway" : null) });
    const result = await sweepAbandonedStagedUploads(storage.client as never, { now: NOW, rotation: 0 });
    expect(result.buckets[2].failure).toMatch(/bad gateway/);
    expect(storage.objects(GTFS_UPLOADS_BUCKET)).toContain(GTFS_OLD);
    expect(result.buckets[0].removed).toBe(2);
  });
});

describe("GET /api/cron/sweep-staged-uploads", () => {
  const original = process.env.CRON_SECRET;
  beforeEach(() => {
    seed();
    auditCalls.length = 0;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    process.env.CRON_SECRET = "cron-secret-value";
  });
  afterEach(() => {
    vi.useRealTimers();
    if (original === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = original;
  });

  const call = (authorization?: string) =>
    GET(
      new NextRequest("http://localhost/api/cron/sweep-staged-uploads", {
        headers: authorization ? { authorization } : {},
      })
    );

  it("refuses a caller without the secret and removes nothing", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong")).status).toBe(401);
    delete process.env.CRON_SECRET;
    expect((await call("Bearer cron-secret-value")).status).toBe(401);
    expect(storage.listCalls).toEqual([]);
    expect(storage.removeCalls).toEqual([]);
  });

  it("runs the sweep for the scheduler and records the counts", async () => {
    const response = await call("Bearer cron-secret-value");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ removed: 4, failed: false, more: false });
    expect(storage.objects(AERIAL_IMAGERY_BUCKET)).not.toContain(AERIAL_OLD);
    expect(auditCalls).toEqual([
      { level: "info", event: "cron_sweep_staged_uploads_completed", detail: expect.objectContaining({ removed: 4 }) },
    ]);
  });

  it("answers 500 with the counts of what it finished when a bucket fails", async () => {
    seed({ failRemove: (bucket) => (bucket === GTFS_UPLOADS_BUCKET ? "storage timeout" : null) });
    const response = await call("Bearer cron-secret-value");
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toMatchObject({ removed: 3, failed: true });
    expect(body.buckets[2].failure).toMatch(/storage timeout/);
    expect(auditCalls).toEqual([
      { level: "error", event: "cron_sweep_staged_uploads_failed", detail: expect.objectContaining({ removed: 3, failed: true }) },
    ]);
  });

  it("is scheduled daily in vercel.json, at a minute no other cron uses", () => {
    const config = JSON.parse(fs.readFileSync(path.join(process.cwd(), "vercel.json"), "utf8")) as {
      crons: Array<{ path: string; schedule: string }>;
    };
    const entry = config.crons.find((cron) => cron.path === "/api/cron/sweep-staged-uploads");
    expect(entry?.schedule).toMatch(/^\d{1,2} \d{1,2} \* \* \*$/);
    const [minute] = (entry?.schedule ?? "").split(" ");
    // Off the five-minute grid the every-5 and every-15 reapers run on.
    expect(Number(minute) % 5).not.toBe(0);
    const others = config.crons.filter((cron) => cron !== entry).map((cron) => cron.schedule);
    expect(others).not.toContain(entry?.schedule);
  });
});
