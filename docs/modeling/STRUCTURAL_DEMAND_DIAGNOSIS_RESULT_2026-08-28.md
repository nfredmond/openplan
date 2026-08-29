# Structural demand and loading diagnosis result

Date: 2026-08-28  
Release: v0.43.0  
Scientific outcome: **inconclusive**  
California capability: **partial**  
Nationwide capability: **partial**

## What this checkpoint establishes

Fourteen separate pre-output audits and post-output diagnoses were produced for
the seven registered development counties and the two frozen demand methods.
All input audits completed before any model-output bytes were opened. Each
record binds the v4 registry, unchanged v0.41 custody, exact demand package,
shared network and external layer, audit, method output, comparison basis, and
predecessor diagnosis.

The audits expose 612 major-road boundary crossings before the existing cap:
112 were retained and 500 were dropped. Across the fourteen method records,
23,336 non-centroid roadway links are structurally unreachable from a centroid
component and 942,996 are loadable. The exact matrices contain 8,989,167.69
trips in total across method records and remove zero trips as unreachable; zero
is retained as an observed result, not treated as proof that the networks are
ready. The many disconnected components, dropped crossings, connector facts,
and unloaded links remain visible in the exact downloads.

After output access, the unchanged v0.41 observation records classify as 27
loaded, 38 unloaded, 10,007 ambiguous, and 13,984 excluded across both methods;
no record is discarded because its volume is zero. The frozen files produced no
unreachable, unsupported, or missing-output observation classifications in
this run, while those categories remain mandatory in the contract.

## Evidence limits

The frozen demand packages do not establish a LODES vintage, seed coverage,
commute-share use, or fallback use, so those facts remain `unknown`. LODES is
home-to-work job-location evidence, not all-purpose travel or vehicle trips, as
described in the [Census LODES technical documentation](https://lehd.ces.census.gov/doc/help/onthemap/LODESTechDoc.pdf).
Non-work through travel remains `unsupported`; the recorded 0.35 through share
is an assumption, not measured evidence.

The diagnostic order follows the [FHWA network checks](https://ops.fhwa.dot.gov/publications/fhwahop13015/sec7.htm):
connectivity, connectors and zones, demand, external stations, convergence, and
stability are evidence to inspect. They are not permission to tune a parameter.

## Decision boundary

This checkpoint sizes structural coverage and recorded limitations. It does not
rematch an observation from residuals, calibrate a model, change a default,
rank methods, select a candidate, define acceptance criteria, or open a
holdout. AequilibraE and ActivitySim retain their exact internal matrices,
person-to-vehicle conversion where applicable, raw values, differences, and
ratios separately. Nothing here establishes improved model accuracy.

Exact study result, report, audits, comparisons, and diagnoses are under
`data/modeling/structural-demand-diagnosis-study-2026-08-28/`.
