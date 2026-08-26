# OpenPlan known issues

**Reviewed:** 2026-08-26 against v0.36.1.
This is a quality-boundary register, not a development queue. Scheduling lives
only in `docs/ROADMAP.md`.

## Open watch items

| ID | Severity | Boundary | Current disposition | Evidence |
|---|---|---|---|---|
| KI-2026-08-24-001 | High | County and dual-demand outputs remain screening evidence. Current held-out count results do not support defensible corridor accuracy, and agreement between models is not accuracy. | Keep caveats, claim tiers, both model values, and negative studies intact. Do not average or change defaults without untouched evidence. | `CHANGELOG.md` 0.22–0.23; `docs/modeling/ACTIVITYSIM_RUNTIME_GAP.md` |
| KI-2026-08-24-002 | High | ActivitySim can execute, but the available stock behavioral coefficients were estimated for another region. A locally fitted population does not make those choices locally calibrated. | Name coefficient provenance and keep output below locally validated claim tiers. | `docs/modeling/ACTIVITYSIM_RUNTIME_GAP.md` |
| KI-2026-08-24-003 | Medium | Crash rates per modeled VMT lack a defensible denominator where the modeled road network does not cover the observed crash network. | Keep rates deferred; disclose source and road-coverage limits instead of treating unsupported roads as zero. | `docs/ROADMAP.md` |
| KI-2026-08-24-004 | Medium | Recovery confidence expires if operators stop exercising it. The repository drill proves the local reference path, not every deployment's disks, credentials, or cutover. | Run `npm run ops:restore-drill` before relevant releases and at least quarterly; next reference review due 2026-11-24. | `openplan/docs/ops/BACKUP_AND_RESTORE.md` |

## Closed in v0.32.0

| ID | Previous severity | Finding | Resolution evidence |
|---|---|---|---|
| KI-2026-08-24-005 | Medium | The general AequilibraE/ActivitySim polling workers exposed liveness only through run history rather than a direct durable heartbeat. | Both worker types emit independent service-role heartbeats; deployment and model-run surfaces reduce instances to explicit capability states and exact stale observations gate enqueue without terminating active work. `modeling-worker-health.test.ts`; `V032_OPERATIONAL_HEALTH_PROOF_2026-08-24.md` |

## Closed in v0.36.1

| ID | Previous severity | Finding | Resolution evidence |
|---|---|---|---|
| KI-2026-08-26-001 | Blocker | ActivitySim preflight, unrelated county evidence, and unbound comparison snapshots could make a guided project comparison appear complete without four assigned link-volume outputs. | Guided completion now requires exact project-scoped baseline/build artifacts from both methods, artifact hashes bound to the snapshot, current build assumptions, and per-run claim decisions. `analysis-sequence-facts.test.ts`; `project-comparison-route.test.ts`; `scenario-comparison-snapshots-route.test.ts` |

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
