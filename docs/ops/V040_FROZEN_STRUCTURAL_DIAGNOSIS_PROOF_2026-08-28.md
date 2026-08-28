# v0.40 frozen structural diagnosis proof

Date: 2026-08-28

Release source: `25f024ce1065c88ff0352eebb0ff49e52675e869`

Published candidate: `20e1bae6d7e975d1aee4041e740a664038626c2d`

Disposition: implementation and scientific study complete; release tag withheld
until the published Models card and its exact downloads are exercised in an
authenticated browser session.

## Scientific result

All fourteen frozen county/method assessments remain `inconclusive`. The study
preserved the v0.39 network, observation, match, model-output, comparison-basis,
assignment-profile, and assessment bytes. It did not rematch observations,
calibrate either method, average or rank methods, select a candidate, create an
acceptance threshold, change defaults, or open a holdout.

The exact study result is
`data/modeling/model-validation-structural-diagnosis-2026-08-28/study-result.json`
with SHA-256
`014b5f6cf5ddf35d1c02d81228734f9669c03bc9184464eca53c3243062283f8`.
The corresponding study report SHA-256 is
`7573a28ccf3c1b90993c39a3468d2bfe9ae92f26dddf9bdb967b76948e073dde`.

## Checks that could fail

- The frozen-study verifier passed all seven counties and fourteen separate
  method records. A diff against `v0.39.0` confirmed the frozen matcher is
  unchanged.
- The mutation harness first retained a harmless comment. It then killed
  mutations that opened outputs early, changed a frozen match, used centroid
  geometry alone, dropped zero-volume or absent-output records, invented a
  model year, accepted changed link IDs, or averaged the methods.
- Worker suites passed 49 of 49 tests. The modeling CI partition passed 83
  suites. A broad single-interpreter discovery was also attempted and failed
  before relevant tests because the AequilibraE environment does not contain
  the ActivitySim worker's Flask dependency; the repository's isolated worker
  and modeling partitions are the valid runs.
- `npm run qa:gate` passed 1,139 application files and 12,716 tests, with 8
  files and 94 tests skipped by declared conditions. Live RLS passed 15 files
  and 124 tests. The dependency audit reported zero production
  vulnerabilities, and the production build generated all 127 pages.
- Remote RLS Isolation run `33204096373`, CI run `33204096394`, and the
  explicitly dispatched `v0.39.0` to current Upgrade Path run `33204344711`
  passed on the published candidate. The CI matrix included the full QA gate,
  shuffled-order application tests, and separate worker, modeling, and
  operations Python suites.

## Browser evidence and remaining gate

From the signed-in landing page, visible navigation reached Models. At desktop
and 390 px widths the page matched the viewport without horizontal overflow,
and the console contained no errors or warnings. Those checks occurred before
the final published-study card was added. The available signed-in workspace
also had no completed frozen-study run, which exposed the reachability defect
that the published card now fixes.

The card, responsive layout, authenticated route, exact response bytes, and
hash response header have focused component and route coverage. They have not
yet been exercised together in a signed-in browser because the browser session
was signed out and entering the local test-account password requires explicit
action-time approval. This proof does not substitute component tests for that
missing planner journey. `v0.40.0` therefore remains untagged.

## Capability boundary

The completed diagnosis establishes structural findings, not California or
nationwide model accuracy. Both capability rows remain `partial`. A new,
versioned observation-and-match instrument, a preregistered use-specific
acceptance rule, and an untouched holdout remain later checkpoints.
