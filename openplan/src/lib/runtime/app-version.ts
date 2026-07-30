import packageJson from "../../../package.json";

/**
 * WHICH OPENPLAN THIS IS.
 *
 * WHY A DEPLOYMENT HAS TO BE ABLE TO NAME ITSELF. OpenPlan is self-hosted: every
 * agency runs its own copy, updated whenever they choose to update it. The
 * moment there is more than one instance in the world, every operational
 * question becomes unanswerable without this — an agency reports a bug and
 * nobody knows what they are running; a fix ships and nobody can tell whether
 * their instance has it; a planner asks what changed since last month and the
 * honest answer is that we cannot say.
 *
 * The version sat at 0.1.0 for 1,875 commits because nothing read it. A number
 * nothing displays is decoration, and decoration drifts.
 *
 * THE VERSION IS READ FROM `package.json`, NEVER RESTATED. A second copy is a
 * second thing to forget, and the failure mode is the worst kind: an instance
 * confidently reporting a version it is not running.
 */
export const APP_VERSION: string = packageJson.version;

/**
 * The exact commit this instance was built from, when the build environment
 * says so.
 *
 * A version alone is not enough for a self-hosted product, because an agency
 * deploying from a fork — which `FIRST_DEPLOYMENT.md` tells them to make — can
 * be several commits past the last version bump, or carrying local changes. The
 * commit is what makes "what exactly is running" answerable.
 *
 * Vercel sets `VERCEL_GIT_COMMIT_SHA` on every build. Other hosts do not, so
 * `OPENPLAN_COMMIT_SHA` is offered for a build script to set. When neither is
 * present this is NULL and the surface says the commit is unrecorded — it does
 * not invent one, and it does not fall back to a value that would be wrong.
 */
export function appCommitSha(): string | null {
  // Read at CALL time, not at module load. A module-level constant captures
  // whatever `process.env` held the first time this file was imported, which in
  // a server runtime is not reliably after the environment is populated — and
  // once captured it is wrong for the life of the process, silently. The cost
  // of reading twice is nothing; the cost of reporting a commit from a stale
  // snapshot is an instance that misidentifies itself.
  return process.env.VERCEL_GIT_COMMIT_SHA?.trim() || process.env.OPENPLAN_COMMIT_SHA?.trim() || null;
}

/** The first 7 characters, which is how a commit is named in conversation. */
export function shortCommitSha(sha: string | null = appCommitSha()): string | null {
  const trimmed = sha?.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 7);
}

export type BuildIdentity = {
  version: string;
  /** Null when the build environment recorded no commit. */
  commit: string | null;
  shortCommit: string | null;
  /**
   * One line a person can paste into a bug report.
   *
   * Says "commit unrecorded" rather than omitting it, because a reader who sees
   * only a version cannot tell whether the commit was unknown or whether this
   * surface simply forgot to show it.
   */
  label: string;
};

export function buildIdentity(): BuildIdentity {
  const commit = appCommitSha();
  const short = shortCommitSha(commit);
  return {
    version: APP_VERSION,
    commit,
    shortCommit: short,
    label: short ? `OpenPlan ${APP_VERSION} · ${short}` : `OpenPlan ${APP_VERSION} · commit unrecorded`,
  };
}
