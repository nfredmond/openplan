# Comparable observation metadata rejection

October 8, 2026. This is S1 software-integrity evidence, not model acceptance.
The installed v2 custody trigger already rejects missing and null schema
metadata with `IS DISTINCT FROM`. No production defect or migration is claimed.

## Native checks

`openplan/src/test/model-validation-instrument-v2-metadata-live.test.ts` invokes
the installed `record_modeling_validation_instrument_v2` function as
`service_role` in PostgreSQL. It covers each of the five artifact positions
independently with an omitted schema key, JSON-null schema, JSON-null document
and incorrect schema string. Each case requires the specific schema-metadata
error and no resulting custody row. One positive case requires all five correct
schemas, permits additional metadata and retains an inconclusive custody row.
The existing live RLS suite separately covers workspace access and immutability.

All 21 cases pass against the named disposable
`supabase_db_openplan-restore-target-2026091050` stack. Fixtures roll back in each
session. A statement timeout, lock timeout and subprocess timeout bound the
checks. The existing named-stack guard refuses other local targets. The suite
is included in `npm run test:rls-live`; ordinary unit runs skip its live cases.
Targeted ESLint and `git diff --check` pass.

## Falsification

A transaction-local comment in the installed trigger leaves all 21 cases
passing. Five separate transaction-local mutations replace one schema's
`IS DISTINCT FROM` with `<>`. Each mutation makes that artifact's three
missing/null cases fail with `malformed metadata was accepted`. The wrong-string
case continues to reject. Restoring the unmodified function yields 21 passes.
The installed function's definition has the same SHA-256 before and after
every control:
`65b2088c9cd76a9ac0cf7b9eafbf51ea0d6deef99fda4e65b226681ee798ccdc`.

The first harmless-control setup omitted the statement terminator after
`pg_get_functiondef` output and failed with SQL syntax errors. Adding the
terminator corrected the private control file. That failed log remains retained;
it is not counted as an adverse-control success. An initial lint invocation from
the repository root found no matching file. The corrected package-root invocation
passes.

Private logs and control SQL are under
`~/.local/state/openplan/s1-metadata-20261008-proof/`. The test's optional
`OPENPLAN_MODEL_CUSTODY_TEST_SQL` file is applied inside the same rolled-back
transaction, never as a committed migration. PostgreSQL documents the relevant
[null-comparison semantics](https://www.postgresql.org/docs/current/functions-comparison.html).

## Unproved boundaries

These are synthetic database records and placeholder hashes. The tests do not
read scientific observations or holdouts, execute either demand model, verify
artifact bytes, exercise HTTP ingestion, or compare displayed and downloaded
results. They do not cover every omitted RPC argument, SQL-null column value or
malformed metadata shape. They leave claim tiers, frozen studies, preregistration
and acceptance tolerances unchanged. S1, independent nationwide scientific
acceptance and the full V1 contract remain open. Main integration and GitHub
checks remain separate from these local results.
