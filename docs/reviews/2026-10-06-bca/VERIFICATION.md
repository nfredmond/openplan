# BCA workbench verification

Date: October 6–7, 2026. Worktree: `bca-workbench-20261006`, branch `work/bca-workbench-20261006`, base `b028d0e4`. The dated checks below identify their source and remaining acceptance boundaries.

## Implemented boundary

The Grants workbench retains project-bound annual input documents, current grant-edition profiles, a source register, data-gap assignments, guided time/safety/hazard arithmetic, one saved model comparison per document, monetary parameters, explicit timing/conversion, signed effects, operating costs, residual value, project elements, deterministic sensitivity and break-even analysis. Exports contain an unlocked formula workbook, annual data, full inputs/results, source register, memo, PDF/HTML report, manifest and checksums. Existing screening records and models are unchanged.

The [research note](../../research/BCA_PROGRAM_METHODS_2026-10-06.md) supplies primary sources and reuse decisions. The [original independent method review](METHOD_REVIEW.md) remains unchanged. Its three numerical defects and the horizon, source-link and table-locator findings were corrected. Original findings are not erased by their resolution.

## Isolation and recovery

The owned application ran on port 3486, with process cwd verified as the worktree's nested `openplan/` directory. The owned Supabase stack is `bca-test-stack-20261006`, API port 28421 and database port 28422. Migration `20261016000001_bca_workbench_versions.sql` was applied only there. The normal demo on port 3000 and the other agent's engagement checkout were not changed.

T3 closed during work. Source files, the research, exported package and two saved test versions survived. The first broad test process stopped and is not a passing suite. The browser was reattached, ordinary Grants navigation repeated, and both immutable versions were visible. The restarted broad suite uses an owned systemd unit so a browser-shell interruption does not end it.

The kernel later terminated the owned development preview under memory pressure. The source tree and two database versions remained intact. The owned preview and Calc service were stopped; the bounded broad-test unit continued. No user application or other agent process was closed. Subsequent heavy checks run sequentially. This interruption is not a successful server check.

## Numerical and custody checks completed before the interruption

- Independent annuity: the synthetic case has $2 million upfront capital, $327,000 annual time savings, $5,000 incremental annual maintenance, operation 2028–2047, discount epoch 2026 and 7%. BCR is 1.594052610773926 and NPV is $1,188,105.221547852.
- Federal and state BCR denominator conventions change the ratio while preserving NPV. Missing inputs and nonpositive costs suppress the headline result; adverse benefits and cost savings keep their signs.
- Residual increase/timing, dollar-unit overrides, growth/annual schedules, dollar-year conversion, model units/identities and source/profile departures have focused tests.
- Native RLS fixtures permit own-workspace staff inserts and viewer reads, deny outsiders, viewer writes, impersonation, updates/deletes, missing/mismatched project identity and duplicate UUIDs. Fixtures roll back. A harmless table comment survives. Public-read and missing-required-field mutations fail for their respective privacy/integrity defects.
- Native catalog: 758 policies, 507 permissive policies, 226 policy-bearing tables, and 280 application tables, all with RLS. The new table adds SELECT and role-aware INSERT only. The schema census and write-policy count were updated to these observed counts.
- Route tests assert selected fields, project scoping, author/exact-document replay, changed-payload conflict, unresolved recovery, assistant-write refusal and validated history cursors. These mocks do not replace native RLS or real HTTP.

The initial focused set passed 24 tests; after element reporting and schema-inventory corrections, 67 focused tests passed across five files. Later final totals supersede these snapshots. Full ESLint passed before the final parameter/report refinements; it is rerun for those changed files.

## Browser journey already observed

The T3 browser used the owned local application and synthetic account/workspace. From Overview, the journey created a project, entered Grants, opened its analysis, loaded a visibly synthetic example, saved a version and downloaded the actual ZIP through the export button. No API key or paid provider was needed.

A test wrapper dropped one POST response after the real server returned 201. The browser retained the UUID and exact document, disabled editing and offered retry. Retry returned the same version, cleared the pending state and restored editing. History contained one record for that UUID and two total saves, not three. No client-authored result was stored.

Clearing a required quantity changed BCR/NPV to `Not calculated`; loading a retained version restored the inputs. The real quantity-helper form produced 275,000 No Build and 183,333.33333333334 Build person-hours from 1,000/1,200 trips, 30/20 minutes, occupancy 2 and 250 days. Annualization remained 1, monetary value remained missing and the entered arithmetic stayed in the source record.

Desktop light and dark views and 390px results/forms were inspected. Page width matched the viewport at both 1280 and 390px. Labeled inputs and an equivalent annual table accompany the charts. Keyboard Tab moved between workflow buttons with a visible focus outline; Enter selected Evidence. This is a bounded keyboard/layout observation, not a complete accessibility audit. Console review found dev preload warnings and T3 host-startup errors; no BCA application error appeared in the observed path. A light-text/gray-background notice was corrected to use the card surface.

## Artifact checks already observed

The downloaded package contained the expected files, and every SHA-256 checksum matched. The original synthetic PDF used the actual Chrome renderer and US Letter pages. All three pages were visually inspected. Raw Markdown headings and an orphan heading were found, and the HTML/PDF rendering was corrected to semantic headings and paragraphs. The corrected final PDF has four US Letter pages. Each page was rendered and visually inspected: headings render correctly, tables fit, and no heading is stranded on its own page. The final page has unused space. Tagged output is not an accessibility conformance result.

LibreOffice opened and recalculated the formula workbook using a separate temporary user profile. BCR matched the TypeScript engine within 1e-9. Changing the real rate to 4% and calling Calc recalculation produced 2.1038870591728815, exactly matching an independent annuity. Changing the epoch to 2024 also matched the independent NPV. A plain headless file conversion initially retained stale cached values after an external edit; this is preserved as a failed check, not called native recalculation. The exporter now explicitly requests full recalculation on opening.

The Elements sheet originally retained snapshot totals. It now links monetary totals to each ledger element with exact-name formulas; source/review/status fields remain labeled export snapshots. Native Calc recalculation now agrees for both Summary and Elements: BCR 2.1038870591728815 at 4%; NPV $2,041,211.278056364 after moving the epoch to 2024. `evidence/native-workbook.json` records the downloaded package identity. All package checksums match.

## Remaining acceptance boundaries

No Cal-B/C macro was executed and no Cal-B/C numerical parity is claimed. No native Microsoft Excel session, PDF accessibility conformance, grant-agency acceptance, practicing-planner study, new traffic observation, engineering CMF/hazard validation or national model acceptance was established. The model importer is tested against explicit saved-result structures; no new real travel-model run is represented as a verified forecast. Automatic observation acquisition, pollutant-specific schedules, official Cal-B/C cell mapping and the broader M6b TDM work remain outside this increment. The exported package is not itself a grant submission.

## Mutation findings

The first expanded mutation run checked 23 cases. The harmless comment survived and 20 targeted faults failed. Two faults survived because their tests were too weak: the cursor test made both date and UUID invalid, and the HTML test checked only the absence of a literal script tag. The tests now invalidate each cursor part independently and check escaped text plus parsed heading content. The original outcomes remain in `evidence/mutations.json`; the follow-up run is recorded separately. These tests do not prove all possible input or browser behavior.

## Broad-suite findings

The bounded broad run completed 1,523 files: 1,432 passed, 85 skipped and six failed; 18,166 tests passed, 1,529 skipped and seven failed. It is not a green full suite. Failures exposed missing export auditing, locale defaults, confirmation/copy issues and the new project relation missing from deletion preconditions. These were corrected. Two failures in the unchanged Mammoth compatibility suite identify a stale installed argparse (1.0.10 instead of the lockfile override 2.0.1); a clean install and rerun follow. The corrected BCA/guard subset passes 98 tests in ten files, with 21 native-only probes skipped in that ordinary test command.

The mutation follow-up retains its harmless control and kills the corrected cursor/HTML faults, the immutable-history suggestion fault and the export-unit fault for the named test assertions. Original survivors remain preserved.

A clean `npm ci` corrected the stale installed dependency tree without changing dependency versions. All 101 tests in the post-install eleven-file set pass, including every broad-run failure. Dependency checks pass 18 vendor tests and report zero audit vulnerabilities. Full ESLint and dead-code checks pass; dead-code warnings remain advisory repository findings. The provider connector passes 387 tests with four skips. Product direction passes after aligning current-release fields to the candidate, retaining all original review dates, grades and inconclusive scientific boundaries.

The later independent recovery pass added four component regressions and a numerical edge regression. All 29 tests in the recovery/engine/copy set pass. Final mutation, production-build and browser results follow.

## Final check disposition

The source checkpoint `4f5b9ce2` was committed and pushed as PR #118. Its first production build exposed a Zod core/classic type mismatch in draft recovery. Commit `7ebdd285` corrects that type boundary; its four recovery component tests, scoped lint and full production build (including TypeScript) pass. Build checks run alone under a 7 GiB memory limit. The production preview uses a separate 2 GiB limit and its process cwd was confirmed.

The identified `7ebdd285` production browser journey confirms ordinary Dashboard/Grants navigation, incomplete-title recovery, a real 201 save followed by an intentionally lost reply, reload and exact-ID retry, and importing/replaying the retained envelope. There is one record for that UUID and three total versions. Desktop and settled/reloaded 390px views fit. Keyboard focus moves to Evidence with a visible outline and Enter displays its content. A T3 press call reports failure despite the observed activation; earlier nonexistent `/overview` navigation and dev disconnection messages are not application successes. The first image immediately after resizing was clipped during layout transition; the stable view and reload are recorded separately.

The real export button returns a 13-file package identifying `7ebdd285`. Every checksum matches. LibreOffice recalculates Summary and Elements, changed rate and changed epoch correctly, and the ledger explicitly carries quantity units and source IDs. All four final US Letter PDF pages were visually inspected. The synthetic package, PDF, screenshots and structured receipts are retained in `evidence/`. No source attachment or real client case is included.

Visual review found a minimum bar width displaying nonzero marks for zero-dollar years. The final chart change removes the minimum, with a DOM regression covering zero and proportional positive values. Its harmless control passes and restoring the old minimum fails. This changes chart width only; final rendering and current-head CI remain to be checked before merge/tag. Current check status is linked through [PR #118](https://github.com/nfredmond/openplan/pull/118).
