# Draft custody and readable model evidence

Release acceptance remains failed. The complete twelve-job run
`2026-09-06T04-23-28-412Z` used clean, pushed `bd86562585fc1504148826275d2aa94fd0b9deca`.
Ten outcomes were yes. Job 05 completed partly; job 11 reached the 1,800-second
execution limit and ended with SIGKILL, not a completed outcome. Every job had
zero unexpected browser console errors. Raw reports, findings, downloads and
the timeout remain unchanged. No v0.44.0 tag is authorized by these results.

## Corrections

Saving one land-use section refreshed every editor and discarded other unsaved
work, including newer typing in the submitted section. Local draft state now
tracks the submitted snapshot independently of subsequent edits. Refreshes
update clean fields, preserve dirty fields within the same plan/version/state,
and reset when that scope changes. Failed writes never acknowledge drafts.
Unsaved content is labeled and blocks freezing. This is not autosave, browser
crash recovery, persistence across navigation, or multi-user conflict resolution.

The evidence-bundle picker falsely said the required GeoPackage excluded crash
and engagement records. Its existing producer automatically includes available
fatal/serious-injury crash locations and eligible approved public engagement
locations. The picker now discloses those records before confirmation, states
that optional-file checkboxes do not exclude them, and points to the exported
layer-status inventory. Collection, eligibility and export bytes are unchanged.

The published v0.40 Models card had no in-page detailed explanation, even though
the exact frozen diagnosis files existed. It now reuses the current-run
explanation component and lets users select each frozen county and method.
The loader checks source bytes and identity before rendering. Categories,
counts, unknown facts, recorded comparison-basis facts and the complete hash
come from that selected file. The card explicitly distinguishes historical
evidence from current workspace runs. Missing counts remain unavailable, not
zero; conflicting ledger statuses remain visible. No new write route is added.

The distributed-loading card now prints the exact selected artifact filenames
beside its hashes. Current-run assessment hashes are no longer abbreviated.
These two related findings prevented direct exact-evidence comparison.

## Verification at the code checkpoint

Focused tests passed 133 checks across 23 files; two live tests were skipped in
that ordinary invocation and are not isolation evidence. TypeScript and focused
lint passed after correcting an optional hash prop and an unsupported test
query option. The first corruption-test mock did not intercept Node's default
file-read export: fourteen negative cases wrongly received untouched files.
The mock now intercepts both exports, and all fifteen source-custody tests pass.

The corruption checks replace reads only, never committed scientific files.
Thirteen deliberate loader guard removals each fail for the expected altered
bytes, outside-directory access, wrong schema/geography/method/outcome,
averaging, changed matches, calibration, candidate selection, claim promotion,
acceptance rule, or holdout flag. A comment-only mutation survives. The real
loader-to-card test selects all fourteen records and checks their findings,
hashes and downloads. Removing its explanation, breaking selection or changing
the download fails; its no-op survives. Removing each of three exact filenames
or truncating each of five assessment hashes fails the relevant UI assertion.

Earlier isolated checks retained beside this checkpoint prove draft preservation,
save acknowledgment, scope reset and freeze/readiness guards with fifteen
actual-workbench tests and eight targeted mutations. The first premature-save
mutation survived because another dirty field masked the defect; a single-dirty
field case now catches it. Six disclosure mutations and nine shared-explanation
mutations fail, with harmless controls surviving. Their logs retain exact failure
reasons. None of these component checks proves browser layout or live isolation.

The original draft loss was also reproduced from visible navigation at 1440px
and 390px. The test used actual saves on an explicitly synthetic, UI-created QA
plan and delayed only delivery of the real server response. Expecting preserved
typing on the old build fails. Corrected-build browser checks, full QA, workers,
live isolation, upgrade rehearsal and exact-commit remote checks are still
pending at this checkpoint. The old four remote checks succeeded on bd865625;
that is not evidence for these changes.

Local evidence is retained under
`~/.local/state/openplan/release-checks/v044-2026-09-05/`, including
`corrections-*`, `correction-mutation-*`, `draft-loss-original-browser-scoped/`,
`draft-retention-original-negative/`, `landuse-draft-regression-ntk7Ww/`, and
`geopackage-disclosure-tMGxLD/`. `CURRENT_FINAL_CANDIDATE.md` identifies the
continuation point. These logs include failed helpers and controls, not just
successful runs.

## Remaining boundaries

The distributed-loading candidate stays failed, retired and inconclusive.
Frozen v0.39-v0.43 evidence, production defaults, scientific acceptance rules
and untouched holdouts are unchanged. Job 05's unsupported forecast is not
repaired by hiding that limitation. Any later full outcome run must retain the
same success rule. A larger explicit execution budget for the evidence journey
may avoid its observed timeout, but does not convert the old timeout into a pass.

The current product-direction review is not replaced by this corrective work.
A fresh direction packet and the complete first-week outcome gate remain
required before release advancement.

## Broader-check follow-up

The pushed correction is `2d90a31d`. Its local and remote direction gates
correctly reject the older review. Fresh independent reviews were requested
under the existing protocol, with separate read-only ownership and scratch
reports. No review date or independent-context count was fabricated.

All 51 worker suites and 135 local live-RLS tests passed. Remote RLS also
passed on 2d90a31d. The broader app suite found two follow-ups besides the stale
direction review: the new fallback sentence increased the existing jargon
counts, and a clipboard cleanup test observed rendered state before its React
effect scheduled the timer. The sentence now uses plain language without
changing the ledger baseline. The test waits for actual timer creation before
checking unmount cleanup. Removing scheduling or cleanup fails the respective
assertion; a harmless control passes. Twelve focused follow-up tests pass.

An accidentally duplicated full test invocation wrote to the same log as the
first. The duplicate's explicitly identified process group was stopped. That
mixed log is retained as an execution error, not final full-suite evidence.
A fresh single-run log remains required. The first production build completed,
but it predates final review binding and is not corrected-browser acceptance.

Reviewer B reported accidentally printing the synthetic first-week account
credentials while reading the raw manifest. They are not copied into repository
records. Subsequent reads project non-sensitive fields only. No credential or
external-service state was changed. This was a review-tool handling error,
not an application isolation finding.

## Corrected-build verification, c4f76eb0

This section supersedes the pending technical/browser status above, not the
failed first-week outcome. The clean, pushed build
`c4f76eb02ae88a8977a22012604e8f89980cbbe3` passed the full local `qa:gate`:
13,039 app checks, 135 live-RLS checks, lint, dead-code gate, production audit
and production build. The ordinary app invocation skipped 105 checks; they are
not counted as passes. All 51 worker suites passed. The full dependency audit
still has ten development-only advisories, including two high and six moderate;
production has zero. This does not close dependency issue 046.

The frozen-study verifier checked all 42 artifacts, release bindings, demand
conservation and custody again. A wrong expected release hash fails with
`study result release binding changed`. No frozen source was edited. Its first
invocation used an unavailable `python` alias and exited 127; `python3` ran the
actual checks. That failed invocation is not counted as a rejected mutation.

The identity checker matched the corrected build on port 3200 before browser
work. From the front door at 1440px and 390px:

- The UI-created, explicitly synthetic draft-retention plan preserved newer
  section typing and an unsaved policy through a real section save. The status
  remained unsaved and freezing remained disabled. Reload confirmed that only
  the submitted section snapshot reached storage, not later typing or the
  unsaved policy. There were two explicit QA content writes and no errors.
- All fourteen frozen diagnoses were selected at each width. Their categories,
  counts, unknown facts and full hashes matched the committed sources. All
  fourteen distributed county/method selections exposed the exact filenames
  and hashes. The browser downloaded their 42 files and fourteen diagnoses at
  each width, plus the current assessment at each width: 114 downloads total,
  each checked against its expected hash and size where recorded.
- The current assessment's two available hashes are fully visible and match
  its immutable download. Three additional network-state hashes do not exist
  in this actual assessment and were not invented. The existing narrow run
  column is still cramped; issues 054/069 remain open.
- The project Evidence tab opens the bundle review with the actual automatic
  crash/engagement inclusion and checkbox limits disclosed before confirmation.
  Confirmation stayed unchecked and freezing disabled. No bundle was created.

The evidence journey and four supplemental middle-category views made zero
writes and had zero console/page errors. The main agent inspected all 28 final
screenshots: eight draft views, sixteen main evidence views, and four category
views. These are representative visual checks, not nationwide capability proof.

The first evidence-helper attempt verified 112 files, then stopped because it
expected the other route's hyphenated current-assessment filename. The actual
generic artifact route serves `model_validation_assessment.json`. Correcting
only that helper expectation produced the complete 114-file run. The first
failed proof remains retained. An intentionally wrong build identity also fails
before the helper opens the browser. No acceptance result was rewritten.

Final local proof paths, relative to the existing release-check directory:

| Evidence | SHA-256 |
|---|---|
| `corrections-bound-qa-gate.log` | `5fc5a7ba13e53c51597e631dadb266e720e1adbde3d2cbfd9790f7f7c127367a` |
| `draft-retention-corrected-browser/proof.json` | `3652099bfb85c6cb00b779a66b40af412709ae9aede87525d473b4bf7d1ab827` |
| `corrected-evidence-browser-native-filename/proof.json` | `9cdbbda02e7dfca51ea5674ffa84b7be1abbd4f5bd285323d410d5657bd1519c` |
| `diagnosis-middle-browser/proof.json` | `c1d81489a549c002f1356d9cfe4aceb2439f4c522a0a65366c76b0c34fe6024c` |

Exact-c4f76eb0 remote RLS `34019632152`, Upgrade Path `34019643618` and
QA Harness Nightly `34019644839` succeeded. CI `34019632158` was still running
its full gate and shuffled suite when this section was written. Do not infer
its outcome from the other checks or the push response.

The original full12 remains failed. No replacement full12 has run on this
corrected build, no release tag has been created, and job 05's forecast remains
unsupported. The completed UI correction is not scientific validation or release
acceptance. The fresh direction review preserves that boundary and both
independent recommendations for subsequent work.
