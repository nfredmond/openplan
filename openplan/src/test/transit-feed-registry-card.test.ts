import { describe, expect, it } from "vitest";
import {
  describeGtfsServiceWindow,
  describeTransitFeedRegistry,
  type TransitFeedRow,
  type TransitFeedVersionRow,
} from "@/lib/transit/feed-registry-card";

/**
 * THE CARD THAT PROMISED A FEATURE THAT DOES NOT EXIST — AND THEN DENIED ONE
 * THAT DOES.
 *
 * The Data Hub shipped a constant reading "GTFS uploads — Transit feed storage
 * already exists in the current architecture and can fold into this registry",
 * rendered under "Visible system component" beside registries that are real.
 * Nine GTFS tables had existed since 20260219000001 and nothing in `src/` read
 * or wrote one of them.
 *
 * These assertions are about what may be SAID, which is why they are made on
 * the wording rather than only on the state code. A future refactor that keeps
 * the state and softens the sentence back into "storage already exists" would
 * reintroduce the defect with the tests green.
 *
 * ============================ WHY ONE OF THESE ASSERTIONS WAS INVERTED
 *
 * The fix over-corrected into the opposite error, and this file pinned it: it
 * REQUIRED the sentence "OpenPlan does not have a feed upload path yet" and
 * required the unlock to be phrased as a conditional ("would"). Both were the
 * honest wording at the time and both became FALSE when `/api/gtfs/*` and the
 * Data Hub's ingest panel shipped — at which point the card was talking a
 * planner out of looking for a control now sitting on the same page.
 *
 * The assertion was REWRITTEN, NOT DELETED, and it still points at the same two
 * sentences: the old wording must now be ABSENT and the three doors must be
 * named. A claim guard that is dropped as soon as it becomes inconvenient is
 * not a guard.
 */

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";

/** Deterministic, so this file is locale-free. The page passes its own. */
const formatTimestamp = (value: string | null) => (value ? `at ${value}` : "never");

function feed(overrides: Partial<TransitFeedRow> = {}): TransitFeedRow {
  return {
    id: "feed-1",
    workspace_id: WORKSPACE_ID,
    agency_name: "Mountain Transit",
    status: "loaded",
    loaded_at: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function version(overrides: Partial<TransitFeedVersionRow> = {}): TransitFeedVersionRow {
  return {
    feed_id: "feed-1",
    workspace_id: WORKSPACE_ID,
    service_start_date: "2026-01-05",
    service_end_date: "2026-12-31",
    route_service_level_rows: 42,
    stop_service_level_rows: 1_800,
    ...overrides,
  };
}

function describe_(input: Partial<Parameters<typeof describeTransitFeedRegistry>[0]> = {}) {
  return describeTransitFeedRegistry({
    workspaceId: WORKSPACE_ID,
    readFailed: false,
    feeds: [],
    formatTimestamp,
    ...input,
  });
}

describe("describeTransitFeedRegistry", () => {
  it("says no feed has been ingested, and names the three doors that now exist", () => {
    const card = describe_({ feeds: [] });

    expect(card.state).toBe("no-feed");
    expect(card.detail).toContain("No transit feed has been ingested for this workspace");

    // The exact claim that was on the page, and the family it belongs to. A
    // planner acted on this by going to look for an upload control.
    expect(card.detail).not.toMatch(/storage already exists/i);
    expect(card.detail).not.toMatch(/already exists/i);
    expect(card.detail).not.toMatch(/can fold into/i);

    // THE INVERTED ASSERTION. This required "does not have a feed upload path
    // yet" until the ingest lane shipped and made it false. Same sentence,
    // opposite demand — it must be gone, and the doors that replaced it must be
    // named, or the card sends a planner away from a control on this page.
    expect(card.detail).not.toMatch(/does not have a feed upload path yet/i);
    expect(card.detail).not.toMatch(/no ingest path/i);
    expect(card.detail).toMatch(/search the public feed catalog/i);
    expect(card.detail).toMatch(/paste an operator's GTFS address/i);
    expect(card.detail).toMatch(/upload a GTFS \.zip/i);

    // And the unlock is no longer a conditional, because it is no longer
    // hypothetical — while staying bounded to service levels, never a timetable.
    expect(card.detail).not.toMatch(/A loaded feed would/i);
    expect(card.detail).toMatch(/A loaded feed gives/i);
  });

  it("declines to claim anything when the registry read failed", () => {
    const card = describe_({ readFailed: true, feeds: [feed()] });

    expect(card.state).toBe("read-failed");
    expect(card.tone).toBe("warning");
    // A failed question is not an answer of none — the collapse `data ?? []`
    // makes, which would have reported this workspace as having no feed.
    expect(card.detail).not.toContain("No transit feed has been ingested");
    expect(card.detail).toMatch(/could not be read/i);
    // And it must not describe the rows it was handed, either.
    expect(card.detail).not.toContain("Mountain Transit");
  });

  it("reports the agency, status and load time of a feed that is present", () => {
    const card = describe_({
      feeds: [feed({ agency_name: "Mountain Transit", status: "loaded", loaded_at: "2026-08-01T00:00:00.000Z" })],
    });

    expect(card.state).toBe("feed-present");
    expect(card.detail).toContain("Mountain Transit");
    expect(card.detail).toContain("loaded");
    expect(card.detail).toContain("at 2026-08-01T00:00:00.000Z");
    expect(card.tone).toBe("success");
  });

  it("does not present another workspace's feed, or a public one, as this workspace's own", () => {
    // `gtfs_feeds.workspace_id` is NULLABLE and a null means a PUBLIC preloaded
    // feed shared across deployments. If the caller's `.eq("workspace_id", …)`
    // were ever dropped, this workspace would be shown a stranger's agency
    // name under "no feed has been ingested"'s replacement — a false statement
    // about the agency's own data that nothing downstream could detect.
    const card = describe_({
      feeds: [
        feed({ id: "public-feed", workspace_id: null, agency_name: "Preloaded Metro" }),
        feed({ id: "other-feed", workspace_id: OTHER_WORKSPACE_ID, agency_name: "Somebody Else Transit" }),
      ],
    });

    expect(card.state).toBe("no-feed");
    expect(card.detail).not.toContain("Preloaded Metro");
    expect(card.detail).not.toContain("Somebody Else Transit");
  });

  it("says a registered feed is not loaded rather than inventing a load time", () => {
    const card = describe_({ feeds: [feed({ status: "pending", loaded_at: null })] });

    expect(card.state).toBe("feed-present");
    expect(card.detail).toContain("not loaded yet");
    expect(card.detail).not.toContain("never");
    expect(card.tone).toBe("info");
  });

  it("leads with the most recently loaded feed and counts the rest", () => {
    const card = describe_({
      feeds: [
        feed({ id: "a", agency_name: "Older Agency", loaded_at: "2026-01-01T00:00:00.000Z" }),
        feed({ id: "b", agency_name: "Newer Agency", loaded_at: "2026-08-01T00:00:00.000Z" }),
      ],
    });

    expect(card.detail.startsWith("Newer Agency")).toBe(true);
    expect(card.detail).toContain("1 other feed is registered");
  });

  it("passes an unrecognised status through instead of inventing a vocabulary", () => {
    // `gtfs_feeds.status` is unconstrained TEXT with no CHECK, so a value this
    // module does not know is a value the database will happily store.
    const card = describe_({ feeds: [feed({ status: "partially_ingested" })] });

    expect(card.detail).toContain("partially_ingested");
    expect(card.tone).toBe("neutral");
  });

  /**
   * EXPIRY IS THE NORMAL CASE. Three of the four real Sacramento-area catalog
   * feeds measured on 2026-08-05 had already ended; SacRT's schedule stopped on
   * 2025-04-05, sixteen months earlier. A card printing `status = 'loaded'`
   * over that reports on the INGEST and lets the reader infer the SERVICE.
   */
  it("says a loaded feed's schedule has expired, and warns rather than reassures", () => {
    const card = describe_({
      feeds: [feed()],
      currentVersions: [version({ service_start_date: "2024-08-01", service_end_date: "2025-04-05" })],
      today: "2026-08-05",
    });

    expect(card.detail).toContain("Mountain Transit");
    expect(card.detail).toMatch(/that schedule ENDED/i);
    expect(card.detail).toContain("2025-04-05");
    // `status = 'loaded'` alone would have made this "success".
    expect(card.tone).toBe("warning");
  });

  it("says a feed whose schedule is in effect is in effect, without a warning", () => {
    const card = describe_({
      feeds: [feed()],
      currentVersions: [version({ service_start_date: "2026-01-05", service_end_date: "2026-12-31" })],
      today: "2026-08-05",
    });

    expect(card.detail).toMatch(/in effect today/i);
    expect(card.detail).not.toMatch(/ENDED/);
    expect(card.tone).toBe("success");
  });

  it("does not borrow a public preloaded feed's service window for this workspace", () => {
    // A version row with a null workspace belongs to a PUBLIC feed shared by
    // every tenant. Matching on `feed_id` alone would print its window under
    // this workspace's agency name.
    const card = describe_({
      feeds: [feed()],
      currentVersions: [version({ workspace_id: null, service_end_date: "2025-04-05" })],
      today: "2026-08-05",
    });

    expect(card.detail).not.toContain("2025-04-05");
    expect(card.detail).toMatch(/No ingest of this feed has been adopted yet/i);
  });

  /**
   * THE SECOND TABLE GETS THE SAME RULE AS THE FIRST, AND DID NOT.
   *
   * The page threaded `readFailed` from the `gtfs_feeds` read only and
   * collapsed the version rows with `data ?? []`, so a failed
   * `gtfs_feed_versions` read arrived here as an empty array and was reported
   * as "No ingest of this feed has been adopted yet" — a claim about this
   * feed's ingests, made from a question the database never answered — beside a
   * green "loaded" badge, with the expired-schedule warning silently gone.
   * Three things must hold: not the adopted-nothing sentence, not a service
   * window, and not a reassuring tone.
   */
  it("says the adopted version could not be read, rather than that none was adopted", () => {
    const card = describe_({
      feeds: [feed()],
      versionReadFailed: true,
      // What `data ?? []` hands a caller when the read errored: nothing.
      currentVersions: [],
      today: "2026-08-05",
    });

    expect(card.state).toBe("feed-present");
    expect(card.detail).toContain("Mountain Transit");
    expect(card.detail).toMatch(/adopted version of this feed could not be read/i);
    expect(card.detail).toMatch(/nothing here says whether this schedule is still in effect/i);

    // The sentence it must never be mistaken for.
    expect(card.detail).not.toMatch(/No ingest of this feed has been adopted yet/i);
    // And it may not manufacture a window out of the rows it does not have.
    expect(card.detail).not.toMatch(/Service window/i);
    expect(card.detail).not.toMatch(/in effect today/i);
    // `status = 'loaded'` alone would have made this "success" — a green badge
    // over an unanswered question.
    expect(card.tone).toBe("warning");
  });

  it("does not treat a successful version read as a failed one", () => {
    // The negative control for the flag above: same feed, same empty-ish shape,
    // read that worked. This is the case that must still say nothing was
    // adopted, or the new branch would swallow the honest answer too.
    const card = describe_({ feeds: [feed()], versionReadFailed: false, currentVersions: [], today: "2026-08-05" });

    expect(card.detail).toMatch(/No ingest of this feed has been adopted yet/i);
    expect(card.detail).not.toMatch(/could not be read/i);
  });

  it("says nothing about a window when no version has been adopted", () => {
    const card = describe_({ feeds: [feed()], currentVersions: [], today: "2026-08-05" });

    expect(card.detail).toMatch(/No ingest of this feed has been adopted yet/i);
    expect(card.detail).not.toMatch(/Service window/i);
  });
});

/**
 * THE SHARED EXPIRY HELPER.
 *
 * Pure and exported because two surfaces need the same sentence — the Data Hub
 * card and the ingest panel. Two copies would drift, and the weaker one is
 * always the one a planner ends up quoting.
 */
describe("describeGtfsServiceWindow", () => {
  it("treats a missing end date as unknown, never as still running", () => {
    const window = describeGtfsServiceWindow({ startDate: "2026-01-01", endDate: null, today: "2026-08-05" });

    expect(window.state).toBe("unstated");
    expect(window.text).toMatch(/cannot say whether its schedule is still in effect/i);
    expect(window.text).not.toMatch(/in effect today/i);
  });

  it("calls an ended schedule ended, and says how long ago in readable units", () => {
    expect(
      describeGtfsServiceWindow({ startDate: "2024-08-01", endDate: "2025-04-05", today: "2026-08-05" })
    ).toMatchObject({ state: "expired" });
    // Sixteen months, the real SacRT gap. Not "488 days".
    expect(
      describeGtfsServiceWindow({ startDate: "2024-08-01", endDate: "2025-04-05", today: "2026-08-05" }).text
    ).toContain("16 months ago");
    expect(
      describeGtfsServiceWindow({ startDate: null, endDate: "2026-08-02", today: "2026-08-05" }).text
    ).toContain("3 days ago");
  });

  /** The boundary. A schedule ending today has not ended. */
  it("does not call a schedule ending today expired", () => {
    expect(
      describeGtfsServiceWindow({ startDate: "2026-01-01", endDate: "2026-08-05", today: "2026-08-05" }).state
    ).toBe("current");
    expect(
      describeGtfsServiceWindow({ startDate: "2026-01-01", endDate: "2026-08-04", today: "2026-08-05" }).state
    ).toBe("expired");
  });

  it("distinguishes a schedule that has not started from one that is running", () => {
    expect(
      describeGtfsServiceWindow({ startDate: "2027-01-01", endDate: "2027-12-31", today: "2026-08-05" })
    ).toMatchObject({ state: "not_started" });
  });

  /**
   * FOUND BY WRITING THIS TEST, AND THE BUG WAS REAL.
   *
   * Dates are compared as `YYYY-MM-DD` STRINGS on purpose — they are DATE
   * columns with no time zone, and parsing them into `Date` objects introduces
   * a local-midnight offset that moves an end date across a day boundary
   * depending on where the reader sits. But string comparison also means
   * `"not-a-date" < "2026-08-05"` is FALSE, so an unreadable value fell through
   * to "in effect today" — a claim about live service manufactured out of
   * garbage, and in the reassuring direction, which is the dangerous one.
   * Anything that is not a calendar date is now an UNKNOWN.
   */
  it("calls an unreadable end date unknown, never 'in effect today'", () => {
    const window = describeGtfsServiceWindow({ startDate: null, endDate: "not-a-date", today: "2026-08-05" });

    expect(window.state).toBe("unstated");
    expect(window.text).not.toMatch(/in effect today/i);
    expect(window.text).toMatch(/no readable service end date/i);
  });

  it("ignores an unreadable START date rather than printing it beside a real end date", () => {
    const window = describeGtfsServiceWindow({ startDate: "garbage", endDate: "2026-12-31", today: "2026-08-05" });

    expect(window.state).toBe("current");
    expect(window.text).not.toContain("garbage");
    expect(window.text).toMatch(/an unstated start date to 2026-12-31/i);
  });
});
