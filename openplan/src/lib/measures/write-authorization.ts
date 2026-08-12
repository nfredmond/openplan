import { NextResponse } from "next/server";
import { canAccessWorkspaceAction, type WorkspaceAction } from "@/lib/auth/role-matrix";
import { classifyRouteReadFailure } from "@/lib/http/read-outcome";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";
import { MEASURE_FUND_COLUMNS } from "@/lib/measures/fund";

/**
 * ONE authorization gate for every route that writes inside a measure fund.
 *
 * Extracted before it had a second caller rather than after, because this repo
 * has a named defect for the other order: a shared capability living inside one
 * of its two callers gets reimplemented wrongly by the other, and a geofence
 * enforced on one of two submission doors shipped exactly that way. Eight
 * routes in this lane need the same three facts — who you are, which workspace,
 * and does this measure sit in it — and they must not answer them eight times.
 *
 * THE WORKSPACE IS NEVER TAKEN FROM THE REQUEST. It comes from the caller's own
 * membership and then SCOPES the fund lookup, so a measure in another workspace
 * is not found rather than found-and-refused. Both answer 404, deliberately: a
 * distinguishable 403 would confirm the existence of other workspaces' funds to
 * anyone willing to iterate uuids (the enumeration leak PR #25 closed).
 *
 * ============================================================================
 * TWO GATES, BECAUSE TWO DIFFERENT THINGS HAPPEN HERE
 * ============================================================================
 *
 * `programs.write` (owner/admin/member) governs the RECORD: opening a period,
 * recording a receipt, adding a recipient, drafting and submitting a claim.
 * These are the clerical acts of running a fund, and a member does them.
 *
 * `invoices.write` (owner/ADMIN ONLY) governs a DECISION on a claim —
 * approving, denying, or marking paid. That is money leaving a public fund, and
 * it is the same authority the product already uses for the other direction of
 * this seam, where `invoices.write` gates the claims an agency makes on its own
 * funder. Reusing it rather than inventing a `measures.decide` action is
 * deliberate: the role matrix should answer "who may move money" once, and a
 * ninth near-synonym is how two surfaces end up gated differently.
 *
 * The stricter gate is passed in by the route rather than inferred here, so the
 * choice is visible at the call site and `measure-claim-routes.test.ts` can
 * assert that a member is refused the decision and allowed the draft.
 */

// `PromiseLike`, not `Promise`: a PostgrestBuilder is thenable but not a
// Promise, and demanding the full Promise surface is the recurring TS2345 this
// repo hits when passing a real client into a structural type.
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
  warn: (event: string, payload: Record<string, unknown>) => void;
};

export type MeasureFundRow = {
  id: string;
  workspace_id: string;
  program_id: string;
  currency_code?: string | null;
  receipt_cadence?: string | null;
  public_share_enabled?: boolean | null;
};

export type MeasureWriteAuthorization =
  | { ok: false; response: NextResponse }
  | {
      ok: true;
      workspaceId: string;
      userId: string;
      role: string;
      /** Already PROVEN to sit in the caller's workspace. */
      fund: MeasureFundRow;
    };

export async function authorizeMeasureWrite(
  supabase: SupabaseLike,
  audit: AuditLike,
  measureId: string,
  options?: {
    /**
     * Defaults to `programs.write`. Pass `invoices.write` for anything that
     * decides a claim — see the module header.
     */
    action?: WorkspaceAction;
    /** What the caller is trying to do, for the 403 body. */
    intent?: string;
  }
): Promise<MeasureWriteAuthorization> {
  const action: WorkspaceAction = options?.action ?? "programs.write";

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
  if (!membership || !canAccessWorkspaceAction(action, membership.role)) {
    audit.warn("forbidden", { action, role: membership?.role ?? null });
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "Forbidden",
          details:
            action === "invoices.write"
              ? `Deciding a claim moves money out of a public fund, so it needs an owner or admin. ` +
                `${options?.intent ? `${options.intent} was not saved.` : "Nothing was saved."}`
              : "You do not have permission to change this measure fund.",
        },
        { status: 403 }
      ),
    };
  }

  const fundResult = await supabase
    .from("measure_funds")
    .select(MEASURE_FUND_COLUMNS)
    .eq("id", measureId)
    .eq("workspace_id", membership.workspace_id)
    .maybeSingle();

  // A failed read and an empty read are both `null` here, and answering
  // "measure not found" to a query that never ran would send an administrator
  // looking for a fund that is sitting right there.
  const readFailure = classifyRouteReadFailure("the measure fund", fundResult);
  if (readFailure) {
    audit.error("measure_lookup_failed", { measureId, message: readFailure.message });
    return { ok: false, response: NextResponse.json(readFailure.body, { status: readFailure.status }) };
  }

  if (!fundResult.data) {
    return { ok: false, response: NextResponse.json({ error: "Measure fund not found" }, { status: 404 }) };
  }

  return {
    ok: true,
    workspaceId: membership.workspace_id,
    userId: user.id,
    role: membership.role,
    fund: fundResult.data as MeasureFundRow,
  };
}
