# Model stage claim prototype

This executable database prototype starts the attempt-ownership design in the parent directory. It is deliberately outside application migrations and has no worker caller. Do not deploy it as a completed ownership fence.

The claim transaction retains request and response identities, takes request then parent-run then stage locks, records an attempt only for an eligible queued stage, and binds the active attempt to its actual stage with a composite foreign key. A repeated request returns its original response, including a lost claim. Different contents under an existing request identity fail. An unfinished predecessor prevents claiming a later stage. New attempts and request receipts are unavailable for direct public or service-role table writes; only the service-role command is exposed.

Run against an explicitly named disposable database:

```bash
OPENPLAN_MODEL_ATTEMPT_TEST_CONTAINER=supabase_db_openplan-restore-target-2026091050 \
  python3 -B docs/reviews/2026-10-08-model-custody-metadata/prototype/verify_claim.py
```

The runner checks that prototype tables are absent, loads the SQL and synthetic fixtures in one transaction, runs assertions as the service role, and rolls back. It checks table absence after each connection closes. Baseline, harmless comment and restored controls pass. Ignoring changed request contents and ignoring an unfinished predecessor each fail for their specific assertion. Native verification completed October 8, 2026 in the named restore-target stack. No prototype tables remain installed.

This is sequential transaction evidence, not simultaneous-process contention or production recovery. It now provides attempt-bound stage progress and terminal commands, but not artifact writes, expiry, production relaunch or protection against privileged database administration. Reaper invalidation is now exercised inside the rollback-only prototype. Direct updates to a managed stage are refused. Unmanaged stage writes and run-level writes are not yet fenced. No migration history is changed and no existing study or output bytes are altered.

Next connect relaunch, run-level completion, artifacts and both worker packages before promoting this design into an additive migration. Preserve the complete M3 definition of done and the scientific-ingestion attempt requirements.

## Stage-write checkpoint

The prototype adds a private, transaction-scoped write-context table. Command functions create and remove authorization rows around their stage update. A trigger checks that the update belongs to the active attempt. Service-role REST calls cannot insert those authorization rows directly. The caller cannot bypass this by supplying a boolean flag. Parent and stage locks follow the same order as claims.

Progress and terminal commands retain exact request/response records. Tests prove exact retries, changed-payload refusal, direct legacy-write rejection, no writes after terminal completion, cleared transaction authority and denial of an old attempt after a controlled reassignment fixture. The fixture does not implement relaunch. Returning an old claim receipt is historical request resolution; the worker integration still needs to check current authority before resuming computation.

Baseline, harmless and restored controls pass. Six adverse controls catch changed claim requests, predecessor bypass, direct legacy writes, post-terminal writes, changed write requests and old-attempt writes after reassignment. Removing the command identity check alone was still caught by the trigger, so the stale-overwrite control removes both identity checks and fails at the expected old-worker assertion. No table remains installed after the test transactions close. The initial control run that encountered the second guard was corrected rather than accepted as the intended failure.

`write.sql` remains prototype code. It does not mark parent runs complete, coordinate the existing reaper, stop scientific processes or recover journals. Those gaps prevent deploying this protocol or claiming M3 completion.

## Reaper checkpoint

A retained managed-stage flag now survives clearing the active attempt. The prototype replacement for `reap_model_run_if_stale` locks the run and its stages, rechecks progress, records revocation on active attempts, clears active references and closes unfinished stages in one transaction. It creates temporary write authorization for that operation and removes it before returning. Direct callers cannot clear the managed flag to regain legacy write access.

Native tests confirm that an older snapshot does not reap fresh progress, valid reaping revokes the active attempt, post-reap legacy writes fail, managed-stage downgrades fail and an old attempt cannot write after reaping. Eight adverse controls now pass by detecting their intended defects, including loss of the persistent stage fence and omission of the revocation record. After every test, prototype tables are absent and the installed reaper function definition has its original digest. All reaper replacement DDL is rolled back.

This is not production integration. Run-level writes are still unfenced, the launch route does not use the prototype, neither packaged worker has an attempt adapter, and no multi-process race or long-run liveness evidence is claimed. The original late-worker defect remains in deployed code until the complete protocol replaces those paths.
