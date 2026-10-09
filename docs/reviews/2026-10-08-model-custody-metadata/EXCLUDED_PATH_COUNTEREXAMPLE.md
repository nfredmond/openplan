# Excluded-path candidate rejected, October 9, 2026

A proposed excluded-link guard would incorrectly stop a valid native assignment.
It has not been shipped. Production compact-path checks and their explicit
unassessed exclusion boundary remain unchanged.

The candidate requires nonnegative costs and no directed path through excluded
directions between distinct anchors. Anchors include centroids and every endpoint
of a retained source direction. A queue propagates at most two distinct origin
labels per node. This tests a sufficient condition for harmless exclusions;
failure of the condition does not prove that an exclusion changes centroid
routes. Treating it as a mandatory refusal rule was the error.

## The native counterexample

The six-link network has three centroids, a partly one-way chain and alternative
connections. Link 1 permits travel both ways between centroid 1 and node 10.
Link 2 permits travel only from node 10 to centroid 2. Native compression retains
the forward chain from 1 to 2 and excludes link 1's reverse direction from 10
to 1. That reverse segment cannot complete the reverse route from 2 to 1.

The candidate nevertheless rejects the segment because both 10 and 1 are
anchors under its definition. The native fixed-cost assignment matches the
independent source-graph Dijkstra calculation for all nine origin/destination
costs and every expanded directed-link flow. The cost matrix is:

| Origin / destination | 1 | 2 | 3 |
|---|---:|---:|---:|
| 1 | 0 | 2 | 4 |
| 2 | 6 | 0 | 3 |
| 3 | 4 | 3 | 0 |

These are synthetic cost units. The reverse route from 2 to 1 uses a different
chain. All non-diagonal demand pairs carry positive, distinct quantities. This
is a routing transformation counterexample, not an observed travel study.

## Retained evidence

- `prototype/excluded_paths_candidate.py` preserves the rejected rule as a
  research module, with no production import.
- `prototype/test_excluded_paths_candidate.py` passes five tests. It compares
  directed reachability on every one of the 4,096 loop-free directed graphs on
  four nodes, for both two-anchor and three-anchor cases. This validates the
  predicate, not its use as a necessary condition for valid compression.
- `prototype/verify_excluded_path_counterexample.py` and its JSON report retain
  the native case, source links, candidate/proof hashes and five controls.
  Baseline, harmless comment, reversed input rows and restored source reproduce
  the false rejection while native costs and flows match the independent result.
  Removing the candidate's route check fails the counterexample assertion.
- The final native report is retained at
  `/home/nathaniel/.local/state/openplan/native-exclusion-counterexample-20261009b/report.json`.
  It runs directly in the installed AequilibraE 1.6.2 Python environment, with
  one assignment core and one BLAS/OpenMP thread.

The earlier candidate integration and all changed files were copied to
`/home/nathaniel/.local/state/openplan/excluded-path-candidate-rejected-20261009a`
before restoration from the committed source. No shared checkout reset was used.
That private record retains the initial native refusal and restoration manifest.
The smaller candidate campaign had passed 64 related tests, mutation controls
and fifteen native managed-fixture controls. Those passes did not cover this
valid partial-direction case and did not justify accepting the guard.

## Consequence for the existing modeling work

Retained compact paths remain checked. Excluded-direction equivalence remains
unassessed. A general exclusion proof must account for partial reverse segments
inside contracted one-way chains, as well as dead ends, cycles, mode exclusions
and possible alternate routes. It must distinguish a sufficient certificate
from a necessary condition before stopping a run.

This finding changes the implementation approach, not the roadmap or full v1
scope. It does not close per-run compressed equivalence, equilibrium behavior,
normal managed dispatch, independent scientific accuracy or human acceptance.
