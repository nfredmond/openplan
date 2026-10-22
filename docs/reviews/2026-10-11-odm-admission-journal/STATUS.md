# Private aerial admission journal candidate

The disconnected journal preserves original parsed request/admission identity
and one start intent through process exit, stopped-root capture and relocation.
It does not fix the native ODM worker restart defect because the worker does not
call it. No public route, worker contract, engine option or deployment changes.
M3/M5b.2 and the complete v1 contract remain open.

## Implemented boundary

The [design](DESIGN.md) records atomic admission, exact receipt replay, pending
queue bounds and durable started-intent separation. The journal saves its receipt
before returning new admission. An existing exact request replays before capacity
or factory work. Changed parsed payloads, including source URLs, conflict. This
identity covers parsed JSON; it is not a claim about arbitrary HTTP whitespace.

One immediate SQLite transaction records the start context. Only the first call
gets permission; exact replay does not authorize uncertain external work again.
Started records stay out of the accepted queue. No reset, resubmission or engine
reconciliation API is provided. Retained dictionaries are detached from callers.

The private owned root requires ordinary files without symlinks or hardlinks,
including pre-existing SQLite companions. New root creation synchronizes its
parent. Known schema checks reject foreign versions, tables, views, indexes and
triggers before journal-mode changes. Saved request/receipt/context encodings
must retain finite JSON. FULL synchronization, WAL and directory synchronization
protect the declared local boundary. Lock waiting is bounded.

## Tests and fault controls

All nine [ODM scripts](evidence/odm-suites.json) pass serially. The new journal
suite has 52 tests. [57 controls](evidence/controls.json) cover every test with
53 intended failures and four passing complete runs: baseline, harmless comment,
restored after harmless mutation and final restored source. Source mutations
restore in finally, with bytecode disabled. [Source hashes](evidence/unit-source-bindings.json)
match the accepted files.

Checks exercise actual SQLite rows and all projected fields, subprocess exit,
concurrent admission/start, queue bounds, changed identities, immutable start
intent, commit acknowledgment loss, detached values, finite JSON, corrupted
records, private paths/companions, foreign schema, lock budget and FULL mode.
Concurrent admission initializes the schema before racing writers. Three factory
guard controls reach a later independent refusal and fail the expected diagnostic;
they do not demonstrate unsafe insertion. The FIFO and companion probes use a
connect assertion to prevent blocking or modifying an unsafe path. Foreign owner
is a simulated UID mismatch. A connection adapter exercises an unavailable WAL
response; no incompatible filesystem is tested. Injected directory-sync errors
test acknowledgment loss, not physical power-loss durability.

## Native journal-only capture and replay

[The driver](native_recovery.py) runs the real journal in an owned subprocess.
It saves two original admissions, leaves one accepted, records a start context
for the other and exits with code 19 after all journal transactions close. The
actual worker-root CLI captures the stopped fixture and verifies its package.
An independent observer compares every ordinary byte/mode/directory and complete
SQLite schemas/records. SQLite backup normalizes page layout; logical equality
does not imply equal original database page bytes.

A fresh runtime copy replays both original admissions without a new factory,
retains their job/callback identities, excludes started work from the accepted
queue and denies repeated start permission. Changed request/context refusals
work; the accepted record crosses its first start boundary once. A separately
corrupted package refuses actual CLI verification. Original source/package
ordinary bytes and journal images remain equal. [Observations](evidence/native-observed.json)
and [results](evidence/native.json) retain `workerRecoveryAccepted: false`.

All [69 native observation controls](evidence/native-controls.json) pass: three
positive runs and 66 intended refusals for changed, missing and equal-value
wrong-type fields. These mutate observations, not engine behavior. Five executed
repository files retain their [source hashes](evidence/native-source-bindings.json).
This fixture includes no imagery, HTTP worker, engine, callback delivery or live
application. Its source URL is never fetched and its start context is synthetic.

## CI and resource accounting

Existing GitHub jobs do not discover this worker directory. The new scoped aerial
workflow discovers every ODM test script, then runs the journal mutations and
native journal-only driver. [Five local CI controls](evidence/ci-discovery-controls.json)
show discovery of a harmless added suite, actual failure exit 19, refusal of a
removed fail-fast behavior and restored execution. Six operator-reference tests, eight direction/roadmap guard tests and the
direction command pass. Existing review-age reminders remain unchanged.
GitHub acceptance remains pending on the pushed head. Local Python is 3.14.4; the workflow selects 3.11.

[Local accounting](evidence/local-accounting.json) records owned 512 MiB services,
zero extra swap, one CPU and 128 tasks. All exit 0 and stop after receipts are
retained. Final journal controls peak at 60,547,072 bytes; native journal recovery
peaks at 28,868,608 bytes and takes 0.691 seconds in the driver. This small fixture
establishes no long-job or largest-workload capacity.

[Earlier trials](evidence/earlier-trials.json) remain retained. A diagnostic reader
initially omitted multiline assertion messages. A receipt corruption fixture
initially reached both identity and encoding guards; compact encoding now
isolates identity. The first local CI command used an absent `python` alias;
the workflow uses `python3`. Older completed controls and native runs stay
superseded rather than relabeled as current evidence.

## Remaining integration

Retain exact source bytes/hashes and original authority before engine use.
Persist stable engine identity/options and init/upload/commit intents before
transport. Reconcile uncertain external effects against actual engine custody.
Save complete outputs, artifact registration/token/expiry and exact terminal
callback before delivery. Only then connect admission/startup/queue recovery and
replace the existing native worker counterexample with passing original-identity
recovery. The [design](DESIGN.md) retains the staged sequence.

Live application custody/RLS, actual reconstruction, artifact/engine crash
windows, long computation, installation-wide aligned recovery, physical-host
recovery, browser use and independent commissioning are unassessed. No scientific
or practitioner acceptance and no requirement grade changes. Nathaniel holds all
main merges until he confirms both the relaunch and independent Opus review are
complete. Relaunch coordination remains with its owner.

Private proof remains under
`/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/odm-admission-journal-20261011/`.
Original admissions, full roots, raw rows/logs and earlier trials stay private.


## Later concurrent companion-file correction

The [dated race report](../2026-10-11-odm-sqlite-companion-race/STATUS.md) records a
reproduced transient SQLite companion disappearance and its narrow correction.
The current suite has 54 tests and 59 controls. Earlier 52-test/57-control source
bindings and native records above remain historical checkpoints. Missing original
database and unsafe or unavailable companion checks still refuse access.
