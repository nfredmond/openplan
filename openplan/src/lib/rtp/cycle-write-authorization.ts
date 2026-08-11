/**
 * One authorization gate for every route that WRITES inside an RTP cycle.
 *
 * Extracted from the horizon-bands route when the from-cycle-horizon scaffold
 * route became its second caller: a shared capability living inside one of two
 * callers gets reimplemented wrongly by the other (this repo's named seam
 * defect — a geofence enforced on one of two submission doors shipped exactly
 * that way). The gate's rules, unchanged from where it started:
 *
 * The workspace is never taken from the request. It is read from the caller's
 * own membership and then used to SCOPE the cycle lookup, so a cycle in
 * another workspace is not found rather than found-and-refused. That answers
 * 404 for both "no such cycle" and "someone else's cycle", which is
 * deliberate: a distinguishable 403 would confirm the existence of other
 * workspaces' cycles to anyone willing to iterate uuids.
 */
import { NextResponse } from "next/server";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";
import { classifyRouteReadFailure } from "@/lib/http/read-outcome";

// `PromiseLike`, not `Promise`: a PostgrestBuilder is thenable but not a
// Promise, and requiring the full Promise surface is the recurring TS2345 the
// repo has hit before when passing a real client into a structural type.
type SupabaseLike = {
  auth: { getUser: () => Promise<{ data: { user: { id: string } | null } }> };
  from: (table: string) => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: string
      ) => {
        eq: (
          column: string,
          value: string
        ) => {
          maybeSingle: () => PromiseLike<{ data: unknown; error: { message: string } | null }>;
        };
      };
    };
  };
};

type AuditLike = {
  error: (event: string, payload: Record<string, unknown>) => void;
};

export type RtpCycleWriteAuthorization =
  | { ok: false; response: NextResponse }
  | {
      ok: true;
      workspaceId: string;
      userId: string;
      /** The cycle row, projected with `cycleColumns` — already PROVEN to sit in the caller's workspace. */
      cycle: Record<string, unknown>;
    };

export async function authorizeRtpCycleWrite(
  supabase: SupabaseLike,
  audit: AuditLike,
  rtpCycleId: string,
  options?: {
    /**
     * Extra columns a caller needs off the proven cycle row (the scaffold
     * route reads the declared horizon). Defaults to the scoping pair alone.
     */
    cycleColumns?: string;
  }
): Promise<RtpCycleWriteAuthorization> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  let membershipResult;
  try {
    membershipResult = await loadCurrentWorkspaceMembership(supabase as never, user.id);
  } catch (error) {
    audit.error("membership_lookup_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      ok: false,
      response: NextResponse.json({ error: "Failed to resolve workspace membership" }, { status: 500 }),
    };
  }

  const membership = membershipResult.membership;
  if (!membership || !canAccessWorkspaceAction("plans.write", membership.role)) {
    return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  const cycleResult = await supabase
    .from("rtp_cycles")
    .select(options?.cycleColumns ?? "id, workspace_id")
    .eq("id", rtpCycleId)
    .eq("workspace_id", membership.workspace_id)
    .maybeSingle();

  // A failed read and an empty read are the same `null` here, and answering
  // "RTP cycle not found" to a query that never ran would send a planner
  // looking for a cycle that is sitting right there.
  const readFailure = classifyRouteReadFailure("the RTP cycle", cycleResult);
  if (readFailure) {
    audit.error("cycle_lookup_failed", { rtpCycleId, message: readFailure.message });
    return { ok: false, response: NextResponse.json(readFailure.body, { status: readFailure.status }) };
  }

  if (!cycleResult.data) {
    return { ok: false, response: NextResponse.json({ error: "RTP cycle not found" }, { status: 404 }) };
  }

  return {
    ok: true,
    workspaceId: membership.workspace_id,
    userId: user.id,
    cycle: cycleResult.data as Record<string, unknown>,
  };
}
