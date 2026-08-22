/**
 * MY WORK's source descriptors — one entry per table that can put something on
 * a planner's week, each declaring exactly how it is read and how its rows
 * become queue items. Most put a DATE there; the three cross-module review
 * sources (6–8) put a WAITING THING there instead, and carry `dueOn: null`
 * rather than presenting the day a comment arrived as the day it is due.
 *
 * TENANCY IS PER-SOURCE AND DELIBERATE, exactly as in the Document Library.
 * NO project sub-record table carries a workspace_id of its own — deliverables,
 * milestones, submittals and issues are all scoped through `projects` by their
 * RLS policies (20260313000012). So this module reads them with a `!inner`
 * embed on `projects` and filters the workspace THROUGH that embed. The
 * `!inner` is load-bearing: a plain embed keeps the child row and nulls the
 * parent when the filter misses, so a planner who belongs to two workspaces
 * would see one workspace's deliverables listed on the other's work queue.
 * (Proven by fixture in `src/test/my-work-query.test.ts` — every person-scoped
 * source gets a decoy whose project lives in another workspace.)
 *
 * THE FOUR WORKSPACE-SCOPED SOURCES CARRY NO ASSIGNEE, AND NONE IS INVENTED.
 * `stage_gate_decisions`, `funding_opportunities`, `funding_awards` and
 * `billing_invoice_records` have no assignee column. Their items therefore OMIT
 * `assigneeUserId` entirely rather than setting it null — `undefined` says "this
 * kind of record does not have an assignee", `null` would say "we looked and
 * nobody is assigned", and only the first one is true.
 *
 * STATUS VOCABULARIES ARE THE DATABASE'S, NOT THIS FILE'S. `complete`,
 * `accepted`, `resolved`, `paid`/`rejected` come from the CHECK constraints in
 * 20260313000012, 20260313000013 and 20260321000033, and the ones shared with
 * the project control room are imported from `@/lib/work/deadlines` so that a
 * vocabulary change lands in one place.
 */

import { ENGAGEMENT_ITEM_ACTIONABLE_STATUSES } from "@/lib/engagement/catalog";
import {
  isClosingSoonFundingOpportunity,
  isOverdueFundingDecision,
  isPendingFundingDecision,
} from "@/lib/operations/funding-decision-status";
import {
  CLOSED_DELIVERABLE_STATUS,
  CLOSED_MILESTONE_STATUS,
  CLOSED_SUBMITTAL_STATUS,
  formatWorkDeadlineDate,
  invoicePriority,
  isDeadlinePast,
  SETTLED_INVOICE_STATUSES,
} from "@/lib/work/deadlines";

import type { MyWorkBlockId, MyWorkItem, MyWorkSourceId } from "./types";

/** A project issue that has been dealt with (20260313000013 status CHECK). */
const CLOSED_ISSUE_STATUS = "resolved";

/** An award whose money is fully spent has met its obligation deadline by definition. */
const SPENT_AWARD_STATUS = "fully_spent";

/** A model run the engine gave up on (20260317000025 status CHECK). */
const FAILED_RUN_STATUS = "failed";

/** A narrative draft no operator has accepted or dismissed yet (20260727000013). */
const UNREVIEWED_DRAFT_STATUS = "draft";

/**
 * The ONE draft target this queue can name a page for.
 *
 * `document_narrative_drafts.target_id` is deliberately polymorphic and carries
 * no foreign key, so the row cannot be embedded with its target. A report-section
 * draft is still linkable — `target_id` IS `reports.id`, and the review panel
 * sits at a known anchor on that page. An RTP CHAPTER draft is not: `target_id`
 * is `rtp_cycle_chapters.id`, and the review page is
 * `/rtp/<cycleId>/extraction/chapters`, whose cycle id this row does not carry
 * and cannot be embedded to fetch.
 *
 * So chapter drafts are FILTERED OUT rather than listed with a link to a list
 * page. An inbox item that cannot take you to the thing it is about is worse
 * than an absent one: it costs the same attention and returns nothing. Closing
 * the gap means giving the draft row its cycle (a column, a migration) or the
 * chapter review page a route of its own — not loosening this filter.
 */
const LINKABLE_DRAFT_TARGET_KIND = "report_section";

/**
 * Filters applied to every read of a source regardless of scope — the "is this
 * still live work" question, expressed against the database rather than after
 * the cap, so the per-source cap holds the soonest OPEN items rather than the
 * soonest items of which some are already done.
 */
export type MyWorkStaticFilter =
  | { kind: "eq"; column: string; value: string }
  | { kind: "neq"; column: string; value: string }
  | { kind: "notNull"; column: string }
  | { kind: "in"; column: string; values: readonly string[] }
  | { kind: "notIn"; column: string; values: readonly string[] };

export type MyWorkSource = {
  id: MyWorkSourceId;
  /** Block heading / chip, planner voice. */
  label: string;
  /**
   * What a failed read of this source is called in the disclosure sentence:
   * plural, lowercase, no trailing period (`ReadFailureLog` renders it
   * mid-sentence).
   */
  readLabel: string;
  block: MyWorkBlockId;
  table: string;
  select: string;
  /** The column the workspace filter binds to — a dotted embed path for the four join-scoped tables. */
  workspaceFilterColumn: string;
  /**
   * The assignee column the scope filter binds to, or null for a source that
   * has no assignee. Null also means the scope toggles do not affect this
   * source at all.
   */
  assigneeColumn: string | null;
  orderColumn: string;
  orderAscending: boolean;
  staticFilters: readonly MyWorkStaticFilter[];
  /**
   * How deep to read. Only the stage-gate source overrides it: the board keeps
   * the LATEST decision per gate, so it needs the decision HISTORY, not the
   * most recent N rows — a project whose gate was held and then passed must not
   * show as blocked because the pass fell outside the window.
   */
  readLimit?: (limitPerSource: number) => number;
  /**
   * Rows → items. Per-SOURCE rather than per-row (the Document Library's
   * `toEntry`) because two of these need to see the whole set: the stage-gate
   * source collapses a decision log to the latest decision per gate, and the
   * grant source applies the shared funding predicates.
   */
  toItems: (rows: Array<Record<string, unknown>>, context: MyWorkSourceContext) => MyWorkItem[];
};

export type MyWorkSourceContext = {
  now: Date;
  limitPerSource: number;
};

// ── row helpers ─────────────────────────────────────────────────────────────

function asString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

/**
 * A to-one PostgREST embed arrives as an object, but supabase-js types it
 * loosely and an ambiguous relationship can yield an array. Normalize to the
 * single record — or null, which after a `!inner` select should be impossible
 * and is treated as "parent unavailable" rather than hidden, so a broken join
 * shows up on screen instead of silently narrowing the queue.
 */
function embedded(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return (value[0] as Record<string, unknown>) ?? null;
  if (value && typeof value === "object") return value as Record<string, unknown>;
  return null;
}

/** What a row whose `!inner` project came back empty is called — visible, not hidden. */
const PROJECT_UNAVAILABLE = "(project unavailable)";

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** How long a comment's own text may stand in for a title it does not have. */
const COMMENT_TITLE_MAX_CHARS = 90;

/**
 * `engagement_items.title` is nullable — a resident dropping a pin usually
 * types only a body. The first line of what they wrote is what a moderator
 * recognises the item by, so it becomes the title, trimmed rather than padded
 * out with a manufactured one.
 */
function summarizeComment(body: string | null): string {
  const text = (body ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "(no comment text)";
  if (text.length <= COMMENT_TITLE_MAX_CHARS) return text;
  return `${text.slice(0, COMMENT_TITLE_MAX_CHARS).trimEnd()}…`;
}

/** Whether a run failed recently enough to still be live work. See FAILED_RUN_QUEUE_WINDOW_DAYS. */
function isWithinFailedRunWindow(createdAt: string | null, now: Date): boolean {
  if (!createdAt) return false;
  const failedAt = Date.parse(createdAt);
  if (Number.isNaN(failedAt)) return false;
  const ageDays = (now.getTime() - failedAt) / 86_400_000;
  return ageDays <= FAILED_RUN_QUEUE_WINDOW_DAYS;
}

function humanizeStatus(value: string | null): string | null {
  if (!value) return null;
  const spaced = value.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function deadlineBadge(kindLabel: string, overdue: boolean): MyWorkItem["badge"] {
  // The word "overdue" is IN THE LABEL, not only in the colour. A queue that
  // signals lateness by tone alone is unreadable to anyone who cannot see the
  // difference, and this is the one distinction the whole page turns on.
  return overdue
    ? { label: `${kindLabel} overdue`, tone: "danger" }
    : { label: `${kindLabel} due`, tone: "info" };
}

function projectHref(projectId: string | null, hash?: string): string {
  if (!projectId) return "/projects";
  return hash ? `/projects/${projectId}#${hash}` : `/projects/${projectId}`;
}

function campaignHref(campaignId: string | null, hash: string): string {
  if (!campaignId) return "/engagement";
  return `/engagement/${campaignId}#${hash}`;
}

function modelHref(modelId: string | null): string {
  return modelId ? `/models/${modelId}` : "/models";
}

/**
 * The report's own page, at the anchor of the panel that accepts or dismisses
 * the draft (`report-standard-detail.tsx` claims `report-narrative-draft-panel`
 * for one of its tabs, so the hash opens that tab too).
 */
function reportNarrativeDraftHref(reportId: string | null): string {
  if (!reportId) return "/reports";
  return `/reports/${reportId}#report-narrative-draft-panel`;
}

/**
 * The `assigneeUserId` key is only ever set from a row that CARRIED it. A
 * deployment behind 20260811000006 fails the read outright (the column is in
 * the select), so this is belt-and-braces: an item that never saw the column
 * omits the key rather than claiming nobody is assigned.
 */
function assigneeKey(row: Record<string, unknown>): { assigneeUserId?: string | null } {
  if (!("assignee_user_id" in row)) return {};
  const value = row.assignee_user_id;
  return { assigneeUserId: typeof value === "string" && value ? value : null };
}

// ── 1. Deliverables ─────────────────────────────────────────────────────────

const deliverablesSource: MyWorkSource = {
  id: "deliverables",
  label: "Deliverables",
  readLabel: "project deliverables",
  block: "deadlines",
  table: "project_deliverables",
  select:
    "id, project_id, title, summary, status, due_date, owner_label, assignee_user_id, projects!inner(id, name, workspace_id)",
  workspaceFilterColumn: "projects.workspace_id",
  assigneeColumn: "assignee_user_id",
  orderColumn: "due_date",
  orderAscending: true,
  staticFilters: [
    { kind: "neq", column: "status", value: CLOSED_DELIVERABLE_STATUS },
    { kind: "notNull", column: "due_date" },
  ],
  toItems: (rows, { now }) =>
    rows.map((row) => {
      const project = embedded(row.projects);
      const dueOn = asString(row.due_date);
      const overdue = isDeadlinePast(dueOn, now);
      const status = humanizeStatus(asString(row.status));
      return {
        sourceId: "deliverables",
        block: "deadlines",
        id: String(row.id),
        title: asString(row.title) ?? "(untitled deliverable)",
        projectId: asString(row.project_id),
        projectName: asString(project?.name) ?? PROJECT_UNAVAILABLE,
        dueOn,
        isOverdue: overdue,
        ...assigneeKey(row),
        ownerLabel: asString(row.owner_label),
        badge: deadlineBadge("Deliverable", overdue),
        detail: status ? `${status} · due ${formatWorkDeadlineDate(dueOn)}` : `Due ${formatWorkDeadlineDate(dueOn)}`,
        href: projectHref(asString(row.project_id), "project-deliverables"),
        dedupKey: null,
      } satisfies MyWorkItem;
    }),
};

// ── 2. Milestones (obligation milestones included — see the de-dup note) ────

const milestonesSource: MyWorkSource = {
  id: "milestones",
  label: "Milestones",
  readLabel: "project milestones",
  block: "deadlines",
  table: "project_milestones",
  select:
    "id, project_id, title, status, target_date, owner_label, assignee_user_id, milestone_type, phase_code, funding_award_id, projects!inner(id, name, workspace_id)",
  workspaceFilterColumn: "projects.workspace_id",
  assigneeColumn: "assignee_user_id",
  orderColumn: "target_date",
  orderAscending: true,
  staticFilters: [
    { kind: "neq", column: "status", value: CLOSED_MILESTONE_STATUS },
    { kind: "notNull", column: "target_date" },
  ],
  toItems: (rows, { now }) =>
    rows.map((row) => {
      const project = embedded(row.projects);
      const dueOn = asString(row.target_date);
      const overdue = isDeadlinePast(dueOn, now);
      const phase = asString(row.phase_code);
      const awardId = asString(row.funding_award_id);
      const isObligation = asString(row.milestone_type) === "obligation";
      return {
        sourceId: "milestones",
        block: "deadlines",
        id: String(row.id),
        title: asString(row.title) ?? "(untitled milestone)",
        projectId: asString(row.project_id),
        projectName: asString(project?.name) ?? PROJECT_UNAVAILABLE,
        dueOn,
        isOverdue: overdue,
        ...assigneeKey(row),
        ownerLabel: asString(row.owner_label),
        badge: deadlineBadge("Milestone", overdue),
        detail: phase
          ? `${humanizeStatus(phase)} phase checkpoint · target ${formatWorkDeadlineDate(dueOn)}`
          : `Project checkpoint · target ${formatWorkDeadlineDate(dueOn)}`,
        href: projectHref(asString(row.project_id), `project-milestone-${row.id}`),
        // An obligation milestone mirrors a funding award's own
        // obligation_due_at (20260416000053). Both would otherwise appear —
        // once on someone's list and once in the workspace block.
        dedupKey: isObligation && awardId ? `award:${awardId}` : null,
      } satisfies MyWorkItem;
    }),
};

// ── 3. Submittals — agency_label names the REVIEWER, never the assignee ─────

const submittalsSource: MyWorkSource = {
  id: "submittals",
  label: "Submittals",
  readLabel: "project submittals",
  block: "deadlines",
  table: "project_submittals",
  select:
    "id, project_id, title, status, due_date, agency_label, submittal_type, assignee_user_id, projects!inner(id, name, workspace_id)",
  workspaceFilterColumn: "projects.workspace_id",
  assigneeColumn: "assignee_user_id",
  orderColumn: "due_date",
  orderAscending: true,
  staticFilters: [
    { kind: "neq", column: "status", value: CLOSED_SUBMITTAL_STATUS },
    { kind: "notNull", column: "due_date" },
  ],
  toItems: (rows, { now }) =>
    rows.map((row) => {
      const project = embedded(row.projects);
      const dueOn = asString(row.due_date);
      const overdue = isDeadlinePast(dueOn, now);
      const agency = asString(row.agency_label);
      const type = humanizeStatus(asString(row.submittal_type));
      return {
        sourceId: "submittals",
        block: "deadlines",
        id: String(row.id),
        title: asString(row.title) ?? "(untitled submittal)",
        projectId: asString(row.project_id),
        projectName: asString(project?.name) ?? PROJECT_UNAVAILABLE,
        dueOn,
        isOverdue: overdue,
        ...assigneeKey(row),
        // project_submittals has no owner_label column at all: the free-text
        // lane here names the reviewing AGENCY, which is a different fact and
        // is rendered as one.
        ownerLabel: null,
        badge: deadlineBadge("Submittal", overdue),
        detail: [type ? `${type} packet` : "Packet", agency ? `for ${agency}` : null, `due ${formatWorkDeadlineDate(dueOn)}`]
          .filter(Boolean)
          .join(" · "),
        href: projectHref(asString(row.project_id), `project-submittal-${row.id}`),
        dedupKey: null,
      } satisfies MyWorkItem;
    }),
};

// ── 4. Issues — NO date column exists, so they get their own block ──────────

const issuesSource: MyWorkSource = {
  id: "issues",
  label: "Issues",
  readLabel: "project issues",
  block: "undated",
  table: "project_issues",
  select:
    "id, project_id, title, status, severity, owner_label, assignee_user_id, created_at, projects!inner(id, name, workspace_id)",
  workspaceFilterColumn: "projects.workspace_id",
  assigneeColumn: "assignee_user_id",
  orderColumn: "created_at",
  orderAscending: false,
  staticFilters: [{ kind: "neq", column: "status", value: CLOSED_ISSUE_STATUS }],
  toItems: (rows) =>
    rows.map((row) => {
      const project = embedded(row.projects);
      const severity = humanizeStatus(asString(row.severity));
      const status = humanizeStatus(asString(row.status));
      return {
        sourceId: "issues",
        block: "undated",
        id: String(row.id),
        title: asString(row.title) ?? "(untitled issue)",
        projectId: asString(row.project_id),
        projectName: asString(project?.name) ?? PROJECT_UNAVAILABLE,
        // project_issues has no date column (20260313000013). Not "undated
        // today" — the table has never had one, and an issue given a fake date
        // would sort into the deadline queue as either due now or long overdue.
        dueOn: null,
        isOverdue: false,
        ...assigneeKey(row),
        ownerLabel: asString(row.owner_label),
        badge: { label: "Issue", tone: severity === "Critical" || severity === "High" ? "warning" : "neutral" },
        detail: [severity ? `${severity} severity` : null, status].filter(Boolean).join(" · ") || null,
        href: projectHref(asString(row.project_id), "project-issues"),
        dedupKey: null,
      } satisfies MyWorkItem;
    }),
};

// ── 5. Stage-gate holds — a fact about a PROJECT, not about a person ────────

/**
 * The decision log collapses to the latest decision per (project, gate) exactly
 * as `buildProjectStageGateSummary` does. Rows arrive newest-first, so the first
 * one seen for a gate is the current one — a gate held in March and passed in
 * April is NOT blocked, and a queue that showed the March row would send a
 * planner to unblock something that is already through.
 */
function collapseToHeldGates(
  rows: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
  const latest = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const projectId = asString(row.project_id);
    const gateId = asString(row.gate_id);
    if (!projectId || !gateId) continue;
    const key = `${projectId}::${gateId}`;
    if (!latest.has(key)) latest.set(key, row);
  }
  return [...latest.values()].filter((row) => asString(row.decision) === "HOLD");
}

const stageGateHoldsSource: MyWorkSource = {
  id: "stage_gate_holds",
  label: "Blocked projects",
  readLabel: "stage-gate decisions",
  block: "blocked_projects",
  table: "stage_gate_decisions",
  select: "id, project_id, gate_id, decision, rationale, decided_at, projects!inner(id, name)",
  // This table carries its own workspace_id; the `!inner` here attaches the
  // project name and drops decisions with no project — an unattributed decision
  // is not evidence about any project, which is the summary builder's own rule.
  workspaceFilterColumn: "workspace_id",
  assigneeColumn: null,
  orderColumn: "decided_at",
  orderAscending: false,
  staticFilters: [],
  readLimit: (limitPerSource) => Math.max(limitPerSource * 10, 200),
  toItems: (rows, { now: _now, limitPerSource }) =>
    collapseToHeldGates(rows)
      .slice(0, limitPerSource)
      .map((row) => {
        const project = embedded(row.projects);
        const rationale = asString(row.rationale);
        return {
          sourceId: "stage_gate_holds",
          block: "blocked_projects",
          id: String(row.id),
          title: asString(project?.name) ?? PROJECT_UNAVAILABLE,
          projectId: asString(row.project_id),
          projectName: asString(project?.name) ?? PROJECT_UNAVAILABLE,
          // A hold has a decision date, not a deadline. Presenting `decided_at`
          // as a due date would invent an obligation nobody recorded.
          dueOn: null,
          isOverdue: false,
          ownerLabel: null,
          badge: { label: "Gate on hold", tone: "warning" },
          detail: [
            `Gate ${asString(row.gate_id) ?? "(unnamed)"}`,
            asString(row.decided_at) ? `held ${formatWorkDeadlineDate(asString(row.decided_at))}` : null,
            rationale,
          ]
            .filter(Boolean)
            .join(" · "),
          href: projectHref(asString(row.project_id)),
          dedupKey: null,
        } satisfies MyWorkItem;
      }),
};

// ── 6–8. The cross-module review queue (2026-08-21) ─────────────────────────
//
// Three sources that answer one question a planner previously had to open
// three modules to ask: is anything WAITING ON A PERSON here?
//
// NONE OF THEM CARRIES AN ASSIGNEE, AND THAT IS THE POINT. A resident's comment
// is moderated by whoever reaches it first; a model run that crashed is a fact
// about the workspace; a drafted narrative awaits any member authorized to
// accept it. `assigneeColumn: null` therefore also means the scope toggles do
// not touch these — switching to "Assigned to me" must not hide a queue nobody
// is assigned to, which is exactly how a moderation backlog becomes invisible.
// (`engagement_items.created_by` and `model_runs.created_by` DO exist. They are
// authorship, not assignment: the person who launched a run did not thereby
// agree to be the one who fixes it, and reading a `created_by` as an assignee
// would put a name on an obligation nobody accepted — the same rule the
// workspace-deadline sources follow.)

/**
 * How far back a failed model run stays on the queue.
 *
 * The other two sources have no window and must not have one: a comment that
 * has waited three weeks is the MOST urgent thing in a moderation queue, and a
 * narrative draft does not expire while it waits for a verdict. A failed run is
 * different in kind — nothing in the product ever marks one resolved (this
 * module writes nothing, deliberately), so without a window every failure a
 * workspace has ever had would sit in the inbox forever, and a block that can
 * never be emptied is a block people learn to scroll past. Older failures are
 * still on the model's own page, which is where run history belongs.
 */
export const FAILED_RUN_QUEUE_WINDOW_DAYS = 30;

const engagementModerationSource: MyWorkSource = {
  id: "engagement_moderation",
  label: "Comments to moderate",
  readLabel: "engagement comments",
  block: "needs_review",
  table: "engagement_items",
  // `engagement_items` has NO workspace_id of its own (20260314000020) — it is
  // scoped through its campaign, exactly like the four project sources are
  // scoped through `projects`. The `!inner` is load-bearing for the same
  // reason: a plain embed would keep the comment and null the campaign when the
  // workspace filter missed, putting one agency's residents in another's queue.
  select:
    "id, campaign_id, title, body, status, source_type, created_at, engagement_campaigns!inner(id, title, workspace_id, project_id, projects(id, name))",
  workspaceFilterColumn: "engagement_campaigns.workspace_id",
  assigneeColumn: null,
  // OLDEST FIRST, which is the opposite of every other source here. The queue's
  // question is "who has been waiting longest for an answer", and a resident who
  // commented three weeks ago is further down the page under any other ordering.
  orderColumn: "created_at",
  orderAscending: true,
  staticFilters: [
    // The shared definition, imported rather than spelled out — the campaign
    // console counts its review queue from this same list.
    { kind: "in", column: "status", values: ENGAGEMENT_ITEM_ACTIONABLE_STATUSES },
  ],
  toItems: (rows) =>
    rows.map((row) => {
      const campaign = embedded(row.engagement_campaigns);
      const project = embedded(campaign?.projects);
      const status = asString(row.status);
      const campaignTitle = asString(campaign?.title) ?? "(campaign unavailable)";
      return {
        sourceId: "engagement_moderation",
        block: "needs_review",
        id: String(row.id),
        title: asString(row.title) ?? summarizeComment(asString(row.body)),
        projectId: asString(campaign?.project_id),
        projectName: asString(project?.name),
        // A comment has a submission date, not a deadline. Presenting the date
        // it arrived as a due date would invent an SLA no agency agreed to.
        dueOn: null,
        isOverdue: false,
        ownerLabel: null,
        badge:
          status === "flagged"
            ? { label: "Flagged", tone: "danger" }
            : { label: "Awaiting review", tone: "warning" },
        detail: [
          campaignTitle,
          asString(row.created_at) ? `received ${formatWorkDeadlineDate(asString(row.created_at))}` : null,
          humanizeStatus(asString(row.source_type)),
        ]
          .filter(Boolean)
          .join(" · "),
        // Straight to the comment: `engagement-item-` is the Responses tab's
        // own anchor prefix (`(app)/engagement/[campaignId]/_tabs.ts`), so the
        // hash opens the right tab and scrolls to the row, rather than dropping
        // a moderator at the top of a long console.
        href: campaignHref(asString(row.campaign_id), `engagement-item-${String(row.id)}`),
        dedupKey: null,
      } satisfies MyWorkItem;
    }),
};

const failedModelRunsSource: MyWorkSource = {
  id: "failed_model_runs",
  label: "Failed model runs",
  readLabel: "model runs",
  block: "needs_review",
  table: "model_runs",
  select: "id, model_id, run_title, status, error_message, engine_key, created_at",
  // This table carries its own workspace_id (20260317000025).
  workspaceFilterColumn: "workspace_id",
  assigneeColumn: null,
  orderColumn: "created_at",
  orderAscending: false,
  staticFilters: [{ kind: "eq", column: "status", value: FAILED_RUN_STATUS }],
  toItems: (rows, { now }) =>
    rows
      .filter((row) => isWithinFailedRunWindow(asString(row.created_at), now))
      .map((row) => {
        const error = asString(row.error_message);
        return {
          sourceId: "failed_model_runs",
          block: "needs_review",
          id: String(row.id),
          title: asString(row.run_title) ?? "(untitled run)",
          projectId: null,
          projectName: null,
          dueOn: null,
          isOverdue: false,
          ownerLabel: null,
          badge: { label: "Run failed", tone: "danger" },
          // THE CAUSE IS THE ROW'S OWN, OR IT IS ABSENT. A run whose worker
          // died without writing `error_message` once read as benign on the
          // model page; the fix there was to stop implying success, and the fix
          // here is the same — this queue never guesses why a run failed.
          detail: [
            humanizeStatus(asString(row.engine_key)),
            asString(row.created_at) ? `failed ${formatWorkDeadlineDate(asString(row.created_at))}` : null,
            error ?? "No cause recorded — open the run to see how far it got.",
          ]
            .filter(Boolean)
            .join(" · "),
          // The model's own page is where run history lives; there is no
          // per-run route to deep-link to.
          href: modelHref(asString(row.model_id)),
          dedupKey: null,
        } satisfies MyWorkItem;
      }),
};

const narrativeDraftsSource: MyWorkSource = {
  id: "narrative_drafts",
  label: "Drafts awaiting review",
  readLabel: "narrative drafts",
  block: "needs_review",
  table: "document_narrative_drafts",
  select:
    "id, target_kind, target_id, section_key, model, grounded_sentence_count, total_sentence_count, created_at",
  workspaceFilterColumn: "workspace_id",
  assigneeColumn: null,
  orderColumn: "created_at",
  orderAscending: false,
  staticFilters: [
    { kind: "eq", column: "status", value: UNREVIEWED_DRAFT_STATUS },
    // ONLY REPORT SECTIONS, AND THE OMISSION IS DELIBERATE — see the note below.
    { kind: "eq", column: "target_kind", value: LINKABLE_DRAFT_TARGET_KIND },
  ],
  toItems: (rows) =>
    rows.map((row) => {
      const grounded = asNumber(row.grounded_sentence_count);
      const total = asNumber(row.total_sentence_count);
      return {
        sourceId: "narrative_drafts",
        block: "needs_review",
        id: String(row.id),
        title: `Draft narrative — ${humanizeStatus(asString(row.section_key)) ?? "report section"}`,
        projectId: null,
        projectName: null,
        dueOn: null,
        isOverdue: false,
        ownerLabel: null,
        badge: { label: "Awaiting accept", tone: "warning" },
        // The GROUNDING RATIO rides along, because it is the fact that decides
        // how hard this draft needs reading: a queue item saying 4 of 11
        // sentences are grounded is asking for a different kind of attention
        // than one saying 11 of 11.
        detail: [
          grounded !== null && total !== null ? `${grounded} of ${total} sentences grounded` : null,
          asString(row.model) ? `drafted by ${asString(row.model)}` : null,
          asString(row.created_at) ? `${formatWorkDeadlineDate(asString(row.created_at))}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
        href: reportNarrativeDraftHref(asString(row.target_id)),
        dedupKey: null,
      } satisfies MyWorkItem;
    }),
};

// ── 9. Grant decisions — the shared predicates, used verbatim ───────────────

const grantDecisionsSource: MyWorkSource = {
  id: "grant_decisions",
  label: "Grant decisions",
  readLabel: "grant opportunities",
  block: "workspace_deadlines",
  table: "funding_opportunities",
  select:
    "id, project_id, title, opportunity_status, decision_state, closes_at, decision_due_at, agency_name, projects(id, name)",
  workspaceFilterColumn: "workspace_id",
  assigneeColumn: null,
  orderColumn: "decision_due_at",
  orderAscending: true,
  staticFilters: [{ kind: "notNull", column: "decision_due_at" }],
  toItems: (rows, { now }) =>
    rows
      .map((row) => {
        // The predicates come from lib/operations/funding-decision-status.ts
        // UNCHANGED. That module exists because two surfaces had each written
        // their own "awaiting a decision" test and one of them keyed on a null
        // decision_state the schema cannot produce, making its counter
        // permanently zero. A third copy here would be the same defect.
        const facts = {
          opportunityStatus: asString(row.opportunity_status),
          decisionState: asString(row.decision_state),
          closesAt: asString(row.closes_at),
          decisionDueAt: asString(row.decision_due_at),
        };
        if (!isPendingFundingDecision(facts)) return null as MyWorkItem | null;
        const project = embedded(row.projects);
        const overdue = isOverdueFundingDecision(facts, now);
        const closingSoon = isClosingSoonFundingOpportunity(facts, now);
        const agency = asString(row.agency_name);
        return {
          sourceId: "grant_decisions",
          block: "workspace_deadlines",
          id: String(row.id),
          title: asString(row.title) ?? "(untitled opportunity)",
          projectId: asString(row.project_id),
          projectName: asString(project?.name),
          dueOn: facts.decisionDueAt,
          isOverdue: overdue,
          // No assigneeUserId key at all: funding_opportunities has no assignee
          // column, and nobody has accepted this deadline.
          ownerLabel: null,
          badge: overdue
            ? { label: "Decision overdue", tone: "danger" }
            : { label: "Pursue-or-skip decision", tone: "info" },
          detail: [
            agency,
            closingSoon ? "closing soon" : null,
            `decision due ${formatWorkDeadlineDate(facts.decisionDueAt)}`,
          ]
            .filter(Boolean)
            .join(" · "),
          href: "/grants",
          dedupKey: null,
        } satisfies MyWorkItem;
      })
      .filter((item): item is MyWorkItem => item !== null),
};

// ── 10. Award obligations — de-duplicated against mirrored milestones ────────

const awardObligationsSource: MyWorkSource = {
  id: "award_obligations",
  label: "Award obligations",
  readLabel: "funding awards",
  block: "workspace_deadlines",
  table: "funding_awards",
  select:
    "id, project_id, title, obligation_due_at, spending_status, risk_flag, projects!inner(id, name)",
  workspaceFilterColumn: "workspace_id",
  assigneeColumn: null,
  orderColumn: "obligation_due_at",
  orderAscending: true,
  staticFilters: [
    { kind: "notNull", column: "obligation_due_at" },
    // Money already fully spent has met its obligation deadline; listing it
    // would be a deadline nobody can act on.
    { kind: "neq", column: "spending_status", value: SPENT_AWARD_STATUS },
  ],
  toItems: (rows, { now }) =>
    rows.map((row) => {
      const project = embedded(row.projects);
      const dueOn = asString(row.obligation_due_at);
      const overdue = isDeadlinePast(dueOn, now);
      const risk = asString(row.risk_flag);
      return {
        sourceId: "award_obligations",
        block: "workspace_deadlines",
        id: String(row.id),
        title: asString(row.title) ?? "(untitled award)",
        projectId: asString(row.project_id),
        projectName: asString(project?.name) ?? PROJECT_UNAVAILABLE,
        dueOn,
        isOverdue: overdue,
        ownerLabel: null,
        badge: deadlineBadge("Obligation", overdue),
        detail: [
          `Funds must be obligated by ${formatWorkDeadlineDate(dueOn)}`,
          risk && risk !== "none" ? `risk flag: ${risk}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
        href: projectHref(asString(row.project_id), "project-funding-opportunities"),
        dedupKey: `award:${String(row.id)}`,
      } satisfies MyWorkItem;
    }),
};

// ── 11. Invoice windows — invoicePriority's own vocabulary ───────────────────

const invoiceWindowsSource: MyWorkSource = {
  id: "invoice_windows",
  label: "Invoices",
  readLabel: "invoice records",
  block: "workspace_deadlines",
  table: "billing_invoice_records",
  select: "id, project_id, invoice_number, status, due_date, submitted_to, projects(id, name)",
  workspaceFilterColumn: "workspace_id",
  assigneeColumn: null,
  orderColumn: "due_date",
  orderAscending: true,
  staticFilters: [
    { kind: "notNull", column: "due_date" },
    // The same settled-status vocabulary the project control room's
    // invoicePriority uses, imported rather than retyped.
    { kind: "notIn", column: "status", values: SETTLED_INVOICE_STATUSES },
  ],
  toItems: (rows, { now }) =>
    rows.map((row) => {
      const project = embedded(row.projects);
      const dueOn = asString(row.due_date);
      const submittedTo = asString(row.submitted_to);
      // OVERDUE IS THE CONTROL ROOM'S DEFINITION, NOT A SECOND ONE. Priority 0
      // in `invoicePriority` is exactly "unsettled and past its due date" —
      // asking that function instead of re-testing the date here is what keeps
      // an invoice from reading as late on this page and current on the
      // project's own invoice lane.
      const overdue = invoicePriority({ status: asString(row.status), due_date: dueOn }, now) === 0;
      return {
        sourceId: "invoice_windows",
        block: "workspace_deadlines",
        id: String(row.id),
        title: `Invoice ${asString(row.invoice_number) ?? "(unnumbered)"}`,
        projectId: asString(row.project_id),
        projectName: asString(project?.name),
        dueOn,
        isOverdue: overdue,
        ownerLabel: null,
        badge: deadlineBadge("Invoice", overdue),
        detail: [
          submittedTo ? `Submitted to ${submittedTo}` : "Review and payment lane",
          humanizeStatus(asString(row.status)),
          `due ${formatWorkDeadlineDate(dueOn)}`,
        ]
          .filter(Boolean)
          .join(" · "),
        href: asString(row.project_id)
          ? projectHref(asString(row.project_id), `project-invoice-${row.id}`)
          : "/invoicing",
        dedupKey: null,
      } satisfies MyWorkItem;
    }),
};

/**
 * The sources in presentation order. This array IS the queue's scope: the
 * loader reads exactly these and nothing else.
 */
export const MY_WORK_SOURCES: readonly MyWorkSource[] = [
  deliverablesSource,
  milestonesSource,
  submittalsSource,
  issuesSource,
  stageGateHoldsSource,
  engagementModerationSource,
  failedModelRunsSource,
  narrativeDraftsSource,
  grantDecisionsSource,
  awardObligationsSource,
  invoiceWindowsSource,
];
