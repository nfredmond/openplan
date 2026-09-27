# September 27 resume and server landing

The isolated checkout, branch and full V1 objective remain unchanged. Main was rechecked at `203326b5`; its CI remains successful. The September 14 RLS process and temporary log no longer exist. Its outcome is unknown. The named stack retained all 347 migrations through 28. A fresh September 27 full installed RLS run completed successfully: **657 tests in 66 files**, exec22806, durable log `/home/nathaniel/.local/state/openplan/approval-resume-2026-09-27/rls-full.log`. Historical full QA and shuffled seed619146 evidence remains valid for the unchanged server checkpoint. No approval release is declared.

The verified server commits and this result are ready for direct main push. Inspect the resulting CI separately. New September27 approval recovery/API/UI work is still local and excluded from this server landing. Its notes will live in `docs/reviews/2026-09-27-synthesis-approval-recovery/`. Recovery has 37 focused tests and 42 fault/control cases; the route has 14 focused tests and 30 fault/control cases, all expected. The first recovery fixture contained a recursive mock and wrong JSON field-order expectation; both were corrected. The route's invalid UTF-8 probe now uses an otherwise valid command so schema rejection cannot mask the decoder check.

The new UI is connected locally in synthesis-approval-panel.tsx, synthesis-review-editor.tsx and engagement-synthesis-sources.tsx. It is not yet component/browser verified. Do not include it in claims about the server checkpoint's prior QA. Next run its component tests and targeted faults, fix any demonstrated defects, then build an identified candidate and exercise real desktop/390px navigation, account/privacy changes, interrupted retries, original/correction approvals and both concurrent writer orders. API assistant refusal remains explicit; exact reasons stay private. No source/preparation/draft approval status is rewritten.

Browser inventory currently lists no controllable tabs, but the explicitly authorized repo Playwright harness launched Chrome154 to about:blank and closed it. This is tool availability, not app acceptance. No old app server has been assumed alive. Reidentify any server before browser evidence. The original checkout has only an unrelated untracked `.directory` file and remains untouched. Updated planner-writing instructions apply; OpenPlan remains separate from Drago Vantage work.

---

# Resume at approval server verification and live broad checks

September 14, 2026. This section supersedes all older checkpoints. The previous goal turn made progress by saving the server WIP; this turn completed its mutation proof, installed migration 28, repaired a demonstrated older fixture failure and completed full QA. Continue the full V1 goal. No release or main push is implied by this local checkpoint.

Owned checkout/package/branch remain `/home/nathaniel/.local/state/openplan/translation-command-workflow-2026-09-13`, `openplan/`, `work/engagement-decision-traceability`. The original checkout still has another live Codex and remains untouched. Main was rechecked remotely at `203326b5`; its CI 34912383802, RLS 34912383822 and Upgrade 34912383841 are all completed/success. Latest published release remains v0.62.0.

Read `APPROVAL_SERVER_VERIFICATION.md`, `approval-server-results.json` and the newest implementation handoff in `NEXT_APPROVAL_BOUNDARY.md`. The server now has 28 mutation/control cases, the protocol rerun has 43, all expected and exact sources restored. Focused final checks passed 105 tests. Installed approval custody plus production joins passed; older review tests exposed unscoped global counts before their intended assertions. Those counts now include only the fixture campaign, with an always-present unrelated review and three targeted restorations of the old broken counts. The corrected native review suite passed all 34 cases. Both the original failure and corrected results are preserved.

Full QA completed successfully in exec 26500: 15,557 passing tests, 628 explicit skips, lint, configured dead-code check, provider connector, audit and production webpack/TypeScript build. Log `/tmp/openplan-approval-server-qa.log` is copied to the private usage-pause directory. QA does not include live RLS here.

Shuffled seed 619146 completed successfully in exec **24183**: 15,557 passed, 628 skipped; log `/tmp/openplan-approval-server-shuffled.log` is copied privately. The remaining LIVE JOB is full installed RLS, exec session **84361**, log `/tmp/openplan-approval-server-rls-full.log`. Its handle was rechecked live after shuffled tests completed. Poll that exact handle/process; do not restart because a read yielded no output. They are running on the frozen application/test files of this checkpoint. Update results only after terminal outcomes. If either fails, investigate the exact assertion and preserve the original failure. Once they pass, finish verification documentation, commit and push directly to main without a PR, then inspect that new commit's CI. Do not report this unfinished approval workflow as released.

The isolated stack now has **347 installed migrations through 20261014000028**. Migration 28 was applied additively and byte identity checked. Do not use OPENPLAN_SYNTHESIS_APPROVAL_CANDIDATE=1 on this stack. No reset/drop. The new approval join is registered in test:rls-live. Post-focused-run counts were zero approval events, eight pre-existing browser reviews and 29 revisions. Full native suite runs against the named restore-target stack at API29821/DB29822. Never substitute a demo database.

Next connect private authenticated approval API, separate exact browser working-copy recovery and the existing saved review UI. API must strip enriched receipt fields to exact packets, preserve assistant refusal and catch review-loader errors too. Source-owned memory is needed across focus/source revalidation and temporary review unmounts; preserve current review recovery schema. Actual simultaneous committed writers, both correction/approval orders, browser/PostgREST integration and desktop/390px keyboard/console journeys remain required. See the dated next-boundary handoff for details. The server on3262 was not changed or reidentified this turn; no new browser evidence is claimed. Keep reminder constraint and scientific claims unchanged.

---

# Weekly usage pause: approval server work in progress

September 14, 2026. This section supersedes the historical checkpoints below. The user is pausing for a weekly usage reset. Resume in this same thread with the full V1 objective unchanged. This local checkpoint is unfinished work, not a release or an approval to skip verification.

Owned checkout: `/home/nathaniel/.local/state/openplan/translation-command-workflow-2026-09-13`, package `openplan/`, branch `work/engagement-decision-traceability`. Original `/home/nathaniel/code/openplan` belongs to another session. Preserve it and the pending reminder constraint. Main is verified remotely at `203326b52a6b60a7dd16c36972e66988a427f1c6`; latest release remains v0.62.0. At this pause, checkpoint RLS 34912383822 and Upgrade 34912383841 completed successfully; CI 34912383802 remains in progress. Recheck that handle before new work. This new local WIP commit has not been pushed to main because its verification is incomplete. Continue direct verified main pushes without PRs.

New files are `synthesis-approval-server.ts`, `engagement-synthesis-approval-server.test.ts` and `engagement-synthesis-approval-join-rls.test.ts`. Existing approval protocol adds typed conflict errors; the review loader adds an optional callback for fully verified revision identities. The server binds actor/scope, checks approval history against actual verified review revisions, and recovers exact old requests before stale-state checks and after native 409/503. Preserve corrupted-byte, changed-command and forbidden-access distinctions. Return only exact eventText/eventSha256 packet fields from future API responses, since the internal server receipt also carries verified event data.

Recorded focused runs: 65 tests in three files; three native production TypeScript/database join cases. The join covers original/correction approval, withdrawal, lost acknowledgment recovery, revoked access and a rehashed wrong revision reference. These are recorded results, not fresh reruns or complete mutation proof. Logs copied to the private usage-pause directory listed below. The native join is not yet registered in package test:rls-live. No approval API or UI exists yet.

Next finish mutation/control proof for the server, callback and typed errors. Preserve the historical approval-domain manifest; use a new output for reruns. Register the native join; use 8GB NODE_OPTIONS for TypeScript. Apply additive migration 28 only to the named isolated stack after inspecting current state. Last observed installed state was 346 migrations through 27, so native tests used OPENPLAN_SYNTHESIS_APPROVAL_CANDIDATE=1. Omit that flag once 28 is installed. Do not reset/drop databases. Then implement authenticated API and browser approval command recovery, actual competing committed writers and both approval/correction orders, identified desktop/390px keyboard/console journeys, applicable full QA, shuffled tests, isolated RLS, workers, upgrade and final release CI before tagging.

Database: `supabase_db_openplan-restore-target-2026091050`, workdir `/home/nathaniel/.local/state/openplan/openplan-restore-target-2026091050`, API 29821 / DB 29822. Production server last identified on 3262 served a2e049357175 from before release metadata. Recheck process ownership and use which-openplan.sh; process survival is not guaranteed. No unfinished mutation or test process was found at pause. New join tests use rollback transactions and are not evidence of browser/PostgREST or simultaneous committed writers. Older review custody global count assertions may need scoped fixture controls if installed RLS demonstrates a failure.

Private copied logs: `/home/nathaniel/.local/state/openplan/usage-pause-2026-09-14-approval-server/`. No secrets or private captures belong in Git. Read APPROVAL_NATIVE_VERIFICATION.md and NEXT_APPROVAL_BOUNDARY.md next. Full M9b and V1 remain unfinished; do not restart the old v0.47 plan.

---

# Resume at exact-review approval database checkpoint

September 14, 2026. Read `APPROVAL_NATIVE_VERIFICATION.md` and `approval-native-results.json`. Migration 28 now implements private immutable exact-version approval/withdrawal, current membership, original request recovery, shared correction locks and full private history. The native candidate passed 39 cases, including real separate-session lock probes and actual database packets read by the production TypeScript protocol. The native tests are registered in `npm run test:rls-live`; schema counts and Unreleased migration disclosure are updated. API/server/UI approval remains unimplemented and v0.62.0 remains the latest release.

Local database `supabase_db_openplan-restore-target-2026091050` is still installed through migration 27, 346 migrations. All new schema, fixtures and faults ran in rollback transactions; migration 28 has not been applied. Use `OPENPLAN_SYNTHESIS_APPROVAL_CANDIDATE=1` only until it is installed. Native lock setup uses explicit synthetic rows so setup does not already own correction's lock. This proves mutex exclusion/release and detects broken keys; it is not full concurrent committed writer evidence.

Next inspect checkpoint CI, apply additive migration 28 to this named stack, then build the production server/API and exact browser command recovery. Reuse the verified protocol and existing review loader; authenticate/bind the actor locally and preserve assistant refusal. Prove actual identical/competing writes, both approval/correction orders, installed RLS, the full TypeScript writer join and desktop/390px browser navigation before release. The latest tests found and repaired an anonymous-fixture input block and native Unicode blank-reason acceptance; preserve those errors in the verification record. Do not mark M9b or V1 complete.

Owned checkout/package/branch remain unchanged below. Previous main `061cd24fb8813ce9152f7d045bc1d6201ca58754` has completed successful CI `34910274557` and RLS `34910274599`. Recheck the new checkpoint's push and CI separately. Keep the original checkout, reminder constraint and other session untouched.

---

# Resume at exact-review approval protocol

September 14, 2026. This section supersedes earlier checkpoints. v0.62.0 remains published; no later release exists. The next approval increment now has an implemented pure protocol in `openplan/src/lib/engagement/synthesis-approval.ts`, a focused test suite and `prove-approval-domain.py`. Read `APPROVAL_PROTOCOL_VERIFICATION.md` and `approval-domain-mutations.json`. There are 29 new protocol tests, 46 tests in the focused protocol/review run, and 43 mutation/control cases with expected outcomes. This is not a usable approval workflow yet. No new migration, API or UI exists.

Next implement the native append-only event table/retention/private-reader boundary, sharing migration 27's review correction lock and preserving exact request recovery before stale-head comparisons. Then connect TypeScript, authenticated routes, browser recovery and desktop/390px acceptance. The source/preparation and old immutable `staff_draft` content must stay untouched. Retain complete old approval history while corrections remain unapproved; scope includes source/review/revision IDs and hashes. The protocol's verified history does not replace native access checks or authoritative completeness.

Owned checkout remains `/home/nathaniel/.local/state/openplan/translation-command-workflow-2026-09-13`, package `openplan/`, branch `work/engagement-decision-traceability`. Another live Codex session was confirmed in `/home/nathaniel/code/openplan`; keep that checkout and its reminder constraint untouched. The named DB remains installed through migration 27 with 346 migrations. No database or browser state was changed in this protocol turn. Reidentify the existing server and database before using them.

Main at the start was `e53e851193d5867afe31707632395d46b928e8ef`. Its CI `34908852644` and RLS `34908852712` are now completed/successful. Verify the new checkpoint's push and CI separately. Continue directly toward the complete V1 goal; no PR or human software-release approval is needed.

---

# Resume after published v0.62.0

September 14, 2026. This section supersedes earlier checkpoints. v0.62.0 is published, non-draft/non-prerelease, at 23:23:16 UTC. Annotated tag c9cca46fe0d35a8f71cb0b51848ae0fcb08c41c2 resolves to 018cda5d8a33a45001bbd39c1c6362636101d785. It was pushed directly to main without a PR. CI34907096050, RLS34907096003 and Upgrade34907095999 all passed on that exact release commit before tagging. PUBLICATION.md and v0620-final-ci.json contain the evidence. Local full QA/shuffle passed 15,502 tests with 583 explicit skips; native isolation passed 612 and all 52 worker suites passed.

Next implement the exact-review approval seam in NEXT_APPROVAL_BOUNDARY.md, then the complete source-to-response/decision and reviewed-export connection and optional resumable generation. Keep immutable staff_draft content intact; approval belongs to an exact revision and never carries automatically to a correction. Existing work-program and governed-project approval mechanisms were inspected for reuse; do not fabricate a program/project to fit a standalone consultation. Preserve their existing authority rules. Full M9b and the V1 contract remain open.

Owned checkout remains /home/nathaniel/.local/state/openplan/translation-command-workflow-2026-09-13, package openplan/, branch work/engagement-decision-traceability. The owned server was started on3262 from a2e049357175, before release metadata, with exec97599 and log /tmp/openplan-retirement-server.log. Recheck actual processes/build identity after interruption. All review/retirement browser and local test jobs are terminal; GitHub release workflows are terminal success. Publication-document push is the next checkpoint action; recheck current main/branch heads and subsequent CI after resumption.

The named DB remains supabase_db_openplan-restore-target-2026091050 on API29821/DB29822 with 346 installed migrations through20261014000027. Use installed tests, not old candidate flags. Source/review originals and corrections were reopened on the release candidate and matched all prior hashes at desktop and390px; originals remained read-only. Historical legacy-summary layout is explicitly synthetic because no old summary rows exist in that DB. Keep the original checkout, reminder constraint, other processes and scientific claims untouched. Continuous work through the full V1 goal remains authorized.

---

# Resume at v0.62.0 final release CI

September 14, 2026. This section supersedes the earlier statuses below. Source/review and retirement application code is verified at a2e0493571758542c01d1a81d6851d12b83e7e70. Local full QA and shuffled seed 619145 each passed 15,502 tests with 583 explicit skips; lint, configured dead-code check, provider checks, audit and webpack/TypeScript build passed. The 22 retirement mutations and five release-ledger controls passed. Both desktop/390px retirement journeys completed with enabled review controls, actual 410 refusals, unchanged native historical fields and no console/page errors. Historical-format component layout is explicitly synthetic; initial charset and proof-runner errors are retained. Read RELEASE_VERIFICATION.md and linked manifests.

Release metadata is prepared for v0.62.0 with 346 migrations through 20261014000027. Next: inspect final main CI, RLS Isolation and populated Upgrade Path on the release commit before creating the non-draft v0.62.0 tag/release. The main/branch push is the next checkpoint action; verify remote heads rather than assuming it completed. No PR or human software-release review is needed. After publication, record actual identities/results and continue M9b exact-output approval, source-to-response/decision links, reviewed exports and optional complete resumable generation. Do not mark M9b or V1 complete.

The owned production server was started at port3262 from a2e049357175 with exec session97599 and log /tmp/openplan-retirement-server.log. Recheck actual processes after interruption. Its application code matches the release except package/release metadata. The named DB remains supabase_db_openplan-restore-target-2026091050 on API29821/DB29822, installed migrations mode. Prior full isolation passed 612 tests; all 52 worker suites and populated upgrade run34901731600 passed on unchanged schema/worker/server custody. Keep the other checkout and pending reminder constraint untouched.

---

# Resume at legacy retirement browser and final QA

September 14, 2026. This section supersedes the older checkpoint headings below. The isolated checkout and branch are unchanged. The legacy synthesis write is now retired, historical summaries remain readable, and outdated Generate directions are removed. Nine focused suites passed 130 tests; all 22 mutation cases produced expected outcomes and restored their sources. Read RETIREMENT_VERIFICATION.md and retirement-mutations.json for exact boundaries and retained proof errors. The final six screenshot states of the earlier 6bbdf609 review build have now all been inspected at desktop and 390px; review-browser-final-layout.json records the evidence.

Next: finish changed-file lint, commit/push this candidate, stop only our identified 3262 production server, run full QA and shuffled seed 619145, build and identify the new candidate. render-legacy-fixture.ts runs through the application's installed tsx with its tsconfig and produces a private synthetic layout fragment. browser-retirement.cjs then runs at PROBE_WIDTH=1440 and 390 with PROBE_COMMIT set to the served 12-character SHA. It uses real navigation and native read-only before/after checks against the named isolated DB; the historical component-layout fixture is explicitly synthetic because that database has zero legacy summaries. Inspect both image sets, preserve failures, and update evidence before direct main landing and the next minor release. No PR, human release approval or paid provider is needed.

Original/correction custody, 612 installed RLS checks, 52 worker suites and populated upgrade have earlier passing evidence; schema and these workers are unchanged by retirement. Final main/release CI is still required before tagging. The full M9b and V1 scope remains open, including optional complete resumable generation, exact-output approval, response/decision links and reviewed exports. Recheck processes after interruption and never assume a job survived. Do not touch the other checkout or pending reminder constraint.

---

# Usage reset checkpoint after final browser runs

September 14, 2026. This section supersedes the older checkpoints below. Owned checkout: `/home/nathaniel/.local/state/openplan/translation-command-workflow-2026-09-13`; app package `openplan/`; branch `work/engagement-decision-traceability`. Application commit `6bbdf6091064f97b7241e5e54e7e57388d5fd2f4` is pushed. This checkpoint does not land or release the unfinished increment. User continues to authorize direct verified main landing without PRs and development through the full V1 contract.

Full QA and shuffled seed 619144 on the recovery fix passed 15,492 tests with 583 explicit skips. Installed RLS passed 612 tests in 64 files on `supabase_db_openplan-restore-target-2026091050`, API 29821 / DB 29822, with 346 migrations through 20261014000027. All 52 worker suites passed. Populated upgrade run 34901731600 passed. The subsequent CSS-only 6bbdf609 fix passed 33 focused tests, changed-file lint and production build. See REVIEW_UI_VERIFICATION.md for evidence and limits.

Both final browser runners have finished and their result JSON records completed=true and no page errors. Private evidence directory: `/home/nathaniel/.local/state/openplan/response-write-probe-20260913/decision-context/browser`. Final files are `synthesis-reviews-390-1789425085944.json` and `synthesis-reviews-1440-1789425133001.json`, with matching screenshot prefixes. Final screenshot visual review is still pending; do not equate runner completion with visual acceptance. The earlier narrow-layout failure is retained in review-browser-before-layout.json. Concurrency evidence is `synthesis-review-concurrency-1789424729262.json` from the unchanged backend on 7608831f.

Next: inspect both final screenshot sets and console details, record final evidence, then retire the old capped legacy Generate write path while retaining honestly labeled read-only historical results. The existing translations 410 route and executable refusal test are the pattern. The old synthesis route caps comments at 300, omits survey responses, and can return success after a failed save; do not release this workflow with misleading live generation claims. Complete applicable verification, land directly on main, inspect final CI, and prepare the next honestly bounded minor release. Full M9b still includes exact-output approval, optional resumable generation, response/decision links and reviewed exports.

At checkpoint no browser-review process remained running. The owned production server was started on 3262 from 6bbdf609; recheck process ownership and use which-openplan.sh before any browser work after reset. Do not assume servers or jobs survive. The original checkout has another Codex session and remains outside this lane. Leave the pending reminder constraint untouched. Use installed migration mode on the named DB, not old candidate flags. Do not run mutation scripts concurrently with builds or edits to their production files.

---

# Current recovery fix and remaining browser acceptance

September 14, 2026. This section supersedes earlier checkpoints. Work remains in `/home/nathaniel/.local/state/openplan/translation-command-workflow-2026-09-13`, application `openplan/`, branch `work/engagement-decision-traceability`. Main remains 09c1cd17, latest published v0.61.1. No PR, main push or release is created by this checkpoint.

The connected review editor/API exists. Full QA on 33b9474f passed 15,490 tests, 583 explicitly skipped, and completed lint, dead-code, provider connector, audit and production build. Full installed isolation passed 612 tests in 64 files against the named stack at API 29821/DB 29822 with 346 migrations. All 52 worker suites passed. GitHub populated upgrade from v0.61.1 passed in run 34901731600. Read REVIEW_UI_VERIFICATION.md and review-connected-checks.json for precise evidence and original runner errors.

A subsequent combined regression exposed loss of quota-failed text after focus/storage revalidation. This checkpoint fixes it with source-scoped on-screen recovery while private inspectors revalidate. Reopening history cannot overwrite that text, and its source history shows recovery needs attention. Leaving/reloading with unavailable storage still requires preserving or copying the text; memory is not disk durability. Focused tests now total 25. All 42 mutation cases produced expected outcomes, source hashes were restored, and changed-file lint passed. Browser/database/worker permissions were not widened.

Next run shuffled seed 619144 and full QA for this fix, then start an owned production server on confirmed-free 3262 with this candidate commit recorded. Identify it with which-openplan.sh. Existing .next was built from 33b9474f and does not include the latest recovery fix. Run browser-reviews.cjs at 1440 and 390, inspect screenshots and console, then browser-review-concurrency.cjs with PROBE_REVIEW pointing at a completed journey. The browser runner now forces storage failure and real tab switching in addition to exact interrupted retries, original/corrected hashes and membership correction. It has not yet been run for this implementation. Fix any demonstrated defect before landing directly on main. Final main/release CI remains required before tagging.

Do not rerun mutation scripts while building or testing their production files. Recheck live handles/processes after any interruption. Remaining M9b work includes exact-output approval, optional resumable generation, response/decision links and reviewed exports; the complete V1 goal remains active. Keep the original checkout and pending reminder constraint untouched.

---

# Weekly usage checkpoint — September 14, 2026

This section supersedes all historical status below. The connected review editor and recovery work is saved by this checkpoint commit on `work/engagement-decision-traceability` in `/home/nathaniel/.local/state/openplan/translation-command-workflow-2026-09-13`. Main and release are not advanced by this checkpoint. No PR is needed or authorized.

Latest focused run: 23 tests passed. Mutation proof completed: 38 cases, all expected outcomes, production sources restored. The earlier old-revision editability mutation survived an insufficient assertion; the assertion was strengthened and the final targeted fault fails. The original failed proof remains in the private evidence directory. Installed review/source/native join suites passed 50 tests. The named isolated database has 346 migrations through 20261014000027; do not use the older candidate migration flags.

No owned mutation, Vitest, or review-browser process was running at this checkpoint. No application server was started for this increment. Logs were copied from /tmp to `/home/nathaniel/.local/state/openplan/response-write-probe-20260913/decision-context/`. Recheck processes after the reset; background execution is not guaranteed.

Resume with final lint/type checks, full QA, shuffled tests and full installed RLS isolation. Then build an identified candidate on the owned port and run `browser-reviews.cjs` at desktop and 390px, inspecting screenshots, console, keyboard navigation, exact interrupted retries and original/corrected custody. Actual concurrent corrections, applicable upgrade checks and final GitHub CI remain required before landing/release. Browser script is prepared but has not been run. Do not describe this checkpoint as a completed UI or release.

Continue the existing full V1 goal and roadmap after this increment. Preserve other sessions, original checkout ownership, pending reminder constraint, local/free operation and scientific limits. No renewed permission or human release approval is needed. Same-thread continuation should start by reading this file and current git/CI/process state.

---

# In progress: connected review editor

September 14, 2026. Work after c110c36d is currently uncommitted. New files are synthesis-review-recovery.ts, synthesis-review-editor.tsx and their focused tests; engagement-synthesis-sources.tsx mounts the editor and reopens the selected source after focus revalidation. The editor retains unfinished text, freezes exact commands, keeps original revisions, handles source membership, and preserves failed browser-storage edits before moving them aside. Verification is ongoing; do not call this browser accepted yet.

Migration 20261014000027 was copied byte-for-byte and applied additively to the named isolated stack with `supabase migration up --local --workdir /home/nathaniel/.local/state/openplan/openplan-restore-target-2026091050`. The stack now has **346 installed migrations through 27**. Use installed mode for review native tests, not OPENPLAN_SYNTHESIS_REVIEW_CANDIDATE=1. Log: /tmp/openplan-review-migration27-up.log. No reset or drop occurred.

Fresh isolated Chrome access was confirmed via the authorized repository Playwright harness and installed Chrome channel. No app server has been started in this turn; port 3262 was free at the migration checkpoint. Identify the actual build with which-openplan.sh before browser claims. The previous source panel focus handler unmounted its inspection; it now reopens the same selected source, and the editor restores its scoped browser draft. A failed local write keeps the newest text on screen and can preserve both the existing stored bytes and the newest draft.

Current tests and jobs must be inspected from live processes/logs before rerunning: /tmp/openplan-review-ui-tests.log, /tmp/openplan-review-ui-types.log, /tmp/openplan-review-installed-rls.log. Final mutation evidence and browser acceptance do not yet exist. No new release or main landing.

---

# Latest: retained review server and API

September 14, 2026. This section supersedes the checkpoint state below. Read REVIEW_SERVER_VERIFICATION.md and review-server-evidence.json before resuming. The previous goal turn made progress by saving 2f23e0eb; this turn adds real review server/API behavior and native TypeScript-to-RPC evidence.

The source preparation code remains on main at 09c1cd17. CI 34892120409 and RLS 34892120481 were rechecked live and are successful. The current review work is backed up on work/engagement-decision-traceability; that branch has no GitHub runs for 2f23e0eb. Do not confuse the successful main runs with verification of the unfinished review interface.

Review records, server read/retain logic, strict private API reads/history and bound correction POST now exist. Pure/server/API mutation checks and the native production TypeScript/RPC join are documented. The previously missing server/API work in the historical next-step list below is implemented. **The next task is the connected review editor and pending-command recovery in the saved-source inspector.** The unchanged route-caller guard currently fails exactly for the new reviews endpoint. Do not add an exception or a fake caller.

The named stack still has 345 installed migrations. Migration 27 has only run in rollback transactions. Review UI/browser evidence, actual multi-session concurrency, full QA/shuffle/installed isolation/upgrade remain outstanding. No release was tagged and V1 remains active. Use the same isolated checkout and preserve the other session's original checkout. All synthetic native fixtures and injected SQL faults roll back; no owned application server was started.

---

# Weekly reset checkpoint: retained review implementation

September 14, 2026. This section supersedes the older restart state below. The user asked whether work can resume in this thread after the weekly reset. Preserve this checkpoint and resume the same V1 objective; no new product decision or permission request is needed.

## Saved work and release boundary

Completed preparation work is on main at 09c1cd178ef014021a6d3c5701392c9e7d54d8ca. Its CI 34892120409 and RLS 34892120481 were observed successful in the preceding implementation turn. Remote main and the work branch were both confirmed at that commit before saving this checkpoint. v0.61.1 remains the last published release.

The new checkpoint contains the retained review content model, candidate migration 20261014000027, private append-only review/revision RPCs, focused tests, native custody fixtures, and mutation evidence. It is incomplete implementation, backed up on the existing work branch, not a release or a draft PR. Full QA, shuffled tests, installed RLS and API/browser integration have not yet passed for this candidate. Complete those before landing the increment directly on main.

Use /home/nathaniel/.local/state/openplan/translation-command-workflow-2026-09-13, package openplan/, branch work/engagement-decision-traceability. The original checkout remains owned by the other Codex session. Recheck ownership before editing. This checkpoint owns only the review model, migration, tests, fixture correction, test registration and review notes listed by its commit.

## Verified at the reset checkpoint

- Pure review model and migration inventory: 36 tests passed. Changed TypeScript files passed ESLint.
- Model mutation proof finished and restored both source files: baseline, harmless control and 26 targeted faults had their expected outcomes. See review-model-mutations.json and prove-review-model.py.
- Native candidate review custody: 31 tests passed in 53.45 seconds, including harmless controls, equal-timestamp pagination and targeted broken guards. These transactions roll back; migration 27 is not installed.
- The source fixture previously counted every campaign globally. Persistent browser sources exposed that test defect. It now includes an unrelated campaign control and counts only its own campaign; a targeted mutation restoring the global count fails.
- No review API or UI has been implemented or browser-verified. The native fixture uses an explicitly synthetic preparation payload and proves database custody, not compatibility with production TypeScript preparation or the future reader.
- No owned mutation/test job remains active after these checks. No app server was started for this checkpoint. Do not assume processes survive a reset.

Logs are retained in the private evidence directory and hashed in review-reset-evidence.json. Tests skipped by a full suite have not been reclassified as passing. No production data, schema reset, paid provider, reminder constraint, release tag or other session was changed.

## Resume here

Read RETAINED_REVIEW_DESIGN.md and IMPLEMENTATION_BOUNDARY.md, then inspect current git state, CI and processes. The named stack remains supabase_db_openplan-restore-target-2026091050 at API 29821 / DB 29822, with 345 installed migrations through 20261014000026. Candidate tests opt in with OPENPLAN_SYNTHESIS_REVIEW_CANDIDATE=1. Do not run the older source candidate proof, which requires baseline 343, against this stack.

1. Rerun the existing source native suite after its fixture correction. Verify candidate catalog counts 269 relations, 255 tables and 255 RLS-enabled tables inside a rollback transaction. Review the new native tests' concurrency blind spots.
2. Implement the saved review reader and API. Verify source, exact preparation/content checksums, identity, intent and complete membership. Compute preparation/content on the server. Never accept browser-prepared authoritative bytes. Keep algorithm 1 reproducible for historical reviews.
3. Preserve exact request retries before recomputation or stale-head checks. Create review ID equals request ID. A correction names its parent revision ID/hash and reason. The service-only writer rechecks current staff role and compares the current head atomically. Refuse agent writes until the action registry supports them.
4. Add the interface under saved source inspection: create/reopen reviews, reasoned group and membership changes, full history, scoped pending commands, interruption recovery and private-content clearing after account changes.
5. Prove the actual TypeScript-to-database/API join, concurrency, desktop and 390px navigation, keyboard use, console behavior and recovery. Apply migration 27 additively only after candidate checks; run appropriate full QA, shuffle, installed RLS and upgrade checks. Push directly to main when ready, inspect final CI before any tag.

Approval evidence, optional resumable generation, response/decision linkage and reviewed exports remain part of the connected M9b outcome. The old capped synthesis generator remains separate. Do not mark M9b or V1 complete from this foundation. User authorization for local/free work, repository Playwright, direct main landing and continued development through the full V1 contract persists.

---

## Historical checkpoint notes

# Resume after complete source preparation

September 14, 2026. Full V1 remains the objective. v0.61.1 is published; no new synthesis release has been tagged.

## Current work

Use /home/nathaniel/.local/state/openplan/translation-command-workflow-2026-09-13, package openplan/, branch work/engagement-decision-traceability. The original /home/nathaniel/code/openplan belongs to another live agent. Recheck ownership before editing. Direct main pushes, no PRs, free/local operation and the repository Playwright harness remain authorized. Leave reminder constraints and other sessions alone.

Source selection/history/private inspection and exact browser recovery are implemented in 26eded0c. f3b7edff4b35a64e82bd0685d6a0cc7e3eda93e6 fixes the narrow recovery button; the final source build has passed desktop and 390px keyboard journeys. Read SOURCE_UI_VERIFICATION.md and source-ui-browser-results.json for precise checks and limits. Original source text/hash survives a category correction and can be reopened through saved history. Anonymous/stale-account reads are denied. A harmless DOM control survives the new inner-container layout assertion; removing the wrap constraints reproduces its failure.

The old capped synthesis generator remains separate and does not consume these saved sources. Read IMPLEMENTATION_BOUNDARY.md. Complete free preparation by historical category/question and source membership now exists and preserves not-assessed interpretation. Next persist staff review drafts, then continue durable optional generation, staff corrections, response/decision linkage and reviewed exports. Real survey submission to preparation now has browser coverage in PREPARATION_VERIFICATION.md; larger history/corpus and richer survey cases still need coverage. Do not mark M9b or V1 complete from this source foundation.

## Checks and CI

26eded0c passed full local QA and shuffled seed 619142: 15,431 tests, 549 skipped. Complete installed RLS passed 578 tests in 62 files. All 52 worker suites passed. f3b7edff passed its changed-file lint, eight panel/copy tests, fresh production build and both complete browser journeys. Database/worker/server logic is unchanged between those two commits.

GitHub CI 34886882906 and Upgrade Path 34886882938 succeeded on 26eded0c. RLS 34886882895 first failed at Supabase startup because the runner's port 54324 was occupied; the failed job was rerun and succeeded. At the weekly-reset checkpoint, main and the work branch were clean at 40e54ca813589392beeed11ff1a4dedf6eda5bec. Its CI 34888577052 and RLS Isolation 34888577005 were still in progress. Inspect their terminal results and any newer commit runs directly before any release claim. A push is not passing CI. No source/UI test failure was relabeled as infrastructure.

Logs have been copied from /tmp into the private artifact directory and hashed in source-ui-browser-results.json. The earlier failed full-QA run and runner mistakes are documented in SOURCE_UI_CHECKPOINT.md; do not restart them or treat them as current results. No owned test/browser job remains active locally; check current process state after interruptions.

## Environment

The named isolated stack is supabase_db_openplan-restore-target-2026091050, workdir /home/nathaniel/.local/state/openplan/openplan-restore-target-2026091050, API 29821 / DB 29822. It now has 345 installed migrations through 20261014000026. Migrations 25/26 were applied additively. Never reset/drop. Registered native tests use installed mode here; the old candidate-only script requires baseline 343 and must not run here.

The owned production server at port 3262 served f3b7edff4b35 during acceptance. The owned server was stopped after acceptance; recheck the port/process rather than trusting this note. Credentials remain in the existing private account file used by browser-sources.cjs. Private evidence is under /home/nathaniel/.local/state/openplan/response-write-probe-20260913/decision-context/. The weekly-reset seven-file backup is superseded and must not overwrite newer work.

## Weekly-reset restart checkpoint

The user expects to resume this same thread after the weekly allowance resets. Complete preparation is now implemented and browser-connected. Read PREPARATION_VERIFICATION.md before continuing; next retain staff review drafts from the verified source and preparation. Resume with the current repository and CI state, then implement complete preparation and retained review under IMPLEMENTATION_BOUNDARY.md. All completed application work is pushed to main; this note is also committed and pushed. Conversation continuity does not require a browser or app server to remain running. Recheck process ownership, served-build identity and the named database before using them.

## Preparation handoff

Application commits 8ab73ec5 and ddb31bc0 add full deterministic preparation and repair focused membership spacing. Read PREPARATION_VERIFICATION.md and preparation-browser-results.json for exact QA, shuffle, mutation, native-sample and desktop/390px evidence. The prior next-step text above is historical: source preparation is now present, but persisted staff review drafts, optional generation, reasoned corrections and reviewed response/decision exports still need implementation. Use synthesis-preparation.ts from the verified source loader when creating the retained baseline; never accept browser-supplied machine-preparation content as authoritative. Keep exact request recovery and immutable original revisions. No review-table migration has been added; the named stack remains at 345 migrations.

No release is tagged for this preparation checkpoint. Inspect GitHub runs on the final evidence commit after push. Both 40e54ca8 and c0b94685 finished CI and RLS successfully. Final application build identity is ddb31bc0b02d. The owned server is stopped after acceptance; recheck live process state. The phone full workflow passed before its CSS-only correction; the corrected phone read-only history/layout check passed after a real submission-rate refusal, as recorded in verification.
