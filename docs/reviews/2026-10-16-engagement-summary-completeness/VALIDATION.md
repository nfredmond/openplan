# One finite source-validation window

October 16, 2026. This is focused source evidence, not installed acceptance.

## Grant and terminal custody

Root source-reviews the candidate, selected tests and prepared runner before
granting the exact preparation manifest
`6eea50d7d72cce5e8cab75dac9a2158fbeec2dd2d7a22369444aa2f47c0abaab`.
Root creates `trial01/grant.json`. The implementation agent does not rewrite it.
The dispatcher runs once, with a durable no-retry intent. No preparation-era
dependency, test, compiler, direction, lock or manager execution occurs.

Private evidence lives at
`/home/nathaniel/.local/state/openplan/engagement-summary-completeness-20261016/trial01`.
The manager unit is `op-m11-engagement-completeness01`, invocation
`3976044c3d2d4ee9b2eee220326eca25`. It ends at whole exit zero after 140.748
seconds. CPU time is 69.230 seconds. Main processes terminate with status zero;
the process-owned compiler lock releases at terminal exit. There is no second
lock acquisition, manager dispatch, retry, alternate or successor operation.

The manager applies 1 GiB memory, zero swap, CPU 50 percent, Tasks64 and a
600-second outer limit. The runner has its own 570-second dispatch budget and
bounded commands/streams. Kernel peak memory is 801095680 bytes, PID peak43,
with zero memory max, OOM and PID max events. The donor stays read-only at its
original path and over the pre-existing real empty ignored node_modules mount
point. No install, copy or chmod affects the donor.

All observed named source, host, prior proof and donor mounts are read-only
before the first dependency. Networking is unshared. HOME, caches, npm
configuration and temporary paths are private; environment keys are recorded.
Python uses `-B`; Vitest uses one fork worker. The only explicit device bind is
`/dev/null`, verified as 1:3, 0666 with a no-payload open/close. The saved mount
inventory contains 227 inherited writable mounts. Named read-only mounts do
not establish that all inherited submounts or the whole host are read-only.

## Passing checks and deliberate failures

The baseline has 46 selected passing cases. The first mutation only rewords a
reader comment. The same 46 cases pass and the harness reports SURVIVED.
Sixteen targeted source faults then produce 22 expected AssertionErrors. Every
accepted failure has an exact full test name drawn from the passing baseline,
zero passing selected cases, a recorded transform and a saved assertion
location. No runtime-error suite or generic nonzero exit is accepted as a kill.
The final restored46 run passes.

| Fault | Expected failures | Assertion location |
| --- | --- | --- |
| Ignore workspace echo | 1 | engagement-summary-completeness.test.tsx:104 |
| Ignore excluded invoice echo | 1 | engagement-summary-completeness.test.tsx:104 |
| Accept duplicate engagement identity | 1 | engagement-summary-completeness.test.tsx:104 |
| Convert exact aggregate text through Number | 2 | engagement-summary-completeness.test.tsx:43 |
| Turn missing contributors into zero | 2 | engagement-summary-completeness.test.tsx:66 and :67 |
| Classify permission failure as pending | 1 | engagement-summary-completeness.test.tsx:80 |
| Accept an incomplete envelope | 1 | engagement-summary-completeness.test.tsx:93 |
| Replace invoker with definer | 1 | engagement-summary-completeness.test.tsx:118 |
| Replace gross subtotal with net total | 1 | engagement-summary-completeness.test.tsx:125 |
| Remove invoice workspace predicate | 1 | engagement-summary-completeness.test.tsx:128 |
| Count the explicitly excluded invoice | 1 | engagement-summary-completeness.test.tsx:132 |
| Discard complete dashboard snapshot | 1 | engagement-summary-dashboard.test.tsx:40 |
| Send a foreign workspace from POST | 1 | receivable-invoicing-routes.test.ts:811 |
| Hide failed POST source state | 3 | receivable-invoicing-routes.test.ts:885 |
| Hide PDF source disclosure | 2 | client-invoice-pdf.test.ts:387 |
| Hide composer source disclosure | 2 | client-invoice-composer.test.tsx:92 |

The Number conversion fault demonstrates a specific cent loss. Its 501-input
aggregate changes `500999999999994.99` to `500999999999995`; the 1201-input
aggregate changes `1200999999999987.99` to `1200999999999988`. Source NUMERIC
inputs remain independently legal at `999999999999.99`. The supplied corpus
and mock scalar establish the reader's exact-text boundary, not native SQL
aggregation or transport behavior.

SQL faults use exact private copies of the candidate source, with one named
change each. The private Vite transform directs the unchanged SQL assertions
to that source copy and records the substitution. It executes no SQL. Other
faults transform the actual selected TypeScript module in memory. Source files
stay read-only, and final hashes prove all 22 source/configuration/test pins
and all seven preservation pins remain byte-identical. There are no physical
source mutations to discard. The finalizer also clears the active transform.

The focused TypeScript closure exits zero in 24.949 seconds. It includes the
actual setup and dialog shim and retains the project's strict compiler
settings. It is not full configured compilation. Focused lint exits zero in
9.850 seconds with empty stdout/stderr. Nested product direction exits zero
in 1.800 seconds; expired jurisdiction/capability reminders, review/package
version difference and substantive-change reminders remain visible. No date,
commit or review record is changed to obtain that result.

## Changed tests and blind categories

`engagement-summary-completeness.test.tsx` adds 25 reader, scalar DTO, bucket,
zero/absence, error, markup and SQL-intent cases. Its finite corpus and mocked
responses do not verify Postgres NUMERIC serialization, installed ACL/RLS,
query cost or database snapshot behavior. Its lexical SQL guards do not prove
arbitrary semantic equivalents or every possible SQL fault.

`engagement-summary-dashboard.test.tsx` adds two calls to the actual server
lane. It inspects the actual workspace RPC arguments, register projection,
workspace filter, created-at order, cap and returned NTE-bar props. It proves
that complete scalar totals do not come from the 500 visible register rows.
Its mock SDK and shallow element inspection do not establish navigation,
network transport, rendered child behavior or RLS.

`receivable-invoicing-routes.test.ts` adapts eight existing warning/arithmetic,
currency and audit cases to explicit scalar fixtures and adds three failures.
Numerical, currency, warn-only creation and audit assertions remain. Obsolete
summary row-projection expectations become actual RPC argument assertions and
no-row-fallback checks. Prior read invocation precedes insert. The 45/91/100
labels now identify scalar fixture totals, not database retrieval trials.
Mock writes do not prove a transaction, live caller authority, concurrent
creation, original source-cost identity or reconciliation.

`client-invoice-pdf.test.ts` adapts two assembly cases and adds two source
failure disclosures. It retains exact gross/remaining, currency, missing bucket,
invalid ceiling and readable draft assertions. It now checks actual snapshot
arguments and the engagement workspace predicate. RenderReportPdf remains
mocked, so this proves HTML assembly and response behavior, not native PDF
layout, delivery, byte custody or full-document atomicity.

`client-invoice-composer.test.tsx` extends only the fetch fixture and adds two
successful-save source disclosures. It exercises the actual composer and
refresh while preserving warn-only behavior. It does not establish a real
browser, API server or human interpretation. The unchanged exact-money test
file contributes only two selected gross-attribution/empty-zero compatibility
cases for the extracted summary composer; no previous campaign repeats.

Controls cover the named boundary groups and selected assertions. They are not
an exhaustive mutation census of every retained assertion, status transition,
currency interpretation, legal term or financial requirement. Full raw failure
messages and column-specific assertion locations are in
`fault-observations.json`; full terminal and restoration receipts stay private.
The private evidence manifest seals 2879 files after terminal exit.

## Remaining acceptance

No native DB/SQL, RLS/Auth, raw HTTP/SDK, Storage, helper/service, provider,
browser, build, full suite, hosted operation or installation runs. SQL20 stays
an unreleased 423rd source migration. The separate native prerequisites retain
their actual final-donor/history binding requirement. Root owns a new
independent review of the local checkpoint. No join, push, PR, main update or
release follows this window. Full M11/CORE-PM-01 and V1 remain open.
