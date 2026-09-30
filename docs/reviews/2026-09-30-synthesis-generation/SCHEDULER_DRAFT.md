# Authorized synthesis scheduling, September 30, 2026

This candidate extends committed worker checkpoint `7726b58e`. It is not released
or enabled in the staff interface. The installed demo remains v0.64.0. M9b and
the complete V1 contract remain open.

## Implemented boundary

The local worker accepts `--authorization UUID --all-tasks` in addition to the
existing `--task-index INTEGER` command. The coordinator reconstructs the complete
saved source and verifies the immutable authorization, plan header and seal. It
reads initial attempts through ordered pages and continues after short pages.
An operator's lower PostgREST row ceiling must not silently truncate the list.

The coordinator saves its task list before invoking any worker. Initial grants
cover remaining unattempted tasks and recover their own existing task directories.
An existing attempt under that grant consumes allowance before fresh tasks are
assigned. An explicit retry grant names exactly one task and predecessor. Earlier
attempts under other grants remain separate history, including uncertain calls;
the coordinator never creates replacement authorization.

Each task uses the same private directory and worker as the single-task command.
An exclusive scheduling lock prevents two local coordinators from processing the
same grant together. Native claim and dispatch controls remain authoritative for
concurrent workers, current permission and resource limits. A changed inventory
after the list is saved can cause a native refusal; it does not silently replan.

Repeating the command retains the saved list and reconfirms original database
custody for each earlier output. Unknown dispatch outcomes remain unobserved and
consume the original attempt. Other explicitly authorized tasks can proceed.
Provider failures do not become new automatic attempts. A read or delivery error
stops the invocation with its journals retained for the same-command retry.

The CLI reports retained output, unobserved dispatches and tasks outside its
schedule. Exit 2 identifies an unobserved dispatch or partial task list. Exit 1
identifies interrupted or refused work. Even exit 0 establishes neither valid
model output nor complete synthesis, staff review or approval.

## Recovery correction found by native testing

The first coordinator reloaded the plan through its current-access command before
recovering saved task output. The native test cancelled the request, revoked the
original requester's staff access, and lost the output acknowledgement after the
database commit. On restart the coordinator stopped before redelivery, leaving
its local receipt in the observed phase.

The corrected loader separates immutable plan and seal reads from permission to
continue execution. Saved-output recovery validates immutable identity without
requiring current requester access. A new schedule and each newly claimed task
still use the current-access native plan command. Claim and dispatch keep their
existing cancellation, credential, access and allowance checks. The corrected
native test redelivers the original output and refuses later tasks. No database
permission, history trigger or human-workflow authority was relaxed.

A refactor also moved argument parsing before pre-abort handling. The existing
loader test detected the changed error; the pre-abort check is restored. An
initial test command from the repository root lacked the application aliases and
ran no tests. All reported test results use the nested application package.

## Verification so far

The focused coordinator, loader, worker and process suite passes 127 checks.
This includes a scheduler fixture with 301 comments and one survey answer,
including the last long source. Its worker calls are simulated; it proves task
coverage and addressing, not native processing or useful interpretation at that
scale. Native HTTP tests separately use the real CLI, private journals,
PostgreSQL, PostgREST and Kong with a synthetic local model.

The final native suite passes nine checks, including complete-grant recovery
from a lost output acknowledgement, joining an existing single-task directory,
limited allowance and cancellation/access-loss recovery. The unknown-dispatch
case leaves one uncertain task unresolved while the other authorized tasks run,
then proves a further restart makes no additional provider calls. Five native
faults fail for omitted tasks, changed directory identity, current-access checks
before recovery, hidden partial coverage and a hidden unknown outcome. Its
harmless comment control passes. Full QA passes, including lint, dead-code checks,
16,347 passing tests with 1,021 skipped, connector checks, a clean dependency audit
and the Next.js 16.3.8 production build. The shuffled run passes the same test
counts. All 52 Python worker suites and the final 6 GiB TypeScript check pass.
The corrected full installed RLS run passes 925 tests across 73 files, with
125 historical candidate skips. Final-commit CI remains pending for this candidate.

The first mutation run preserves three surviving faults. The ordering test still
failed downstream rather than checking the first rejected page; it now asserts
that no second inventory query occurs. The duplicate-ID fixture had an inconsistent
binding that a different guard rejected; it now gives both rows the same bound
attempt ID. The unpaired retry fixture also exceeded retry allowance; it now uses
one attempt to isolate the missing-predecessor check. All three refined faults
are detected, and both harmless controls pass. Together, the original and refined
runs detect all 40 targeted local faults. The schedule-size fault lowers the cap
to 64 bytes; it establishes an enforced bound, not measured admission at 16 MiB.
Original and refined logs remain
in the private `approval-resume-2026-09-27` checkpoint.

The existing identifier-based column census found nine stale exemption entries
after direct plan/seal and initial-attempt reads were added. Those entries are
removed. The census cannot distinguish every same-named column across tables;
recognizing `receipt_text` does not mean all receipt tables acquired direct
application readers. Native commands still read the other receipt histories.
The census passes a harmless comment control and rejects a deliberately restored
stale header exemption. Its earlier nine-entry failure remains in the evidence.

The first standalone TypeScript check exceeded Node's default heap. The retry
uses the repository build's 6 GiB allowance. It found an overly narrow synthetic
worker return type, which is corrected to the worker's existing outcome type.
The final typecheck passes with the same allowance.

## Interrupted full isolation run

The first full coordinator isolation run ended with status 143 before producing a
test summary. Its signal source was not established. No test process or active
test transaction remained. This run is incomplete, not a passing result. The
isolated suite reran by itself with a separate process group and a retained
lifecycle record. It finished with 924 passed, 125 skipped and one failed test.

The failure is in the selection-sequence mutation probe. Removing the request
filter lets retained histories change the initial sequence. The fixture rejects
that earlier snapshot with a general selection error, while the test expects the
later sequence-specific error. The corrected fixture separates its initial
sequence assertion and gives it the same precise diagnostic as the later check.
Both checks remain, and no production guard or permission changes. All 30 focused
native selection checks now pass, including the harmless variable-rename control
and the fault that removes request scoping. The corrected full isolation run
passes 925 tests with 125 skipped. This fixture checks database sequence and receipt custody; it
does not establish provider output quality or staff-facing recovery.

Main checkpoint `7726b58e` separately has passing GitHub CI, RLS and populated
upgrade checks. The RLS log confirms 920 passed, 125 skipped and 73 passing files.
The upgrade log retains identical nonempty counts before and after migration,
`2:2:1:1:1:1:1`, plus its content and custody checks. These results do not substitute
for coordinator verification. Runs are CI `36755550361`, RLS `36755550299` and
Upgrade Path `36755550416`.

## Remaining work and limits

This adds source-aware task coordination, not record/context consolidation or a
staff generation workflow. The scheduler retains task indexes and references;
each single-task worker still reconstructs the source before a new claim. Large
native workloads need performance evidence before an operating capacity is
advertised. The schedule journal has a 16 MiB limit; exceeding resources remains
an explicit refusal, never silent clipping.

Initial-attempt reads can race another writer. Native uniqueness and resource
checks refuse conflicting claims. The coordinator is local, not a distributed
queue or automatic authorization service. Lost private journals cannot authorize
a repeated uncertain call. Current staff historical inspection and explicit
retry controls still need their interface join.

Retained byte checks, completed task calls and complete part accounting cannot
establish model interpretation quality, representative participation, live
billing, usefulness or agency approval. Record/context consolidation must retain
all source relationships, conflicting and minority input, and exact selected
outputs before machine-draft import into a new staff review version.
