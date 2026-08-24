/**
 * MY WORK — one queue of everything a planner is on the hook for, read live
 * from each owning module's own table.
 *
 * Like the Document Library (`src/lib/document-library/`), this is an INDEX and
 * not a warehouse: no mirror table, no write-time hook, no second copy of
 * anyone's dates. Each source is read with the CALLER'S RLS client, each
 * source's own row-level security does the tenant scoping, and a read that fails
 * is disclosed per source rather than rendered as an empty to-do list.
 *
 * FOUR BLOCKS, AND WHY THEY ARE NOT ONE LIST.
 *
 * 1. `deadlines` — dated project records with an assignee lane: deliverables,
 *    milestones, submittals. Overdue first, then soonest.
 * 2. `undated` — assigned project issues. `project_issues` has NO date column
 *    (20260313000013), and an undated row sorted into a deadline queue either
 *    reads as due today or as the most overdue thing on the page. It gets its
 *    own block instead, and it is the reason this module has blocks at all.
 * 3. `blocked_projects` — stage gates whose latest recorded decision is HOLD.
 *    A hold is a fact about a PROJECT, not an item on one person's list
 *    (`stage_gate_decisions` has no assignee and never will), so it is rendered
 *    as its own block for the whole workspace rather than mixed into anyone's
 *    queue. Nathaniel's decision, 2026-08-11.
 * 4. `needs_review` — work in ANOTHER module that has stopped and is waiting
 *    for a person here: public comments awaiting moderation, model runs that
 *    failed, AI-drafted narrative awaiting an operator's accept or dismiss.
 *    None of these tables carries an assignee and none should: whoever gets to
 *    it first moderates the comment, and a run that crashed is the workspace's
 *    problem rather than one person's. This is the block that makes My Work an
 *    app-wide inbox instead of a project-and-money queue — before it, the only
 *    way to learn that a run had failed or that residents were waiting was to
 *    open the module and look.
 * 5. `workspace_deadlines` — grant decisions, award obligations and invoice
 *    windows. These tables carry no assignee column, so NOTHING here is ever
 *    presented as assigned to anyone: inventing an owner for a grant deadline
 *    would put a name on an obligation nobody accepted.
 *
 * THE SCOPES ARE A FILTER ON PEOPLE, NEVER ON THE WORKSPACE BLOCKS. Switching
 * to "Unassigned" changes which project records appear; the workspace deadlines
 * and the blocked-projects block are unaffected, because neither was ever a
 * statement about who is assigned.
 */

import type { ReadFailureLog } from "@/lib/ui/read-failures";
import type { StatusTone } from "@/lib/ui/status";

/**
 * The sources, in the order the page presents them. The numbering follows the
 * design memo (2026-08-11): 1–4 person-scoped, 5 the blocked-projects block,
 * 6–8 the cross-module review queue (added 2026-08-21), 9–11 workspace-scoped.
 */
export const MY_WORK_SOURCE_IDS = [
  "deliverables",
  "milestones",
  "submittals",
  "issues",
  "stage_gate_holds",
  "engagement_moderation",
  "failed_model_runs",
  "narrative_drafts",
  "land_use_plan_actions",
  "land_use_plan_process",
  "land_use_plan_review_closing",
  "grant_decisions",
  "award_obligations",
  "invoice_windows",
] as const;

export type MyWorkSourceId = (typeof MY_WORK_SOURCE_IDS)[number];

export const MY_WORK_BLOCK_IDS = [
  "deadlines",
  "undated",
  "blocked_projects",
  "needs_review",
  "workspace_deadlines",
] as const;

export type MyWorkBlockId = (typeof MY_WORK_BLOCK_IDS)[number];

/**
 * Who the queue is filtered to.
 *
 * `assigned` is the default (Nathaniel's decision, 2026-08-11) — the page opens
 * on what is on YOUR list, not on everything in the workspace.
 *
 * `unassigned` means work nobody currently holds, which deliberately INCLUDES
 * records assigned to someone who has left the workspace: a departed member's
 * assignment is nobody's to-do list, and it is the single most droppable piece
 * of work in an agency (`assigneeCountsAsUnassigned`, migration 20260811000006).
 *
 * `all_projects` is every project in this workspace. Workspace membership is
 * the only project-level membership OpenPlan has — there is no `project_members`
 * table — so "all my projects" and "every project here" are the same set, and
 * the page says so rather than implying a narrower personal list.
 */
export const MY_WORK_SCOPES = ["assigned", "unassigned", "all_projects"] as const;

export type MyWorkScope = (typeof MY_WORK_SCOPES)[number];

export const DEFAULT_MY_WORK_SCOPE: MyWorkScope = "assigned";

/** The label, and the sentence under it, for each scope. Planner voice. */
export const MY_WORK_SCOPE_LABELS: Record<MyWorkScope, string> = {
  assigned: "Assigned to me",
  unassigned: "Unassigned",
  all_projects: "All my projects",
};

export const MY_WORK_SCOPE_DESCRIPTIONS: Record<MyWorkScope, string> = {
  assigned: "Project records with your name on them.",
  unassigned: "Dated work nobody currently holds — including anything left behind by a departed member.",
  all_projects: "Every project in this workspace, whoever is assigned.",
};

/** `?scope=` is user input; anything unrecognised falls back to the default. */
export function normalizeMyWorkScope(value: string | string[] | null | undefined): MyWorkScope {
  const raw = Array.isArray(value) ? value[0] : value;
  return (MY_WORK_SCOPES as readonly string[]).includes(raw ?? "")
    ? (raw as MyWorkScope)
    : DEFAULT_MY_WORK_SCOPE;
}

export type MyWorkBadge = {
  label: string;
  tone: StatusTone;
};

/** One thing in the queue. */
export type MyWorkItem = {
  sourceId: MyWorkSourceId;
  block: MyWorkBlockId;
  /** The row's id in ITS OWN table — unique within a source, not across sources. */
  id: string;
  title: string;
  /** Null only where the owning row genuinely has no project (a workspace-level grant or invoice). */
  projectId: string | null;
  projectName: string | null;
  /** The date this is due, as the owning table records it. Null in the undated and blocked blocks. */
  dueOn: string | null;
  isOverdue: boolean;
  /**
   * The assignee id as read, for the three person-scoped dated sources and
   * issues. ABSENT (undefined) on every workspace-scoped source — those tables
   * have no assignee column, and `undefined` is what stops a surface from
   * rendering "unassigned" as though somebody had checked.
   */
  assigneeUserId?: string | null;
  /** The free-text owner lane, which is a different fact from the assignee and renders beside it. */
  ownerLabel: string | null;
  badge: MyWorkBadge;
  detail: string | null;
  /** Where the planner goes to act on it — always an in-app route, deep-linked to the record where one exists. */
  href: string;
  /**
   * Set when two sources can describe the SAME obligation — an award's
   * `obligation_due_at` and the obligation milestone mirroring it
   * (20260416000053). Items sharing a key are de-duplicated in favour of the
   * project record, which is the one a person can be assigned.
   */
  dedupKey: string | null;
};

/** What one source's read established — the Document Library's outcome shape. */
export type MyWorkSourceOutcome = {
  count: number;
  /** The deployment is behind a migration; a named operator move, not an outage. */
  pending: boolean;
  failed: boolean;
};

export type MyWorkResult = {
  scope: MyWorkScope;
  /** Every item, in block order, each block already sorted. */
  items: MyWorkItem[];
  reads: ReadFailureLog;
  perSource: Partial<Record<MyWorkSourceId, MyWorkSourceOutcome>>;
  limitPerSource: number;
  /**
   * FALSE when the unassigned scope could not include work left behind by
   * departed members — because the roster could not be read, or because the
   * team is larger than the id list that filter can carry. The page discloses
   * it; it never silently narrows what "unassigned" means.
   */
  departedIncludedInUnassigned: boolean;
};

export function groupMyWorkItemsByBlock(
  items: readonly MyWorkItem[]
): Record<MyWorkBlockId, MyWorkItem[]> {
  const grouped = {
    deadlines: [] as MyWorkItem[],
    undated: [] as MyWorkItem[],
    blocked_projects: [] as MyWorkItem[],
    needs_review: [] as MyWorkItem[],
    workspace_deadlines: [] as MyWorkItem[],
  } satisfies Record<MyWorkBlockId, MyWorkItem[]>;

  for (const item of items) grouped[item.block].push(item);
  return grouped;
}

/**
 * The ordering caveat, worded once so every surface says the same true thing:
 * this is a per-source cap, not a complete inventory.
 */
export function describeMyWorkOrdering(limitPerSource: number): string {
  return `Showing up to the ${limitPerSource} soonest items from each source — overdue first, then by date.`;
}
