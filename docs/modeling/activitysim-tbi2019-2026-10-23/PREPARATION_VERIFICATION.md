# Preparation verification and handback

October 23, 2026. Checkout:
`/home/nathaniel/.t3/worktrees/openplan/t3-1038cfe9`.
Base: `ccfd7f77ac0b2dba94de322b46547ac1ad07a546`.
The requested branch was already attached to `t3-d0ced982`; Git refused the
checkout. Work continued on detached HEAD at the exact fetched remote commit,
with an explicit fast-forward push to `work/s2-activitysim-tbi2019`.
No other checkout, worker or browser session changed.

## Results

| Check | Result | What it does not prove |
|---|---|---|
| Product direction check | Pass with existing review-age/version reminders | Does not renew the product reviews |
| Six scoped Python suites | 130 cases: 126 pass, four skip, zero failures | Does not prove real population fit or raw TBI joins |
| Two scoped TypeScript suites | 41 pass, zero skip, zero fail | Does not execute SQL or a browser |
| Mutation controls | Four harmless survivors, 35 targeted assertion failures, exact restoration | Does not exhaust every input or adversarial case |
| Metadata audit | 187 required ACS fields and required PUMS fields exist in official metadata | Field presence does not prove geographic data availability or control fit |
| Existing development roster | 6,019 households, 5,041 in scope, 978 outside, zero missing counties | No real trip/tour exclusion counts |
| Synthetic accounting | 60 trips: four retained, 56 excluded, two per each of 28 reasons | Not a survey distribution or native ActivitySim run |
| Frozen preregistration and split | Detached hashes match; original assignment hash reproduces | Does not authorize a new opening |
| Historical SQL source | Exact original hash preserved; forward helper differs only in catalog contents | No database apply or native permission proof |

The Python suites are `test_population_2019`, `test_population_source_registry`,
`test_tbi2019_tours`, `test_tbi2019_development_split`, `test_census_pums` and
`test_activitysim_mtc_inputs`. The new suites contain three population tests and
eight tour tests. Subtest case counts are not added to the 130-test total.
The four inherited MTC skips concern stock person coding, stock skim inventory,
stock overlay columns and stock config-path resolution. They expect the stock
example under this checkout's `.venv-exec`, which does not exist. The interpreter
comes from the main checkout's existing environment; the tests do not substitute
that environment's example path to hide these skips.

[Python log](preparation-evidence/final-python-tests.log),
[Vitest log](preparation-evidence/final-vitest.log),
[mutation ledger](preparation-evidence/mutations.json),
[environment](preparation-evidence/environment.json).

## Controls and retained failures

The mutation harness changes owned source files one at a time and restores the
original bytes in `finally`. Harmless changes are Python comments, JSON key
order/indentation and an SQL comment. Targeted faults cover wrong profile
window/PUMA/guided capability, wrong income conversion, wrong weight source,
nonpositive weights, primary priority/duration/ties, university evidence,
unknown/unsupported modes, auto/transit evidence, incomplete/unknown diaries,
proxy/overnight/time/region/quality/derived/joint handling, continuity,
duplicate trips, home returns, mixed modes, work-location identity, inferred
zone identity, default-clean quality, DST ambiguity, SQL membership/grants and
TypeScript capability bypass. Every targeted run reaches an assertion failure;
none counts an import failure or runtime exception as a successful mutation.
Per-control logs accompany their hashes. The final clean suites run after exact
restoration.

The first Vitest invocation ran from the repository root with Vitest 5.0.5.
Both suites failed import resolution for `@/lib/...`; zero tests ran. The correct
`openplan/` working directory uses the existing Vitest 4.1.11 installation and
passes 41 tests. This was a setup failure, not a product assertion failure.

The first metadata audit asserted all margin variables existed in the summary
variables index and failed. Inspection found all required estimates but no
margin variables there. Five official group-metadata requests supplied the
margin fields. The corrected audit still requires all 187 variables. It does
not remove missing fields or weaken a population control.

The npm-exec Supabase CLI attempt waited during setup. The existing installed
CLI then created the intended source-only migration. The delayed first attempt
also completed and created an empty duplicate file. That owned empty file was
removed; the populated `20261023224145_population_profile_2019.sql` remains.
No CLI command contacted a database. Versioned ActivitySim documentation
requests returned 404; BLS direct download requests returned 403. The source
manifest preserves those retrieval limits.

A final documentation-only web search for TBI tour-weight guidance returned a
published regionwide travel-summary excerpt from the Council's
[2020 Transportation System Performance Evaluation](https://metrocouncil.org/Council-Meetings/Committees/Transportation-Advisory-Board-TAB/TAB-Technical-Advisory-Committee/TAC-Planning-Committee/2020/TAC-Planning-8-13-20/V_2_Report-%28TSPE%29.aspx).
It was not a development/held-out partition query or respondent record. The
search exposed aggregate outcomes; do not describe this lane as blind to all
published aggregate travel statistics. No code, crosswalk or analytic rule
changed after this exposure, and the excerpt is not used as an observation or
comparison target. The lead should carry this exposure into successor custody.

## Reproduction boundary

All Python execution uses CPython 3.11.15 and NumPy 1.25.2 from
`/home/nathaniel/code/openplan/workers/activitysim_worker/.venv-exec/bin/python`.
No CPython 3.14 NumPy job runs. Test, audit and mutation processes run under
`systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0`.

From repository root, using that interpreter after the scope prefix:

```text
-B docs/modeling/activitysim-tbi2019-2026-10-23/preparation-evidence/verify-preparation.py
-B docs/modeling/activitysim-tbi2019-2026-10-23/preparation-evidence/synthetic-report.py
-B docs/modeling/activitysim-tbi2019-2026-10-23/preparation-evidence/mutate-preparation.py
```

The metadata/roster audit reads the retained local directories named in its
source; it makes no network requests. Synthetic and mutation runs need no
survey records. Run mutations only in an owned checkout without concurrent
readers. From `openplan/`, after the same scope prefix:

```bash
npm exec -- vitest run src/test/population-source-registry.test.ts src/test/model-common-population-profiles-migration.test.ts --pool=forks --maxWorkers=2
```

No `next build`, model execution, new sealed opening, Docker operation, hosted
system, production service, managed database, secret, fitting or observed/model
comparison occurs. No coefficient, default, holdout assignment, original result
or consumed lock changes. The forward SQL migration remains unapplied. GitHub
checks and review remain separate from local verification; this subagent does
not monitor the draft PR.

## Ownership handback

The income-constant hunk in `activitysim_mtc_inputs.py` is the only edit to that
shared adapter. It does not change skims. The transit lane should preserve that
hunk when the lead joins the branches. The lead owns the complete input closure,
source linkage, estimator decision, modeled filtering and next frozen opening.
The [preparation addendum](PREPARATION.md) records the remaining gates. No claim
that transit is the sole remaining blocker is supported.
