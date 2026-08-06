/**
 * WHICH ENVIRONMENT VARIABLES ARE THE OPERATOR'S TO SET — one answer, shared.
 *
 * Two guards ask this question from opposite directions:
 *
 *   `docs-mechanical-cross-references.test.ts` — every env var THE DOCS NAME
 *   must appear in `.env.example` (catches a doc describing a setting that was
 *   renamed or deleted).
 *
 *   `every-operator-setting-is-discoverable.test.ts` — every env var THE CODE
 *   READS must appear in `.env.example` (catches a setting added and written
 *   down nowhere, which is the commoner and quieter failure).
 *
 * They must not disagree about what counts, and on 2026-08-06 they did. The
 * exclusion list lived inside the first guard as a private constant; the second
 * was written without knowing it existed, so it demanded `.env.example` document
 * `OPENPLAN_COMMIT_SHA` — which the first guard's ratchet then failed for being
 * present. One gate, red, with each half correct on its own terms.
 *
 * That is CLAUDE.md's rule demonstrated on itself: a shared capability living
 * inside one of its two callers gets reimplemented wrongly by the other. So the
 * answer moved here, where neither owns it.
 */

/**
 * Variables the application reads or the docs name that deliberately do NOT
 * belong in `.env.example`.
 *
 * THE LINE: `.env.example` is copied to `.env.local` by a person setting up a
 * deployment. It is per-deployment CONFIGURATION. A variable set by the hosting
 * platform's build pipeline is not something that person fills in, and listing
 * it invites them to set it by hand to a value that is then wrong for every
 * subsequent build.
 *
 * Each entry needs a reason a reviewer will ask about. The list is expected to
 * stay very short: the default answer for an operator-facing setting is to
 * document it.
 */
export const ENV_DOCUMENTED_ELSEWHERE: ReadonlyArray<{ name: string; reason: string }> = [
  {
    name: "OPENPLAN_COMMIT_SHA",
    reason:
      "deployment-platform metadata (the non-Vercel commit stamp), set by the host's build pipeline, not per-developer config",
  },
];

/** The same list as a set, for membership tests. */
export const ENV_EXCUSED_FROM_EXAMPLE = new Set(ENV_DOCUMENTED_ELSEWHERE.map((entry) => entry.name));

/**
 * The application's own environment namespaces.
 *
 * Everything outside this is the platform's (`VERCEL_*`, `NODE_ENV`, `CI`,
 * `PATH`) and is not OpenPlan's to document. Shared for the same reason as the
 * list above: two guards disagreeing about which variables are ours would leave
 * a gap between them that neither reports.
 */
export const APP_ENV_NAMESPACE =
  /^(OPENPLAN_|NEXT_PUBLIC_|SUPABASE_|RESEND_|CRON_|LODES_|ANTHROPIC_|CENSUS_|CHROME_)[A-Z0-9_]*$/;
