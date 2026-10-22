# Three storage corrections precede final rebind acceptance

The preparation delta at `97c310944ecf694525798bcc7cdb30edb7832686`
has three P2 findings. Retain this checkpoint as an explicitly blocked draft.
Do not reuse the storage implementation unchanged in an operating seal.
This report does not approve operation or the later final-binding revision.

## Scope and ownership

Review starts from clean branch `t3/pr330-memory-storage-independent-review`,
base `05dd3e8da4a4572437f06e771b0a2477873e681f`. Candidate files come from
the exact Git commit, without checking out its large source tree. The assigned
candidate worktree and private draft are read-only review inputs.

Writes stay within this report directory and the new private root
`/home/nathaniel/.local/state/openplan/pr330-memory-storage-independent-review-20261015`,
apart from the authorized local Git commit. AGENTS, current coordination,
planner-writing and prove-it guide the review. Coordination initially reserves
the compiler lock for the parent's full TypeScript check. Review specimens run
only after nonblocking acquisition of that same lock. No second compiler,
application build, suite, database/helper operation, browser or deletion runs.

The later coordination entry records the parent's completed compiler and a new
final-binding task. Neither changes the candidate reviewed here. The root app
correction, its source review and its full TypeScript result remain separate.

## R1, P2: the exact tracked source fails the new inventory

Location: candidate `memory_storage.py:92–94`, also called by
`observe_capacity()` before build and by archive capture/start admission.

The inventory permits one symlink, `candidate/openplan/node_modules`.
The full repository also tracks `.agents/skills -> ../.claude/skills`.
Git records it as mode `120000`, blob
`454b8427cd757f30dc7fdb9a325d19c399770417`. Both the draft source `72b119cc9`
and corrected source `2046fca9a` contain this link. The retained checkout
function performs a full checkout, so it creates
`candidate/.agents/skills` without needing an unusual build output.

A tiny specimen with that exact link refuses with `archive-link`.
Appending a harmless source comment preserves the refusal. A private,
in-memory correction allowing that exact relative link archives and reads it
back with mode and target intact. The same correction still rejects a link to
`/etc/passwd`. No link target is read through the archive.

Correct the inventory from the final commit's tracked link map. Validate paths
and literal targets, preserve symlinks without dereferencing, and keep the
separately pinned donor link. Do not delete the tracked link or narrow the
full-source custody claim. The existing archive-link control exercises an
unowned link; it never supplies the legitimate tracked link.

## R2, P2: npm can rewrite the controller and seal root

Location: candidate `templates/app_binding_v1.py:246–255`, particularly the
new `--bind ROOT ROOT` at line 252.

V6 exposes candidate and execution directories as writable mounts. The new
memory-root bind also exposes controller code, private binding files, checksum
lists and helper configuration as writable files to npm and its children.
This applies to both build and startup. Hiding `/run`, disabling build network
and making the donor read-only do not restore that filesystem boundary.
Rechecking files against hash lists inside this same writable root cannot
replace mount protection for the code and those lists.

The actual bwrap argument builder, with only bind sources translated to tiny
private disk specimens and npm replaced by a Python write probe, permits a
write to `ROOT/memory_storage.py`. A harmless comment gives the same result.
Changing only the root bind to `--ro-bind` returns `EROFS` for that write,
while candidate and execution writes still succeed. Both namespaces keep the
real proposed host memory root absent. This is a mount-boundary observation,
not an application or native-addon test.

Restore a read-only root bind after `/dev` setup. Keep the narrow candidate,
execution and private tmp writable mounts. Independently check any further
writable directory that an actual application needs. The retained namespace
control proves mount ordering and npm PATH, but never attempts a controller
write.

## R3, P2: fsync now persists mutator evidence only in volatile memory

Locations: candidate `templates/policy.py:18`, `templates/helper.py:48–56`,
`restore():198–205`, `services():293–318`, `upgrade():520`; recipe steps 2–10.

The unchanged helper `write()` fsyncs its file and parent directory beneath
`OUT`. V6 places that root on durable storage. This delta places it beneath
`/dev/shm`. Consequently the clone/upgrade/services intents, new database OID,
each returned helper ID and partial-failure diagnostics remain volatile.
The durable archive occurs after restore, upgrade, helper startup, checkout
and build. The durable allocation intent does not record the later returned
IDs or stage outcomes.

A host interruption before archive publication can therefore retain native
database or container side effects while losing their exact custody records.
Fsync on tmpfs does not make those records survive reboot. This is a source
and storage-location finding; no reboot, database write or crash recovery is
attempted. Unchanged function bytes do not preserve the original durable
semantics when their root changes filesystems.

Add an exclusive private durable journal before any external mutator. Fsync
each stage intent and its directory before the side effect. Persist each
returned OID/ID before proceeding, and retain exits, failures and lost
acknowledgements there. Keep the working source/output on tmpfs. A lost
acknowledgement must still bar automatic retry. Review the durable journal's
failure behavior with a tiny fake mutator, without operating a real database
or helper. The draft's write-once control proves exclusive archive-intent
creation; it does not cover these pre-archive stage records.

## Retained evidence supports its stated preparation scope

[Readback evidence](readback-result.json) records 30 exact candidate file
hashes and all 29 entries in its preparation checksum list. Public control,
context, identity and preparation-audit JSON match the private receipts.
The storage control's source hash matches the committed public module and
the restored specimen. Its 26 observations comprise one harmless survivor,
23 removed-guard controls and two custody cases. I read those controls and
the retained failed-attempt diagnostics; I do not repeat their campaign.

The final private preparation archive has SHA-256
`168371e8dcf646641dcab71dc336a395f781362f9f3de9516bf827d93d156098`,
7,420,550 bytes and 2,972 members. Streaming readback compares all 1,860
regular-file member contents with their retained public or private inputs.
This does not establish extraction, recovery or installation. The retained
V6 before/after inventories match at 23,651 entries. I do not acquire a fresh
runtime, database or full V6 preservation census.

The six Python template diffs match freshly computed V6-to-candidate diffs.
The adjacent shell diff and recipe retain the one-stage structure, limits
and namespace ordering. Function comparison confirms unchanged restore,
upgrade, dependency, nonce observer and other controller code. Constants,
mounts and filesystem changes still need contextual review, as R2 and R3 show.

The source inventory has 17,338 entries and 528,230,211 blob bytes.
Raising checkout from 512 MiB to 1 GiB addresses the obvious source-byte
pressure. It does not establish a measured checkout peak. Page rounding,
Git/index allocations, evidence writes and cache charges remain unmeasured.
Tmpfs pages charge their allocating cgroup; surviving pages can remain charged
outside a later stage's cgroup. The build's 10 GiB cap is not a cap on all
retained source, helpers or the uncapped database server.

The capacity calculation does not add tmpfs free bytes to host available RAM.
It preserves the 8 GiB filesystem and 10 GiB available-memory floors, reserves
host/evidence space, and requires 4,597,625,316 durable free bytes without
assuming compression. Actual archive admission adds per-member overhead and
rechecks the measured inventory. I find no separate arithmetic defect in
those reservations. Three GiB of output remains a planning reservation,
not an enforced output limit. Real peak, swap/events, mount execution and
native-loader behavior remain operating evidence to collect later.

Exclusive archive/manifest creation, file fsync, directory fsync at ready
publication, streaming member/hash/mode checks, before/after inventory checks
and failed-output retention are present. Startup requires a successful archive
and candidate equality. These do not quiesce arbitrary writers or test crash
recovery. `startup_archive()` compares the candidate subtree only; fixed
external inputs still depend on the separate binding checks. Preserve the
archive/manifest hashes returned by that function in the eventual durable
start intent so later custody identifies the archive actually admitted.

## Review probe limits and disposition

[Probe evidence](probe-result.json) records the actual two focused specimens.
The successful unit uses 512 MiB, zero swap and CPU 50 percent, with a
19,865,600-byte peak and zero memory max/OOM/OOM-kill events. The retained
readback unit reports 44.8M peak and zero swap. Both use the shared lock and
private HOME/cache/tmp. The successful probe leaves candidate source unchanged.
It does not allocate the real tmpfs root or launch npm/application stages.

Two reviewer harness failures remain private. Attempt 01 cannot create a
nested bwrap namespace from the outer wrapper. Attempt 02 lacks a repository
working directory in systemd and stops before specimens. Attempt 03 uses
explicit Git `-C` and a host-context capped controller, then completes the
tiny inner namespace specimens. Neither earlier failure counts as a finding
against the candidate. Review corrections exist only in memory/private
fixtures; no candidate implementation changes occur.

The acknowledged old `72/c89` binding, provisional storage hash mismatch,
missing frozen-V6 typed four-helper map, ACL literal/new-database rebind and
durable capacity refusal remain final-revision requirements. They are not
reported as concealed acceptance defects. The parent entrypoint still refuses
with exit two, and no operating seal is accepted. No cache deletion occurs.
The native target's `pg_class` difference remains unaccepted, cause unknown.

Correct R1–R3 in the new revision, retain this draft and all failed receipts,
then independently review the final exact binding and affected controls.
No broader application, database, browser, hosted or release acceptance follows
from this review.
