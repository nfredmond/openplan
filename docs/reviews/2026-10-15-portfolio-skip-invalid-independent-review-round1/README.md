# Independent review round 1: skipped invalid portfolio rows

The bounded product correction has no additional P1/P2 finding from source
review. The prepared native probe has a P2 setup hazard that needs correction
before execution. Neither this review nor the candidate establishes native
success, database acceptance or a corrected browser journey.

## Candidate and ownership

Reviewed candidate: `aa93a3916e4a1464c774dd30a43ae2f7a4824311`, branch
`t3/portfolio-import-skip-invalid-rows`, source checkout
`/home/nathaniel/.t3/worktrees/openplan/t3-29b59c85`.

The assigned review checkout is
`/home/nathaniel/.t3/worktrees/openplan/t3-b232c257`, branch
`t3/review-portfolio-skip-invalid-round1`. It starts clean at `05dd3e8da` and
fast-forwards locally with `git merge --ff-only` to the exact candidate. This
review owns this directory and the new private directory
`/home/nathaniel/.local/state/openplan/portfolio-skip-invalid-independent-review-20261015-round1`.
The source checkout remains clean at the candidate on readback. The reviewer
makes no canonical, source-candidate, old-packet, database, browser or service
changes. This report is independent of the implementation author's conclusions.
There are no previous independent findings to resolve in this round.

The nested-app direction check exits zero. It reports jurisdiction/capability
review-age and release/commit reminders. The binding contract, roadmap,
capability matrix, October 6 direction review, relevant known issues and
architecture preserve the existing direction and acceptance boundaries. This
is a bounded correction within the current project intake journey.

## P2 probe finding: grant the actual temporary schema

Location: [prepare_native_probe.py:58](../2026-10-15-portfolio-skip-invalid-transaction-fix/prepare_native_probe.py#L58).

After creating the temporary input table, the generator emits:

```sql
GRANT USAGE ON SCHEMA pg_temp TO service_role, authenticated, anon;
```

`pg_temp` works as an alias in qualified relation/function references. A schema
ACL target needs the actual catalog schema name, normally `pg_temp_N`.
The literal grant can therefore stop the script with schema-not-found before
fixture setup, original `22023`, function-only `23514` or candidate success.
This is a source-review execution hazard. No PostgreSQL error or SQLSTATE was
observed in this review, and generated SQL has not been natively parsed here.

Resolve the namespace after creating the first temporary table, then quote the
actual catalog identifier for the grant. For example:

```sql
DO $temp_access$
DECLARE temporary_schema text;
BEGIN
  SELECT nspname INTO STRICT temporary_schema
  FROM pg_catalog.pg_namespace
  WHERE oid = pg_catalog.pg_my_temp_schema();
  EXECUTE format(
    'GRANT USAGE ON SCHEMA %I TO service_role, authenticated, anon',
    temporary_schema
  );
END $temp_access$;
```

Keep explicit `pg_temp.portfolio_input` and helper references. This needs no
product grant, broader database privilege or normalized source value. Retain
the first execution result even if another setup failure appears. An early
probe failure is not evidence against the product correction.

## Product and custody assessment

The full 336-line migration and its independently recomputed function diff
match the claimed narrow change. The function moves plan/status/phase
validation into the create branch and preserves skipped plan text literally.
The two audit CHECK constraints become decision-aware. Existing NOT NULL,
decision/outcome shape, immutability triggers, source scope/hash/format checks,
actor membership, formula/name confirmations, duplicate checks, cost custody,
project insertion and service-only RPC grants remain present and unchanged.
The route and historical migrations are unchanged in the candidate commit.

The frozen packet retains the valid `125000 EUR` row, null price year and
warning, alongside the skipped `invented-status` row. Its approved preview hash
is `b8d13529a3267b9b733a3ec80181494615d44c4940e833866bf691da006d0508`.
All eight failure-file hashes match current readback. All seven source bindings
in the candidate verification record also match. Migration 17's SHA-256 is
`b129f80e37aa9be71069683acd42df3fb6fdb94078ed0458f20b6e9c5155a41b`.
There are 420 migration files, with 17 latest and no duplicate timestamp.
This is file accounting, not applied database history.

Current production readers of the audit rows use created-row identity for
duplicate detection or `created_project_id` for deletion preconditions. They
do not decode skipped resolved classifications into project enums. The review
types already retain classifications as strings/cast values alongside errors;
the route passes every reviewed row to the RPC. No new generated database type
or audit-reader assumption needs changing for this migration. The existing
workbook review trims mapped classifications before the RPC. Literal
preservation in this correction means preserving the reviewed RPC value,
not undoing that earlier parser behavior or claiming raw-cell fidelity.

## Tests and probe boundaries

The two new SQL tests inspect source. They remove comments, scope the first
row-validation block and assert the create guard and both decision-aware
constraints. The new route case loads the captured CRLF bytes, checks the exact
review hash and both rows, and asserts the complete two-row RPC payload.
Its successful response comes from a mocked RPC. It does not execute this SQL.
Existing route assertions check projections used for duplicate identity.

The retained controls show one harmless comment survivor and seven named
assertion failures, followed by exact-byte restoration. The recorded baseline
log reports 18 tests in two files at the source checkout. These records and
their bindings were inspected; tests, ESLint and the old fault campaign were
not rerun in this review. No test or guard was changed here. Source-string
tests cannot establish SQL parsing, trigger order, privileges, RLS or atomicity.

Under the shared compiler lock, the reviewer loads the generator in memory and
generates one private stand-in without allocating a database or writing into
the implementation author's private root. Its 2,209 lines contain 32
expected-error calls. Generation success proves Python assembly only.
[Source observations](source-observations.json) record the measurements and
hashes. The stand-in SQL and plan stay in the assigned private directory.

Beyond the schema grant, source inspection finds no further concrete blocking
hazard in the SQL expressions, dollar quoting, helper name resolution, fixture
metadata, role switches or stated error paths. The helper is invoker-rights;
the actual RPC retains its service-only security-definer boundary. The
privilege assertion accompanies role invocation, rather than relying solely
on a broad `insufficient_privilege` catch. RLS compares a member's expected
three rows/two batches with an outsider's zero results.

The original, status-only diagnostic, harmless comment, function-only and full
candidate stages are separate. Faults use messages and named constraints, so
the replay and direct audit checks cannot count an unrelated unique/check
failure as the intended result. Name confirmation lets late text/cost/replay
controls reach their later checks. The late second-row cost fault can reach
the first project insert before raising the expected cost message.

Count comparisons cover inserted projects, batches and audit rows within each
error subtransaction. They cannot detect same-count updates, unrelated-table
effects, concurrent races or stale planner approvals. The final rollback
assertions compare those counts, both original constraints and the original
function body, and check named fixture/history absence. They do not replace
root's independent full before/after inventory. `ON_ERROR_STOP` and closing a
failed psql session remain necessary for rollback after an early failure.

## Disposition

Correct the probe's temporary-schema grant, then let root execute against its
explicitly allocated new exclusive target. Preserve the original and
function-only failures, full-candidate success, negative controls, actual role
and RLS outcomes, and independent rollback inventory. A successful native run
would still leave Storage-byte custody, route review recomputation,
simultaneous commits, identified desktop/390px browser retry and practitioner
acceptance as separate boundaries. No push, PR, merge, release or acceptance
promotion occurs in this review.
