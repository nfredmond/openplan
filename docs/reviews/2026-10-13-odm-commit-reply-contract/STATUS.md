# Original UUID in NodeODM commit replies

The cached NodeODM 2.2.4 engine returns HTTP 200 with the original task UUID after
commit. The preceding worker reply parser rejects that actual response because
it applies the upload's boolean-success schema to commit. It also accepts the
wrong old mock shape. Native01 reproduces that mismatch, and the three new tests
fail against the preceding parser. Processing in the managed bridge remains held.

The [upstream API](https://github.com/OpenDroneMap/NodeODM/blob/master/docs/index.adoc)
also describes the UUID response. That upstream document is context, not evidence
for a newly installed or upgraded engine. The actual cached image is
`sha256:cb07d06e21fd6189cfad287c6fedfa0b72568100355635cd9035cb86eed42ee2`.
No image pull, engine upgrade or cross-engine fallback runs.

## Correction and current evidence

Only reply schema selection changes: init and commit require the exact original
UUID; uploads still require the boolean `true`. Original status/type/size,
duplicate-key/nonfinite/error and immutable exact-byte checks stay in place.
Matching acknowledgement keeps engine custody unassessed. A retained old mock
commit receipt without its original UUID refuses without deleting or rewriting it.
No commit transport, processing permission, runtime/default or callback is enabled.

All 28 effect tests and [50 source controls](evidence/source-controls314.json)
pass on Python 3.14 and separately [3.11](evidence/source-controls311.json).
Four positive cohorts survive and 46 selected source faults fail. Controls cover
each test, including upload 1's boolean guard, the wrong old commit schema,
rejection of a real UUID reply, altered commit byte hashes, custody promotion
and acceptance of invalid legacy mock receipts. Source restores exactly.

The [corrected native probe](evidence/corrected-native-result.json) receives the
real UUID reply and the corrected parser accepts it. Three deliberately invalid
ordinary byte strings with image filenames enter this owned API fixture. This
is not decoded imagery, successful reconstruction or processing quality evidence.
The pure reply parser receives only the expected task UUID and real response
bytes, not a complete application authority or journal transport. The owned
network-none engine uses 512 MiB with no extra swap, one CPU and 64 tasks, a
read-only image and no host ports. Both engines stop with reported OOMKilled=false;
container peak memory and cgroup events are not measured.

The [component unit](evidence/component-resources.json) stops with 44,388,352 bytes
under 1 GiB and zero max/OOM events. Two existing source-only retained-root recovery
programs pass, with their stated source/engine boundaries. An unused commit branch
was briefly added to their reply builders, then removed after confirming those
loops issue only init/uploads. Their original code stays unchanged; the full
workflow will bind their actual current source. No old proof artifact is rewritten.

The [complete workflow](evidence/workflow-results.json) passes all 31 actual
stages, 22 unittest suites with 568 cases, seven scenario programs and 20
documentation/release-ordering cases. Product direction passes.
[Every bound worker byte](evidence/workflow-source-bindings.json) matches after
restoration. The [unit](evidence/workflow-resources.json) stops with a
925,818,880-byte peak under 1 GiB, zero max/OOM events and no extra swap.
The replay takes 326.803 seconds. The first count export rejects a regex that
omits the one-case suite; the corrected export includes its actual singular
`test` line. Current-head GitHub acceptance remains separate; no main merge
or release is claimed here.

## Remaining boundaries

A commit acknowledgement is not task completion, exact backend custody or
measurement quality. This does not grant an uncertain command permission to
repeat, establish writer exclusion, atomic revocation, live original-actor access,
source intake, output/terminal/callback recovery, installed or physical-host
recovery, long-job capacity, browser/practitioner/scientific acceptance or full M3/v1.
All of those boundaries retain their earlier held or unassessed state.

Private replies, logs and owned fixtures remain under
`/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/odm-commit-reply-contract-20261013/`.
