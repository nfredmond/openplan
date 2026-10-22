import { describe, expect, it } from "vitest";

import { COMING_UP_KIND_LABELS, comingUpFromMyWork } from "@/lib/dashboard/coming-up";
import { loadMyWork } from "@/lib/my-work/query";
import { MY_WORK_SOURCES } from "@/lib/my-work/sources";
import type { MyWorkItem } from "@/lib/my-work/types";
import {
  buildDb,
  createFakeSupabase,
  idsOf,
  loadSeededMyWork as load,
  ME,
  NOW,
  P1,
  P_B,
  ROSTER,
  WS_A,
  WS_B,
  type Db,
} from "./helpers/fake-my-work-tables";

/**
 * A pursued grant's close date in My Work and the dashboard's Coming up.
 *
 * NOW is 2026-08-11T12:00Z. Each row below is one case the source must get
 * right: a future close, a close later today, a missed close, and three ways a
 * pursuit ends (submitted, dropped, archived) that must never read as overdue.
 *
 * Blind category: the fake models PostgREST filters, not Postgres types, so a
 * closes_at stored in a shape other than an ISO timestamp is not exercised.
 */

function opportunity(id: string, overrides: Record<string, unknown>) {
  return {
    id,
    workspace_id: WS_A,
    project_id: P1,
    title: `Opportunity ${id}`,
    opportunity_status: "open",
    decision_state: "pursue",
    closes_at: null,
    decision_due_at: null,
    agency_name: "California Transportation Commission",
    ...overrides,
  };
}

function seededDb(): Db {
  const db = buildDb();
  db.funding_opportunities = [
    opportunity("f-future", { closes_at: "2026-09-15T23:59:00+00:00" }),
    opportunity("f-today", { closes_at: "2026-08-11T23:00:00+00:00" }),
    opportunity("f-missed", { closes_at: "2026-08-05T23:59:00+00:00", opportunity_status: "closed" }),
    opportunity("f-submitted", { closes_at: "2026-08-05T23:59:00+00:00", decision_state: "under_review", opportunity_status: "closed" }),
    opportunity("f-abandoned", { closes_at: "2026-08-05T23:59:00+00:00", decision_state: "skip", opportunity_status: "closed" }),
    opportunity("f-archived", { closes_at: "2026-08-05T23:59:00+00:00", opportunity_status: "archived" }),
    opportunity("f-awarded", { closes_at: "2026-08-05T23:59:00+00:00", opportunity_status: "awarded" }),
    opportunity("f-undated", { closes_at: null }),
    opportunity("f-other-workspace", { workspace_id: WS_B, project_id: P_B, closes_at: "2026-08-20T23:59:00+00:00" }),
  ];
  return db;
}

function dueItems(items: MyWorkItem[]): MyWorkItem[] {
  return items.filter((item) => item.sourceId === "grant_application_due");
}

describe("my work, application due dates on pursued opportunities", () => {
  it("lists a missed close first, then today's and later closes, and nothing that ended", async () => {
    const { result } = await load({ db: seededDb() });
    const items = dueItems(result.items);

    expect(idsOf(items)).toEqual(["f-missed", "f-today", "f-future"]);
    expect(result.perSource.grant_application_due).toEqual({ count: 3, pending: false, failed: false });
  });

  it("calls only the missed close overdue, and says what to record", async () => {
    const items = dueItems((await load({ db: seededDb() })).result.items);
    const byId = new Map(items.map((item) => [item.id, item]));

    expect(byId.get("f-missed")?.isOverdue).toBe(true);
    expect(byId.get("f-missed")?.badge).toEqual({ label: "Application overdue", tone: "danger" });
    expect(byId.get("f-missed")?.detail).toBe(
      "Call closed Aug 5, 2026. Set the decision to Under review if it went in, or Skip."
    );

    expect(byId.get("f-today")?.isOverdue).toBe(false);
    expect(byId.get("f-today")?.badge).toEqual({ label: "Application due", tone: "info" });
    expect(byId.get("f-future")?.isOverdue).toBe(false);
    expect(byId.get("f-future")?.detail).toBe("California Transportation Commission · closes Sep 15, 2026");
  });

  it("never counts a submitted, dropped, archived or awarded pursuit, whatever its close date", async () => {
    const ids = idsOf((await load({ db: seededDb() })).result.items);

    for (const ended of ["f-submitted", "f-abandoned", "f-archived", "f-awarded"]) {
      expect(ids, `${ended} is still on the list`).not.toContain(ended);
    }
    expect(ids).not.toContain("f-undated");
    expect(ids).not.toContain("f-other-workspace");
  });

  it("reads the columns it renders and links to the opportunity on the Grants page", async () => {
    const source = MY_WORK_SOURCES.find((entry) => entry.id === "grant_application_due");
    expect(source?.select).toBe(
      "id, project_id, title, opportunity_status, decision_state, closes_at, agency_name, projects(id, name)"
    );
    const item = dueItems((await load({ db: seededDb() })).result.items).find((entry) => entry.id === "f-future");

    // The fake returns only selected columns, so a dropped column shows up here.
    expect(item?.dueOn).toBe("2026-09-15T23:59:00+00:00");
    expect(item?.projectName).toBe("Corridor Rehabilitation");
    expect(item?.href).toBe("/grants?focusOpportunityId=f-future#funding-opportunity-f-future");
    // funding_opportunities has no assignee column, so no item claims one.
    expect(item && "assigneeUserId" in item).toBe(false);
  });

  it("splits between the dashboard's backlog read and its upcoming read on the close date", async () => {
    const read = async (bounds: { dueBefore?: string; dueOnOrAfter?: string; datedOnly?: boolean }) => {
      const { client } = createFakeSupabase(seededDb());
      const result = await loadMyWork(client, { workspaceId: WS_A, userId: ME, roster: ROSTER, now: NOW, timeZone: "UTC", ...bounds });
      return idsOf(dueItems(result.items));
    };

    expect(await read({ dueBefore: "2026-08-11" })).toEqual(["f-missed"]);
    expect(await read({ dueOnOrAfter: "2026-08-11", datedOnly: true })).toEqual(["f-today", "f-future"]);
  });

  it("appears in Coming up as an application due date", async () => {
    const coming = comingUpFromMyWork(dueItems((await load({ db: seededDb() })).result.items), "UTC");

    expect(coming.map((entry) => [entry.key, entry.kind, entry.dueOn, entry.overdue])).toEqual([
      ["grant_application_due:f-missed", "application-due", "2026-08-05", true],
      ["grant_application_due:f-today", "application-due", "2026-08-11", false],
      ["grant_application_due:f-future", "application-due", "2026-09-15", false],
    ]);
    expect(COMING_UP_KIND_LABELS["application-due"]).toBe("Application due");
  });
});
