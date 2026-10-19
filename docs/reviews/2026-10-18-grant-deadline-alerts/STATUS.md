# Grant deadline notices in My Work

October 18, 2026. Source candidate for M13e/B4, based on `cb73e2e61`.
This does not establish native database or browser acceptance.

Application-closing and pursue-or-skip deadline additions, changes and removals
append a journal event and creator notice in the opportunity transaction.
Each event retains its field, exact old/new instants, actor or unknown actor,
creator membership outcome and original opportunity. These are recorded OpenPlan
edits, with no assertion that the official funder changed its notice. Unchanged
instants create no event. A failed notice write aborts the opportunity write.

Migration `20261018000001_grant_deadline_changes.sql` adds the member-readable,
trigger-only journal. Direct journal writes and function execution are revoked.
The trigger refuses opportunity ID/workspace changes. Journal facts cannot be
updated; notice updates preserve facts while permitting existing read-state
changes. Workspace deletion retains its existing cascade semantics. Unknown or
departed creators remain explicit journal outcomes without an invented recipient.

Change notices have a separate event ID and no due date. Reminder keys include
kind so decision and application reminders can coexist. The missing application
sweep filters pursued opportunities before its cap, retains missed closed calls,
and excludes archived/awarded opportunities and completed pursuit states. It uses
workspace calendar windows and instant lateness, existing roster authorization
and reminder preferences. The existing live queue and deadline route are unchanged.
The inbox opens the exact opportunity through its workspace and rejects invalid
event/date shapes as an unavailable read.

## Checks and remaining limits

- Initial pre-restart run: 68 passed, one failed. The inbox copy lost the existing
  `due within 14 days` wording. Its correction was untested at the restart.
- Harmless comments survived: 109 source tests passed. Wrong pursuit filters,
  read-failure handling, event shapes, subject identity and SQL capture/access
  declarations failed nine targeted tests. Wrong badges/navigation failed three.
  Removed idempotency, required reminder dates, RLS and census registration failed
  eight checks. Removing the read policy separately failed the policy inventory.
- All mutation edits restored exactly. The restored run passed 126 tests in
  12.34 seconds; 25 live tests skipped. Focused lint passed. Runs used one worker,
  private cache, a 768 MiB Node heap and the shared nonblocking compiler lock.
- SQL guards inspect declarations and source inventory, not PostgreSQL execution.
  Fake-client tests assert query projections but cannot prove database constraints,
  permissions, transaction rollback or concurrent membership changes. Component
  tests use mocked navigation and cannot establish real browser behavior.
- Four isolated live transaction/access tests are authored and registered for
  later CI. They have not run or received native mutation controls. No SQL parser
  acceptance, migration application, full suite, build, global TypeScript check,
  service, external message or browser operation occurred in this lane. Root owns
  independent migration/access review, CI/RLS and identified desktop/390px checks.

## Return-projection test correction

The independent review found no concrete P1/P2 source defect in `4bc24e866`,
but identified a fake-client gap. Upsert returns now contain exactly the selected
flat columns while stored fixture rows remain complete. The two-kind regression
also asserts digest composition and duplicate suppression.

One finite non-PTY window acquired the existing compiler lock without waiting.
Its actual outer exit was 0. Harmless and restored runs each passed 58 tests;
scoped lint exited 0. Removing only `kind` from the production return projection
failed the intended digest assertion, expected 1 and received 0. Production and
helper bytes/modes restored exactly before the final run. Production, component,
migration and immutable review hashes match their original pins. The initial
68-pass/one-fail run remains failed. This fake covers flat return projections,
not full PostgREST grammar or native SQL behavior. Native/UI limits above remain.

Root integration adds the five-file recorded-date editor from `610ae3d66`,
byte-exact. Harmless and restored cohorts each pass 43 checks. Eleven targeted
permission, workspace, refreshed-prop, unchanged-field, clear, timezone, DST,
response, card-wiring, failure and cancel faults fail their intended assertions;
exact bytes/modes restore and scoped lint passes. The ordinary non-PTY wrapper
returns actual 0 before compiler-lock release. Backend, migration and prior
independent-review pins stay unchanged. Private logs remain in
`grant-deadline-editor-focused-20261018-01/`. Browser date widgets, normal
navigation and the resulting My Work notices remain to be checked.

## Root integrated database and browser checks

Migration 000001 passes four isolated transaction/access cases, a harmless run,
four intended database faults and the restored cases. Populated upgrade run
39169753517 passes on d2562c9c5. Hosted migration remains pending.

Identified local build f27566af458c exercises Dashboard to Grants, amendment,
cancel, phone-width clear and My Work. PATCH requests contain only deliberately
changed fields. The unchanged date retains its value; the cleared date stays
empty after the notice opens its exact opportunity. Desktop and 390px captures
show the editor and recorded old/new/actor notice without horizontal overflow.
A harmless annotation survives, a forced-width layout fault fails and restores.
There are no page errors, console errors or failed HTTP responses in the accepted
cohort. Background request cancellations remain recorded, so strict whole-run
clean status is false. An earlier 3 GiB preview restarts before completion. Two
notice drivers click before page JavaScript loads and time out; a separate fully
loaded-page run completes the exact link and retained-clear check. Those failed
attempts remain failed. This is agent-run local workflow evidence, not hosted,
full Stage A, simultaneous-session or official-notice verification. Private
receipts stay in v1-grant-combined-browser-20261018/preview03/browser04/.

## Rollout compatibility correction, source only

Independent r2 review rejects the targeted bridge: same-award obligation and
expenditure reminders can abort unrelated inserts. The failed candidate and full
objection remain private and immutable. The r3 source successor retains both
indexes but uses a service-only invoker batch RPC with targetless insertion.
Every request must classify as inserted, duplicate or explicitly deferred by
the old key. Only inserted rows enter digests. Application reminders remain
pending. Full kind coexistence requires separately admitted activation; proposed
000004 stays outside migration inventory and the bridge remains the later
rollback floor. All changed tests and SQL are UNRUN. Historical native targets,
receipts and failures remain untouched. Private successor:
`~/.local/state/openplan/v1-deadline-rollout-compatibility-20261018/r3/HANDOFF.md`.

Root ordinary checks, October 18: the staged batch successor passes all 100
affected tests and lint. A harmless edit survives. Nine targeted broken
behaviors fail their intended assertions, then all 100 tests pass again with
exact byte and mode restoration. These checks cover response validation,
inserted-only mail, deferred reporting and SQL source composition. They do not
prove PostgreSQL execution, locks, roles, concurrency or activation. New live
cases are included in the existing RLS CI suite. Independent r3 review remains
pending, so the PR stays draft and hosted migration remains held. Raw results
remain private under v1-deadline-rollout-compatibility-20261018/root-checks-02.


October 18, r4 source successor: the reminder RPC now returns one exact scalar JSONB envelope with complete nested outcomes. The r3 table-return cap finding remains accepted and its receipts remain historical. R4 ordinary checks, independent review and actual API/native rollout remain pending. Initial staged application reminders remain pending until a separate reviewed activation after old writers retire.

October 18, r4 checks: one finite ordinary unit exited 0 after 54.667 seconds. Harmless and restored batches each pass 118 tests. Seven targeted failures cover protocol, envelope shape, request coverage, classification counts, nested projection, table-return regression and scalar SQL declaration; source bytes/modes restore exactly and scoped lint passes. Independent r4 source review finds no concrete P1/P2. The API cap cases are models, not installed HTTP evidence. Native/API/upgrade, hosted migration and later activation remain pending. All rejected r2/r3 evidence stays historical.


October 18, CI allowlist correction attempt: both exact-head CI suites fail the
stale `work.ts` direct-write exception. Removing that entry makes the deadweight
assertion pass, but the one ordinary check window fails another assertion:
`enqueueEmail(client...)` in `work.ts` now enters the external helper-call census
and resolves as unknown rather than service-role. The harmless cohort passes
123 tests and fails one. The owned unit and outer window exit 1. Temporary edits
restore exact bytes and modes; the proposed entry removal remains uncommitted.
The stale-entry fault, restored cohort and lint do not run. No retry or commit
occurs. Existing scanner limits remain: RPC internals, dynamic targets and
forwarded client provenance require separate evidence. Raw logs remain private
under `v1-deadline-ci-envelope-correction-20261018/implementation/`. Prior CI and
native evidence stay unchanged; this attempt adds no hosted or SQL acceptance.


October 18, r6 forwarding-guard correction remains uncommitted. A separate
forwarding entry checks sweep entry callers and the exact parameter passed to
`enqueueEmail`; the stale direct-write exception stays removed. The harmless
guard control passes six tests. Reintroducing the stale entry fails the intended
deadweight assertion. A non-service cron client fails the intended provenance
assertion, with `caller-rls` in the raw diff. The control reader then fails because
Vitest abbreviates that diff in JSON. The unit and outer window exit 1 after
55.67 seconds; peak memory is 440,041,472 bytes, swap zero. The shared lock stays
held through restoration and terminal recording. All 15 pinned files, including
the corrected guard, restore exact bytes and modes. The wrong forwarding-client
control, restored notification/deadline cohort and lint do not run. No retry or
commit occurs. Raw logs remain private in `v1-deadline-ci-forwarding-r6-20261018/`.
This is incomplete source-guard evidence. Direct callee names and textual client
resolution cannot prove aliased/dynamic calls, RPC internals or runtime client
identity. The predecessor r5 failure and earlier acceptance limits remain.

Root completion check: the separate ordinary window returns actual exit 0 in 135 seconds. The harmless guard has six passing checks; the restored guard and deadline/notification cohort passes all 124 tests, with zero skips. Reintroducing the stale exception, passing a non-service cron client and replacing the forwarded client each fail the intended assertion. The reader uses the full retained failure log when JSON abbreviates a diff. Scoped lint passes and all 15 pinned files restore exact bytes and modes. Earlier failed windows remain failed. This validates source scanning and mocked behavior, not runtime client keys, dynamic aliases, RPC internals or hosted migration. Raw logs remain private under v1-deadline-ci-forwarding-root-20261018.
