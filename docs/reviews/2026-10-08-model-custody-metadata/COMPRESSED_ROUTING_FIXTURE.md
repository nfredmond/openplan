# Native compressed routing fixture, October 9, 2026

Follow-up: the [retained compact path guard](COMPACT_PATH_GUARD.md) now checks
each retained source chain and compact adjacency before initial assignment.
The fixture also invokes that guard; excluded-link equivalence remains open.

The installed AequilibraE 1.6.2 compressed all-or-nothing assignment matches an
independent source-graph route calculation on a synthetic three-centroid network.
The fixture exercises chains, a branch, a dead end, mode exclusion, directional
cost differences and through-centroid blocking. It compares every origin and
destination cost and every expanded directed-link flow.

The reference uses Python heap-based Dijkstra routing over the original link
records. It does not read native graph indices, compact topology, crosswalks or
results. Demand differs among the six non-diagonal origin/destination pairs.
The native path builds a Graph, prepares assignment results, aggregates costs
using `aggregate_link_costs`, executes `allOrNothing`, and expands loaded flows
through the native result crosswalk. This exercises the cost aggregation and
flow expansion routines identified in the
[centroid routing review](ASSIGNMENT_CENTROID_ROUTING.md).

## Results and controls

Seven controls meet their expected outcomes:

- Baseline and reversed source-row order match every reference cost and flow.
- An unblocked baseline matches a separately computed unblocked reference.
- Disabling centroid blocking while retaining the blocked reference fails the
  cost comparison. The route from centroid 1 to 3 costs 13 with blocking and
  10.5 without it. Units are synthetic cost units, not measured travel time.
- Changing an active compressed cost fails the route-cost comparison.
- Redirecting a source link's result crosswalk to a dead-end entry fails the
  expanded-flow comparison.
- Restored inputs match again. A one-way link gives costs of 1.5 from centroid
  2 to 3 and 2 in the reverse direction.

The committed script and report are
`prototype/verify_native_compressed_routes.py` and
`prototype/native-compressed-routes.json`. The report records the script hash
and hashes of the installed graph, all-or-nothing, assignment-results and native
AoN implementation. Private final evidence is
`/home/nathaniel/.local/state/openplan/native-compressed-routes-20261009c/report.json`.
The command uses the existing native Python environment with one BLAS/OpenMP
thread and one assignment core. No database or existing model record is changed.

## What this does not prove

This is a fixed-cost native transformation test. It does not run the complete
managed worker, validate changing equilibrium costs, cover calibration or prove
all compact topology variants. The production manifest still marks compressed
routing equivalence unassessed. Passing this fixture does not authorize changing
that claim for an arbitrary run.

The native mode-exclusion input uses the existing endpoint-collapse convention;
the reference omits the excluded mode. That checks their equivalence in this
fixture, not every upstream network import. Geographic generality, prepared
demand equivalence, observation independence, scientific accuracy and practitioner
acceptance remain separate requirements under the full v1 contract.
