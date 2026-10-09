# Assignment preparation provenance, October 9, 2026

Initial assignment registration now includes a preparation link derived by the
parent from its confirmed command journal. The child does not select the artifact
ID. Selection is restricted to the current deployment, run, stage and attempt.
A unique matching consumption is required when one exists. A missing consumption
is recorded as `not_retained`, not as successful preparation.

Before registering the assignment snapshot, the parent validates the saved
receipt and the fixed consumer manifest, preserved producer manifest, input
bundle and every retained source object's hash and size. Wrong methods, duplicate
consumptions, changed files and invalid receipts stop registration and execution.
The resulting metadata preserves `solver_input_equivalence: unassessed`,
`preparation_independence: unassessed` and `scientific_acceptance: unassessed`.

## Verification

- The related worker suite passes 79 tests, including eight new preparation-link
  cases. Tests use real owned files and command journals with injected database
  responses and a synthetic solver. They do not prove native database behavior.
- `prototype/assignment-preparation-link-controls.json` records 10 controls.
  Baseline, harmless comment and restored source pass. Removing the method check
  alone also survives because the fixed directory check independently refuses
  the wrong method. Six targeted defects fail: omitted link, unchecked source
  bytes, unchecked document bytes, duplicate selection, unchecked receipt and
  cross-attempt selection. These controls run in temporary source copies.
- The existing eight publication controls pass again. They cover registration
  ordering, native stage identity, array bytes, uncertain-write stopping,
  duplicate channel requests and parent acknowledgment.
- A native AequilibraE 1.6.2 assignment passes through the isolated PostgreSQL and
  PostgREST command path. It uses a synthetic two-centroid, one-link fixture and
  registers 25 artifacts. A direct database read confirms the initial-input
  artifact records `not_retained` and unassessed solver equivalence. This case
  has no preparation consumption, so it proves the explicit missing-preparation
  path, not the new retained-preparation path with native transport.

The native run's private evidence is at
`/home/nathaniel/.local/state/openplan/native-preparation-link-assignment-20261009a`.
Its isolated database is `openplan_attempt_cli_d65b3ef8f42742dbb4b9d2383a57d324`.
The temporary gateway was removed; the database and evidence remain available.

## Remaining work

The registered link establishes custody. It does not establish that assignment
uses the prepared profile or network. Demand changes after package preparation,
including mode choice, gateway treatment and unreachable-zone handling, must
remain explicit. The next integration must compare the prepared identities with
the actual solver inputs and retain the transformations, rather than infer
equivalence from this link. Normal dispatcher activation, independent observation
acceptance, nationwide scientific coverage and planner acceptance remain open.

GitHub checks for the previous checkpoint were queued or running when inspected.
No merge, release or scientific claim follows from these local results. T3 still
loads OpenPlan but cannot capture the preview; browser acceptance remains open.

## Declared profile comparison checkpoint

The subsequent October 9 change compares the retained preparation profile with
the initial assignment's declared profile before registering the snapshot. It
uses `canonical_assignment_profile`, the existing worker validator, rather than
introducing another profile format. Both profiles must be complete and valid.
Their canonical engine version, algorithm, volume-delay function and parameters,
capacity/time fields, PCE, convergence limits and core count must match. Even a
tighter target is a changed preparation and is refused until deliberately
prepared again. Equivalent JSON formatting does not change this comparison.

Successful metadata records the prepared file hash and canonical profile hash
with `scope: declared_assignment_profile`. The overall solver-input equivalence
stays unassessed. The snapshot currently checks live PCE, target gap, iteration
limit and core count; this checkpoint does not newly inspect every internal
solver parameter. Network and transformed demand identity are also separate.

Verification for this checkpoint:

- 83 related worker tests pass, including 12 preparation-link tests. The new
  cases cover changed targets with matching live synthetic solver settings,
  engine/core/iteration differences, and incomplete current or prepared profiles.
- Twelve isolated link controls and eight publication controls meet their
  expected outcomes. Removing profile equality permits a mismatch and fails its
  test. Removing prepared-profile validation changes the required refusal and
  fails its test. These results do not prove native engine settings.
- Six native profile controls meet their expected outcomes. Both methods use
  real claims, completed producer stages, consumption receipts and initial-input
  artifact transactions through isolated PostgreSQL/PostgREST. Baseline,
  formatting-only and restored cases register the exact consumption artifact ID
  and matching profile digest. Changed and incomplete profiles leave no initial
  input artifact, do not call the synthetic solver and stop the writer.
  Deliberately disabling equality makes the native mismatch proof fail.

The native profile campaign uses synthetic solver objects and source inputs. It
does not execute AequilibraE or ActivitySim, prove actual engine behavior, or close
scientific acceptance. Its retained evidence is
`/home/nathaniel/.local/state/openplan/native-preparation-profile-controls-20261009a`;
the committed summary is `prototype/native-preparation-profile-controls.json`.
Each case preserves its database clone and removes its temporary gateway.

The previous checkpoint's focused GitHub worker check passed. Its live RLS job
was running and the remaining checks were queued at inspection. Those results do
not establish this new checkpoint's CI status. The next modeling boundary is to
verify the full declared profile against live solver configuration and bind the
prepared network and documented demand transformations.
