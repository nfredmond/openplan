# Initial centroid routing checks, October 9, 2026

The initial assignment now verifies the native routing centroid maps before
retaining inputs or executing. Centroid IDs must be unique positive integers,
the graph's zone count must match, and both directed and compact node arrays
must begin with the declared centroid order. Both reverse maps must place those
IDs at the matching zero-based positions. The stage requires a literal true
through-centroid blocking flag, consistent with its existing builder policy.

The snapshot already compares class matrix order with graph centroid order.
The new checks extend that comparison to the indices native routing actually
reads. `network_graph_verification.centroid_policy` records the blocking policy
and matched directed/compact centroid indices. It does not declare compressed
path equivalence or scientific acceptance.

## Basis in the installed engine

Inspection covers the installed AequilibraE 1.6.2 source, not every supported
engine version. `paths/graph.py::_build_directed_graph` places centroids first
and constructs the reverse map. `paths/cython/graph_building.pyx` uses the same
builder for the compact graph and preserves centroid nodes during compression.
`paths/cython/AoN.pyx::one_to_all` selects the demand row using
`compact_nodes_to_indices[origin]`, reads `num_zones` and
`block_centroid_flows`, and routes with compact forward-star and endpoint arrays.
Thus a matching matrix and declared centroid list alone do not prove that the
native demand row and routing indices agree.

## Verification boundaries

Forty-four related unit tests pass. Two new tests cover the recorded scope and
refusal before snapshot creation or execution when the block flag, zone count,
centroid IDs, node prefix or reverse map changes. Ten directed-graph controls
pass their expected outcomes, including a harmless comment and removal of the
centroid check. These use real SQLite with synthetic solver objects.

Thirteen native controls meet their expected outcomes. Disabling through-centroid
blocking or changing the compact centroid reverse map stops before execution,
initial manifest and final volumes. Removing the centroid guard makes the
blocking-policy refusal proof fail. Baseline, harmless comment, recorded factor
and restored cases complete. Evidence remains under
`/home/nathaniel/.local/state/openplan/native-centroid-policy-controls-20261009a`.

Native controls and their source hashes are recorded in the corresponding
`prototype/native-live-profile-controls.json` and per-case private reports.
The fixture has only two centroids and one link. A refusal test can demonstrate
the guard without proving a multi-centroid route's behavior. Parent database
responses in these controls are injected. Database transactions, nationwide
accuracy and practitioner acceptance are separate evidence boundaries.

## Remaining compressed routing work

The installed solver prepares class result arrays during execution, reconstructs
costs through `graph.set_graph`, and aggregates iteration costs through the
result crosswalk. Checking only the pre-execution `compact_cost` would miss
these later operations. `AssignmentResults.prepare` populates that crosswalk
from directed `__supernet_id__` and `__compressed_id__` columns.

The remaining comparison therefore needs connected chains, one-way links,
branches, mode exclusions, dead ends and at least three centroids. It must
check compact endpoint/forward-star structure, source-to-compact mapping,
cost aggregation and expansion of loaded flows, with targeted defects at those
boundaries. A separately computed small-network route and flow result can test
the transformation; it cannot establish observed transportation accuracy.
This describes the unresolved part of the existing modeling work, not a new
roadmap or a reduced v1 requirement.
