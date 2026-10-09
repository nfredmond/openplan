# Prepared network source comparison, October 9, 2026

Follow-up: [directed graph comparison](ASSIGNMENT_DIRECTED_GRAPH.md) adds checks
for recorded road-class factors, direction, node remapping and mode exclusion.
The original source-only evidence and limits below describe the preceding
checkpoint.

The initial assignment snapshot now records a logical identity for the actual
working project's node and link tables. When a confirmed preparation consumption
exists, the parent compares its retained network against that identity before
registering the initial inputs. A missing or changed working-network identity
stops registration and execution. Both methods retain the same boundary without
combining their demand or results.

The identity reads all columns of ordinary `nodes` and `links` tables in a single
read-only SQLite transaction. It sorts columns and rows by their explicit integer
IDs, hashes typed values incrementally and includes geometry blobs. Duplicate or
noninteger IDs, empty tables, views and aliased file paths are refused. Column
order, row insertion order, SQLite page layout and unrelated project metadata do
not change the identity. The prepared file's hash and size are checked again
after the logical read.

The registered link uses `scope: source_node_link_records`. This proves equality
of source records, not every transformation from them into the final graph. The
existing graph fingerprint and live-profile checks remain separate. Road-class
speed/capacity factors, graph preparation, centroid treatment and demand changes
still need an explicit source-to-solver comparison. Overall solver-input
equivalence, preparation independence and scientific acceptance remain unassessed.

## Verification

- The related worker suite passes 102 tests. Seven new SQLite tests cover data,
  topology and geometry changes, harmless metadata and layout changes, malformed
  IDs, empty/view inputs, read-only behavior and missing/aliased paths. Two added
  preparation tests cover changed and missing working-network identity.
- Eight network-source controls, thirteen preparation-link controls, seven
  snapshot controls and eight publication controls meet their expected outcomes.
  The source controls detect ignored geometry, duplicate/noninteger IDs, empty
  inputs and sensitivity to irrelevant column order. Removing network comparison
  makes the changed-network test fail.
- Nine native database controls cover both methods using real claims, producer
  completion, consumption and initial-input transactions with synthetic solver
  objects. Harmless network metadata survives. A changed capacity prevents input
  registration and a solver call, and stops the writer. Removing profile or
  network comparison fails the corresponding native proof.
- Four native AequilibraE 1.6.2 controls compare the retained identity against the
  actual working database after the two-centroid, one-link assignment. Baseline,
  harmless and restored cases pass. Omitting capture fails even though the solver
  succeeds. Parent database responses are injected in these controls.
- A separate native assignment also passes through isolated PostgreSQL/PostgREST,
  with 25 artifacts. Its retained database is
  `openplan_attempt_cli_69e4d00c8fab4e2f820d6f26ad3e78c7`. This fixture has no
  preparation consumption; the joined consumption proof uses synthetic solvers.

Private evidence is retained under these directories:

- `/home/nathaniel/.local/state/openplan/native-network-source-controls-20261009a`
- `/home/nathaniel/.local/state/openplan/native-network-source-engine-controls-20261009a`
- `/home/nathaniel/.local/state/openplan/native-network-source-assignment-20261009a`

Committed summaries are the corresponding `network-source`,
`native-network-source` and `native-preparation-profile` reports in `prototype/`.
Temporary gateways were removed and database clones retained. None of these
synthetic fixtures establishes independent scientific or nationwide acceptance.

## CI failure and repair

GitHub run `37926109875`, worker job `113805330785`, failed at
`test_stage5_network_state_mismatch_is_guarded_before_execute`. It searched for
the removed direct `assig.execute()` call and raised `ValueError: substring not
found`. The actual stage now enters `model_assignment_input_snapshot.retain_and_execute`.

The test now parses calls from the stage's syntax tree. It requires one network
guard before one retained execution entry and rejects a direct `assig.execute`
bypass. The existing semantic test still checks rejection of a changed expected
network state. Six controls verify baseline, harmless comment, omitted guard,
late guard, direct bypass and restored source. This checks static call order,
not execution of every possible control-flow path.

After repair, all 150 `test_*.py` scripts in `workers/aequilibrae_worker` pass
serially in the local lightweight Python environment. Native-engine-only checks
inside those scripts can self-skip; this is not a native-engine acceptance suite.
Logs and per-suite results remain at
`/home/nathaniel/.local/state/openplan/full-worker-check-20261009a`.
The original GitHub failure log remains at
`/home/nathaniel/.local/state/openplan/ci-worker-failure-6f016893c/worker.log`.
Fresh-head GitHub checks remain required.

Seven superseded ancestor runs were re-read, confirmed fully queued with no job
steps, and cancelled. GitHub subsequently confirmed each cancellation. Current
head, running jobs and unrelated branches were preserved. The custody record is
`/home/nathaniel/.local/state/openplan/ci-queued-ancestor-cleanup-20261009g/audit.json`.
At last inspection, the previous checkpoint's focused worker, modeling and ops
jobs passed; QA, shuffled Vitest, RLS and restore jobs were running. Its worker
failure is the repair described above, not a green result.
