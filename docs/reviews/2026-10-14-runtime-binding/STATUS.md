# Explicit worker configuration candidate, October 14

This candidate seals explicit operator settings before admitting work to a new
private runtime. The record binds installation, target, application endpoint,
credential references, original engine identity, source root, artifact URL,
daemon identity and resource bounds. It contains references instead of resolved
credentials. Existing admissions or retained records without a seal require
separate adoption. Changed settings cannot reuse the original seal.

Establishment holds the runtime writer and admission transaction through durable
publication. Recovery removes known private unpublished temporary files while
refusing unknown files, symlinks and hardlinks. Interrupted published seals keep
their original bytes and inode. Runtime, root, journal and journal-root references
remain pinned before I/O. A local seal grants no current actor authority.

## Evidence and corrections

Four 38-case positive cohorts and 38 intended faults pass on each of Python 3.14
and Python 3.11. The [controller](verify_controls.py) inventories every test,
checks intended diagnostics and restores original source/test bytes in finally.
Public interpreter reports and source hashes accompany this record. Private
logs preserve earlier failed diagnostic and secondary-guard trials.

Independent frozen review found four defects: fresh mutated settings could be
published before refusal; pre-rename interruption blocked retry; runtime
references could change; and a pinned Journal could point to a foreign database.
The corrected checks cover each path. The first review is static and does not
execute the reported campaigns. [Snapshot 03](INDEPENDENT_REVIEW.md) identifies no further concrete defect in the reviewed files.

## Open boundaries

Both interpreters pass 161 related cases using real local journals and supplied
engine/receiver fixtures. The 19 nested document/direction/release-order checks pass. These source-scanning
checks run from the actual application directory. Service assembly,
legacy-root adoption, default-worker selection, full application receiver and
Storage, capacity, planner/browser and independent-host evidence remain open.
No hosted migration, release or milestone grade changes. These local fixtures
cannot establish running-engine attestation, scientific quality, publication
permission or hostile same-user filesystem isolation.

## October 14 assembly extension, uncommitted draft

The [assembly draft](../2026-10-14-runtime-assembly/STATUS.md) adds explicit source
and callback network policies to configuration. The earlier 38-case evidence
above identifies checkpoint 0be980d50. It does not qualify changed configuration
bytes. The new four 41-case cohorts and 41 faults pass on each interpreter. Joined
regression and final document checks continue. No prior independent or operational grade changes.
