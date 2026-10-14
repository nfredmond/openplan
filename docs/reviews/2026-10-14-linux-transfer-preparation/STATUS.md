# Linux transfer preparation

Nathaniel asks to prepare the transfer package before identifying a second
Linux computer. The package retains pinned source and separate isolated recovery
fixtures. It does not capture the current public installation or establish
separate-host restoration.

The private package lives under
`/home/nathaniel/.local/state/openplan/transfer-preparation-20261014/`.
`openplan-linux-transfer-20261014.tar` is 774,789,120 bytes. Its SHA-256 is
`9554fafeb9244993e7556f2ce93164369b92b81303c0ca98d677beef383e0223`.
The completed archive contains the encrypted Restic repository, a pinned Linux
x86_64 executable, portable payload verifier, checksums, receipt and instructions.
The password stays in a separate protected directory and is excluded from the
archive. Separate-channel key delivery and off-machine custody remain pending.

## Retained contents

The source archives pin main `dae9d2457c8a9ba843049d236539ee42b7fe6110` and
PR295 candidate `1bcccca7370f710855bb56cb3224b1553e50e011`. Candidate source is
identified as candidate work. Neither source archive includes installed npm
packages or Docker images. This is not an offline installer.

The payload has 3,213 inventoried files and 1,803,110,083 bytes. It includes the
[October 11 historical sealed point](../2026-10-11-recovery-point-manifest/STATUS.md),
with its database, Storage, roles, database root key, protected configuration and
five worker roots. A separate October 14 fixture supplies the populated
406-migration database dump and its 408-migration upgraded dump. Another separate
artifact retains the [October 13 useful original output runtime](../2026-10-13-odm-runtime-output-intake/STATUS.md).
Their capture identities and acceptance limits remain distinct. They cannot be
combined into one claimed installation recovery point.

## Checks and limits

The pinned Restic executable has SHA-256
`20d4142678d0d95ec11a4759def1b73fd9190abc9ca19e4b62d067c0b387e639`.
Complete encrypted data reading and a local restore pass. Original retained
point files remain unchanged. The restored payload matches exact inventory;
a wrong password returns exit 12 without decrypted stdout. The final archive
entry census matches its completed package and excludes password custody.

The portable verifier passes baseline, an actual harmless timestamp change and
restored controls. Eight broken controls refuse changed hashes, exposed modes,
missing files, extra files, symlinks, hardlinks, special files and a wrong format.
The verifier compares bytes and modes. It cannot establish manifest authority,
database semantics, installation completeness or working services. Obtain the
archive and manifest hashes through an independently trusted channel.

Both owned preparation services stop successfully under a 1 GiB limit and no
additional swap. They reach the memory cap. The finalizer records 2,723 max
pressure events, zero swap and zero OOM events. These results do not establish
spare capacity. No other services, live credentials, databases or deployment
settings are changed.

The receiving instructions use private new directories and the selected pinned
source's existing installation and backup guides. They leave native role/key/
Auth/Storage reconstruction, whole-installation alignment, current permissions,
worker restart, useful interrupted recovery and independent host/disk evidence
open. Dependencies and compatibility on the receiving computer require checks.
Desktop and 390px T3 journeys, practitioner use and scientific validity remain
separate. M3, M5b.2 and full v1 acceptance do not change.

## Revision 2 retains the transport license

The revised archive includes the retained Restic 0.19.1 BSD 2-Clause license,
source inventory, signed checksums and public release key. Its license bytes
match the original captured SHA-256. Complete bundled dependency review remains
unassessed. The encrypted payload and separately held password do not change.

`openplan-linux-transfer-20261014-r2.tar` is 774,830,080 bytes, SHA-256
`0f958fd3d22d4cb3182d523036ff7568f91e2d3e42524eefc2de86615e49225e`.
The first archive remains intact with its original hash. A first regeneration
trial incorrectly includes the checksum file itself and fails. The correction
excludes that exact root file. Baseline, actual harmless timestamp and restored
checks pass; reintroducing the self-entry fails only that named checksum.
The corrected finalizer stops successfully, with its retained resource record.
The separate-host and installation limits above remain unchanged.

## Joined documentation check

Twenty documentation cases pass on the joined branch. A harmless index comment
survives. Each of the three deliberately broken new report links fails the
relative-link assertion; restored documentation passes. Eight native source
bindings and the selected migration bytes remain unchanged. Earlier wrapper
trials select the wrong release-test path and correctly refuse their expected
case count. Those failures remain retained. The final owned service stops
successfully with a 311,758,848-byte observed peak under 1 GiB. These mechanical
checks do not establish installation or acceptance.
