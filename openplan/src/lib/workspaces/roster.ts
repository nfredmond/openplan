/**
 * The workspace roster — the ONE way the product reads "who is on this team"
 * for identity purposes (assignees, teammate links, pickers).
 *
 * WHY THE SERVICE ROLE, AND WHY THE EXPLICIT MEMBERSHIP CHECK. The only SELECT
 * policy on `workspace_members` is `members_read_own` (`user_id = auth.uid()`,
 * migration 20260316000024, which replaced a recursive policy). An RLS roster
 * read therefore returns exactly ONE row — the caller — and any feature built
 * on it silently believes the caller is the whole team. That is not a
 * hypothetical: `/api/invoicing/staff` validated teammate links through the
 * RLS client and so answered 400 for every teammate except the caller
 * themselves, making `invoicing_staff.user_id` unreachable for its purpose.
 *
 * So the roster is read with the SERVICE ROLE — and because the service role
 * ignores RLS entirely, the authorization has to live here instead: the read
 * proceeds only after this module has itself confirmed the CALLER is a member
 * of the workspace being read. Callers pass the service client and the caller
 * id; they never get a roster for a workspace the caller is not in.
 *
 * READ-FAILURE ≠ EMPTY. A failed membership check or roster read comes back as
 * an explicit `ok: false` with a named reason, never as an empty member list —
 * an empty list means "verified: this caller may look, and the team is what
 * you see", and this module refuses to say that when it does not know it.
 */

/** The departed-member sentence, shared so every surface says the same thing. */
export const DEPARTED_ASSIGNEE_SENTENCE = "Unassigned — previously a member";

export const WORKSPACE_ROSTER_LIMIT = 200;

export type RosterMember = {
  userId: string;
  /**
   * Null when the auth lookup failed for this member, or when the caller asked
   * for the roster without emails (`resolveEmails: false`) — never a claim
   * that the member has no email address.
   */
  email: string | null;
  role: string;
};

export type WorkspaceRosterFailureReason =
  | "caller_not_member"
  | "membership_check_failed"
  | "roster_read_failed";

export type WorkspaceRosterResult =
  | { ok: true; members: RosterMember[] }
  | { ok: false; reason: WorkspaceRosterFailureReason; message: string | null };

/**
 * The slice of the service-role supabase-js client this module uses.
 * Structural, like every per-domain access module in this repo
 * (`src/lib/document-library/query.ts` convention): the client is untyped by
 * design and results are cast.
 */
type RosterReadResult = {
  data: unknown;
  error: { message?: string | null } | null;
};

type RosterQuery = {
  eq(column: string, value: string): RosterQuery;
  maybeSingle(): PromiseLike<RosterReadResult>;
  order(column: string, options: { ascending: boolean }): RosterQuery;
  limit(count: number): PromiseLike<RosterReadResult>;
};

export type RosterServiceClient = {
  from(table: string): { select(columns: string): RosterQuery };
  auth: {
    admin: {
      getUserById(id: string): Promise<{ data: { user: { email?: string | null } | null } }>;
    };
  };
};

export type LoadWorkspaceRosterOptions = {
  /**
   * Emails come from `auth.users` via the service-role auth admin API — one
   * lookup per member. Callers that only need membership (e.g. validating a
   * teammate link) pass `false` and get `email: null` throughout.
   */
  resolveEmails?: boolean;
};

export async function loadWorkspaceRoster(
  service: RosterServiceClient,
  callerId: string,
  workspaceId: string,
  options: LoadWorkspaceRosterOptions = {}
): Promise<WorkspaceRosterResult> {
  const resolveEmails = options.resolveEmails ?? true;

  // The caller's membership is the authorization for this whole read. The
  // service role does not enforce it, so this module must — before any row of
  // anyone else's is touched.
  const { data: callerRow, error: callerError } = await service
    .from("workspace_members")
    .select("user_id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", callerId)
    .maybeSingle();

  if (callerError) {
    return {
      ok: false,
      reason: "membership_check_failed",
      message: callerError.message ?? null,
    };
  }
  if (!callerRow) {
    return { ok: false, reason: "caller_not_member", message: null };
  }

  const { data: rows, error: rosterError } = await service
    .from("workspace_members")
    .select("user_id, role")
    .eq("workspace_id", workspaceId)
    .order("joined_at", { ascending: true })
    .limit(WORKSPACE_ROSTER_LIMIT);

  if (rosterError) {
    // Never degrade a failed read into an empty team.
    return { ok: false, reason: "roster_read_failed", message: rosterError.message ?? null };
  }

  const memberRows = (rows ?? []) as Array<{ user_id: string; role: string }>;

  const members: RosterMember[] = await Promise.all(
    memberRows.map(async (row) => {
      let email: string | null = null;
      if (resolveEmails) {
        // A failed auth lookup yields a null email rather than failing the
        // roster — the members-route precedent.
        try {
          const lookup = await service.auth.admin.getUserById(row.user_id);
          email = lookup.data.user?.email ?? null;
        } catch {
          email = null;
        }
      }
      return { userId: row.user_id, email, role: row.role };
    })
  );

  return { ok: true, members };
}

/** True when `userId` appears on the roster. */
export function isOnRoster(members: readonly RosterMember[], userId: string): boolean {
  return members.some((member) => member.userId === userId);
}

/**
 * How an assignee renders, resolved against the roster.
 *
 * - `member` — the assignee is on the roster; render their identity.
 * - `departed` — an assignee id is recorded but that person is no longer a
 *   member. Render {@link DEPARTED_ASSIGNEE_SENTENCE}, never a stale name and
 *   never a blank; it counts as unassigned for work queues.
 * - `external` — no assignee id, but an owner label names an outside party
 *   (the free-text lane that predates assignees, and stays for consultants and
 *   partner agencies).
 * - `unassigned` — nobody, by any lane.
 */
export type ResolvedAssignee =
  | { kind: "member"; member: RosterMember }
  | { kind: "departed"; userId: string; sentence: string }
  | { kind: "external"; label: string }
  | { kind: "unassigned" };

export type AssigneeRef = {
  assigneeUserId?: string | null;
  ownerLabel?: string | null;
};

export function resolveAssignee(
  members: readonly RosterMember[],
  ref: AssigneeRef
): ResolvedAssignee {
  const assigneeUserId = ref.assigneeUserId ?? null;
  if (assigneeUserId) {
    const member = members.find((candidate) => candidate.userId === assigneeUserId);
    if (member) return { kind: "member", member };
    return { kind: "departed", userId: assigneeUserId, sentence: DEPARTED_ASSIGNEE_SENTENCE };
  }

  const label = ref.ownerLabel?.trim();
  if (label) return { kind: "external", label };

  return { kind: "unassigned" };
}

/**
 * A departed assignee is nobody's to-do list: for queues, counts, and the
 * unassigned scope it is treated exactly like no assignee at all.
 */
export function assigneeCountsAsUnassigned(resolved: ResolvedAssignee): boolean {
  return resolved.kind === "unassigned" || resolved.kind === "departed";
}
