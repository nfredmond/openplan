/**
 * How a project record moves through its states, for every lane that offers a
 * status control.
 *
 * WHY THIS MODULE EXISTS. The milestone and submittal transition tables lived
 * inside `record-status-advance-button.tsx` — the component that renders them.
 * A capability that lives inside one of its callers gets reimplemented, wrongly,
 * by the next one: the risk and issue lanes were rendered read-only for months
 * with no way to move a record at all, because there was nothing to reuse that
 * did not mean copying a switch statement out of a button.
 *
 * So the vocabulary and the forward path are stated once, here, next to each
 * other, and `src/test/risk-and-issue-status-branches-are-reachable.test.tsx`
 * reads the CREATE TABLE constraints out of the migrations to prove the
 * vocabularies still match what Postgres will actually accept. A `.select()` is
 * not type-checked against the schema in this repo (see CLAUDE.md), and neither
 * is a zod enum — so the migration is the only authority, and the test consults
 * it rather than a hand-written list.
 *
 * Every lane listed here is one a planner can actually operate. An entry with
 * no control rendered anywhere is the defect this module was written to close,
 * not a head start on a future one — so a new lane is added when its UI is, and
 * "renders a control for every lane the registry declares", in that same test
 * file, fails the build for a lane no surface renders.
 */

/** The record lanes that offer a status control a planner can operate. */
export const PROJECT_RECORD_STATUS_TYPES = [
  "milestone",
  "submittal",
  "deliverable",
  "risk",
  "issue",
] as const;
export type ProjectRecordStatusType = (typeof PROJECT_RECORD_STATUS_TYPES)[number];

type AdvanceStep = {
  /** The state the primary button moves the record to. */
  readonly next: string;
  /** What the button says. Written for a planner, not for a state machine. */
  readonly label: string;
};

type RecordStatusLane = {
  /** The table whose CHECK constraint defines this lane's vocabulary. */
  readonly table: string;
  /** How the lane names one of its records in a sentence. */
  readonly recordLabel: string;
  /**
   * Every status the database will accept, in the register's own order. The
   * control offers all of them, so a planner is never trapped by the one-click
   * forward path — a risk that was closed too early has to be reopenable.
   */
  readonly statuses: readonly string[];
  /**
   * The single forward move offered as a button, per current status. A status
   * with no entry is terminal *for the button only*; the full list above still
   * lets a planner move it anywhere.
   */
  readonly advance: Readonly<Record<string, AdvanceStep>>;
};

export const PROJECT_RECORD_STATUS_LANES: Readonly<Record<ProjectRecordStatusType, RecordStatusLane>> = {
  milestone: {
    table: "project_milestones",
    recordLabel: "Milestone",
    statuses: ["not_started", "scheduled", "in_progress", "blocked", "complete"],
    advance: {
      not_started: { next: "in_progress", label: "Start milestone" },
      scheduled: { next: "in_progress", label: "Start milestone" },
      blocked: { next: "in_progress", label: "Resume milestone" },
      in_progress: { next: "complete", label: "Mark complete" },
    },
  },
  submittal: {
    table: "project_submittals",
    recordLabel: "Submittal",
    statuses: ["draft", "internal_review", "submitted", "accepted", "revise_and_resubmit"],
    advance: {
      draft: { next: "internal_review", label: "Move to internal review" },
      internal_review: { next: "submitted", label: "Mark submitted" },
      revise_and_resubmit: { next: "submitted", label: "Mark resubmitted" },
      submitted: { next: "accepted", label: "Mark accepted" },
    },
  },
  /**
   * `project_deliverables.status` — its own four-value vocabulary, deliberately
   * NOT the milestone list: a deliverable has no `scheduled` state.
   */
  deliverable: {
    table: "project_deliverables",
    recordLabel: "Deliverable",
    statuses: ["not_started", "in_progress", "blocked", "complete"],
    advance: {
      not_started: { next: "in_progress", label: "Start deliverable" },
      blocked: { next: "in_progress", label: "Resume deliverable" },
      in_progress: { next: "complete", label: "Mark complete" },
    },
  },
  /**
   * A risk register's own progression: a threat is identified (`open`), put
   * under active monitoring (`watch`), has its mitigation in place
   * (`mitigated`), and is finally retired (`closed`). Closing is the last step
   * on purpose — a mitigated risk that has not yet passed is still a risk, and
   * collapsing the two would let a project report a clean register early.
   */
  risk: {
    table: "project_risks",
    recordLabel: "Risk",
    statuses: ["open", "watch", "mitigated", "closed"],
    advance: {
      open: { next: "watch", label: "Move to watch" },
      watch: { next: "mitigated", label: "Mark mitigated" },
      mitigated: { next: "closed", label: "Close risk" },
    },
  },
  /**
   * An issue is a blocker that already happened, so it follows the milestone
   * shape rather than the risk one: work starts, may block, and ends resolved.
   */
  issue: {
    table: "project_issues",
    recordLabel: "Issue",
    statuses: ["open", "in_progress", "blocked", "resolved"],
    advance: {
      open: { next: "in_progress", label: "Start work" },
      blocked: { next: "in_progress", label: "Unblock issue" },
      in_progress: { next: "resolved", label: "Mark resolved" },
    },
  },
};

export function isProjectRecordStatusType(value: string): value is ProjectRecordStatusType {
  return (PROJECT_RECORD_STATUS_TYPES as readonly string[]).includes(value);
}

export function projectRecordStatuses(recordType: ProjectRecordStatusType): readonly string[] {
  return PROJECT_RECORD_STATUS_LANES[recordType].statuses;
}

export function projectRecordLabel(recordType: ProjectRecordStatusType): string {
  return PROJECT_RECORD_STATUS_LANES[recordType].recordLabel;
}

/** The state the primary button moves this record to, or null when none is offered. */
export function nextProjectRecordStatus(
  recordType: ProjectRecordStatusType,
  currentStatus: string
): string | null {
  return PROJECT_RECORD_STATUS_LANES[recordType].advance[currentStatus]?.next ?? null;
}

/** What that button says, or null when no forward move is offered from here. */
export function projectRecordAdvanceLabel(
  recordType: ProjectRecordStatusType,
  currentStatus: string
): string | null {
  return PROJECT_RECORD_STATUS_LANES[recordType].advance[currentStatus]?.label ?? null;
}
