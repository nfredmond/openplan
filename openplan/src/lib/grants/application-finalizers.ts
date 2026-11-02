/**
 * Who finalized each application section, as the packaged PDF names them.
 *
 * The section stores the finalizer's user id. A funder-facing document prints
 * a person, never an id. OpenPlan has no display-name field, so the product's
 * people rule is the email address of a workspace member, read from the
 * workspace roster (`loadWorkspaceRoster`, service role behind its own caller
 * membership check).
 *
 * PRIVACY. Only ids on THIS workspace's roster are looked up. An id that is not
 * on the roster (a member who left, or anyone else) is never sent to the auth
 * lookup, so the document cannot reveal another workspace's user. It prints
 * `FINALIZER_NOT_ON_RECORD` instead.
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
const FINALIZER_EMAIL_NOT_RECORDED = "Workspace member; email not on record";
const FINALIZER_ROSTER_UNREAD = "Not named: the workspace roster could not be read when this package was assembled";
const FINALIZER_ROSTER_TRUNCATED = `Not named: the workspace roster read stops at ${WORKSPACE_ROSTER_LIMIT} members`;

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
  let members: Array<{ userId: string }>;
  try {
    const roster = await loadWorkspaceRoster(client, callerId, workspaceId, { resolveEmails: false });
    if (!roster.ok) return { rosterRead: false, nameFor: () => FINALIZER_ROSTER_UNREAD };
    members = roster.members;
  } catch {
    return { rosterRead: false, nameFor: () => FINALIZER_ROSTER_UNREAD };
  }

  const onRoster = new Set(members.map((member) => member.userId));
  const rosterComplete = members.length < WORKSPACE_ROSTER_LIMIT;
  const names = new Map<string, string>();
  await Promise.all(
    ids.map(async (id) => {
      if (!onRoster.has(id)) {
        names.set(id, rosterComplete ? FINALIZER_NOT_ON_RECORD : FINALIZER_ROSTER_TRUNCATED);
        return;
      }
      try {
        const lookup = await client.auth.admin.getUserById(id);
        const email = lookup.data.user?.email?.trim();
        names.set(id, email || FINALIZER_EMAIL_NOT_RECORDED);
      } catch {
        names.set(id, FINALIZER_EMAIL_NOT_RECORDED);
      }
    })
  );
  return { rosterRead: true, nameFor: (userId) => names.get(userId) ?? FINALIZER_NOT_ON_RECORD };
}
