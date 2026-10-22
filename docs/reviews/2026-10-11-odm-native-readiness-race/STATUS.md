# Native readiness publishes complete JSON before readers observe it

PR226 head `530637b1f` fails in [GitHub run38184529511](https://github.com/nfredmond/openplan/actions/runs/38184529511)
during actual HTTP admission and stopped-root recovery. The replacement worker's
readiness file exists before its JSON write finishes. The parent reads empty
bytes and raises `JSONDecodeError`. The corrected journal tests and controls pass
on that run. This is a separate native-proof harness race.

The harness now writes its owned listener through a pending private file,
synchronizes the complete JSON, links it atomically without overwriting an
existing listener, removes the pending name and synchronizes the parent. The
actual worker wrapper uses this publisher. No application/runtime implementation,
worker default, schema, deployed configuration or hosted service changes.

All four new tests and [nine controls](evidence/python311-source-controls.json)
pass on Python 3.11.15 and 3.14. Four positive/harmless/restored runs survive; five
targeted variants fail at the intended assertion. A real writer pauses before
JSON bytes are written. Its final listener remains absent until publication.
Direct publication exposes the partial file and fails. Overwriting an existing
listener, missing file/parent synchronization and publication after failed file
synchronization fail their respective checks. Edits restore in `finally`.

The first control trial rejects a correct targeted failure because its assertion
message follows a multiline equality diff. The controller now parses the final
diagnostic block, excluding traceback source, rather than only its first line.
The source and test guard stay unchanged. Failed and passing trials remain in
[resource records](evidence/resources.json).

[Four actual native controls](evidence/native-controls.json) pass: baseline,
paused-writer harmless variation, targeted direct partial publication and final
restoration. The broken writer fails at the same actual `JSONDecodeError` seen
in GitHub. The paused atomic writer completes original HTTP receipt replay,
conflict and stopped-root recovery. The final restored run passes with
30 observations/93 observation controls. Every owned child and listener stops;
original root/package bytes stay unchanged. Zero imagery body bytes and engine
requests run. [Current bindings](evidence/native-source-bindings.json) identify
the actual worker, wrapper driver and publisher. Earlier admission records remain
historical. Full worker recovery, engine/results/artifacts, live authority and
browser/practitioner acceptance stay open.

The corrected serial service peaks at 58,384,384 bytes under 256 MiB, one CPU and
no extra swap, exits zero and stops. Small fixture results do not establish
capacity or power-loss recovery. All inherited actual CI commands, documentation
and exact committed GitHub checks require separate continuation.

Main merges remain held until the coordinator's dated lift after technical
handoff, Nathaniel's separate Opus review and resolved blockers. Implementation
and controlled checks belong to GPT-6.1 Sol at high reasoning; no independent
review is claimed.


## All inherited actual CI commands pass locally

All [17 actual YAML commands](evidence/actual-ci-steps.json) pass, including the
16 aerial suites, original source controls, stopped-root checks and both new
readiness commands. Actual HTTP admission recovery passes again with
30 observations/93 controls and [current native bindings](evidence/actual-ci-native-source-bindings.json).
The native paused/broken/restored readiness controls pass through the actual
workflow command. The serial service reaches its 256 MiB configured cap, exits
zero and stops. Final before-exit cgroup counters report zero OOM and OOM kills;
no spare-capacity claim follows.

All 14 nested application documentation tests and product direction check pass.
Existing reminders remain visible. The documentation service peaks at
283,545,600 bytes under 1 GiB, exits zero and stops. Exact-head GitHub acceptance
remains pending for the next committed correction.
