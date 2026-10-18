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
