# Saved API project UI acceptance

Active full v1 goal, A0b. Published release remains v0.54.0. Worker increment is
on main at 47c4985e. Its RLS Isolation 34728670387 completed successfully. CI
34728670375 has successful Python worker, modeling, ops and shuffled jobs;
QA is still in progress. Poll the existing run, do not restart it.

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

## Next

Start an identified local server on free loopback port 3255 with private
api-settings.env below and the exact committed OPENPLAN_COMMIT_SHA. Clear any
inherited VERCEL_GIT_COMMIT_SHA. Use which-openplan.sh before browser claims.
Enter from home/sign-in, Workspace setup & health, then create a saved API
through its real form. Use the synthetic loopback endpoint 127.0.0.1:3217/v1/
which the existing private environment allowlists. Create a synthetic project
through Projects -> New project -> Start a project. The two-step creator asks
Project name / What is it? then type/phase/status and Start the project.
Open Planner Agent -> Project task -> Saved workspace API.

Run desktop and 390px including keyboard, console, retry after lost POST response,
actual local worker and SDK response, cancellation/interruption, config edit and
revocation, original history, private API/document access and existing proposals.
Use a real local HTTP response fixture, never external paid generation. Existing
provider-api-worker-live.test.ts supplies the response and worker process recipe.
Only the child workers/servers started for the journey may be stopped.

Workspace settings still truthfully carry the previous unavailable-generation
wording until this new real path is accepted; then update it and rerun the
identified journey for the final source. No browser claim or release yet.
After UI acceptance run applicable QA, shuffle, isolated database/worker/upgrade
checks, land directly on main, inspect exact CI before tagging a capability
release. Do not reopen old v0.48 or v0.54 releases.

Private files, never print or commit:
/home/nathaniel/.local/state/openplan/api-provider-research-2026-09-12
api-settings.env and api-settings-account.json. The checkout .env.local targets
an older stack; override it. Named disposable Supabase workdir:
/home/nathaniel/.local/state/openplan/openplan-restore-target-2026091050
API29821/DB29822, container supabase_db_openplan-restore-target-2026091050.
318 migrations already applied; no reset/reapply. Live API claim is global;
never overlap claim/mutation suites. Last verified queue was empty.
