import React from "react";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { MyWorkBoard } from "@/components/my-work/my-work-board";
import { loadMyWork, type LoadMyWorkOptions } from "@/lib/my-work/query";
import type { MyWorkItem } from "@/lib/my-work/types";
import { formatWorkDeadlineDate } from "@/lib/work/deadlines";

import { buildDb, createFakeSupabase, ME, P1, ROSTER, WS_A, type Db } from "./helpers/fake-my-work-tables";

/*
  MY WORK DATES ON THE WORKSPACE CALENDAR.

  Grant decisions, application close times and award obligations are
  TIMESTAMPTZ. My Work showed them on their UTC day and ended its date windows
  at 23:59:59 UTC, so an obligation due at 11 p.m. Pacific on October 20 read
  as October 21 and fell outside a window ending on the 20th. Overdue already
  compared instants (`isDeadlinePast`), and the dashboard and reminder digest
  already used the workspace calendar. Now the queue does too.

  BLIND CATEGORY: these run against the fake's string comparison, not
  Postgres. The bounds are asserted as literals so the database's comparison
  is not assumed; fixtures avoid instants equal to a bound, where the fake's
  string order and Postgres's instant order could differ.
*/

const LA = "America/Los_Angeles";
const TOKYO = "Asia/Tokyo";
const NOW = new Date("2026-10-11T18:00:00Z");

// 11 p.m. Pacific (daylight time) on October 20: October 21 in UTC and Tokyo.
const PACIFIC_EVENING = "2026-10-21T06:00:00+00:00";
// 1 a.m. October 21 in Tokyo: still October 20 in UTC and Pacific.
const TOKYO_MORNING = "2026-10-20T16:00:00+00:00";
// 11:30 p.m. Pacific on November 1, after daylight time ends (UTC-8): November 2 in UTC.
const DST_NIGHT = "2026-11-02T07:30:00+00:00";
// 10 p.m. Pacific on October 9: October 10 in UTC.
const BOUNDARY_EVENING = "2026-10-10T05:00:00+00:00";

function award(id: string, obligationDueAt: string) {
  return {
    id,
    workspace_id: WS_A,
    project_id: P1,
    title: `Award ${id}`,
    obligation_due_at: obligationDueAt,
    spending_status: "active",
    risk_flag: "none",
  };
}

function calendarDb(): Db {
  const db = buildDb();
  return {
    projects: db.projects,
    funding_awards: [
      award("a-pacific-evening", PACIFIC_EVENING),
      award("a-tokyo-morning", TOKYO_MORNING),
      award("a-dst-night", DST_NIGHT),
      award("a-boundary-evening", BOUNDARY_EVENING),
    ],
    funding_opportunities: [
      {
        id: "f-pacific-evening",
        workspace_id: WS_A,
        project_id: P1,
        title: "Pursued call",
        opportunity_status: "open",
        decision_state: "pursue",
        closes_at: PACIFIC_EVENING,
        decision_due_at: null,
        agency_name: null,
      },
    ],
    project_deliverables: [
      {
        id: "d-date-only",
        project_id: P1,
        title: "Memo",
        summary: null,
        status: "in_progress",
        due_date: "2026-10-20",
        owner_label: null,
        assignee_user_id: ME,
      },
    ],
  };
}

async function read(timeZone: string, bounds: Partial<LoadMyWorkOptions> = {}) {
  const fake = createFakeSupabase(calendarDb());
  const result = await loadMyWork(fake.client, {
    workspaceId: WS_A,
    userId: ME,
    scope: "all_projects",
    roster: ROSTER,
    now: NOW,
    timeZone,
    ...bounds,
  });
  return { fake, result };
}

const item = (items: MyWorkItem[], id: string) => items.find((entry) => entry.id === id);
const ids = (items: MyWorkItem[], sourceId: string) =>
  items.filter((entry) => entry.sourceId === sourceId).map((entry) => entry.id).sort();

describe("formatWorkDeadlineDate on a workspace calendar", () => {
  it("shows an instant on the zone's day", () => {
    expect(formatWorkDeadlineDate(PACIFIC_EVENING, LA)).toBe("Oct 20, 2026");
    expect(formatWorkDeadlineDate(PACIFIC_EVENING, TOKYO)).toBe("Oct 21, 2026");
    expect(formatWorkDeadlineDate(TOKYO_MORNING, TOKYO)).toBe("Oct 21, 2026");
    expect(formatWorkDeadlineDate(TOKYO_MORNING, LA)).toBe("Oct 20, 2026");
  });

  it("uses standard time after daylight time ends", () => {
    expect(formatWorkDeadlineDate(DST_NIGHT, LA)).toBe("Nov 1, 2026");
    expect(formatWorkDeadlineDate(DST_NIGHT, TOKYO)).toBe("Nov 2, 2026");
  });

  it("never moves a date-only value", () => {
    for (const zone of [LA, TOKYO, "Pacific/Kiritimati", "Pacific/Pago_Pago", "UTC"]) {
      expect(formatWorkDeadlineDate("2026-10-20", zone)).toBe("Oct 20, 2026");
    }
  });

  it("answers UTC with no zone or a zone Intl rejects", () => {
    expect(formatWorkDeadlineDate(PACIFIC_EVENING)).toBe("Oct 21, 2026");
    expect(formatWorkDeadlineDate(PACIFIC_EVENING, "Not/A_Zone")).toBe("Oct 21, 2026");
  });
});

describe("My Work dates on the workspace calendar", () => {
  it("writes TIMESTAMPTZ deadlines on the workspace's day", async () => {
    const la = (await read(LA)).result.items;
    expect(item(la, "a-pacific-evening")?.detail).toContain("Funds must be obligated by Oct 20, 2026");
    expect(item(la, "a-dst-night")?.detail).toContain("Funds must be obligated by Nov 1, 2026");
    expect(item(la, "f-pacific-evening")?.detail).toContain("closes Oct 20, 2026");
    expect(item(la, "d-date-only")?.detail).toContain("due Oct 20, 2026");

    const tokyo = (await read(TOKYO)).result.items;
    expect(item(tokyo, "a-pacific-evening")?.detail).toContain("Funds must be obligated by Oct 21, 2026");
    expect(item(tokyo, "a-tokyo-morning")?.detail).toContain("Funds must be obligated by Oct 21, 2026");
    expect(item(tokyo, "d-date-only")?.detail).toContain("due Oct 20, 2026");
  });

  it("keeps an evening Pacific deadline inside a window ending that day", async () => {
    const window = { dueOnOrAfter: "2026-10-10", dueOnOrBefore: "2026-10-20", datedOnly: true };
    expect(ids((await read(LA, window)).result.items, "award_obligations")).toEqual([
      "a-pacific-evening",
      "a-tokyo-morning",
    ]);
    expect(ids((await read("UTC", window)).result.items, "award_obligations")).toEqual(["a-boundary-evening", "a-tokyo-morning"]);
    // Both are October 21 in Tokyo.
    expect(ids((await read(TOKYO, window)).result.items, "award_obligations")).toEqual(["a-boundary-evening"]);
    expect(ids((await read(LA, window)).result.items, "grant_application_due")).toEqual(["f-pacific-evening"]);
  });

  it("splits the backlog from the coming weeks at the workspace's midnight", async () => {
    expect(ids((await read(LA, { dueBefore: "2026-10-10" })).result.items, "award_obligations")).toEqual([
      "a-boundary-evening",
    ]);
    expect(ids((await read("UTC", { dueBefore: "2026-10-10" })).result.items, "award_obligations")).toEqual([]);
  });

  it("ends a window in standard time on the night daylight time ends", async () => {
    const window = { dueOnOrAfter: "2026-10-25", dueOnOrBefore: "2026-11-01", datedOnly: true };
    expect(ids((await read(LA, window)).result.items, "award_obligations")).toEqual(["a-dst-night"]);
    expect(ids((await read("UTC", window)).result.items, "award_obligations")).toEqual([]);
  });

  it("bounds a TIMESTAMPTZ by the zone's midnights and a DATE by the day itself", async () => {
    const opsOf = (fake: Awaited<ReturnType<typeof read>>["fake"], table: string) =>
      fake.queries.find((query) => query.table === table)?.ops.filter((op) => ["lt", "gte", "lte"].includes(op.verb));

    const la = (await read(LA, { dueOnOrAfter: "2026-10-10", dueOnOrBefore: "2026-11-01", datedOnly: true })).fake;
    expect(opsOf(la, "legacy_calendar_funding_awards")).toEqual([
      { verb: "gte", args: ["obligation_due_at", "2026-10-10T07:00:00.000Z"] },
      // November 2 starts at 08:00 UTC in Pacific standard time.
      { verb: "lt", args: ["obligation_due_at", "2026-11-02T08:00:00.000Z"] },
    ]);
    expect(opsOf(la, "project_deliverables")).toEqual([
      { verb: "gte", args: ["due_date", "2026-10-10"] },
      { verb: "lte", args: ["due_date", "2026-11-01"] },
    ]);

    const tokyo = (await read(TOKYO, { dueBefore: "2026-10-10" })).fake;
    expect(opsOf(tokyo, "legacy_calendar_funding_awards")).toEqual([
      { verb: "lt", args: ["obligation_due_at", "2026-10-09T15:00:00.000Z"] },
    ]);
  });
});

describe("the My Work board on the workspace calendar", () => {
  it("stamps a TIMESTAMPTZ deadline with the workspace's day", async () => {
    const { result } = await read(LA);
    render(
      <MyWorkBoard
        scope={result.scope}
        items={result.items}
        perSource={result.perSource}
        limitPerSource={result.limitPerSource}
        readFailureSummary={result.reads.describe()}
        roster={ROSTER}
        departedIncludedInUnassigned={result.departedIncludedInUnassigned}
        isViewer={false}
        timeZone={LA}
      />
    );
    const row = screen.getByRole("link", { name: "Award a-pacific-evening" }).closest(".module-record-row") as HTMLElement;
    expect(within(row).getByText("Oct 20, 2026", { selector: ".module-record-stamp" })).toBeTruthy();
    const dstRow = screen.getByRole("link", { name: "Award a-dst-night" }).closest(".module-record-row") as HTMLElement;
    expect(within(dstRow).getByText("Nov 1, 2026", { selector: ".module-record-stamp" })).toBeTruthy();
  });
});
