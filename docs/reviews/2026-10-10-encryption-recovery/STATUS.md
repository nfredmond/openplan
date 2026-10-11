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
