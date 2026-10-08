# Retained legacy assessment command

October 8, 2026, following publication checkpoint `9385deba`. This is work within
roadmap M3/S1. It does not change the V1 contract, scientific gates or queue.

## Recovery problem

The normal legacy assessment RPC creates three artifact rows and one assessment
on each call. The parent branch's native test demonstrates that an assessment can
commit while the caller receives an altered or missing reply. Receipt validation
correctly leaves that call unconfirmed, but repeating the write has no retained
request identity and can create another assessment. A failed response does not
establish rollback.

## Candidate behavior

`prototype/assessment-command.sql` wraps the existing custody RPC in one database
transaction with a private request/response record. The request binds the complete
payload and caller-generated request UUID. An exact retry returns its original
assessment and artifact records. Reusing an ID with changed payload fails. The
server serializes matching requests and locks the parent run before a new write.
A final receipt failure rolls back the assessment and all three new artifacts.

New writes refuse failed/cancelled or managed parents. Historical retries return
their old receipt without reactivating a run. Existing managed attempt-bound
commands remain separate. The candidate retains the existing assessment RPC's
scientific outcome vocabulary; it does not assign a publication tier or declare
a stored outcome independently accepted. Service-role callers can execute the
command but cannot directly write its receipt table.

The payload requires explicit fields and types, including canonical UUIDs,
nonnegative integer byte sizes, SHA-256 strings, JSON metadata, method track,
partition, planning use, outcome and reasons. Storage references and recorded
hashes remain references, not proof that corresponding object bytes exist.

## Verified checkpoint

`prototype/verify_assessment_command.py` runs against the named owned CLI-upgrade
proof database and rolls back every case. Its synthetic fixture uses the actual
assessment RPC and database constraints. Baseline, harmless and restored variants
pass; seven faults in changed-request refusal, exact receipt return, size kinds,
terminal-run refusal, field completeness, receipt persistence and privileges are
detected. Tests also exercise late receipt failure, historical retry after run
termination and managed-parent refusal. Candidate objects are absent afterward.
Private results are retained in
`model-command-client-20261008-proof/assessment-command/assessment-command.json`.

No application migration installs this candidate.
HTTP lost-reply and fresh-process recovery, command-journal/client integration,
normal dispatcher adoption, actual Storage integrity, managed ingestion and
independent scientific acceptance remain unfinished. These are required next
boundaries, not implied by the transaction tests.

This work uses `work/model-assessment-command-20261008`. The parent publication
checkout remains frozen for its already-running QA gate on `9385deba`.

## Separate-session ordering proof

`prototype/verify_assessment_contention.py` now exercises four orderings using
independent PostgreSQL service-role sessions. Each contender demonstrably waits
on a database lock before the owner commits. Simultaneous exact retries retain
one receipt, one assessment and four artifacts, including the original output.
A changed payload with the same request ID waits and then fails. A reaper that
commits first prevents new assessment records. An assessment that commits first
retains its receipt after the reaper stops the run, and its exact retry returns
that historical receipt.

Baseline, harmless-comment and restored variants pass all four orderings.
Bypassing payload comparison, returning a wrong retry receipt and bypassing the
stopped-run guard each fail for the expected reason. All 15 cases complete.
Candidate function and table cleanup is confirmed after the owned sessions exit.
Synthetic fixture records remain in the named proof database. Private evidence
is `model-command-client-20261008-proof/assessment-contention/assessment-contention.json`.

This proves legacy assessment transaction ordering against the actual stale-run
reaper. It does not exercise HTTP loss, journal recovery, normal workers,
managed ingestion, Storage bytes or scientific acceptance.
