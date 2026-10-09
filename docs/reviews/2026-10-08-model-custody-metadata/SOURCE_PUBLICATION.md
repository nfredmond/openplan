# Publish the complete declared validation dependency set

October 9, 2026. Source and retained-fixture inspection at `4a3feef87`.
This decision implements the next part of roadmap S1. It does not declare an
archive implemented, a source complete or a scientific result accepted.

## Findings that change the implementation

The current joined native proof publishes six files per method: model output,
input bundle, match audit, comparison basis, assessment and diagnosis.
`verify_native_instrument_writer.py` defines those roles. Observation packages,
structural audits and their underlying files remain in worker directories.

The [retained-fixture inspection](prototype/source-publication-gap.json) finds
nine local files for each method. Six named comparison dependencies have no
matching bytes in either fixture directory: run summary, conservation record,
assignment profile, assignment settings, coefficient package and network. Those
hashes come from the authored `basis()` fixture in
`scripts/modeling/tests/test_validation_instrument_v2.py`. This is expected for
a synthetic transport test, but those files cannot establish a complete source
archive. The inspection does not claim the corresponding real-world files are
missing from the whole repository.

The controlled development runner supplies actual files for several of these
roles. `scripts/modeling/run_comparable_observation_study.py` binds a run summary,
conservation record and assignment profile in its comparison basis; its network
hash comes from the match audit. Several references contain a hash without a
path. A publisher cannot recover their intended role or location by listing a
worker directory or taking the first file with that hash.

There are two timing boundaries. Observation matching and preparation must
remain independent of modeled residuals. Run summaries and conservation records
are execution evidence. Archiving both is necessary, but labeling everything in
the archive as frozen before model output would be false. Keep the original
bytes and timing records. Do not rewrite JSON paths and recompute hashes to make
a portable archive appear to be the original prepared instrument.

## Publication contract

Build an explicit dependency catalog tied to the actual workspace, parent run,
stage, attempt, method and retained instrument hashes. Each entry carries a
semantic role, its exact reference in the original document, a portable object
name, stored SHA-256 and stored byte count. Compressed files also retain their
logical hash and logical byte count. Keep method and attempt identity even when
identical stored bytes can share a content-addressed object.

The catalog has distinct preparation and execution-evidence sections. Start
with the observation package, match audit, input bundle, comparison basis and
structural audit. Resolve every declared readiness artifact, observation-source
artifact and structural stored/logical source pair. Resolve the comparison
basis's run summary, conservation, assignment settings/profile, coefficient
package and network dependencies through explicit producer records. A hash-only
reference needs a supplied role-to-artifact binding. Do not search unrelated
worktrees or infer a source's authority from a matching filename.

An unresolved, conflicting, unavailable or unsupported dependency remains a
named failure. Do not produce a completeness claim from an empty source list or
from the six previously published files. Completeness here means the declared
dependency set is recoverable; it does not prove that the preparer declared every
scientifically necessary source, that a provider permits redistribution or that
the source is appropriate for the geography and use.

Reuse `model_package_inputs` and `model_handoff_files` for verified local copies
where their ownership contracts apply. The first snapshots complete package
inventories; the second copies an exact registered file through a pinned attempt
root. Neither supplies the missing semantic dependency catalog. Do not archive
a whole attempt directory, since it also contains outputs and execution records.

Publish files before their manifest, with immutable object identities and exact
readback. Large network/population inputs require bounded streaming and resumable
publication. The current `upload_verified_immutable_bytes` helper reads and
compares whole byte buffers; it is established for the existing small artifacts,
not a resource-safe whole-model archive uploader. Keep a retained per-object
progress record so interrupted publication reconciles original identities.
Publish the final manifest only after all referenced objects are confirmed.

Use existing attempt artifact commands and exact receipts for registration.
Retain the manifest as an additional artifact with explicit instrument binding;
never mutate historical custody rows or replace their hashes. Consumers must
verify those bindings and disclose a missing publication. A local filename or
Storage URI without retrievable, verified bytes is not an independent archive.
An archive downloaded elsewhere must resolve original references through its
catalog without requiring the author's absolute filesystem paths.

## Required implementation evidence

1. A prepared fixture supplies actual bytes for every declared role. Another
   intentionally incomplete fixture is refused with the missing roles named.
   Preserve the existing transport-only fixtures as historical limited evidence.
2. Both methods under one parent and repeated attempts retain distinct catalogs.
   Reused identical objects do not collapse those identities or claim tiers.
3. Relocation preserves original instrument bytes and hashes. Verify stored and
   decompressed source identities, nested references and original source roles.
4. Faults cover omitted dependencies, wrong role/run/method/attempt, changed
   bytes, file aliases, unsupported entries, interrupted upload and lost reply.
   Harmless metadata and a restored implementation pass. Missing cases cannot be
   converted to success by dropping them from a manifest.
5. Native Storage and artifact receipts preserve confirmed objects across a
   fresh process. A failed object or unresolved dependency cannot expose a final
   complete manifest. Account for all temporary services and retained fixtures.
6. Project/report handoffs download a usable archive through the application,
   at desktop and 390px in T3, with identified build and console evidence. Native
   reader checks alone do not satisfy this workflow.

The immediate implementation is the explicit dependency catalog and refusal of
unresolved declared roles, followed by streamed publication and recovery using
that same catalog. This is a dependency order within S1, not a replacement for
the roadmap. Normal worker enrollment, independent preparation, scientific
acceptance and the full V1 contract remain open.
