# v0.43 structural demand and loading diagnosis proof

Release-source SHA: `48fec76789b755f24cde7846dc2ae786eeee0de5`

Evidence-binding commit: `69a60bf6210c6ae7ddf3771a4d49c09efb82ce4e`

App version: `0.43.0`

Disposition: **release candidate only; tag withheld**

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
- Remote CI run `33239057013` passed the modeling, worker, shuffled-order, and
  full QA jobs. Remote RLS run `33239057003`, upgrade rehearsal `33238809083`,
  and live modeling-source contract `33238809039` also passed.
- Two earlier remote failures exposed test isolation defects: the custody test
  inherited local Supabase variables, and the modeling unit suite inherited
  local large study inputs. Both now pass from a clean checkout; neither failure
  was suppressed or reclassified.

## Remaining release blockers

- The browser controller reported no available browser. Therefore the required
  signed-in first-week job 11, desktop and 390px visual inspection, method
  switching, real downloads, overflow check, console review, and failed-response
  review are not proven in this session.

No `v0.43.0` tag may be created until that blocker passes. This file records an
honest safe landing point; it is not a release claim.
