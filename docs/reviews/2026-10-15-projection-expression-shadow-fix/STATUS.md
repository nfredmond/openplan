# Named expression shadows remain unknown

The single P2 from independent review `2a33a9829` is corrected locally.
The scanner now collects named function and class expressions alongside the
existing declaration bindings. Their self-bindings prevent import fallback
from substituting an unrelated literal projection. Runtime application code
does not change.

## Source and ownership

The assigned worktree is
`/home/nathaniel/.t3/worktrees/openplan/t3-f20bf395`, on
`t3/fix-projection-expression-shadow`. It starts clean at
`05dd3e8da4a4572437f06e771b0a2477873e681f`, then fast-forwards locally to
`06a108010ab39aa42eed4c2bcda3e1371b8aa813`. No fetch runs.

Ownership covers `openplan/src/test/supabase-call-sites.ts`, its focused
resolver test in `reference-count-projection-guard.test.ts`, this report
directory and private probes. The supplied AGENTS instructions, current local
AGENTS, planner-writing and prove-it skills guide this work. Both the original
combined guard-fix report and the independent report and evidence are read.
The parent's coordination record identifies its frozen full-QA source.

The direction check runs from the actual nested `openplan/` and exits zero.
Its registry/matrix age, review/package version and intervening-change
reminders remain. This patch does not reassess or redate product direction.

## Both fixtures reproduce before correction

Two added parameterized cases import `COLUMNS` from a local file exporting
`"id, jurisdiction_context"`. One uses `const read = function COLUMNS() { ... }`;
the other uses `const read = class COLUMNS { read() { ... } }`. Each body selects
its own `COLUMNS` binding. Each test requires exactly one `projects` site,
the argument expression `COLUMNS`, and a null projection.

Before the correction, both named cases fail that assertion. Expected is
`projection: null`; received is `projection: "id, jurisdiction_context"`.
The eight existing projection cases pass. This is the intended regression
failure, not a startup or collection error.

The first private controller then fails its own name comparison because Vitest
renders `$kind` as `'function'` and `'class'`, including quotes. The original
controller and raw results remain private. A separate readback confirms the
two exact failed names and expected/received diff. The corrected controller
uses the actual names. Its initial naming error does not count as a mutation
kill or product failure.

## Focused checks pass with controls

The corrected projection file passes all 10 cases. A harmless scanner comment
survives those same 10 cases before either fault trial. Removing only
`ts.isFunctionExpression` fails only the named function test. Removing only
`ts.isClassExpression` fails only the named class test. Both trials exit one
with the same null-versus-imported-string assertion. The other expression case
passes in each trial. Mutations touch only a private source snapshot; `finally`
restores and checks exact bytes after every trial.

The final restored cohort passes 117 cases across four files:

- `reference-count-projection-guard.test.ts`
- `write-policy-coverage-guard.test.ts`
- `gtfs-claim-boundaries.test.ts`
- `gtfs-coverage.test.ts`

Scoped TypeScript checks the two changed files and their transitive imports.
Scoped ESLint checks both changed files with zero warnings allowed. Both exit
zero. The existing schema checks, view exemptions, dynamic-table registry,
delete-helper checks and unknown ceiling of `< 182` remain unchanged.

The private 19-case matrix also matches all expectations. It retains named,
renamed and `@/` imports, static templates, mutable/computed/private/interpolated
values, re-exports, type-only/package imports, parameter/destructured/rest/catch
bindings, declarations before initialization, function declarations and both
named expressions. Its harmless comment survives. Removing function-expression
collection produces exactly the named-function-expression mismatch.

The final receipt readback catches a private controller filename collision:
its summary overwrites the detailed matrix output. The initial evidence and
readback error remain private. A recovery attempt refuses an existing cache
directory before running the probe. A distinct output/cache label then reruns
only the private matrix, restores all 19 detailed case receipts, and confirms
the harmless survivor and targeted mismatch. Neither harness error counts as
a product failure or mutation kill. The final evidence readback checks this
receipt shape explicitly.

## The full census is unchanged

The private snapshot starts from a local archive of exact `06a`. The complete
serialized site objects before and after the fix are byte-identical, including
file, line, table, argument expression, projection, count settings and
write-following status. Their shared SHA-256 is
`2738a5ccf92243023f04ece7c358296cfa85b3f152853f8122f78093efab6940`.

Both inventories contain exactly 2,008 sites, 181 unknown projections and
1,802 checkable sites under the existing table/projection/view criteria.
The focused actual-jurisdiction-reader assertion still verifies all six fields
and the migration schema. No current production site changes classification.

## Custody, resources and limits

Private sources, scripts, caches, census files and raw logs remain at
`/home/nathaniel/.local/state/openplan/projection-expression-shadow-fix-20261015-01/`.
[`evidence.json`](evidence.json) records source bindings, script/log hashes,
assertion results, restoration, census hashes and resource receipts. The final
private scanner and test bytes match the assigned worktree exactly.

All test/probe scopes run serially with at most one Vitest worker, private
caches, a 640 MiB Node heap, a 1 GiB cgroup limit, zero swap and one CPU quota.
Bubblewrap mounts the canonical dependencies read-only and disables network
access within these scopes. The peak is 410,329,088 bytes, with zero swap and
zero OOM events. No dependency installation or dependency modification runs.
Borrowed TypeScript is `5.9.3` and Vitest is `4.1.11`. The known unrelated
Mammoth argparse drift remains `1.0.10` versus lock `2.0.1`; this is not
lockfile-exact dependency QA.

The scanner remains syntax-based and conservatively refuses names across a
whole file. It does not implement complete symbol or runtime data-flow analysis.
Its census depends on configured source roots and recognizable `.from().select()`
chains; `src/test` is excluded. Computed imports and unsupported module forms
can remain unknown. Embedded-resource/view columns, installed schema, RLS,
actual query results, recovery and visible workflows remain outside this proof.

The parent-reported earlier diagnostic retains five failed cases across four
files, 1,662 skipped cases and 40 pending cases after two fork errors. The
earlier reports and this lane's initial controller error remain preserved.
This focused correction does not clear historical results or accept the full
integrated candidate. The parent owns fresh full QA and integration.

No nested delegation, broad audit, provider request, full suite, build, live
RLS, database, preview, browser, application service, hosted change, PR, push
or main merge runs here. The parent worktree `t3-0f743997`, its dependencies,
canonical source and active services remain untouched. Canonical dependency
access is limited to the authorized read-only borrowing above.
