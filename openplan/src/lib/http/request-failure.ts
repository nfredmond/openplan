/**
 * What to tell a planner when a request did not come back.
 *
 * WHERE THIS CAME FROM. A tester pressed Run on Corridor Analysis and was shown
 * the words **"Failed to fetch"**, with nothing else — no idea whether to retry,
 * wait, or call somebody. That string is not ours. When `fetch()` cannot reach
 * the server at all the browser throws a `TypeError` whose `.message` is its own
 * internal wording, and every one of these call sites was doing
 * `error instanceof Error ? error.message : fallback`, which hands that wording
 * straight to the screen. Chrome says "Failed to fetch", Firefox says
 * "NetworkError when attempting to fetch resource", Safari says "Load failed" —
 * so the sentence a planner reads depended on their browser.
 *
 * THE DISTINCTION THAT MATTERS, and why this is not just nicer copy:
 *
 *   - A request that never arrived says NOTHING about the work. Nothing was
 *     started, nothing was saved, and trying again is safe. That is worth
 *     telling someone who has just filled in a form.
 *   - A refusal FROM the server is a real answer, in our own words, and must
 *     survive untouched. Replacing "This workspace has no home geography" with a
 *     connection sentence would be the more soothing message and the wrong one.
 *
 * So this translates ONLY the browser's own network failure and passes
 * everything else through unchanged.
 */

/**
 * The browser's wording for "the request never reached anything", across the
 * engines OpenPlan runs in. Matched rather than compared, because each engine
 * spells it differently and none of them is a stable API.
 */
const NETWORK_FAILURE_WORDINGS =
  /failed to fetch|networkerror|network error|load failed|connection (refused|reset|closed)|err_(connection|network|internet)/i;

/**
 * True when this is the browser saying it could not reach the server, rather
 * than the server saying something.
 */
export function isNetworkFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  // A `fetch` network failure is specifically a TypeError. Checking the wording
  // alone would also catch a server that happened to use one of these phrases in
  // a real answer, which is the one thing this must not swallow.
  return error.name === "TypeError" && NETWORK_FAILURE_WORDINGS.test(error.message);
}

/**
 * The sentence to show for a failed request.
 *
 * `action` names what the planner was doing, in their words — "run the
 * analysis", "create the workspace" — so the message can say what did not
 * happen. It is never interpolated into anything the server said.
 */
export function describeRequestFailure(error: unknown, action: string): string {
  if (isNetworkFailure(error)) {
    return `OpenPlan could not reach the server to ${action}. Nothing was started and nothing was saved, so it is safe to try again. If it keeps happening, check your connection — and if you are running OpenPlan on this computer, check that it is still running.`;
  }
  if (error instanceof Error && error.message.trim().length > 0) {
    // The server's own answer, unchanged. It knows things this function does not.
    return error.message;
  }
  return `Could not ${action}. No reason was given.`;
}
