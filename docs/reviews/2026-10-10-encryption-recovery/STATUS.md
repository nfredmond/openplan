# Preserve database encryption keys during local recovery

This is an unreleased operations candidate. It addresses the existing v1 data
custody and independent-installation requirement. It does not add a product module
or change the contract. Full current-head CI and the two-stack full archive drill
remain required before integration.

## Reproduced problem and change

A newly initialized PostgreSQL cluster restores the same synthetic Vault
ciphertext but cannot decrypt it with its different root key. The actual failure
is SQLSTATE 22000, `invalid ciphertext`. The root key lives in a mounted file,
outside the PostgreSQL dump. Earlier full archive evidence excludes protected
configuration and does not establish this recovery boundary.

The candidate captures the source root key, the fresh target's original key and
a checked intent before changing the target. The files stay private. It verifies
the exact container ID, image, project label and read-only file bind. It refuses
unrelated keys, changed bindings, changed payloads and existing target Vault
secrets. It atomically replaces the target file, syncs the file and directory,
restarts only the recorded target and verifies its actual mounted bytes.

The source root key stays unchanged. An interrupted restart can use the original
intent and retained bytes. The bounded `--recover-target-key` command accepts the
recorded disposable target. It does not declare the entire installation restored.
The full restore command still refuses existing capture and recovery databases.
The [operator guide](../../../openplan/docs/ops/BACKUP_AND_RESTORE.md) describes
that distinction and the retained-key command.

The full archive drill now seeds a synthetic encrypted record and checks its
actual decryption on the target. A metadata or ciphertext checksum alone cannot
satisfy that check.

## Evidence and limits

[Combined operations tests](python-tests.json) pass all 113 tests in 12.602
seconds. Two earlier combined runs expose fixture permission assumptions. Their
failed logs remain retained. Synthetic mount and replacement modes are now
explicit; production key code stays unchanged by that correction.

- [Guard controls](guard-controls.json): six harmless or restored controls pass;
  47 broken variants fail at assertions. Private copies leave original bytes
  unchanged. The tests use synthetic files and mocked Docker. They do not prove
  native PostgreSQL startup, physical persistence after power loss or full backup
  coverage.
- [Existing restore controls](existing-restore-controls.json): all 45 retained
  controls behave as declared. The runner now includes the key helper in its
  private copy. The custom-role test refuses key capture before compatible roles.
- [Native key controls](native-controls.json): baseline, harmless and restored
  runs decrypt correctly. Omitting replacement or changing the retained payload
  leaves ciphertext unreadable. Omitting restart leaves the target stopped.
  In-place replacement decrypts but fails the atomic file identity check.
- [Interrupted recovery](interrupted-recovery.json): interruption occurs after
  the atomic replacement and before restart. The target is actually stopped.
  A fresh Python process uses the retained intent and bytes, restarts the exact
  target and decrypts the synthetic record. The old target key and source key
  remain unchanged. This report exercises the helper. The separate native CLI
  report below exercises the operator entry point.
- [Native recovery CLI](native-cli.json): a second fresh, owned 1 GiB cluster
  uses the actual `--recover-target-key` entry point in an isolated Python
  process. It recovers the stopped target after atomic replacement and decrypts
  the saved synthetic record. Harmless and restored runs pass. Tampered payload,
  omitted replacement and omitted restart cause native refusals. The source root
  key stays unchanged. This is a bounded key-step proof, without Auth, Storage,
  OWP, RLS or installation cutover acceptance.
- [Native canary](native-canary.json): the actual shell's source SQL seeds an
  encrypted record in the synthetic source database. Its 4,793-byte dump replays
  into the new target cluster's verified empty bootstrap database. The actual
  shell canary block passes baseline, harmless and restored runs. Missing
  identity and wrong decrypted bytes cause actual refusals. This does not run
  the whole Auth, Storage, OWP and live RLS drill.
- [Source hashes](source-hashes.json) identify the tested helper, integration,
  shell, tests and control runners. No database root key or key fingerprint is
  included in these public records.

Both native targets are independently initialized owned containers with a 1 GiB
limit each, swap disabled and no network. Their synthetic databases, new canary
snapshot, volumes and earlier reports remain retained. No demo, hosted database,
existing source roles or existing source root key changes. Proof files remain
under the private `gtfs-managed-ingestion-proof-20261009/encryption-cluster-01/`
directory.

The bounded command refuses SSH and TCP Docker endpoints. These checks assume
an operator-controlled local Docker daemon. They do not validate hosted Supabase,
a remote or physical replacement host, all configuration and service secrets,
external worker journals or production cutover. The previous full archive and
worker restore records retain their original scope. Complete installation
recovery remains open.

## Mounted source bytes, October 11 follow-up

The [native stale-bind fixture](source-bind-gap.json) exposes a capture gap.
An atomic replacement changes the host file, while Docker retains the old
bind. Earlier preparation saves the new host bytes without checking the bytes
mounted in the source container. The synthetic fixture reproduces that mismatch.
Its host file is restored in `finally`. The original source key stays unchanged.

Preparation now compares host and mounted bytes through the recorded container
ID before saving the source key. Initial target capture makes the same check.
[Native refusal](source-bind-refusal.json) confirms the stale source bind refuses
before a source archive is prepared. Existing-intent replay skips the initial
target mount read so a stopped target can recover from its saved keys.

[Operations tests](mounted-key-python-tests.json) pass all 115 tests.
[Guard controls](mounted-key-guard-controls.json) include six harmless or restored
passes and 52 deliberate assertion failures. New failures remove source capture,
initial target capture, byte comparison or immutable-ID transport, or require a
running target during replay. Private copies restore original bytes.
All 45 [existing restore controls](mounted-key-existing-controls.json) also
behave as declared.
[Current source hashes](mounted-key-source-hashes.json) identify this correction.
Earlier reports and source hashes above remain historical evidence.

This guard reads the mounted file. It does not prove the backend loaded those
bytes earlier, validate a concurrent root-key rotation or establish physical
persistence after power loss. Actual decryption remains a separate canary check.
The full archive attempt03 is still running against unchanged c6687b5a source.
Its 360-table and one-object restoration, encrypted canary, sign-in and OWP
reconstruction have passed; its live RLS result is still pending. It cannot
establish acceptance of this newer patch. A new native/full candidate check and
current CI remain required before integration.

## Key-only CI coverage, October 11 follow-up

The restore workflow previously omits key-helper and key-test paths. A future PR
changing only these files can miss the native archive check. The workflow now
lists the helper, test and key-control runner explicitly. Its existing proof
step runs the key controls and retains their report with the restore artifact.

[Operations tests](key-workflow-python-tests.json) pass all 118 tests.
[Workflow controls](key-workflow-controls.json) include baseline, harmless and
restored passes. Six broken declarations fail at assertions: each missing key
path, the missing proof command, a commented command and representative mode in
place of the full archive command. Private copies restore original bytes.
[Workflow source hashes](key-workflow-source-hashes.json) identify the change.
These checks inspect explicit YAML paths and executable command shape. They do
not emulate GitHub events or establish permissions, queue availability, native
recovery or current CI success. The current candidate checks remain pending.

## Completed local archive and current-helper native follow-up

[Full archive and native evidence](FULL_ARCHIVE.md) records the completed local
c668 archive, its exact source boundary, current-helper native mutation,
fresh-process and real CLI checks, and the retained child-script failure.
All completed owned test services are stopped; containers, volumes and proof
remain retained. Current-head GitHub CI and complete installation recovery are
still separate unfinished boundaries.

## Joined full archive and earlier exact-head CI, October 11

[The joined archive record](JOINED_ARCHIVE.md) now completes the frozen
`ba1b497f` drill: 374 tables, one private Storage object, encrypted-record
decryption, actual sign-in, independent OWP reconstruction and 1,499 live RLS
tests pass, with 125 skipped and none failed. The runner and all twelve fresh
services each have a 1 GiB cap, no swap and one CPU. Exact owned containers are
stopped after success; containers, volumes and proof remain retained. Earlier
encryption-only `e24a8e27` GitHub QA, executed shuffle, workers, live RLS and
full archive all pass. The later `3abcd7686` keyless-map join has separate current
checks. Physical host, hosted and complete external-worker recovery, main
integration and release remain unfinished. Older status paragraphs retain their
original source and outcome boundaries.
