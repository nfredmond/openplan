import { describe, expect, it } from "vitest";

import { loadMyWork, MY_WORK_DEFAULT_LIMIT_PER_SOURCE, MY_WORK_MAX_LIMIT_PER_SOURCE } from "@/lib/my-work/query";
import { MY_WORK_SOURCES } from "@/lib/my-work/sources";
import { MY_WORK_SOURCE_IDS, groupMyWorkItemsByBlock } from "@/lib/my-work/types";
import {
  AWARD_MIRRORED,
  AWARD_PLAIN,
  DEPARTED,
  idsOf,
  loadSeededMyWork as load,
  ME,
  NOW,
  P1,
  P2,
  P_B,
  ROSTER,
  WS_A,
} from "./helpers/fake-my-work-tables";

/**
 * The personal work queue's reader, over a fake that MODELS POSTGREST'S JOIN
 * SEMANTICS rather than replaying fixtures (see
 * `helpers/fake-my-work-tables.ts` for why that distinction decides whether any
 * of this proves anything).
 *
 * MUTATION-VERIFIED (2026-08-11), each reverted after: dropping `!inner` from
 * the deliverables select (4 failures, incl. another workspace's deliverable
 * appearing on this planner's list), hardcoding the scope predicate to
 * "assigned" (4), dropping the departed clause from the unassigned filter (1),
 * disabling the award/milestone de-duplication (2), taking every HOLD row
 * instead of the latest decision per gate (1), and swallowing a read error
 * instead of collecting it (2).
 */

// ── The tests ───────────────────────────────────────────────────────────────

describe("my work — the union read", () => {
  it("defaults to what is assigned to the caller, overdue first then soonest", async () => {
    const { result } = await load();
    const blocks = groupMyWorkItemsByBlock(result.items);

    expect(idsOf(blocks.deadlines)).toEqual([
      "d-mine-overdue", // 2026-08-01, past NOW
      "s-mine", // 2026-08-12
      "m-mine", // 2026-08-15
      "d-mine-upcoming", // 2026-09-01
      "m-obligation", // 2026-09-10
    ]);
    expect(blocks.deadlines[0].isOverdue).toBe(true);
    expect(blocks.deadlines[0].badge.label).toBe("Deliverable overdue");
    expect(blocks.deadlines.slice(1).every((item) => item.isOverdue === false)).toBe(true);
    expect(result.scope).toBe("assigned");
  });

  it("never lists another workspace's records, even when they are assigned to the same person", async () => {
    // The `!inner` embed is the only thing scoping four of these tables. Every
    // decoy below belongs to workspace B and is assigned to THIS caller.
    const { result } = await load({ scope: "all_projects" });
    const ids = idsOf(result.items);

    for (const decoy of ["d-decoy", "m-decoy", "s-decoy", "i-decoy", "g-decoy", "f-decoy", "a-decoy", "inv-decoy"]) {
      expect(ids, `${decoy} leaked across workspaces`).not.toContain(decoy);
    }
    expect(result.items.every((item) => item.projectId !== P_B)).toBe(true);
  });

  it("keeps every join-scoped source's workspace filter behind an !inner embed", async () => {
    // A descriptor-level assertion to sit beside the behavioural one: the two
    // fail together on the same mutation, and this one names the file to fix.
    for (const source of MY_WORK_SOURCES) {
      if (!source.workspaceFilterColumn.includes(".")) continue;
      const embed = source.workspaceFilterColumn.split(".")[0];
      expect(source.select, `${source.id} filters through ${embed} without !inner`).toContain(
        `${embed}!inner(`
      );
    }
  });

  it("counts a departed member's work as unassigned, and says nothing was narrowed", async () => {
    const { result } = await load({ scope: "unassigned" });
    const blocks = groupMyWorkItemsByBlock(result.items);

    expect(idsOf(blocks.deadlines)).toEqual(["d-departed", "d-unassigned"]);
    expect(result.departedIncludedInUnassigned).toBe(true);
    // The record still carries the id; the surface is what renders the
    // departed sentence, and it can only do that if the id survives the read.
    expect(blocks.deadlines[0].assigneeUserId).toBe(DEPARTED);
    expect(blocks.deadlines[1].assigneeUserId).toBe(null);
  });

  it("narrows the unassigned scope honestly when the roster could not be read", async () => {
    const { result } = await load({ scope: "unassigned", roster: { ok: false } });

    // Strictly-null assignees only: without the roster there is no way to know
    // who has left, and guessing would either hide work or invent departures.
    expect(idsOf(result.items).filter((id) => id.startsWith("d-"))).toEqual(["d-unassigned"]);
    expect(result.departedIncludedInUnassigned).toBe(false);
  });

  it("shows everyone's dated work under the all-projects scope", async () => {
    const { result } = await load({ scope: "all_projects" });
    const blocks = groupMyWorkItemsByBlock(result.items);

    expect(idsOf(blocks.deadlines)).toContain("d-teammate");
    expect(idsOf(blocks.deadlines)).toContain("d-mine-overdue");
    expect(idsOf(blocks.deadlines)).toContain("d-departed");
    // Still only open work: a completed deliverable and an accepted submittal
    // are not somebody's outstanding item.
    expect(idsOf(blocks.deadlines)).not.toContain("d-complete");
    expect(idsOf(blocks.deadlines)).not.toContain("s-accepted");
  });

  it("keeps undated issues out of the deadline queue", async () => {
    const { result } = await load();
    const blocks = groupMyWorkItemsByBlock(result.items);

    expect(idsOf(blocks.undated)).toEqual(["i-mine"]);
    expect(blocks.undated[0].dueOn).toBeNull();
    expect(blocks.undated[0].isOverdue).toBe(false);
    expect(idsOf(blocks.deadlines)).not.toContain("i-mine");
    expect(idsOf(blocks.undated)).not.toContain("i-resolved");
  });

  it("blocks a project on its LATEST gate decision, not on any hold ever recorded", async () => {
    const { result } = await load();
    const blocks = groupMyWorkItemsByBlock(result.items);

    expect(idsOf(blocks.blocked_projects)).toEqual(["g-hold-p1"]);
    expect(blocks.blocked_projects[0].title).toBe("Corridor Rehabilitation");
    // P2's programming gate was held in July and passed in August.
    expect(blocks.blocked_projects.some((item) => item.projectId === P2)).toBe(false);
    // An unattributed decision is not evidence about any project.
    expect(idsOf(blocks.blocked_projects)).not.toContain("g-orphan");
  });

  it("the blocked-projects and workspace blocks do not move with the scope", async () => {
    const assigned = groupMyWorkItemsByBlock((await load()).result.items);
    const unassigned = groupMyWorkItemsByBlock((await load({ scope: "unassigned" })).result.items);

    expect(idsOf(unassigned.blocked_projects)).toEqual(idsOf(assigned.blocked_projects));
    expect(idsOf(unassigned.workspace_deadlines)).toContain("f-pending");
    expect(idsOf(unassigned.workspace_deadlines)).toContain("inv-open");
  });

  it("uses the shared funding predicates rather than a second definition of 'awaiting a decision'", async () => {
    const { result } = await load();
    const workspace = groupMyWorkItemsByBlock(result.items).workspace_deadlines;
    const decision = workspace.find((item) => item.sourceId === "grant_decisions");

    expect(decision?.id).toBe("f-pending");
    expect(decision?.isOverdue).toBe(true);
    expect(decision?.badge.label).toBe("Decision overdue");
    // decision_state 'pursue' is a decision already made; only 'monitor' on an
    // open/upcoming opportunity is awaiting one.
    expect(idsOf(workspace)).not.toContain("f-decided");
    // Nothing in this block claims an assignee — these tables have no such column.
    expect(workspace.every((item) => item.assigneeUserId === undefined)).toBe(true);
  });

  it("de-duplicates an award obligation against the milestone mirroring it", async () => {
    const assigned = groupMyWorkItemsByBlock((await load()).result.items);

    // The obligation milestone is on the caller's list, so the award row that
    // mirrors it is dropped — one deadline, once.
    expect(idsOf(assigned.deadlines)).toContain("m-obligation");
    expect(idsOf(assigned.workspace_deadlines)).not.toContain(AWARD_MIRRORED);
    expect(idsOf(assigned.workspace_deadlines)).toContain(AWARD_PLAIN);
    // A fully-spent award has met its obligation deadline.
    expect(idsOf(assigned.workspace_deadlines)).not.toContain("a-spent");

    // VARY THE BINDING: under the unassigned scope the mirroring milestone is
    // filtered out, so the workspace still has to show the obligation. A
    // de-duplication that dropped the award unconditionally passes the first
    // half of this test and fails here.
    const unassigned = groupMyWorkItemsByBlock((await load({ scope: "unassigned" })).result.items);
    expect(idsOf(unassigned.deadlines)).not.toContain("m-obligation");
    expect(idsOf(unassigned.workspace_deadlines)).toContain(AWARD_MIRRORED);
  });

  it("reports each source's own count after de-duplication", async () => {
    const { result } = await load();

    expect(result.perSource.deliverables).toEqual({ count: 2, pending: false, failed: false });
    expect(result.perSource.award_obligations?.count).toBe(1);
    expect(Object.keys(result.perSource).sort()).toEqual([...MY_WORK_SOURCE_IDS].sort());
  });

  it("uses the invoice lane's own overdue definition", async () => {
    const { result } = await load();
    const invoice = result.items.find((item) => item.sourceId === "invoice_windows");

    expect(invoice?.id).toBe("inv-open");
    expect(invoice?.isOverdue).toBe(true);
    expect(invoice?.href).toBe(`/projects/${P1}#project-invoice-inv-open`);
    // Settled invoices are not open work.
    expect(idsOf(result.items)).not.toContain("inv-paid");
  });

  it("renders the columns it asks the database for", async () => {
    const { result, selects } = await load();
    const blocks = groupMyWorkItemsByBlock(result.items);

    // The fake projects ONLY selected columns, so a column dropped from a
    // descriptor's select surfaces here as a placeholder rather than as
    // `undefined` in production.
    expect(blocks.deadlines[0].projectName).toBe("Corridor Rehabilitation");
    expect(blocks.deadlines[0].title).toBe("Existing conditions memo");
    expect(blocks.deadlines[0].href).toBe(`/projects/${P1}#project-deliverables`);
    expect(result.items.find((item) => item.id === "d-unassigned")).toBeUndefined();
    expect(selects.project_deliverables).toContain("owner_label");
    expect(selects.project_milestones).toContain("funding_award_id");
  });
});

describe("my work — a read that failed is not an empty queue", () => {
  it("discloses one source's failure without emptying the others", async () => {
    const { result } = await load({
      failures: { project_deliverables: "permission denied for table project_deliverables" },
    });

    expect(result.perSource.deliverables).toEqual({ count: 0, pending: false, failed: true });
    expect(result.reads.describe()).toContain("project deliverables");
    // The other sources are untouched.
    expect(idsOf(result.items)).toContain("m-mine");
    expect(idsOf(result.items)).toContain("i-mine");
  });

  it("calls a missing column a pending migration, not an outage", async () => {
    const { result } = await load({
      failures: {
        project_deliverables:
          "column project_deliverables.assignee_user_id does not exist",
      },
    });

    expect(result.perSource.deliverables).toEqual({ count: 0, pending: true, failed: false });
    // A pending migration has its own, truer sentence; it is not collected as
    // a generic read failure.
    expect(result.reads.describe()).toBeNull();
  });

  it("treats a thrown read as a failed read", async () => {
    const client = {
      from() {
        throw new Error("socket hang up");
      },
    };
    const result = await loadMyWork(client, {
      workspaceId: WS_A,
      userId: ME,
      roster: ROSTER,
      now: NOW,
    });

    expect(result.items).toEqual([]);
    expect(result.reads.any).toBe(true);
    expect(Object.values(result.perSource).every((outcome) => outcome.failed)).toBe(true);
  });
});

describe("my work — the per-source cap", () => {
  it("clamps the requested cap and applies it to every source", async () => {
    const { result, limits } = await load({ limitPerSource: 5 });

    expect(result.limitPerSource).toBe(5);
    expect(limits.project_deliverables).toBe(5);
    // The stage-gate source reads DEEPER on purpose: it needs the decision
    // history to find the latest decision per gate.
    expect(limits.stage_gate_decisions).toBeGreaterThan(5);
  });

  it("falls back to the default and never exceeds the maximum", async () => {
    expect((await load({ limitPerSource: 0 })).result.limitPerSource).toBe(
      MY_WORK_DEFAULT_LIMIT_PER_SOURCE
    );
    expect((await load({ limitPerSource: 10_000 })).result.limitPerSource).toBe(
      MY_WORK_MAX_LIMIT_PER_SOURCE
    );
  });
});
