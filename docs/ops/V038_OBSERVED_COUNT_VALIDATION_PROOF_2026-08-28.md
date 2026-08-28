# v0.38 observed-count validation proof

Date: 2026-08-28

## Planner outcome

A signed-in planner followed the normal visible path from **Overview** to
**Travel modeling**, opened a project baseline, launched the AequilibraE run,
read the rules-v4 assessment, and opened **Model Validation Assessment** from
the run artifact list.

The exercised local run was
`5a634c5b-31b7-46a5-af21-6d8f8ccc48d1`. Its scientific outcome was honestly
`inconclusive`: the available legacy point-count rows did not establish the same
base year, day, period, direction, carriageway, and vehicle/PCE basis as the
model output. The UI did not promote its older daily/24 or generic K-factor GEH
diagnostics into the claim decision.

The first attempt failed closed during artifact extraction because the worker
passed a string where the comparison-basis contract required a structured
engine identity. The interface and regression test were corrected, and the
same run was relaunched from the visible **Relaunch worker run** control before
this proof was accepted.

## Custody and byte proof

The local database custody row recorded:

- custody id: `598c3946-ec30-4bbc-9701-0f37ed7af6aa`
- validation rules: `4`
- outcome: `inconclusive`
- comparison-basis SHA-256:
  `0aab85525663e69cbb3913dce8ecc7b3dc12f48583ee25f46840e62fa5cdc61f`
- assessment SHA-256:
  `0f5c25496d14ac7a7586b147ee25da819e760971b2b169d5cba29a559648c724`

The downloaded/local assessment and basis bytes produced those same hashes.
The custody row binds the exact model-output, validation-input, basis, and
assessment artifacts.

## Browser proof

- Desktop: assessment outcome, reasons, hashes, completed stages, and artifact
  download were visible together.
- 390 px: the assessment remained readable and the document width stayed at
  390 px with no horizontal overflow.
- Console: no errors. One Mapbox/Next development hot-reload warning reported
  that a style was still loading and was rebuilt from scratch; no production
  exception or failed request appeared.

## Mutation proof

The focused suites passed before and after the mutations. Each harmful mutation
was applied alone and restored by editing the exact text back.

| Mutation | Expected result | Observed guard |
| --- | --- | --- |
| Ignore a day-basis mismatch | killed | incompatible-basis test failed because the mutant returned `pass` |
| Treat unproved PCE as vehicles | killed | incompatible-unit test failed because the mutant returned `pass` |
| Promote Grade D into decisive metrics | killed | Grade D coverage/decision test failed |
| Fabricate generic percentage bounds | killed | unknown-bounds metric test failed |
| Drop unloaded observations | killed | unloaded-retention test failed |
| Mark the two model methods as averaged | killed | ActivitySim/AequilibraE agreement metadata test failed |
| Restore first-subdivision source selection | killed | multistate adapter-plan test failed |
| Swallow immutable evidence-write failure | killed | custody-failure test failed |
| Omit the first-week run's build identity | killed | harness manifest test failed on the missing Git SHA/app version stamp |
| Change one module-docstring phrase | survived | focused rules-v4 suite stayed green, as expected for a harmless mutation |

## Release gates

- `npm run qa:gate`: passed.
- Product direction: current through 2026-09-25 for v0.38.0.
- Application tests: 1,135 files passed; 12,708 tests passed; 7 files and
  91 tests skipped by their declared conditions.
- Live database isolation: 14 files and 121 tests passed, including the
  dedicated assessment-custody probes.
- Production dependencies: zero reported vulnerabilities.
- Production build: compiled, type-checked, and generated all 127 static pages.
- Worker tests: 49 suites passed.
- Disposable restore drill: all 237 migrations restored, artifact hashes and
  relationships matched, live RLS passed, and the drill reported `PASS`.

The final route regression repair also proved that an unavailable optional
subdivision resolver freezes an explicit `unresolved` geography state instead
of crashing the run. The separate project tract-readiness check still blocks a
launch when the project cannot be modeled.

## Scientific boundary

This release does not validate California or nationwide model accuracy. The
California instrument-readiness audit remains development-only and found no
county/method pair ready to open. The capability matrix therefore remains
`partial` until an untouched, use-specific acceptance study exists.
