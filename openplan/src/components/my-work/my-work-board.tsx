import Link from "next/link";

import { RecordAssigneeChip, type ProjectAssigneeRoster } from "@/components/projects/record-assignee";
import { StatusBadge } from "@/components/ui/status-badge";
import { MyWorkScopeToggles } from "@/components/my-work/my-work-scope-toggles";
import {
  describeMyWorkOrdering,
  groupMyWorkItemsByBlock,
  MY_WORK_SCOPE_LABELS,
  type MyWorkBlockId,
  type MyWorkItem,
  type MyWorkResult,
  type MyWorkScope,
  type MyWorkSourceId,
} from "@/lib/my-work/types";
import { FAILED_RUN_QUEUE_WINDOW_DAYS } from "@/lib/my-work/sources";
import { formatWorkDeadlineDate } from "@/lib/work/deadlines";
import { OperatorDetail } from "@/components/ui/read-failure-notice";

/**
 * The personal work queue, rendered.
 *
 * WHAT THIS COMPONENT IS CAREFUL ABOUT, in order of how badly it goes wrong:
 *
 * 1. AN EMPTY BLOCK UNDER A FAILED READ IS NOT A FINDING. Every block asks its
 *    own sources' outcomes before it says "nothing here". A queue that answers
 *    "you're all caught up" because a query broke is the worst sentence this
 *    page could produce — a planner acts on it by going home.
 * 2. THE EMPTY STATE OFFERS THE OTHER SCOPES (Nathaniel's decision, 2026-08-11).
 *    "Nothing assigned to you" is a dead end; the useful next question is
 *    whether anything is unassigned, and the answer is one link away.
 * 3. A DEPARTED ASSIGNEE SAYS SO. Never a blank, never a stale name —
 *    `RecordAssigneeChip` owns that sentence and this page reuses it rather
 *    than writing a second one (the recorded "reimplemented wrongly by the
 *    other caller" defect class).
 * 4. NOTHING IN THE WORKSPACE BLOCK IS PRESENTED AS ASSIGNED. Those tables have
 *    no assignee column, so those items carry no assignee key and no chip. The
 *    same holds for the review queue: a comment waiting for moderation belongs
 *    to whoever reaches it, and a chip claiming otherwise would be invented.
 * 5. THE REVIEW QUEUE NAMES THE LANE THAT BROKE. Three different modules feed
 *    that block, so "could not be read" without saying which one is a sentence
 *    a planner cannot act on.
 */

export type MyWorkBoardProps = {
  scope: MyWorkScope;
  items: MyWorkItem[];
  perSource: MyWorkResult["perSource"];
  limitPerSource: number;
  /** The queue's read-failure sentence, or null when everything loaded. */
  readFailureSummary: string | null;
  roster: ProjectAssigneeRoster;
  departedIncludedInUnassigned: boolean;
  /**
   * Viewers are read-only and are never given project work, so their assigned
   * block is empty by construction. The page says that in words instead of
   * leaving them looking at a blank panel wondering what they did wrong.
   */
  isViewer: boolean;
};

const BLOCK_HEADINGS: Record<MyWorkBlockId, string> = {
  deadlines: "Dated work",
  undated: "Issues (no due date)",
  blocked_projects: "Blocked projects",
  needs_review: "Waiting on a person",
  workspace_deadlines: "Shared deadlines",
};

const BLOCK_NOTES: Record<MyWorkBlockId, string> = {
  deadlines: "Overdue first, then soonest.",
  undated: "Project issues carry no due date, so they are listed separately rather than sorted in as if they were due today.",
  blocked_projects:
    "Stage gates whose latest decision was a hold. A hold is a fact about the project, not an item on one person's list — so this block reads the same for everyone here.",
  needs_review:
    "Work in other modules that has stopped and needs someone here to act. Nobody is assigned to these — the queue reads the same for everyone in the workspace.",
  workspace_deadlines:
    "Grant decisions, award obligations and invoice windows. Nobody is assigned to these, so nothing here is shown as belonging to anyone.",
};

/** Which sources feed which block — used to answer "empty, or unreadable?". */
const BLOCK_SOURCES: Record<MyWorkBlockId, readonly MyWorkSourceId[]> = {
  deadlines: ["deliverables", "milestones", "submittals"],
  undated: ["issues"],
  blocked_projects: ["stage_gate_holds"],
  needs_review: ["engagement_moderation", "failed_model_runs", "narrative_drafts", "decision_package_reviews"],
  workspace_deadlines: ["grant_decisions", "award_obligations", "invoice_windows"],
};

/**
 * What each review-queue lane is called when its read fails. Three separate
 * modules feed one block here, so an unreadable lane is named: "comments to
 * moderate could not be read" tells a moderator to go look in the campaign
 * console, and "this block is unavailable" tells them nothing.
 */
const NEEDS_REVIEW_SOURCE_LABELS: Record<string, string> = {
  engagement_moderation: "comments to moderate",
  failed_model_runs: "failed model runs",
  narrative_drafts: "narrative drafts awaiting review",
  decision_package_reviews: "decision packages awaiting review or replacement",
};

/** The person-scoped sources — the ones the scope toggles actually move. */
const PERSON_SCOPED_SOURCES: readonly MyWorkSourceId[] = [
  "deliverables",
  "milestones",
  "submittals",
  "issues",
];

function WorkItemRow({ item, roster }: { item: MyWorkItem; roster: ProjectAssigneeRoster }) {
  const due = formatWorkDeadlineDate(item.dueOn);
  return (
    <div className="module-record-row scroll-mt-24">
      <div className="module-record-main">
        <div className="module-record-head">
          <Link href={item.href} className="module-record-title">
            {item.title}
          </Link>
          <StatusBadge tone={item.badge.tone}>{item.badge.label}</StatusBadge>
          {due ? <span className="module-record-stamp">{due}</span> : null}
        </div>
        {item.detail ? <p className="module-record-summary">{item.detail}</p> : null}
        <div className="module-record-meta">
          {item.projectId ? (
            <Link href={`/projects/${item.projectId}`} className="module-record-chip">
              {item.projectName ?? "Project"}
            </Link>
          ) : (
            <span className="module-record-chip">Workspace record</span>
          )}
          <RecordAssigneeChip roster={roster} assigneeUserId={item.assigneeUserId} />
          {item.ownerLabel ? (
            <span className="module-record-chip">Owner: {item.ownerLabel}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function MyWorkBoard({
  scope,
  items,
  perSource,
  limitPerSource,
  readFailureSummary,
  roster,
  departedIncludedInUnassigned,
  isViewer,
}: MyWorkBoardProps) {
  const blocks = groupMyWorkItemsByBlock(items);

  const sourceUnavailable = (sourceId: MyWorkSourceId) => {
    const outcome = perSource[sourceId];
    return Boolean(outcome?.failed || outcome?.pending);
  };
  const blockHasUnreadableSource = (blockId: MyWorkBlockId) =>
    BLOCK_SOURCES[blockId].some(sourceUnavailable);

  // A deployment behind 20260811000006 has no assignee_user_id column, so the
  // four person-scoped reads fail as "pending schema". That is an operator move
  // with a name, not an outage, and saying which migration is missing is the
  // difference between a fixable message and a mystery.
  const assigneeColumnPending = PERSON_SCOPED_SOURCES.some(
    (sourceId) => perSource[sourceId]?.pending
  );

  const personalIsUnreadable = blockHasUnreadableSource("deadlines");

  const unreadableReviewLanes = BLOCK_SOURCES.needs_review
    .filter(sourceUnavailable)
    .map((sourceId) => NEEDS_REVIEW_SOURCE_LABELS[sourceId] ?? sourceId);

  return (
    <section className="module-page">
      <article className="module-intro-card">
        <div className="module-intro-kicker">Workspace</div>
        <div className="module-intro-body">
          <h1 className="module-intro-title">My work</h1>
          <p className="module-intro-description">
            Everything with a date on it, across every project in this workspace: what you are
            assigned, what nobody has picked up, which projects are held at a stage gate, and the
            grant, obligation and invoice deadlines the workspace is carrying.
          </p>
        </div>
        <p className="module-note">{describeMyWorkOrdering(limitPerSource)}</p>
        {readFailureSummary ? (
          <p className="module-alert" role="status">
            {readFailureSummary}
          </p>
        ) : null}
        {/* The planner learns that assignment is unavailable and who can make it
            available. The migration number is the operator's business and waits
            underneath — kept, not dropped. */}
        {assigneeColumnPending ? (
          <div className="module-alert" role="status">
            <p>
              This copy of OpenPlan cannot yet tell whose work is whose — that part of the
              database is not set up. Whoever installed OpenPlan for your agency can finish the
              setup, and then assignment will work here.
            </p>
            <OperatorDetail>
              <p>Migration 20260811000006 adds the assignee column. Apply the pending migrations and reload.</p>
            </OperatorDetail>
          </div>
        ) : null}
        {scope === "unassigned" && !departedIncludedInUnassigned ? (
          <p className="module-note">
            This list shows work with nobody assigned to it. Work left behind by someone who has
            since left the team could not be included — the team roster was unavailable, or the
            team is larger than this filter can carry. Switch to{" "}
            {MY_WORK_SCOPE_LABELS.all_projects} to see it.
          </p>
        ) : null}
      </article>

      <MyWorkScopeToggles scope={scope} />

      <article className="module-section-surface">
        <h2 className="module-section-title">{BLOCK_HEADINGS.deadlines}</h2>
        <p className="module-note">{BLOCK_NOTES.deadlines}</p>
        {blocks.deadlines.length > 0 ? (
          <div className="module-record-list">
            {blocks.deadlines.map((item) => (
              <WorkItemRow key={`${item.sourceId}-${item.id}`} item={item} roster={roster} />
            ))}
          </div>
        ) : personalIsUnreadable ? (
          <p className="module-empty-state">
            This list could not be read, so it is shown as unavailable rather than as empty. An
            empty list here would not mean there is nothing due.
          </p>
        ) : (
          <div className="module-empty-state">
            <p>
              {scope === "assigned"
                ? isViewer
                  ? "Nothing is assigned to you. Viewers can read everything here but are not given project work — the shared deadlines below are what this page can show you."
                  : "Nothing dated is assigned to you right now."
                : scope === "unassigned"
                  ? "Every piece of dated project work here has someone on it."
                  : "No project here has any dated work open."}
            </p>
            <p className="module-note">
              Try another view — unassigned work and other people&apos;s deadlines are one click
              away, and work is assigned from its own project page.
            </p>
            <MyWorkScopeToggles scope={scope} />
          </div>
        )}
      </article>

      {/*
        The issues block appears only when it has something to say: either
        issues, or the fact that it could not be read. An empty issues panel
        under an already-empty deadline panel is two ways of saying nothing.
      */}
      {blocks.undated.length > 0 || blockHasUnreadableSource("undated") ? (
        <article className="module-section-surface">
          <h2 className="module-section-title">{BLOCK_HEADINGS.undated}</h2>
          <p className="module-note">{BLOCK_NOTES.undated}</p>
          {blocks.undated.length > 0 ? (
            <div className="module-record-list">
              {blocks.undated.map((item) => (
                <WorkItemRow key={`${item.sourceId}-${item.id}`} item={item} roster={roster} />
              ))}
            </div>
          ) : blockHasUnreadableSource("undated") ? (
            <p className="module-empty-state">
              Project issues could not be read, so this block is unavailable rather than empty.
            </p>
          ) : (
            <p className="module-empty-state">No open issue is on this list.</p>
          )}
        </article>
      ) : null}

      <article className="module-section-surface">
        <h2 className="module-section-title">{BLOCK_HEADINGS.blocked_projects}</h2>
        <p className="module-note">{BLOCK_NOTES.blocked_projects}</p>
        {blocks.blocked_projects.length > 0 ? (
          <div className="module-record-list">
            {blocks.blocked_projects.map((item) => (
              <WorkItemRow key={`${item.sourceId}-${item.id}`} item={item} roster={roster} />
            ))}
          </div>
        ) : blockHasUnreadableSource("blocked_projects") ? (
          <p className="module-empty-state">
            The stage-gate decision log could not be read. Whether any project is held is unknown
            — not that none is.
          </p>
        ) : (
          <p className="module-empty-state">
            No stage gate is currently held. A gate with no recorded decision is not a hold, and is
            not counted here.
          </p>
        )}
      </article>

      <article className="module-section-surface" data-testid="my-work-needs-review">
        <h2 className="module-section-title">{BLOCK_HEADINGS.needs_review}</h2>
        <p className="module-note">{BLOCK_NOTES.needs_review}</p>
        {blocks.needs_review.length > 0 ? (
          <div className="module-record-list">
            {blocks.needs_review.map((item) => (
              <WorkItemRow key={`${item.sourceId}-${item.id}`} item={item} roster={roster} />
            ))}
          </div>
        ) : null}
        {unreadableReviewLanes.length > 0 ? (
          <p className="module-empty-state" data-testid="my-work-needs-review-unreadable">
            {`${unreadableReviewLanes.join(" and ")} could not be read, so `}
            {blocks.needs_review.length > 0
              ? "this list is incomplete rather than complete."
              : "whether anything is waiting is unknown — not that nothing is."}
          </p>
        ) : blocks.needs_review.length === 0 ? (
          <p className="module-empty-state">
            Nothing is waiting on a person: no comment is pending moderation, no model run failed
            in the last {FAILED_RUN_QUEUE_WINDOW_DAYS} days, and no drafted narrative is awaiting a
            decision.
          </p>
        ) : null}
      </article>

      <article className="module-section-surface">
        <h2 className="module-section-title">{BLOCK_HEADINGS.workspace_deadlines}</h2>
        <p className="module-note">{BLOCK_NOTES.workspace_deadlines}</p>
        {blocks.workspace_deadlines.length > 0 ? (
          <div className="module-record-list">
            {blocks.workspace_deadlines.map((item) => (
              <WorkItemRow key={`${item.sourceId}-${item.id}`} item={item} roster={roster} />
            ))}
          </div>
        ) : blockHasUnreadableSource("workspace_deadlines") ? (
          <p className="module-empty-state">
            These deadlines could not be read, so this block is unavailable rather than empty.
          </p>
        ) : (
          <p className="module-empty-state">
            No grant decision, award obligation or invoice window has a date pending.
          </p>
        )}
      </article>
    </section>
  );
}
