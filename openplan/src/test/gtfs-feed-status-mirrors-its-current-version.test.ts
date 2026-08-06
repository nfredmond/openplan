import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer, queryCatalog } from "./helpers/live-catalog";
import { loadSchemaInventory } from "./migrations/schema-inventory";

/**
 * LIVE GUARD — the price of a denormalised mirror, paid as a test.
 *
 * 20260805000006 records ONE fact — "which ingest of this feed is the one in
 * use, and how did it end" — in THREE places:
 *
 *   1. `gtfs_feed_versions.is_current` — the flag a partial unique index can
 *      make singular, so two current versions of one feed are unstorable.
 *   2. `gtfs_feeds.current_version_id` — the pointer a `.select()` on the feed
 *      can follow without a second round trip.
 *   3. `gtfs_feeds.status` — the mirror the Data Hub card renders, inherited
 *      from 20260219000001 where it was the only status that existed.
 *
 * Each is there for a reason and none can be dropped without cost, so the
 * denormalisation stays and the disagreement is guarded instead. That choice is
 * only defensible if the guard is structural: a comment saying "keep these in
 * sync" is a convention, and this repository's own history is a list of
 * conventions that were violated at least once.
 *
 * WHY A DISAGREEMENT MATTERS RATHER THAN BEING UNTIDY. `gtfs_feeds.status` is
 * what a planner sees on the feed card. A feed whose card says `ready` while
 * its current version says `failed` is a transit network presented as usable
 * when nothing was parsed — the same class of error as an empty feed marked
 * ready, which the `gtfs_feed_versions_ready_is_not_empty` CHECK makes
 * unstorable at the database layer. That CHECK cannot see the mirror, because
 * the mirror lives on another table. This test is the half the constraint
 * cannot reach.
 *
 * Run with: npm run test:rls-live
 *
 * The offline half below runs everywhere, so this file is never vacuous.
 */

const liveDescribe = LIVE_RLS ? describe : describe.skip;

/** The rows this invariant is about, expressed once. */
const MIRROR_DISAGREEMENTS =
  "SELECT f.id::text || ': feed.status=' || coalesce(f.status, '<null>') || " +
  "' but its current version says ' || v.status " +
  "FROM public.gtfs_feeds f " +
  "JOIN public.gtfs_feed_versions v ON v.feed_id = f.id AND v.is_current " +
  "WHERE f.status IS DISTINCT FROM v.status ORDER BY 1";

/** The pointer must reach a version of THIS feed that is actually current. */
const DANGLING_POINTERS =
  "SELECT f.id::text || ': current_version_id=' || f.current_version_id::text || ' is ' || " +
  "CASE WHEN v.id IS NULL THEN 'not a version at all' " +
  "WHEN v.feed_id <> f.id THEN 'a version of another feed' " +
  "ELSE 'not marked current' END " +
  "FROM public.gtfs_feeds f " +
  "LEFT JOIN public.gtfs_feed_versions v ON v.id = f.current_version_id " +
  "WHERE f.current_version_id IS NOT NULL " +
  "AND (v.id IS NULL OR v.feed_id <> f.id OR NOT v.is_current) ORDER BY 1";

/** And the other direction: a current version its own feed does not point at. */
const UNPOINTED_CURRENT_VERSIONS =
  "SELECT v.id::text || ': is_current, but its feed points at ' || " +
  "coalesce(f.current_version_id::text, '<null>') " +
  "FROM public.gtfs_feed_versions v " +
  "JOIN public.gtfs_feeds f ON f.id = v.feed_id " +
  "WHERE v.is_current AND f.current_version_id IS DISTINCT FROM v.id ORDER BY 1";

describe("gtfs feed status mirror (offline)", () => {
  /**
   * The build-blocking half. `test:rls-live` runs nightly and cannot fail a
   * push, so if the three mirrored columns were deleted or renamed the live
   * assertions below would simply stop finding anything to check — the
   * "reports a smaller world rather than an error" failure this repository has
   * been bitten by more than once. These read the migration corpus through the
   * same inventory `migration-schema-drift.test.ts` reconciles against the live
   * catalog, so a column that exists here exists in the database too.
   */
  it("the three mirrored columns still exist, so the live half has something to check", () => {
    const schema = loadSchemaInventory();

    expect(schema.hasColumn("gtfs_feeds", "status"), "gtfs_feeds.status").toBe(true);
    expect(schema.hasColumn("gtfs_feeds", "current_version_id"), "gtfs_feeds.current_version_id").toBe(true);
    expect(schema.hasColumn("gtfs_feed_versions", "is_current"), "gtfs_feed_versions.is_current").toBe(true);
    expect(schema.hasColumn("gtfs_feed_versions", "status"), "gtfs_feed_versions.status").toBe(true);

    // Negative control, so `hasColumn` cannot be answering true for everything.
    expect(schema.hasColumn("gtfs_feeds", "no_such_column")).toBe(false);
  });
});

liveDescribe("no gtfs_feeds row disagrees with its current version", () => {
  let container = "";
  let suffix = "";
  let feedId = "";
  let versionId = "";

  const exec = (sql: string) => queryCatalog(container, sql);

  beforeAll(() => {
    container = resolveLocalDbContainer();
    suffix = randomUUID().replace(/-/g, "").slice(0, 10);
    feedId = randomUUID();
    versionId = randomUUID();

    // A PUBLIC feed (workspace_id NULL) on purpose: this invariant is about the
    // mirror, not about tenancy, and seeding it public means the fixture needs
    // no workspace, no user and no auth round trip — so a failure here can only
    // be the invariant, never the scaffolding.
    exec(
      "INSERT INTO public.gtfs_feeds (id, workspace_id, city, state, agency_name, status, source_kind) " +
        `VALUES ('${feedId}', NULL, 'MirrorProbeCity${suffix}', 'ZZ', 'Mirror probe agency ${suffix}', ` +
        "'ready', 'url')"
    );
    exec(
      "INSERT INTO public.gtfs_feed_versions (id, workspace_id, feed_id, source_kind, status, " +
        "route_count, stop_count, route_service_level_rows, stop_service_level_rows, is_current) " +
        `VALUES ('${versionId}', NULL, '${feedId}', 'url', 'ready', 12, 340, 84, 340, true)`
    );
    exec(`UPDATE public.gtfs_feeds SET current_version_id = '${versionId}' WHERE id = '${feedId}'`);
  }, 60_000);

  afterAll(() => {
    if (!container || !feedId) return;
    // The version row cascades with the feed; the pointer's ON DELETE SET NULL
    // does not stand in the way because the feed itself is going.
    exec(`DELETE FROM public.gtfs_feeds WHERE id = '${feedId}'`);
  }, 60_000);

  it("seeds a feed whose card, pointer and version all agree (the assertions are not vacuous)", () => {
    const [row] = exec(
      "SELECT f.status || '|' || v.status || '|' || (f.current_version_id = v.id)::text || '|' || v.is_current::text " +
        "FROM public.gtfs_feeds f JOIN public.gtfs_feed_versions v ON v.feed_id = f.id " +
        `WHERE f.id = '${feedId}'`
    );

    expect(row, "the mirror fixture must exist before anything below is asserted").toBe(
      "ready|ready|true|true"
    );
  });

  it("finds no feed whose status disagrees with its current version", () => {
    expect(
      exec(MIRROR_DISAGREEMENTS),
      "gtfs_feeds.status is a denormalised copy of its current version's status. A feed card reading " +
        "`ready` over a version that failed presents a transit network as usable when nothing was parsed."
    ).toEqual([]);
  });

  it("finds no current_version_id pointing anywhere but at this feed's current version", () => {
    expect(
      exec(DANGLING_POINTERS),
      "gtfs_feeds.current_version_id must reach a version OF THIS FEED that is marked current"
    ).toEqual([]);
  });

  it("finds no current version its own feed does not point at", () => {
    expect(
      exec(UNPOINTED_CURRENT_VERSIONS),
      "a version marked is_current whose feed points elsewhere — the two halves of the mirror have " +
        "drifted, and which one a surface believes depends on which table it read"
    ).toEqual([]);
  });

  /**
   * THE NEGATIVE CONTROL — this is what makes the three empty results above
   * evidence rather than an absence of evidence.
   *
   * A broken query, an empty table and a healthy database all return zero rows.
   * So the invariant is deliberately violated here, the detector is required to
   * SEE it, and the damage is repaired unconditionally BEFORE any expectation
   * can throw — the lesson from `census_tracts`, where a probe that cleaned up
   * only on success stranded a forged row in shared data on precisely the run
   * where the guard worked.
   */
  it("detects a disagreement when one is deliberately introduced", () => {
    exec(`UPDATE public.gtfs_feeds SET status = 'failed' WHERE id = '${feedId}'`);
    const whileBroken = exec(MIRROR_DISAGREEMENTS);
    exec(`UPDATE public.gtfs_feeds SET status = 'ready' WHERE id = '${feedId}'`);
    const afterRepair = exec(MIRROR_DISAGREEMENTS);

    expect(
      whileBroken,
      "the detector did not see a mirror the test had just broken — every green run above proves nothing"
    ).toEqual([`${feedId}: feed.status=failed but its current version says ready`]);
    expect(afterRepair, "the repair must restore the invariant").toEqual([]);
  });

  it("detects a pointer aimed at a version of another feed", () => {
    const otherFeedId = randomUUID();
    const otherVersionId = randomUUID();
    exec(
      "INSERT INTO public.gtfs_feeds (id, workspace_id, city, state, agency_name, status, source_kind) " +
        `VALUES ('${otherFeedId}', NULL, 'MirrorProbeOther${suffix}', 'ZZ', 'Mirror probe other ${suffix}', ` +
        "'pending', 'url')"
    );
    exec(
      "INSERT INTO public.gtfs_feed_versions (id, workspace_id, feed_id, source_kind, status) " +
        `VALUES ('${otherVersionId}', NULL, '${otherFeedId}', 'url', 'pending')`
    );
    exec(`UPDATE public.gtfs_feeds SET current_version_id = '${otherVersionId}' WHERE id = '${feedId}'`);

    const whileBroken = exec(DANGLING_POINTERS);

    // Repair and remove the second feed unconditionally, before asserting.
    exec(`UPDATE public.gtfs_feeds SET current_version_id = '${versionId}' WHERE id = '${feedId}'`);
    exec(`DELETE FROM public.gtfs_feeds WHERE id = '${otherFeedId}'`);
    const afterRepair = exec(DANGLING_POINTERS);

    expect(
      whileBroken,
      "the pointer detector did not see a current_version_id aimed at another feed's version"
    ).toEqual([`${feedId}: current_version_id=${otherVersionId} is a version of another feed`]);
    expect(afterRepair, "the repair must restore the invariant").toEqual([]);
  });
});
