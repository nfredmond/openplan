# Resume after the weekly usage reset

> Latest continuation: the test-only TS2769 correction is implemented. Full QA
> and shuffled seed580914 both exited 0 with 14,347 passing tests, 453 skipped.
> The production build passed. Viewer permission mutation controls still detect
> both broken cases. Read viewer-final-checks.json and VIEWER_CONTROL.md.
> This candidate is ready for direct main landing and exact final CI/RLS/upgrade
> inspection before tagging v0.58.0. The earlier unresolved-build status below
> is historical. The full V1 objective and next translation-write work stay open.

> Latest checkpoint, September 13, after the final viewer checks finished:
> owned checkout and remote work/engagement-response-writes were clean at
> b0929e3cae07ae56b4707ec4b457dc468f40a7ec. Remote main remains
> 1b0783caa6ea0b0fea97c11962935a74d88afcdb. No v0.58.0 tag exists.
> Final shuffled seed580913 completed: 14,347 passed, 453 skipped.
> Final QA FAILED during build TypeScript checking. At
> openplan/src/test/an-operator-can-author-a-campaigns-translations.test.tsx:541,
> queryByRole receives unsupported `exact: true` in ByRoleOptions (TS2769).
> Fix that test option without weakening the exact accessible-name assertion,
> run appropriate verification, then rerun the full release gate. The preceding
> green QA and CI are for older source and do not establish this candidate passes.
> Logs: private response-write-probe-20260913/history-viewer-qa-final.log and
> history-viewer-shuffled-final.log. Neither QA nor shuffle process was still
> running when inspected. Do not depend on old tool session handles surviving.
> Real viewer/staff browser acceptance is saved in VIEWER_CONTROL.md. Preserve
> that evidence; do not repeat it solely because a session reset happened.
> After correction and checks, push directly to main, inspect the exact final
> commit's CI and RLS, then tag and publish v0.58.0. Do not tag initial1b0783ca.
> Continue the full remaining workflow in ../2026-09-13-m9b-translation-writes/NEXT.md.
> This checkpoint supersedes all earlier current-status and running-job claims below.

> Latest: initial v0.58.0 candidate1b0783ca passed CI but was NOT tagged.
> A viewer-control mismatch requires the3397252c correction and final acceptance.
> Read VIEWER_CONTROL.md before release actions. Earlier pending-tag instructions
> below are superseded by this correction.

> Later continuation: browser acceptance is complete at desktop1440 and390;
> restored database2731143 is now328 and passed482 live tests. All52 worker
> suites, full QA and shuffled seed913328 passed. The owned dev server was
> stopped. See BROWSER_AND_UPGRADE.md and local-checks.json. The v0.58.0 release
> commit follows the349cfe6e evidence checkpoint. Inspect exact main CI and
> Upgrade Path before tagging; publication is not yet claimed here. Earlier
> process/database/browser statuses below are historical. Continue the remaining
> atomic writes, source custody, cache completeness and durable generation next.

Saved September 13, 2026 at Nathaniel's request. The full V1 objective remains
unfinished and authorized. Resume this work, do not restart the original v0.47
plan. No PRs, no human-review release gate, local/free operation. Preserve the
pending reminder constraint and separate scientific claim boundaries.

## Checkout and release

Work in /home/nathaniel/.local/state/openplan/engagement-response-writes-2026-09-12,
package openplan/, branch work/engagement-response-writes. Implementation commit
0d65771ecde0bd126d35582bf00c3e7934dc2236 is already pushed. This checkpoint follows it.
Remote main was separately verified at 0e06062ab7a8965bd54114a59390d99c9c90ad56.
v0.57.1 was published at 6ee8c438da9e5c100bb6c1588e29d5248b46cac7; see the
translation-scope PUBLICATION.md for exact release CI. Current translation history
work is unreleased and not merged to main. Merge directly after applicable checks.
The original /home/nathaniel/code/openplan checkout and the demo remain untouched.
Recheck ownership, status, remote refs, goal state and processes on resume.

## Completed since IMPLEMENTATION.md

The installed isolation suite completed successfully: 52 files, 482 tests,
360.96 seconds, history-full-rls-328.log. Afterward the live fixture gained source
category removal coverage: current translation disappears, original checksum and
removed wording remain in history, exact reader count is 1013. That focused live
fixture passed separately, history-source-cleanup.log.

The installed fixture and isolation census have surviving baseline/comment
controls and targeted empty-fixture/missing-history-probe failures. See
prove-history-live-controls.py and history-live-controls.json. Supplemental SQL
baseline/comment controls passed; suppressing category removal history failed
with 'Source cleanup lost retained translation'; permitting address changes failed
with 'Address mutation survived'. See history-source-guards.json. Those SQL cases
installed candidate 09 only inside rollback transactions on retained stack 327;
absence of the candidate table was checked after each rollback. The supplemental
runner was an inline script, not yet retained as an executable repository file.
These checks do not establish browser usability or the full release gate.

## Exact browser stopping point

Private evidence and scripts:
/home/nathaniel/.local/state/openplan/response-write-probe-20260913
Run script: translation-history-browser.cjs. Uses repository Playwright, isolated
Chrome contexts, real navigation and synthetic fixtures. Production source was
frozen at 0d65771e during these attempts.

First two attempts failed during navigation with ERR_NETWORK_CHANGED. Their
artifacts are retained in history-browser-first-navigation-failure/ and
history-browser-second-navigation-failure/. After stopping the old restart loops
below, the third desktop attempt reached the new history control but timed out
waiting for the deliberately induced history-read error alert. See
translation-history-1440-after-loop-stop.log and the current
translation-history-1440-failure.json, -failure-aria.txt and -failure.png files.
No passing history browser acceptance yet; 390px has not run. Determine whether
the first-request failure injection collides with StrictMode/effect cancellation
or reveals an app defect. Neither explanation is established. Inspect the small
history section and relevant network entries rather than dumping the entire file.
Preserve the third attempt before rerunning. Do not remove the retry assertion to
manufacture a pass. Complete original/corrected/withdrawn retained checksums,
interrupted save acknowledgement and private read retry, desktop/390px keyboard
navigation, console and actual image inspection.

Owned dev server was running on 3260, PID 858691, next dev --webpack, log
history-dev.log. Verify PID/cwd before stopping or restarting; tool sessions may
not survive. Use which-openplan.sh to reidentify the served checkout. Stop the
owned dev process before a production build writes the same .next directory.
No test or browser process was running at checkpoint; dev server remains running.

## Retained databases and old restart loops

App disposable stack supabase_db_openplan-restore-target-2026091050 has migration
328 through 20261014000009. API 29821, DB 29822. Workdir is
/home/nathaniel/.local/state/openplan/openplan-restore-target-2026091050.
Mode-600 app .env.local already targets it. Do not print credentials.
Installation backup and all-277-table row-hash preservation are in installed-328.json
and private history-install-328/. The backup has not itself been restored again.

Retained restored stack supabase_db_openplan-restore-target-2731143 remains at327,
API28761, DB28762. Workdir:
/home/nathaniel/.local/state/openplan/openplan-restore-drill.enw48S/openplan-restore-target-2731143.
Upgrade this stack to328 with backup and existing-row comparison, then applicable
installed checks. Do not reset stacks. Pre-install runners require327 and cannot
be blindly rerun on the app stack now at328.

Eight auth/storage companions of old source/target restore projects3112923 and
3390964 were looping thousands of restarts while their four databases had been
stopped for two days. Ownership was established from the completed goal drills in
docs/reviews/2026-09-09-owp-full-recovery/VERIFICATION.md. Related navigation/network
observations also appear in the September12 response-write restore review.
Only those eight looping containers were stopped with docker stop --time10.
Containers and volumes were retained; unless-stopped restart policies unchanged.
See retired-restore-loops.json. Active app/restored stacks and demo were untouched.
Docker network churn plausibly caused browser ERR_NETWORK_CHANGED, but causation
is not proved. A future restore lifecycle fix should prevent abandoned companion
restart loops without destroying retained data.

## Continue after browser diagnosis

Finish browser evidence, full QA and shuffled tests, retained-stack upgrade and
applicable worker/CI checks. Full QA/shuffle have not run for this implementation.
Read IMPLEMENTATION.md, NEXT.md and current product direction before choosing the
next substantial change. Keep verified checkpoints pushed and land directly on
main; inspect final commit CI before tagging a bounded release.

The broader translation workflow still needs exact-version atomic writes,
correction reasons, original source text custody, durable request receipts and
retry recovery, preserved machine origin upon acceptance, durable generation and
explicit publication. Current history alone does not implement that workflow.
Additional source-review findings need implementation and proof: public cached
translations contain sourceHash/text without completion provenance, so old
truncated/incomplete cached output can survive the new helper checks. Public
translation usage is recorded only after successful output and fire-and-forget;
staff generation counts only successful translation batches. Failed attempts and
lost acknowledgements need durable spend accounting before retries. Inspect
readCachedTranslation and engagement_cache_reviewed_translation before changing
cache custody. Do not claim these gaps fixed. Continue the full V1 contract after
this increment, including remaining nationwide and separate model validation.
