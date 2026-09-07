# Independent OCR worker review, round 1

Review date: 2026-09-06. Scope was main.py, durable.py, intake.py, docker-compose.yml and test_durable.py in the isolated OWP checkout. No source edits. All test stores and probes are under this scratch directory. Tests use `python3 -B` and `PYTHONDONTWRITEBYTECODE=1`. No existing worker data was opened.

The owner changed the worker while the review ran. The final bounded retest uses `snapshot/`, whose `sha256.json` identifies every Python file. Reviewed main.py SHA-256 is `42cddd2f95e93f9cdea3a364cd651d97c4f10265c45ce9433b9f319571763517`. Later owner changes are not implicitly covered.

## Remaining reproduced defect

**P1: Recovery of an already-retained result can silently lose automatic retry after a local persistence failure.** In snapshot main.py, `process_job` calls `deliver_result` for an existing result before entering its processing try/except. `deliver_result` sets in-memory state to succeeded after an HTTP success, then persists it. If the write fails, the pipeline wrapper catches and logs the exception, but in-memory state remains succeeded. The idle retry scan only selects undelivered jobs, so delivery checkpoint recovery stops until a process restart. `retest.json` shows in-memory succeeded, durable undelivered and automatic_retry_eligible false. Put this failure handling inside `deliver_result`, restoring undelivered on a persistence exception so all its callers receive the same guarantee.

## Earlier reproduced defects and owner fixes

- The initial implementation overwrote a retained success with a failed result if persistence failed after delivery. `probes.json` records running/succeeded/failed callbacks and loss of retained pages. The owner added a terminal-result guard and a separate exception path that preserves the result. The updated `snapshot/test_durable.py` exercises the post-delivery disk failure and exits zero. This fix does not close the existing-result replay case above.
- The initial idle retry loop allowed a persistence error to terminate the sole worker thread. The owner added per-job exception handling. `retest.json` confirms one injected SQLite failure is followed by another queue iteration.
- The owner added a common persistence lock. The controlled concurrency probe confirms a cancellation waits behind a progress snapshot and remains present when reloaded from SQLite. An earlier probe timed out because this lock arrived while that probe was running; that timeout is not a product defect. The final snapshot probe reports no thread errors.

## Other concrete gaps worth fixing in this change

- `main.py:worker_loop` only retries delivery after a five-second empty queue timeout. A continuous queue can starve undelivered results indefinitely, and one new 90-minute OCR task delays delivery retry by that task's duration. Use a separately scheduled delivery loop or bounded fairness between jobs and due retries.
- `main.py:main` creates work_dir with default permissions before `durable.connect` requests mode 0700, so an existing or newly created broad directory is not narrowed. Job directories and original/recognized PDF files also use ordinary umask permissions. Protect the durable root and job directories with 0700 and retained private files with 0600. The SQLite file alone is chmod 0600. This matters now that source bytes remain after completion.
- `durable.load` loads every historical payload, including every page of every terminal job, into memory at startup, and JOBS keeps them indefinitely. Storage and memory consumption increase with all prior work. Keep terminal results on disk and query them lazily for duplicate requests; only active/pending delivery jobs need residency. A retention policy must preserve required artifacts explicitly rather than return to unconditional deletion.
- Docker Compose now mounts a named durable volume, but Dockerfile and the module preamble still describe temporary throwaway storage/in-memory operation. Update operator guidance, including backup and restore of jobs.sqlite3 plus retained source/output directories. The default non-Compose directory remains under the system temp directory, which does not establish durability across machine cleanup/reboot.

## Evidence

`tests.json`: six existing worker scripts exit zero, including durable, intake, contract, callbacks, HTTP/pipeline and OCR tests. Recognition and network dependencies are mocked in these scripts; they do not prove a real OCR engine or app callback transaction.

`mutations/results.json`: harmless comment survives. Removing durable acceptance fails at the missing recovered job assertion. Request identity bypass fails at foreign-document refusal. Removing all three cancellation checks fails at the canceled terminal result assertion. This settles the single early-check mutation survivor: another cancellation check was enforcing the same outcome.

`probes.json`: initial post-delivery persistence/result loss, retry-loop exit, valid cached source reuse and refusal to reuse over-limit, wrong-size or non-PDF cached content.

`retest.json`: updated loop survives injected write error; serialized cancellation survives reload; existing-result replay still misses automatic retry.

`snapshot-durable-test.json`: updated durable suite exit zero.

## Boundaries

This review does not declare the application callback receipt transaction, active-job uniqueness, durable app dispatch, source/version model, export artifact retention or complete OWP preparation fixed. Those are separate implementation changes still pending review. It also does not establish disk-full recovery under a real filesystem outage, abrupt machine power loss, real OCR output, container volume restoration or browser usability.
