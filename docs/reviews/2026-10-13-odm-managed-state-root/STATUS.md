# Managed aerial admission requires separate retained state

PR263's review identifies a configuration gap. Managed admission inherits the
existing work directory, whose container default is temporary scratch. A replaced
container can therefore lose accepted receipts even though the journal's local
writes are durable. Green local suites do not close that deployment boundary.
The combined PR must not merge with this unresolved configuration defect.

The correction requires `ODM_WORKER_MANAGED_STATE_DIR` when managed admission is
explicitly enabled. It must name an absolute directory separate from scratch.
Resolved aliases, parent/child overlap and the default scratch tree refuse.
Startup rechecks the declaration before opening the runtime. A missing state
root refuses before creating scratch. Fresh installations provision their private
root explicitly; a missing recovery root stays missing.
The runtime opens the declared state root. Unmanaged mode keeps its existing
scratch default; the Docker image supplies no managed-state default.

The [operator instructions](../../../workers/odm_worker/MANAGED_STATE.md) require
storage that survives replacement and inclusion in the installation's backup
inventory. An explicit path cannot prove a persistent mount. No hosted setting,
managed default, processing permission or schema is changed here.

All ten configuration/startup cases and 17 selected source controls pass on
[Python 3.14](evidence/source-controls314.json) and
[3.11](evidence/source-controls311.json). Four positive cohorts survive and
13 faults fail at their intended diagnostics. Removing the declaration, allowing
relative/aliased/overlapping scratch, losing the configured root, bypassing startup
validation and opening scratch instead of original state all fail. Moving scratch
creation ahead of missing-state refusal fails its named assertion. Source restores
exactly. [The preceding exact PR source](evidence/preceding-config-controls.json)
fails the new required-declaration test without opening a runtime or server.

[Actual isolated HTTP recovery](evidence/native-summary.json) passes
32 observations and [99 controls](evidence/native-controls.json), three survivors
and 96 wrong/missing/type failures. It preserves original receipts, queued work,
held starts, private source/package bytes and logical journal records. The
original scratch has no registry and replacement uses fresh scratch. No NodeODM
request or source body bytes enter that recovery fixture. This is not complete
worker or installation recovery.

The final current-source [complete existing workflow](evidence/workflow-results.json) passes all
31 stages, 23 unittest suites with 578 cases, seven scenario programs and 20
nested-app documentation/release-ordering cases. Product direction passes with
its existing review reminders. [Every worker binding](evidence/workflow-source-bindings.json)
restores exactly. The [unit](evidence/workflow-resources.json) stops at a
899,280,896-byte peak under 1 GiB, zero max/OOM events and swap disabled. The
replay takes 329.794 seconds.

The [new pointer controls](evidence/pointer-controls.json) retain three passing
six-case cohorts; a broken target fails the named markdown assertion and observed
missing path. Their [unit](evidence/pointer-resources.json) stops at220,573,696 bytes
under1GiB with zero max/OOM and no swap. Current-head GitHub checks,
combined integration and production promotion remain separate.


The native fixture uses separate scratch directories for the initial and
replacement workers. It restores the complete retained state into a fresh root,
checks exact original HTTP receipts and keeps the uncertain original start held.
The original scratch contains no admission registry. A fresh replacement scratch
is not a new installation. A missing original database or installation seal
refuses startup. The public request and callback schemas stay unchanged.

## Trials that are not acceptance

The first full replay reaches the native fixture, whose fresh state root was not
provisioned. The worker refuses with FileNotFoundError before serving. That run is
rejected as complete acceptance. The fixture now creates only its known fresh
root, while replacement uses the restored original root. No production guard is
loosened to create missing retained state automatically.

The first ten-case control baseline omits the required installation identity in
its new missing-root fixture. It hits that earlier validation and is rejected.
The corrected fixture supplies its synthetic identity. Another selected startup
fault reaches a missing-file error instead of its intended downstream sentinel.
The test now watches runtime opening separately from scratch creation. A valid
empty scratch directory lets the wrong-runtime-root fault reach the named
original-root assertion. Source and tests are restored between every trial.

The first passing nine-case controller uses broad output matching. Its stricter
rerun matches the final exception diagnostic; final controls use that version.
Historical passing cohorts and rejected trials remain in the private proof folder.

The second full replay reaches an unrelated native attestation fixture failure.
A rejected Unix-socket request's background broken-pipe traceback masks the
intended mutation diagnostic. The unknown-path fixture now returns a bodyless
404 inside its existing disconnect handling. Production attestation and strict
failure classifiers stay unchanged. [All 68 attestation controls on3.11](evidence/attestation-controls311.json)
pass after that fixture correction, including their failure-oracle controls.
The separate3.14 replay exposes the cleanup race below.

The separate3.14 harmless cohort catches an observer that exits between the
cleanup identity lookup and signal. Its narrow ProcessLookupError handling now
accepts retirement and retains PermissionError. Controlled retirement and
permission faults fail their named assertions; restoring the old body-bearing
404 fails the bodyless-refusal assertion. The updated native controller supports
fixture-file mutations as well as production-source mutations, restores both
files exactly and keeps its strict failure classifier. All31 native cases and
68 controls, with four survivors,64 faults and eight failure-oracle controls,
pass on[3.14](evidence/attestation-controls314.json) and separately[3.11](evidence/attestation-controls311.json) with current fixture bytes. The[3.14 component](evidence/attestation-resources314.json) records its256MiB bound, zero max/OOM and no extra swap.

The next full replay detects a surviving URL transport cancellation-type fault.
The outer intake cancellation can win before the mutated transport guard and
satisfy the old alternative-error assertion. The integrated test now leaves the
outer adapter uncancelled and requires the transport's exact cancellation error.
The current[transport controls on3.11](evidence/url-transport-controls311.json)
catch that fault. Production cancellation behavior and deadlines stay unchanged.
All33 transport cases and59 controls pass on[3.14](evidence/url-transport-controls314.json) and[3.11](evidence/url-transport-controls311.json). Four positive cohorts survive and55 faults fail as intended. Their failure-oracle controls pass, and all source restores exactly.

The first final export uses the wrong URL failure-oracle filename and stops.
No commit occurs from that partial export. The corrected export uses the actual
artifact name and rechecks final source bindings before commit.

Configuration controls cannot prove mount persistence, installation-wide backup
coverage, host failure recovery or live original-actor authority. The native
fixture establishes process replacement and local state-root reconstruction. It
does not establish physical-host recovery, source/engine/result custody, callback
delivery, decoded imagery, long computation, browser/practitioner/scientific
acceptance, full M3 or v1.

Private captures and logs remain under
`/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/odm-managed-state-root-20261013/`.
