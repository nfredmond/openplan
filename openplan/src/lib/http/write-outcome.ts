import { NextResponse } from "next/server";

/**
 * A write that changed nothing, reported honestly.
 *
 * THE DEFECT THIS EXISTS FOR. PostgREST has two ways of saying "your UPDATE or
 * DELETE matched no rows", and which one a route gets depends only on how the
 * query was spelled:
 *
 *   - `.single()`    → `data: null`, `error.code === "PGRST116"`
 *   - `.maybeSingle()` → `data: null`, `error: null`
 *
 * The same outcome, in two shapes, and neither is a server fault. But a route
 * that writes `if (error) return 500` collapses the first shape into "something
 * broke on the server", and a route that writes `if (error || !data) return 500`
 * collapses BOTH. `project_rtp_cycle_links` shipped exactly that: a restrictive
 * writer gate with no permissive UPDATE partner meant every update matched zero
 * rows, and the route answered 500 "Failed to update RTP link" — an
 * authorization outcome wearing a server error's clothes, with an audit code
 * pointing at result cardinality instead of at the missing policy.
 *
 * `write-policy-coverage-guard.test.ts` recorded the status question as
 * deliberately NOT asserted, because `PGRST116` appeared zero times in non-test
 * `src` and fixing that was "a separate change with its own blast radius".
 * This module is that change.
 *
 * WHAT ZERO ROWS ACTUALLY MEANS, and why one status does not fit.
 *
 * Postgres cannot tell a caller WHY a row did not match. `UPDATE … WHERE id = $1`
 * touching nothing is indistinguishable, from the outside, between "no such row",
 * "a row-level security policy hid it", and "a row-level security policy refused
 * the write". So the honest status depends on what the ROUTE already knows:
 *
 *   - `targetWasVerified: false` — the route wrote straight at an id from the
 *     request without first reading the row. Zero rows is then the ordinary
 *     answer to "does this exist and may you touch it", and the answer is 404.
 *     404 rather than 403 is deliberate: distinguishing them would confirm the
 *     existence of rows in other workspaces, which is the enumeration leak
 *     PR #25 closed.
 *
 *   - `targetWasVerified: true` — the route ALREADY read the row through the
 *     caller's own client and already passed the membership and role checks,
 *     and the write still matched nothing. The application believed the write
 *     was allowed and the database disagreed. That is a server-side defect,
 *     usually a missing permissive policy, and it is a 500 — but a 500 that
 *     SAYS SO, so the next person reads a sentence about policy instead of
 *     guessing at "Failed to update".
 *
 * INSERT responses are different: an empty response does not prove creation.
 * PostgREST singular-response errors can roll back the request, and an INSERT
 * requesting a representation must satisfy SELECT policy too. An absent returned
 * row must not be promoted to "created". Use unconfirmedInsertResponse when this
 * route lacks a retained row or another independent commit receipt.
 */

/** Singular-response error code; details must distinguish zero from multiple rows. */
export const POSTGREST_NO_ROWS_MATCHED = "PGRST116";

/** The shape both supabase-js and its typed wrappers hand back. */
export type PostgrestLikeError = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
} | null;

export type WriteResultLike<T> = {
  data: T | null | undefined;
  error: PostgrestLikeError;
};

/**
 * Whether this error is PostgREST reporting zero matched rows rather than a
 * failure. Nothing else in the PGRST1xx family means this, so the code is
 * matched exactly rather than by prefix, with explicit zero-row details. A
 * missing or different cardinality remains an error, not an inferred zero.
 */
export function isNoRowsMatchedError(error: PostgrestLikeError): boolean {
  return error?.code === POSTGREST_NO_ROWS_MATCHED &&
    /^The result contains 0 rows\.?$/.test(error.details ?? "");
}

/**
 * Whether a write reported that it changed nothing, by EITHER mechanism.
 *
 * Written to take the whole result rather than the error alone, because
 * `.maybeSingle()` carries the same news in `data` and a helper that only looked
 * at `error` would keep half the defect alive.
 */
export function writeMatchedNoRows<T>(result: WriteResultLike<T>): boolean {
  if (isNoRowsMatchedError(result.error)) return true;
  return !result.error && (result.data === null || result.data === undefined);
}

/**
 * Whether this error is a real failure — something other than "matched no rows".
 *
 * The guard rail for the common branch: `if (isWriteFailure(error)) return 500`
 * keeps a genuine database error loud while letting zero rows fall through to
 * the deliberate answer below.
 */
export function isWriteFailure(error: PostgrestLikeError): boolean {
  return Boolean(error) && !isNoRowsMatchedError(error);
}

export type NoRowsMatchedOptions = {
  /**
   * The thing the caller was trying to change, in the words the caller used for
   * it — "project", "invoice line", "RTP link". It appears in the message, so
   * write it lowercase and singular.
   */
  subject: string;
  /**
   * True when this route already read the target row through the CALLER's
   * client before writing. See the module comment: it is the difference between
   * a 404 and a disclosed 500, and getting it wrong either hides a policy defect
   * or invents a missing record.
   */
  targetWasVerified: boolean;
};

/** The status a zero-row write deserves, given what the route already knew. */
export function noRowsMatchedStatus(options: NoRowsMatchedOptions): 404 | 500 {
  return options.targetWasVerified ? 500 : 404;
}

/**
 * The body for a zero-row write. Split out from the response so a route that
 * already builds its own envelope can reuse the wording without inheriting
 * `NextResponse`.
 */
export function noRowsMatchedBody(options: NoRowsMatchedOptions): {
  error: string;
  details: string;
} {
  if (options.targetWasVerified) {
    return {
      error: `The ${options.subject} was not saved`,
      details:
        `The database matched no rows for this ${options.subject}, so nothing was saved. ` +
        "This request passed every check the application makes, so the write was refused " +
        "below the application — most often a row-level security policy that grants no " +
        "permissive write — or the row was deleted while this request was in flight.",
    };
  }

  return {
    error: `No such ${options.subject}`,
    details:
      `No ${options.subject} you can change matched this request, so nothing was saved. ` +
      "It may not exist, or it may belong to a workspace you are not a member of.",
  };
}

/**
 * The response for a write that matched no rows.
 *
 * Deliberately NOT silent about which case it is: the two bodies read
 * differently on purpose, because a planner seeing "no such invoice" should go
 * looking for the invoice, and an operator seeing the other one should go
 * looking at the policies.
 */
export function noRowsMatchedResponse(options: NoRowsMatchedOptions): NextResponse {
  return NextResponse.json(noRowsMatchedBody(options), {
    status: noRowsMatchedStatus(options),
  });
}

/**
 * An INSERT without a confirmed result. This is not proof of either creation
 * or absence; callers must check retained state before deciding whether to retry.
 */
export function unconfirmedInsertResponse(options: { subject: string }): NextResponse {
  return NextResponse.json(
    {
      error: `Could not confirm creation of the ${options.subject}`,
      details:
        "The database did not return a confirmed result. Check the saved state before retrying; " +
        "this response does not establish that a new item was created.",
    },
    { status: 500 },
  );
}
