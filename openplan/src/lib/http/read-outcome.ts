import { looksLikePendingSchema } from "@/lib/supabase/pending-schema";

/**
 * What a ROUTE could not read, turned into a status and a body — so it stops
 * answering a failed read with a successful-looking empty one.
 *
 * THE DEFECT THIS EXISTS FOR is the route-side half of the one
 * `lib/ui/read-failures.ts` covers for pages. `const { data } = await …` hands
 * back `null` for both "there is nothing here" and "this query failed", and a
 * route that then answers `{ items: data ?? [] }` with a 200 has told its caller
 * that the workspace has none of the thing. Every page rendering that response
 * repeats the claim. The read error is gone by then, so nothing downstream can
 * recover it — the 200 is the last place the truth existed.
 *
 * WHY NOT `lib/ui/read-failures.ts`. That module's contract is "render
 * everything that loaded and disclose the rest", which is a page's job: it
 * collects several failures across one render and produces a sentence a human
 * reads. A route has one answer to give and must give it as a STATUS. Today
 * exactly zero routes import `read-failures.ts`, and that boundary is worth
 * keeping — a route reaching for a page's collector is a sign it is about to
 * return 200 with a disclosure nobody checks.
 *
 * WHY IT DOES NOT LOG. Each route already owns an audit vocabulary through
 * `createApiAuditLogger`, and those codes are how an operator finds the failure
 * in host logs. A shared logger here would either flatten every route's code
 * into one generic string or duplicate the entry. So the caller keeps its own
 * audit call and uses `failure.message` — the database's own words — as the
 * detail:
 *
 *   const failure = classifyRouteReadFailure("reports", result);
 *   if (failure) {
 *     await audit.failure("reports_read_failed", failure.message);
 *     return NextResponse.json(failure.body, { status: failure.status });
 *   }
 *
 * TWO STATUSES, BECAUSE THEY MEAN DIFFERENT THINGS. A pending migration is
 * transient and the caller should come back — 503. Anything else is a failure
 * this deployment cannot describe, and telling a client to retry a permission
 * failure or a dropped connection forever is its own small lie — 500.
 */

/** Only the `error` half is read, but a whole supabase-js result must be accepted. */
export type RouteReadResultLike =
  | {
      error?: { message?: string | null } | null;
      data?: unknown;
    }
  | null
  | undefined;

export type RouteReadFailure = {
  status: 503 | 500;
  body: { error: string; hint?: string };
  /** True when the message classified as an unapplied migration. */
  pending: boolean;
  /** The database's own message, for the route's audit call. */
  message: string;
};

export type RouteReadFailureOptions = {
  /**
   * Replaces the default 503 wording. Use it when the module has a name a
   * planner would recognise — "Knowledge Base schema is not available yet"
   * reads better than the subject-derived default.
   */
  pendingError?: string;
  /**
   * Replaces the default 503 hint. Use it to name the exact migration when the
   * route knows which one is missing; several routes already do.
   */
  pendingHint?: string;
};

/**
 * The 500's hint, and the whole point of the module: a client that receives
 * this must not render it as "none". Kept verbatim from the wording the
 * Knowledge Base search route already ships, so the two surfaces agree.
 */
const NOT_AN_EMPTY_RESULT = "This is a read failure, not an empty result.";

/** Sentence case for the 503, which leads with the subject. "RTP" stays "RTP". */
function leadWith(subject: string): string {
  return subject.charAt(0).toUpperCase() + subject.slice(1);
}

/**
 * Classify a Supabase read result, or `null` when it carried no error.
 *
 * `subject` is the thing being read, in the words the route would use for it —
 * "reports", "funding awards", "the RTP cycle". It is rendered into both bodies,
 * so write it lowercase and in the number the route uses.
 *
 * A `null` or `undefined` result is treated as no failure, matching
 * `ReadFailureLog.check`: a read that produced no result object at all is not
 * something this function can describe, and inventing a 500 for it would report
 * a failure that may not have happened.
 */
export function classifyRouteReadFailure(
  subject: string,
  result: RouteReadResultLike,
  opts?: RouteReadFailureOptions
): RouteReadFailure | null {
  const error = result?.error;
  if (!error) return null;

  const raw = error.message;
  const message = typeof raw === "string" && raw.trim() ? raw.trim() : "no message reported";

  if (looksLikePendingSchema(message)) {
    return {
      status: 503,
      body: {
        error: opts?.pendingError ?? `${leadWith(subject)} schema is not available yet`,
        hint: opts?.pendingHint ?? "Apply the latest Supabase migrations, then try again.",
      },
      pending: true,
      message,
    };
  }

  return {
    status: 500,
    body: { error: `Failed to load ${subject}`, hint: NOT_AN_EMPTY_RESULT },
    pending: false,
    message,
  };
}
