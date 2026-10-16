# Disk-backed exact607 preview, preparation only

October 16, 2026. This successor stores its source, output and custody on the
root disk. It preserves the reviewed runtime caps and archive rules. No working
root, admission, operating journal, database or application service exists.
Independent review and fresh parent admission remain required.

## Source and ownership

Root owns only this review directory in
`/home/nathaniel/.local/state/openplan/pr330-final-disk-preview-worktree-20261016`,
branch `work/pr330-final-disk-preview-20261016`, and the new private preparation
root `pr330-final-disk-preview-20261016`. The worktree starts at exact
`607ee0895a79457181eda1d2ebbda1de4f2a4d40`. Its application tree remains
`bed283ab0c937ead65378a2e9d26c177ceee6938`. Product direction passes with the
existing review reminders. No application, worker or migration source changes.

The predecessor is the RAM-backed packet accepted within source scope after
review `0b363901455bb955e9f67395f9fd6a5ed40e3ccd`. Its private packet SHA-256 is
`bd5d60d4514c3d4a52b362d11a0b4d0e084bde450e292764d75dc03be8191ebe`.
All 42 input seals match before copying. Before and after snapshots preserve
all 70 predecessor entries, including directory/file modes and symlink targets.
The existing RAM packet, prospective RAM root, frozen f0 build, failed trials
and protected database/source bindings remain intact.

The new prospective working root is
`/home/nathaniel/.local/state/openplan/pr330-final-disk-working-20261016`.
It remains absent. The new API proposal is `127.74.19.15:29954`; web proposal is
`127.74.19.15:3589`. The packet contains a new random database proposal and new
helper/unit names. Names and ports are proposals, not current exclusion or
readiness evidence. Root must inspect them before admission.

## Disk reservations replace RAM storage reservations

The build retains its 10 GiB cgroup, zero swap, 50 percent CPU and 6 GiB Node
heap. Checkout, observer and web caps remain unchanged. The host reserve stays
2 GiB. The disk budget removes source and evidence file reservations from RAM;
those files now reside on the identified disk. It does not count disk or tmpfs
free bytes as RAM. Disk page cache used by a build remains charged to its cgroup
and can be reclaimed. An actual build may still fail its cap.

Before staging, memory must cover the full build cap plus host reserve,
12,884,901,888 bytes. The runtime checks this again. Source/output/custody planning
reservations are 528,937,508 bytes plus 3 GiB plus 512 MiB. The same filesystem
must reserve remaining working bytes and a full uncompressed-size archive
together. Compression is not a capacity assumption. Initial combined disk
reservation is 8,885,373,578 bytes, including one percent archive overhead and
256 MiB disk reserve. The existing 8 GiB disk floor remains.

Already staged bytes reduce future working storage, but never count as extra
RAM. A larger actual inventory increases the archive reservation. The inherited
archive step also checks actual entry-count overhead, exact bytes/modes, archive
hash, quiescent units, successful build identity and candidate parity before
startup. It retains partial archives and failures without retry or cleanup.

The new producer checks the actual mount source, UUID, filesystem and execution
flags through a bounded `findmnt` call. It requires the current root ext4 device
`/dev/nvme0n1p2`, UUID `c7f8e9a2-2767-4dba-81a8-5ae1ade8d595`, writable and without
`noexec`. Working and durable paths must resolve without symlink ancestors and
share a device. The observed disk has `rw,relatime`; this packet does not pretend
it has the old tmpfs `nosuid,nodev` flags. Existing private paths and bwrap/cgroup
confinement remain. These source checks do not establish kernel isolation.

## Admission and custody stay explicit

The existing storage module filename `memory_storage.py` and internal receipt
key remain for compatibility with the unchanged launcher. Its capacity producer
now reports `storage: disk`. New admissions additionally require `storage: disk`
and `capacityModel: disk-v1`. They reject the old RAM review and the source
commit as a new independent review. An existing commit or an arbitrary shaped
JSON object does not constitute parent authorization.

After reading a new independent review, root must publish the source/seal-bound
admission with its exact accepted review commit and fresh observed capacity.
`parent_recipe.sh REVIEW_COMMIT STAGE` retains one explicit stage per request,
predecessor receipts, shared flock, exclusive stage claims, durable intent and
output, accepted returned identity before dependent effects, and no automatic
replay after failure or uncertain acknowledgement. No admission is supplied here.
The full predecessor stage contract remains applicable: allocate, preflight,
restore, upgrade, services, active-check, checkout, build, archive, start, attest
and post-journey. Root owns each runtime invocation and result assessment.

## Counterfactual checks

Preparation runs in a short owned 1 GiB, zero-swap, 50 percent CPU unit under
the shared compiler flock. The manager reports 60.7M peak. It stages 42 private
runtime inputs, retains 17,445 exact source entries and all 420 migration hashes,
rebinds namespace literals and regenerates the existing hash graph. Public code
diffs show the capacity/admission changes and mechanical namespace changes.
Private environment/credential values remain private. No old archive/cache is
copied or removed, and no model/account allowance is consumed.

The first control campaign passes two harmless comments and 10 named faults.
Its driver and records remain retained. The second adds producer-boundary
controls and passes two harmless comments and 15 named fault failures. They
cover host memory reserve, memory refusal, shared-disk double counting, disk
budget/floor, device identity/execution, invalid staged count, symlink ancestry,
cross-device storage, mount census/deadline, disk admission/model and old review
refusal. Each in-memory variant fails its exact expected assertion; imports or
setup errors do not count as kills. Variants are discarded, actual source bytes
stay equal, and original functions pass again after every fault.

The admission controls inject only private synthetic metadata into the actual
consumer. The producer controls likewise inject filesystem/process metadata
for the named refusal tests. They do not establish current kernel or operating
state. A separate real read-only capacity observation is recorded in each
campaign. The later observation refuses `disk-memory-total-budget`; the earlier
one meets its arithmetic. Neither publishes an admission or starts a stage.
The producer deliberately retains these differing volatile readings.

The actual sealed recipe without admission returns exit two before dispatch,
with no working root, admission or operating journal created. Shell syntax and
Python parsing checks pass. The unit resource requests and manager summaries
do not replace an actual future build's cgroup/resource attestation.

`controls.json`, `controls-02.json`, `provenance.json`, `packet.json` and the
private input/list seals retain the evidence. Private checks and entry refusal
live under the new private preparation root. The private input list binds all
42 files. Exact source inventory, protected records, dynamic fixture values,
419 dump and migration identities remain inherited; they are not new native
acceptance evidence.

## Remaining limits

No database/helper/working candidate allocation, restore, migration, app build,
browser, provider, hosted operation, merge to main or release runs. Complete
bootstrap/native transport proof remains separately owned. Actual disk-backed
controller composition, permission behavior, cgroup confinement, output/peak,
archive/start attestation, protected-state comparisons, desktop/390px and usable
artifacts remain unproved. Current source data does not close human, operational
or scientific acceptance. Full v1 scope remains unchanged.
