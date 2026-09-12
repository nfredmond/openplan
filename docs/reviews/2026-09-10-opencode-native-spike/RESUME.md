# Resume OpenCode release work, then continue through v1

Nathaniel wants continuous development through the full v1 contract, direct main,
no PRs and no human engineering release-review gates. The active goal remains
unfinished. Use local/free operation and synthetic provider fixtures; no real
OpenCode API calls or paid infrastructure. Leave the pending reminder constraint
untouched. Do not start the old OWP/contract release work again: v0.48 through
v0.53 are already published.

## Current lane

Worktree: /home/nathaniel/.local/state/openplan/agent-hold-receipts-2026-09-10
Branch: work/planner-agent-opencode-connection
Release source: 4e9de713c87ed4141ee88c917cd6e88be9641b70, pushed directly to main
and the work branch. Remote main was checked at this exact SHA on September 10.
Package metadata is 0.54.0. OpenCode implementation, connector
registration, app routes/UI, additive migration and relevant browser acceptance
are complete. Publication and final release-commit CI are not yet confirmed.

Read VERIFICATION.md, browser-final.json, candidate-qa.json, upgrade-local.json
and the last CHECKPOINT.md section. Older checkpoint statements are historical.
Full QA and shuffled seed811348 passed13800 with401 skips. Default connector
suite passed374 with4 opt-in skips. Full isolated RLS passed430 in46 files;
52 Python worker suites and the opt-in OpenCode filesystem fixture passed.
Desktop1440 and390px actual-native journeys covered connection downloads,
identical POST/delivery retries, reloads, approved drafts, cancellation and
revocation. Prior Codex and Claude results stayed unchanged. Separate retention
journeys blocked deletion and preflight503 recovery sent zero DELETEs.

Actual OpenCode1.18.30 used synthetic native API keys and local scripted Responses
data only. Live availability, entitlement, billing and usefulness remain unmeasured.
OpenCode OAuth/subscription modes, further native providers, extensible API
endpoints, broader tasks and durable assignments remain open A0/A1 work.

## Immediate next step

September 12 resumption found CI 34525575454 failed on source 4e9de713.
Seven catalog tests could not start their hardcoded /usr/bin/node fixture.
RLS 34525575421, Upgrade Path 34525575469 and shuffled tests passed.
No v0.54.0 tag exists. RELEASE_CORRECTION.md records the reproduced failure,
portable fixture repair and tested Codex directory guard follow-up. Full connector
suite passed 382 with four opt-in skips; separate native Codex fixture passed two.
Commit and push this corrected candidate directly to main, then inspect final QA,
shuffled tests, RLS and Upgrade Path on that exact commit before tagging/publishing.
Do not rerun the failed old source expecting it to repair itself. Keep both
failed and corrected evidence. No human review or draft PR is required.

Post-browser changes include release metadata, the catalog test fixture and the
Codex directory guard. OpenCode app/native implementation is unchanged from
browser-tested 1b5ba8be. Keep this distinction in release evidence. Product direction check passed with normal
review reminders; no review dates were refreshed as a substitute for evidence.

## Processes and databases

The owned production acceptance server on127.0.0.1:3219 was identified as this
worktree, then stopped before release metadata edits. PID750966 exited through
SIGTERM; its session ended143. No browser/native fixture processes remained.
Other checkout/demo servers are not ours and were left running. Recheck live
ownership before any changes; do not kill them or build over the root app server.

QA stack workdir:
/home/nathaniel/.local/state/openplan/openplan-restore-target-2026091050
container supabase_db_openplan-restore-target-2026091050, API29821/DB29822.
Browser stack workdir:
/tmp/openplan-restore-drill.yBEWX9/openplan-restore-target-3390964
container supabase_db_openplan-restore-target-3390964, API22301/DB22302.
Both now have316 migrations. Browser upgrade preserved all16 pre-existing
connection hashes and25 retained-turn hashes. No reset/drop of data was used.
The app .env.local selects the browser stack; never print its secrets.

## Private evidence and commands

/home/nathaniel/.local/state/openplan/opencode-native-evidence-2026-09-10
contains all logs, screenshots, native protocol probes, synthetic credentials
and browser scripts. Do not commit private connection files or raw histories.
Pinned native binary:that directory/native/opencode, not installed on PATH.

browser-opencode.cjs runs actual native acceptance with WIDTH=1440 or390 and
EXPECTED_SHA set to the serving full commit. browser-retention.cjs covers deletion
and interrupted preflight. browser-native-fixture.mjs owns synthetic Responses
transport. The first desktop startup wait was too short under concurrent load;
its failed evidence is retained. Current harness observes native readiness for
up to90 seconds and recognizes a terminal fixture. Production bounds did not
change. Final measured cancellation/revocation startup was about4 seconds.

App commands run from this worktree's openplan/ package. Worker node tests run
from the worktree root. RLS needs OPENPLAN_RLS_LIVE_TEST=1 and the explicit
OPENPLAN_SUPABASE_WORKDIR above. Repository Playwright/Chrome is authorized.
Read the browser skill and run openplan/scripts/ops/which-openplan.sh before
acceptance. Do not edit a served acceptance checkout during collection.

After v0.54, run product:direction:check and continue current roadmap A0/A1,
including extensible provider/API choice. The native spike also recorded a
bounded follow-up to investigate older Codex scratch-root/reciprocal-overlap
checks; no public exploit was demonstrated because the connector creates fresh
scratch directories. Keep all other v1 planning and separate scientific
validation obligations intact.
