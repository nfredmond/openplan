# Failed task after stopped-root restoration

The pinned backend retains one committed failed task's original UUID, name,
image count, options and failed status after an exact stopped-root capture and
relocation. A new owned engine reads that copied state. Original and retained
package bytes stay unchanged. This is one known-root API fixture, not accepted
worker recovery or permission to adopt the new engine identity.

[Four native positive cohorts and five faults](evidence/native-controls.json)
pass. Baseline, harmless comment and restored runs preserve the expected task
projection. Changed package/relocated/original bytes and changed observed task
UUID/status fail at their named assertions. The [failure oracle](evidence/oracle-controls.json)
rejects unrelated, missing, extra, zero-exit and wrong-type errors. Driver source
restores exactly. [The result](evidence/native-results.json) explicitly keeps
worker recovery and engine adoption unaccepted.

Three deliberately invalid ordinary byte strings with image filenames enter
one committed task. The API reports code 30 and `Cannot process dataset`. This
does not establish decoding, usable reconstruction or quality. Both
[producer](evidence/producer-stopped.json) and
[restored engine](evidence/restored-stopped.json) stop. Each uses 512 MiB with no
extra swap, one CPU, 64 tasks and a read-only image. The exact cached image is
`sha256:cb07d06e21fd6189cfad287c6fedfa0b72568100355635cd9035cb86eed42ee2`.

The driver uses the existing owned internal RPC fixture bridge, no new network,
host ports or database restart. The host HTTP client bounds responses to 1 MiB
and five seconds; Docker-exec polling is absent. The
[controller accounting](evidence/control-resources.json) records the actual
256 MiB limit, no extra swap and memory events. Container peak memory and cgroup
events are not measured. Reported OOMKilled=false is not substituted for them.
The [Python 3.11 journey](evidence/native311-results.json) also preserves the
failed-task projection. All 14 selected documentation tests and product direction
pass. The [follow-up unit](evidence/followup-resources.json) stops with a
287,887,360-byte peak under 1 GiB and zero max/OOM events. The final native
controller stops at 82,137,088 bytes under 256 MiB, also with zero max/OOM events.
[Current source bindings](evidence/native311-bindings.json) match. Every owned
engine and proof unit stops.

## Earlier trials and scope

The initial native trial initially succeeds over Docker-exec HTTP. The first controller trial's repeated baseline
exceeds that client's launch bound and stops its engine; it is rejected. The
exact cause is not determined. The host-client second controller trial then exposes EOF
handling in the new harness, before task admission; its engine also stops.
The third controller trial fixes EOF handling and completes. The fourth controller trial reruns the exact final
source with corrected network wording and retained accounting. These are
separate trials, not evidence that the initial transport was reliable.

The original failed-root snapshot stays exact while the relocated runtime can
change as its new backend opens the copied records. This does not discover all
installation roots, align database/Storage/configuration, preserve active
computation, reconcile uncertain receipts, exclude other writers, validate
original-actor access, authorize engine adoption or accept cross-host recovery.
Processing/results/callback custody, useful long jobs, real permitted imagery,
quality-reviewed artifacts, browser/practitioner/scientific acceptance, complete
M3/M5b.2 and v1 remain open. No default, dispatch, hosted write, migration or
release tag accompanies this evidence.

Private roots, actual replies, failed trials and stopped containers remain under
`/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/odm-committed-task-restore-20261013/`.

## Current candidate integration

This separate branch joins263/b20dc2879 and preserves both report-index pointers
through their append conflict. The restore-driver bytes remain unchanged.
[The fresh3.11 native probe](evidence/current-candidate-native-results.json) again
retains the original failed-task API projection across the exact known-root copy.
[Its current bindings](evidence/current-candidate-native-bindings.json) are retained.
No new engine adoption or managed recovery permission is inferred.

[Fourteen app/docs cases and direction](evidence/current-candidate-results.json)
pass. The [owned unit](evidence/current-candidate-resources.json) stops at
255,913,984 bytes under1GiB, zero max/OOM and no extra swap. Both owned engines
stop. Current-head GitHub checks remain separate. This stays outside the combined
34-head candidate and waits for its exact production promotion before retargeting
and a separate coordinated turn. Existing claim limits stay unchanged.
