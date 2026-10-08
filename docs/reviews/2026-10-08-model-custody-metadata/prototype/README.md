# Model stage claim prototype

This executable database prototype starts the attempt-ownership design in the parent directory. It is deliberately outside application migrations and has no worker caller. Do not deploy it as a completed ownership fence.

The claim transaction retains request and response identities, takes request then parent-run then stage locks, records an attempt only for an eligible queued stage, and binds the active attempt to its actual stage with a composite foreign key. A repeated request returns its original response, including a lost claim. Different contents under an existing request identity fail. An unfinished predecessor prevents claiming a later stage. New attempts and request receipts are unavailable for direct public or service-role table writes; only the service-role command is exposed.

Run against an explicitly named disposable database:

```bash
OPENPLAN_MODEL_ATTEMPT_TEST_CONTAINER=supabase_db_openplan-restore-target-2026091050 \
  python3 -B docs/reviews/2026-10-08-model-custody-metadata/prototype/verify_claim.py
```

The runner checks that prototype tables are absent, loads the SQL and synthetic fixtures in one transaction, runs assertions as the service role, and rolls back. It checks table absence after each connection closes. Baseline, harmless comment and restored controls pass. Ignoring changed request contents and ignoring an unfinished predecessor each fail for their specific assertion. Native verification completed October 8, 2026 in the named restore-target stack. No prototype tables remain installed.

This is sequential transaction evidence, not simultaneous-process contention or production recovery. It now provides attempt-bound stage progress and terminal commands, but not artifact writes, expiry, production relaunch or protection against privileged database administration. Reaper invalidation is now exercised inside the rollback-only prototype. Direct updates to a managed stage are refused. Unmanaged stage writes remain available. Parent-run fencing is covered by the later checkpoint below. No migration history is changed and no existing study or output bytes are altered.

Next connect relaunch, run-level completion, artifacts and both worker packages before promoting this design into an additive migration. Preserve the complete M3 definition of done and the scientific-ingestion attempt requirements.

## Stage-write checkpoint

The prototype adds a private, transaction-scoped write-context table. Command functions create and remove authorization rows around their stage update. A trigger checks that the update belongs to the active attempt. Service-role REST calls cannot insert those authorization rows directly. The caller cannot bypass this by supplying a boolean flag. Parent and stage locks follow the same order as claims.

Progress and terminal commands retain exact request/response records. Tests prove exact retries, changed-payload refusal, direct legacy-write rejection, no writes after terminal completion, cleared transaction authority and denial of an old attempt after a controlled reassignment fixture. The fixture does not implement relaunch. Returning an old claim receipt is historical request resolution; the worker integration still needs to check current authority before resuming computation.

Baseline, harmless and restored controls pass. Six adverse controls catch changed claim requests, predecessor bypass, direct legacy writes, post-terminal writes, changed write requests and old-attempt writes after reassignment. Removing the command identity check alone was still caught by the trigger, so the stale-overwrite control removes both identity checks and fails at the expected old-worker assertion. No table remains installed after the test transactions close. The initial control run that encountered the second guard was corrected rather than accepted as the intended failure.

`write.sql` remains prototype code. It does not mark parent runs complete, coordinate the existing reaper, stop scientific processes or recover journals. Those gaps prevent deploying this protocol or claiming M3 completion.

## Reaper checkpoint

A retained managed-stage flag now survives clearing the active attempt. The prototype replacement for `reap_model_run_if_stale` locks the run and its stages, rechecks progress, records revocation on active attempts, clears active references and closes unfinished stages in one transaction. It creates temporary write authorization for that operation and removes it before returning. Direct callers cannot clear the managed flag to regain legacy write access.

Native tests confirm that an older snapshot does not reap fresh progress, valid reaping revokes the active attempt, post-reap legacy writes fail, managed-stage downgrades fail and an old attempt cannot write after reaping. Eight adverse controls now pass by detecting their intended defects, including loss of the persistent stage fence and omission of the revocation record. After every test, prototype tables are absent and the installed reaper function definition has its original digest. All reaper replacement DDL is rolled back.

This is not production integration. At that checkpoint, run-level writes were still unfenced. The launch route does not use the prototype, neither packaged worker has an attempt adapter, and no multi-process race or long-run liveness evidence is claimed. The original late-worker defect remains in deployed code until the complete protocol replaces those paths.

## Parent-run fence checkpoint

The October 8 continuation adds a persistent managed-run flag and private transaction authorization for parent updates. Claim and reaper commands update the parent through this authorization and remove it before returning. Direct service-role updates cannot overwrite a managed run or clear its managed flag. Tests check both after claiming and after reaping, and independently verify that no authorization row remains and that the service role cannot insert one.

Native baseline, harmless and restored controls pass. All nine adverse controls fail for their intended assertions, including a disabled parent guard that permits a legacy overwrite. Prototype tables are absent after every transaction and the installed reaper definition retains its original digest. These checks prove sequential command behavior in the disposable database. They do not prove concurrent recovery, prevent privileged administrator changes, or protect artifact bytes.

Parent completion still requires an atomic command that checks all required stages. The stage-write command does not yet complete the parent. Relaunch, artifact binding, worker adapters and interruption recovery remain necessary before promoting this prototype into application migrations. No deployed defect is claimed fixed by this checkpoint.

## Atomic successful completion checkpoint

The next October 8 checkpoint makes a successful stage command check every retained stage under the parent lock. When all stages have succeeded, it completes the parent within that command transaction. The saved response includes parent status and completion time, so an exact retry returns the original result.

Native checks retain an unfinished second stage and prove that the parent stays running. A separate final-stage fixture proves successful parent completion and exact retry. A temporary parent trigger deliberately refuses completion: the stage update, request receipt and temporary authorizations all roll back. Removing that trigger permits the same request to succeed. All fixture and trigger DDL rolls back with the outer test transaction.

Baseline, harmless and restored cases pass. Eleven adverse controls detect their intended failures, including early completion despite an unfinished stage and omission of the parent update. Independent SQL reads confirm persisted parent status and rollback behavior.

This supersedes the earlier note that successful parent completion is absent. Failed-stage closure, stage-set insertion/deletion protection, relaunch, artifact binding, both worker adapters, concurrent-process contention and interruption recovery remain unfinished. The complete protocol must control changes to the required stage set before this can become a production migration. No scientific or human acceptance claim changes.

## Required stage-set checkpoint

The next October 8 checkpoint locks affected parent runs before inspecting changes to the stage set. Once either parent is managed, direct stage insertion and deletion fail. Stage identity, parent, name and order cannot change. Progress or terminal updates to an unclaimed sibling also require private command authorization. Claim, progress, completion and reaper commands continue to pass.

Native service-role cases reject insertion, deletion, reordering and direct success on an unclaimed required stage. Baseline, harmless and restored cases pass, and fourteen adverse controls detect their stated defects. New controls independently permit insertion, deletion or an unclaimed sibling update and hit the corresponding assertions. Two existing overwrite controls now remove the overlapping stage-set authorization check as well. Their first combined run failed at an earlier sibling assertion; the controls were narrowed and rerun to reach the intended overwrite assertions.

This proves sequential stage-set protection only. Row-level legacy updates can acquire a stage lock before this trigger requests its parent lock. Concurrent command and legacy-write deadlock behavior, retry handling, whole-run deletion, failed-stage closure and relaunch still need explicit coverage. Artifact binding, both worker adapters and interruption recovery remain open. The prototype is not an application migration and does not establish the full M3 or scientific acceptance requirements.

## Failed-stage closure checkpoint

The next October 8 checkpoint closes a failed run within the stage-write transaction. It locks the retained stages, revokes active attempts, clears their active references and closes unfinished stages. Prior successful stages retain their status. The originating stage retains its original error; unfinished dependents receive an explanation that a required stage failed. The parent receives the originating error and completion time.

Native checks cover retained prior success, failed parent and dependents, revocation, original error preservation, exact retry, refusal of later success and removal of temporary authorization. A temporary trigger refuses the parent failure update and independent SQL confirms that the stage change, revocation and receipt roll back. After removing the trigger, the same request succeeds. Baseline, harmless and restored cases pass. Sixteen adverse controls detect their intended assertions, including omitted parent failure closure and omitted failure revocation.

This supersedes earlier notes that failed-stage closure is absent from the prototype. It does not integrate the packaged workers or launch route, stop a scientific process, protect artifact uploads, implement relaunch, prove concurrent locking or cover whole-run deletion. It remains outside application migrations and all native test changes roll back.

## Whole-run deletion checkpoint

The October 8 continuation reproduced a managed-run deletion gap before adding the guard. An empty run can be reaped and become managed without any attempt rows, so foreign keys on the attempt ledger do not protect it. The baseline test deleted that run and failed with `managed run deletion accepted`.

The parent trigger now refuses direct deletion of managed runs. A service-role fixture confirms this refusal without relying on an incidental foreign-key violation, while an unmanaged fixture remains deletable. Baseline, harmless and restored cases pass; seventeen adverse controls detect their intended defects, including removal of the managed-run deletion guard. All fixtures and prototype DDL roll back.

This is a preservation guard, not an implemented retention policy. An authorized retention/deletion command and its user workflow remain unimplemented. Concurrent locking, relaunch, artifact binding, both worker adapters and interruption recovery also remain open. The prototype must not be installed as a complete lifecycle replacement.

## Two-session claim contention checkpoint

`verify_contention.py` creates a uniquely named private schema in the explicitly selected disposable stack. It copies the application run and stage columns, checks and indexes, then installs schema-rebound prototype commands on those copies. It does not install the prototype on application tables. Copies omit original foreign keys, application triggers and RLS; the existing rollback suite tests the separate native sequential boundary.

Run:

```bash
OPENPLAN_MODEL_ATTEMPT_TEST_CONTAINER=supabase_db_openplan-restore-target-2026091050 \
  python3 -B docs/reviews/2026-10-08-model-custody-metadata/prototype/verify_contention.py
```

One PostgreSQL session claims a stage and holds its transaction open. A separate session attempts the same stage. The runner observes a real PostgreSQL lock wait with a blocking session before allowing the first transaction to commit. The second command then returns `not_claimed`. An independent query confirms one attempt, two request receipts and the original active owner. Repeating the losing request returns its exact saved response.

Baseline, harmless and restored runs pass. A control removes both queued-status and active-owner eligibility checks; the second worker then wins and the test fails at `second claimant won`. Each run removes its own private schema and verifies its absence. Statement and idle-transaction timeouts bound owned sessions.

This proves one controlled claim interleaving, not arbitrary scheduling, application RLS, reaper-versus-writer races, legacy-write deadlock recovery, worker interruption or scientific accuracy. Those checks remain required before installing the protocol.

## Completion and reaper contention checkpoint

The contention runner now exercises both orders of completion and reaping after a committed claim. In each case it observes the second session blocked on a PostgreSQL lock before committing the first session.

When the reaper commits first, the waiting completion command fails with the specific ownership refusal. An independent query confirms failed run and stage statuses, no active attempt, a retained revocation and no write receipt. When completion commits first, the waiting reaper returns false. Independent reads confirm succeeded run and stage statuses and one write receipt.

Baseline, harmless and restored cases pass for both orders. Removing the reaper terminal-state check permits reaping the completed run and fails at `terminal run reaped`. Removing the overlapping ownership and terminal-state checks permits the revoked worker to succeed and fails at `revoked writer succeeded`. The original competing-claim cases also pass. Every case removes its private schema and verifies its absence.

This extends the prior single-interleaving evidence. It still uses copied tables without original application foreign keys, triggers or RLS. In particular, it does not prove application timestamp freshness, all possible schedules, legacy-write deadlock handling, worker adapters, durable journal recovery, artifact upload fencing or scientific acceptance.

## Retained relaunch checkpoint

The existing launch route resets parent and stage state and deletes prior output metadata through separate requests. The prototype adds a single relaunch command for a failed or cancelled run with an existing stage set. It validates workspace and expected update time, retains full prior run and stage records in a private receipt, revokes active attempts, resets the same stages and records refreshed inputs. An exact retry returns the same receipt and does not increment failure history again. Historical claim receipts remain historical; they do not authorize a new write.

Native checks prove scope and stale-state refusal, changed-payload refusal, retained prior status and error, refreshed inputs, one failure-count increment and no leaked temporary authority. The test completes the reset predecessor, claims the same formerly failing stage with a new attempt and confirms that the old attempt cannot write. Twenty adverse controls now pass by detecting their intended assertions, including missing scope checks, stale-state checks and retained-KPI refusal.

Relaunch currently refuses any run with artifact, KPI, claim-decision or validation-result records. A native null-valued KPI fixture proves refusal without deleting or changing that record or its failed run. This is an explicit incomplete boundary, not the final recovery design. Attempt-aware output storage and readers must retain and distinguish previous results before this refusal can be removed. Legacy output insertion can still race this check until output writes join the protocol.

The command is not connected to the application launch route, access-control/action approval, worker dispatch or either worker package. Relaunch concurrency, a forced mid-transaction relaunch failure, populated output retention and installed recovery remain unproved. The rollback-only runner leaves no relaunch receipt table installed. Do not deploy this prototype as the completed lifecycle.

## Relaunch rollback checkpoint

A temporary trigger now refuses the final relaunch receipt insertion, after the command has attempted its parent and stage updates. Independent SQL compares complete run, ordered stage and ordered attempt JSON records against pre-call snapshots. All remain identical after the refusal. No relaunch receipt or temporary authorization remains. Removing the trigger allows the same request and payload to succeed through the existing retry tests.

Baseline, harmless and restored cases pass. Twenty-one adverse controls detect their intended defects; omitting receipt insertion fails at `relaunch receipt boundary omitted`. The fixture starts from a failed run whose attempts were already revoked, so this check does not demonstrate rollback of a newly applied active-attempt revocation. The full-record comparison proves preservation of the retained attempt records in this fixture.

This supersedes the earlier missing forced-failure boundary. Relaunch concurrency, output retention, active-worker interruption and actual route/worker integration remain open. All temporary fault-injection objects and data roll back with the native test transaction.

## Concurrent relaunch checkpoint

The separate-session runner now includes relaunch receipts and private copies of the four output metadata tables. A failed run is relaunched in one open transaction. A second session either repeats the identical relaunch request or submits success from the old attempt. Both cases observe an actual PostgreSQL lock wait before the relaunch transaction commits.

The identical retry returns the first receipt. Independent SQL confirms one relaunch receipt, one failure-history increment, queued run/stage status, no active attempt and only the original failure write receipt. The old worker receives the ownership refusal and leaves that same queued state intact.

Baseline, harmless and restored cases pass. Ignoring the relaunch receipt causes the concurrent retry to fail with changed state, which the control detects. Removing the overlapping attempt/status checks lets the old worker overwrite the relaunched state, which fails at `old writer survived concurrent relaunch`. The previous claim and reaper races continue to pass. Each case removes its private schema.

These are controlled PostgreSQL interleavings on copied tables, not application RLS or original-trigger evidence. The old attempt in this fixture was already revoked by failure. Active process shutdown, all lock schedules, output-write races, provider dispatch and populated restart recovery remain outside this proof.
