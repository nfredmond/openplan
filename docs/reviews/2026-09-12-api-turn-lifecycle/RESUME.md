# Resume saved API worker integration

The full v1 goal remains active. v0.54.0 is already released. Do not repeat the
old v0.48 release task. Continue roadmap A0b with the existing saved API settings,
generation adapter and newly verified retained-job lifecycle. The worker and
project selection are next; no new generation option or tag is claimed yet.

## Checkout and landing

Implementation checkout:
`/home/nathaniel/.local/state/openplan/agent-hold-receipts-2026-09-10`, package
`openplan/`, branch `work/planner-agent-api-connections`.
No other coding session or browser collection was observed here. Preserve the
root checkout, demo, private credentials and unrelated reminder constraint.
User direction is verified delivery directly to main, no PRs and no human
engineering-release gate. The work branch is a recovery checkpoint.

Product source `dbed721eed6512540a7eeb7d4be4c5c0ec374ef7` passed all checks below.
This documentation checkpoint is ready to land directly on remote main. Remote
main was still `c858b89e7293ce90fb9afea67ce481b7bcd0a8fa` at the last check.
After pushing, inspect CI, RLS Isolation and Upgrade Path on the exact new main
SHA. The successful branch upgrade does not establish main CI success.

## Completed checks

Full QA exec 83744 and shuffled exec 79243 both exited zero: 13,991 application
cases passed, 439 skipped; 1,255 files passed, 42 skipped. Shuffled seed 912544.
QA also passed lint, deadcode, 382 connector cases with four skipped, dependency
audit with zero vulnerabilities, TypeScript and webpack. Its embedded live RLS
was skipped; separate full isolated RLS exec 18337 passed 468 cases in 49 files,
including all 18 provider concurrency cases. All nine lifecycle function bodies
matched source after full RLS. `local-checks.json` retains exact counts and scope.

Upgrade Path 34725125299 completed successfully on source dbed721e from v0.54.0.
All seed, populated-schema migration, row-survival and operational-row steps
passed. No main CI result is claimed by that branch run. Python workers did not
change; their numerical suites were not rerun. No scientific claim changed.

SQL mutations: one harmless control survived, 27 faults failed. Concurrency
mutations: one harmless control survived, three faults failed. Decoder mutations:
one harmless control survived, 27 faults failed at named assertions. All source
and database mutations are restored. Read VERIFICATION.md and the three retained
reports for blind categories and the initial failures that were corrected.

The four Anthropic fixture type errors are fixed by parsing the legacy schema
branch. Production discrimination stays strict. The focused decoder/routes/API/
command-environment run passed 112 cases. Full QA replayed the final source.
The explicit test:rls-live command includes the new 16-case API SQL file; existing
Vitest configuration serializes live files. Do not overlap SQL mutation campaigns
with other DB suites. All handles above are terminal; do not restart them.

## Database and private files

Named disposable stack:
`/home/nathaniel/.local/state/openplan/openplan-restore-target-2026091050`,
container `supabase_db_openplan-restore-target-2026091050`, API29821/DB29822.
It has 318 migrations including 20261012000002_assistant_api_turns.sql. The file
was also copied to the stack's migration directory. Do not reset or manually
reapply it. There were zero active API jobs before the full RLS run.

Private environment and logs:
`/home/nathaniel/.local/state/openplan/api-provider-research-2026-09-12`.
`api-settings.env` selects that stack and supplies operator encryption material.
Do not print or commit it or api-settings-account.json. The checkout .env.local
uses an older target; explicitly load api-settings.env for QA/build/browser.
Logs are lifecycle-full-qa.log, lifecycle-full-rls.log and lifecycle-shuffled.log.
Concurrency recovery state is concurrency-mutations/state.json under that private
root, phase restored. Decoder recovery state is
`/tmp/openplan-api-decoder-mutations-F4TvPJ/state.json`, also restored. Actual
function hashes are in post-rls-function-hashes.json. No browser server or test
process is left running; recheck actual process state when resuming.

## Next implementation

1. Inspect final main CI before advancing. Preserve exact main SHA/run IDs in a
   follow-on note so a process interruption cannot erase the release state.
2. Join provider-api-generation.ts to a local service worker. Reuse the private
   directory, flock and synced journal functions from
   workers/planner_agent_connector/connector-worker.mjs and bounded private JSON
   reader from connector-client.mjs, with explicit TypeScript types.
3. Claim once through claim_assistant_api_turn. It already transactionally reserves
   one conservative usage event. Journal running before any generation. Query only
   the exact workspace/connection/revision credential row; verify returned identity.
   Bind deployment, workspace, connection, revision, turn, attempt, config and
   packet hashes. Recheck current status and abort on cancellation or access loss.
   Sync completed output before common finish RPC delivery. Restarting a running
   journal must interrupt; retrying a completion must never generate or reserve
   again. Do not use a second ledger or direct successful-result table updates.
4. Extend the existing turns POST discriminator for api_connection and its exact
   revision/config hash/model/auth/charge acknowledgement. It queues work, never
   calls the provider inline. Verify every returned identity including user_id.
5. Extend ProjectProviderPanel and its browser-safe turn parser. Use the saved
   connection metadata and exact allowed models; show endpoint, credential mode,
   shared project data and explicit charges acknowledgement. Freeze an uncertain
   request for exact retry, and display history from its saved revision. Keep
   ordinary native/Anthropic behavior and the separate approval path intact.
6. Remove settings' generation-unavailable wording only after the worker/UI path
   works. Accept through real navigation on an identified build at desktop and
   390px, keyboard and console review, response loss, edit/revoke interruption,
   private history, unchanged baseline and receipt checks. Use free synthetic
   loopback generation, not an external paid provider. Run applicable final gates
   and inspect main CI before tagging the capability increment.

The full V1 contract remains binding, including all planning workflows and
independent AequilibraE/ActivitySim evidence. Keep working after this increment.
