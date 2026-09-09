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

### Issued downloads, reconstruction and recovery acceptance

A fresh supported browser tab (1406501442) successfully delivered the issued
format-7 PDF/XLSX, closeout revision 3 JSON/CSV and fresh copies of revision 1.
Using the documented download event followed by the actual download link worked.
This supersedes the earlier delivery blocker; the precise cause of the earlier
failed clicks remains unproved. No blocked browser-internal page was retried.

The PDF download is 1,578,600 bytes and matches the retained checksum above.
Read-only database inspection finds exactly one job for its document, one PDF
document for its report, and one stored object matching its checksum. Thus the
natural-lease document-worker recovery produced one retained, delivered artifact.
A first query guessed storage_path and failed; the actual field is storage_ref.

Revision 3's downloaded JSON/CSV independently reconstruct USD 625 incurred,
60 hours, USD 175 underspend, zero invoice balance and one continuing obligation.
The format-3 reconstruction additionally checks each original invoice file receipt.
Whitespace survives; missing receipt, changed checksum, changed file identity,
zero-byte original and wrong format each fail at their intended assertion.
See resumed-closeout3-reconstruction.json and resumed-download-controls.json.
Both fresh revision-1 downloads are byte-for-byte identical to the older files.

The actual 136-page PDF was rendered and all pages visually inspected in labeled
contact sheets; settlement and reopened revision pages were also inspected at full
render size. No obvious clipping was found in that inspection. The PDF preserves
separate payment, credit, refund, cost, closeout, reopening and obligation history.
This is an overview layout inspection, not human review of every source statement.
One multi-image tool output was context-truncated; those pages were explicitly
reopened in smaller calls, so no page group is silently counted as inspected.

The downloaded workbook has 49 sheets and no error-typed cells. An isolated
LibreOffice profile rendered all sheets to 56 pages; all pages were visually
inspected in contact sheets. Wide audit tables print small; the workbook retains
its full cell data and separate long-text sheet. This is not a claim that the
wide workbook printout substitutes for the PDF or that each cell was independently
reconciled. Its source SHA256 stayed unchanged after read-only rendering:
a0c0d77a232ff591cae39bc4beedba6b36881176fe50d7efe5805d46447d19d5.
Raw synthetic files, renderings and browser receipts remain in the persistent
local acceptance scratch directory. Independent human finance acceptance is absent.

Exact-head GitHub CI for 4a8acb20 passed QA, shuffled order, live RLS, restore,
worker, modeling and ops suites. This is separate from the still-served aa66ac63
browser build and from the remaining journeys and cutoff/concurrency work.

### Delayed-commit defect and conservative source visibility repair

The requested history review led to a real two-session probe. An engagement title
changed in a transaction started before the chosen cutoff and committed after it.
The old reader returned the changed title without a cutoff conflict. The exact
failed boundary is recorded in resumed-delayed-commit-probe.json. Its original
title-to-itself control also changed updated_at through a trigger, so it was not a
true harmless mutation. The repaired probe uses a zero-row UPDATE as its control.

Migration 20260929000001 adds immutable first-observation receipts to the source
journal and covers the mutable and immutable source tables read into management
reports. Another transaction's source must have been observed by the cutoff;
otherwise report issuance refuses it. First observation is an upper bound on
visibility, not an invented commit time. Same-transaction inputs remain known to
their issuing transaction and publish atomically with its report. Existing issued
reports are untouched. Cutoffs preceding installation or first observation can be
refused even when some records actually committed earlier; a fresh management read
and later cutoff restore reporting. No global isolation change was made.

Both explicitly disposable M11 stacks applied migration 29. The final function
orders new observation inserts by source ID to keep concurrent insertion order
consistent; that exact function was applied to both stacks after the initial
migration. The two-session probe now refuses late mutable title and immutable
estimate sources, permits fresh reports and exact retries, and denies direct
authenticated access to the timing receipts. All 63 contract live tests pass.
Removing the visibility comparison fails at the late title; disabling the estimate
journal trigger fails at the late estimate; a harmless comment survives. Controls
ran on the separate upgrade stack, and the function and trigger were restored.
The column inventory passes, rejects omission of the observed_at classification,
and survives a harmless comment. This is representative concurrency evidence, not
an exhaustive proof of all possible schedules or source adapters.

The workbook cell checker initially assumed a shared-string table and failed;
the corrected inline-string-compatible check confirmed 49 sheets, no error cells
and unchanged bytes. A quoted Vitest glob found no files; the corrected expanded
invocation ran the 63 live checks above. Neither failed invocation is a pass.

A separately owned headless installed Chrome, using the repository's Playwright
recipe, successfully captures actual 390px screenshots. The CUA connector still
times out on Page.captureScreenshot with emulation, even with explicit bounds;
its emulation and viewport override were cleared. No blocked browser-internal
page was retried. Five disposable synthetic test logins were rotated and saved in
a private local scratch file to resume role journeys; no real account changed.
The new production build is 5c7627b2, with full-SHA runtime stamping and a matching
which-openplan receipt. An earlier missing stamp and then eight-character stamp
were corrected; the identity helper compares the twelve-character health value.
Browser role and remaining shared-capacity journeys continue on that build.

The full QA run at 7012cae3 passed lint/deadcode and 13,395 tests but failed one
schema-inventory assertion: the new relation was not included in its expected
count. The live catalog confirms one new RLS-enabled table with zero policies.
The inventory now counts 242 relations, 229 tables and 229 RLS tables. Its 36
focused checks pass (three live drift checks were skipped in that focused run);
a harmless comment survives and reverting the relation count fails for 242 versus
241. The complete QA gate has not yet been rerun for this correction.

The original populated v0.46 baseline, two actual versions and physical time
still produce canonical SHA256 a6b1bfe272ecc1b77c37730603d9a0267878f7ec5a09bb50a0a1803fa42b31ca
on the upgraded stack after migration 29. The comparison query was recovered by
reading complete history chunks 88 and 721. Those chunks are marked read in the
local ledger; no other bulk chunks were silently marked. The original temporary
before.json is gone, so this compares against its prior committed checksum rather
than claiming the old file was recovered. See resumed-populated-visibility-upgrade.json.

### Shared-capacity release, reclosure and expanded checks

The synthetic owner entered B's 20-hour, 5-hour/day update through Projects →
Weekly assignment management → Updates, then reviewed its exact version with a
USD 200 remaining-cost assumption and unassessed billing. Forecast 1 retained
9 reserved hours against 8 available and no supported finish. Actual desktop and
390px screenshots show the warning; outside assignment details remain withheld.

B's changed inputs made A forecast 7 stale. The owner reviewed A forecast 8,
retaining zero remaining work, September 9 completion and USD 625 actual cost,
then retained closeout revision 5 through the form. Revision 5 preserves USD 175
underspend, zero invoice balance and the open October 15 records obligation.
Its downloaded JSON/CSV independently reconstruct the same figures. Revisions
1–4 retain their hashes. See resumed-closeout5-reconstruction.json.

Closing A made B forecast 1 stale and released A's reservations. B forecast 2 now
supports September 14 while keeping the October 15 approved deadline, USD 200
estimate, explicit September 9 unavailability and unassessed expected billing.
No B schedule, baseline or resource allocation was changed to obtain that result.
The previous overload remains retained. At 390px there is no document overflow;
the date table scrolls within its container. Tab reaches that container and Arrow
Right moves it 40 pixels, exposing later columns. Page errors were empty. These
are synthetic owner actions, not independent PM/staff/finance acceptance.
Selected screenshots and resumed-shared-capacity-browser.json retain build
5c7627b2 and migration-29 identity. A preview cleared on a later state refresh;
the retained comparison, rather than an expired preview, was inspected.

The full QA rerun passed lint, deadcode checks, 13,396 tests, production dependency
audit (zero vulnerabilities), TypeScript and webpack build. The ordinary gate
explicitly skipped live RLS; it does not prove that boundary. The established
34-file live command separately passed 230 tests. I then found that it omitted
both newly added practice-retry and source-visibility files; those had only run
in focused checks. Both are now explicitly included in test:rls-live, and the
expanded 36-file command passed all 232 tests on the disposable upgrade stack.
The QA build used f563e1d7 application sources; the only edit while it ran was
adding those two live-test command entries. Exact-head CI remains a separate gate.

The owned production server was stopped as QA entered its build phase. The
already-loaded browser captures retain their preceding-build scope; they do not
claim to show the new bundle before restart. Browser selector waits for a heading
that was actually a details summary timed out; the retained forecast succeeded
and was read with its actual text. Signing out goes to the public home, not the
sign-in URL; that test expectation was corrected without changing product code.

### Newly exposed failures after 37a3c22f

The newly registered practice RPC test failed on the disposable GitHub runner
because its explicit local container allowlist omitted that runner. Source
visibility passed there. Exact-head CI is not green. The local-only exception is
being extended solely to supabase_db_openplan when GITHUB_ACTIONS is exactly true.

The maximum unknown-capacity case (200 tasks, 100 staff, 731 days) exhausted its
2 GB Node worker heap and fatally aborted with exit 134 at roughly 50 seconds.
The prior maximum known-capacity pass did not cover this shape. The process died
before writing its JSON receipt; the fatal GC/tool output is the evidence.
Shared warnings are being compacted without deleting dated unknowns or task
attribution; browser/RPC/export acceptance of that change remains pending.

A fresh consultant My Work journey exposed misleading submission instructions
for the closed synthetic A assignment. Retained invoice access is appropriate;
closed-state labeling and prevention of new submission remain to be corrected.
No human PM or independent finance acceptance has occurred.

The adverse maximum now completes in 46.9 seconds of worker time, 239,801,936
bytes heap, with 73,100 shared dated capacity warnings, 200 unresolved task
finishes, and 23,411,056 serialized bytes. Format 3 stores exact affected-node
bits against that forecast's retained node order. It does not remove unknowns
or alter format 1/2 results. Exports retain a separate scope-to-task mapping,
avoiding duplicated warning text for every task. The UI paginates explanations
and only renders dated details when opened. Node evidence is not browser or
maximum durable-RPC evidence.

Migration 30 reuses caller-bound contract_open_for_work in the consultant view
and includes the same authorized closed state in management reads. Closed invoice
history remains reachable; new submissions, correction and review forms are
hidden while closed, or when state is unknown. Both named disposable stacks
received the additive migration. Seventeen focused live tests passed, including
closed/reopened consultant state, retained access and source visibility. The
practice RPC and exact disposable-stack guard separately passed.

Nine warning/closed-state controls distinguish harmless source comments from
lost task attribution, lost export mappings, old-format reinterpretation, closed
forms/prompts, omitted query fields, an overbroad stack allowlist and missing
pagination. Each source was restored. SQL controls run inside rollback-only
transactions; their separate receipt records the result. No real client records
or authorized human decisions were used.

The restore CI failure on 37a3c22f was also the practice stack allowlist: the
restore drill uses supabase_db_openplan-restore-target-NNN. That exact numeric
pattern is now accepted; source-stack and arbitrary suffix names remain refused.
The earlier Docker rate-limit message recovered and was not the final failure.
Other 37a3c22f QA, shuffled tests and worker/modeling/ops jobs passed. New-head CI
will determine the corrected state.

A mistaken edit command used repository-relative paths from the package root and
changed no files; it was rerun in the intended root. A later focused test command
named a nonexistent inventory test, so only the existing practice file ran; its
two passes do not claim inventory verification.

Full QA at 916798e9 exposed one missed release-document entry for migration 30.
Its focused predecessor checks had not covered release ordering. The changelog
now names the migration and format-3 warning behavior. This is a real failed
gate and repair, not a claim that the initial full run passed.

### Consultant-owned correction and committed-response interruption

On build 5218ceb8, the owner explicitly granted synthetic consultant access to B.
The consultant entered SYNTH-CONSULTANT-B-01 with an intentionally incorrect
USD 27 source CSV. The owner returned exact version 1 with a correction reason.
The consultant reached the returned invoice through My Work, corrected it to
USD 25 at 390px and uploaded the corrected CSV. The browser proxy waited for
the server's 200 response/version 3, then deliberately aborted that response.
The retained browser request replayed successfully and local pending state cleared.
The actual downloaded source is retained locally for byte comparison. This is
post-commit received-invoice recovery, separate from queued-closeout recovery.

Recovery revealed that the child form still held the old returned version after
the parent successfully reloaded. Selection is now derived from the latest
returned version; a submitted or superseded version cannot keep a correction
form open. Focused controls and rebuilt-browser verification remain pending.

Fresh consultant console: two 404 responses for /api/assistant/context on the
scoped contract page, plus the deliberate net::ERR_FAILED interruption. The
earlier reused session had one unattributed 401 during restart; it was not
reproduced in this fresh login. Do not report an entirely empty console.
Browser automation also corrected case-sensitive Sign out selectors, a mistaken
link selector for a details caption, and a reload issued before navigation
completed. Those selector/time-order failures are not successful journeys.

The consultant correction has exactly three invoice revisions: submitted 27,
returned 27, submitted 25. All retain the consultant's submitted_by identity.
The corrected download matches its uploaded CSV SHA-256
07490852b9667b2247a86a9ddc966a0bdb8c4faceecd9b04aae17d233eb9fea5.
The replay produced no fourth invoice version. An initial verification query
wrongly named a nonexistent request_id column; the corrected version/author/file
query supplied the evidence. The stale-form test now distinguishes an unchanged
comment from retaining a superseded returned selection; browser rebuild pending.

Maximum browser calculation using the actual production worker completes in
31.7 seconds, preserves 200 unknown finishes and 73,100 dated capacity warnings,
and serializes 23,411,056 bytes. A 10 ms page timer fired 3,129 times, with a largest
gap of 366.6 ms; this is not an instant/no-pause claim. The first probe incorrectly
launched webpack's compiled classic worker as a module and failed importScripts;
it was corrected to the bundle's actual loading mode. The normal app preview
had already worked.

A separate intercepted-read stress fixture feeds that result into the actual
forecast page, marked Synthetic maximum stress fixture — unissued. This writes
no business record. It renders 302 explanation groups in pages of 50. Keyboard
Enter reaches groups 201–250 and expands all 731 dates and 200 task references,
including September 7, 2028. At 390px the warning and staff reference wrap; the
date table scrolls internally. Cancellation and form-date changes stop a maximum
preview, leave no working result, and preserve the separate synthetic reviewed
fixture. One long calculate button extended 12 pixels past the main content box;
its text now wraps. Rebuilt verification of that style change remains pending.

One earlier 390px screenshot visibly clipped during a shell resize transition,
despite a green document-overflow check. It is superseded by the settled closed
status image, which was visually read. The desktop returned-invoice entry and
settled maximum warning image were also inspected. Do not reuse the transitional
capture as evidence.

NEW OPEN LIMIT: source inspection shows the durable delivery RPC still limits
normalized requests to 8 MB. The maximum warning result alone is 23.4 MB; Node
and browser success do not establish retained maximum forecasts. This limit
needs a measured persistence/transport repair and explicit over-limit behavior
before claiming maximum durable acceptance. No limit has been raised yet.


## Calculated evidence envelope and repeated history reads

The preceding 8 MB open limit is superseded for calculated forecasts by migration
20261001000001. A producer-approved synthetic baseline has 200 tasks, 100 staff,
20,000 assignments and 40,000 submitted/accepted update rows. Its actual RPC
source response is 40,151,790 bytes. The real normalizer retains 63,566,200 bytes,
73,300 warnings and 73,100 summed reservations, with every unsupported task finish
still null. The original 8 MB RPC rejected this package with SQLSTATE 22023;
the 96 MB calculated-evidence envelope retained it. Original submitted delivery
commands still have the 8 MB database bound and the web request remains 2 MB.
This is synthetic engineering evidence, not a real contract or human acceptance.

The first durable attempt failed: rereading the already-retained package exceeded
the existing database statement timeout. It did not exhaust the 2 GB child heap.
Migration 20261002000001 moves complete delivery construction out of intermediate
management layers and adds a caller-authorized, 80-byte hash-only read for the two
concurrency comparisons. Full retained inputs stay in the management response and
issued packages. Delivery is read before source-visibility observations; the final
large merge occurs after their decisions, preserving the cutoff custody boundary.

An initial revision still copied the second maximum forecast through two final
merges and its post-job read timed out. That attempt is not accepted evidence.
The final revision retains delivery separately until the return. With two retained
maximum forecasts the actual HTTP response is 167,283,448 bytes and succeeded in
8.571 seconds including transfer; the hash read took 155 ms. This does not prove
unbounded history scaling or make a 167 MB management response lightweight.

Durable job a8a77bd3-c86d-41a8-af5e-01fea3f73c74 recovered on attempt 2 under
NODE_OPTIONS=--max-old-space-size=2048 and retained forecast version 2,
aea6c469-204b-49e7-88f3-5c02bb17f73e. Version 1 remains
58bb6c15-7d35-4922-a963-f4ddf4e4418e. The input hash stayed
0e16743c58f9470f60500a58393c189386d0dc94e45fd3c1880a546218a52048.
No timeout or worker heap limit was raised. Named disposable primary and populated
upgrade stacks now have both migrations; the populated comparison and complete
live suite still require their final repeat.

Nine focused tests passed. Harmless SQL survives; restoring the old envelope,
removing original-command or normalized limits, admitting an outsider, returning
a constant hash, or dropping delivery history each fails for its named assertion.
The seven checks on 782fcfd7 also passed, including QA, live RLS and restore;
these newer changes need their own final checks and build identity.

CORRECTION: the earlier closed-management-reader mutation receipt reported a
failure that was only a missing SQL terminator in the injected harness. It was
not evidence of the closed-state guard. The corrected harness includes the
terminator and now requires the specific `Closed management state missing`
assertion. The closed-inbox mutation requires `Closed participant history or
state missing`; its harmless control passes. The corrected receipt replaces the
old file without erasing this explanation.

The new small-practice browser case uses personal synthetic workspace
71092363-2a01-4bab-b03f-abfe878212f7, project
714683c5-9d7e-418d-a225-1f40d79f6f9c and engagement
faf088b6-7810-457d-b90f-630b8521309f. From actual navigation it created a client,
fixed-fee engagement, invoice SYNTH-PRACTICE-FIXED-01 (1000 gross, 100 retention,
900 net), marked the invoice sent internally, uploaded and retained two explicit
synthetic PDFs, created a final-memo deliverable, and proposed then approved the
1000 fee / 500 internal cost / 10 hours baseline. No external message was sent.
Expense, settlement, closeout, reopening and downloaded reconstruction remain
in progress for this UI case; the earlier transactional RPC case is separate.
The browser still serves 5218ceb8, so the 782fcfd7 recovered-form and narrow-button
fixes still need rebuilt browser verification.
