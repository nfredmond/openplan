# PR330 report source guard correction

October 15, 2026. Local implementation, without push or PR mutation.

## Failure and source correction

Both completed jobs in CI run `38773672471`, against
`75931937aa85950da68577abef1246d7f3c8ff13`, fail the same two assertions.
Shuffled job `116556241675` uses seed `723279`; default QA job `116556241944`
also fails. Each records 22,969 passed, 1,662 skipped and two failed tests;
1,661 passed, 106 skipped and two failed files. These are source guard failures.
No evidence in these failures establishes order-dependent state.

The projection guard finds 182 unresolved projections and requires fewer than
182. The route's new computed initial projection adds an unresolved site. The
pending-schema guard finds the route's new private missing-column regex. The
prior 217 focused tests and whole-tsconfig result do not accept this CI head.

The initial report project projection is now one complete string literal. It
preserves all 28 fields and their order. The existing scanner can resolve it
without a scanner change. The dynamic fallback remains honestly unresolved.
The four optional groups, exact allowlist, current-projection membership check,
project predicate and maximum of four removals remain in the route. Tests compare
runtime and scanner projections with all expected fields and assert exact removal
of each optional group.

`readPendingSchemaMissingColumn` now lives beside `looksLikePendingSchema` in the
canonical Supabase helper. The boolean classifier stays byte-for-byte unchanged.
The route calls the parser and applies its existing optional-column allowlist.
No new classifier variant or private regex remains in the route. No guard limit,
allowlist, scanner implementation or assertion is removed or weakened.

The parser accepts the existing PostgreSQL and PostgREST message forms. A named
relation must match the supplied simple relation name. PostgreSQL's unqualified
column form carries no relation identity; callers must know that the failing
read targets their supplied relation alone. PostgreSQL supports unquoted relation
names with optional `public` qualification and simple, optionally quoted columns.
PostgREST requires the quoted table and column in its complete schema-cache
message. Identifier spelling is preserved, so a quoted mixed-case column cannot
silently become an allowlisted lowercase column. Aliases, other schemas, quoted
PostgreSQL relation names, complex identifiers, incomplete messages and unknown
message forms refuse narrowing. The parser identifies a column, not its existence
in a schema; the route's exact allowlist decides whether it may be removed.

## Ownership and verification

The assigned checkout is `/home/nathaniel/.t3/worktrees/openplan/t3-6c781934`,
branch `t3/pr330-report-guard-correction`. It starts clean at `05dd3e8da` and
fast-forwards only itself to `80943a00724b973d241b866d8f8e1a769be757cd`.
The integration checkout remains outside this lane's writes. Read assigned
AGENTS.md, newest external coordination records, product direction authority,
the prior report correction and its independent review. Planner-writing,
prove-it and any-place apply. No new place assumption or geography resolver enters.

Owned source comprises the report generate route, canonical pending-schema helper,
new parser tests and focused report-route tests. This directory contains the
public report, evidence index and executable source controls. Private receipts
and configuration live at
`/home/nathaniel/.local/state/openplan/pr330-ci-report-guard-correction-20261015`.
Both original CI logs stay at the parent's retained combined-checks directory;
the private index records their SHA-256 values and exact failure excerpts.

The nested product direction check passes with existing expiry, version and
intervening-change reminders. It does not refresh those reviews or lift a hold.
The pre-correction local replay reproduces exactly the two CI failures, with
34 other guard cases passing. The initial corrected run passes 180 tests across
five files, including all 101 previous report cases, nine new route cases,
34 parser cases and 36 existing guard cases, using seed `723279`.

The final restored-source run again passes all 180 tests with seed `723279`,
with no failures or skips. Scoped TypeScript and changed-file ESLint pass with
zero warnings. The largest final check peak is 834,564,096 bytes; retained checks
record zero OOM and OOM-kill events. The tested application tree is
`a13c491da3ad3ba5b237ca5fa8802b236c4ef27b`. Source and test SHA-256 bindings,
final restored-source results and mutation outcomes are recorded in
[evidence.json](evidence.json). The [control driver](verify_controls.py) holds
the shared lock across each source mutation, test execution and exact restoration.
It requires assertion failures with named diagnostics, rather than accepting
any nonzero exit. The harmless trial executes all 180 cases before fault trials.

The accepted controls comprise 15 executions: three harmless survivors and 12
broken-behavior executions covering 11 distinct faults rejected by their intended assertions. Making the initial
projection computed again recreates `182 < 182` failure and the direct scanner-parity failure.
Restoring the inline private parser recreates the classifier guard failure.
Dropping an initial place field fails exact projection parity. Dropping an extra
fallback field fails all four exact group checks. Returning no column fails all
seven supported forms, the generic relation case and quoted identity. Bypassing
either PostgreSQL or PostgREST relation matching fails direct parser and route
refusal assertions. Accepting unknown messages fails all 18 unknown-form and four
invalid-relation cases. Folding a quoted column's case fails parser identity and
route refusal. Accepting a permission-prefixed message fails parser and route
refusal. Changing the existing boolean classification fails the assertion for unchanged
behavior. Every trial restores exact source bytes.

The first relation and quoted-case controls select their direct parser tests but
miss route titles because the filter omits “without dropping fields.” Those three
receipts remain retained as incomplete route selections and are excluded from the
15 accepted executions. A supplemental campaign starts with another 180-case
harmless survivor, uses corrected filters and requires exact test counts. It
covers the parser and route assertions together, plus the permission-prefix case.
The original driver stays private; this directory contains the corrected driver.

The first restored-source focused run passes, then scoped TypeScript rejects the
new group test's tuple-inferred comparison argument with TS2345. The test now
explicitly types its rest parameter as `string[]`; this annotation changes no
runtime behavior or production source. The original compiler diagnostic remains
private. A third campaign repeats all 180 harmless cases and the four exact-group
fault assertions against the final test bytes. Evidence records both test input
hashes. The final focused, scoped TypeScript and lint checks use the final bytes.

All runtime, lint and scoped compiler checks use the existing shared compiler
lock. Each check runs in an owned transient user service with 1,536 MiB memory,
zero swap, 50 percent CPU and a 1,024 MiB Node heap. Vitest runs one worker with
file parallelism disabled. The actual process cwd is nested `openplan/`, which
is essential for the classifier guard. The host and donor dependencies are
read-only in the check sandbox; only this lane's private outputs are writable.
The network is isolated. No installation, download or donor write occurs.

## Evidence limits and retained boundaries

The source guard sees literal projections, not computed fallback values. Exact
fallback projection tests use a database double; they do not prove installed
columns, native message variants, PostgREST behavior, live RLS, authentication,
transaction consistency or schema-cache recovery. Parser tests cover their named
message forms and explicit refusals, not every database locale or SQL identifier.
The classifier source guard detects its enumerated source patterns; it is not a
semantic proof against every possible private classifier implementation.

The route tests inspect actual generated synthetic HTML and custody metadata.
They preserve unread jurisdiction's hashed SCHEMA-PENDING object, independent
place/cost/site behavior, malformed jurisdiction refusal, failed-read refusal
and the ordinary strict reader. They do not establish browser layout, desktop or
390px use, accessibility, live Storage, actual downloads, PDF typesetting,
practitioner acceptance or native artifact behavior on this changed source.
Scoped TypeScript and changed-file lint do not cover the entire application,
generated build types, build output or the complete suite.

This lane performs no database, browser, app service, build, full TypeScript,
full suite, hosted, provider, configuration or migration operation. It does not
push, update a PR, merge or release. The parent owns integration and CI watching. T3 administratively links PR330
to this implementation thread; no GitHub content changes.
Frozen APP49, prior app tree `c89e9ec4eeddfc973641e8683df7bc9d38113838`, workbook
proof `2ce251264` joined at `72b119cc9`, database OID `6165620` at 419/latest16,
and the six stopped helpers retain their original evidence boundaries. The
protected database/file/fixture matches and unresolved full-catalog `pg_class`
digest difference remain unchanged and unaccepted. This source correction does
not accept those results or lift the 420 versus 418 promotion hold.
