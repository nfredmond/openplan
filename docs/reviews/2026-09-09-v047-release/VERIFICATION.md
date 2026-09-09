# v0.47 release verification

September 9, 2026. Candidate based on main `ccef7e2f9ddef443679b166d35903f11c6cc6704`, isolated checkout `/home/nathaniel/.local/state/openplan/v047-release-2026-09-09`, branch `work/v047-release`. Release is not yet declared.

## Current evidence

The live development server at `http://127.0.0.1:3257` was identified by `which-openplan.sh` as this checkout. Its private synthetic database is the existing named disposable `supabase_db_m2d3-reimbursement-verification`, API 58821, database 58822, workdir `/home/nathaniel/.local/state/openplan/m2d3-verification`. No demo records were changed.

Real navigation from the landing page through Overview, Programming Cycles, the synthetic program and Administer a reporting period reached the accepted shared-cost packet. Its command version remains 8, original request 30.00, corrected request 29.00, incurred costs 37.35 and match 7.35. Both versions remain visible. Programs saved all four PDF/XLSX files to Downloads; each matches its retained digest. The original PDF downloaded again after correction with unchanged bytes. A deliberately blocked original-PDF request displayed Failed to fetch; removing that task-owned network block allowed the exact original bytes to download again.

At 390px both document and viewport widths were 390. Enter activated the download and Tab moved to the next control with visible focus. Default screenshot capture timed out at this width; a supported clipped screenshot captured the actual 390 by 844 viewport. Temporary viewport and network overrides were cleared.

Ordinary Documents PDF and XLSX link navigation reaches ERR_BLOCKED_BY_CLIENT. A non-truncated Network.loadingFailed event reports blockedReason inspector for the Document request. This establishes a browser-tool navigation block, not an application failure. The supported downloadMedia operation returned without an inspectable saved file. No security headers, browser security settings or tooling policy were changed. Isolated Playwright verification has been requested because the connected tool requires explicit authorization for alternative UI automation.

## Local checks

- Full QA gate passed: lint, dead-code analysis, 13,430 tests across 1,228 passing files, production dependency audit with zero findings, and webpack production build. 221 tests in 32 files were explicitly skipped in the ordinary test run.
- Live isolated database suite passed all 250 tests across 39 files.
- Worker suites passed all 52 suites; no failed or unrun suites. The first worker invocation used the repository root and executed no suite; the corrected invocation ran from `openplan/`.
- Existing main CI and RLS both report success for the full initial SHA. Final release commit CI and upgrade checks remain pending.

## Release preparation and controls

The candidate version is 0.47.0. Its changelog lists all 28 additive migrations after v0.46, and the release-ordering table records 307 migrations through 20261003000001. The package version does not declare a release. The stale roadmap audit statement is corrected against the completed HISTORY_REVIEW.md record.

The first candidate-wide rerun caught two omitted version fields in the capability matrix and registry. Both version fields were aligned to v0.47.0 without changing review dates, evidence or capability ratings. That failed run is not counted as passing candidate QA.

Thirty focused ordering/download-route/checksum tests passed. The first focused invocation mistakenly ran from the repository root and discovered no runnable suites. The corrected package-root run then caught date-prefixed changelog labels that did not satisfy the exact migration slug check; the labels were corrected without weakening the check. Release-ordering controls accept a harmless SQL comment, reject a migration moved below v0.46's high-water mark, and reject a missing changelog migration reference. All temporary inputs were restored. The guard cannot assess SQL semantics or data preservation.

[Programs file receipts](programs-downloads.json) record all four delivered files plus two unchanged original-PDF retries. Its independent checksum comparison accepts an irrelevant annotation and rejects an incorrect expected hash. It establishes byte custody, not agency usefulness. [Desktop](programs-desktop.png) and [390px keyboard focus](programs-390.png) are identified development-build captures, not final production-build evidence.

## Remaining work

Finish Documents file saving and final production desktop/390px acceptance, private-access and interrupted retry evidence. Align version/changelog/release ordering, run harmless and targeted controls for changed guards, inspect final CI/upgrade, then tag. The pending reminder CHECK change remains untouched. M11 PM/finance usefulness, prescribed agency forms, actual authority and automatic reminder delivery remain unproved.

After the release, continue M2d.4 in Programs using existing work-program baselines, reimbursement reservations and shared cost identities. Carryover must preserve predecessor history and cannot duplicate expenses, treat accepted claims as cash, or turn unresolved commitments/refunds into zero. The roadmap remains the sole queue.

## Production verification and hover correction

The explicit `qa-process-result.json` receipt records exit 0 for the complete local gate at `f5dda94d757b2c12127a5695318e62befa1c7875`. Two earlier combined tool sessions ended with exit 143; their component logs are not counted as clean gates. The successful rerun used a subprocess result written to disk. The production identity check matches version 0.47.0, that full SHA and the isolated checkout.

The production browser journey repeats real navigation and all four Programs downloads. Desktop and 390px screenshots retain both packet versions, keyboard focus and no horizontal overflow. Console inspection after the production navigation found no warnings/errors. Authenticated HTTP checks of ordinary Documents endpoints return all four exact files without bearer redirects; anonymous callers receive 401 and another-workspace owner receives 404 for both metadata and bytes. History remains two packets and eight events. This does not complete native Documents browser saving.

The production desktop screenshot exposed pale-green download labels on an almost-white hover background. A DOM style inspection confirmed text rgb(168,217,184) and background color(srgb 0.954196 0.982118 0.976784). The reimbursement download buttons now reuse the neighboring report controls' background/foreground hover classes. This bounded styling change preserves download and authorization behavior; its final render is checked separately below.

## Latest checkpoint

Application build `64bd60632ccbc030755efd91c4898889923ca9da` passes targeted ESLint and a production webpack build with explicit exit 0. `which-openplan.sh` matches the full SHA, version and isolated checkout. The [final desktop capture](final-desktop.png) shows the hovered download label readable; [390px keyboard capture](final-390.png) shows the focus indicator and stacked controls. Two computed-style reads timed out in the connected tool, so the final visual conclusion uses the inspected screenshot rather than inventing numeric contrast measurements. No new styling test was added for this reversible class correction. The final [console record](final-console.json) contains no warnings/errors. Temporary viewport and request-blocking overrides are cleared.

All four Programs downloads were repeated on this build. [File receipts](final-downloads.json) confirm every saved copy still matches retained bytes, including the original after correction and narrow-layout retries. [HTTP access checks](http-results.json) on this build again verify private metadata and bytes for owner, anonymous and foreign-workspace callers. [Shared-source custody](shared-source-custody.json) retains the exact original/corrected hashes, two source reservations and eight events.

GitHub's [populated v0.46 upgrade](https://github.com/nfredmond/openplan/actions/runs/34390581395) passed at `adcda972`; no migration changed afterward. [Live RLS](https://github.com/nfredmond/openplan/actions/runs/34390802433) passed at `f5dda94d`. The application changed afterward only to fix button hover classes. CI and RLS for `64bd6063` are still running at this checkpoint and must be inspected before release. The evidence commit following this application build adds only verification records.

**Release remains untagged.** Draft [PR #111](https://github.com/nfredmond/openplan/pull/111) preserves the candidate. Native Documents downloads remain blocked by the connected browser's inspector. The user has been asked to authorize the repository's Playwright harness with a separate Chrome test profile because the computer-use tool requires explicit authorization for another UI automation method. There is no answer yet. No app security header or browser security setting was weakened. M2d.4 has not been implemented while this release boundary remains open.
