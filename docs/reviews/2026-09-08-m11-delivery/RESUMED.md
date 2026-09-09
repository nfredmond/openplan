# M11 resumed engineering work, September 8 evening

This continues CONTINUE.md without closing M11 or changing its four increments.
The isolated branch remains `work/m11-delivery-closeout`. Main belongs to another
session and has not been changed. No subagents were used.

## Browser and runtime

Fresh unified computer use discovered Chrome and reached the landing page,
Overview, My Work, Projects, project A and its contract through actual navigation.
The preserved production build is 672db930, build ID `_guBwzE9ebM5i0xtc8aMf`.
The identity script correctly rejected HEAD 80792573 as an exact match; its only
difference was the handoff document. The stopped server was restarted on
http://m11.localhost:3247, tool session 15010, application PID 50715.

The machine restart cleared `/tmp`, including local fixture files and the
unfinished practice RPC helper. Committed evidence, the named disposable stacks,
and their synthetic records survived. New scratch work lives in
`/home/nathaniel/.local/state/openplan/m11-resumed-acceptance-2026-09-08`.

The finance browser session survived. Page rendering, desktop screenshots and
ordinary navigation work. Two revision-3 JSON link clicks reached Chrome's
ERR_BLOCKED_BY_CLIENT page. A supported downloadMedia call returned without
providing an inspectable saved file. Network-event capture was truncated and did
not establish the blocking component. Opening chrome://downloads was explicitly
rejected by the browser URL policy. No workaround was attempted for that denial.
Revision-3 downloads and old-byte re-download comparison remain unverified.

Temporary viewport testing was not accepted as visual evidence. The browser-level
override did not immediately affect the tab; a tab-specific override produced a
390px DOM but the captured image was cropped inconsistently with DOM coordinates.
The files `agency-forecast7-390.png` and `agency-forecast7-desktop.png` in scratch
are diagnostic failed captures, not acceptance images. Overrides were cleared;
the actual page returned to 1311 by 1302. Do not cite these failed files as a
passed responsive journey. Console inspection before these tool failures found
no page errors or warnings.

## Concrete defect and implementation

On the preserved build, changing the complete-source-coverage checkbox after a
preview left the earlier USD 625 actual-plus-remaining result displayed. Existing
tests changed the loaded server-state object, not form fields. The new regression
failed before the fix because the worker was not terminated. Form edits now
cancel a pending job, suppress its late reply and clear the completed preview.

Capacity lookup now caches per person and date within one calculation. Warning
identity uses a set, and display grouping appends without repeatedly copying
arrays. Dated revisions, overlaps, unavailable days and input changes remain
separate. New forecast format 2 adds each assignment reservation into one total
per person/date. Outside assignments still contribute to overload checks but
do not enter this assignment's output totals. Saved schedule inputs retain each
task reservation. Old forecast objects remain format 1 and are not rewritten.
The method hash stays unchanged because dates, money, warnings and reservation
totals have unchanged meaning; the output format states the representation change.

The measured maximum of 200 tasks, 100 people and 731 days originally generated
14,620,000 rows, used 2,015,803,480 heap bytes and failed JSON.stringify with
`Invalid string length`. See resumed-forecast-size.json. With compaction it
produces 73,100 rows, 6,388,564 JSON bytes, 156,744,472 heap bytes and completes
calculation in 35,558 ms. The parent worker heartbeat continues. The 40-task,
20-person, 180-day case has identical dates, money, warnings and summed daily
reservations against source 672db930. See resumed-forecast-compaction.json and
the reproducible measure-contract-forecast-size.ts script.

This is Node calculation/serialization evidence. It does not establish browser
structured-clone/render limits, worst-case warning volume, retained RPC payload
limits or maximum-size PDF/XLSX usability. Those remain implementation boundaries.

Controls retain one harmless survivor and eight targeted failures for missing
date keys, overlapping capacity, lost warning dates, lost reservation totals,
wrong output format, form-edit cancellation and stale previews. The focused
contract run passed 112 tests across 23 suites; 61 live tests in 12 suites were
explicitly skipped. Lint passed. The first typecheck ended with signal exit 143
and no diagnostic; that is not a pass. The typecheck rerun passed. A new production build remains
separately attributable. Inherited 80792573 GitHub QA, shuffled tests, workers,
RLS and restore checks are now all green; they do not cover these new changes.

## Synthetic agency continuation

Through the finance UI, reopening revision 4 retained the October 15 records-audit
obligation. It has hash
`efd730d4ddd4d809b7d518544c21b9ec86633388b48b0164e0ce2310b8d56b56`.
Revisions 1 and 3 retain their original hashes from CONTINUE.md. Assignment A is
currently reopened and therefore reserves staff time again.

Schedule version 5, `68806792-5806-42aa-b3b7-2abc451b4e58`, retains synthetic outside
review start and finish September 9, after the September 8 staff finish. The
evidence says this expedited review replaces the old October 2–3 expectation;
separate deliverable acceptance and the continuing records obligation are intact.
The real bundled browser worker displayed a preview with September 9 supported
finish, zero remaining cost and USD 625 actual plus remaining. The durable worker
then retained forecast 7 at 2026-09-09T02:18:18.358309+00:00, with unchanged inputs.
The calculation worker was running this checkout, including the equivalent cache
optimization; production browser code was still 672db930. Neither this synthetic
receipt nor the UTC-date exercise is actual agency review evidence.

The UI issued report `b9a42499-c42a-4693-925d-4354fc62cb62`, format 7, hash
`e321e35cc70bf8503cfdbf3ab5cbc060b8ba1d8fd817a958f0348589d82f6ca6`.
It retains reopened state, both earlier closeouts, completed-review evidence and
forecast 7. It is a newly issued snapshot, not yet an accepted downloaded artifact.

Document worker interruption used pidfd and verified PID/cwd/command ownership.
The first monitor query mistakenly referenced an absent `attempts` column and
sent no signal. The corrected monitor observed PDF job
`be00fec3-ed4b-43fd-a490-7b6a5d6695bc`, document
`801468f0-9055-4053-8b7a-50280d9a8b17`, in running state and killed only the owned
worker PID 58894. Its real lease expires at 2026-09-09T02:39:09.695401+00:00.
A replacement worker started in session 72965 on the same persistent export root.
No lease timestamp or job state was manually changed. Completion, exactly-one
publication and current UI delivery must still be checked after natural recovery.

## Remaining scope

Continue the full remaining list in CONTINUE.md. In particular, B's browser
forecast/capacity-release case and the full small-practice case are not complete.
Consultant correction, accounting routing, new artifact delivery/reconstruction,
current-build desktop/390px acceptance, maximum adverse loads and cutoff/commit
visibility remain open. The source-change journal uses transaction-start `now()`;
the existing single-transaction cutoff probes cannot settle delayed commits.
Do not globally switch command isolation without re-proving master/invoice
concurrency after advisory-lock waits. PostgREST supports function-specific
isolation, but no cutoff/isolation repair was implemented in this checkpoint.
References: https://postgrest.org/en/stable/references/transactions.html and
https://www.postgresql.org/docs/14/transaction-iso.html.

The notification CHECK replacement remains unauthorized and unapplied. Agency PM
observation and independent human finance acceptance remain absent. No release,
tag, merge, external authority or M11 completion is claimed.

## Second safe checkpoint, before requested history audit

User now explicitly requests complete prior-session history reconciliation, then
consolidation of all OpenPlan branches, PRs and uncommitted work from the last
week into main without losing agent work. This supersedes the earlier no-merge
scope, but requires checking current ownership and preserving every checkout.

Production build aa66ac63 completed. Its server restarted in session 21387 on
3247; which-openplan reports matching checkout and commit. A fresh Chrome tab
1406501439 loaded this build. The real preview showed USD 625 and September 9
finish. Unchecking coverage removed the working preview while retaining reviewed
forecast 7. Console warnings/errors were empty. Desktop viewport was 2616x1226.
The confirmed capture is persistent scratch/aa66-preview-cleared-desktop-confirmed.png.
The first same-call capture was stale and still showed the previous state; it is
not evidence of clearing. A separate later capture matches the DOM. Mobile
acceptance remains open. Browser access remained available.

The new practice RPC test passed in the named disposable M11 stack and rolled
back its complete fixture. It exercises real JS normalization plus SQL writes for
fixed-fee gross billing 1000, incurred cost 200, released commitment, payments 965,
credits 50, refunds 10, debit adjustment 5, released retention and dispute, open
balance zero, corrected payment history, separate deliverable events, closeout
with 300 underspend and a continuing records obligation, CSV reconstruction and
immutable reopening. The starting invoice is seeded, not created through the
invoice UI. This does not establish a full practicing-consultant browser journey.
A harmless comment control survived; reversing the credit sign failed at open
balance 100 versus expected zero. Sources were restored; typecheck passed.

The first test failed on re-normalization of the completed closeout's original
hash. This is a real request-path retry gap, not a financial-fixture error. The
updated test distinguishes successful replay of the exact normalized SQL command
from the currently rejected re-normalization. HTTP/durable-worker retry semantics
must be investigated and repaired where required. No claim of end-to-end retry
success is made. One attempted rerun used nonexistent `python` and the repository
root instead of the app root; it failed before running tests. The corrected run
used python3 and the app root. These failed invocations are not passes.

The naturally reclaimed interrupted PDF job succeeded. Its single retained
document 801468f0-9055-4053-8b7a-50280d9a8b17 has 1,578,600 bytes and SHA256
2dbbb2f85abe073341336b60fff22570261a1db994ceb97cf9e7c2df13c4cb05.
The job is be00fec3-ed4b-43fd-a490-7b6a5d6695bc. Storage-object uniqueness and
actual browser file delivery still need checks. A status query first used the
wrong lease column name; the successful query uses lease_until.

History source located, not yet fully read:
/home/nathaniel/.codex/sessions/2026/09/08/rollout-2026-09-08T10-34-23-01a08215-d429-7813-8747-178f4af31327.jsonl
It contains 9,439 JSONL records and 158,403,031 bytes. Much is repeated tool-event
output and encoded screenshot data; it also has encrypted reasoning fields.
The next audit must track all records and explicitly identify any inaccessible
content, duplicates, source truncation or necessary credential redaction. Do not
claim the history was read based on this structural inventory.

### Retained-closeout retry repair

The history review confirms retry-safe requests are part of the user's plan.
Normalization now recognizes a previously retained closeout request and passes
its original caller payload to SQL's existing exact-request/actor check. It does
not recalculate against the later source hash or substitute a saved payload for
an altered caller request. The live disposable practice case now replays exactly,
refuses altered title and different actor, and refuses a new request with stale
inputs. The real API adapter also exercises the replay path.

Seven API/live checks pass. A harmless comment survives; removing the retry path
fails both suites, and replacing the caller's payload with the stored one fails
the altered-request rejection. TypeScript and focused lint pass. These checks do
not establish an actual browser disconnect after commit. The served browser build
is still aa66ac63 until rebuilt; no newer browser acceptance is claimed.
