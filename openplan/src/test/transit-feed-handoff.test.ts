/**
 * THE TRANSIT-FEED HANDOFF — what a model run is told about the feed it models
 * transit from, and what it is structurally incapable of being told.
 *
 * WHY THE INVARIANTS ARE DRIVEN OVER PRODUCED STAMPS RATHER THAN FIXTURES.
 * CLAUDE.md records the cost of the other way: `record_stage_gate_hold` shipped
 * with a reachability test that passed against a hand-written fixture
 * describing a board the product cannot produce. A described fixture proves the
 * assertion; only a built one proves the feature. So every stamp asserted on
 * below comes out of `prepareTransitFeedHandoff` against a recording fake, and
 * `transitFeedStampViolation` is run over all of them.
 *
 * THE PROPERTY THIS FILE EXISTS FOR, above every branch it checks: THE STAMP
 * NAMES A UUID AND NEVER A PATH. `model_runs.input_snapshot_json` is writable
 * by workspace members and the worker reads Storage with the service-role key,
 * so a storage path travelling in the stamp would be a member-authored string
 * that a service-role reader dereferences — a cross-tenant read oracle. The
 * design removed the hazard instead of checking it, and a test is the only
 * thing that keeps it removed once someone adds "just one convenience field".
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  TRANSIT_FEED_HANDOFF_FEED_COLUMNS,
  TRANSIT_FEED_HANDOFF_VERSION_COLUMNS,
  TRANSIT_FEED_STAMP_VERSION,
  prepareTransitFeedHandoff,
  scheduleExpiredAt,
  transitFeedHandoffFailedStamp,
  transitFeedIdFromSnapshot,
  transitFeedNotSelectedStamp,
  transitFeedStampFromSnapshot,
  transitFeedStampViolation,
  type TransitFeedStamp,
} from "@/lib/models/transit-feed-handoff";
import { GTFS_CURRENT_VERSION_FILTER } from "@/lib/gtfs/persist";

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const FEED_ID = "33333333-3333-4333-8333-333333333333";
const VERSION_ID = "44444444-4444-4444-8444-444444444444";

const CORRIDOR = {
  type: "Polygon" as const,
  coordinates: [
    [
      [-121.5, 38.5],
      [-121.4, 38.5],
      [-121.4, 38.6],
      [-121.5, 38.6],
      [-121.5, 38.5],
    ],
  ],
};

/* -------------------------------------------------------------------------- */
/* A recording fake that answers by TABLE and remembers every filter           */
/* -------------------------------------------------------------------------- */

type Call = {
  table: string;
  columns: string;
  head: boolean;
  filters: Array<{ verb: string; column: string; value: unknown }>;
};

type Script = {
  feed?: { data: unknown; error: { message: string } | null };
  version?: { data: unknown; error: { message: string } | null };
  stopCount?: { count: number | null; error: { message: string } | null };
};

function fakeClient(script: Script) {
  const calls: Call[] = [];

  const builder = (call: Call) => {
    const chain = {
      eq(column: string, value: unknown) {
        call.filters.push({ verb: "eq", column, value });
        return chain;
      },
      gte(column: string, value: unknown) {
        call.filters.push({ verb: "gte", column, value });
        return chain;
      },
      lte(column: string, value: unknown) {
        call.filters.push({ verb: "lte", column, value });
        return chain;
      },
      maybeSingle() {
        if (call.table === "gtfs_feeds") return Promise.resolve(script.feed ?? { data: null, error: null });
        return Promise.resolve(script.version ?? { data: null, error: null });
      },
      // The coverage read is awaited directly, with no terminal method.
      then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
        return Promise.resolve(script.stopCount ?? { count: 0, error: null }).then(resolve, reject);
      },
    };
    return chain;
  };

  return {
    calls,
    client: {
      from(table: string) {
        return {
          select(columns: string, options?: { head?: boolean }) {
            const call: Call = { table, columns, head: Boolean(options?.head), filters: [] };
            calls.push(call);
            return builder(call);
          },
        };
      },
    },
  };
}

function readyVersionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: VERSION_ID,
    feed_id: FEED_ID,
    workspace_id: WORKSPACE_ID,
    source_kind: "catalog",
    source_url: "https://example.org/gtfs.zip",
    // THE FACT THAT THE ARCHIVE WAS KEPT. Defaulted to a real object key, so a
    // fixture that means "the bytes were not stored" has to say so explicitly.
    storage_path: `${WORKSPACE_ID}/${FEED_ID}/${VERSION_ID}.zip`,
    checksum_sha256: "a".repeat(64),
    service_start_date: "2025-01-01",
    service_end_date: "2025-04-05",
    frequency_trip_count: 0,
    scheduled_trip_count: 480,
    ...overrides,
  };
}

async function resolve(script: Script, feedId: string | null = FEED_ID, launch = "2026-08-06") {
  const fake = fakeClient(script);
  const stamp = await prepareTransitFeedHandoff({
    // The module takes a SupabaseClient; the fake implements the three methods
    // it actually uses. The clients in this repo are untyped by convention.
    client: fake.client as never,
    workspaceId: WORKSPACE_ID,
    feedId,
    corridorGeojson: CORRIDOR,
    launchDateIso: launch,
  });
  return { stamp, calls: fake.calls };
}

const HEALTHY: Script = {
  feed: { data: { id: FEED_ID, workspace_id: WORKSPACE_ID, agency_name: "Example Transit" }, error: null },
  version: { data: readyVersionRow(), error: null },
  stopCount: { count: 412, error: null },
};

/* -------------------------------------------------------------------------- */

describe("the transit-feed handoff", () => {
  it("hands over a feed version id, a checksum, and no reason", async () => {
    const { stamp } = await resolve(HEALTHY);

    expect(stamp.status).toBe("selected");
    expect(stamp.feedVersionId).toBe(VERSION_ID);
    expect(stamp.checksumSha256).toBe("a".repeat(64));
    expect(stamp.reason).toBeNull();
    expect(stamp.agencyName).toBe("Example Transit");
    expect(stamp.version).toBe(TRANSIT_FEED_STAMP_VERSION);
    expect(transitFeedStampViolation(stamp)).toBeNull();
  });

  it("reads the feed and its version scoped to THIS workspace, both halves of the predicate", async () => {
    const { calls } = await resolve(HEALTHY);

    const feedCall = calls.find((call) => call.table === "gtfs_feeds");
    expect(feedCall?.filters).toEqual([
      { verb: "eq", column: "id", value: FEED_ID },
      { verb: "eq", column: "workspace_id", value: WORKSPACE_ID },
    ]);

    // `gtfs_feeds.workspace_id IS NULL` is a PUBLIC preloaded feed shared by
    // every tenant. Without the explicit filter this would resolve one of those
    // — and the worker, which filters on the RUN's workspace, would then find
    // nothing and refuse for a reason pointing at the wrong thing.
    const versionCall = calls.find((call) => call.table === "gtfs_feed_versions");
    expect(versionCall?.filters).toEqual([
      { verb: "eq", column: "feed_id", value: FEED_ID },
      { verb: "eq", column: "workspace_id", value: WORKSPACE_ID },
      // Applied by `filterToCurrentReadyVersion`, never typed out here.
      { verb: "eq", column: "is_current", value: GTFS_CURRENT_VERSION_FILTER.is_current },
      { verb: "eq", column: "status", value: GTFS_CURRENT_VERSION_FILTER.status },
    ]);
  });

  it("asks the database for the columns the stamp renders", () => {
    // The clients are untyped, so a mocked one returns the fixture whatever
    // columns were asked for: deleting a column from a `.select()` leaves every
    // assertion above green while the real stamp renders `undefined`. The
    // projection string itself is the only thing that catches it.
    for (const column of [
      "storage_path",
      "checksum_sha256",
      "service_start_date",
      "service_end_date",
      "frequency_trip_count",
      "scheduled_trip_count",
      "source_kind",
      "source_url",
    ]) {
      expect(TRANSIT_FEED_HANDOFF_VERSION_COLUMNS).toContain(column);
    }
    expect(TRANSIT_FEED_HANDOFF_FEED_COLUMNS).toContain("agency_name");
  });

  it("reads the storage path and never carries its VALUE into the stamp", async () => {
    // THE SECURITY PROPERTY, restated the way it actually holds. The module has
    // to READ `storage_path` — it is the only fact that answers "were the bytes
    // kept", and the checksum that used to stand in for it is written on every
    // ready version whether or not an object exists. What must never happen is
    // the PATH reaching `input_snapshot_json`, which is member-writable JSONB a
    // service-role worker later reads.
    const { stamp } = await resolve(HEALTHY);
    const serialized = JSON.stringify(stamp);
    expect(serialized).not.toContain(`${WORKSPACE_ID}/${FEED_ID}/`);
    expect(serialized).not.toMatch(/storage/i);
    expect(Object.keys(stamp).some((key) => /path|storage|bucket/i.test(key))).toBe(false);
  });

  it("refuses a stamp that smuggles a storage path through any field", () => {
    // The reduction to a boolean happens on the line the column is read, which
    // is a CONVENTION — and a convention is what the next edit breaks. The
    // invariant is asserted over every string the stamp carries instead.
    const smuggled = {
      ...transitFeedNotSelectedStamp(),
      sourceUrl: `${WORKSPACE_ID}/${FEED_ID}/${VERSION_ID}.zip`,
    };
    expect(transitFeedStampViolation(smuggled)).toMatch(/storage path/);

    // And a real publisher URL ending in `.zip` is NOT a storage path. A guard
    // that refused those would refuse the ordinary catalog feed.
    expect(
      transitFeedStampViolation({
        ...transitFeedNotSelectedStamp(),
        sourceUrl: "https://example.org/feeds/gtfs.zip",
      })
    ).toBeNull();
  });

  it("HANDS OVER a partly frequency-based feed and discloses what will be excluded", async () => {
    // THE OVER-REFUSAL THIS REPLACES. This module used to answer
    // `unsupported_by_skim` terminally on ANY frequency-based trip, so the run
    // modeled NO transit. Measured: of 16 sampled US feeds 7 ship
    // frequencies.txt, six header-only, and the seventh carries 4 rows over 2 of
    // its 18,150 trips — that agency lost its entire feed over four rows, and a
    // planner who NAMED their feed got less transit than one who named none.
    //
    // The worker now drops frequency-based TRIPS and counts them, refusing only
    // when nothing scheduled is left on the modeled day. It is the authority;
    // this module discloses.
    const { stamp } = await resolve({
      ...HEALTHY,
      version: {
        data: readyVersionRow({ frequency_trip_count: 2, scheduled_trip_count: 18148 }),
        error: null,
      },
    });

    expect(stamp.status).toBe("selected");
    expect(stamp.feedVersionId).toBe(VERSION_ID);
    expect(stamp.reason).toBeNull();
    expect(stamp.frequencyTripCount).toBe(2);
    expect(stamp.scheduledTripCount).toBe(18148);
    expect(transitFeedStampViolation(stamp)).toBeNull();
  });

  it("never produces the unsupported_by_skim status any more", async () => {
    // The status stays in the union because stored runs carry it and the worker
    // still maps it. Nothing this module can be driven to do may mint a new one.
    for (const frequencyTrips of [0, 1, 2, 18150]) {
      const { stamp } = await resolve({
        ...HEALTHY,
        version: { data: readyVersionRow({ frequency_trip_count: frequencyTrips }), error: null },
      });
      expect(stamp.status, `frequency_trip_count=${frequencyTrips}`).not.toBe("unsupported_by_skim");
    }
  });

  it("says the archive was not kept when the ingest stored NO OBJECT", async () => {
    // THE BRANCH THAT NEVER FIRED. It used to test `checksum_sha256`, which
    // `ingest.ts` computes for all three doors before any storage attempt and
    // `persist.ts` writes on every ready version — so every catalog and URL
    // ingest whose bytes were never stored was stamped `selected` and shown to a
    // planner as handed over, with nothing for the worker to read.
    const { stamp } = await resolve({
      ...HEALTHY,
      version: {
        // A CATALOG feed, which is exactly the door that historically kept only
        // the address. The checksum is present, as it always is.
        data: readyVersionRow({ source_kind: "catalog", storage_path: null }),
        error: null,
      },
    });

    expect(stamp.status).toBe("unavailable");
    expect(stamp.feedVersionId).toBeNull();
    expect(stamp.reason).toMatch(/was not kept/);
    expect(stamp.reason).toMatch(/Bring the feed in again/);
    // Identity still travels, so a surface can name the feed it is refusing.
    expect(stamp.agencyName).toBe("Example Transit");

    // A blank path is the same fact as a missing one.
    const blank = await resolve({
      ...HEALTHY,
      version: { data: readyVersionRow({ storage_path: "   " }), error: null },
    });
    expect(blank.stamp.status).toBe("unavailable");
  });

  it("says the checksum is missing when the object exists but nothing can prove it", async () => {
    const { stamp } = await resolve({
      ...HEALTHY,
      version: { data: readyVersionRow({ checksum_sha256: null }), error: null },
    });

    expect(stamp.status).toBe("unavailable");
    expect(stamp.feedVersionId).toBeNull();
    expect(stamp.reason).toMatch(/no checksum was recorded/);
  });

  it("says so when the feed has no completed ingest in use", async () => {
    const { stamp } = await resolve({ ...HEALTHY, version: { data: null, error: null } });

    expect(stamp.status).toBe("unavailable");
    expect(stamp.reason).toMatch(/no completed ingest in use/);
  });

  it("does not treat another workspace's feed as this workspace's", async () => {
    // The filter above is what makes this row unreachable; a null answer is the
    // shape that reaches this branch.
    const { stamp } = await resolve({
      feed: { data: null, error: null },
      version: { data: readyVersionRow({ workspace_id: OTHER_WORKSPACE_ID }), error: null },
    });

    expect(stamp.status).toBe("unavailable");
    expect(stamp.feedVersionId).toBeNull();
    expect(stamp.reason).toMatch(/not one of this workspace's feeds/);
  });

  it("reports a read failure as handoff_failed, never as an absent feed", async () => {
    // "The database did not answer" and "you have no such feed" send a planner
    // to completely different places.
    const { stamp } = await resolve({
      feed: { data: null, error: { message: "connection reset" } },
    });

    expect(stamp.status).toBe("handoff_failed");
    expect(stamp.reason).toMatch(/connection reset/);
  });

  it("records an expired schedule without refusing it", async () => {
    // Three of four real Sacramento-area feeds measured 2026-08-05 had already
    // expired — SacRT's sixteen months earlier. Refusing them would refuse most
    // of the country; saying nothing would model a stale schedule in silence.
    const { stamp } = await resolve(HEALTHY, FEED_ID, "2026-08-06");

    expect(stamp.status).toBe("selected");
    expect(stamp.scheduleExpiredAtLaunch).toBe(true);
    expect(stamp.serviceEndDate).toBe("2025-04-05");
  });

  it("carries the coverage answer as advisory, and still selects the feed", async () => {
    // The worker's `feed_covers` is the authority and compares against the
    // resolved zone system; this compares against the study-area envelope. A
    // disagreement is legitimate, so this must not become a refusal.
    const { stamp } = await resolve({ ...HEALTHY, stopCount: { count: 0, error: null } });

    expect(stamp.status).toBe("selected");
    expect(stamp.coversStudyArea).toBe("no");
    expect(stamp.reason).toBeNull();
  });

  it("says not_determined — never `no` — when the coverage read fails", async () => {
    const { stamp } = await resolve({
      ...HEALTHY,
      stopCount: { count: null, error: { message: "statement timeout" } },
    });

    expect(stamp.coversStudyArea).toBe("not_determined");
  });

  it("skips the coverage query entirely for a feed it is already refusing", async () => {
    const { calls } = await resolve({
      ...HEALTHY,
      version: { data: readyVersionRow({ storage_path: null }), error: null },
    });

    expect(calls.some((call) => call.table === "gtfs_stop_service_levels")).toBe(false);
  });

  it("records not_selected without touching the database at all", async () => {
    const { stamp, calls } = await resolve(HEALTHY, null);

    expect(stamp.status).toBe("not_selected");
    expect(stamp.feedVersionId).toBeNull();
    expect(calls).toEqual([]);
    // A reason even here: a person reading this packet in six months needs to
    // know nothing was chosen, not that a field is missing.
    expect(stamp.reason).toBeTruthy();
  });

  it("holds its invariants on every stamp it can produce", async () => {
    const produced: TransitFeedStamp[] = [
      (await resolve(HEALTHY)).stamp,
      (await resolve(HEALTHY, null)).stamp,
      (await resolve({ ...HEALTHY, version: { data: null, error: null } })).stamp,
      (await resolve({ ...HEALTHY, version: { data: readyVersionRow({ checksum_sha256: null }), error: null } }))
        .stamp,
      (await resolve({ ...HEALTHY, version: { data: readyVersionRow({ storage_path: null }), error: null } }))
        .stamp,
      (await resolve({ ...HEALTHY, version: { data: readyVersionRow({ frequency_trip_count: 9 }), error: null } }))
        .stamp,
      (await resolve({ feed: { data: null, error: null } })).stamp,
      (await resolve({ feed: { data: null, error: { message: "boom" } } })).stamp,
      transitFeedNotSelectedStamp(),
      transitFeedHandoffFailedStamp("no service-role key", FEED_ID),
    ];

    // The scan finding nothing is indistinguishable from every stamp holding.
    expect(produced.length).toBeGreaterThan(5);
    expect(new Set(produced.map((stamp) => stamp.status)).size).toBeGreaterThan(3);

    for (const stamp of produced) {
      expect(transitFeedStampViolation(stamp), JSON.stringify(stamp)).toBeNull();
    }
  });
});

describe("the wire contract with the worker", () => {
  it("PINS the stamp version against a literal on this side of the seam", () => {
    // A CROSS-LANGUAGE CONSTANT NOTHING PINNED. `gtfs_skim.parse_feed_selection`
    // refuses any stamp whose `version` it does not recognise — correctly, since
    // guessing at a newer shape is how a run silently skims a feed nobody chose.
    // So drifting this string by one character disables the whole feature for
    // every run, and until this assertion existed it did so with all 21 worker
    // suites and 7,400 app tests green. The Python side pins the same literal in
    // `test_transit_feed_handoff.py`, so a change has to be a deliberate edit
    // that shows up on BOTH sides of a diff.
    expect(TRANSIT_FEED_STAMP_VERSION).toBe("transit-feed-v1");
  });
});

describe("the stamp invariants themselves", () => {
  const selected: TransitFeedStamp = {
    version: TRANSIT_FEED_STAMP_VERSION,
    status: "selected",
    feedVersionId: VERSION_ID,
    feedId: FEED_ID,
    agencyName: "Example Transit",
    sourceKind: "catalog",
    sourceUrl: null,
    checksumSha256: "b".repeat(64),
    serviceStartDate: null,
    serviceEndDate: null,
    scheduleExpiredAtLaunch: null,
    frequencyTripCount: 0,
    scheduledTripCount: 480,
    coversStudyArea: "yes",
    reason: null,
  };

  it("rejects a selected stamp that names no feed version", () => {
    // The gap that let a negative control pass: every fixture in this block set
    // `feedVersionId`, so the first branch of the invariant was never driven.
    expect(transitFeedStampViolation({ ...selected, feedVersionId: null })).toMatch(
      /feedVersionId/
    );
  });

  it("rejects a selected stamp with no checksum — the worker could prove nothing", () => {
    expect(transitFeedStampViolation({ ...selected, checksumSha256: null })).toMatch(/checksum/);
  });

  it("rejects a selected stamp carrying a refusal reason", () => {
    expect(transitFeedStampViolation({ ...selected, reason: "something" })).toMatch(/refusal reason/);
  });

  it("rejects a REFUSED stamp that still carries a version the worker would act on", () => {
    expect(
      transitFeedStampViolation({ ...selected, status: "unavailable", reason: "because" })
    ).toMatch(/feedVersionId/);
  });

  it("rejects a refused stamp with nothing to show a planner", () => {
    expect(
      transitFeedStampViolation({ ...selected, status: "unavailable", feedVersionId: null, reason: "" })
    ).toMatch(/no reason/);
  });

  it("rejects a stamp from a wire format this build does not speak", () => {
    expect(transitFeedStampViolation({ ...selected, version: "transit-feed-v9" as never })).toMatch(
      /stamp version/
    );
  });
});

describe("schedule expiry is a string comparison, not a Date", () => {
  it("compares calendar days", () => {
    expect(scheduleExpiredAt("2025-04-05", "2025-04-06")).toBe(true);
    expect(scheduleExpiredAt("2025-04-05", "2025-04-05")).toBe(false);
    expect(scheduleExpiredAt("2025-04-05", "2025-04-04")).toBe(false);
  });

  it("does not expire a feed part-way through its own last service day", () => {
    // THE ONE THAT PROVES THE IMPLEMENTATION, and it was added because the
    // three assertions above did NOT: swapping the string comparison for
    // `new Date(end) < new Date(launch)` left them all green.
    //
    // The launch value is a full ISO timestamp (`launchedAt`). `new Date(
    // "2025-04-05")` is midnight UTC, so any run launched after midnight on the
    // feed's own final service day would be told its schedule had already
    // ended — while the bus was still running. A calendar date printed in a
    // feed is not a moment.
    expect(scheduleExpiredAt("2025-04-05", "2025-04-05T02:00:00.000Z")).toBe(false);
    expect(scheduleExpiredAt("2025-04-05", "2025-04-05T23:59:59.999Z")).toBe(false);
    expect(scheduleExpiredAt("2025-04-05", "2025-04-06T00:00:00.000Z")).toBe(true);
  });

  it("answers null — not false — when the feed stated no end date", () => {
    // `false` is a positive claim that the schedule is current.
    expect(scheduleExpiredAt(null, "2026-08-06")).toBeNull();
    expect(scheduleExpiredAt("not-a-date", "2026-08-06")).toBeNull();
  });

  it("accepts a full ISO timestamp as the launch moment", () => {
    expect(scheduleExpiredAt("2025-04-05", "2026-08-06T14:22:01.000Z")).toBe(true);
  });
});

describe("reading a stamp back off a stored run", () => {
  it("recovers the FEED, so a relaunch re-resolves to the version in use now", () => {
    // This is what makes "bring the feed in again, then relaunch" a true
    // instruction. Recovering `feedVersionId` instead would pin the run to an
    // ingest that is no longer current.
    expect(transitFeedIdFromSnapshot({ transitFeed: { feedId: FEED_ID } })).toBe(FEED_ID);
  });

  it("returns null for every shape a run written by an older build can have", () => {
    for (const snapshot of [null, undefined, {}, [], "x", { transitFeed: null }, { transitFeed: [] }, { transitFeed: { feedId: "" } }]) {
      expect(transitFeedIdFromSnapshot(snapshot)).toBeNull();
      }
  });

  it("hands a surface the whole stored record, including fields this build does not know", () => {
    const stored = { transitFeed: { status: "selected", somethingNewer: 7 } };
    expect(transitFeedStampFromSnapshot(stored)).toEqual({ status: "selected", somethingNewer: 7 });
    expect(transitFeedStampFromSnapshot({})).toBeNull();
  });
});

describe("the handoff is reachable from both paths that queue a worker run", () => {
  /**
   * REACHABILITY, NOT EXISTENCE. A correct handoff that no route calls is the
   * shipped-invisible defect class, of which this repository has eleven
   * recorded instances. The initial launch and the relaunch must BOTH call it —
   * one copy is how the zone-attribute recovery loop was broken in the first
   * place, and the same trap is set here.
   */
  const READ = (relative: string) =>
    readFileSync(path.join(process.cwd(), relative), "utf8");

  it("the initial launch resolves a stamp and stamps it into the run", () => {
    const source = READ("src/app/api/models/[modelId]/runs/route.ts");
    expect(source).toMatch(/prepareTransitFeedHandoff\s*\(/);
    expect(source).toMatch(/transitFeedId/);
    expect(source).toMatch(/\{\s*transitFeed\s*\}/);
  });

  it("the relaunch REBUILDS it rather than re-queueing the stored one", () => {
    const source = READ("src/app/api/models/[modelId]/runs/[modelRunId]/launch/route.ts");
    // The call, not the import — this repo has shipped a guard defeated by
    // import-only matching.
    expect(source).toMatch(/prepareTransitFeedHandoff\s*\(/);
    // And it must read the FEED off the prior snapshot, not the version.
    expect(source).toMatch(/transitFeedIdFromSnapshot\s*\(/);
    expect(source).toMatch(/transitFeed\s*\}/);
  });

  it("the launch control offers the picker and sends what it collected", () => {
    const source = READ("src/components/models/model-run-manager.tsx");
    expect(source).toMatch(/managed-run-transit-feed/);
    expect(source).toMatch(/transitFeedId:\s*supportsTransitFeed/);
  });

  it("the model page supplies the picker its feeds — a control with no list is unreachable", () => {
    const source = READ("src/app/(app)/models/[modelId]/page.tsx");
    expect(source).toMatch(/transitFeeds=\{transitFeedOptions\}/);
    expect(source).toMatch(/filterToCurrentReadyVersion\s*\(/);
  });
});
