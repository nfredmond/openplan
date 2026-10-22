# Owned aerial admissions retain original inputs and engine plans

This isolated M3/M5b.2 candidate composes the actual owned admission runtime with
retained local source, ZIP derivation and original engine-plan libraries. It
preserves the supplied application record, original actor, installation, target,
request/admission/start context, source mapping, limits, engine/settings and one
task UUID before source retention. The [design](DESIGN.md) states the boundary.

The caller supplies already complete private local inputs and an original
`aerial_processing_jobs` projection. The application records `created_by` before
dispatch; public v1/v1.1 requests omit it. This adapter does not infer an actor
from the worker token or external reference. A supplied record is not live
authority verification. Its exact hash and unassessed authority remain visible.

The callable runs inside a durably started, owned runtime. It creates retained
source/derived image sets and an engine plan, but issues no command or callback.
The resulting `prepared` job remains held. An explicit local resume verifies or
finishes the same original preparation. No default runtime, application route,
public contract, deployment configuration, migration or hosted service changes.
Main merges remain held until the coordinator records a dated lift after handoff,
separate Opus review and resolved blockers.

## Controls cover original context, input bytes and deadline boundaries

All 25 new tests and [40 source controls](evidence/source-controls.json) pass.
Four baseline/harmless/restored runs survive; 36 targeted variants fail. One
variant reaches the exact later source-manifest backstop after removing the
retained-slot guard. It does not prove unsafe acceptance when that early guard
is removed. Remaining variants expose broken admission/preparation behavior,
invalid-input access, identity replacement or rejected valid recovery. Some
parameterized tests retain independent JSON/limit backstops for other subcases.
The AST census covers every new test. Edits restore in `finally`, with bytecode
disabled. [Source bindings](evidence/source-bindings.json) identify current code.

Tests use actual runtime ownership, SQLite admissions, private files and retained
source/engine libraries. They cover both photo and ZIP inputs, actor/scope checks
before source access, original task replay, changed actor/target/engine/settings
refusal, changed retained bytes, interrupted slot copying and copied-root recovery
without original inputs. Preparation records precede retention. Missing original
plans refuse adoption. Source-root locations may change; original relative names
and byte identities may not. Deadline probes refuse expired retention, expired
completion records and success after a late synchronized publication. A late
record remains available for explicit recovery.

Failed private trials remain retained. The first test invocation caught an
incorrect positional argument to the existing keyword-only engine constructor.
The corrected call passes. The first control run removed application scope
validation and created a bad preparation plan, causing later subcases to fail at
another identity guard. The harness rejected that diagnostic. Early invalid-input
tests now assert refusal before preparation-record publication, avoiding that
cross-subcase effect. No source guard was weakened.

These fixtures do not verify the supplied application record's authenticity,
current membership, source permission, installation attestation, decoded imagery,
engine custody or callback delivery. The adapter accepts complete local inputs;
URL transport and cancellation are separate work. Cooperative writers, private
files and completed synchronization calls remain assumptions. Small fixtures do
not establish maximum-job capacity or power-loss recovery.

## Actual interruption and stopped-root recovery retain the original task

The [native driver](native_recovery.py) runs the actual runtime/preparation callable
in an owned child. The child exits abruptly with code 19 after retaining the first
photo, while the second remains absent. The actual root snapshot CLI captures and
verifies the stopped runtime and separate complete input root. These are two
explicit local captures, not an atomic complete installation point.

Fresh copied roots finish the same original preparation. The original task UUID,
actor context, request/admission and logical SQLite schema/rows remain unchanged.
The engine plan has no issued init, upload or commit intents. A second completed
root capture verifies, and a later copy replays without the original input root.
Changed actor, engine identity and retained bytes refuse; mutated bytes restore
in `finally`. Protected original roots and packages remain unchanged.

All [26 observations](evidence/native-observed.json) and [81 controls](evidence/native-controls.json)
pass. Three harmless variants survive; 78 wrong, missing or wrong-type variants
fail. The final actual-CI invocation takes 1.235 seconds. [Source bindings](evidence/native-source-bindings.json)
remain unchanged. The owned child stops. No engine/callback transport or imagery
decoding runs. [Full worker recovery remains false](evidence/native-summary.json),
and preparation does not authorize transport.

## Actual CI discovery and new commands pass locally

The actual YAML loop passes with all [16 aerial test scripts](evidence/worker-suite-census.json).
The census records hashes and the shared loop result, rather than claiming
separate per-script exit records. [Five discovery/fail-fast controls](evidence/ci-discovery-controls.json)
prove that the actual loop discovers a new suite and stops at its failure.
Both [new actual YAML commands](evidence/actual-ci-steps.json) pass locally.
GitHub CI remains separate acceptance for the committed head. All [14 nested
application documentation tests](evidence/documentation-checks.json) and the
[direction check](evidence/documentation-results.json) pass. Existing direction reminders remain visible.

[Resource records](evidence/resources.json) preserve failed and passing trials.
Final source controls peak at 34,426,880 bytes, native recovery at 35,106,816 bytes
and actual CI commands at 64,913,408 bytes. Python services run serially with
256 MiB, one CPU and no extra swap. Documentation peaks at 260,546,560 bytes under
1 GiB. Every
recorded owned service has zero active PID and is stopped. These configured limits
do not establish processing capacity.

Next provide a trusted original application-context adapter, retained URL intake,
live authority checks and original engine-stage transport/reconciliation. Commit,
outputs, artifact links, callback custody and complete independent worker recovery
remain open. No requirement grade, scientific claim, browser evidence,
practitioner acceptance or full-v1 scope changes.

Implementation and the controlled evidence belong to GPT-6.1 Sol at high reasoning
in this lane. These are implementation-owner checks, not an independent review.


## Later journal correction and repeated native recovery

The [concurrent SQLite correction](../2026-10-11-odm-sqlite-companion-race/STATUS.md)
repeats all inherited actual CI commands and original preparation capture/resume
against corrected journal source. Its current native bindings supplement the
historical bindings above. Full worker recovery and live authority remain open.
