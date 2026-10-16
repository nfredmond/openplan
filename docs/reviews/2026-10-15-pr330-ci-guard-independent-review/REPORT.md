# PR330 CI guard correction independent review

October 15, 2026. **No reproducible material P1, P2 or correctness regression
found in the bounded correction.** The disposition covers source and retained
synthetic/process evidence. It does not accept runtime behavior on the new head.

## Reviewed source and ownership

- Reviewed integration head: `2046fca9aa1dde80043fe39075f00c6fc7512e54`.
- Application tree: `a13c491da3ad3ba5b237ca5fa8802b236c4ef27b`.
- Implementation: `9f8278347698f61d3b813df805d56abd87fa11fb`, based on
  `80943a00724b973d241b866d8f8e1a769be757cd`.
- Assigned checkout: `/home/nathaniel/.t3/worktrees/openplan/t3-47eaba3a`,
  branch `t3/pr330-ci-guard-independent-review`.
- Initial head: `05dd3e8da4a4572437f06e771b0a2477873e681f`, clean before an
  ff-only advance to the reviewed head. No fetch or other checkout update.

Reviewer writes stay within this directory and private
`/home/nathaniel/.local/state/openplan/pr330-ci-guard-independent-review-20261015`.
Read assigned AGENTS, newest external coordination banners, relevant direction
and architecture authority, the complete correction diff, implementation STATUS,
evidence, control driver, private runner/configuration and retained receipts.
The prior report P2 correction and its independent review provide context, not
acceptance of this new parser. Planner-writing, prove-it and any-place apply.
No nested delegation, source/test write, cache cleanup or dependency setup occurs.

## Parser and report behavior

`openplan/src/lib/supabase/pending-schema.ts:78` adds a column identity parser
beside the existing boolean classifier. The complete pre-change helper remains
an identical byte prefix. The new parser calls that classifier, then requires
one of two anchored missing-column message forms. It does not narrow ordinary
boolean classification for other callers.

For PostgreSQL, the parser accepts an unquoted named relation with optional
`public` qualification, or the documented unqualified column form. A supplied
relation must be a simple lowercase identifier. Any relation actually named in
the message must equal it. For PostgREST, the complete schema-cache message must
name the matching table. Matching quote pairs and simple column names preserve
column spelling. A mixed-case quoted name cannot become the route's lowercase
allowlisted name. Other relations/schemas, quoted PostgreSQL relations, aliases,
complex identifiers, permission-prefix/suffix text and unknown forms refuse.

The unqualified PostgreSQL form contains no relation identity. The helper states
that limitation, and this caller's query reads only `projects`. This is an
explicit caller assumption, not a general proof that an arbitrary error belongs
to a relation. Matching relies on message text, not SQLSTATE; native messages,
locales and unusual identifiers remain outside the accepted coverage.

At `openplan/src/app/api/reports/[reportId]/generate/route.ts:1638`, the route
passes the project read error to the canonical parser. Its unchanged four-group
allowlist also requires the named column to remain in the current projection.
It removes exactly that group and retains the project ID predicate. Four
iterations bound recovery after the initial read. Unknown/core columns,
unclassified errors and failed fallback reads still refuse generation.

The initial literal at route line 151 preserves all 28 fields and their order.
Tests compare the real initial query with the source collector and expected
fields, then assert exact removal of each optional group. The dynamic fallback
remains explicitly unresolved by the source scanner. The annotation-only test
change reconstructs the recorded pre-annotation hash exactly; production route
and parser bytes match across those input variants.

The report-specific pending payload, HTML renderer, ordinary strict jurisdiction
reader and place-column registry match the correction base byte for byte.
Jurisdiction-only recovery retains readable place/cost/site fields. Place-only
recovery still validates jurisdiction. Retained tests inspect actual synthetic
uploaded/stored HTML and metadata, separate read states, canonical hashes,
malformed context refusal and artifact refusal after read errors. No geography
literal, alternate resolver or authority inference enters this correction.

## The guard boundary stays intact

Both retained CI logs from run `38773672471`, head `75931937a`, record the same
two failures and 22,969 passed, 1,662 skipped tests. Shuffled job
`116556241675` uses seed `723279`; default QA job `116556241944` fails the same
source checks. These records do not establish an order-state defect.

The three guard/scanner files match their original hashes and base bytes.
The unresolved-projection assertion still requires fewer than 182. Making the
initial projection computed again produces 182 and the intended guard failure,
alongside direct projection-parity failure. The corrected tree therefore has
181 unresolved sites, including this route's remaining computed fallback.

The classifier guard still excludes the canonical module, rejects new private
inline regex files, pins named variants and retains its existing allowlists.
The route now calls a canonical helper whose parser also calls the ordinary
classifier. This centralizes the narrower identity operation at the existing
seam. It does not rename a private route detector to evade the guard. Restoring
the route's inline parser reproduces the intended ratchet failure. No threshold,
scanner, allowlist or assertion is weakened.

Neither guard proves arbitrary semantic safety. Projection checks omit computed
values, embedded resource columns and the inventory's excluded views. The
classifier scan recognizes its enumerated source patterns and exempts the
canonical module. Parser and route assertions provide the distinct behavioral
boundary for this canonical addition.

## Retained evidence readback

The private independent readback reconciles 52 unique file bindings. They cover
current source/tests, unchanged guards/scanner, preserved report helpers,
original CI logs, final check receipts, accepted control reports and drivers.
It checks underlying assertions, selected counts, intended diagnostics, process
exit codes, working directories, memory/CPU/swap settings and read-only root
mount records. It also checks campaign restoration hashes and final source hashes.
This reads retained implementation results; it does not rerun them.

The final retained run records 180 passing tests, zero failed or skipped:
34 parser, 96 route, 14 HTML and 36 existing guard cases. Its seed is `723279`.
The earlier local guard replay records the expected two failures and 34 passes.
Final scoped TypeScript and changed-file ESLint receipts record zero exits.
The largest final peak is 834,564,096 bytes; inspected process receipts record
1,536 MiB memory, zero swap, 50 percent CPU, a 1,024 MiB Node heap and zero OOM
or OOM-kill events. Vitest uses one worker without file parallelism.

All 15 accepted control executions match their reports: three 180-case harmless
survivors and 12 fault executions covering 11 distinct faults. Intended failures
cover computed projection, private inline parser, omitted initial field, extra
fallback omission, missing parser result, both relation bypasses, unknown-form
acceptance, quoted-case folding, permission-prefix acceptance and boolean drift.
The three initial incomplete route selections remain excluded. Corrected
supplemental filters select both direct parser and route refusal assertions.
The final typed campaign repeats the harmless run and all four group assertions
against the final annotation. The retained initial TS2345 remains a failed
compiler attempt, not acceptance of the final test bytes.

The readback's own controls accept harmless metadata and reject a wrong digest,
a wrong selected-test count and an absent intended diagnostic. Original sample
objects and retained evidence bytes remain unchanged afterward. These controls
protect this artifact audit, not product behavior or receipt authenticity.
Private script/result hashes and public source pins are in
[evidence.json](evidence.json).

The reviewer runs `npm run product:direction:check` from nested `openplan/`.
It exits zero with existing expiry, version and intervening-change reminders.
Those reminders remain unresolved by this review. No fresh product probe is
needed after source and retained-receipt review.

## Limits and disposition

The database double makes omitted fields observable but supplies its own error
messages. This review does not establish installed columns, native PostgREST
behavior, schema-cache recovery, RLS, authentication or transaction consistency.
Synthetic emitted HTML/custody does not establish browser layout, 390px behavior,
accessibility, PDF typesetting, live Storage, downloads or practitioner acceptance.
Receipt consistency does not establish an independently observed runtime rerun.
Scoped types/lint and focused tests do not accept the entire application.

No database, browser, app service, build, full TypeScript, full suite, hosted,
provider, configuration or migration operation occurs. No push, GitHub content
change, comment, merge, tag or release occurs. T3 administratively links PR330.
Parent-owned combined 296 focused checks, full TypeScript and new GitHub CI stay
separate from this review's disposition.

Frozen APP49 and prior `c89e9ec4eeddfc973641e8683df7bc9d38113838` evidence do not
accept this head. Native workbook proof `2ce251264`, target OID `6165620` at
419/latest16, its accepted bounded values and unresolved full-catalog `pg_class`
difference retain their original boundaries. That digest difference remains
unaccepted with cause unknown. Memory-preview preparation `97c310944` remains
preparation only, unsealed and bound to obsolete c89 source. No preview stage
runs here. The 420 versus 418 promotion hold remains. Canonical unrelated work,
demo, frozen packets, database source anchor and others' processes remain outside
reviewer writes.
