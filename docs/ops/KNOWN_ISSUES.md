# OpenPlan known issues

**Reviewed:** 2026-09-05 against the v0.44.0 candidate.
This is a quality-boundary register, not a development queue. Scheduling lives
only in `docs/ROADMAP.md`.

## Open watch items

| ID | Severity | Boundary | Current disposition | Evidence |
|---|---|---|---|---|
| KI-2026-09-05-025 | High | Fatal-only acquisition filters displayed injury categories as zero, and import history described requested years as crash years. | Corrected in code and focused tests; clean-checkout browser verification remains required. Missing national injury coverage remains a capability gap, not zero. | Diagnostic first-week run `2026-09-05T02-17-34-837Z`, job 04, f1; `safety-workspace.test.tsx`; `an-import-says-what-area-it-covered.test.tsx` |
| KI-2026-09-05-026 | High | A report's Evidence tab exposed legacy run prose and scores that its PDF correctly withheld. | Both consumers now share the same disclosure function, and the page reads the source metrics. Clean-checkout browser verification remains required. | Same diagnostic run, f3; `report-saved-summary-disclosure.test.tsx`; `report-detail-page.test.tsx` |
| KI-2026-09-05-027 | Medium | A transient upstream response prevented crash-location ranking while totals loaded. Retrieving again restored it. | Queue a ranking-specific retry that does not require another acquisition; retain the explicit failure state. | Same diagnostic run, f2; server event `safety_ksi_concentrations_unavailable` at 02:22:26 UTC |
| KI-2026-09-05-028 | Medium | A report summary over its accepted length receives a generic invalid-payload error without identifying the field or limit. A shorter summary saved. | Queue field-specific validation and a visible length limit; do not discard the draft. | Same diagnostic run, f4; 2,190 characters rejected, 1,499 saved |
| KI-2026-08-24-001 | High | County and dual-demand outputs remain screening evidence. v0.41 repairs stable observation identity, signed TMAS coordinates, complete HPMS section geometry, full-geometry matching, and direction aggregation, but the result is synthetic expanded daily traffic rather than AADT. The model base year remains unknown and no use-specific acceptance rule was frozen. No untouched evidence supports a corridor, California, or nationwide accuracy claim. | Keep caveats, claim tiers, both model values, and negative studies intact. Treat the repaired coverage as an instrument result, not improved accuracy. Address demand and loading defects, then freeze a use-specific rule before opening an untouched holdout; do not average methods or change defaults from these diagnostics. | `data/modeling/comparable-observation-study-2026-08-28/study-report.md`; `docs/modeling/MODEL_VALIDATION_STRUCTURAL_DIAGNOSIS_RESULT_2026-08-28.md`; `docs/modeling/ACTIVITYSIM_RUNTIME_GAP.md` |
| KI-2026-08-24-002 | High | ActivitySim can execute, but the available stock behavioral coefficients were estimated for another region. A locally fitted population does not make those choices locally calibrated. | Name coefficient provenance and keep output below locally validated claim tiers. | `docs/modeling/ACTIVITYSIM_RUNTIME_GAP.md` |
| KI-2026-08-24-003 | Medium | Crash rates per modeled VMT lack a defensible denominator where the modeled road network does not cover the observed crash network. | Keep rates deferred; disclose source and road-coverage limits instead of treating unsupported roads as zero. | `docs/ROADMAP.md` |
| KI-2026-08-24-004 | Medium | Recovery confidence expires if operators stop exercising it. The repository drill proves the local reference path, not every deployment's disks, credentials, or cutover. | Run `npm run ops:restore-drill` before relevant releases and at least quarterly; next reference review due 2026-11-24. | `openplan/docs/ops/BACKUP_AND_RESTORE.md` |
| KI-2026-08-31-011 | Medium | Workspace health can say worker presence is undeclared while also showing a current modeling-worker heartbeat in the same panel. | Reconcile deployment declarations and observed heartbeat into one explicit capability state. | First-week run `2026-09-01T03-36-34-705Z`, job 01-first-day-setup |
| KI-2026-08-31-012 | Low | Choosing a geocoded study area silently replaces a planner's free-text plan-geography label. | Separate the planner label from resolved geography identity or make the replacement explicit and reversible. | First-week run `2026-09-01T03-36-34-705Z`, job 01-neutral-geography-setup |
| KI-2026-08-31-013 | Medium | An exact uploaded project study boundary can remain without jurisdiction identity, leaving readiness unanswered. | Preserve the uploaded geometry while allowing a separately evidenced place identity. | First-week run `2026-09-01T03-36-34-705Z`, job 02-project-end-to-end |
| KI-2026-08-31-014 | Medium | Two killed-or-seriously-injured totals appear on one Safety screen with only fine print explaining their different scopes. | Name the scope beside each total and provide the reconciliation directly where both appear. | First-week run `2026-09-01T03-36-34-705Z`, job 04-safety-case |
| KI-2026-08-31-015 | Medium | A crash retrieval started without Project context cannot later attach to a report, while the report wizard does not offer Safety evidence. | Warn before retrieval and make project-scoped Safety evidence reachable from report creation. | First-week run `2026-09-01T03-36-34-705Z`, job 04-safety-case |
| KI-2026-08-31-016 | Low | Workbook preview warns that a normalized project name already exists while reporting zero conflicted rows. | Count the existing-name state as a conflict or explicitly distinguish it from the conflict total. | First-week run `2026-09-01T03-36-34-705Z`, job 08-project-portfolio-round-trip |
| KI-2026-09-01-019 | Low | Data Hub can reuse an identical existing GIS layer, but an exact-label re-upload cannot become a new version of that layer. | Add version upload to an existing layer and make duplicate-content handling offer explicit reuse or a new governed version. | Final first-week run `2026-09-01T11-06-18-597Z`, job 06-land-use-plan, `evidence/f1.png` and `evidence/f1.snapshot.txt` |
| KI-2026-09-04-022 | Low | A selected county is stored and confirmed without the word “County,” so a same-named place and county become hard to distinguish after selection. | Preserve the resolved geography kind in the saved display label. | First-week run `2026-09-04T21-36-51-368Z`, job 01-first-day-setup, `evidence/f1.png` and `evidence/f1.snapshot.txt` |
| KI-2026-09-04-023 | Low | The guided model launch message can continue to say the worker is being awaited after the run has entered running state. | Derive the launch confirmation from the current run state or expire it when polling observes the claim. | First-week run `2026-09-04T22-18-24-299Z`, job 05-analysis-corridor, `evidence/f1.png` and `evidence/f1.snapshot.txt` |
| KI-2026-09-04-024 | Low | The scenario page shows legacy single-run “Baseline run missing” warnings beside a complete, saveable exact four-run comparison. | Separate or suppress the legacy readiness panel when the guided four-run comparison path is active. | First-week run `2026-09-04T22-18-24-299Z`, job 05-analysis-corridor, `evidence/f2.png` and `evidence/f2.snapshot.txt` |

## Closed in v0.44.0

| ID | Previous severity | Finding | Resolution evidence |
|---|---|---|---|
| KI-2026-08-26-006 | Medium | Corridor Analysis GeoJSON downloads did not identify the exact included layers or coordinate reference system at export. | The handoff now lists its exact FeatureCollection layers and `urn:ogc:def:crs:OGC:1.3:CRS84` longitude/latitude axis order. `explore-results-board.test.tsx`; mutation proof in the v0.44 release evidence. |
| KI-2026-08-26-007 | Low | Workbook users could see only the first 12 rows of a mapping sheet before choosing it. | The review surface now expands every parsed row before selection while retaining a collapsed summary. `portfolio-workbook-import.test.ts`; `project-portfolio-importer.test.tsx`; mutation proof in the v0.44 release evidence. |
| KI-2026-08-31-017 | Low | Separate AequilibraE and ActivitySim evidence downloaded with identical filenames. | v0.41, v0.43, and v0.44 method artifacts now include geography and method in the filename. `published-comparable-observation-study.test.ts`; `published-structural-demand-diagnosis.test.ts`; `published-distributed-work-loading.test.ts`. |
| KI-2026-08-31-018 | High | A public-engagement honeypot submission could receive a success response without a stored comment, creating false receipt evidence. | The endpoint now returns an explicit filtered state rather than resident-facing success; the focused mutation test fails when false success returns, and live rerun `2026-09-01T05-52-38-788Z` completed with no pending consequential claims. `engagement-public-submit-route.test.ts`. |
| KI-2026-09-04-020 | High | A capped crash-record extract exposed partial severity counts as corridor totals and used them in the safety score, while an exact larger matched-total count appeared beside them. | Capped extracts remain observed but incomplete: severity totals and density are null, the safety score and composite are withheld, and the narrative states the exact matched count plus the cap. Three targeted mutations failed; first-day rerun `2026-09-04T21-36-51-368Z` passed without the false output. `analysis-route-grounding.test.ts`; `crashes-data-source.test.ts`; `scoring-unobserved-safety.test.ts`. |
| KI-2026-09-04-021 | High | An ActivitySim run card labeled AequilibraE `total_trips` and `daily_vmt` rows as the ActivitySim headline despite separate ActivitySim KPIs on the same run. | Run cards now require the engine key and ActivitySim cards select only `activitysim_trips` and `activitysim_daily_vmt`. The wrong-key mutation failed, exact-SHA desktop and 390px browser checks showed 64,461 ActivitySim trips and 10,216,067 ActivitySim VMT with no console errors, and rerun `2026-09-04T22-18-24-299Z` passed all four jobs and saved the exact comparison without reproducing the defect. `a-finished-run-states-what-it-found.test.tsx`. |

## Closed in v0.32.0

| ID | Previous severity | Finding | Resolution evidence |
|---|---|---|---|
| KI-2026-08-24-005 | Medium | The general AequilibraE/ActivitySim polling workers exposed liveness only through run history rather than a direct durable heartbeat. | Both worker types emit independent service-role heartbeats; deployment and model-run surfaces reduce instances to explicit capability states and exact stale observations gate enqueue without terminating active work. `modeling-worker-health.test.ts`; `V032_OPERATIONAL_HEALTH_PROOF_2026-08-24.md` |

## Closed in v0.36.1

| ID | Previous severity | Finding | Resolution evidence |
|---|---|---|---|
| KI-2026-08-26-001 | Blocker | ActivitySim preflight, unrelated county evidence, and unbound comparison snapshots could make a guided project comparison appear complete without four assigned link-volume outputs. | Guided completion now requires exact project-scoped baseline/build artifacts from both methods, artifact hashes bound to the snapshot, current build assumptions, and per-run claim decisions. `analysis-sequence-facts.test.ts`; `project-comparison-route.test.ts`; `scenario-comparison-snapshots-route.test.ts` |

## Closed in v0.37.0

| ID | Previous severity | Finding | Resolution evidence |
|---|---|---|---|
| KI-2026-08-26-002 | High | The append-only exact-run link trigger also refused a parent scenario/workspace cascade, so tenant teardown could not remove the otherwise contained child row. | Direct changes remain refused, while migration `20260826000007_scenario_model_link_cascade_delete.sql` permits only a nested foreign-key cascade. The complete live isolation suite deletes its real fixture and passes. `rls-isolation.test.ts` |
| KI-2026-08-26-003 | High | A normal current report PDF was classified as an unsupported numeric claim, blocking an otherwise approvable package. | Inventory classification now reserves numeric provenance enforcement for consequential numeric evidence, with focused regression coverage and the governed browser journey. `project-evidence-candidate-inventory.test.ts` |
| KI-2026-08-26-004 | Medium | The decision-package panel did not refresh after a bundle was frozen in the adjacent evidence panel. | Both panels now share a project-scoped bundle-change event; the visible freeze-to-submit journey proves the refreshed state. `project-evidence-bundle-panel.tsx`; `project-decision-package-panel.tsx` |
| KI-2026-08-26-005 | High | Missing linked-plan and current-report prerequisites were named but offered no route to repair them. | The review dialog now links directly to project-scoped Plans and Reports, with focused reachability coverage. `project-evidence-bundle-reachability.test.tsx` |
| KI-2026-08-27-008 | Low | Prior-bundle history showed only a shortened manifest SHA-256, so a planner could not copy or compare the exact manifest identity. | History now shows all 64 characters with a copy action. Final job 09 run `2026-08-28T04-08-52-046Z`; `project-evidence-bundle-reachability.test.tsx` |
| KI-2026-08-28-009 | High | Frozen development demand has no registered LODES vintage or proven role and no exact non-work through-travel source; the 0.35 through share is an assumption. | v0.43 records LODES facts as `unknown`, non-work through travel as `unsupported`, and refuses invented facts. Model defaults remain unchanged. |
| KI-2026-08-28-010 | High | Frozen networks contain many disconnected components, dropped boundary crossings, structurally unreachable road links, and unloaded matched observations. | v0.43 sizes and publishes these limits in fourteen separate inconclusive audits/diagnoses. Correction and untouched validation remain future work. |
| KI-2026-08-27-009 | Medium | A named approver whose active workspace differed from the package workspace saw an empty My Work queue. | Caller-RLS checks expose only the workspace containing assigned package work and offer a direct membership-checked switch. Final job 10 run `2026-08-28T04-12-21-580Z`; `my-work-query.test.ts`; `workspace-switcher.test.tsx`; `docs/ops/2026-08-28-governed-decision-handoff-browser-proof.md` |

## Closed in v0.31.0

| ID | Previous severity | Finding | Resolution evidence |
|---|---|---|---|
| KI-2026-08-24-006 | Blocker | County retries shared geography-wide artifact targets; a stale callback could change the active run or ingest another attempt's files. | Attempt directories include county-run and job ids; bearer callbacks require the stored job id and terminal/cancelling runs refuse late success. `county-onramp-worker.test.ts`; `county-run-manifest-route.test.ts` |
| KI-2026-08-24-007 | High | Command construction could fail outside the worker failure boundary, leaving an accepted job with no terminal callback. | Command construction is inside the boundary; worker tests force it to throw and observe a failed callback. `workers/county_onramp_worker/tests/test_main.py` |
| KI-2026-08-24-008 | High | The single-worker queue had no heartbeat or human cancellation path, so one stuck attempt could hold later work indefinitely. | Authenticated status/cancel endpoints, heartbeats, durable lifecycle timestamps, planner-only cancel UI, and assistant refusal. `20260824000005_county_run_worker_lifecycle.sql` |
| KI-2026-08-24-009 | High | The recovery procedure depended on unverified hosted assumptions, fixed bucket names, and an overdue non-production drill. | Free isolated backup/restore drill passed database, evidence-custody, storage-byte hashes, relationships, and live RLS on 2026-08-24. `openplan/scripts/ops/disposable-restore-drill.sh` |

## Rules

- Add a row only from a test, browser journey, drill, primary-source review, or
  user report.
- A release blocker is data loss, tenant isolation failure, false consequential
  output, or an unverified required migration/recovery path.
- Close a finding only with linked evidence that could have failed.
