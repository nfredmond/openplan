# Owned aerial draft commands preserve original intents and replies

The owned admission runtime now composes local preparation with the original
engine journal through a candidate draft callable. A supplied permission adapter
must return exactly `True` for the original plan and next command before the
first issue. A supplied transport receives detached metadata, the original
retained image stream and the deadline. These interfaces do not establish live
application authority, engine custody or actual request cancellation. The
[design](DESIGN.md) states that boundary.

Each call advances at most one original initialization or image upload. Its exact
intent persists before transport, and its checked reply persists before the next
command. A pending or unresolved prefix prevents later commands. Existing intents
never gain a second issue. Prior commit records hold explicitly. A complete draft
leaves commit unissued. The runtime keeps the original started job held.

The upload opens the original retained or ZIP-derived image, rechecks its size and
hash on the same descriptor, rewinds it and requires transport to consume the
whole image. Late or failed responses leave the original intent unresolved. Exact
status/body replies use the existing strict JSON and original UUID checks. No
public worker schema, default pipeline, application route, deployed configuration,
migration or hosted service changes. Main merges remain held until the
coordinator's dated lift after handoff, separate Opus review and resolved blockers.

## Tests exercise source, permission, sequencing and deadline failures

All 20 new tests and 31 controls pass before the later journal correction. Four
baseline/harmless/restored runs survive; 27 targeted variants fail. One variant
checks the explicit prior-commit hold state. Removing a detached permission-plan
copy reaches the existing original-plan identity refusal for a valid adapter,
rather than establishing unsafe transport acceptance. The tests cover exact
permission before intent, detached adapter values, command-prefix order, retained
size/hash checks before transport, complete consumption, exact response validation,
original intent/reply ordering and expired preparation, gate, source and response
boundaries. Controls restore source bytes in `finally`, with bytecode disabled.

Three failed control trials remain retained. A removed permission guard first
fails at the stronger assertion that denied work must not acquire an intent;
the expected diagnostic now names that assertion. A removed size guard initially
reaches the later hash backstop; the test now asserts refusal before source reads.
A deadline mutation initially matches multiple blocks; its context anchor now
selects the late-response guard uniquely. None of these corrections weakens a
source guard.

Current source bindings and corrected-run evidence follow after the journal
concurrency correction. Small private fixtures do not establish maximum-job
capacity, hostile same-user file-race behavior, power-loss recovery or actual
request cancellation.

## Native engines accept original drafts and uncertain work remains held

The native driver uses two fresh instances of the exact cached NodeODM 2.2.4 image,
serially, with private owned roots, no host ports or external network, 512 MiB,
one CPU and no extra swap. Actual runtime/preparation/draft calls issue two
initializations and three original image uploads. Synthetic ordinary bytes serve
as input; no image decoding or processing commit runs.

For one engine, the driver observes a successful first-upload reply and
deliberately omits it from the worker journal. The original intent stays unresolved.
Another advance issues no second request or later upload. Actual stopped engine
and worker captures verify; the existing private draft inspector confirms the
first original image and missing second image, and denies inferred transport.
A fresh runtime copy retains the original admission/context/task and holds the
uncertain command without permission or transport calls, even when the original
input folder is unavailable. This is deliberate receipt omission after an
observed response, not a native network-loss demonstration.

The second engine acknowledges initialization and both original images. Its
captured draft matches the exact planned filenames and byte hashes. Further
advance holds commit, with no commit intent or request. All owned engines stop;
retained roots and packages remain unchanged. These observations establish
controlled draft behavior, not live authority, commit/results/callback recovery,
full worker recovery, browser acceptance or independent planner observation.

## Verification and next integration remain explicit

Before the journal correction, native checks pass with 27 observations, 84
observation controls and 14 response controls. The actual YAML loop discovers all
17 aerial suites and has five discovery/fail-fast controls; the new draft command
passes locally. GitHub acceptance remains separate for the committed head.
Corrected source-bound results and resources follow below.

Next connect trusted original application context and retained URL intake, live
permission and actual deadline/cancellation transport. Processing commit,
original backend reconciliation, outputs, artifact links and callbacks still need
integration and independent recovery verification. M3/M5b.2 and full v1 remain
open; no requirement, scientific or practitioner grade changes.

Implementation and controlled checks belong to GPT-6.1 Sol at high reasoning.
These are implementation-owner checks, not an independent review.


## Corrected-source continuation passes

After the [SQLite concurrency correction](../2026-10-11-odm-sqlite-companion-race/STATUS.md),
all 20 tests and [31 source controls](evidence/source-controls.json) pass again.
The [current source bindings](evidence/source-bindings.json) and
[native bindings](evidence/native-source-bindings.json) identify the corrected
worker files. Native checks pass with [27 observations](evidence/native-observed.json),
[84 observation controls](evidence/native-controls.json) and
[14 response controls](evidence/native-response-controls.json), in 11.587 seconds.
Both fresh engines stop and retained protected roots/packages stay unchanged.
Earlier native runs remain historical and are not presented as current bindings.

All [17 aerial scripts](evidence/worker-suite-census.json) pass through the actual
YAML discovery loop, along with [five discovery/fail-fast controls](evidence/ci-discovery-controls.json)
and the [new actual draft command](evidence/actual-ci-steps.json). The suite census
records a shared loop exit, not separate per-script exit records.
The corrected-source serial unit peaks at 72,949,760 bytes under
256 MiB, exits zero and stops. [Resources](evidence/resources.json) preserve the
earlier failed control trials and passing runs. Docker engine limits are separate
configured caps, not measured processing capacity.

Nested documentation and exact committed GitHub checks follow separately.


## Parent CI repairs join without changing draft bindings

The parent candidate now includes the separately proved
[atomic native readiness correction](../2026-10-11-odm-native-readiness-race/STATUS.md).
Exact known uncommitted draft additions are preserved before the parent
fast-forward and restored afterward. Every declared native draft source binding
still matches. The combined actual YAML discovery loop passes again with all
17 aerial suites and five discovery/fail-fast controls, followed by the original
draft command. Its current workflow hash appears in the actual-CI evidence.
The serial CI continuation peaks at 66,617,344 bytes under 256 MiB, exits zero
and stops. Parent GitHub acceptance remains pending at `200b92d23`; no main
merge or hosted change follows.

All [14 nested documentation tests](evidence/documentation-checks.json) and the
[product direction check](evidence/documentation-results.json) pass after joining
the parent repairs. Existing direction reminders remain visible. Documentation
peaks at 273,920,000 bytes under 1 GiB, exits zero and stops. Every recorded owned
service now has zero active PID and is stopped. GitHub CI remains separate for
the committed candidate; neither this checkpoint nor a push lifts the main hold.
