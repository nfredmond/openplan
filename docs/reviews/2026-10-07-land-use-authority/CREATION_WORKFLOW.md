# Recoverable plan creation and stopping

October 7, 2026. The creator now uses the plan's own area and staff-assessed
responsible bodies. The [earlier backend checkpoint](CREATION_TRANSACTION.md)
remains the record of the transaction before the form used it. This follow-up
connects the form, authenticated route and exact-request recovery. It does not
close M1, establish legal sufficiency or claim rendered acceptance.

## Staff workflow

The form starts with unresolved local requirements. Staff can select any
installed checklist, but must assess its applicability to this plan. The
workspace's office location does not select or exclude a checklist. Staff enter
the plan area separately from each body's role, jurisdiction and evidence.
The display authority label remains a separate list label.

An edited draft stays in browser storage under its account and workspace.
Restoring a draft makes a new copy and requires review again. Before creation,
the browser retains the exact request. Reopening the page sends nothing.
An unconfirmed request offers explicit retry, with the original bytes, or an
explicit stop action. A changed checklist requires another review for a new
request; a retry of an existing creation can recover its original receipt.

Stopping solves the unresolved-request case without guessing whether the
server created a plan. The database either returns the existing plan or saves
a cancellation that prevents that exact request from creating one later. It
never deletes a plan. Creation and stopping use the same command lock. Both
recheck current staff membership before returning a retained outcome.

The browser saves stop intent before sending it. A lost stop reply therefore
offers another stop attempt after reload, not another creation attempt.
Imported files that claim creation or cancellation require reconfirmation
through the stop route. A file alone cannot establish the current outcome.
Unreadable copies remain downloadable and block further creation rather than
being silently discarded. Manual recovery from damaged copies remains a limit.

## Verification

The evidence directory is [creation-workflow](creation-workflow/).
The [regression](creation-workflow/regression-final.log) passes 535 tests with
five native suites skipped in that run. All five pass separately against the
[installed isolated database](creation-workflow/native-installed.log). TypeScript
and full ESLint pass. The direction check passes with existing review reminders. The controls detect 86 deliberate faults in total.
Knip exits zero with warning-level unused exports and types; no ignore rule
or artificial caller was added. Their checks cover different boundaries:

- Application controls exercise the actual routes, storage helpers and mounted
  creator, with mocked authentication, network and study-area fields. Baseline
  and harmless changes pass; 59 distinct injected faults fail. These include
  changed scope or request bytes, misplaced trust in imported receipts, lost
  stop intent, repeated submission, stale rules and account changes.
- Native migration controls run inside rolled-back transactions before
  installation. Baseline and harmless changes pass; 19 faults fail for
  permission, journal, cancellation, replay and workspace-cascade behavior.
- Native concurrency checks exercise both commit orders, simultaneous requests
  and membership locking. Two temporary-function faults prove the checks detect
  missing command and membership locks. In the simultaneous case, the workspace
  already contains the plan from the creation-first case; counts compare that
  baseline with the new command's exclusive creation-or-cancellation outcome.
- Inventory and release-note controls check the additional private table,
  RLS count, SQL-read column and migration note. Six faults fail, while baseline
  and harmless controls pass. Their assertions cannot prove
  database permissions or user behavior.

The saved logs preserve the original failures. Initial TypeScript and lint
checks found a test type mismatch, a cleanup warning and escaped-copy errors.
The broader regression found one new use of "record" in visible copy. The
instruction now says "Describe the role of each body below." The existing
plain-language baseline remains unchanged. Two application control runs and
one accounting run stopped at ambiguous or incorrect mutation anchors; their
sources were restored before corrected scripts resumed the remaining cases.

## Database and recovery custody

Migration `20261016000008_land_use_plan_creation_cancellation.sql` is installed
only on `supabase_db_openplan-restore-target-2026091050`, API port 29821 and
database port 29822. The catalog contains 284 application tables, all with RLS,
14 views and 758 policies. The cancellation journal has no client policies.
CLI 2.111.0 and PostgreSQL 17.6 remain unchanged.

The post-install security advisor reports the same eight warnings and one
error as the migration 7 capture. The error concerns PostGIS's
`public.spatial_ref_sys`; warnings concern five existing function search paths
and three extensions in `public`. None names a migration 8 object. This is not
a clean security audit.

Candidate migration probes must not run again against this installed stack.
The completed concurrency producer has a retained private journal and must not
run again. Installed fixture suites remain repeatable inside rolled-back
transactions. Historical control scripts are preserved as `.txt` files.

## Unproved boundaries

Mounted tests use a simulated DOM and do not establish layout, keyboard access,
native browser storage or usable downloaded files. Database tests do not prove
the HTTP path. Neither replaces an identified production-build journey from
real navigation at desktop and 390px, with console and artifact review.
Those checks remain open at this checkpoint. T3 preview reports available but
its screenshot attempts fail. No alternate browser has been opened.

Source-specific distinctions between plan kinds, complete public/export context,
practicing-planner observation and the remaining M1 cases remain open. This
checkpoint does not declare a development release or v1 complete.
