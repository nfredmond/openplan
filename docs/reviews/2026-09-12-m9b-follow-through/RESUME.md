# Current checkpoint after corrected local gates

The historical usage-reset checkpoint below is superseded for the failing test.
The exception is removed and its harmless/targeted mutation evidence retained.
Full QA and shuffle 912557 both completed successfully on d7030c37. See
local-release-checks.json and VERIFICATION.md. All owned local check processes
are terminal. Next: push the verified patch to main, inspect exact final CI/RLS,
then tag and publish v0.55.1. Do not call the candidate released before that.
The release body is private v0551-release-notes.md beside the named logs.

# Usage-reset checkpoint

User asked whether this thread can resume after weekly usage resets. Continue
the existing full v1 task from this checkpoint. No PRs or human-review release
gate; land verified work directly on main. Keep local/free operation and the
unrelated reminder constraint unchanged. Do not shrink the v1 contract.

## Checkout and release boundary

- Worktree: `/home/nathaniel/.local/state/openplan/agent-hold-receipts-2026-09-10`.
- Package: `openplan/`; branch: `work/engagement-response-recovery`.
- Candidate commit `3abe14558807e74511c9a258f12c070a940a14c1` was confirmed
  on the remote branch by `git ls-remote`. Working tree was clean.
- v0.55.0 is published at main `c73b051095d59beb105cf9cb1570776d416676ec`.
  Publication and successful final CI/RLS receipts are in the sibling
  `2026-09-12-api-project-ui` review. Do not recreate that release.
- v0.55.1 is an unreleased M9b read-recovery repair. Browser evidence, mutation
  evidence and the 103 focused checks are recorded in VERIFICATION.md.
  No migrations changed; the migration count remains 318.

## First task after resumption

Full QA and shuffled seed 912557 both exposed the stale known-defect entry in
`openplan/src/test/a-library-may-not-discard-a-read-error.test.ts`.
The detector says `src/lib/engagement/close-loop.ts: listed 1, actually 0`.
The implementation now handles that read error, but its old exception and
associated explanatory text remain. Remove the obsolete allowance, verify
the guard with a harmless control and targeted lost-error failure, restore
all mutations, then rerun applicable checks. Do not weaken the detector.
The shuffled runner's generic order-dependence message is not a diagnosis:
the same stale-list assertion also failed in ordinary QA.

Observed shuffled result: 1 failed, 14092 passed, 450 skipped; 1257 passing
files, 1 failing file, 43 skipped. Full QA's application suite subsequently
finished with the same counts and same failure. Do not report either as green.

Private logs and configuration are under
`/home/nathaniel/.local/state/openplan/api-provider-research-2026-09-12/`:
`v0551-full-qa.log`, `v0551-shuffled.log`, and `api-settings.env`.
Do not print or commit credentials. The QA supervisor was PID 1487796 and
its npm child 1487881. Recheck actual process ownership and logs before
starting another run; do not assume process IDs or tool handles survive.
No browser/proxy/app process from the accepted journeys remains running.

Release-mutations.json records a surviving harmless comment and targeted
wrong-count/missing-migration failures. Both accepted browser widths and
their source identity are retained under browser/. See VERIFICATION.md for
console noise, the corrected malformed-row test, and remaining blind spots.

After local gates pass, save receipts, push to main directly, inspect CI and
RLS on that exact final commit, then tag/publish v0.55.1. Continue M9b complete
response retrieval, retained correction/publication history and links to
decisions/commitments. This repair does not complete M9b or the full v1 goal.
Read current direction/roadmap before choosing the following substantial lane.
