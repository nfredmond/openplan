# v0.43 structural demand and loading diagnosis proof

Release-source SHA: `e25ae7c928f437394fabfe71bc0208b947ae437e`

Evidence-binding commit: `2c8fe4a95040815e80f002bd6cbce5d75933a0b9`

App version: `0.43.0`

Disposition: **release candidate; browser gate passed**

## Scientific result

- Fourteen separate county-and-method audits completed before any assignment
  output opened. Fourteen post-output v3 diagnoses remain `inconclusive`.
- The exact files expose demand distribution, LODES/source gaps, all crossings
  before caps, retained and dropped crossings, route pairing, exterior
  connectivity, II/IE/EI/EE conservation, components, connectors, restrictions,
  facility coverage, unreachable demand, and loadable versus structurally
  unreachable roads.
- AequilibraE and ActivitySim retain separate matrices, conversions, values,
  differences, ratios, and downloads. No average, rank, candidate, calibration,
  changed default, acceptance criterion, or holdout was introduced.
- LODES vintage and use remain unknown where the frozen files do not prove them;
  non-work through travel remains unsupported. No v0.39–v0.42 artifact changed.

## Guard and custody proof

- A harmless no-op mutation survived. Mutations for premature output access,
  hidden gravity fallback, invented through shares, dropped crossings, swallowed
  unreachable demand, centroid-only loading, discarded unloaded records and
  links, averaged methods, and swallowed custody failure were killed.
- `test:workers`: 50 suites passed, including the shared audit and fail-closed
  worker custody path.
- `test:rls-live`: 17 files and 129 tests passed after applying migration
  `20260828000005_structural_demand_diagnosis_custody.sql`. The first run
  correctly failed because the new table was absent from the schema census and
  live command; both omissions were fixed before the passing run.
- `qa:gate`: 1,151 test files passed with 12,760 tests passed and 99 skipped,
  followed by the same 17-file live-RLS proof, zero production dependency
  vulnerabilities, and a successful production build.
- `product:direction:check` passed through 2026-09-28. Its jurisdiction-registry
  rule was corrected to preserve the exact hash-bound v0.42 registry rather than
  rewriting a released artifact for v0.43.
- Remote CI run `33240999999` passed the modeling, worker, shuffled-order, and
  full QA jobs. Remote RLS run `33240999991`, upgrade rehearsal `33238809083`,
  and live modeling-source contract `33238809039` also passed.
- Three remote failures exposed hidden assumptions rather than being rerun and
  ignored: the custody test inherited local Supabase variables, the modeling
  unit suite inherited local large study inputs, and JSZip gave auto-created
  evidence-bundle directories the wall-clock time. The unit suites now pass in
  a clean checkout, and 12 repeated evidence-bundle suites crossed timestamp
  boundaries with byte-identical archives.

## Signed-in browser proof

- From the signed-in landing page, the visible Models entry reached the v0.43
  structural diagnosis and retained the v0.40 and v0.41 history.
- The page showed seven counties and fourteen separate `inconclusive` records.
  It described structural coverage and diagnosed limitations, not improved
  accuracy. The frozen packages left LODES source history unavailable and
  non-work through travel unsupported rather than replacing either gap.
- Switching the visible Butte County record from AequilibraE to ActivitySim
  changed loaded/unloaded coverage from `3/0` to `1/2` while keeping the methods
  separate. The audit and diagnosis hashes also changed independently by
  method.
- All four audit and diagnosis downloads matched their displayed SHA-256
  values. The visible v0.41 study result and its six Butte/AequilibraE custody
  downloads also matched their published hashes.
- The diagnosis card fit at 1,600 by 900 and 390 by 844. At 390 pixels, the
  document width remained 390 pixels and the long hashes and download controls
  fit their containers. The Models journey produced no console warnings or
  errors.
- First-week job 11 was continued from a genuine baseline. A fresh visible
  AequilibraE run for Franklin County, Ohio completed all three stages and
  remained scientifically `inconclusive`: the registered observations were out
  of area and same-basis year, day, period, direction, carriageway, and vehicle
  units were not established. Franklin County is outside the seven-county v4
  development registry, so the run correctly did not invent a fifteenth frozen
  diagnosis.
- The fresh run converged at gap `0.000420` against the unchanged `0.0005`
  target after 61 iterations. It retained all 106,602 skimmable OD pairs, found
  eight external gateways but no paired cordons, and therefore routed zero
  unsupported pass-through trips. These are diagnostic facts, not calibration
  or acceptance evidence.
- Visible download requests completed successfully. One earlier request returned
  405 after the browser viewport controller desynchronized coordinates; the page
  was reloaded and the complete signed-in journey then ran without another
  failed response. This was a browser-control error, not an application route
  failure, and is recorded rather than hidden.

The browser blocker is closed. The release tag still depends on embedding this
final proof commit in the release metadata and a passing final remote CI run.
