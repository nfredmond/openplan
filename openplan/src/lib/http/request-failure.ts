/**
 * What to tell a planner when a request did not come back.
 *
 * WHERE THIS CAME FROM. A tester pressed Run on Corridor Analysis and was shown
 * the words **"Failed to fetch"**, with nothing else — no idea whether to retry,
 * wait, or call somebody. That string is not ours. When `fetch()` cannot obtain
 * a response the browser throws a `TypeError` whose `.message` is its own
 * internal wording, and every one of these call sites was doing
 * `error instanceof Error ? error.message : fallback`, which hands that wording
 * straight to the screen. Chrome says "Failed to fetch", Firefox says
 * "NetworkError when attempting to fetch resource", Safari says "Load failed",
 * so the sentence a planner reads depended on their browser.
 *
 * THE DISTINCTION THAT MATTERS, and why this is not just nicer copy:
 *
 *   - A lost response does not establish whether the server received the
 *     request or saved its work. During hosted relaunch on October 10, 2026,
 *     the browser reported a network failure while the server completed and
 *     saved an analysis. Check saved records before retrying a write.
 *   - A refusal FROM the server is a real answer, in our own words, and must
 *     survive untouched. Replacing "This workspace has no home geography" with a
 *     connection sentence would be the more soothing message and the wrong one.
 *
 * So this translates ONLY the browser's own network failure and passes
 * everything else through unchanged.
 */

/**
 * The browser's wording for a request without a usable response, across the
 * engines OpenPlan runs in. Matched rather than compared, because each engine
 * spells it differently and none of them is a stable API.
 */
const NETWORK_FAILURE_WORDINGS =
  /failed to fetch|networkerror|network error|load failed|connection (refused|reset|closed)|err_(connection|network|internet)/i;

/**
 * True when this is the browser reporting a transport failure, rather
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
 * analysis", "create the workspace", so the message can identify the action
 * whose outcome is unknown. It is never interpolated into a server answer.
 */
export function describeRequestFailure(error: unknown, action: string): string {
  if (isNetworkFailure(error)) {
    return `OpenPlan did not receive a response while trying to ${action}. The action may have completed and saved changes. Check the saved records before trying again. If the problem continues, check your connection and whether this OpenPlan installation is running.`;
  }
  if (error instanceof Error && error.message.trim().length > 0) {
    // The server's own answer, unchanged. It knows things this function does not.
    return error.message;
  }
  return `Could not ${action}. No reason was given.`;
}
