# Usage-reset checkpoint, September 13, 2026

Resume the existing full v1 goal. Published release remains v0.56.1; this is an
unfinished development checkpoint, not release acceptance. Direct main after
verification, no PRs and no human-review release gates. Preserve the root checkout,
demo, pending reminder constraint and full contract scope. No subagents were used.

Owned checkout: /home/nathaniel/.local/state/openplan/engagement-response-writes-2026-09-12
on work/engagement-response-writes. Application commands run in openplan/.
Previous pushed checkpoint f6604d6fc3ebeb121ac714fb2159227068445d0c.
The commit containing this note saves the subsequent changes. Read ACTIVITY_JOIN.md
for installed database custody and the remaining release checks.

## Changes saved here

Real navigation found Activity retained its initial empty summary when opening
Responses after publishing. Mount Activity when its tab opens to fetch current
status, preserving the other panels' drafts. Separate component regressions found
that history needed a refresh after a confirmed save and that save confirmation
could steal focus from someone reading history. Refresh history on acknowledgement,
retain selection and focus, and focus the save result only if the user has not
moved to another control.

history-refresh-mutations.json records baseline and harmless-comment survivors
and eight targeted failures, including omitted refresh, selection reset, stale
display, stolen focus and lost normal save/retry focus. Source was restored.
TypeScript and targeted ESLint completed successfully before this checkpoint.
These checks do not establish real navigation, CSS, transport or live races.

## Browser status and own errors

response-browser.cjs uses the existing repository Playwright installation, synthetic
records, the local account, and email disabled. It exercises exact retry after
the server commits but the response is interrupted, publication preparation using
the native worker and local PostgREST, and correction/history preservation.

The desktop journey is NOT complete; no 390px run has happened. Earlier history
failures were misdiagnosed: the script filled the add-entry field before the edit
form rendered and submitted unchanged text. Those failures do not prove an app
history defect. Regression tests separately demonstrated the refresh/focus gaps.
The latest script tried waiting for two identically labelled fields; the actual
browser exposes one. It failed at that count assertion before the correction.
Resolve the intended edit field from actual rendered UI before continuing.

Latest failed campaign: 0308856f-821b-44ac-9a15-0e6fb1af8003.
Private artifacts: /home/nathaniel/.local/state/openplan/response-write-probe-20260913/
response-1440-failure.json and .png, plus pending/queued/prepared screenshots.
The tool session 58888 no longer exists, and no response browser or email worker
process remained at the checkpoint. The failure artifact, not missing tool output,
establishes the outcome. Console inspection remains incomplete. Earlier runs
included ERR_NETWORK_CHANGED, RSC fallback, font warnings and an intentional
aborted response. Their cause is not established; do not call the console clean.

## Runtime and database

Owned dev server was still running as PID 1980745, child next-server, on 3260.
Recheck process ownership and run which-openplan.sh http://localhost:3260 before
using it. This is the owned worktree dev build, with source changes in this commit;
the identity log is response-build-identity.log in the private artifact directory.
Old tool session 22907 may not survive a reset. Do not assume any process survives.
Do not kill the separate demo. Ignored mode-600 openplan/.env.local points to
API 29821 and localhost:3260 and disables email. Never print its credentials.

The disposable supabase_db_openplan-restore-target-2026091050, database postgres,
has 323 migrations through 20261014000004. Preserve it and the original 1005-row
fixture a3c41566-bfd4-40f2-b467-96ee79054ec6. Browser journeys have added synthetic
records. prove-installed.py now verifies every original snapshot row by ID, allows
these new rows, and confirms all records present at probe start remain unchanged
after the rolled-back probes. That adapted runner completed successfully.
Do not run the old prototype table installers on this installed database.
Private backups exist; restore remains untested. The separate older-schema clone
response_write_probe_20260913 is not a browser target. See ACTIVITY_JOIN.md.

## Next steps

Finish the desktop correction journey, then 390px, inspect screenshots and console,
and record source identity/hashes. Complete recipient worker/REST acknowledgement
recovery, simultaneous queue claims and unsubscribe races, private access, full QA,
shuffled tests, isolated RLS, worker and upgrade/restore checks. Prepare the coherent
next minor release, merge directly to main, and inspect final-commit CI before
tagging. Continue the current contract and roadmap toward v1 afterward. Do not
repeat old releases or recreate the active goal merely because its version text
is old. Never treat this checkpoint as a passing release.

Final checkpoint regression run: 239 tests passed in 14 files, no failed tests. See reset-checks.json. This does not replace the unfinished browser or release gates.
