import { describe, expect, it } from "vitest";
import { loadMyWork } from "@/lib/my-work/query";
import { createFakeSupabase, ME, TEAMMATE, NOW, ROSTER, WS_A, WS_B, type Db } from "./helpers/fake-my-work-tables";

function fixture() {
  const action = { id: "undated", version_id: "version-a", title: "Review implementation", due_on: null, status: "not_started", assignee_user_id: ME, responsible_party: "Planning" };
  const db: Db = {
    land_use_plans: [{ id: "plan-a", title: "Local plan", workspace_id: WS_A }, { id: "plan-b", title: "Other workspace", workspace_id: WS_B }],
    land_use_plan_versions: [{ id: "version-a", plan_id: "plan-a" }, { id: "version-b", plan_id: "plan-b" }],
    land_use_plan_implementation_actions: [action,
      { ...action, id: "dated", due_on: "2026-08-01" },
      { ...action, id: "completed", status: "completed" },
      { ...action, id: "deferred", status: "deferred" },
      { ...action, id: "someone-else", assignee_user_id: TEAMMATE },
      { ...action, id: "cross-workspace", version_id: "version-b" },
    ],
  };
  const { client } = createFakeSupabase(db);
  return { db, action, read: (userId = ME) => loadMyWork(client, { workspaceId: WS_A, userId, now: NOW, roster: ROSTER }) };
}

describe("plan implementation handoff to My Work", () => {
  it("keeps undated assignments undated and excludes closed, other-assignee and other-workspace actions", async () => {
    const result = await fixture().read();
    expect(result.reads.describe()).toBeNull();
    expect(result.items.map((item) => item.id).sort()).toEqual(["dated", "undated"]);
    expect(result.items.find((item) => item.id === "undated")).toMatchObject({
      title: "Review implementation", projectName: "Local plan", href: "/land-use-plans/plan-a",
      assigneeUserId: ME, dueOn: null, isOverdue: false, block: "undated",
      badge: { label: "Plan action", tone: "neutral" }, detail: "Not started · No due date",
    });
    expect(result.items.find((item) => item.id === "dated")).toMatchObject({ block: "deadlines", dueOn: "2026-08-01", isOverdue: true });
  });

  it("moves an undated assignment to its new assignee and removes it when completed", async () => {
    const f = fixture();
    f.action.assignee_user_id = TEAMMATE;
    expect((await f.read()).items.map((item) => item.id)).not.toContain("undated");
    expect((await f.read(TEAMMATE)).items.map((item) => item.id)).toContain("undated");
    f.action.status = "completed";
    expect((await f.read(TEAMMATE)).items.map((item) => item.id)).not.toContain("undated");
    expect(f.action.due_on).toBeNull();
  });
});
