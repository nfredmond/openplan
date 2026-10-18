# Portfolio import transaction correction, candidate

The candidate lets an invalid skipped source row remain in the audit record
while valid selected rows create together. The implementation records below
describe the original preparation checkpoint. Subsequent independent source
review and the parent's [native rollback proof](../2026-10-15-portfolio-skip-invalid-native/STATUS.md)
pass within their stated bounds. The parent corrects the temporary-schema grant
recommended by review before native execution; the original verification file
still binds the earlier generator. The browser retry remains pending. This
packet does not establish installation or workflow acceptance.

## Ownership and baseline

The assigned checkout is `/home/nathaniel/.t3/worktrees/openplan/t3-29b59c85`,
branch `t3/portfolio-import-skip-invalid-rows`. It starts clean at
`05dd3e8da4a4572437f06e771b0a2477873e681f`, then fast-forwards locally to root's
`65e000f31d07fca24f83c8daef479d0b161f8dd4`. No canonical or root checkout changes.

Owned files include migration 17, focused import tests and fixture, this packet,
and the small approved Unreleased changelog entry. The packet preserves the
original failure files by hash. Private work and logs live at
`/home/nathaniel/.local/state/openplan/portfolio-skip-invalid-transaction-fix-20261015`.

The nested app's direction check passes. It reports older jurisdiction,
capability and release review reminders; this bounded correction changes no
product direction or acceptance tier. The contract, roadmap, capability matrix,
latest direction review, known limitations and architecture govern the lane.

## Source-established cause

Root's frozen browser failure is at
`/home/nathaniel/.local/state/openplan/current-project-preview-browser-fallback-20261015/import-failure-01`.
Row 2 creates with `125000 EUR`, an unknown price year, and a visible warning.
Row 3 skips with `canCreate=false`, `state=blocked`, and literal
`status=invented-status`. Its review error is `invalid_status`.
The approved preview hash is
`b8d13529a3267b9b733a3ec80181494615d44c4940e833866bf691da006d0508`.
The browser receives `409 import_stale`, including after the same review hash
returns. [Failure hashes](failure-packet-sha256.json) cover all eight files.

The latest existing v2 function is in
[20260905000001](../../../openplan/supabase/migrations/20260905000001_portfolio_unknown_price_year.sql).
Its first row-validation loop checks status, phase and plan type for every row,
before checking `decision=create`. The frozen skipped status fails that check,
which raises `22023`. The route maps every `22023` to `import_stale`; that generic
message does not establish an external duplicate or source change.

There is a second barrier. The original audit table's unconditional
`resolved_status` and `resolved_delivery_phase` constraints reject invalid
skipped values. Moving the function guard alone would reach a `23514` audit
failure. The prepared native comparison distinguishes both barriers and tests
whether changing only row 3's status removes the original failure. That
copy-only diagnostic does not alter the frozen source or normalize the fix.

## Bounded correction

[Migration 17](../../../openplan/supabase/migrations/20261017000017_portfolio_skip_invalid_classifications.sql)
replaces the two audit constraints with checks that apply to `decision=create`.
It keeps their supported values, all NOT NULL requirements and immutable audit
triggers. It changes no stored row and introduces no new policy or privilege.

The replacement v2 function moves the existing plan/status/phase checks under
`decision=create`. Invalid skipped status and phase remain literal. Skipped plan
type also remains literal, including surrounding whitespace. Created plan types
retain their existing trimming behavior. [The function diff](function-diff.patch)
shows the complete function change.

All existing source scope/hash/format/type/status checks, worksheet and row
structure checks, decisions, formula and name confirmations, current actor
membership, duplicate source checks, created-identity uniqueness, cost provenance,
text validation, counters, audit writes and service-only execution remain.
The legacy v1 function and all old migrations remain unchanged. The route's
implementation remains unchanged.

The inventory reports 420 migrations, latest 17, without duplicate versions or
invalid filenames. [Inventory](migration-inventory.json) is a source-file count,
not applied history. The build derives its manifest from migration files, so
there is no separate fixed count to edit. The active preview's 419-migration
history and frozen build are untouched. No version, release, PR, push or merge.

## Checks and their limits

The final focused run passes 18 tests in two files. The route reads the captured
synthetic CSV bytes from a base64 fixture, preserving CRLF across Git settings.
It reproduces the exact frozen preview hash, retains the EUR/null-year warning,
and sends both rows unchanged in one v2 RPC payload. Its RPC, membership and
Storage clients are mocked. Its `201` proves payload custody, not native success.
The migration tests inspect SQL source, not PostgreSQL execution.

[Controls](controls.json) record a harmless comment survivor and seven targeted
failures. Faults make classification validation unconditional, remove status or
phase creation checks, restore either unconditional audit constraint, normalize
a skipped plan type, or discard the skipped RPC row. Each fails the named
assertion. `finally` restores the exact original source bytes. The restored run
passes. Focused ESLint and `git diff --check` also pass.

All test runs use the shared compiler lock, one worker and a 1024 MiB Node heap.
The test config and cache live privately; dependencies use a read-only symlink
to the existing installation. An initial command ran from the wrong directory
and failed before tests using a temporary npm-cache Vitest. A second config
attempt failed on `__dirname` with Vite's runner loader. Neither is pass evidence.
The final private config preserves the repository settings, replaces
`__dirname` with the app working directory, and directs cache writes privately.

No database query or write, browser, service, rebuild, clone, hosted apply or
provider action runs in this lane. No broad suite runs. Native RLS, function
privileges, database constraints, transaction atomicity and actual UI success
remain unproved here. Root owns native execution and the sole browser.

## Root's native handoff

[prepare_native_probe.py](prepare_native_probe.py) has no database transport. It
prepares SQL for a newly allocated exclusive database named
`openplan_portfolio_skip_<24 hex>`. The name alone is not ownership evidence.
Root must verify the retained cluster, allocate the new target and retain
before/after inventory. Do not use the active preview, source anchor or old proof
databases. The retained cluster is
`supabase_db_openplan-restore-target-2026091050`; root retains its config lineage.

The SQL requires the explicit database name, 419 migrations through 16 and the
exact original v2 body. It uses one transaction, short locks, bounded statements,
16 MiB work memory and an unconditional final rollback. It never inserts
migration history. On any error, psql must stop and close the session, which
rolls back the open transaction. Root must preserve the error and correct the
probe before claiming evidence. The generated probe has not run against
PostgreSQL; Python syntax and in-memory generation are the preparation checks.
[Preparation controls](preparation-controls.json) retain a harmless docstring
survivor and show that bypassing the target-name check accepts forbidden names.
They do not exercise the native SQL preflight or exception oracles.

The probe includes the original `22023`, a status-only diagnostic success,
a harmless original-function comment control, function-only `23514`, full
candidate success and 32 expected-error controls. It checks raw skipped values,
EUR/null-year/source provenance, actual service-role invocation, viewer and
outsider actors, authenticated and anonymous RPC denial, member/outsider audit
RLS, immutable records, duplicate checks, replay identity, formula checks,
malformed skipped structure, source metadata cases, and a late second-row cost
failure after the first project insert. Every expected error compares project,
batch and audit counts. A positive XLSX case checks SQL source metadata only.
After rollback, it checks original counts, both constraints, function body,
fixture absence and absent migration-17 history.

Generate only after root allocates the target, from this candidate checkout:

```bash
python3 -B docs/reviews/2026-10-15-portfolio-skip-invalid-transaction-fix/prepare_native_probe.py \
  --database "$PORTFOLIO_FIX_DATABASE" \
  --output /home/nathaniel/.local/state/openplan/portfolio-skip-invalid-transaction-fix-20261015/native-root-01
```

Root executes the resulting `probe.sql` serially under the shared lock, on the
verified new target only, with `psql -X -v ON_ERROR_STOP=1`. Retain its generated
plan, SQL hash, stdout/stderr, process result and independent post-rollback
inventory. Keep execution outside this implementation lane until review.

The native probe does not read Storage bytes, rerun server review hashing,
exercise simultaneous commits, prove browser navigation or replace planner
acceptance. Native direct-RPC faults deliberately vary synthetic rows while
retaining a syntactically valid preview hash. The route owns review recomputation
and approved-hash equality; existing route tests retain that separate boundary.
The prepared exception handling follows
[PostgreSQL control structures](https://www.postgresql.org/docs/current/plpgsql-control-structures.html).
The investigation also consults
[Supabase diagnostics](https://supabase.com/docs/guides/monitoring-and-debugging).
