# Usage-reset checkpoint, September 14

**Latest continuation:** see "Public-copy implementation and isolated activation"
at the end. Migration 23 is now installed in the isolated application stack;
the earlier candidate-only and ledger-341 statements below are historical.

Resume in `/home/nathaniel/.local/state/openplan/translation-command-workflow-2026-09-13`,
branch `work/engagement-decision-traceability`; the application package is
`openplan/`. Another session owns the original `/home/nathaniel/code/openplan`
checkout. Recheck ownership and working changes before editing. This note
supersedes older usage-reset handoffs in the decision-traceability review.

The user requested continuity across the weekly usage reset. The standing goal
remains the full V1 contract and roadmap. Direct main pushes, repository
Playwright, no draft PRs and no human release gate are authorized. Keep work
local and free. Preserve the pending reminder constraint and all unrelated work.

## Saved implementation and CI

Main and the work branch were both `75d79afa708537cd36028f590335a3efd70a6cd5`
before this documentation checkpoint. This includes private decision links,
immutable correction history, interrupted-save recovery, cancellation receipts,
damaged-copy recovery and the stale-warning fix. The latest published release
remains v0.59.0. This increment is merged but not separately released; M9b and
v1.0 remain incomplete.

GitHub results were rechecked explicitly against `nfredmond/openplan` during
this checkpoint. All completed successfully:

- [CI, including QA and shuffled tests](https://github.com/nfredmond/openplan/actions/runs/34843745176)
- [RLS isolation](https://github.com/nfredmond/openplan/actions/runs/34843745145)
- [Upgrade path](https://github.com/nfredmond/openplan/actions/runs/34843745051)

These runs apply to `75d79afa`, not the subsequent documentation checkpoint.
Use explicit repository and run IDs when checking CI. One earlier generic run
list returned unrelated old health runs.

Private recovery evidence and operator instructions are retained in
`../2026-09-14-m9b-decision-traceability/PROGRESS.md`, its
`decision-recovery-final-checks.json` and `decision-recovery-browser-results.json`,
and `../../ops/ENGAGEMENT_DECISION_LINKS.md`.
Final local QA recorded 15,310 passing and 512 skipped tests; shuffled seed
914062 had the same counts. Live RLS recorded 541 probes across 59 files and
workers 52 passes. Six desktop/390px recovery journeys used application build
`6604a87e`; later `75d79afa` changed documentation only. Read the retained
limitations and earlier coverage gaps rather than treating those results as
full-product acceptance.

## Current defect and candidate

A rolled-back synthetic database probe confirmed that `queue_engagement_report`
included an approved item marked `private_note: true` in a snapshot labelled
public, while stripping its privacy metadata. See
`PUBLIC_REPORT_PRIVACY_FINDING.json` and `probe-existing-public-report.sql`.
The initial authenticated read of `snapshot_text` was correctly denied by
column-level grants; the corrected owner inspection established the defect.
This probe did not generate or download PDF/XLSX files.

`public-report-privacy-candidate.sql` is a transaction-local candidate, NOT an
installed migration. It adds a pure eligibility helper and filters public report
items and parents using explicit private/internal flags and visibility. Internal
snapshots retain original records. The existing response source-selection rule
then excludes explanations whose source items are absent.

`prove-public-report-privacy.py` ran the candidate with the synthetic fixture
inside BEGIN/ROLLBACK for each case. `public-report-privacy-results.json` records
baseline and harmless-control survival and nine targeted failures detected for
their intended semantic assertions. The runner checks the migration ledger,
installed queue definition and helper absence after every rollback. Installed
definitions remained unchanged. No proof process remained when this checkpoint
was written. Candidate and fixture hashes are in the results file.

This proof covers report queue selection only. It does not fix the public portal,
attachment or translation readers, old archived artifacts, or source-type-only
privacy policy. Do not describe the application privacy defect as fixed.

## Next work

1. Complete the explicit privacy-flag boundary before adding decision history to
   exports. Inspect all public readers, media, translation and response publication.
   `public-approved-items.ts` currently selects approved items without metadata
   filtering. `guard_engagement_response_publication` checks approval and parent
   approval but not explicit privacy flags. Metadata-only changes do not currently
   trigger response withdrawal in `guard_engagement_public_copy`.
2. Decide how to handle legacy public snapshots whose private markers were already
   stripped. Their original bytes cannot prove privacy retrospectively. Preserve
   immutable artifacts and do not silently rewrite them or claim they are safe.
3. Add private decision lineage to internal reports using existing complete
   history/context readers and validators. Current `review-export.ts` schema 1
   lacks that history; missing legacy history means uncaptured, not zero. Private
   actor, rationale and recovery context must not enter public reports.
4. Reuse existing reviewed/published "You said / We did" and translation provenance
   for public explanations. No new module or duplicate publication model is needed.
5. Exercise actual navigation at desktop and 390px, keyboard, console, private
   access, corrections and interrupted retries. Inspect generated PDF/XLSX/ZIP
   artifacts and checksums. Run appropriate QA, shuffled, isolated RLS, workers and
   upgrade checks; inspect final release-commit CI before tagging.

Read the current product authorities and run `npm run product:direction:check`
before selecting the following substantial lane. Do not resume the obsolete
v0.47 release plan as if it were current.

## Local resources to recheck after reset

- Application stack: `supabase_db_openplan-restore-target-2026091050`, database
  `postgres`, API 29821, DB 29822. Ledger at checkpoint: 341 migrations through
  `20261014000022`. Do not reset or drop it.
- Disconnected native proof database on the same container:
  `openplan_decision_link_proof_20260914`. Preserve it; never attach the app or a
  worker. Older scripts expecting ledger 340 or absent migration 22 are historical.
- Own application server was on port 3262, build `6604a87e`, version 0.59.0,
  with the translation review's network guard preloaded to prevent Anthropic
  requests. Processes and tool session IDs may not survive. Recheck ownership,
  restart only the owned server if needed, and use `which-openplan.sh` to establish
  build identity before collecting new browser evidence. Leave other servers alone.
- Private logs and synthetic browser artifacts:
  `/home/nathaniel/.local/state/openplan/response-write-probe-20260913/decision-context/`.
  The latest report proof subdirectory is recorded in its results JSON. Do not
  commit private captures or credentials.
- Browser runners are in the decision-traceability review. They use the repository
  Playwright harness with isolated contexts, a `PROBE_COMMIT` prefix and 1440/390px
  widths. Existing screenshots are historical evidence, not a new browser run.
- Worker-specific `.venv311` links in this worktree reuse existing local worker
  environments. Full TypeScript QA needed an 8 GB heap; the earlier default heap
  exhausted memory. Do not confuse that failure with a passing check.

There is no need for a live process to survive the usage reset to reconstruct
this work. Reconcile Git, CI, files, database and browser identity on return.

## Public-copy implementation and isolated activation

The next continuation implemented `20261014000023_engagement_public_copy_privacy.sql`
and connected the public portal/feed, photos, votes, reply-parent lookup and
public-report current-copy check to `engagement_public_items`. The new view has
explicit columns, a security barrier, caller privileges and service-only SELECT.
Each contribution and its root parent must be approved and free of explicit
private/internal/visibility flags. Native translation reads/caches and published
response reads/publication use the same pure eligibility function.

Metadata-only privacy changes now require the existing current-version review
intent and a fresh reason. They retain history, clear cached translations and
withdraw affected published responses with original source evidence. Native
vote and public-reply insert guards recheck eligible originals under row locks.
Their concurrent behavior still needs explicit multi-connection tests.

`public-copy-privacy-results.json` records 32 native assertions for baseline and
harmless control, plus 26 deliberately broken behaviors caught for their intended
assertions. Each candidate/fault transaction rolled back, with installed function
fingerprints unchanged. `public-copy-readers-results.json` records 117 baseline
and harmless-control tests and 11 caught reversions to unrestricted table reads.
The reader proof mocks database results; native tests separately establish the
view's actual filtering. `public-copy-inventory-results.json` records baseline,
harmless control and two census failures when the new view is omitted by the
parser. Migration and candidate bytes match exactly.

The broader engagement plus migration inventory run passed 1,521 tests with 23
skipped. Type checking passed with an 8 GB heap before the final live-test fixture
was added. The first test command was incorrectly launched at repository root:
all five suites failed imports and no tests ran. The corrected package-root run
passed. The first broader engagement run found 41 failures in the page fixture's
old table selector; it now requires the restricted view and its mutation is caught.
An initial census edit missed the total relation count; the real 266-versus-265
failure led to correcting that count to 266, including 252 tables and 14 views.
No failure was removed by exempting a route, relation or assertion.

`public-copy-activation.json` records activation on
`supabase_db_openplan-restore-target-2026091050`, database `postgres`, using the
explicit restore-target workdir. The ledger is now **342 / 20261014000023**.
Exactly one migration was pending. All 14 existing source/history/report table
hashes stayed unchanged, and all 11 installed function hashes match the native
candidate. Migration 23 is also saved in the restore target's migration directory.
The disconnected decision proof database remains untouched by this increment.

`engagement-public-copy-privacy-rls.test.ts` is registered in `test:rls-live`.
Its installed fixture has private explanations as drafts and labels the private
parent's synthetic input as staff-authored. It does not manufacture already-public
private records through the new guards. Eight installed tests passed, including
baseline, harmless control and six targeted grant/trigger faults. All fixtures
and faults rolled back. Raw suite output is in the private decision-context folder
as `public-copy-installed-rls.json`; `public-copy-engagement-suite.json` holds the
broader suite. Source-candidate proofs that assert ledger 341 are now historical;
do not rerun them against the upgraded application stack without adapting isolation.

Still unfinished: legacy public artifact disposition, full QA/shuffle/worker/RLS
and upgrade checks on the final source, native concurrency proof, a fresh identified
production build and desktop/390px browser/artifact acceptance. The old port-3262
server still serves `6604a87e` and is not browser evidence for this fix. No v0.60
release or full M9b completion is claimed. Decision lineage in internal exports and
the actual public explanation journey remain next after this privacy correction.


The first full QA on `d31c2093` passed lint/deadcode and reached all unit tests,
then failed with 15,313 passing, 520 skipped and two failures. The new migration
was missing from the changelog, and the source projection guard's pinned view
list did not include the new restricted view. Both omissions are corrected.
The view entry is backed by live service-role SQL resolution of every literal
public-view projection plus the portal's imported projection constant. Renaming
its body column inside a rolled-back transaction makes that check fail at actual
column resolution. Baseline and harmless control pass. All 23 follow-up tests
passed, including 11 installed checks and the two corrected six-test suites.
`public-copy-followup-checks.json` records the result. The first QA log remains
`public-copy-full-qa.log`; no successful full QA is claimed by that record.

`d31c2093` is pushed to the work branch as an implementation checkpoint. Main's
`50188138` CI `34845675293` and RLS `34845675264` are both green. No PR or tag was
created. The owned old port-3262 server, PID 3278208 at the time, was stopped after
verifying its checkout and original commit environment. Port 3262 needs a newly
identified build before browser acceptance; other servers remain untouched.

The disconnected decision proof database was inspected read-only and is 46 MB.
It still has no public-items view. If used for concurrency evidence, install the
exact privacy definitions there explicitly, verify them against the application's
retained function hashes, and keep it disconnected. Do not reset or drop it.
Use committed, clearly synthetic concurrency fixtures only in that proof database.
Test source-private edits against waiting vote/reply/report writes and translation
reads. Inspect direct response publication too: its source guard currently reads
eligibility without taking the response advisory lock, while the ordinary response
command already takes that lock. This is an untested concurrency question, not a
confirmed additional defect. Preserve a demonstrated failure before fixing it.


## Full QA passed; acceptance continues on dfebc1af

Full QA completed successfully on `dfebc1af3a683a82c8a9da02a3d9215f47af5236`:
15,315 passing tests, 523 skipped, lint, configured advisory deadcode check,
provider connectors, zero audited dependency vulnerabilities and webpack build.
`public-copy-full-qa-results.json` records that result. Do not reinterpret the
skipped live RLS gate as isolation evidence.

The separately started complete isolated RLS suite is still live at this note,
tool session `64706`. Its log is `public-copy-full-rls-dfeb.log` under the private
decision-context directory. Re-poll that exact process before restarting anything.
Full QA session `65461` is terminal-success. First failed QA session `34158` is
terminal-failure and its original log remains retained.

Own new server is running in tool session `56011` on port 3262 with the Anthropic
network guard and synthetic key. `which-openplan.sh` confirmed the serving
checkout and health commit `dfebc1af3a68`, version 0.59.0. Browser acceptance has
not run on this build yet. The following evidence-only commit does not change
application source. Do not rebuild or alter application files while collecting
acceptance. Use the repository Playwright harness and isolated contexts.

The direct-response-publication concurrency question was narrowed by live grants:
anon, authenticated and service_role all lack direct INSERT and UPDATE on
engagement_closeloop_entries. The application uses the response command, which
already takes the response advisory lock. A privileged owner's direct SQL
interleaving is not evidence of an application bypass. Preserve those grants;
exercise the actual command if testing response publication concurrency.

Next finish native multi-connection privacy cases, actual public navigation and
legacy/current public report downloads with corrected originals retained, then
shuffled, workers and final applicable upgrade checks. Public explanation can use
the existing response editor and private decision links. Private decision lineage
in internal PDF/XLSX/ZIP reports is still unimplemented. Main remains 50188138;
implementation/evidence checkpoints are on the work branch pending acceptance,
with no PR or human-review gate. Merge directly once the increment is verified.


## Usage-reset checkpoint, September 14

User requested a safe resumption point before the weekly usage reset. Continue
the full v1 goal in this thread after resumption; no draft PRs or human release
gates. Do not declare this increment released. Latest released version remains
v0.59.0. Work checkout is
`/home/nathaniel/.local/state/openplan/translation-command-workflow-2026-09-13`,
branch `work/engagement-decision-traceability`. Original checkout remains read-only.

The complete isolated RLS run has now terminated: **551 passed, one failed**
across 60 files. Its failure was the recovery fixture's unscoped positive receipt
count under a deliberately broadened read policy. Both positive counts now name
the exact receipts created by the fixture; other-staff and lost-membership denial
checks still inspect all visible rows. Focused rerun passed all eight tests,
including the harmless control and six targeted faults. Private results are
`decision-resolution-populated-before.json`, `decision-resolution-populated-after.json`
and `decision-resolution-populated-final.json` in the decision-context directory.
The complete RLS suite must be rerun with this correction before landing.

The new `public-copy-browser.cjs` runner is an **unfinished acceptance checkpoint**.
Its first 1440px attempt terminated before public portal/report acceptance, waiting
for Unpublish after clicking Publish. Diagnose the retained page/response evidence
before deciding whether this is an app defect or runner issue. Do not claim browser
acceptance, successful downloads or 390px coverage. Private failure evidence:
`/home/nathaniel/.local/state/openplan/response-write-probe-20260913/decision-context/browser/public-privacy-1440-1789393048383.json`
and adjacent screenshots/text. Synthetic campaign/decision/source identities are
in that JSON; avoid duplicating fixtures without inspecting it. Runner syntax
should be checked before committing; runtime remains failed as described.

At checkpoint, no browser or full-RLS process remains. Own production server
PID 3962356 still serves dfebc1af3a68 on port 3262; own document worker
PID 4038996 uses the isolated restore-target stack, API 29821, ledger 342 through
20261014000023. Verify process ownership, ports and served build again after reset.
Do not kill unrelated demo workers or reset databases. Process survival is not
required for recovery. Full QA passed on dfebc1af as recorded above.

Resume with the publication failure, then actual public response visibility before
and after privacy changes, original/internal/corrected PDF/XLSX/ZIP downloads and
checksums, desktop/390px keyboard/console inspection, relevant photo/retry and
native concurrent privacy checks. Complete corrected full RLS, shuffle, workers
and applicable upgrade checks. Merge directly to main once verified, inspect final
CI before tagging. Internal-report decision lineage remains unimplemented after
this privacy increment; preserve the broader roadmap and independent model scope.


## September 14 resumed privacy acceptance

The prior goal turn made progress by pushing checkpoint 52b100d8. This resumption
identified the same served application dfebc1af3a68 on port 3262. Changes since
that build are evidence and a native fixture correction, not application code.
`product:direction:check` passed with its unchanged strategy-age reminders.

The first publication failure was a runner omission: the screenshot showed the
required change reason blank and the correct refusal. The runner now fills it.
The next attempt expected comments on the map entry page; actual navigation uses
“See what other people said” to open the accessible details page. Another attempt
used exact getByLabel on a label containing option text; it now locates the actual
Disclosure scope combobox by accessible role/name. The report queue returns 202,
not the runner's initially assumed 201. None required changing application code.
Retain those private failed captures instead of presenting them as successes.

`public-copy-browser-results.json` records successful desktop 1440px and 390px
journeys through Projects, Engagement, public entry/details, the actual published
explanation and Record downloads. All 18 PDF/XLSX/ZIP downloads match retained
checksums and sizes. Each ZIP contains exact PDF/XLSX companions and snapshot bytes
matching its retained SHA. Original/internal snapshots contain two contributions
and one response; corrected public snapshots contain the remaining control and no
withdrawn response. Approved source text, private decision link context and old
artifact metadata remain retained after the explicit privacy edit. Old public
artifact downloads return 404; internal originals remain byte-identical; anonymous
internal download returns 401; hidden-item vote returns 404.

At 390px the server accepted the report request before the browser connection was
aborted. The UI reported the failure, preserved its request in browser storage,
and reload/retry sent the exact same payload and obtained the same job. Exactly
one expected injected network-console error was retained separately. Otherwise
operator and resident consoles were empty. Screenshot inspection covered public
feedback, explanation, withdrawal and corrected download controls at both widths.
All nine pages across the desktop original/internal/corrected PDFs were rendered
and inspected. The original workbook's nine sheets were opened with LibreOffice
and rendered read-only. Wide record tables require horizontal browsing; complete
cells/companion bytes were inspected separately. No workbook was overwritten.
The first XML inspection assumed sharedStrings; this writer uses inline strings,
so the corrected read inspected sheet XML. Original and corrected workbook values
agree with the source/response inclusion checks; no error-typed cells were found.

`public-copy-concurrency-results.json` records ten native cases in the disconnected
`openplan_decision_link_proof_20260914` database. Migration 23 definitions were
installed there, with six retained source/history/report table fingerprints
unchanged and all eleven function definitions matching the application stack.
The first installation attempt used postgres, which lacks schema creation rights
in this proof database. It rolled back. The existing proof setup uses its actual
owner supabase_admin; the runner now follows that setup without changing grants.
Native pg_stat_activity/pg_blocking_pids confirmed overlap for waiting item votes,
reply votes, reply inserts and report capture. Committed private metadata caused
refusal/exclusion; harmless metadata allowed each operation. Translation reads
returned busy while the holder was live, then unavailable for private content or
success for the harmless control. Synthetic source edits remain in that proof DB;
waiting writes/report captures roll back. No app or worker connects to it.

Shuffled tests passed: 15,315 passing and 523 skipped. All 52 worker suites passed.
The corrected complete isolated RLS suite is now terminal-success: 552 tests in
60 files, 404.75 seconds. Logs/checksums are in the new result JSONs. No running
QA/RLS job needs recovery from this turn. The owned app and document worker remain.

Photo acceptance is in progress in `public-photo-browser.cjs`, reusing the actual
browser-created campaigns. Initial attempts incorrectly looked for draft-only
publication controls on a live campaign. The current runner uses the real Public
access checkbox and Save share settings. Do not claim its success until its
private JSON says completed and the pictures/console have been inspected. Next
finish photo access at both widths, prepare the bounded v0.60 release with private
decision-link/recovery and privacy evidence, merge directly and inspect final CI
including populated upgrade before tagging. Internal export decision lineage
remains unimplemented. No PR or human-review gate applies.


Photo acceptance is now complete at both widths. The runner corrected two more
assumptions: campaign GET intentionally omits storage paths, so retained attachment
presence is verified through complete private history; navigation must finish on
the Engagement catalog before selecting a campaign, otherwise a same-title report
link can be selected on the previous page. The resulting unintended report visit
exposed the unrelated project/grant panels recorded in the release limitations.
Successful source/photo/console histories are in public-photo-browser-results.json;
visible/hidden screenshots were inspected at desktop and 390px.

The v0.60 candidate metadata is prepared, with 342 migrations and retained limits.
Release ledger controls passed: baseline and harmless comment survive; wrong count,
missing migration file and missing operator migration each fail the intended check.
Product direction and focused metadata tests passed. Final candidate full QA,
main push and GitHub CI/upgrade remain next. No tag has been created. The owned
old dfebc1af app server is stopped before rebuilding; restart and identify the
candidate as needed. The isolated document worker remains available.
