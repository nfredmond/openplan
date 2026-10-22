# Project budgets retain exact cents through calculation and display

October 16, 2026. This is an isolated implementation candidate for the cent
errors reproduced in the [root arithmetic report](../2026-10-16-project-budget-cent-arithmetic/REPORT.md).
Fresh independent review precedes integration. This report does not accept
native finance behavior, M11, CORE-PM-01, KL-023 or v1.

## Candidate and ownership

The assigned checkout is
`/home/nathaniel/.t3/worktrees/openplan/t3-88a8a5f3`, branch
`t3/project-budget-exact-money-correction`. It starts clean at
`05dd3e8da4a4572437f06e771b0a2477873e681f`. An ancestry check and local ff-only
merge admit exactly `0ceedbbd174edb557e90b5bf6a144592e8120bb4`, matching the
read-only root readback checkout. No remote operation runs.

Application tree: `98535591a5a5916e0ffaef4125196366d3816410`.
`SOURCE_SEALS.json` binds the owned production and test files to their bytes
and Git blobs. The final commit identity belongs in the handoff receipt, outside
its own self-referential commit content.

Ownership covers the existing money helpers, `budget.ts`, `portfolio.ts`, the
project currency helper, budget panel, delivery board, focused tests, this NEW
report directory and private proof root
`/home/nathaniel/.local/state/openplan/project-budget-exact-money-correction-20261016`.
The loader `budget-queries.ts`, SQL19, all migrations, other checkouts and old
reports remain outside this implementation. Root owns the separate invalid
stated-budget correction identified in review
`e5f69c366ac2645fb2ddf88ffd69a64744db75d7`. Its later join needs fresh combined
checks and independent review.

The full root report and evidence manifest are read. All 113 private hash, byte-length and mode pins match,
and the frozen candidate's six production source hashes still match their
receipts. The underlying `ae3f4c72d5d4e17f3aa9970a0cef2d8f9afd7dd1` candidate
remains frozen. Those unchanged files are distinct from this assigned repair
checkout's intentionally changed money and budget owners.

Product authority remains AGENTS.md, the V1 contract, roadmap M11, CORE-PM-01,
architecture, capability matrix, known limitations and October 6 direction
review. The nested package direction check passes with its existing reminders.
No reminder date, milestone, requirement status or claim tier changes.

The corrected readback retains numbers for the ordinary, 2/19/33/49/89-row
cases. It retains decimal strings for 79/90/101/1,001 rows, including two cases
whose integer cent totals are still within Number.MAX_SAFE_INTEGER. All 11
displayed values match the independent reference.

## Exact accumulation also needs an exact representation

`optional-amount.ts` now owns decimal parsing, BigInt cent arithmetic and the
JSON-safe `ExactMoneyAmount` type, `number | string`. It preserves the existing
`parseOptionalAmount` used for progress and other established callers.

Money parsing reads decimal digits directly. Sums accumulate integer cents.
Subtraction and comparisons use those same integer cents. Required missing,
malformed, negative and fractional-cent budget inputs fail explicitly. Absent
optional budgets remain null, and an entered zero remains zero. An invalid
record does not become a successful zero or disappear from a sum.

An aggregate returns a number only when it is finite, its shortest decimal
spelling reconstructs the original cents, and `toFixed(2)` reproduces the exact
cent text. Otherwise it returns that decimal text. This is stronger than
checking Number.MAX_SAFE_INTEGER on aggregate cents. The tests also reconstruct
amounts after JSON serialization. Ordinary numeric results remain compatible
where these checks permit them. BigInt remains internal and never enters JSON.

Every affected monetary consumer uses exact helpers. `budget.ts` applies them
to direct spending, sent/paid billing, separate draft billing, deliverable
budget totals, remaining amounts and over-budget attention. `portfolio.ts`
retains exact numerator and denominator amounts and computes its displayed
percentage from integer arithmetic. Its existing stated-budget and complete
coverage rules remain in place. The portfolio table consumes that percentage;
it does not convert the monetary fields itself.

Pace verdicts cross-multiply the unrounded exact amounts against recorded
progress and the existing 10-point tolerance. Integer offsets avoid introducing
floating-point error when adding that tolerance to decimal progress. Displayed
percentages still round to two places. A one-cent crossing can therefore carry
the same displayed percentage on both sides while receiving different exact
verdicts. Over-budget status still outranks missing progress, and null/zero
budget refusals retain their precedence.

Actual cost remains direct spending. Billing and draft billing remain separate.
Deliverable attribution, unallocated/stale project spend, source identities,
invoice statuses and the disclosed exclusion of unknown billed-line attribution
remain unchanged. No rows or amounts are capped to make arithmetic pass.

## Formatting preserves digits and currency meaning

`formatMoney` parses decimal amounts without converting their digits to Number.
It rounds integer decimal units half away from zero at the requested precision.
Intl receives exact BigInt whole units through `formatToParts`; the formatter
supplies the exact fractional digits. Small negative values retain their sign,
including when their displayed magnitude rounds to zero. This does not depend
on a browser accepting the decimal-string Intl overload.

The record's currency, existing USD default, pinned en-US locale, required
precision, symbol/code choice and malformed-code fallback remain in the shared
formatter. JPY uses zero fractional digits and KWD uses three. Whole and auto
modes retain their rounding behavior. Range ordering also compares exact decimal
values. The project `fmtCurrency` helper passes through exact strings and uses
the shared absent-value contract instead of parseFloat and a zero substitute.
The existing ungrouped spelling in budget attention sentences is preserved.

The delivery-board cost chip now says `Direct spending`. Its value is the
existing direct-cost field. Forms, roles and touched-field-only writes are
unchanged; the existing control tests remain part of focused validation.

## Validation and retained failures

See [VALIDATION.md](VALIDATION.md) and `evidence.json` for commands, outcomes,
resource receipts, controls and source seals. `The final unit exits zero in 102.149 seconds. Scoped strict TypeScript, focused zero-warning lint and all 175 selected tests pass. All 11 supplied-transport cases match exact references, JSON roundtrips and displayed money. Actual cgroup peak memory is 485,269,504 bytes, with zero memory events. The unit releases the compiler lock before report sealing.`.
The before probe reproduces all six reported errors through the production
loader and calculator over supplied RPC rows. Its exit zero means completion
with retained mismatches, not correct arithmetic.

The private proof retains failed preparation and validation trials. The first
npm command rejects one empty config reused as both user and global config.
The first focused run catches an unintended grouping change in a pace sentence.
The initial tight type configuration cannot resolve two explicitly named test
type libraries from its private location. The first mutation report parser
expects a field absent from this Vitest version. The first added resource
wrapper cannot inspect PID 1's network namespace. A later label mutation reaches
the intended missing-label query, but its failure is a Testing Library query
error rather than the assertion class required by the control reader. Each
trial remains recorded; none is called a passing check. The label control now
uses an assertion over a nullable query.

Compiler coordination is separate from arithmetic. Root requests a brief lock
window for its combined check and bootstrap correction. The already-running
campaign finishes and restores its edits. This implementation holds further
lock-taking checks until root confirms that window. Root then grants the next
window, and this implementation uses one nonblocking acquisition with a
180-second maximum. No other process, service or lock is changed.

## Evidence limits and later join

These are source, supplied-transport and jsdom checks. They cannot establish
native NUMERIC typmods, native JSON transport, grants/RLS, concurrent snapshot
consistency, browser-specific Intl behavior or identified desktop/390px
navigation. Usable exports and practitioner financial reconstruction remain
open. No build, service, native SQL/database/Docker fixture, browser,
account/provider/cloud operation, install, push, PR, integration merge or release
runs in this assignment. No nested delegation runs.

Callers of `ExactMoneyAmount` must continue to use exact monetary helpers;
arbitrary Number coercion or arithmetic would discard this guarantee. Currency
rounding remains display-only. This correction cannot recover digits an
upstream system already lost before the calculator receives its input. Large
synthetic calculator budgets used for subtraction/comparison tests do not claim
that individual native budget columns accept aggregate-sized amounts.

Root's loader correction is disjoint. Join the independently reviewed commits
later, retain both reports and rerun the relevant combined checks. The complete
input candidate and all original evidence remain unchanged.
