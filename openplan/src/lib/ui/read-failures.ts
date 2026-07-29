/**
 * What a page could not read, so it stops presenting the gap as a finding.
 *
 * THE DEFECT THIS EXISTS FOR. A server component that destructures only `data`
 * from a Supabase read gets `null` for both "there is nothing here" and "this
 * query failed". Every list then renders empty, every count renders 0, and the
 * empty-state copy — written for the first case — states the second one as
 * fact: "No explicit links yet. Use the Links tab to attach…". A permission
 * failure, a dropped column, a policy that hides the row, all arrive on screen
 * as a confident sentence about the world.
 *
 * The model detail page had five of these at once. Its `model_links` read fed
 * the linkage counts, the readiness checks and the linked-records board, so a
 * single 400 turned the whole page into a claim that the planner had linked
 * nothing.
 *
 * WHY A COLLECTOR RATHER THAN A THROW. Most of these reads are not load-bearing:
 * one failing does not mean the page is worthless, and a page that 500s because
 * a side panel could not load is worse than one that renders and says so. So the
 * rule this encodes is narrower than "handle errors" — it is:
 *
 *   a read that failed may not be rendered as an answer.
 *
 * Collect the failures, render everything that did load, and disclose the rest
 * by name so the reader knows which parts of the page to disbelieve.
 *
 * WHAT THIS IS NOT FOR. A read whose failure is already CLASSIFIED — a pending
 * migration, a column this deployment does not have yet — has a truer thing to
 * say than "could not be read", and those already have their own handling
 * (`looksLikePendingSchema` and friends). Classify first; collect what is left.
 */

export type ReadFailure = {
  /**
   * What could not be read, in the planner's words and in the plural the page
   * uses for it: "linked plans", "scenario options", "county screening runs".
   * It is rendered in a sentence, so no leading capital and no trailing period.
   */
  label: string;
  /** The database's own message, shown so an operator can act on it. */
  message: string;
};

/**
 * Only the `error` half is named, because that is all this reads — but `data`
 * has to be tolerated, since every caller passes a whole supabase-js result and
 * an exact object type would reject the literal.
 */
export type ReadResultLike =
  | {
      error?: { message?: string | null } | null;
      data?: unknown;
    }
  | null
  | undefined;

/**
 * Collects the reads that failed on one page render.
 *
 * Deliberately mutable and deliberately local to a render: this is not state,
 * it is a note-to-self taken while loading, read once at the end.
 */
export class ReadFailureLog {
  private readonly failures: ReadFailure[] = [];

  /**
   * Record `result` as failed if it carries an error.
   *
   * Returns whether it failed, so a caller can branch on the same call rather
   * than testing the error twice:
   *
   *   const linksFailed = reads.check("linked records", linksResult);
   */
  check(label: string, result: ReadResultLike): boolean {
    const message = result?.error?.message;
    if (!result?.error) return false;

    this.failures.push({
      label,
      message: typeof message === "string" && message.trim() ? message.trim() : "no message reported",
    });
    return true;
  }

  get any(): boolean {
    return this.failures.length > 0;
  }

  get all(): ReadonlyArray<ReadFailure> {
    return this.failures;
  }

  /**
   * The disclosure sentence, or null when everything loaded.
   *
   * Says which parts failed and — the point of the whole module — that the
   * empty results elsewhere on the page are not findings.
   */
  describe(): string | null {
    if (this.failures.length === 0) return null;

    const labels = this.failures.map((failure) => failure.label);
    const listed =
      labels.length === 1
        ? labels[0]
        : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;

    return (
      `This page could not read ${listed}. ` +
      "Anything below that depends on it is shown as unavailable rather than as zero — an empty " +
      "list here would not mean the records are absent."
    );
  }

  /** The database messages, for the operator-facing detail line. */
  messages(): string[] {
    return this.failures.map((failure) => `${failure.label}: ${failure.message}`);
  }
}
