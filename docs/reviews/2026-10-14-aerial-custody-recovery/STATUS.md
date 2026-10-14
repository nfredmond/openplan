# Recover retained custody before assessing package readiness

A competing custody write can preserve held rows but reject a later bulk write.
The old failure path returns an empty pending summary. The retry route writes
that summary into the evidence package, then its all-held shortcut prevents
another retry from repairing the package.

The candidate rereads the full original artifact roster after the exact named
held-custody refusal. Every expected kind/ordinal must have a retained row before
the job summary can be written. Missing or unreadable records remain retryable.
A partial set cannot become complete after the bulk statement rolls back.
Other constraint or serialization errors remain failed writes.

Retry reads the complete private callback roster and skips held transfers inside
the engine. Missing records still receive an attempt. An all-held retry repairs
pending package readiness without another source transfer. Both callback and
retry stop before package writes when custody is unreadable. Readiness changes
only from pending to partial, preserving human verification, titles and notes.
A failed package readiness repair returns503.

This application change needs no new database field or function. It will land
before candidate guard20261017000011 activates. No migration enters this PR.
The guard remains separate, after00009/00010 source integration and a fresh
hosted capture. The application recognizes the exact23514/message pair. It does
not reinterpret general database errors as a custody success.

## Evidence

The six initial application/test files match the restored held-custody source.
The joined tree also corrects the planner test client for the readiness query.
Four affected source cohorts each pass88 cases across four files. All19
deliberately broken behaviors fail at their intended assertions;95 classifier
controls pass.
The source edits restore in finally. The guarded categories include conflict
rereading, missing identities, existing pending counts, all-held repair,
preservation of human verification, unreadable package refusal, and readiness
write failures. Mocks assert the relevant projections and write filters.

The joined dependency TypeScript check passes after correcting test-client casts.
Seven changed files pass lint. The joined cohort passes257 cases across16 files.
Legacy callback controls pass four72-case cohorts with60 intended faults and300
classifier controls. Custody controls pass four108-case cohorts and15 intended
faults. Both declared test censuses fail when deliberately set to the wrong
number. CI gains the88-case roster controller. The first joined callback baseline
fails because the planner test client lacks the new update method; that failure
is retained. The corrected client asserts the job/readiness filters and id
projection. Fresh branch CI and deployment verification remain pending.

Separate native evidence uses actual compiled routes, the engine, installed SDK
and isolated PostgREST. It preserves original held rows, refuses complete custody
for a missing identity after bulk rollback, repairs pending readiness, and
preserves human fields. Signed fixture roles prove visible member rows with
zero updates and anonymous write refusal. Source and Storage are synthetic.
The seven-case HTTP cohort has four positive runs and six intended faults.
The row guard has four native cohorts and nine intended faults, including a
real lock wait. These fixtures use selected409 plus candidate DDL, not the
current hosted database.

An initial40001 candidate hangs through PostgREST despite passing direct SQL
controls. Seven failed HTTP trials remain retained. The corrected23514 guard
returns HTTP400, and restoring40001 fails the prompt-response assertion.
[Supabase documents the automatic serialization retry behavior](https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b).

A separate representative database fixture upgrades through pinned main122's411
migrations, exact branch00009/00010 sources to413, then the guard to414. Four
logical upgrade/restore cohorts pass. Three faults expose a missing migration,
missing guard body and an improper restored member update policy. The original
held row and member refusal survive restore. This is a same-cluster logical
restore. Hosted backup/restore, Storage restore, login, global roles and another
machine remain outside its scope.

The independent read-only review finds no further blocking source defect after
correcting pending counts, package-repair errors and the PostgREST error code.
It does not establish hosted, browser or full workflow acceptance.

## Remaining boundaries

Concurrent protection begins only when the separate guard activates. Source
extension still affects object identity. Durable source preparation, expired
source recovery, recurring late-object cleanup, full worker/default integration,
capacity, browser usability and processing quality remain open. The retained
row is not independent scientific validation. No milestone or V1 grade changes.

Private proof base:
`/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/aerial-held-custody-20261014/`.

## Joined main and CI corrections, October 14

The candidate joins main2b0dbee8c without conflicts. Scoped types and seven-file
lint pass. The related cohort passes294 cases across19 files, including the
program-type changes. An initial result classifier expects `.ts` for the
programs page; the actual selected test is `.tsx`. The corrected exact roster
and census validate the retained successful run. The classifier failure stays
in the owned service journal. Peak memory is563.9MiB under1GiB, zero swap.

The fresh joined-head worker check rejects a source-lock fault that still passes.
Its20ms budget can expire during unrelated file work. The corrected test probes
the actual held writer directly with a two-second bound. The separate retained
observation fixture uses its ordinary write budget before holding the lock and
supplies two seconds to the contended call. Neither correction changes a
production deadline. Source controls pass four44-case cohorts with55 intended
faults. Retention controls pass four31-case cohorts with34 intended faults.
Fresh exact-head CI must run again. No merge or deployment acceptance follows
from these local corrections.
