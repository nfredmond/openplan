# Combined model recovery integration

October 8, 2026. PR #168 combines the stage-output, KPI, agreement and local
state-publication work from PRs #165 through #168. It preserves their commits and
individual evidence notes. No full-stage recovery or scientific acceptance is
claimed.

## Verified source relationship

Before this evidence-only update, combined commit
`db7a55231d792e834f33570e5b3c59341a1c52ff` includes these parent heads:

- PR #165: `cc0f60a266c1beec0febbb7e8ac4b22590067fd8`.
- PR #166: `b8556f268bcffea087c1a1716737c752f3063351`.
- PR #167: `2cd35b96968ec7180afb31e82c3ebaa990b07613`.

Git ancestry checks pass for all three. The combined `openplan/` tree is
`c67a22b1bc171b4be38cbc1c594cbfbac6390f27`, identical to PR #166's application
tree. Additional source changes are worker and comparison code with their
focused and full-worker checks. Application source equality is not a claim that
the complete repository or all cross-directory checks are identical.

## Local application QA

Exact commit `b8556f268bcffea087c1a1716737c752f3063351` passed `npm run qa:gate`.
Unit `openplan-agreement-qa-b8556f26.service`, invocation
`27164b9b05314bd39d80d370c409c3eb`, finished at 08:59:29 Pacific with exit status
zero. The checkout stayed unchanged for the complete run.

The suite reports 20,095 passing and 1,580 skipped tests across 1,512 passing and
95 skipped files. Lint, dead-code checks, provider checks, dependency audit and
the production webpack build passed. The audit reports zero vulnerabilities.
Peak memory was 6 GiB under a 7 GiB cap. Live database isolation was not opted
into this local run. Skipped tests are not acceptance evidence.

The later worker tree passes all 84 worker suites, with no failures or omitted
suites, as recorded in [run-state publication](RUN_STATE_PUBLICATION.md).
The [agreement record](AGREEMENT_COMPUTATION.md) records the real comparator on
synthetic inputs, all 21 comparison-script tests, source-copy controls and
read-only calculation inspection. Native migration, permissions, concurrent
write and lost-response evidence remains in the [stage recovery](STAGE_RECOVERY.md)
and [KPI recovery](KPI_RECOVERY.md) notes. These checks cover different boundaries.

## Integration and unresolved work

PR #168 targets main. GitHub must pass on its final combined head before merge.
The earlier main commit `2de610b2b91d3aaafa8f7a92c7edad4348aa00e5` has passing
CI, upgrade-path and focused-worker runs; its live RLS run remains active at this
checkpoint. PR #165's CI passes, with its RLS and restore checks still active.
These are dated observations, not substitutes for final combined-head checks.

Current attempt ownership, expired-attempt fencing in the normal dispatcher,
interrupted-computation reconciliation, geometry-computation retention and
complete scientific ingestion remain unfinished. Atomic local state publication
is not a version history or competing-writer fence. Whole-stage replay remains
disabled. T3 visual acceptance, practitioner acceptance and independent
scientific acceptance remain open. The full V1 contract is unchanged.
