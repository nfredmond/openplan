# Model stage claim prototype

This executable database prototype starts the attempt-ownership design in the parent directory. It is deliberately outside application migrations and has no worker caller. Do not deploy it as a completed ownership fence.

## Current scope and evidence

The sections below preserve the order of development. Later checkpoints supersede earlier missing-feature statements only where they say so. Current coverage includes attempt claims, stage and parent write guards, fixed stage sets, atomic success/failure, reaping, retained relaunch, and attempt-bound KPI/artifact metadata commands.

The native rollback runner passes baseline, harmless and restored cases plus 46 adverse controls. The separate-session runner passes 44 cases across claim, completion, relaunch, artifact and instrument schedules. The native runner uses original application tables inside rolled-back transactions. The concurrency runner uses private table copies without original foreign keys, triggers or RLS. Neither runner starts a scientific model.

No application migration, launch route, packaged worker or artifact reader uses this protocol. Remaining integration work includes retained-attempt readers, claim/validation custody, populated-output relaunch, worker request journals and adapters, restart recovery, production timestamp/deadlock behavior, and authorized retention. Existing-output relaunch refuses until that retention boundary is implemented. SQL metadata checks do not verify Storage bytes. These gaps prevent describing the prototype as a deployed recovery fix or completed M3.

## Initial claim checkpoint

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

## Attempt-bound KPI checkpoint

Worker inspection found that AequilibraE's KPI helper posts without checking the response. ActivitySim checks returned rows but does not bind them to an execution attempt. The prototype now adds an attempt reference on existing KPI rows, a private write context and exact request receipts. Its command derives the run from the active attempt and checks stage/run state under locks before inserting. Direct legacy inserts into managed runs fail. Attempt-bound records cannot be updated or deleted through ordinary table writes.

The native test writes an explicit null-valued KPI, resolves its exact retry, rejects missing value and changed contents, rejects a direct legacy insert and refuses an update to the retained record. After reaping, a new KPI request from the old attempt fails. Independent SQL confirms one retained null-valued record and no leaked write context. Baseline, harmless and restored cases pass. Twenty-four adverse controls detect their intended defects, including missing-value acceptance, legacy insertion and revoked-attempt insertion.

Historical KPI rows retain null attempt references. No historical provenance is invented. The command is not called by either worker, and readers cannot yet distinguish retained attempts. Artifact bytes, artifact metadata, scientific claim/validation writes, concurrent KPI races and populated-output relaunch remain open. Existing-output relaunch therefore continues to refuse. This checkpoint is database prototype evidence, not a deployed worker fix or scientific acceptance claim.

## Attempt-bound artifact metadata checkpoint

The rollback-only prototype now binds new artifact metadata to an active attempt. The command derives run and stage identity from that attempt, checks ownership under parent/stage locks, and retains an exact request receipt. It requires a SHA-256-shaped hash and a nonnegative integer byte count. Direct legacy inserts into managed runs fail, and ordinary writes cannot update or delete attempt-bound artifact records. Historical records keep null attempt references.

A fresh synthetic run proves exact retry, changed-payload refusal, missing-hash refusal, legacy insertion refusal, retained-row update/deletion refusal and rejection of a new request after reaping. An independent query confirms one record with the intended stage and attempt. Baseline, harmless and restored cases pass. All 29 adverse controls fail for their stated reason, including five artifact controls for legacy writes, missing hashes, revoked attempts, changed requests and deletion. Each transaction rolls back and checks that prototype tables remain absent and the installed reaper definition remains unchanged.

This command records metadata. It does not fetch Storage objects or prove that a supplied hash describes real bytes. Worker byte checks exist separately on the output-receipts branch and are not yet connected to this attempt command. Artifact-write concurrency, retained-attempt readers, claim/validation writes, worker adapters and process recovery remain open. Relaunch still refuses populated output sets. These files are not application migrations and install no persistent protocol.

## Artifact-write contention checkpoint

The separate-session runner now loads the artifact command into its private table copies. Three additional schedules observe a PostgreSQL lock wait before the first transaction commits. Concurrent identical requests return the same artifact receipt and retain one row. Reaping first causes the waiting artifact command to refuse the revoked attempt and retain no artifact. Registering first allows reaping afterward while preserving the one artifact and its exact run, stage and attempt binding.

Baseline, harmless and restored cases pass for all three schedules. Ignoring the receipt rejects an identical retry and is detected. Removing ownership checks permits the revoked registration and is detected. A false reaper rule that exempts runs with artifacts is also detected. The runner passes all 32 cases across claim, completion, relaunch and artifact schedules, then verifies removal of every private schema.

These copies retain columns, checks and indexes, not original application foreign keys, triggers or RLS. The test proves these controlled transaction orders, not arbitrary schedules, original timestamp freshness, worker interruption, Storage byte fencing or installed recovery. Native sequential artifact checks cover a different boundary. The protocol remains a prototype outside application migrations.

## Historical output retention correction

A new native fixture reproduced a gap before the correction: a KPI created before its parent became managed could be deleted. Both output guards checked the new parent on updates and returned early for legacy deletion, so a record without an attempt reference could also move to an unmanaged parent.

KPI and artifact guards now lock both original and destination parents in identifier order. An existing record is immutable when it has an attempt reference or its original parent is managed. Historical rows retain null attempt references; no execution provenance is invented. Unmanaged KPI editing and deletion remain available.

Native cases reject deletion and reassignment of both historical output types, then independently confirm the original identities and null attempt references. Four targeted mutations permit those deletion/move paths and fail at their intended assertions. Baseline, harmless and restored cases plus all 33 adverse controls pass. All 32 separate-session contention cases pass again after the guard change. The latter still uses private table copies and does not prove legacy row-lock versus command parent-lock deadlock handling. This remains a prototype correction, not an installed production fix.

## Output reader prototype checkpoint

Production KPI and evidence-packet routes currently read output rows by run ID. Retaining prior outputs without changing those readers would mix attempts. A new service-only prototype function returns raw artifact/KPI records with explicit ownership states: current in progress, current completed, retained inactive, unknown legacy provenance, or invalid binding. It checks the requested workspace and uses a stable database snapshot. The caller must still authorize that workspace. Completion here means lifecycle completion, not scientific acceptance.

Native cases cover empty results, wrong-workspace refusal, null KPI preservation, unknown legacy rows, active production, completed-stage outputs and retained records after reaping. A malformed artifact-stage fixture uses a temporary administrator trigger bypass within the rollback transaction and is classified invalid. The trigger is reenabled, and all fixture changes roll back. The reader grants no execution to anonymous or ordinary authenticated roles.

Baseline, harmless and restored cases plus 37 adverse controls pass. Four new controls detect removed workspace scope, fabricated legacy provenance, revoked output promoted to current, and ignored artifact-stage binding. The runner also verifies that the reader function is absent after rollback. This does not install an API, change production readers, establish user authorization, verify Storage bytes, or prove concurrent read/relaunch snapshots. Populated-output relaunch remains refused until the full reader and writer integration is complete.

## Concurrent output snapshot checkpoint

`verify_output_snapshot.py` pauses the reader between its parent query and output query using an injected advisory lock. It observes the actual lock wait, commits reaping from another database session, releases the reader, and performs a fresh read. The paused stable function returns the earlier running state and its current output together. The fresh read returns failed state and the same raw record labeled inactive. Neither read nor reaping changes the retained KPI.

Baseline, harmless and restored cases pass. Changing the function from STABLE to VOLATILE makes its output query observe the later revocation while its parent record still reflects the earlier state. The test rejects that mixed snapshot. Every case removes its private schema and verifies absence.

Run against the named disposable stack:

```bash
OPENPLAN_MODEL_ATTEMPT_TEST_CONTAINER=supabase_db_openplan-restore-target-2026091050 \
  python3 -B docs/reviews/2026-10-08-model-custody-metadata/prototype/verify_output_snapshot.py
```

This controlled read/reaper schedule uses private table copies without original application foreign keys, triggers or RLS. The advisory pause is test instrumentation only. It does not prove concurrent read/relaunch, HTTP caching behavior, application authorization or any worker recovery path. A returned snapshot can become stale after it is read; a caller must not treat it as a new write authorization.

## Scientific projection refusal checkpoint

The direction check passes on the October 8 reader checkout, with reminders for older capability/jurisdiction reviews and intervening release changes. The full M3 outcome remains installation, teammate use, maps, scheduled jobs, both demand workers, restart/cancel, separate-host backup/restore and upgrade. These prototype checks do not close that outcome.

The production AequilibraE evidence-spine helper still upserts claim decisions, deletes validation rows and posts replacements through separate requests. The launch route also clears all four output/projection tables through separate requests. Current reader queries therefore cannot safely authorize populated recovery merely because artifact/KPI attempt records exist.

A prototype trigger now refuses legacy writes to claim-decision and validation-result rows when either their original or destination model run is attempt-managed. It locks both parents in identifier order. Native fixtures preserve original prototype-only/warn rows and reject insert, update, delete and reassignment for both tables. An unmanaged claim insert/delete remains available. No scientific tier, formula or acceptance tolerance changes.

Baseline, harmless and restored cases plus 40 adverse controls pass. New controls permit insert, delete or reassignment and fail at their named assertion. The first reassignment mutation also permitted deletion and was caught earlier; it was narrowed to preserve deletion protection and reach the intended reassignment failure. The runner verifies the guard function is absent after rollback.

This is an explicit refusal until an attempt-bound scientific-ingestion command exists. It is not that command, does not make legacy county projections attempt-aware, and does not prove concurrent projection writes or access through a user route. Do not install the prototype while packaged workers still depend on these legacy writes. Populated-output recovery remains refused.

## Attempt-bound instrument successor prototype

The existing v4 assessment command creates its own legacy artifact rows and constrains the rules version to 4. The v2 instrument table has no method/output identity and permits one row per run. Neither can receive the required two-method attempt records unchanged. The prototype therefore adds a separate custody table and exact request receipts, preserving both historical contracts.

The command derives workspace, run and stage from the active attempt. It binds an explicit demand method, model output, five instrument artifacts and their hashes. All six artifact records must belong to that attempt. Output and assessment metadata must identify the same demand method. The successor reuses the installed v2 artifact/schema validation trigger and append-only mutation guard. Direct table insertion is unavailable to the service role; only the command can insert. The frozen diagnostic instrument remains inconclusive and cannot promote a passing claim.

Native synthetic fixtures retain both methods under one run, return exact receipts on retry and refuse changed request contents, wrong method/output hash, swapped artifact, attempted passing outcome and new custody after reaping. The revoked case uses a fresh, previously unregistered bundle so a uniqueness violation cannot mask a failed ownership check. Baseline, harmless and restored cases plus 46 adverse controls pass, including six instrument controls. Tables and functions roll back; historical v4/v2 records are unchanged.

This checkpoint binds synthetic metadata only. It does not read Storage bytes, prove preparation before output access, implement all inter-artifact semantic references, execute either model, connect normal workers or produce claim-decision/validation projections. The same-attempt artifact requirement matches the tested registration path; cross-stage prepared artifacts need an explicit identity contract before supporting that path. Concurrent instrument retries, actual packet ingestion, v4 upgrade behavior and downstream readers remain open. Populated-output relaunch remains refused. Do not install the prototype as a completed scientific or recovery connection.

## Concurrent instrument custody checkpoint

The contention runner now includes the successor instrument command and schema-rebound copies of the existing v2 validation/mutation helpers. An identical request waits for the first transaction and returns its exact receipt, with one custody record. If reaping commits first, the waiting instrument command refuses the revoked attempt and retains no custody record. If registration commits first, reaping preserves its custody record and attempt binding. Six pre-registered artifact records remain separate from successful custody.

All 44 cases pass, including baseline, harmless and restored cases for three instrument schedules. Removing receipt lookup rejects an exact concurrent retry and is detected. Removing ownership checks permits the revoked registration and is detected. An invented reaper exemption for instrument-bearing runs also fails. Each case observes a real database lock wait and verifies private-schema removal.

The first setup attempt failed because the private schema lacked the workspace table required by the successor foreign key. The copy runner now explicitly omits that workspace foreign key, consistent with its existing omission of application foreign keys/triggers/RLS. The native sequential runner retains the real workspace constraint. This is controlled transaction evidence, not full-schema concurrency, native worker interruption, persisted request-journal recovery, preparation-order proof or scientific acceptance.

## Logical packet byte integrity checkpoint

The instrument producer uses two different comparison-basis identities. The assessment's `exact_inputs.comparison_basis_sha256` comes from the shared evaluator's canonical JSON representation. The diagnosis's `bindings.comparison_basis_sha256` comes from the saved file bytes. The prototype packet validator now checks both explicitly rather than treating those hashes as interchangeable. It reuses `model_validation_core_v5.validate_basis` and `sha256_payload`.

The validator accepts supplied logical bytes for the output, observation package and five instrument documents. It checks schemas, run/method, the diagnostic outcome/rules version, output binding, bundle/audit/package links, assessment exact inputs and diagnosis file hashes. It returns exact byte sizes and SHA-256 values. Six synthetic tests cover both methods, changed output/input, wrong run/method, attempted promotion and the distinct canonical/file identities. Reformatting a basis preserves its canonical identity but requires rebinding the diagnosis to the new file bytes.

`verify_packet_controls.py` runs baseline, harmless and restored suites, then removes diagnosis, method and assessment-input checks separately. Each mutation permits an invalid packet and fails at an expected refusal assertion. The exact validator source is restored in a finally block. No frozen study is opened or changed.

This is post-computation packet-reference verification, not proof that preparation preceded output access. It does not load all external readiness sources, validate every observation or inter-artifact semantic relationship, download Storage objects, prove the model-output method from computation, or persist custody. Observation-package contents are hash-bound here, not scientifically assessed. Database metadata and logical bytes still need a single verified worker ingestion path.

## Packet-to-receipt binding checkpoint

The packet helper now prepares the successor custody payload from verified logical file identities and six artifact registration receipts. It requires distinct identified records, the exact run/stage/attempt, expected artifact types, matching hashes and integer byte sizes, matching document metadata, and the caller's expected Storage references. Output metadata preserves an explicit demand method; assessment metadata includes that method alongside the original document. The builder does not perform a network write or generate a new request identity.

Nine synthetic tests pass for both methods and for mismatched ownership, bytes, type, metadata, Storage reference, missing receipt and duplicate identity. The existing canonical/file-hash checks continue to pass. Baseline, harmless and restored runs pass; six removed-check mutations admit invalid data and are detected, including three new receipt ownership/byte/Storage controls.

The provided Storage references must come from the separately verified upload path. Comparing a receipt with such a reference does not itself download or authenticate the object. The helper is still outside packaged workers; no native database receipt is passed through it in this checkpoint. Request journaling, unknown-acknowledgement recovery, complete preparation custody and final ingestion remain open.

## Native packet, Storage and custody checkpoint

The private `native-packet-custody.py/json` probe connects the existing content-addressed uploader from the output-receipts branch with the packet builder and native prototype commands. It checks the named disposable stack's database port before writing. Each method supplies seven synthetic logical-byte files, including its observation package. Fourteen objects are uploaded through the production helper and independently downloaded through authenticated Storage; every byte sequence matches.

Inside one native PostgreSQL transaction, fresh synthetic workspace/model/run/stage records support an actual claimed attempt. Six artifact registrations per method return real retained rows. Those receipts and verified Storage references pass through `build_custody_payload`, then the service-role successor command records each method separately. Repeating each exact request returns its original result. Independent SQL counts two custody rows, two methods and two request receipts.

The prototype DDL and fixture records roll back. Separate queries confirm that attempt/custody tables remain absent and that the installed reaper definition has its original digest. The synthetic Storage objects remain as explicitly unreferenced proof objects in the isolated stack, not as committed scientific custody. Private results retain object references, fixture identities and exact validator/custody/uploader source digests without credentials.

This supersedes the earlier missing native receipt-to-builder proof for this synthetic path. The command calls use SQL inside the rollback transaction, not PostgREST. Neither normal worker entry point, preparation-before-output ordering, model computation, scientific accuracy, process interruption nor durable request-journal recovery is exercised. Production routes/readers and populated relaunch remain unintegrated.
