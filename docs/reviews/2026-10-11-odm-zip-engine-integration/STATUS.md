# ZIP image slots bind the original engine journal

This isolated M3/M5b.2 candidate connects verified retained ZIP images to the
original private engine plan and command journal. Each journal operation rechecks
the actual archive and derived image bytes. ZIP plans preserve raw archive,
retained manifest and derived plan identities, original context, ordered member
paths, fixed filenames and image sizes/hashes. Photo plans retain their original
format and eight fields. The [design](DESIGN.md) states the bounded contract.

The runtime remains disconnected. No `main.py`, public worker contract, migration,
hosted configuration, model preset or engine default changes. The existing
HTTP worker restart defect remains open. No M3/M5b.2 requirement grade, scientific
claim or v1 scope changes. Main merges remain held until the coordinator records
a dated lift after the technical handoff, separate Opus review and blocker
resolution.

## Controls cover changed plans and existing photo behavior

All 14 new tests and [26 source controls](evidence/source-controls.json) pass.
Four baseline/harmless/restored runs survive; 22 targeted variants fail. Thirteen
variants expose broken behavior. Six reach diagnostic backstops; three contain
mixed subcase failures. Those nine cases do not prove unsafe acceptance after
removing one early guard. The AST census requires a control for every new test.
Source edits restore in `finally`, with bytecode disabled and owned caches cleared.
[Current source bindings](evidence/source-bindings.json) identify the tested code.

The existing photo suite passes all 25 tests and [44 controls](evidence/photo-controls.json).
Two new mutations verify that photo format and fields remain unchanged. The
historical raw-ZIP guard control now requires its exact early diagnostic. Existing
draft inspection passes all 24 tests and [36 controls](evidence/draft-controls.json).
Historical evidence JSONs remain unchanged; these records bind current code.

Private failed trials remain available. One hash mutation reached the constructor's
actual-source identity backstop before the direct assertion. A raw-ZIP mutation
survived a broad refusal assertion because a later lineage guard also refused.
The test now requires the exact early diagnostic. Member and overlap variants
contained later refusals alongside direct failures; their records mark that limit.
The invalid-argument test now detects derivation calls before argument admission.
No runtime guard was weakened to obtain a passing run.

These tests do not attest live actor authority, source permission, image decoding,
installation identity or arbitrary same-user file changes. Controlled small
fixtures do not establish maximum-job capacity. Filesystem synchronization,
cooperative writers and nonpreemptible kernel I/O remain explicit assumptions.

## A stopped child preserves unresolved ZIP commands

The [native root driver](native_recovery.py) admits an actual synthetic request,
retains the original ZIP, derives its slots and records original commands. Its
child exits abruptly after an unresolved second upload intent. The actual root
snapshot CLI captures and verifies the stopped root. A fresh copy opens with a
nonexistent original-input path. Original plan, lineage, reply bytes and uncertain
intents remain unchanged; issued commands return no second first-issue flag.
Commit remains unissued. Changed raw archive, derived bytes, reply hash and engine
identity refuse. Mutated bytes restore in `finally`.

All [22 observations](evidence/native-observed.json) and [69 controls](evidence/native-controls.json)
pass. Three harmless variants survive and 66 wrong, missing or wrong-type variants
fail. The proof takes 0.901 seconds. Original producer/package ordinary bytes and
full logical SQLite schema/rows remain unchanged. [Source bindings](evidence/native-source-bindings.json)
remain unchanged. The historical photo root proof also passes with 19 observations
and 60 controls. This checks process interruption after synchronization returns,
rather than physical power loss or interruption inside a database/filesystem call.

## Actual cached engine drafts match original derived bytes

The [native engine driver](native_engine.py) uses the exact cached NodeODM 2.2.4
image. Four owned engines run serially with 512 MiB limits, no external network
and no host ports. The original journal's descriptors initialize one UUID and
upload the first original derived slot. Its observed reply is deliberately not
saved. After stopping and capturing that engine, actual CLI inspection reports
the exact partial draft. The uncertain first upload does not issue again.

A fresh copied engine root receives the previously unissued second slot. Stopped
root inspection reports the complete original draft. Separate fresh copies expose
actual duplicate-upload and metadata-overwrite effects; the inspector refuses
both. A changed captured image byte also refuses. All captured packages and
protected roots remain unchanged. Inspection grants no transport permission.

All [33 observations](evidence/engine-observed.json), [102 controls](evidence/engine-controls.json)
and [nine response controls](evidence/engine-response-controls.json) pass. The
run takes 15.395 seconds. All four engines stop cleanly and remain retained. The
[12 source bindings](evidence/engine-source-bindings.json) identify the exact code.
No commit, image decoding, reconstruction, callback, live authority check or
end-to-end worker recovery runs. Ordinary synthetic bytes exercise custody; an
image extension and HTTP success do not establish usable imagery.

## Integration checks and remaining work

All [14 aerial test scripts](evidence/odm-suites.json) pass serially. [Five CI discovery/fail-fast controls](evidence/ci-discovery-controls.json)
and both [new actual YAML commands](evidence/actual-ci-steps.json) pass locally.
All [14 nested application documentation tests](evidence/documentation-checks.json)
and the direction check pass. The first documentation invocation refused an
unsupported Vitest option before running tests; that failed record remains.
Existing direction reminders remain visible. GitHub CI remains a separate check
of the eventual committed head.

[Resource records](evidence/resources.json) retain passing and failed service
invocations. The combined Python checks peak at 63,238,144 bytes, native engine
driver at 46,272,512 bytes and actual CI commands at 64,208,896 bytes, each under
256 MiB. Passing documentation peaks at 302,202,880 bytes under 1 GiB. All services
use one CPU and no extra swap. All owned services have no active process, and
all four new engines are stopped. Failed services keep their failed status.
Engine limits describe configured capacity, rather than measured engine peaks.

Next connect durable admission, retained source custody and original engine
stages in an isolated runtime candidate. Preserve uncertain effects for explicit
backend reconciliation. URL intake, cancellation, commit/results, callback
custody, live authority, independent restoration and full worker acceptance
remain open. Agent checks do not establish practitioner or public acceptance.
