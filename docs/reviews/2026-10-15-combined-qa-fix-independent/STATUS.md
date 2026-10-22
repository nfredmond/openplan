# Independent review finds one scanner scope gap

One P2 remains in the imported-projection scanner. No P1 is established.
The bounded copy and journal fixture review finds no additional issue.
This report does not accept the integrated candidate or replace parent QA.

## P2: named expressions can hide unknown projections

Location: `openplan/src/test/supabase-call-sites.ts:613–615`, with the
import fallback at lines 630–632.

`collectNames` records function and class declarations, but omits named
function and class expressions. Their names bind inside their own bodies.
The import fallback therefore substitutes an unrelated imported string when a
select argument actually refers to that function or class.

The private fixtures use these two files:

```ts
// columns.ts
export const COLUMNS = "id, jurisdiction_context";
```

```ts
// reader.ts
import { COLUMNS } from "./columns";
const read = function COLUMNS() {
  db.from("projects").select(COLUMNS);
};
```

The scanner reports `"id, jurisdiction_context"`. TypeScript's symbol checker
binds the argument to `FunctionExpression`, not `ImportSpecifier`. The same
failure occurs inside `const read = class COLUMNS { read() { ... } }`;
TypeScript binds that argument to `ClassExpression`. Both projections should
remain unknown. The original `b4` scanner reports `null` for both cases.

This is a guard defect, not an observed production query failure. It makes
invalid or otherwise uncheckable arguments appear column-checked and excludes
them from the unknown-projection growth check. No current newly resolved site
has this named-expression shadow pattern.

Extend the conservative name collection to named function and class expressions,
and add both cases to the resolver fixture. A private candidate patch adds
`ts.isFunctionExpression(node)` and `ts.isClassExpression(node)` to the existing
name-collection condition. All 19 independent cases then match expectations;
the full 2,008-site result remains byte-for-byte equal to the unpatched census.
No application or repository test receives this patch in this review.

## Source and scope

The assigned clean branch is `t3/review-combined-qa-fix-independent` in
`/home/nathaniel/.t3/worktrees/openplan/t3-33a0e222`. It fast-forwards locally
from `05dd3e8da4a4572437f06e771b0a2477873e681f` to integrated source
`06a108010ab39aa42eed4c2bcda3e1371b8aa813`. Review ownership covers this
directory and private probes. No nested delegation runs.

The reviewed diffs are the application changes from original combined source
`b4dbcac21a58f61bd480ccade4dec69383dacbc7` to source fix
`36de7771973c867a4ae09e1c9b56d3bbd7be719d`, plus journal test fix
`f4cd3247ef01b05120b0e78bd917c87d3c45e996`. All seven source-fix application
files and the journal test match their fix commits exactly at the integrated
head. The worker, connector, jurisdiction route, jurisdiction field constant,
manifest and lockfile match `b4`. Fourteen source bindings accompany the report.

Both full source reports are read:

- `docs/reviews/2026-10-15-combined-project-guard-fixes/STATUS.md`
- `docs/reviews/2026-10-15-synthesis-journal-umask-fixture/STATUS.md`

The repository instructions, planner-writing and prove-it skills guide the
review. The nested direction check exits zero, retaining the registry and
matrix age reminders, version mismatch and intervening-change reminders.
This repair does not reassess the product direction or change its dates.

The parent checkout `t3-0f743997`, its fresh dependency installation and its
running QA remain untouched. Separate workbook, main-327 and preview reports
remain outside this review.

## Independent checks support the bounded fixes

The new scanner retains all 2,008 select identities, including file, line,
table, argument expression, count options and write-following status. Every
previously known projection retains its value. Unknown projections fall from
250 to 181; exactly 69 become known. Independent TypeScript module resolution
agrees with the defining file and literal for all 69 sites, across 19 exports.
The migration inventory yields 1,802 checkable sites. The actual jurisdiction
reader retains its six fields and remains schema-checked.

The 19-case private scanner matrix covers named, renamed and `@/` imports,
static templates, mutable, computed, private and interpolated exports,
re-exports, type-only and package imports, parameter/destructured/rest bindings,
catch bindings, declarations before initialization, function declarations and
the two named-expression failures above. Seventeen cases match on current
source. A strict assertion exits one specifically for the two named-expression
mismatches. A harmless scanner comment preserves the same results. Disabling
literal import resolution creates four additional named mismatches. The
private candidate patch resolves both findings without changing the census.

The four copy edits retain the invalid-jurisdiction warning, labelled legacy
fallback, explicit unresolved state, separate assessments, declaration limit,
and the caveat that shapes establish neither jurisdiction nor surveyed
boundaries. The map still installs its attribution control. The wording uses
project boundary, shapes, map sources and jurisdiction assessment. No baseline
increases; the workspace baseline falls from 137 to 136. This is source review,
not a rendered-layout or practitioner-clarity acceptance claim.

The journal test now constructs a real `0644` file using `chmod`, checks its
permission bits, and invokes the real worker. It then constructs and checks
`0600`, requiring the journal validator's missing-`phase` union issue. Each
branch asserts that the supplied service's `from` method remains uncalled.
Production worker and connector bytes remain unchanged. The assertion
separates journal rejection from a later job validator's generic `ZodError`.

The private focused cohort passes 52 cases under `0077`: four copy, eight
projection and 40 worker cases. All 40 worker cases also pass under `0022`.
Harmless comments in the scanner and worker survive the 52-case cohort. After
all private mutations, the restored cohort again passes all 52 cases.

Twelve targeted fault trials each fail one named assertion with exit one:

- Disabled import resolution and accepting mutable exports fail the resolver
  fixture's exact projection comparison.
- Omitting `jurisdiction_context` fails the actual-reader six-field comparison.
- Adding one unknown projection fails `guards the guard` at `182 < 182`.
- Returning the workspace word fails the copy equality at 137 versus 136.
  Returning geometry fails that equality at 11 versus 10.
- Bypassing connector privacy fails the expected privacy error under each mask.
- Bypassing journal schema parsing fails the phase-specific match under each mask.
- Reading before the public-file refusal and before private-file schema checking
  fails the first and second no-read assertions, respectively, under `0077`.

The original journal fixture, overlaid only in the private snapshot, fails the
privacy assertion under `0077` and passes under `0022`. These are focused
single-case comparisons, not another full-suite run.

## Custody, resources and retained errors

Private source, runners, fixtures, raw logs and detailed receipts remain at
`/home/nathaniel/.local/state/openplan/combined-qa-fix-independent-20261015-01/`.
The snapshot comes from `git archive` of the integrated head. Mutations touch
only that snapshot or in-memory scanner modules. Every file mutation restores
exact original bytes in `finally`; all nine tracked mutation targets match
the source afterward. Source bindings and compact receipts are in
[`evidence.json`](evidence.json).

Runs are serial, use one Vitest worker, private caches, a 640 MiB Node heap,
a 1 GiB cgroup limit, zero swap and one CPU quota. Bubblewrap mounts borrowed
canonical dependencies read-only. The largest observed scope peak is
381,816,832 bytes; all scopes report zero swap peak and zero OOM events.
Native versions are Node `24.22.0`, TypeScript `5.9.3` and Vitest `4.1.11`.
The known borrowed Mammoth argparse drift remains `1.0.10` versus lock `2.0.1`.
These scoped results do not establish lockfile-exact dependency QA.

Two review-harness errors remain recorded. The first direct scanner loader
passes an unset module filename to Node's internal compiler and exits 134 with
`Assertion failed: args[1]->IsString()`. Setting that private loader filename
fixes startup. Separately, the first control driver stops after the correct
workspace failure because Vitest abbreviates its JSON message. The retained
full log shows expected 136 and received 137. A separate readback checks that
named failure and exact diff; the remaining controls continue with a driver
that also reads the full log. Neither error counts as a product failure or a
successful mutation kill.

## Limits and parent responsibilities remain open

The scanner parses syntax, not every runtime data flow. Directory/index and
explicit-extension module imports, re-exports, packages and computed values
can remain conservatively unknown. The existing census depends on its source
roots and recognizable `.from().select()` chains. It does not prove all database
reads are discovered. Embedded-resource and view columns, installed schema,
RLS, query results and recovery remain outside this guard.

The copy guard cannot see every prop, concatenation or visual condition.
The journal case covers POSIX mode bits and one malformed journal, not ACLs,
other owners, other operating systems, every schema branch or every side effect.
Its no-read assertion observes the mocked `from` method, not all possible RPC
or external effects. Worker fixture HTTP is local and synthetic; no external
provider runs.

The parent-reported original diagnostic remains 22,869 passing cases, five
failed cases across four files, 1,662 skipped cases and 40 pending cases after
two unhandled fork errors. The thematic authority/job cases remain a separate
parent investigation. This review neither reruns nor clears those outcomes.

No full suite, build, database, application service, browser, provider operation,
hosted mutation, dependency install, PR, push or main merge runs in this lane.
The parent owns fresh full QA, operational acceptance and any source correction
for the P2 above. This local report commit changes no application source.
