/**
 * Who finalized each application section, as the packaged PDF names them.
 *
 * The section stores the finalizer's user id. A funder-facing document prints
 * a person, never an id, and never an email address: an exported application
 * goes to a funder and may be published, so staff contact details stay out of
 * it (KI-2026-11-14-100). OpenPlan has no display-name field, so the document
 * names the finalizer by their workspace role ("Workspace owner",
 * "Workspace admin", "Workspace member"), read from the workspace roster
 * (`loadWorkspaceRoster`, service role behind its own caller membership
 * check). The roster is read without emails and no auth record is looked up.
 * The stored finalizer id and the audit trail are unchanged.
 *
 * PRIVACY. Only ids on THIS workspace's roster are named. An id that is not on
 * the roster (a member who left, or anyone else) prints
 * `FINALIZER_NOT_ON_RECORD`, so the document cannot reveal another
 * workspace's user.
 *
 * READ FAILURE IS NOT ABSENCE. A roster that could not be read prints
 * `FINALIZER_ROSTER_UNREAD`, not "not on record".
 */

import {
  loadWorkspaceRoster,
  WORKSPACE_ROSTER_LIMIT,
  type RosterServiceClient,
} from "@/lib/workspaces/roster";

const FINALIZER_NOT_ON_RECORD = "Not on record as a member of this workspace";
const FINALIZER_ROSTER_UNREAD = "Not named: the workspace roster could not be read when this package was assembled";
const FINALIZER_ROSTER_TRUNCATED = `Not named: the workspace roster read stops at ${WORKSPACE_ROSTER_LIMIT} members`;

/** The finalizer as the PDF prints them: their role in the workspace, in plain words. */
const ROLE_LABELS: Record<string, string> = {
  owner: "Workspace owner",
  admin: "Workspace admin",
  member: "Workspace member",
};

function finalizerRoleLabel(role: string): string {
  return ROLE_LABELS[role] ?? "Workspace member";
}

export type FinalizerNames = {
  /** False when the roster could not be read; every name is then `FINALIZER_ROSTER_UNREAD`. */
  rosterRead: boolean;
  nameFor: (userId: string) => string;
};

/**
 * Names for the given finalizer ids. Reads nothing when there are none.
 *
 * `service` is the SERVICE-ROLE client, typed `unknown` and cast here like the
 * other roster callers, because the clients are untyped by design.
 */
export async function loadFinalizerNames(
  service: unknown,
  callerId: string,
  workspaceId: string,
  finalizerIds: readonly string[]
): Promise<FinalizerNames> {
  const ids = [...new Set(finalizerIds.filter((id) => typeof id === "string" && id.length > 0))];
  if (ids.length === 0) return { rosterRead: true, nameFor: () => FINALIZER_NOT_ON_RECORD };

  const client = service as RosterServiceClient;
  let members: Array<{ userId: string; role: string }>;
  try {
    const roster = await loadWorkspaceRoster(client, callerId, workspaceId, { resolveEmails: false });
    if (!roster.ok) return { rosterRead: false, nameFor: () => FINALIZER_ROSTER_UNREAD };
    members = roster.members;
  } catch {
    return { rosterRead: false, nameFor: () => FINALIZER_ROSTER_UNREAD };
  }

  const roles = new Map(members.map((member) => [member.userId, member.role]));
  const rosterComplete = members.length < WORKSPACE_ROSTER_LIMIT;
  const names = new Map<string, string>();
  for (const id of ids) {
    const role = roles.get(id);
    names.set(
      id,
      role === undefined ? (rosterComplete ? FINALIZER_NOT_ON_RECORD : FINALIZER_ROSTER_TRUNCATED) : finalizerRoleLabel(role)
    );
  }
  return { rosterRead: true, nameFor: (userId) => names.get(userId) ?? FINALIZER_NOT_ON_RECORD };
}
