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
