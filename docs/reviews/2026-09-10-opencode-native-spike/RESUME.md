# Resume OpenCode release work, then continue through v1

Nathaniel wants continuous development through the full v1 contract, direct main,
no PRs and no human engineering release-review gates. The active goal remains
unfinished. Use local/free operation and synthetic provider fixtures; no real
OpenCode API calls or paid infrastructure. Leave the pending reminder constraint
untouched. Do not start the old OWP/contract release work again: v0.48 through
v0.53 are already published.

## Current lane

Worktree: /home/nathaniel/.local/state/openplan/agent-hold-receipts-2026-09-10
Branch at publication: work/planner-agent-opencode-connection.
v0.54.0 is published from 33a5fb0ced7e78dcf1d0bb1b566f95d9251d5224.
Annotated tag object: ec54d19d15a8eccb838751c658c8a273556ad03b.
Publication: https://github.com/nfredmond/openplan/releases/tag/v0.54.0
Time: September 12, 2026, 19:30:00 UTC. Normal release, not a draft/prerelease.

Read publication.json and VERIFICATION.md for final receipts. CI 34713463150,
RLS 34713463159 and Upgrade Path 34713492994 all passed on the release source.
Full QA/shuffled seed 361151 passed 13,793 with 408 skips; connector passed 382
with four native opt-in skips. RLS passed 430. The first source 4e9de713 failed
seven fixture launches and was never tagged; RELEASE_CORRECTION.md preserves
that failure, the portable Node fixture and the Codex directory guard evidence.
Actual native Codex isolation separately passed two synthetic transport cases.

OpenCode desktop/390px browser evidence remains bound to 1b5ba8be. OpenCode
production implementation did not change afterward. The actual 1.18.30 binary
used synthetic credentials and local Responses fixtures only; no provider spend.
Live availability, entitlement, billing and usefulness remain unmeasured.

## Immediate next step

Continue roadmap A0b with the same retained project task and extensible API
connections. API_PROVIDER_NEXT.md contains the source-traced implementation
boundary and reuse decision. Its api-model-identity-probe.json is an actual
AI SDK 6.0.278 / compatible adapter 2.0.75 fixture: absent model/response IDs are
normalized into apparently complete SDK metadata, so inspect bounded raw replies.
The existing outbound URL helper cannot pin DNS; reuse its address classifier
with a transport that connects only to checked addresses. Preserve local operation
through explicit operator endpoint policy, exact connection revisions, encrypted
keys, cancellation and unchanged approvals. No new API production code is written.

Private API research lives at:
/home/nathaniel/.local/state/openplan/api-provider-research-2026-09-12
It includes the pinned Apache-2.0 package, integrity receipt and runnable synthetic
SDK probe. Dependencies are installed only in sdk-fixture/ there, not in the app.

The Codex directory follow-up is now included in v0.54.0; do not reopen it as
unfinished. Broader native account modes, API breadth, durable assignments and
all other v1 planning/scientific obligations remain open. No second release or
new tag is needed for the publication-note checkpoint following 33a5fb0c.

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
including extensible provider/API choice. The Codex scratch-root/reciprocal-overlap follow-up is fixed in v0.54.0. Keep all other v1 planning and separate scientific
validation obligations intact.
