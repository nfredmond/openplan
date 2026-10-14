/**
 * The planner's sentence for a feature this installation has not set up.
 *
 * Lives in `src/lib` so route helpers and page components say the same thing;
 * `SetupPendingNotice` renders it with the operator detail folded underneath.
 * A planner cannot apply a migration or set an environment variable, so the
 * sentence says what is off and who can turn it on, and nothing else.
 */
export const SETUP_PENDING_SENTENCE = "This part is not set up on this installation yet.";

/** The move a planner can make. */
export const SETUP_PENDING_ACTION = "Whoever runs this OpenPlan can turn it on.";

/**
 * The planner's line as one string. `consequence` is what this means for the
 * page in front of them, and where a count or list would otherwise look empty,
 * that empty here means unknown rather than none.
 */
export function setupPendingSentence(consequence?: string | null): string {
  return [SETUP_PENDING_SENTENCE, consequence, SETUP_PENDING_ACTION].filter(Boolean).join(" ");
}
