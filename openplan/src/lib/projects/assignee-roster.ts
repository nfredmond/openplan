/**
 * The roster a project surface needs in order to turn an assignee id into a
 * person — loaded once per page, in the one shape the panels render from.
 *
 * WHY THIS IS A LIBRARY AND NOT FOUR LINES IN THE PAGE. Two things have to
 * travel together and are easy to separate by accident: the roster ITSELF, and
 * the fact that reading it FAILED. A loader that returned members only would
 * hand an empty list to a caller on failure, and `resolveAssignee` against an
 * empty list answers `departed` for every assigned record — the product would
 * tell a planner their entire team had left because a query broke. So a failure
 * comes back as `{ ok: false }` with no member list at all, and the failure is
 * registered on the caller's `ReadFailureLog` — the same seam the project
 * page's other lane loaders use, so the label belongs here, with the module
 * that knows what it read, rather than at a call site that would drift from it.
 *
 * The read itself is `loadWorkspaceRoster`: service role, behind that helper's
 * own caller-membership check, because `members_read_own` makes an RLS roster
 * read return exactly one row.
 */

import {
  loadWorkspaceRoster,
  type RosterMember,
  type RosterServiceClient,
} from "@/lib/workspaces/roster";

/** The slice of `ReadFailureLog` this loader needs. */
type ReadFailureSink = {
  check(label: string, result: { error?: { message?: string | null } | null }): boolean;
};

export type ProjectAssigneeRoster =
  | { ok: true; members: readonly RosterMember[] }
  /** Read failed. Deliberately carries no member list — see the header. */
  | { ok: false };

/** Plural, lower-case, no trailing period: it is rendered inside a sentence. */
const ASSIGNEE_ROSTER_READ_LABEL = "this workspace's team roster";

export async function loadProjectAssigneeRoster(
  /**
   * The SERVICE-ROLE client. Typed `unknown` and cast here, following
   * `requireWorkspaceWriteAccess`: the clients are untyped by design in this
   * repo and passing the concrete one into a structural slice trips TS2589 at
   * every call site.
   */
  service: unknown,
  callerId: string,
  workspaceId: string,
  reads: ReadFailureSink
): Promise<ProjectAssigneeRoster> {
  const result = await loadWorkspaceRoster(service as RosterServiceClient, callerId, workspaceId);

  if (!result.ok) {
    reads.check(ASSIGNEE_ROSTER_READ_LABEL, {
      error: { message: result.message ?? result.reason },
    });
    return { ok: false };
  }

  return { ok: true, members: result.members };
}
