import { describe, expect, it } from "vitest";

import { comingUpFromMyWork } from "@/lib/dashboard/coming-up";
import { loadWorkspaceDates, type WorkspaceDatesSupabaseLike } from "@/lib/dashboard/workspace-dates";
import { loadMyWork } from "@/lib/my-work/query";

import { createFakeSupabase, ME, ROSTER, WS_A, WS_B, type Db } from "./helpers/fake-my-work-tables";

/*
  DEADLINE WINDOWS (KI-2026-10-12-015).

  The dashboard reads dated work in two windows that meet at one boundary (the
  day before the server's date): the missed backlog before it, and the coming
  weeks from it. Three defects let a date fall out of both windows or into the
  wrong one:

    1. RTP and comment-period dates were read only from the boundary forward,
       so a date missed two or more days ago left the dashboard entirely.
    2. Contract tasks and work program reviews may or may not have a due date.
       Their descriptors said "undated", so the date bounds skipped them and
       the dated-only read left them out: a future contract deadline arrived in
       the backlog read instead of the coming weeks.
    3. (The digest half lives in work-notification-sweep.test.ts.)
*/

const NOW = new Date("2026-10-11T18:00:00Z");
const BOUNDARY = "2026-10-10";
const UNTIL = "2027-01-10";

function rtpCycle(id: string, column: string, value: string | null, status = "draft") {
  return {
    id,
    workspace_id: WS_A,
    title: `Cycle ${id}`,
    status,
    public_review_close_at: null,
    adoption_target_date: null,
    [column]: value,
  };
}

function workspaceDatesFixture() {
  const db: Db = {
    rtp_cycles: [
      rtpCycle("missed-adoption", "adoption_target_date", "2026-10-08"),
      rtpCycle("today-adoption", "adoption_target_date", "2026-10-11"),
      rtpCycle("future-review", "public_review_close_at", "2026-10-20T07:00:00Z", "public_review"),
      rtpCycle("yesterday-review", "public_review_close_at", "2026-10-10T07:00:00Z", "public_review"),
      // Adopted: the missed date is resolved, so it is not listed.
      rtpCycle("adopted", "adoption_target_date", "2026-10-01", "adopted"),
      // Beyond the one-year lookback.
      rtpCycle("ancient", "adoption_target_date", "2025-09-01"),
      { ...rtpCycle("other-workspace", "adoption_target_date", "2026-10-08"), workspace_id: WS_B },
    ],
    engagement_campaigns: [
      { id: "missed-comments", workspace_id: WS_A, title: "Corridor survey", status: "active", participation_ends_at: "2026-10-08T23:00:00Z" },
      { id: "closed-comments", workspace_id: WS_A, title: "Old survey", status: "closed", participation_ends_at: "2026-10-08T23:00:00Z" },
    ],
  };
  const fake = createFakeSupabase(db);
  const read = () =>
    loadWorkspaceDates(fake.client as unknown as WorkspaceDatesSupabaseLike, WS_A, BOUNDARY, UNTIL, NOW, "UTC");
  return { fake, read };
}

describe("dashboard workspace dates", () => {
  it("lists a date missed three days ago on a cycle or campaign that is still open", async () => {
    const { read } = workspaceDatesFixture();
    const result = await read();

    expect(result.missed.map((item) => item.key).sort()).toEqual([
      "comment-period:missed-comments",
      "rtp-adoption:missed-adoption",
    ]);
    expect(result.missed.find((item) => item.key === "rtp-adoption:missed-adoption")).toMatchObject({
      kind: "adoption",
      dueOn: "2026-10-08",
      overdue: true,
      href: "/rtp/missed-adoption",
    });
    expect(result.failed).toEqual([]);
    expect(result.capped).toEqual([]);
  });

  it("bounds the missed read to the year before the boundary, ending where the window ahead starts", async () => {
    const { fake, read } = workspaceDatesFixture();
    await read();

    const adoptionReads = fake.queries.filter(
      (query) => query.table === "rtp_cycles" && query.ops.some((op) => op.args[0] === "adoption_target_date")
    );
    expect(adoptionReads).toHaveLength(2);
    // The window ahead ends with an `lt` too (before the day after its last
    // day), so the missed read is the one that ends at the boundary.
    const missedRead = adoptionReads.find((query) =>
      query.ops.some((op) => op.verb === "lt" && op.args[1] === BOUNDARY)
    );
    expect(missedRead?.ops).toEqual(
      expect.arrayContaining([
        { verb: "eq", args: ["workspace_id", WS_A] },
        { verb: "in", args: ["status", ["draft", "public_review"]] },
        { verb: "gte", args: ["adoption_target_date", "2025-10-10"] },
        { verb: "lt", args: ["adoption_target_date", BOUNDARY] },
      ])
    );
    // The missed read is capped, so it takes the latest misses first; the
    // window ahead takes the soonest dates first.
    expect(missedRead?.ops).toContainEqual({ verb: "order", args: ["adoption_target_date", { ascending: false }] });
    const aheadRead = adoptionReads.find((query) => query !== missedRead);
    expect(aheadRead?.ops).toContainEqual({ verb: "order", args: ["adoption_target_date", { ascending: true }] });
  });

  it("keeps today's and future dates in the window ahead, not overdue, and lists each date once", async () => {
    const { read } = workspaceDatesFixture();
    const result = await read();

    expect(result.items.map((item) => item.key).sort()).toEqual([
      "rtp-adoption:today-adoption",
      "rtp-review:future-review",
      "rtp-review:yesterday-review",
    ]);
    expect(result.items.find((item) => item.key === "rtp-adoption:today-adoption")).toMatchObject({
      dueOn: "2026-10-11",
      overdue: false,
    });
    expect(result.items.find((item) => item.key === "rtp-review:future-review")?.overdue).toBe(false);
    const missedKeys = new Set(result.missed.map((item) => item.key));
    expect(result.items.some((item) => missedKeys.has(item.key))).toBe(false);
  });
});

/** Contract tasks and work program reviews, each future, past, today and undated. */
function mixedDb(): Db {
  const task = (id: string, deadline: string | null) => ({
    id,
    workspace_id: WS_A,
    engagement_id: "contract-a",
    project_id: "project-a",
    title: `Task ${id}`,
    assignee_user_id: ME,
    deadline,
  });
  const review = (id: string, due_on: string | null) => ({
    id,
    workspace_id: WS_A,
    program_id: "program-a",
    revision_id: "revision-a",
    assignee_user_id: ME,
    due_on,
    status: "pending",
  });
  return {
    programs: [{ id: "program-a", title: "FY27 OWP", workspace_id: WS_A }],
    contract_active_tasks_my_work: [
      task("task-future", "2026-11-20"),
      task("task-past", "2026-10-01"),
      task("task-today", "2026-10-11"),
      task("task-undated", null),
    ],
    program_work_program_reviews: [
      review("review-future", "2026-10-30"),
      review("review-past", "2026-10-02"),
      review("review-undated", null),
    ],
    land_use_plans: [{ id: "plan-a", title: "Local plan", workspace_id: WS_A }],
    land_use_plan_versions: [{ id: "version-a", plan_id: "plan-a" }],
    land_use_plan_implementation_actions: [
      { id: "action-undated", version_id: "version-a", title: "Adopt zoning update", due_on: null, status: "not_started", assignee_user_id: ME, responsible_party: "Planning" },
    ],
  };
}

// The dashboard's two My Work reads, exactly as page.tsx asks for them.
async function backlogRead() {
  const fake = createFakeSupabase(mixedDb());
  const result = await loadMyWork(fake.client, {
    workspaceId: WS_A, userId: ME, scope: "all_projects", roster: ROSTER, limitPerSource: 20, dueBefore: BOUNDARY, now: NOW, timeZone: "UTC",
  });
  return { fake, result };
}

async function upcomingRead() {
  const fake = createFakeSupabase(mixedDb());
  const result = await loadMyWork(fake.client, {
    workspaceId: WS_A, userId: ME, scope: "all_projects", roster: ROSTER, limitPerSource: 10,
    dueOnOrAfter: BOUNDARY, dueOnOrBefore: UNTIL, datedOnly: true, now: NOW, timeZone: "UTC",
  });
  return { fake, result };
}

const idsOf = (items: ReadonlyArray<{ id: string; sourceId: string }>, sourceId: string) =>
  items.filter((item) => item.sourceId === sourceId).map((item) => item.id).sort();

describe("My Work date windows for sources that may be undated", () => {
  it("reads a dated contract task or review in the window its date falls in, with its due date", async () => {
    const upcoming = (await upcomingRead()).result;
    expect(idsOf(upcoming.items, "contract_tasks")).toEqual(["task-future", "task-today"]);
    expect(idsOf(upcoming.items, "work_program_reviews")).toEqual(["review-future"]);
    expect(upcoming.items.find((item) => item.id === "task-future")).toMatchObject({
      block: "deadlines", dueOn: "2026-11-20", isOverdue: false,
    });
    expect(upcoming.items.find((item) => item.id === "task-today")).toMatchObject({ dueOn: "2026-10-11", isOverdue: false });

    const backlog = (await backlogRead()).result;
    expect(idsOf(backlog.items, "contract_tasks")).toEqual(["task-past", "task-undated"]);
    expect(idsOf(backlog.items, "work_program_reviews")).toEqual(["review-past", "review-undated"]);
    expect(backlog.items.find((item) => item.id === "task-past")).toMatchObject({ dueOn: "2026-10-01", isOverdue: true });
    expect(backlog.items.find((item) => item.id === "task-undated")).toMatchObject({ block: "undated", dueOn: null });
  });

  it("keeps an undated plan action in the backlog read instead of filtering it out by date", async () => {
    const backlog = (await backlogRead()).result;
    expect(idsOf(backlog.items, "land_use_plan_actions")).toEqual(["action-undated"]);
  });

  it("asks the database for the bounds, keeping undated rows only in the backlog read", async () => {
    const { fake: backlogFake } = await backlogRead();
    const backlogTasks = backlogFake.queries.find((query) => query.table === "contract_active_tasks_my_work");
    expect(backlogTasks?.ops).toContainEqual({ verb: "or", args: [`deadline.is.null,deadline.lt."${BOUNDARY}"`] });

    const { fake: upcomingFake } = await upcomingRead();
    const upcomingTasks = upcomingFake.queries.find((query) => query.table === "contract_active_tasks_my_work");
    expect(upcomingTasks?.ops).toEqual(
      expect.arrayContaining([
        { verb: "gte", args: ["deadline", BOUNDARY] },
        { verb: "lte", args: ["deadline", UNTIL] },
        { verb: "not", args: ["deadline", "is", null] },
        // Soonest first, so the read cap keeps the nearest deadlines.
        { verb: "order", args: ["deadline", { ascending: true }] },
      ])
    );
  });

  it("puts dated contract tasks and reviews on the dashboard's Coming up list", async () => {
    const upcoming = (await upcomingRead()).result;
    const coming = comingUpFromMyWork(upcoming.items, "UTC");
    expect(coming.find((item) => item.key === "contract_tasks:task-future")).toMatchObject({
      kind: "contract-task", dueOn: "2026-11-20", overdue: false,
    });
    expect(coming.find((item) => item.key === "work_program_reviews:review-future")).toMatchObject({
      kind: "work-program-review", dueOn: "2026-10-30",
    });
  });
});
