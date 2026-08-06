import { describe, expect, it } from "vitest";
import { collectSupabaseWriteSites } from "./supabase-call-sites";

/**
 * NATHANIEL'S DECISION OF 2026-08-05, CONVERTED FROM A SENTENCE INTO A BUILD
 * FAILURE: OpenPlan derives SERVICE LEVELS from a transit feed and never keeps
 * the timetable.
 *
 * WHY IT IS A PRODUCT COMMITMENT AND NOT A STORAGE PREFERENCE. A service level
 * — "buses come to this corner every 12 minutes on a weekday, first at 05:40,
 * last at 23:10" — is a PLANNING FACT about a published schedule. It is what a
 * planner cites in a regional transportation plan, a Title VI service-equity
 * finding, or a transit-priority determination, and it stays true for the
 * schedule it names. A timetable is a PROMISE TO A RIDER. It is stale the
 * moment an agency reroutes, and a product that appears to answer "what time is
 * the 4:15" is telling a member of the public to stand on a corner at a time no
 * bus is coming. OpenPlan does not read real-time feeds and is not a trip
 * planner; storing departure times would let it look like both.
 *
 * The eight raw-feed tables from 20260219000001 were deliberately KEPT rather
 * than dropped — dead schema is inert, a DROP against a hosted database is
 * irreversible, and a future departure-board feature should not need a new
 * migration to become possible. It should, however, need a new DECISION. This
 * guard is what makes that true: writing one of these tables stops the build,
 * so the conversation happens before the capability exists rather than after a
 * planner has been shown a departure time.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE TRAP THIS GUARD ALMOST FELL INTO, recorded because the next person will
 * meet it too: THE EIGHT TABLES ARE NOT PREFIXED. They are `stop_times`,
 * `trips`, `stops`, `routes`, `agencies`, `calendar`, `calendar_dates` and
 * `shapes` — bare, generic names sitting in `public` beside everything else.
 * Only the four DERIVED tables carry the `gtfs_` prefix. A guard written
 * against the names the module implies (`gtfs_stop_times`, `gtfs_trips`) would
 * match nothing, pass forever, and report that a rule was enforced which had
 * never been checked once. The names below were read out of the live database,
 * not inferred.
 * ────────────────────────────────────────────────────────────────────────────
 */

/**
 * The raw-feed tables, exactly as they are named in Postgres.
 *
 * `stop_times` and `trips` carry the product argument above and are the reason
 * this file exists. The other six are the rest of the raw-feed shape the
 * derived tables replaced; nothing writes them either, and the day something
 * wants to is a day worth stopping on.
 */
const RAW_FEED_TABLES = [
  "agencies",
  "calendar",
  "calendar_dates",
  "routes",
  "shapes",
  "stop_times",
  "stops",
  "trips",
] as const;

/** The tables the transit lane is allowed to write. */
const DERIVED_TABLES = [
  "gtfs_feeds",
  "gtfs_feed_versions",
  "gtfs_route_service_levels",
  "gtfs_stop_service_levels",
] as const;

const TRANSIT_LANE_PREFIXES = ["src/lib/gtfs/", "src/app/api/gtfs/"];

describe("the timetable is not persisted", () => {
  /**
   * NON-VACUITY, AND IT IS DOING REAL WORK HERE.
   *
   * Every assertion below is "this list is empty", which is also what a broken
   * collector returns, what a renamed table produces, and what a guard pointed
   * at the wrong names produces — the exact failure this file's header
   * describes. So before believing any empty list, prove the collector is
   * finding writes at all and finding this lane's writes specifically.
   */
  it("finds the write surface it is about to make claims over", () => {
    const sites = collectSupabaseWriteSites();

    expect(sites.length).toBeGreaterThan(100);
    expect(new Set(sites.map((site) => site.table).filter(Boolean)).size).toBeGreaterThan(50);

    // The derived tables ARE written, by the persist lane. If this stops being
    // true the collector has stopped seeing the transit lane, and every
    // assertion below would pass by looking at nothing.
    const derived = sites.filter((site) => site.table?.startsWith("gtfs_"));
    expect(derived.length).toBeGreaterThan(0);
    expect(new Set(derived.map((site) => site.table))).toEqual(
      new Set(["gtfs_feeds", "gtfs_feed_versions", "gtfs_route_service_levels", "gtfs_stop_service_levels"])
    );
  });

  it("writes no row to any raw-feed table, anywhere in the product", () => {
    const offenders = collectSupabaseWriteSites()
      .filter((site) => site.table !== null && (RAW_FEED_TABLES as readonly string[]).includes(site.table))
      .map((site) => `${site.file}:${site.line} ${site.verb} ${site.table}`);

    expect(
      offenders,
      "OpenPlan stores DERIVED SERVICE LEVELS and never the raw timetable (Nathaniel, 2026-08-05). " +
        "A write to one of these tables makes the product able to answer 'what time is the 4:15', " +
        "which it must never appear to do — it reads no real-time feed, so every such answer would " +
        "be a promise to a rider made from a schedule that may be months stale. If a departure-board " +
        "feature is genuinely wanted, that is a product decision to take deliberately, and changing " +
        "this test is how it gets taken."
    ).toEqual([]);
  });

  /**
   * THE HOLE THE ASSERTION ABOVE CANNOT SEE, closed where it actually matters.
   *
   * `collectSupabaseWriteSites` resolves `.from("literal")` and records
   * `table: null` for `.from(someVariable)`. A computed table name is therefore
   * invisible to the check above — a loop over a list of table names would
   * write `stop_times` with nothing to say so.
   *
   * Policing that across the whole repository would be over-reach: there are a
   * handful of legitimate dynamic writers elsewhere, and they are not this
   * file's business. But inside the transit lane it is exactly this file's
   * business, because this is where a "write the feed's tables in a loop"
   * refactor would be a natural thing to reach for. So the rule is scoped: in
   * `src/lib/gtfs/` and `src/app/api/gtfs/`, every write names its table
   * outright.
   *
   * `persist.ts` was written with two such loops and they were unrolled to
   * satisfy this — see the comment on `insertInBatches`, which explains that a
   * table name passed as a parameter also hides the write from the claim-tier
   * guard.
   */
  it("names every table it writes, so no computed name can hide one", () => {
    const computed = collectSupabaseWriteSites()
      .filter((site) => TRANSIT_LANE_PREFIXES.some((prefix) => site.file.startsWith(prefix)))
      .filter((site) => site.table === null)
      .map((site) => `${site.file}:${site.line} ${site.verb} .from(${site.tableExpression})`);

    expect(
      computed,
      "a write in the transit lane whose table name is computed rather than written out. The check " +
        "above resolves string literals only, so a computed name would let a raw-feed write through " +
        "unseen — and it also hides the written columns from the claim-tier guard, which walks this " +
        "lane looking for `median_headway_basis`."
    ).toEqual([]);
  });

  it("writes only the four derived tables from inside the transit lane", () => {
    const unexpected = collectSupabaseWriteSites()
      .filter((site) => TRANSIT_LANE_PREFIXES.some((prefix) => site.file.startsWith(prefix)))
      .filter((site) => site.table !== null)
      .filter((site) => !(DERIVED_TABLES as readonly string[]).includes(site.table as string))
      .map((site) => `${site.file}:${site.line} ${site.verb} ${site.table}`);

    expect(
      unexpected,
      "the transit lane writes a table outside the four derived ones it owns. That is not necessarily " +
        "wrong, but it is not something to do by accident — a feed ingest reaching into another " +
        "module's table is how one lane's failure becomes another's corrupted data."
    ).toEqual([]);
  });
});
