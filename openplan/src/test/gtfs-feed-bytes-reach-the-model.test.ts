/**
 * THE BYTES OPENPLAN PARSED ARE THE BYTES THE MODEL RUNS ON — for every door a
 * feed can come in through, not just the one that happened to store them first.
 *
 * WHAT THIS PINS, AND WHY IT IS WORTH A FILE.
 *
 * Until 2026-08-06 only the UPLOAD door wrote its archive to the `gtfs-uploads`
 * bucket. Catalog and URL ingests fetched, parsed, and discarded the bytes,
 * keeping only `source_url`. Handing a travel model that URL means the worker
 * REFETCHES — and `gtfs_skim.load_feed` caches a downloaded feed at
 * `gtfs_feed_{md5(url)[:16]}.zip` with no TTL and no revalidation, while the
 * same module gives its catalog CSV one. So a URL handoff is not "the worker
 * might get newer bytes"; it is "the worker gets whatever it first got, in
 * either direction, forever", while OpenPlan's service-levels page moves on.
 *
 * And the divergence would be CAMOUFLAGED rather than merely silent: the
 * worker builds its KPI provenance sentence from the same URL the Data Hub card
 * names, and two surfaces citing one address is exactly the evidence a reviewer
 * uses to conclude they agree.
 *
 * THE ASYMMETRY IS DELIBERATE AND IS ALSO PINNED. An upload that cannot be
 * stored fails the ingest — the archive exists nowhere else, and continuing
 * would leave a version that can never reach the model with no way to fix it.
 * A catalog or URL archive has an address, so a storage miss degrades: the
 * service levels are correct and complete, `storage_path` stays null, and the
 * model handoff refuses BY NAME with a re-ingest as the recovery. Two
 * behaviours, one earned difference — and a test, because a future reader will
 * otherwise "fix" the inconsistency in whichever direction they meet first.
 */

import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { runGtfsIngest, type GtfsIngestSource } from "@/lib/gtfs/ingest";

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const FEED_ID = "33333333-3333-4333-8333-333333333333";

/**
 * THE CHECKSUM IS THE LINCHPIN, AND THIS FILE USED TO ASSERT ONLY ITS SHAPE.
 *
 * Proven by mutation 2026-08-06: changing `ingest.ts` from
 * `createHash("sha256").update(bytes)` to `.update(new Uint8Array([9, 9, 9]))`
 * left the FULL 7,413-test suite green, because every assertion here was
 * `toMatch(/^[0-9a-f]{64}$/)` — which a digest of the wrong bytes satisfies
 * perfectly. The worker refuses an archive whose bytes do not hash to this
 * value, so a checksum computed from the wrong bytes does not fail loudly; it
 * makes every feed unusable at model time while the ingest reports success.
 *
 * So the checksum is now compared against a digest this test computes ITSELF,
 * from the exact bytes that were handed in, for every door.
 */
const digest = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

/** What the mocked fetcher returns for the catalog and URL doors. */
const FETCHED_BYTES = new Uint8Array([1, 2, 3, 4]);

vi.mock("@/lib/gtfs/fetch", () => ({
  fetchGtfsFeedBytes: vi.fn(async () => ({
    ok: true as const,
    bytes: new Uint8Array([1, 2, 3, 4]),
    // A REAL digest of those bytes, not a placeholder. A stand-in string here
    // would make the pass-through assertions below unfalsifiable in the same way
    // the shape assertions were.
    checksumSha256: createHash("sha256").update(new Uint8Array([1, 2, 3, 4])).digest("hex"),
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
    beginGtfsFeedVersion: vi.fn(async () => ({
      ok: true as const,
      feedId: FEED_ID,
      versionId: "44444444-4444-4444-8444-444444444444",
      createdFeed: true,
    })),
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
    failGtfsFeedVersion: vi.fn(async () => ({ recorded: true, feedStatusChanged: false })),
  };
});

/** A service-role double that records every Storage upload it is asked for. */
function serviceDouble(uploadError: { message: string } | null = null) {
  const uploads: Array<{
    bucket: string;
    path: string;
    contentType?: string;
    /** THE BYTES THEMSELVES. Recorded because "the checksum describes the object
     * that was written" is the property the worker's verification depends on,
     * and a double that discards the body cannot check it. */
    body: Uint8Array;
  }> = [];
  const updates: Array<Record<string, unknown>> = [];

  const client = {
    storage: {
      from(bucket: string) {
        return {
          upload(path: string, body: unknown, options?: { contentType?: string }) {
            uploads.push({
              bucket,
              path,
              contentType: options?.contentType,
              body: body as Uint8Array,
            });
            return Promise.resolve({ error: uploadError });
          },
          remove: () => Promise.resolve({ error: null }),
        };
      },
    },
    from() {
      return {
        update(payload: Record<string, unknown>) {
          updates.push(payload);
          return {
            eq: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: "x" }, error: null }) }) }),
          };
        },
      };
    },
  };

  return { client, uploads, updates };
}

async function ingest(source: GtfsIngestSource, uploadError: { message: string } | null = null) {
  const double = serviceDouble(uploadError);
  const result = await runGtfsIngest({
    service: double.client as never,
    workspaceId: WORKSPACE_ID,
    source,
    provisionalName: "example.org",
    requestedBy: null,
  });
  return { result, ...double };
}

const CATALOG_SOURCE: GtfsIngestSource = {
  kind: "catalog",
  downloadUrl: "https://example.org/gtfs.zip",
  catalogProvider: "mobility-database",
  catalogSourceId: "75",
  catalogRowStatus: "active",
};

const URL_SOURCE: GtfsIngestSource = { kind: "url", downloadUrl: "https://example.org/gtfs.zip" };

const UPLOAD_SOURCE: GtfsIngestSource = {
  kind: "upload",
  bytes: new Uint8Array([5, 6, 7, 8]),
  contentType: "application/zip",
  filename: "feed.zip",
};

describe("every ingest door keeps the archive it parsed", () => {
  it.each([
    ["catalog", CATALOG_SOURCE, FETCHED_BYTES],
    ["url", URL_SOURCE, FETCHED_BYTES],
    ["upload", UPLOAD_SOURCE, UPLOAD_SOURCE.bytes],
  ])("the %s door stores its bytes and records the checksum", async (_label, source, bytes) => {
    const { result, uploads } = await ingest(source as GtfsIngestSource);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(uploads).toHaveLength(1);
    expect(uploads[0].bucket).toBe("gtfs-uploads");
    // Workspace-scoped path, so one tenant's object key can never collide with
    // another's.
    expect(uploads[0].path.startsWith(`${WORKSPACE_ID}/${FEED_ID}/`)).toBe(true);
    expect(result.bytesStored).toBe(true);

    // THE VALUE, NOT THE SHAPE. A digest of the wrong bytes matches
    // /^[0-9a-f]{64}$/ perfectly, which is why the old assertion survived a
    // mutation that hashed a hardcoded three-byte array instead of the feed.
    expect(result.checksumSha256).toBe(digest(bytes as Uint8Array));

    // And the object that was WRITTEN is the object that was hashed. The worker
    // downloads this key and refuses anything that does not hash to the recorded
    // value, so a checksum describing different bytes than the ones stored is a
    // feed that can never reach a model run.
    expect(digest(uploads[0].body)).toBe(result.checksumSha256);
  });

  it("a digest of the wrong bytes is a DIFFERENT string — the assertion above can fail", () => {
    // The negative control for this file's central claim. Without it, a future
    // reader cannot tell whether `toBe(digest(bytes))` is discriminating or
    // whether every byte array in this file happens to hash alike.
    expect(digest(FETCHED_BYTES)).not.toBe(digest(UPLOAD_SOURCE.bytes));
    expect(digest(FETCHED_BYTES)).not.toBe(digest(new Uint8Array([9, 9, 9])));
  });

  it("names a mime type the bucket's allowed list actually carries", async () => {
    // 20260805000006 section 8 sets the allowed list to application/zip,
    // application/x-zip-compressed, application/octet-stream. A fetched archive
    // is a zip whatever Content-Type the agency's server chose to send.
    const { uploads } = await ingest(CATALOG_SOURCE);
    expect(["application/zip", "application/x-zip-compressed", "application/octet-stream"]).toContain(
      uploads[0].contentType
    );
  });

  it("points the version row at the object it just wrote, before the parse", async () => {
    // `reapAbandonedGtfsIngests` removes an abandoned ingest's object by reading
    // `storage_path` off the row, so a path that has not reached the row yet is
    // a path nothing can ever clean up.
    const { updates, uploads } = await ingest(URL_SOURCE);
    const pointer = updates.find((update) => "storage_path" in update);
    expect(pointer).toBeDefined();
    // The row points at the object that was actually written, and records the
    // digest of the bytes inside it. This is the whole contract the worker
    // verifies against: `storage_path` says where, `checksum_sha256` says what.
    expect(pointer?.storage_path).toBe(uploads[0].path);
    expect(pointer?.checksum_sha256).toBe(digest(FETCHED_BYTES));
  });
});

describe("a storage failure is fatal for an upload and survivable for an address", () => {
  it("fails the ingest when an UPLOADED archive cannot be stored", async () => {
    // It exists nowhere else. Continuing would strand a version that can never
    // reach the travel model, with re-uploading as the only recovery.
    const { result } = await ingest(UPLOAD_SOURCE, { message: "bucket unavailable" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("partial_write");
    expect(result.detail).toMatch(/could not be stored/);
  });

  it.each([
    ["catalog", CATALOG_SOURCE],
    ["url", URL_SOURCE],
  ])("keeps a %s ingest's service levels, and says the bytes were not kept", async (_label, source) => {
    const { result } = await ingest(source, { message: "bucket unavailable" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The service levels are correct and complete; only the archive is missing.
    expect(result.routeServiceLevelRows).toBe(10);
    // And the fact is REPORTED, not absorbed — the model handoff refuses by
    // name on the strength of the missing checksum, and this is what lets a
    // surface explain why before that happens.
    expect(result.bytesStored).toBe(false);
    expect(result.bytesNotStoredReason).toBe("bucket unavailable");
  });
});
