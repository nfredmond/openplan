# OpenPlan known issues

**Reviewed:** 2026-08-28 against the v0.41.0 candidate.
This is a quality-boundary register, not a development queue. Scheduling lives
only in `docs/ROADMAP.md`.

## Open watch items

| ID | Severity | Boundary | Current disposition | Evidence |
|---|---|---|---|---|
| KI-2026-08-24-001 | High | County and dual-demand outputs remain screening evidence. v0.41 repairs stable observation identity, signed TMAS coordinates, complete HPMS section geometry, full-geometry matching, and direction aggregation, but the result is synthetic expanded daily traffic rather than AADT. The model base year remains unknown and no use-specific acceptance rule was frozen. No untouched evidence supports a corridor, California, or nationwide accuracy claim. | Keep caveats, claim tiers, both model values, and negative studies intact. Treat the repaired coverage as an instrument result, not improved accuracy. Address demand and loading defects, then freeze a use-specific rule before opening an untouched holdout; do not average methods or change defaults from these diagnostics. | `data/modeling/comparable-observation-study-2026-08-28/study-report.md`; `docs/modeling/MODEL_VALIDATION_STRUCTURAL_DIAGNOSIS_RESULT_2026-08-28.md`; `docs/modeling/ACTIVITYSIM_RUNTIME_GAP.md` |
| KI-2026-08-24-002 | High | ActivitySim can execute, but the available stock behavioral coefficients were estimated for another region. A locally fitted population does not make those choices locally calibrated. | Name coefficient provenance and keep output below locally validated claim tiers. | `docs/modeling/ACTIVITYSIM_RUNTIME_GAP.md` |
| KI-2026-08-24-003 | Medium | Crash rates per modeled VMT lack a defensible denominator where the modeled road network does not cover the observed crash network. | Keep rates deferred; disclose source and road-coverage limits instead of treating unsupported roads as zero. | `docs/ROADMAP.md` |
| KI-2026-08-24-004 | Medium | Recovery confidence expires if operators stop exercising it. The repository drill proves the local reference path, not every deployment's disks, credentials, or cutover. | Run `npm run ops:restore-drill` before relevant releases and at least quarterly; next reference review due 2026-11-24. | `openplan/docs/ops/BACKUP_AND_RESTORE.md` |
| KI-2026-08-26-006 | Medium | Corridor Analysis GeoJSON downloads do not identify the exact included layers or coordinate reference system at the point of export. | Add explicit layer inventory and CRS metadata to the download handoff; do not infer either from the filename. | First-week GIS run `2026-08-27T00-52-51-591Z` |
| KI-2026-08-26-007 | Low | The workbook importer previews only the first 12 rows of a 24-row “Read me” sheet, hiding the mapping table below the fold. | Make preview truncation explicit and provide a way to inspect all mapping rows before selection. | First-week workbook run `2026-08-27T01-10-21-544Z` |

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
