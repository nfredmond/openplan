# v0.44 distributed work loading proof

Release-source SHA: `a7c2afa71debdf3d61af8fe3967d8198e4f4ae09`

App version: `0.44.0`

Disposition: **release candidate; final gates in progress**

## First-week interruption gate

- The pre-implementation twelve-job run completed every job from visible entry
  points. Nine outcomes were reached fully and three partly; none failed or
  blocked. Evidence is retained under first-week run
  `2026-09-01T03-36-34-705Z`.
- That run found one consequential defect: a honeypot-filtered engagement
  submission returned resident-facing success without storing a comment. The
  route now returns an explicit filtered state. A focused mutation reproduced
  the false receipt and failed, and live rerun
  `2026-09-01T05-52-38-788Z` completed without a pending consequential claim.
- Six lesser continuity and clarity findings remain queued as
  `KI-2026-08-31-011` through `KI-2026-08-31-016`. They did not interrupt the
  modeling lane because none proved data loss, false consequential output,
  tenant-isolation failure, or an unreachable required workflow.

## Scientific boundary and source custody

- The instrument binds the exact 2023 Census LODES 8.4 OD, RAC, WAC,
  crosswalk, and documentation bytes. LODES is used only as home-to-work
  evidence; it does not support non-work, all-purpose, or vehicle-trip claims.
- Each method retains its frozen total and its unchanged non-work demand.
  Source-covered work endpoints are distributed to block-supported routable
  access points. Access points aggregate only at the same routable node, with
  no point, gateway, runtime, or jurisdiction cap.
- Covered, explicit-zero, suppressed, unavailable-source, unmapped,
  unroutable, and missing-pair states remain distinct. Unroutable demand is
  retained at the original centroid rather than moved or dropped.
- The seven counties are the unchanged v0.39 development partition. Three
  frozen ActivitySim inputs have legacy paths containing `holdout`, but those
  agreement-study partitions were consumed before v0.39 and then frozen as
  development inputs. The registry says this explicitly; no prior gateway
  outcome was used for candidate selection and no acceptance holdout opened.
- AequilibraE and ActivitySim remain separate. The instrument does not tune,
  rematch, average, rank, change a default, or alter a v0.39-v0.43 artifact.

## Assignment-blind and interruption proof

- An initial candidate run was rejected after thirteen assignment summaries
  exposed AequilibraE 1.7.0 while the pre-output audits bound the frozen 1.6.2
  assignment profile. No comparison or study result was produced. The runner
  now refuses that drift before writing any audit or assignment output and also
  validates every completed or resumed summary against the exact bound profile.
  The 1.7.0 container fails closed; the retained 1.6.2 runtime matches SHA-256
  `5fcab976e435801f5a04d7f6b37e467850cbcc7d1f650e7cf8c13f625d565157`.
- Two corrected preparation runs used the exact release-source SHA and fixed
  creation time. All fourteen inputs and fourteen pre-output audits were
  byte-identical before assignment output access.
- The corrected run was interrupted during Butte/ActivitySim and resumed. The
  completed Butte/AequilibraE summary retained SHA-256
  `8be2fe201675c4bfab18c443eefbbec11d08ba987df5c88ca63e8a32032aded3`
  and exact modification time `2026-09-01 02:25:58.346916286 -0700`. Its
  receipt remained
  `01b548dc256f3530e027aaadccd2ccd233e7041be2afe57b16bed71ea6d73eeb`,
  and its link volumes remained
  `879a45d5063a088542aa7645d9ce47fbb2e675368871fbdfc24269b126284ada`.
  The reused assignment converged after 28 iterations at gap
  `0.0004940020177109491` under the bound 1.6.2 profile.

## Guards already proved

- The deliberate no-op mutation survived. Premature output access, changed
  source bytes, missing load-point demand, swallowed unroutable demand, method
  averaging, county-stratum rescue, holdout access, and unauthorized default
  promotion each failed for its stated reason.
- `scripts/modeling/tests/test_distributed_work_loading.py`: 9 tests passed,
  including urban, rural, border, coastal, mountain, zero-job,
  unavailable-source, and non-California fixtures without hardcoded
  jurisdiction behavior.
- `test:workers`: 50 suites passed. The focused app migration, release-order,
  card, report, and assistant tests passed 103 checks.
- A broad app run exposed four integration regressions before release. Three
  page suites did not declare the new filesystem loader's server-only boundary,
  and one visible download label increased the guarded count of the internal
  word `input`. The test boundary and plain-language label were corrected; the
  focused rerun passed all 40 affected checks. The same broad run also failed
  on the intentionally missing v0.44 product-direction review, so it is not
  counted as a passing release suite.
- With only the deliberately incomplete published-study loader and
  post-checkpoint direction-review guard excluded, the app suite passed 1,152
  files and 12,764 tests; 11 files and 102 tests were explicitly skipped. The
  unexcluded final suite remains the release gate.
- The complete local live-RLS command passed 18 files and 132 tests after its
  own global schema census exposed and forced repair of a missing new-table
  inventory entry. Both migrations are applied locally through
  `20260831000002` without a reset.
- TypeScript, lint, dead-code policy, and the production dependency audit pass;
  the audit reports zero production vulnerabilities.

## Published development result

- All fourteen assignments converged under AequilibraE `1.6.2` and the exact
  profile digest
  `5fcab976e435801f5a04d7f6b37e467850cbcc7d1f650e7cf8c13f625d565157`.
  Recorded runtimes range from 46.84 seconds to 2,335.35 seconds. The uncapped
  Tulare assignments took 2,335.35 seconds for AequilibraE and 989.32 seconds
  for ActivitySim, so they could not safely run in a serverless request.
- Demand conservation and identical source/network custody passed for every
  county and method. The methods were evaluated separately. Seven method
  records met every local development gate and seven were published unchanged
  and retired. Because a county/method failure cannot be rescued by another
  method, county, or national total, the whole candidate did not advance.

| County | AequilibraE | ActivitySim | Recorded gate reason |
|---|---|---|---|
| Butte | retired | retired | Observed-link reach did not improve. |
| Madera | advanced | advanced | Every development gate passed. |
| Merced | retired | advanced | AequilibraE worsened a registered road-class stratum. |
| Monterey | advanced | advanced | Every development gate passed. |
| Nevada | retired | retired | A registered road-class stratum worsened for each method. |
| San Benito | advanced | advanced | Every development gate passed. |
| Tulare | retired | retired | A road-class stratum worsened for each method; ActivitySim also worsened the county stratum. |

- The exact comparisons retain baseline and candidate loaded/unloaded counts,
  road-class coverage, county strata, and every raw observation residual. They
  are not averaged or reduced to a national score. The top-level result is
  `inconclusive`, `candidate_advanced: false`, `defaults_changed: false`, and
  `holdout_accessed: false`.
- `verify_distributed_work_loading_study.py` independently checked all 42
  logical artifacts and their stored bytes, both release meanings, all
  conservation and custody bindings, every runtime profile, county/method
  separation, report coverage, and the overall disposition. A deliberately
  wrong release SHA failed before the correct release passed.
- The verifier initially made two incorrect assumptions: it conflated the
  input's Census `source_release` with the audit's OpenPlan `release`, then
  required FIPS identifiers in a report that deliberately names counties in
  plain language. The check was corrected to compare the full Census release
  to the source registry, the exact input artifact to the audit binding, and
  all seven registered county names to the report. This changed no study byte
  or scientific result.
- A second `--resume` publication rebuilt the frozen inputs and audits, reused
  all fourteen completed assignment receipts, and reproduced all 44 published
  files byte for byte. The app loader independently opened and hash-checked all
  42 downloadable artifacts. Its release-SHA assertion passed, failed under a
  deliberate wrong-SHA mutation, and passed again after text restoration.

## Visible release journeys

- The published model-evidence journey was completed from visible Travel
  modeling navigation at desktop and 390 pixels. All 42 v0.44 artifacts were
  downloaded and independently hashed in the browser; every hash matched the
  exact 64-character identity on screen. Both methods and all seven counties
  were exercised, the console recorded zero errors, and the narrow layout had
  no horizontal overflow.
- The corrected release rerun completed all twelve first-week jobs with twelve
  outcomes reached, zero partial outcomes, and a passing outcome gate. The
  retained run is `2026-09-01T11-06-18-597Z`. The corridor journey saved and
  explained the exact four-run comparison without combining methods. The
  land-use journey completed review, exercise-only adoption, publication, and
  progress reporting without making a legal-sufficiency claim.
- One evidence-complete usability finding remains queued as
  `KI-2026-09-01-019`: an identical existing GIS layer can be reused, but the
  Data Hub does not yet offer an exact-label re-upload as a new version. The
  required workflow remained reachable, so this is not a release blocker.

The complete QA gate, remote CI, upgrade rehearsal, and release tag are
recorded here only after they complete.
