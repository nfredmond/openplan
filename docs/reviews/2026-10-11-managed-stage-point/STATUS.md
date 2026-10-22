# Managed admission and progress recovery

The synthetic source and separate target recover both original managed commands
with exact request and response bytes. Execution admissions, immutable native
start records and attempt-owned files survive. Recovery admits no callback.
This is existing helper and writer custody evidence, not normal poller delivery.
The complete M3 and V1 requirements remain open.

## Identified source and point

Production source is `93b052a2ee3a8f8232510fbd478208722014fa7f`. All twelve
selected application, command, journal, admission, workspace and worker helper
hashes match the read-only preflight. The earlier data source is encrypted point
`df82b7e6eb10c801c901c5ce943364dd6b752f54e8c99b04f5f8e6de6bc44360`.
It is retained synthetic data, not a current-main database.

The new source restores that complete point into project 1135 and its own volume.
It creates two separately labeled queued synthetic runs and stages. The existing
`invoke_new_attempt` helper sends native claims through bounded PostgREST:

- A dropped committed claim reply leaves the original request unresolved,
  its admission unconsumed and its callback count zero.
- A separate retained claim and current ownership read admit one dummy callback.
  Its bound `AttemptWriter` creates the exclusive attempt workspace and writes
  synthetic input/output bytes. The progress reply is dropped after native
  commit. The writer stops and refuses later writes.

The database records two immutable `queued_to_running` execution starts through
migration18's existing trigger. Both timestamps occur at or after the corresponding stage
start. They remain conservative execution witnesses even where the local
callback count is zero. Original rows in all eight affected tables stay equal,
except the selected model's documented timestamp update from the new parent.
All other tables, sequences and raw schema remain equal.

The exact source API stops before capture. No database sessions remain. The
installed SQLite snapshot operator retains both populated WAL journals while
exclusive fixture keepers retain their source state. Original journal bytes and
logical rows remain equal during the capture interval. This is known-fixture
quiescence, not a generic writer fence. Closing keepers afterward may checkpoint
physical journal files.

Snapshot `679c4c31d435042f1712c8f8b43e1e05e2baf700aa39c027a9f86b911de5e3c6`
contains 1,557 files totaling 644,784,815 bytes. The new managed root contains
five files, 13 directories and two populated journals. It includes the consumed
and unconsumed admissions, owner marker, synthetic input/output files and empty
scratch directory. The previous model root, ten Storage objects and three GTFS
roots remain in the complete point. Full encrypted read checking and actual file
restoration pass. See [source results](evidence/source-point.json).

## Separate target recovery

Project 1136 uses its own PostgreSQL cluster and volume, without a database port.
All 374 table images, six sequences, 31 roles, 25 memberships, database properties,
key bytes, 769 policies and 27 default-privilege groups compare successfully.
The complete file census matches before recovery. See
[target database results](evidence/target-database.json).

The semantic schema expectation is supplemental evidence outside the encrypted
point. Its raw schema hash matches the captured unchanged native schema. It is
not a fresh catalog observation inside the capture interval.

Fresh installed `model_command_recovery.py` processes use the original saved
logical origin and installation. Wrong installations refuse before HTTP. Each
correct recovery makes exactly one native POST whose request and response hashes
equal the source exchange. Independent native receipt, request, attempt, stage
and parent records match. A cached repeat sends no request. Missing claim and
progress receipts fail separate rollback-only controls, followed by exact
restored server-pair reads.

Both saved claim invocations refuse callback reentry before transport. Admission
values remain zero and one. The installed CLI reads current ownership for both
claims but explicitly denies continuation and model resume. Cancelled-parent and
inactive-attempt native rollback snapshots return no ownership through the
existing reader with exact filter and projection checks. These are snapshot
interpretation controls, not real distributed lease replacement. See
[recovery results](evidence/target-recovery.json) and
[native projection controls](evidence/native-ownership-projections.json).

After recovery all 374 native table images, six sequences and raw schema remain
unchanged. Roles, properties and mounted key bytes remain equal. [Both known model roots](evidence/both-known-root-preservation.json) retain their
required files, empty directories and modes. Exactly two
local SQLite files change to retain their original receipts. Every other logical
row, admission, owner/input/output byte, empty directory and mode stays equal.
The two exclusively owned idle checkpoints return `[0, 0, 0]`; this closes empty
observer sidecars and does not fence arbitrary writers. Source point bytes remain
equal. Exact source database, both source APIs, target API and target database
are stopped; volumes, networks, databases and failed trials remain retained.

## Final checks and controls

[Final preservation](evidence/final-preservation.json) passes all native images,
roles, properties, key, source/target file census and both encrypted repository
copies. Native policy-predicate, role and default-privilege mutations fail their
intended schema checks in rollback-only transactions. Baseline, harmless policy
role ordering and restored catalog reads survive.

Four further native ownership cases demonstrate that removing the existing
parent-status or active-attempt predicate fails the intended ownership assertion.
A harmless source comment survives. Production helpers remain unchanged; only
in-memory functions consume native rollback snapshots. No model, live CLI
revocation or continuation occurs.

The source guards pass three positive controls, 36 broken observations and 26
omitted guards. The bridge passes three positive controls, 19 broken observations
and 13 omitted checks. Omission probes isolate type/size predicates where later
checks would otherwise mask them. Their categories are explicit in the retained
reports. Pure observations establish no native database or network acceptance.

Target capture binding has ten targeted broken-field and omitted-guard cases.
Container, bootstrap, role, schema and network controls pass before native launch.
Eight recovery guard groups each retain baseline, harmless, broken, omitted and
restored controls. Seven actual disposable-copy controls reject changed owner
bytes, missing inputs/outputs/empty directories, changed private mode and removed
admissions. Omitting the protecting comparisons makes each new copy test fail
its intended assertion. Original roots remain unchanged in `finally`.

The exact archived [source seed](drivers/source_seed.py),
[source capture](drivers/source_capture.py),
[target recovery](drivers/target_recovery.py) and
[final observer](drivers/final_preservation.py) match retained executed files.
[Driver hashes](evidence/retained-driver-sha256.json) and private pre-execution
manifests bind 47 source, 35 recovery and 39 final-observer dependency files.
These fixed fixture archives need private prerequisites. They are not supported
standalone installation or restore commands. Payloads, SQL rows, role/password
records, keys and connection data remain outside Git.

## Resources and retained failures

Each database runs under 1 GiB with no additional swap and one CPU; each PostgREST
has 128 MiB. Native phases run serially. The source exits 0 in 134.247 seconds,
recovery exits 0 in 63.967 seconds and final observation exits 0 in 61.875 seconds.
Final observation has a 512 MiB cap. [Unit accounting](evidence/unit-accounting.json)
retains actual exits and rounded journal peaks. The source's active peak reaches
its 1 GiB cap despite the 256 MiB Restic Go memory target. Completed exact peaks and
OOM counters are not established by the retained unit summary. No spare-capacity
acceptance follows.

Failed trials remain separate:

- Source seed 01 fails a private import namespace collision before native writes.
  Seed 02 commits the two commands, then refuses an incomplete expected graph
  that omits immutable execution starts. Its database and journals remain intact.
  A fresh source database restores the unchanged base and verifies the failed
  database remains equal. Seed 03 verifies all eight affected tables and original
  rows before capturing the accepted point.
- A target attachment observer's broken subnet equals the new selected subnet
  after replacement. It fails before network launch. The corrected observer
  uses a genuinely different subnet; the failed source remains retained.
- The first copy-test omission runner inserts its replacement before module
  initialization, which overwrites it. Its oracle fails. The shell continues
  to an independently controlled target network launch, but receipt recovery
  stays held until correction. The corrected runner injects after module load;
  all seven intended omission assertions fail. The failed runner remains retained.
- A post-recovery elapsed-process observation encounters terminal PID 0. It does
  not alter the successful native result; the corrected observer reads only a
  positive live PID and retains the actual unit exit separately.

## Integration disposition and limits

A fetch observes PR201 merged externally into main
`a849c9b37e41883b8fd100d1c928224a1b5a745b` at 16:23:32 UTC. Its complete tree
matches the identified source 93b. PR201's CI, worker and live RLS checks pass.
Main's upgrade and worker checks pass at the last read; main CI and live RLS are
still running. This session performs no main merge, tag, release, hosted schema
application or cutover. The relaunch agent retains hosted coordination and the
main merge hold. This evidence branch awaits its own review and CI.

Normal demand pollers still do not call fresh admission. This proof does not
connect them or reconstruct a running writer. It covers one known synthetic
admission/writer root on separate local clusters and volumes, on the same host
and disk. It does not establish every worker family, useful computation beyond
45 minutes, installation-wide alignment, hardware-loss recovery, clean agency
commissioning, historical Vault decryption, browser, practitioner, scientific or
hosted acceptance. Complete nationwide, California, tribal/overlap, territory,
independent-installation and separate-engine validation requirements remain.
