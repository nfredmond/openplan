import { StatusBadge } from "@/components/ui/status-badge";
import type { StatusTone } from "@/lib/ui/status";
import type { ProjectAssigneeRoster } from "@/lib/projects/assignee-roster";
import { DEPARTED_ASSIGNEE_SENTENCE, resolveAssignee } from "@/lib/workspaces/roster";

/**
 * How an assignee reads on a project surface — ONE implementation, shared by
 * the delivery board (deliverables, milestones, submittals) and the risk &
 * issue log (issues).
 *
 * WHY IT IS EXTRACTED RATHER THAN WRITTEN TWICE. This repository's recorded
 * defect class: "a shared capability that lives inside one of its two callers
 * will be reimplemented wrongly by the other." The wrong reimplementation here
 * is easy to write and hard to see — render `members.find(…)?.email` and an
 * unreadable roster silently prints every assigned record as unassigned, which
 * is a statement about the team rather than about the database.
 *
 * THREE STATES THIS DISTINGUISHES, WHICH ALL LOOK LIKE "NO NAME":
 *
 * - The roster could not be READ. Nothing is claimed about who is assigned; the
 *   chip says so. It must never fall through to `resolveAssignee`, because
 *   against an empty member list every assigned row resolves to `departed` —
 *   the product would tell a planner that their whole team had left.
 * - The COLUMN is pending (a deployment behind 20260811000006 returns rows with
 *   no such key at all). Per-row silence, with the panel disclosing it once —
 *   a chip on every row would be noise about an operator's migration.
 * - Nobody is assigned. Silence, correctly: `owner_label` renders on its own
 *   beside this and may well name whoever is on the hook.
 *
 * The assignee lane and the owner-label lane never merge. `resolveAssignee` is
 * deliberately called WITHOUT an owner label so it can never answer `external`
 * here: the label is rendered by the surfaces themselves, and a chip that
 * printed a consultant's name under "assignee" would be claiming a workspace
 * account that does not exist.
 */

export type { ProjectAssigneeRoster };

/** Shown instead of a name when the roster itself could not be read. */
export const ASSIGNEE_ROSTER_UNAVAILABLE_SENTENCE =
  "Assignee unavailable — the team roster could not be read";

/** Shown when a member's account carries no email address the app can show. */
export const ASSIGNEE_EMAIL_UNAVAILABLE_LABEL = "Member (email unavailable)";

export type RecordAssigneeDescription = {
  text: string;
  tone: StatusTone;
};

/**
 * What to render for one record's assignee, or null when the honest answer is
 * to render nothing at all.
 *
 * `assigneeUserId` is `undefined` when the projection did not carry the column
 * (pending migration) and `null` when it did and nobody is assigned. Those are
 * different facts and this function keeps them different.
 */
export function describeRecordAssignee(
  roster: ProjectAssigneeRoster,
  assigneeUserId: string | null | undefined
): RecordAssigneeDescription | null {
  if (assigneeUserId === undefined || assigneeUserId === null) return null;

  if (!roster.ok) {
    return { text: ASSIGNEE_ROSTER_UNAVAILABLE_SENTENCE, tone: "warning" };
  }

  const resolved = resolveAssignee(roster.members, { assigneeUserId });

  if (resolved.kind === "member") {
    return {
      text: resolved.member.email ?? ASSIGNEE_EMAIL_UNAVAILABLE_LABEL,
      tone: "info",
    };
  }

  if (resolved.kind === "departed") {
    // The shared sentence, not a stale name and not a blank. A departed
    // assignee counts as unassigned for work queues; on a record it still has
    // to say what happened, or the work looks owned.
    return { text: DEPARTED_ASSIGNEE_SENTENCE, tone: "warning" };
  }

  return null;
}

export function RecordAssigneeChip({
  roster,
  assigneeUserId,
}: {
  roster: ProjectAssigneeRoster;
  assigneeUserId: string | null | undefined;
}) {
  const described = describeRecordAssignee(roster, assigneeUserId);
  if (!described) return null;
  return <StatusBadge tone={described.tone}>{described.text}</StatusBadge>;
}
