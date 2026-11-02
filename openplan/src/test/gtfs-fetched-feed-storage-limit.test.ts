/**
 * A FEED FETCHED FROM AN ADDRESS IS CHECKED AGAINST THE ROOM LEFT, BY ITS
 * ACTUAL SIZE, BEFORE IT IS STORED (KI-2026-10-12-014).
 *
 * The catalog and URL routes refuse a workspace already at its storage limit
 * before fetching, because the archive's size is unknown until it arrives.
 * That alone let a workspace one byte under its limit store a 190 MB archive.
 * `runGtfsIngest` now asks the shared limit (storage-quota.ts, unmocked here)
 * about the fetched byte count before the object is written, and a refusal
 * stores nothing, parses nothing and closes the version as failed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runGtfsIngest, type GtfsIngestSource } from "@/lib/gtfs/ingest";
import { failGtfsFeedVersion, writeParsedFeedVersion } from "@/lib/gtfs/persist";
import { parseGtfsFeed } from "@/lib/gtfs/parse";
import { WORKSPACE_STORAGE_UNREADABLE_MESSAGE, workspaceStorageFullMessage } from "@/lib/workspaces/storage-quota";

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const FEED_ID = "33333333-3333-4333-8333-333333333333";
const VERSION_ID = "44444444-4444-4444-8444-444444444444";
const QUOTA = 1000;

/** What the mocked fetcher hands back; each test sets its own size. */
const fetched = vi.hoisted(() => ({ bytes: new Uint8Array(4) }));

vi.mock("@/lib/gtfs/fetch", () => ({
  fetchGtfsFeedBytes: vi.fn(async () => ({
    ok: true as const,
    bytes: fetched.bytes,
    checksumSha256: "a".repeat(64),
    finalUrl: "https://example.org/gtfs.zip",
    hops: [],
    httpStatus: 200,
    contentType: "application/zip",
  })),
}));

vi.mock("@/lib/gtfs/parse", () => ({
  parseGtfsFeed: vi.fn(async () => ({
    ok: true as const,
    feed: {
      agencies: [{ name: "Example Transit" }],
      routes: [],
      stops: [],
      routeServiceLevels: [],
      stopServiceLevels: [],
      serviceDayBases: [],
      serviceWindow: { startDate: "2025-01-01", endDate: "2025-04-05" },
      feedInfo: null,
      warnings: [],
      stats: { tripRows: 1, stopTimesRows: 1, frequencyTrips: 0, scheduledTrips: 1 },
    },
  })),
}));

vi.mock("@/lib/gtfs/persist", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/gtfs/persist")>();
  return {
    ...actual,
    beginGtfsFeedVersion: vi.fn(async () => ({ ok: true as const, feedId: FEED_ID, versionId: VERSION_ID, createdFeed: true })),
    markGtfsFeedVersionStage: vi.fn(async () => true),
    writeParsedFeedVersion: vi.fn(async () => ({
      ok: true as const,
      routeServiceLevelRows: 10,
      stopServiceLevelRows: 20,
      droppedForMissingCoordinates: 0,
      displayName: "Example Transit",
    })),
    promoteGtfsFeedVersion: vi.fn(async () => ({ ok: true as const, promoted: true as const })),
    syncFeedDisplayName: vi.fn(async () => true),
    failGtfsFeedVersion: vi.fn(async () => ({ recorded: true, feedStatusChanged: true })),
  };
});

type RpcReply = { data: unknown; error: { message: string } | null };

/** A service-role double: storage use comes from `usage`, uploads are recorded. */
function serviceDouble(usage: RpcReply) {
  const uploads: Array<{ bucket: string; path: string; bytes: number }> = [];
  const rpcCalls: Array<[string, unknown]> = [];
  const client = {
    rpc: (name: string, args: unknown) => {
      rpcCalls.push([name, args]);
      return Promise.resolve(usage);
    },
    storage: {
      from: (bucket: string) => ({
        upload: (path: string, body: Uint8Array) => {
          uploads.push({ bucket, path, bytes: body.byteLength });
          return Promise.resolve({ error: null });
        },
        remove: () => Promise.resolve({ error: null }),
      }),
    },
    from: () => ({
      update: () => ({
        eq: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: VERSION_ID }, error: null }) }) }),
      }),
    }),
  };
  return { client, uploads, rpcCalls };
}

async function ingest(source: GtfsIngestSource, usage: RpcReply) {
  const double = serviceDouble(usage);
  const result = await runGtfsIngest({
    service: double.client as never,
    workspaceId: WORKSPACE_ID,
    source,
    provisionalName: "example.org",
    requestedBy: null,
  });
  return { result, ...double };
}

const URL_SOURCE: GtfsIngestSource = { kind: "url", downloadUrl: "https://example.org/gtfs.zip" };
const CATALOG_SOURCE: GtfsIngestSource = {
  kind: "catalog",
  downloadUrl: "https://example.org/gtfs.zip",
  catalogProvider: "mobility-database",
  catalogSourceId: "75",
  catalogRowStatus: "active",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("OPENPLAN_WORKSPACE_STORAGE_QUOTA_BYTES", String(QUOTA));
  fetched.bytes = new Uint8Array(4);
});
afterEach(() => vi.unstubAllEnvs());

describe("a fetched feed and the workspace storage limit", () => {
  for (const [door, source] of [["url", URL_SOURCE], ["catalog", CATALOG_SOURCE]] as const) {
    it(`stores a ${door} archive that exactly fits the room left`, async () => {
      const { result, uploads, rpcCalls } = await ingest(source, { data: QUOTA - 4, error: null });

      expect(result.ok).toBe(true);
      expect(rpcCalls).toEqual([["workspace_storage_bytes", { p_workspace_id: WORKSPACE_ID }]]);
      expect(uploads).toEqual([{ bucket: "gtfs-uploads", path: `${WORKSPACE_ID}/${FEED_ID}/${VERSION_ID}.zip`, bytes: 4 }]);
    });

    it(`refuses a ${door} archive one byte too large for the room left, and stores nothing`, async () => {
      const usedBytes = QUOTA - 3;
      const { result, uploads } = await ingest(source, { data: usedBytes, error: null });

      expect(result).toMatchObject({
        ok: false,
        status: 413,
        code: "workspace_storage_limit",
        detail: workspaceStorageFullMessage(usedBytes, QUOTA, 4),
        feedId: FEED_ID,
        versionId: VERSION_ID,
        storageRoom: { status: "full", usedBytes, quotaBytes: QUOTA, message: workspaceStorageFullMessage(usedBytes, QUOTA, 4) },
      });
      expect(uploads).toEqual([]);
      expect(parseGtfsFeed).not.toHaveBeenCalled();
      expect(writeParsedFeedVersion).not.toHaveBeenCalled();
      // The version closes as failed with no object to clean up.
      expect(failGtfsFeedVersion).toHaveBeenCalledTimes(1);
      expect(failGtfsFeedVersion).toHaveBeenCalledWith(expect.objectContaining({
        versionId: VERSION_ID,
        code: "workspace_storage_limit",
        detail: workspaceStorageFullMessage(usedBytes, QUOTA, 4),
        storagePath: null,
      }));
    });
  }

  it("charges the archive's actual fetched size, not zero", async () => {
    // Plenty of room for an empty check; not for these 600 bytes.
    fetched.bytes = new Uint8Array(600);
    const { result, uploads } = await ingest(URL_SOURCE, { data: 500, error: null });

    expect(result).toMatchObject({ ok: false, status: 413, storageRoom: { status: "full", usedBytes: 500 } });
    expect(uploads).toEqual([]);
  });

  it("refuses with 503 when storage use cannot be read, and stores nothing", async () => {
    const { result, uploads } = await ingest(URL_SOURCE, { data: null, error: { message: "permission denied" } });

    expect(result).toMatchObject({
      ok: false,
      status: 503,
      code: "workspace_storage_limit",
      detail: WORKSPACE_STORAGE_UNREADABLE_MESSAGE,
      storageRoom: { status: "unreadable", message: WORKSPACE_STORAGE_UNREADABLE_MESSAGE, detail: "permission denied" },
    });
    expect(uploads).toEqual([]);
    expect(parseGtfsFeed).not.toHaveBeenCalled();
    expect(failGtfsFeedVersion).toHaveBeenCalledWith(expect.objectContaining({ code: "workspace_storage_limit", storagePath: null }));
  });

  it("leaves the upload doors to their routes, which check the size before the bytes arrive", async () => {
    const { result, uploads, rpcCalls } = await ingest(
      { kind: "upload", bytes: new Uint8Array(4), contentType: "application/zip", filename: "feed.zip" },
      { data: QUOTA, error: null }
    );

    expect(result.ok).toBe(true);
    expect(rpcCalls).toEqual([]);
    expect(uploads).toHaveLength(1);
  });
});
