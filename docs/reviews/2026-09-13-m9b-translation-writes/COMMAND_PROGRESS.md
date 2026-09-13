# Translation command concurrency checkpoint

The SQL candidate now has actual two-connection evidence for competing creation,
correction, acceptance, source edits/deletion and exact retries. This is still
unreleased implementation. No app route, editor or generation worker uses it.
The complete scope in [NEXT.md](NEXT.md) remains open.

The readiness loop in prove-translation-command-locks.py was wrong: Python's
text wrapper buffered output that select could no longer see. Reading the pipe
descriptor directly fixes the observed timeout. The bounded-wait mutation also
needed to expect PostgreSQL's statement-timeout error, which WHEN OTHERS does
not catch. The first relaunch used an absent python executable and exited 127;
the subsequent recorded runs use python3. The absent-address serial probe now
includes a correction reason so the reason guard cannot mask an overwrite.

The repaired lock probe passed its expected outcomes: unrelated row/advisory
locks allow writes, while target foreign-key locks, category deletion, campaign
row locks and the shared response advisory lock refuse without retaining partial
command writes. Baseline and a harmless comment survive. Disabling bounded FK
waiting hits the statement timeout; bypassing the advisory check accepts a write
that the probe expects to refuse. These are two separate detected failures.

## Installed candidate and real competing sessions

Created only the named local proof database
`openplan_translation_command_proof_20260913` in container
`supabase_db_openplan-restore-target-2731143`. It contains a schema-only copy of
the installed 328-migration source, the candidate and synthetic fixtures.
No application/PostgREST service points at it. The initial schema restore as
postgres stopped at a supabase_admin ownership statement. The successful retry
used the actual schema owner inside one transaction, reusing the two empty
schemas already created. Nothing was dropped or reset. The setup manifest
records the initial installed candidate hash; translation-command-verification.json
records the newer verified candidate and checks its installed function body.

prove-translation-command-races.py holds the first connection's actual command
uncommitted, submits a second caller command, commits the first and retries the
second. Tests cover two absent claims, two corrections, acceptance racing a
correction, and category source update/deletion. The busy call returns PT503;
after commit the stale intent returns PT409. Confirmed retries return exactly
the original result with replayed=true, including after later correction.
Source deletion removes current wording while retaining its removal history.
Fresh wording based on the changed source saves successfully.

The additional outsider-during-contention test failed on the candidate: it
returned PT503 before checking access. The command now checks staff membership
before acquiring locks or exposing contention, and retains its locked membership
recheck afterward. The corrected test passes and removal of that first access
check fails for the observed reason. No unauthorized receipt content was returned
by the failing candidate; the demonstrated issue was access-check ordering.

Final race results contain six baseline and six harmless-comment survivors plus
five targeted failures: absent overwrite, stale version, stale source, changed
retry result and missing access check before contention. The serial runner also
passed its two survivors and twelve expected failures after the authority change.
The row-lock runner was rerun against that same final source. Hashes and terminal
results are in translation-command-verification.json; individual outcomes are in
the three command result JSON files. Private failed and successful logs remain
under `/home/nathaniel/.local/state/openplan/response-write-probe-20260913`.

Fixtures and immutable histories are intentionally retained in the proof DB.
The source database's rollback census found no candidate receipt table, none of
the five candidate functions and no added history column; its two synthetic lock
fixture categories remain and have zero translations. The original checkout and
demo were not edited. The owned dev server on 3260 remains stopped.

## Continue from here

The previous weekly checkpoint's runner repair is finished. Continue the atomic
source/current-version read contract, route and editor integration, and durable
generation/result publication with real attempt accounting. Convert every
producer before retiring direct authenticated writes. This includes the public
cache's completion provenance and private/manual operation without an API key.
Do not ship the deliberate publish_generated refusal as a completed generation
workflow. Check membership changes, all source entity types and batch races as
the integration proceeds; the current controlled interleavings cover categories,
not every possible source writer or arbitrary scheduling.

Browser/HTTP, worker/spend recovery, complete snapshot reads, full QA/shuffled,
RLS and upgrade acceptance remain unfinished for this increment. No new release
CI was run because this is a prototype checkpoint, not a release candidate.
The full V1 contract, M9b source-to-decision work and other early roadmap
obligations remain unchanged.
