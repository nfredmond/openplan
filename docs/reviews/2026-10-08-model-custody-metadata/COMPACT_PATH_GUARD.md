# Retained compact path guard, October 9, 2026

Initial assignment now checks the retained compact topology after verifying
directed links against the working source database. Every compact edge must
have a nonempty, unbranched directed source chain connecting its original
endpoints. An interior centroid is refused. Compact IDs, node/edge counts,
endpoint indices, source crosswalk indices and the forward-star adjacency
boundaries must agree before input files are retained or the solver executes.

The manifest records each graph's `compact_paths` result with scope
`retained_compact_source_paths`, a source-path digest and the number of source
directions assigned to the engine's excluded-link sentinel. It explicitly marks
excluded-direction equivalence and runtime cost/flow equivalence unassessed.
The overall compressed-routing claim remains unassessed. A structurally valid
retained chain cannot prove that every excluded direction was safe to remove.

## Checks and failure evidence

Fifty-eight related unit tests pass. Eight compact-path tests cover source row
reordering, changed endpoints and adjacency boundaries, misdirected or missing
crosswalks, branches, an interior centroid and invalid arrays/counts/indices.
Seven temporary-source controls meet their expected outcomes, including a
harmless comment and targeted removals of the adjacency, endpoint, branch and
centroid checks. Removing the branch check still reaches the endpoint guard,
so that control detects the changed rejection boundary rather than claiming
that the corrupted graph executed.

Ten directed-source controls also pass. Their extra-edge fixture now gives the
invented source edge a structurally valid compact representation. This isolates
the source inventory check; otherwise the new compact guard independently
rejects the malformed fixture and masks the original mutation's intended result.
The initial control failure was investigated rather than counted as a pass.

The native control campaign adds a changed compact endpoint and a bypass of this
guard. The first run correctly refused the changed endpoint through the interior
centroid check, while the control expected the later endpoint error. The corrected
control names the observed centroid-crossing diagnostic. The separate bypass
run reaches the native solver and fails the required refusal proof with
`Native solver drift was not refused`. The original logs remain under
`native-compact-path-controls-20261009a` and
`native-compact-bypass-20261009a` in the private OpenPlan state directory.

The reproducible controls and final native outcomes are retained in
`prototype/compact-path-controls.json`, `prototype/network-graph-controls.json`
and `prototype/native-live-profile-controls.json`. The larger three-centroid
[routing fixture](COMPRESSED_ROUTING_FIXTURE.md) now invokes the production
compact guard before checking native fixed-cost routes and expanded flows.

The corrected native campaign passes all fifteen expected outcomes. Its final
logs are under `native-compact-path-controls-20261009b`. All seven larger routing
fixture controls also pass with the production guard enabled; the final report
is under `native-compressed-routes-guard-20261009a`. Both directories are in the
private OpenPlan state directory. Source and engine hashes remain in the reports.

## Remaining boundaries

The [excluded-path counterexample](EXCLUDED_PATH_COUNTEREXAMPLE.md) rejects a
later candidate that would incorrectly stop valid partly one-way chains. That
candidate remains research evidence; production exclusion claims stay unassessed.

The two-centroid managed native fixture uses injected parent database responses.
The three-centroid comparison exercises native cost aggregation and flow
expansion at fixed costs, not full equilibrium iterations. No new database,
normal-dispatch, prepared-demand, large-network performance, scientific accuracy
or practitioner acceptance claim follows. The guard uses linear source-edge
storage in addition to the native graph; large-network memory has not been
measured. These are implementation checks within the full v1 requirements.
