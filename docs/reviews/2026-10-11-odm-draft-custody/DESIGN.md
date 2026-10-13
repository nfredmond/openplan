# Compare captured aerial drafts with original inputs

The [engine journal](../2026-10-11-odm-engine-effects/STATUS.md) preserves original
commands and refuses repeated unresolved effects. The [actual engine counterexample](../2026-10-11-odm-draft-reconciliation/STATUS.md)
shows that task absence cannot resolve initialization or upload. This M3/M5b.2
candidate adds read-only comparison of captured drafts, without processing,
repair, retry authorization or runtime integration.

## Inspect an actual verified package

The installed CLI accepts the original private engine plan with its expected
hash and a captured engine-root package. It invokes the existing complete root
verifier before inspecting `tmp/<original UUID>`. It compares native `body.json`
with the original initialization form and each present upload with its original
filename, size and hash. It refuses duplicate/mixed files and extra directories.
Known missing planned uploads remain visible as partial evidence.

The pure worker library performs the byte comparison; it does not attest a
snapshot, exclude live writers or verify engine ownership. The CLI establishes
package integrity, not the truth of an operator's original quiescence declaration.
Native evidence must separately identify the exact owned engine image, root
mounts, stopped state and unchanged original plan/source. A configured engine
descriptor alone does not establish live engine identity.

Missing metadata or an absent draft remains inconclusive. It might follow an
unrecorded initialization or a commit that removed metadata. A complete matching
draft establishes captured bytes, not task registration, processing readiness,
live custody, authority or permission to commit. Every result refuses inferred
transport permission. This candidate never changes the effect journal.

## Bounds and proof

Use existing private descriptor readers and canonical typed plan comparison.
Bound response metadata, total image bytes, filename enumeration and elapsed
reads. Kernel I/O/fsync interruption remains unsupported. Do not treat an image
extension as decoding or quality evidence. ZIP-derived imagery remains separate.

Tests and targeted fault controls cover metadata, every original source slot,
duplicates, missing records, aliases, budgets and exact original plan identity.
Native fixtures use the pinned cached NodeODM 2.2.4 image, synthetic ordinary
bytes and no commit/reconstruction. Stop only new owned containers. Capture and
verify the actual root, then compare it with the original plan. Preserve failed
trials, original files and explicit limits. All main merges remain held until
the relaunch coordinator gives explicit clearance.
