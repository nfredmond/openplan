# Saved API project UI acceptance

Active full v1 goal, A0b. Published release remains v0.54.0. Worker increment is
on main at 47c4985e. Its RLS Isolation 34728670387 completed successfully. CI
34728670375 has successful Python worker, modeling, ops and shuffled jobs;
QA also completed successfully. All five CI jobs and RLS passed for 47c4985e.
Do not poll or restart these completed worker runs.

The request endpoint is branch-pushed at 22a97822. The project provider panel
now has Saved workspace API selection, paged metadata using the existing
provider-api-metadata parser, configured model selection, endpoint/auth/shared
record disclosure and explicit consent. It preserves the chosen revision rather
than silently advancing it after refresh. Exact connection/revision/hash is
checked for both POST acknowledgement and uncertain-request recovery. The
browser parser now supports retained API history and its original destination.
Proposals still require the existing conversation review flow.

New panel tests: 25 cases. Restored replay of both panel suites plus API endpoint
passed 79 cases; TypeScript and changed-file ESLint passed. The initial lint
warning about reading a ref in effect cleanup was resolved with the existing
callback invalidation pattern. Mutation campaign completed one harmless survivor
and 22 targeted failures; source restored. Private recovery:
/tmp/openplan-api-project-ui-mutations-gUnt56/state.json.
These tests mock HTTP and cannot establish real navigation, rendered layout,
worker execution or live database integration. Browser acceptance is next.

Isolated Chrome launch with channel chrome and about:blank navigation passed.
Use the authorized harness at
/home/nathaniel/code/openplan/qa-harness/node_modules/playwright/test.
Implementation checkout:
/home/nathaniel/.local/state/openplan/agent-hold-receipts-2026-09-10
Package openplan/, branch work/planner-agent-api-connections. No other agent
owns this worktree; the other active session is in Job Search. Root/demo remain
untouched. No subagents. Preserve unrelated reminder constraint and private keys.

## Release candidate checkpoint

The UI and actual-worker journeys passed at desktop and 390px on source
5b84838c86852a228e23ea1a138551581b9132fd. VERIFICATION.md, public synthetic
JSON reports, viewport captures, build-identity.log and BROWSER_SHA256SUMS retain
the evidence. Keyboard save/retry/cancellation, one dispatch after response loss,
keyed original and keyless corrected generation, immutable old history after
correction/revocation, anonymous history 401 and direct credential 403 passed.
The final mobile retry followed a recorded Chrome network-change failure; it
used Refresh connections and passed with only the deliberate POST abort error.
The earlier source selector mistakes and clipped capture are documented too.

The dev server on 3255 was stopped intentionally after browser collection.
Its handle 68984 is terminal, exit 143. No browser, model fixture or API worker
remains running. No new Python/scientific behavior was introduced.

Version/package-lock, contract/roadmap/matrix/registry release metadata and
changelog are aligned to the v0.55.0 candidate. Review dates and capability
statuses are unchanged. The release high-water mark is 318 migrations through
20261012000002_assistant_api_turns.sql. Release-ordering fault probes had one
harmless survivor and two expected failures; source restored. Browser source
precedes only version, documentation and release-check changes, not runtime edits.

Next: run full candidate QA, shuffled seed 912556 and full RLS in the named
isolated stack. Keep their real session handles and logs; do not restart a live
job. Commit/push checkpoints, land directly on main when applicable local checks
pass, inspect exact main CI/RLS, and manually dispatch Upgrade Path from v0.54.0
on the final candidate. Tag/publish v0.55.0 only after the declared gates pass.
Then continue the full roadmap. No draft PRs, paid services or human-review gates.

## Private environment

Private files, never print or commit:
/home/nathaniel/.local/state/openplan/api-provider-research-2026-09-12
api-settings.env and api-settings-account.json. The checkout .env.local targets
an older stack; override it. Named disposable Supabase workdir:
/home/nathaniel/.local/state/openplan/openplan-restore-target-2026091050
API29821/DB29822, container supabase_db_openplan-restore-target-2026091050.
318 migrations already applied; no reset/reapply. Live API claim is global;
never overlap claim/mutation suites. Last verified queue was empty.
