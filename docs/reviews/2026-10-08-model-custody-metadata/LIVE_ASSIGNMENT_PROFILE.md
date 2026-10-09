# Live assignment profile check, October 9, 2026

Initial assignment now checks the live AequilibraE wrapper and its internal
`LinearApproximation` solver before writing the input snapshot or entering
`execute`. The earlier preparation comparison checked declared profiles. This
change adds checks of the fields those declarations describe.

The check verifies installed engine version, algorithm, target gap, iteration
limit, core count, time/capacity field names, VDF function and effective alpha/beta
arrays. It checks that the internal solver retains the same traffic-class
objects, each class has the declared PCE and result core counts, and both wrapper
and solver capacity/free-flow arrays match each class graph through its explicit
supernetwork indices. Unique integer indices are required. Reordering graph rows
while preserving their indices and values remains valid.

The retained snapshot includes `live_profile_verification`, with the canonical
profile hash, installed version and scope `initial_assignment_profile_fields`.
This is not scientific acceptance or proof of every solver option. The profile
does not describe every AequilibraE setting. Prepared-network identity, demand
transformations, observation independence and calibration remain separate.

## Verification

The related worker suite passes 93 tests, including 10 new live-profile tests.
They use synthetic objects with real arrays and snapshot files. The tests cover
internal and wrapper drift, effective VDF arrays and shapes, graph values and
indices, class identity, core counts, installed-version mismatch, retained
verification metadata and harmless graph-row permutation.

Ten temporary-source controls meet their expected outcomes. Removing engine,
internal setting, field/VDF, parameter-value, network-value, class-identity or
class-core checks fails the corresponding test. Baseline, harmless comment and
restored source pass. The existing seven snapshot, eight publication and twelve
preparation-link controls also pass after this change. These object-level checks
alone do not establish native engine behavior.

Seven native engine controls use AequilibraE 1.6.2, two synthetic centroids and one
link in the existing supervised child fixture. Baseline, harmless comment and
restored cases converge and retain the verification record. Changing the internal
target gap, effective VDF alpha or effective capacity stops before the execute
marker, initial snapshot manifest and final link volumes. The failed child
reports a closed active project. Disabling the new guard lets the changed target
through, and the proof fails with `Native solver drift was not refused`.
Parent database responses are injected in this campaign.

A separate native assignment passes through real isolated PostgreSQL/PostgREST,
with 25 artifacts and confirmed initial-input registration. The six native
preparation-profile controls also pass again for both methods, using synthetic
solver objects and real transactions. They check matching profiles, harmless
formatting, changed/incomplete profile refusal and detection of a disabled
comparison. Neither database campaign establishes ActivitySim behavioral validity.

Committed reports are in `prototype/live-profile-controls.json`,
`prototype/native-live-profile-controls.json` and
`prototype/native-preparation-profile-controls.json`. Private evidence remains at:

- `/home/nathaniel/.local/state/openplan/native-live-profile-controls-20261009a`
- `/home/nathaniel/.local/state/openplan/native-live-profile-assignment-20261009a`
- `/home/nathaniel/.local/state/openplan/native-preparation-profile-controls-20261009b`

The live database assignment uses retained clone
`openplan_attempt_cli_08002c7f8e57483db170c3577e0713fd`. Temporary gateways were
removed; clones and evidence remain. No browser acceptance, normal dispatcher
activation, independent scientific acceptance or release follows from these
results. GitHub CI remains separate from local verification.

## Next boundary

Bind the prepared network to the actual assigned graph and preserve the demand
transformations between the preparation package and the final resident/external
matrices. Do not infer equivalence from profile agreement. The full v1 contract,
roadmap and independent geographic acceptance requirements remain unchanged.
