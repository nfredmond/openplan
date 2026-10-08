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

No application migration installs this candidate. Separate-session concurrency,
HTTP lost-reply and fresh-process recovery, command-journal/client integration,
normal dispatcher adoption, actual Storage integrity, managed ingestion and
independent scientific acceptance remain unfinished. These are required next
boundaries, not implied by the transaction tests.

This work uses `work/model-assessment-command-20261008`. The parent publication
checkout remains frozen for its already-running QA gate on `9385deba`.
