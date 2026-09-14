# Resolution lifecycle and usage-reset checkpoint

The active worktree is `/home/nathaniel/.local/state/openplan/translation-command-workflow-2026-09-13`, branch `work/translation-command-workflow`. Run app commands from its `openplan/` directory. This checkpoint follows `992f7ac6`. It is saved development work, not a release. Continue the complete V1 contract; no PR or human-review gate is required. Preserve the pending reminder constraint, original checkout and demo. Free/local only.

## Saved change and evidence

Resolution requests now abort and release their active operation when edit access disappears. Restoring access cannot revive a delayed old response or let its finalizer release a newer retry. Three regressions reproduced the defect before the fix. The final source passes all 19 resolution tests and focused ESLint with zero warnings. `resolution-panel-controls.json` records a passing baseline, surviving harmless mutation and 21 targeted faults that fail the expected tests. Its source hash matches the checkpoint source.

`translation-resolution-lifecycle-browser.cjs` exercised real root/sign-in/Engagement/Setup navigation at 1440px and 390px, keyboard sign-out, held resolution acknowledgement, same-account sign-in, exact retry and receipt downloads. Both journeys passed. Original wording/history survived; private anonymous reads refused access. Desktop/mobile screenshots were inspected during the preceding implementation turn. Raw evidence stays private at `/home/nathaniel/.local/state/openplan/response-write-probe-20260913/translation-resolution-lifecycle-browser-1789365913638`; the adjacent manifest records checksums. Browser evidence predates only the final dependency destructuring used to remove an ESLint warning. Live membership changes and switching to another account were not exercised by this browser runner.

Full unit suite before that lint-only adjustment: 15000 passed, 503 skipped, zero failed; `resolution-access-full-unit.log` and `.exit` under the private evidence root record exit 0. Final focused run: `reset-checkpoint-focused.log`, 19 passed, exit 0. The attempted combined filter named a nonexistent generation test path; only the resolution file ran, so this is not a fresh generation-suite claim. The first checkpoint metadata inspection also used a repo-relative path from the app directory and failed read-only; corrected from the repository root.

Prior full QA at `e30996ae` passed, including lint, build and 15004 tests, with optional live RLS skipped. See `generation-lifecycle-qa.json`. Earlier independent isolated RLS passed 525 tests; workers passed 52 suites; shuffled seed 913058 passed 14995 tests. Those earlier results do not establish final release-commit evidence.

## Process and database custody

The synthetic Next dev server on 3260 was stopped for the usage-reset checkpoint after verifying its CLI PID 3204334 and worktree cwd. Do not assume it or browser sessions survive. Restart an ordinary local server when needed, read the browser skill and identify it with `which-openplan.sh` before acceptance. No provider worker should be started against old proof fixtures.

Browser database remains the isolated `supabase_db_openplan-restore-target-2026091050`, API 29821 / database 29822, installed through migration 20261014000019 with 338 migrations. The resolution and activation proof databases remain preserved. Do not reset/drop them or point a worker at queued synthetic evidence. See earlier notes for credentials and startup recipes; never print secrets.

Dedicated QA worktree `/home/nathaniel/.local/state/openplan/translation-resolution-qa-20260913-125bf2a3` was last detached at `e30996ae`; verify its status before updating. Another agent was active in `/home/nathaniel/code/openplan`; inspect ownership again before joining main. Its `.directory` is unrelated.

## Resume here

1. Verify branch, clean status, remote main/tags/CI, active sessions and process liveness. Read current product direction and roadmap before the next substantial lane. v0.58.1 was already released; do not restart v0.47 or narrow V1.
2. Finish the remaining public translation producer. Existing `src/app/api/engage/[shareToken]/items/[itemId]/translate/route.ts` still calls the provider directly and records usage after the call. Its shared usage lookup fails open. Extend existing Engagement/worker/credential machinery with anonymous public authority and atomic reservations; do not fabricate a staff actor or casually change the global limiter. Preserve current approved source, parent, share authority, original text and separate public allowance. Retain output across acknowledgement/cache failure without repeating provider spend.
3. Public client `public-engagement-portal.tsx` still expects an immediate translation. Add reachable durable recovery/status behavior and prevent late results after clearing/changing scope. These public changes are investigated only, not implemented. Private staff generation machinery is already available to extend.
4. Complete applicable QA, shuffled, isolated RLS, workers and populated upgrade from v0.58.1, whose final migration is 20261014000009. Directly merge verified work to main, inspect CI on the final release commit, then tag under the release policy. No draft PRs. Continue the full product contract after this increment.

A reset is not proof a background command finished. Inspect saved exit codes and current processes before restarting anything. The durable notes and Git checkpoint are the recovery authority.
