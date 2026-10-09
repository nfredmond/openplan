# Directed source network comparison, October 9, 2026

Follow-up: [centroid routing checks](ASSIGNMENT_CENTROID_ROUTING.md) add native
centroid-map and through-flow policy verification. The evidence below describes
the original directed-link checkpoint.

Initial assignment now checks its directed graph against the working network
before creating snapshot files or calling the solver. The comparison uses the
same read-only SQLite transaction that hashes the source nodes and links. It
checks link direction, original node IDs after index remapping, mode exclusion,
distance, travel time and capacity. Recorded road-class factors divide baseline
travel time and multiply baseline capacity. Unexplained differences stop execution.

The retained manifest records `network_graph_verification` with the scope
`directed_source_links_with_road_class_factors`, the source and settings hashes,
and each graph's directed-link count and digest. Row order does not affect the
comparison. Missing or extra directions and graph nodes absent from the source
are refused. The existing network-settings canonicalizer now lives in a shared
module used by both the worker and this comparison.

This extends [source record comparison](ASSIGNMENT_NETWORK_SOURCE.md). It does
not prove compressed routing equivalence, centroid-through policies, demand
transformations, calibration iterations, preparation independence or scientific
accuracy. The manifest explicitly leaves compressed routing unassessed. Normal
dispatcher activation and nationwide independent acceptance remain open.

## Verification

- All 151 worker `test_*.py` scripts pass serially in the lightweight Python
  environment. Native-only checks within those scripts can self-skip. Logs and
  per-suite results remain in `full-worker-check-20261009b` under the private
  OpenPlan state directory.
- Nine new graph tests use real SQLite and synthetic graph objects. They cover
  both one-way directions, reverse endpoints, mode exclusion, recorded factors,
  reordered rows, missing and extra links, invalid node maps, and source drift
  even when graph and solver arrays agree with each other.
- Nine graph mutation controls meet their expected outcomes. A harmless edit
  survives. Removing comparison, ignoring factors or modes, omitting reverse
  endpoint swapping, or dropping inventory checks fails the corresponding proof.
- Ten native AequilibraE 1.6.2 controls pass their expected outcomes on a synthetic
  two-centroid, one-link network. A recorded 1.25 road-class factor passes.
  Changing graph and solver capacity together stops before execution. Disabling
  graph comparison makes that refusal proof fail. These controls inject parent
  responses; they do not establish the database transaction boundary.
- A separate native assignment passes through isolated PostgreSQL and PostgREST,
  converges and registers 25 artifacts. Its database is
  `openplan_attempt_cli_d5d718bb26c44b14a082d1df62d4d6ed`. This fixture has no
  preparation consumption. Nine separate preparation controls exercise completed
  producers, consumption and initial registration for both methods with synthetic
  solver objects. All meet their expected outcomes.
- Source, preparation-link, snapshot, publication and static guard-order control
  campaigns also pass. Their limits remain in the corresponding reports.

Native evidence is retained under the private OpenPlan state directory in
`native-directed-graph-controls-20261009a`,
`native-directed-graph-assignment-20261009a` and
`native-directed-preparation-controls-20261009a`. Committed summaries and
reproducible controls live in `prototype/`. Temporary gateways were removed;
database clones remain. Large-network performance has not been measured.

The product-direction check passes with dated review reminders. Those dates were
not changed. The preceding commit's focused worker, Python worker, modeling and
ops GitHub checks pass; QA, shuffled Vitest, live RLS and restore checks were still
running at inspection. This checkpoint needs its own GitHub results. T3 screenshot
capture still fails, so this work supplies no new visual acceptance evidence.
