import { describe, expect, it } from "vitest";

import { commentsReceivedOverTime, type EngagementCommentRow } from "@/lib/dashboard/chart-series";
import { comingUpFromMyWork } from "@/lib/dashboard/coming-up";
import { loadWorkspaceDates, type WorkspaceDatesSupabaseLike } from "@/lib/dashboard/workspace-dates";
import type { MyWorkItem } from "@/lib/my-work/types";

import { createFakeSupabase, WS_A, type Db } from "./helpers/fake-my-work-tables";

/**
 * THE DASHBOARD'S DAYS ARE THE WORKSPACE'S DAYS.
 *
 * Servers run in UTC. Cutting a TIMESTAMPTZ to its first ten characters, or
 * bucketing it by `getUTC*`, gives its UTC day: a comment period ending at
 * 8 p.m. Pacific on October 14 is stored as 03:00 UTC on the 15th, and the
 * dashboard said it ended on the 15th. Every case below runs in at least two
 * zones, because a fixture that passes in one zone can pass by accident. Each
 * includes a late Pacific evening that is the next UTC day, the end of
 * daylight time (November 1, 2026), and a zone far from UTC.
 *
 * BLIND CATEGORY: the fake compares bounds as strings, not as Postgres
 * instants. No fixture sits exactly on a bound, where the two could differ.
 */

const LA = "America/Los_Angeles";
const TOKYO = "Asia/Tokyo";
const HONOLULU = "Pacific/Honolulu";

// 8 p.m. Pacific daylight time, October 14.
const EVENING_PACIFIC_OCT_14 = "2026-10-15T03:00:00+00:00";
// 11:30 p.m. Pacific standard time, November 1: the night daylight time ends.
// A fixed daylight offset (UTC-7) would put it on November 2.
const LATE_PACIFIC_NOV_1 = "2026-11-02T07:30:00+00:00";

describe("Coming up from My Work, on the workspace's calendar", () => {
  function grant(dueOn: string): MyWorkItem {
    return {
      sourceId: "grant_decisions",
      block: "workspace_deadlines",
      id: "g1",
      title: "ATP decision",
      projectId: null,
      projectName: null,
      dueOn,
      isOverdue: false,
      ownerLabel: null,
      badge: { label: "Grant decision", tone: "neutral" },
      detail: null,
      href: "/grants",
      dedupKey: null,
    };
  }
  const dueOnIn = (value: string, zone: string) => comingUpFromMyWork([grant(value)], zone)[0]?.dueOn;

  it("puts a grant closing at 8 p.m. Pacific on the Pacific day, not the next UTC day", () => {
    expect(dueOnIn(EVENING_PACIFIC_OCT_14, LA)).toBe("2026-10-14");
    expect(dueOnIn(EVENING_PACIFIC_OCT_14, HONOLULU)).toBe("2026-10-14");
    expect(dueOnIn(EVENING_PACIFIC_OCT_14, TOKYO)).toBe("2026-10-15");
  });

  it("uses standard time after daylight time ends", () => {
    expect(dueOnIn(LATE_PACIFIC_NOV_1, LA)).toBe("2026-11-01");
    expect(dueOnIn(LATE_PACIFIC_NOV_1, TOKYO)).toBe("2026-11-02");
  });

  it("keeps a DATE as the day it already is, in any zone", () => {
    expect(dueOnIn("2026-10-14", TOKYO)).toBe("2026-10-14");
    expect(dueOnIn("2026-10-14", HONOLULU)).toBe("2026-10-14");
  });
});

describe("workspace dates on the workspace's calendar", () => {
  const NOW = new Date("2026-10-11T18:00:00Z");
  const BOUNDARY = "2026-10-10";
  const UNTIL = "2027-01-10";

  function fixture(): Db {
    const cycle = (id: string, column: string, value: string) => ({
      id,
      workspace_id: WS_A,
      title: `Cycle ${id}`,
      status: "public_review",
      public_review_close_at: null,
      adoption_target_date: null,
      [column]: value,
    });
    const campaign = (id: string, value: string) => ({
      id,
      workspace_id: WS_A,
      title: `Campaign ${id}`,
      status: "active",
      participation_ends_at: value,
    });
    return {
      rtp_cycles: [
        // 8 p.m. Pacific on January 10, the window's last day (04:00 UTC on the 11th).
        cycle("until-evening", "public_review_close_at", "2027-01-11T04:00:00+00:00"),
        cycle("dst-night", "public_review_close_at", LATE_PACIFIC_NOV_1),
        cycle("adoption", "adoption_target_date", "2026-10-14"),
      ],
      engagement_campaigns: [
        campaign("evening-14", EVENING_PACIFIC_OCT_14),
        // 10 p.m. Pacific on October 9: the day before the boundary there.
        campaign("before-boundary", "2026-10-10T05:00:00+00:00"),
      ],
    };
  }

  async function read(zone: string) {
    const fake = createFakeSupabase(fixture());
    const result = await loadWorkspaceDates(
      fake.client as unknown as WorkspaceDatesSupabaseLike,
      WS_A,
      BOUNDARY,
      UNTIL,
      NOW,
      zone
    );
    const due = (list: typeof result.items) => Object.fromEntries(list.map((item) => [item.key, item.dueOn]));
    return { fake, result, ahead: due(result.items), missed: due(result.missed) };
  }

  it("shows a comment period ending 8 p.m. Pacific on the Pacific day", async () => {
    expect((await read(LA)).ahead["comment-period:evening-14"]).toBe("2026-10-14");
    expect((await read(HONOLULU)).ahead["comment-period:evening-14"]).toBe("2026-10-14");
    expect((await read(TOKYO)).ahead["comment-period:evening-14"]).toBe("2026-10-15");
  });

  it("shows a review closing late on November 1 on the 1st, in standard time", async () => {
    expect((await read(LA)).ahead["rtp-review:dst-night"]).toBe("2026-11-01");
    expect((await read(TOKYO)).ahead["rtp-review:dst-night"]).toBe("2026-11-02");
  });

  it("splits missed from ahead at the workspace's midnight, not UTC's", async () => {
    const la = await read(LA);
    expect(la.missed["comment-period:before-boundary"]).toBe("2026-10-09");
    expect(la.ahead["comment-period:before-boundary"]).toBeUndefined();
    const tokyo = await read(TOKYO);
    expect(tokyo.ahead["comment-period:before-boundary"]).toBe("2026-10-10");
    expect(tokyo.missed["comment-period:before-boundary"]).toBeUndefined();
  });

  it("reads through the end of the last day in the workspace's zone", async () => {
    expect((await read(LA)).ahead["rtp-review:until-evening"]).toBe("2027-01-10");
    // Already January 11 in Tokyo: past the window.
    expect((await read(TOKYO)).ahead["rtp-review:until-evening"]).toBeUndefined();
  });

  it("bounds a TIMESTAMPTZ by the zone's midnights and a DATE by the day itself", async () => {
    const { fake } = await read(LA);
    const opsOf = (column: string, verb: "lt" | "gte") =>
      fake.queries
        .filter((query) => query.ops.some((op) => op.verb === "order" && op.args[0] === column))
        .flatMap((query) => query.ops.filter((op) => op.verb === verb && op.args[0] === column).map((op) => op.args[1]))
        .sort();
    expect(opsOf("participation_ends_at", "gte")).toEqual(["2025-10-10T07:00:00.000Z", "2026-10-10T07:00:00.000Z"]);
    // January 11 starts at 08:00 UTC in Pacific standard time.
    expect(opsOf("participation_ends_at", "lt")).toEqual(["2026-10-10T07:00:00.000Z", "2027-01-11T08:00:00.000Z"]);
    expect(opsOf("adoption_target_date", "gte")).toEqual(["2025-10-10", BOUNDARY]);
    expect(opsOf("adoption_target_date", "lt")).toEqual([BOUNDARY, "2027-01-11"]);
    expect((await read(LA)).ahead["rtp-adoption:adoption"]).toBe("2026-10-14");
    expect((await read(TOKYO)).ahead["rtp-adoption:adoption"]).toBe("2026-10-14");
  });
});

describe("comments over time, in the workspace's weeks", () => {
  const read = (rows: EngagementCommentRow[]) => ({ rows, failed: false, pending: false, truncated: false });
  const weekDetail = (rows: EngagementCommentRow[], now: Date, zone: string, label: string) =>
    commentsReceivedOverTime(read(rows), now, zone).points.find((point) => point.label === label)?.detail;

  // Wednesday, October 14, 2026, midday Pacific.
  const WEDNESDAY = new Date("2026-10-14T19:00:00Z");
  const steady = ["2026-09-22T18:00:00Z", "2026-09-29T18:00:00Z", "2026-10-06T18:00:00Z"].map((created_at) => ({
    created_at,
  }));

  it("counts a Sunday-evening Pacific comment in that week, not the next", () => {
    // 10 p.m. Pacific on Sunday, October 11; Monday the 12th in UTC.
    const rows = [...steady, { created_at: "2026-10-12T05:00:00+00:00" }];
    expect(weekDetail(rows, WEDNESDAY, LA, "Oct 5")).toMatch(/^Week of Oct 5: 2 new comments/);
    expect(weekDetail(rows, WEDNESDAY, LA, "Oct 12")).toMatch(/^Week of Oct 12: 0 new comments/);
    expect(weekDetail(rows, WEDNESDAY, "UTC", "Oct 5")).toMatch(/^Week of Oct 5: 1 new comment /);
    expect(weekDetail(rows, WEDNESDAY, "UTC", "Oct 12")).toMatch(/^Week of Oct 12: 1 new comment /);
  });

  it("counts a Monday-morning Tokyo comment in the Tokyo week it starts", () => {
    // 1 a.m. Monday, October 12 in Tokyo; still Sunday in UTC.
    const rows = [...steady, { created_at: "2026-10-11T16:00:00+00:00" }];
    expect(weekDetail(rows, WEDNESDAY, TOKYO, "Oct 12")).toMatch(/^Week of Oct 12: 1 new comment /);
    expect(weekDetail(rows, WEDNESDAY, "UTC", "Oct 12")).toMatch(/^Week of Oct 12: 0 new comments/);
  });

  it("counts a late Sunday comment in Honolulu in that week", () => {
    // 11:30 p.m. Sunday, October 11 in Honolulu.
    const rows = [...steady, { created_at: "2026-10-12T09:30:00+00:00" }];
    expect(weekDetail(rows, WEDNESDAY, HONOLULU, "Oct 5")).toMatch(/^Week of Oct 5: 2 new comments/);
  });

  it("uses standard time after daylight time ends: 11:30 p.m. Sunday, November 1 is that week", () => {
    const rows = ["2026-10-13T18:00:00Z", "2026-10-20T18:00:00Z", LATE_PACIFIC_NOV_1].map((created_at) => ({
      created_at,
    }));
    const now = new Date("2026-11-04T20:00:00Z");
    expect(weekDetail(rows, now, LA, "Oct 26")).toMatch(/^Week of Oct 26: 1 new comment /);
    expect(weekDetail(rows, now, LA, "Nov 2")).toMatch(/^Week of Nov 2: 0 new comments/);
  });

  it("starts the window from today on the workspace's calendar", () => {
    // 10 p.m. Pacific on Sunday, October 11: still last week there, already
    // Monday in UTC. The newest week drawn is the workspace's current week.
    const sundayNight = new Date("2026-10-12T05:00:00Z");
    const labels = (zone: string) =>
      commentsReceivedOverTime(read(steady), sundayNight, zone).points.map((point) => point.label);
    expect(labels(LA).at(-1)).toBe("Oct 5");
    expect(labels(LA)[0]).toBe("Jul 20");
    expect(labels("UTC").at(-1)).toBe("Oct 12");
  });
});
