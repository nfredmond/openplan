# Task metadata preserves reported facts and exact replies

The worker has a separate read-only parser for supplied NodeODM task metadata.
It binds replies to the original plan's UUID, name, image count and options.
It retains the exact response bytes, byte count, response hash and plan hash.
It grants no transport or publication permission. Runtime polling and terminal
result recovery remain unconnected.

The existing [ODX assessment](../2026-09-06-handoffs/ODX_TRANSITION_RESEARCH.md)
requires capturing options added by the API, beyond the requested preset.
The cached NodeODM 2.2.4 source adds supported `pc-ept`, `cog` and `gltf` flags.
This parser retains requested options and reported additions separately.
Reported options do not establish every effective execution setting.

## Implementation and verification

Required fields cannot disappear into defaults. Unknown image count `-1` stays
unassessed. Not-started processing time `-1` stays distinct from zero. Duplicate
JSON keys, nonfinite numbers, repeated option names, changed requested values,
unsupported additions and malformed status/progress/time fields refuse.
API state, progress and durations remain reported values. Source custody, live
actor authority, engine identity, freshness, full execution settings and imagery
quality remain unassessed, including when the API reports completion.

All 23 parser tests pass on Python 3.14 and 3.11. Each interpreter's
[31 source controls](evidence/source-controls314.json) retain four survivors and
27 selected failures. [The second interpreter](evidence/source-controls311.json)
passes independently. Each test has a targeted control. Huge finite integer
progress now refuses by range before float conversion; the preceding code raises
an overflow in the new regression test. Source restores exactly.

The [actual native probe](evidence/native-results.json) saves its complete
original plan before API initialization, uploads three retained invalid byte
strings, checks the real original UUID commit reply and observes failed status.
It reports three images and added pc-ept/cog/gltf options, with no requested
options. Exact name and options fields enter initialization. An uncommitted
draft's actual unavailable metadata refuses. This is experimental API behavior,
without managed application authority or decoded imagery acceptance.

Eight retained-native consistency controls pass on
[3.11](evidence/native-replay-controls311.json) and
[3.14](evidence/native-replay-controls314.json). Three positives survive, including
harmless JSON whitespace with its own exact hash. Five changes refuse: original
UUID, added option, raw-body hash, claimed imagery quality and relabeled failed
status. The original plan, raw reply and observation remain byte-exact.

The [full existing workflow](evidence/workflow-results.json) passes all 31 actual
stages, 23 unittest suites with 591 cases, seven scenario programs and 20
nested-app documentation/release-ordering cases. Product direction passes with
its existing review reminders. [All worker bindings](evidence/workflow-source-bindings.json)
match after restoration. The [owned unit](evidence/workflow-resources.json)
stops at a 923,312,128-byte peak under 1 GiB, zero max/OOM events and no extra
swap. The workflow and added controls take 334.399 seconds, excluding the final
pointer-control cohorts. [The new index pointer controls](evidence/pointer-controls.json)
retain three passing six-case cohorts; a broken target fails the named markdown
link assertion and observed missing path. Current-head GitHub checks and main
integration remain separate. This follow-up does not alter frozen PR263.


## Failed trials and limits

The first source controller used a mutation helper that mishandled an inline
Python guard. It failed with an indentation error and is rejected. The second
progress-type mutation reached a null value first and raised the wrong error.
The corrected test order observes the boolean-type failure, with source restored.
An additional check reproduces an overflow for a huge integer progress value.
The final parser refuses it before float conversion.

The first native program incorrectly expects task-info availability immediately
after draft initialization. The actual API returns the original UUID's
`not found` response. The parser refuses it and the owned engine stops. Later
probes retain that refusal explicitly before observing the committed failed task.
Three deliberately invalid ordinary byte strings are the inputs. They do not
establish decoded imagery or reconstruction quality.

The first complete worker replay passes all 31 worker stages, then its docs
command fails before starting Vitest because this checkout lacks dependencies.
That attempt is rejected as complete acceptance. The matching existing package
dependencies are then linked, and the final full replay passes.

The native fixture uses a cached pinned image and an existing owned internal
bridge. It opens no host port and starts no database. The engine has a read-only
image, one CPU, 64 tasks and 512 MiB with no extra swap. It is an experimental
API fixture, not the managed native execution profile. Its local dispatch uses
synthetic identities, without application-authority acceptance. All owned engines stop with reported OOMKilled=false. Container peak memory and cgroup events are not measured.

The parser and consistency controls cannot detect a completely substituted
native evidence package or stale live metadata. They do not establish current
engine/actor authority, uncertain-effect reconciliation, writer exclusion,
adoption, runtime polling, output/callback recovery, useful long computation,
installation-wide or physical-host restore, browser/practitioner/scientific
acceptance, full M3 or v1. Defaults and claim tiers stay held.

Private original plans, replies, logs and fixtures remain under
`/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/odm-task-observation-20261013/`.

## Integration with the corrected 34-head candidate

The separate metadata branch joins candidateb20dc2879 without folding metadata
into its production turn. The shared index append conflict preserves both the
metadata and managed-state report pointers. All new worker/source-control bytes
from the retained-state correction survive.

[Current31-stage replay](evidence/current-candidate-workflow-results.json) passes
601 worker cases across24 suites, seven scenario programs and20 app/docs cases.
Direction passes. All23 metadata cases/31 source controls on3.11, the fresh
experimental native reply and eight retained-native controls on both interpreters
pass. [Source bindings](evidence/current-candidate-worker-bindings.json) match
after exact restoration. The [unit](evidence/current-candidate-workflow-resources.json)
stops at959,844,352 bytes under1GiB, zero max/OOM and no swap. The workflow
and added controls take334.790 seconds, excluding the final pointer cohorts.
[Current pointer controls](evidence/current-candidate-pointer-controls.json) retain
three passing six-case cohorts and one targeted broken-link failure.

Earlier002d9c274 GitHub gates all pass, including live RLS. They do not accept
this joined head. Current GitHub/main/production checks remain separate, and
PR282 stays a separate turn after263's exact promotion. No root/hosted/default,
processing, publication, actor-authority, quality or acceptance claim is added.
