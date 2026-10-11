# Coordinated worker and database recovery point, October 11

The known synthetic model worker root and full native database recover together
from one encrypted point into a separate local cluster and volume. The installed
model command CLI recovers a lost reply with identical request and response
bytes. It does not compute again. This advances M3 custody and recovery evidence;
it does not complete M3 or validate a demand model.

## Identified source and point

The application and operator source is
`9446f76af65106897eb8a693c5aff9817de5de7f`. Fixture drivers record their
pre-execution hashes separately. The base is the retained transit point from
`bf1f6ffa710b11b7f36747a676943edab667a4ae`, not current main. Current main is
observed at `7d92f3971482f0399f5f1a7cb6a495fab980124a`. These identities have
different purposes and do not establish current-main acceptance.

A subsequent fetch observes main at
`d3e3b59891c485bcf4b3453b677a2c5f83f085c0`, following PR199's external merge
at 15:15:15 UTC. Its complete tree equals the identified `9446` source. The
earlier main observation remains historical; no release acceptance follows.

The source first restores that base into a new bounded cluster. It adds labeled
synthetic run, stage and custody records through existing native mechanisms.
The actual installed command CLI sends a legacy KPI command through PostgREST.
The bridge drops its HTTP 200 reply after commit. The CLI reports
`delivery_unconfirmed`, retaining the original unresolved request. A second
command retains a resolved native receipt. Local checkpoint producers retain
one dummy completed result and one interrupted start. No scientific engine runs.

After stopping the exact owned API and verifying no database sessions, the
source retains both populated SQLite WAL journals through the actual
[snapshot operator](../2026-10-11-worker-journal-snapshot/STATUS.md). It captures
the complete known root, including private modes and empty directories, under
the same quiescent interval as the database dump, roles, configuration, key and
retained Storage bytes. The journal mapping preserves original relative paths.
This is an owned fixture cut, not a general fence against live or hostile writers.

Encrypted snapshot
`df82b7e6eb10c801c901c5ce943364dd6b752f54e8c99b04f5f8e6de6bc44360`
contains 1,549 files totaling 644,725,324 bytes. Its model root has five files,
seven directories and two populated journals. The unchanged transit portion
retains ten Storage objects totaling 119,425,015 bytes and three worker roots
with 1,515 files totaling 512,549,833 bytes. Full encrypted read checking and
actual file restoration pass. Secrets, SQL rows and private files remain outside
Git. [Selected results](evidence/source-point.json) contain no command payload.

The archived [source cut](drivers/source_cut.py),
[target recovery](drivers/target_recovery.py) and
[final preservation driver](drivers/final_preservation.py) match the retained
executed files. These are fixed fixture drivers with private prerequisites,
not standalone installation or restore commands. The
[driver hash record](evidence/retained-driver-sha256.json) binds those files and
their retained private helpers. Use the supported operator instructions for
real installations; do not run these archived drivers against another stack.

## Separate target and original command recovery

The target uses its own PostgreSQL cluster and volume, with no published database
port. It reconstructs 31 roles and 25 memberships, including passwords, grants,
grantors and settings. Database properties and independently mounted key bytes
match. All 374 table images, six sequences, 769 policies and 27 default-privilege
groups compare successfully. See [database results](evidence/target-database.json).
The expected semantic schema observation is supplemental evidence outside the
encrypted point. Its raw schema hash matches the unchanged captured native image;
this is not a fresh catalog read inside the capture interval.

The installed `model_command_recovery.py` uses the original saved logical origin
and installation identity. A wrong installation exits before HTTP and leaves
the restored root unchanged. The correct command makes one native request.
Its request SHA-256 is
`9b107e712cc9fa9dd2ca288084b3e98d91d59b76d380289b9e9f92a1058d7d09`;
its response SHA-256 is
`107dfbe876b3972a025d617c1d289e801062eb4b21ef19623eb6e0444447ca63`.
Both equal the source exchange. The native output and server receipt compare
independently. A cached repeat sends no additional request. Missing output and
missing receipt fail in separate rollback-only transactions, then restore.

The saved local result returns without a computation callback. The interrupted
start refuses replay. All 374 table images, six sequences and raw schema remain
unchanged after recovery and rollback controls. Roles, properties and key bytes
remain equal. [Recovery results](evidence/target-recovery.json) retain these checks.

[Final native controls](evidence/final-preservation.json) pass baseline, harmless
policy-role ordering and restored reads. Changed policy predicates, policy roles
and a removed default privilege each fail their intended catalog check in a
rollback-only transaction. A final full native image, role/property/key read and
file census remain equal. The original transit point and both encrypted
repository copies also remain equal. This separate service exits 0 in 61.629
seconds under a 512 MiB driver cap. Its journal reports a rounded 74.4 MiB peak;
the completed service no longer exposes an exact `MemoryPeak` value.

The entire file census permits exactly two SQLite files to change. The stage
journal changes from DELETE to WAL mode with identical logical rows. The command
journal retains the recovered original receipt; every other record stays equal.
Native checkpoints on the exclusively owned idle fixture return `[0, 0, 0]`.
They close empty observer-created sidecars; they do not establish a generic
writer fence. Inputs, output bytes, empty directories and private modes remain
equal. The captured source point stays unchanged. Exact source and target APIs
and databases are stopped; volumes and failed proof trials remain retained.

## Controls and resource limits

[Read-only preflight controls](evidence/preflight-controls.json) exercise four
positive controls, 28 bad observations and 12 omitted guards.
[Known-root controls](evidence/root-controls.json) retain populated native WAL,
remove required input/output/empty directories, change modes, omit receipts and
interrupted starts, change installation identity, use a main-file-only copy and
corrupt a native index. Omitted comparison, integrity, directory and JSON-shape
checks fail their intended oracles. The standalone control root includes a sixth
prefix-neighbor note file; it is distinct from the five-file joined point.
Mutation copies restore in `finally`.

[Source-cut controls](evidence/source-cut-controls.json) exercise three positive
controls, 17 bad observations and 17 omitted guards.
[Recovery controls](evidence/recovery-controls.json) exercise three positive
controls, 19 bad observations and 19 omitted guards. One omitted native-pair
type check uses an isolated probe with both fields absent to avoid masking by
the later content check. Each bridge has separate route/method/token/status
controls. The existing schema, role, bootstrap and attachment controls also pass;
their private reports remain retained.

[Final driver precondition controls](evidence/final-driver-preconditions.json)
exercise the exact archived stop and readiness AST nodes with fake observations.
Stopped and delayed-ready observations survive; running and exhausted-readiness
observations fail. Omitting each predicate fails its expected oracle. This
separate check does not prove native service identity or readiness timing.

Native services run serially. Each database has a 1 GiB cap, no additional swap,
one CPU and no database port. PostgREST has a 128 MiB cap. The source-cut driver
exits 0 in 133.275 seconds, peaking at 1,073,745,920 bytes against a
1,073,741,824-byte cap. The observed accounting peak reaches the limit. Its
completed cgroup has no available `memory.events` file, so an OOM counter is not
established. Target bootstrap exits 0 in 40.041 seconds, peaking at
1,063,854,080 bytes. Recovery exits 0 in 61.381 seconds, peaking at 60,436,480
bytes. No spare-capacity conclusion follows from these fixture runs.

## Retained failures and corrections

Failed runs remain separate from passing continuations:

- The first known-root run leaves observer-created SQLite sidecars after its
  main-file-copy control. Later runs close and remove only those owned fixture
  sidecars. Final root controls pass with pre-execution source hashes.
- The first source cut commits its synthetic command but fails an incomplete
  expected write graph. Native triggers also enroll the run and update its
  selected parent timestamp. A fresh database verifies the six-table graph and
  all unaffected records. The first populated database remains retained.
- One fresh-source driver fails an import namespace collision before creating
  its database. A separate corrected driver restores a fresh source.
- Another cut starts after a shell prerequisite failure and immediately fails
  on missing API metadata before native writes. Subsequent dependent launches
  use checked separate calls. That failed trial is not accepted.
- Source API readiness initially counts a stopped retained service as active.
  A continuation checks the stopped service's unchanged identity and the exact
  active peers separately.
- Target network allocation fails before database attachment because Docker's
  automatic pools are exhausted. A separate reader compares current Docker and
  host routes, then creates one unused explicit private subnet. It removes no
  existing network.
- The first recovery control has an omitted type guard masked by a later
  predicate. The final driver uses a recorded isolated omission probe.
- The first final-preservation runner fails its helper import before starting
  the database. Its separate correction retains the failed source and logs.

## Disposition and remaining work

PR200 is observed merged externally into PR199 at
`09231fd3621b0e17d0f8a95269bae4ed0a8d4676`. Its tree equals the identified
`9446` source. PR199 is subsequently observed merged externally to main at
`d3e3b59891c485bcf4b3453b677a2c5f83f085c0`. CI, live RLS and worker workflows
pass on that parent merge commit. These are separately inspected GitHub results,
not a successful-push claim. [Parent CI receipts](evidence/parent-ci.json) retain
the inspected run URLs and source identities. This new evidence branch awaits its own checks.
This session performs no main merge, tag, release, hosted schema application or cutover.
The relaunch agent retains hosted coordination and the main merge hold.

The proof uses the same physical host and disk, a known synthetic root and a
legacy custody command. It does not cover the current managed-stage dispatcher,
every worker family, useful computation beyond 45 minutes, generic live-writer
fencing, hardware loss, a clean agency installation or historical Vault
decryption. It establishes no browser, keyboard, screenshot, practitioner,
public-participant, scientific or hosted acceptance. Those boundaries remain
on the roadmap; the complete V1 contract and capability grades stay unchanged.
