# Decimal-scale correction stays within the two money helpers

October 16, 2026. This candidate addresses P2-1 from the independent review of
`360420ac42f34d2514bec91a0cd796804a8bd78f`, app tree
`98535591a5a5916e0ffaef4125196366d3816410`. The bounded validation unit exits zero. All 184 selected
tests, scoped strict types and focused lint pass. Fresh independent review of final bytes precedes
integration and native acceptance.

## Ownership and source custody

The NEW assigned worktree is
`/home/nathaniel/.t3/worktrees/openplan/t3-dd644852`, branch
`t3/money-decimal-scale-correction`. It starts clean at
`05dd3e8da4a4572437f06e771b0a2477873e681f`. An ancestry check succeeds before a
local ff-only advance to exact `360420ac42f34d2514bec91a0cd796804a8bd78f`.
T3 metadata confirms that assigned binding and GPT-6.1 Sol with high reasoning.
No nested agent runs. The final application tree is
`9c6185b267e3f14e8e2a4689137059659750f67a`. `SOURCE_SEALS.json` binds the three
changed source/test files; `evidence.json` pins 84 private files at sealing.

Ownership covers existing `optional-amount.ts` and `format.ts`, the NEW focused
`money-decimal-scale.test.ts`, this NEW review directory and NEW private root
`/home/nathaniel/.local/state/openplan/project-money-decimal-scale-correction-20261016`.
The original author remains clean at `360420ac4` in `t3-88a8a5f3`. The independent
review remains clean at `e824e1968` in `t3-7163fdbc`. Loader, SQL, migrations,
pages, editors, other checkouts and all earlier reports stay outside this patch.
The separately approved stated-budget isolation patch is not imported.

The full original arithmetic REPORT/evidence, author REPORT/VALIDATION/
SOURCE_SEALS/evidence and independent REPORT/VALIDATION/SOURCE_SEALS/
EVIDENCE_SUMMARY are read. The initial and final audits match nine author source seals,
126 author private pins, 113 original arithmetic pins, four independent public
files and 18 independent private pins. The independent REPORT SHA-256 is
`5ec697e59e1bb0d85fc4f21a41575fb478b4026e2abcc35b7660bbe2ab85ff20`;
its evidence SHA-256 is
`e9ef120a2a8d43a14ac71c762521408ef2233d725f9e80a0a7bba9cb61c4de37`.
All 19 original decimal-scale diagnostic pins also match. Old failed harness
and mutation-reader trials remain unchanged and are not regraded.

## Repair decisions

`ExactDecimal.scale` becomes an internal BigInt. Fraction length minus exponent
therefore stays exact above Number.MAX_SAFE_INTEGER. Exponent strings retain
the finite-input check. Plain decimal aggregate strings retain their exact
digits without conversion to Number. A zero coefficient normalizes its scale
before any power. A nonzero positive exponent can expand only after its finite
magnitude check. No exponent, amount or row cap is added.

Rescaling examines the coefficient's digits before allocating a denominator.
An exact requested scale returns null for fractional units. Converting a
discard distance to a string index happens only after it is bounded by the
supplied coefficient length. Required money
converts that refusal to its existing fractional-cent error. Display rescaling
uses the first discarded digit for half-away rounding. A discard distance beyond
the supplied coefficient returns zero directly. Signed zero remains a display
fact, including negative tiny values. Auto mode checks exact whole-unit
integrality through the same helper.

Range ordering compares signs, decimal orders and aligned supplied digits.
Alignment extends only to the longer supplied coefficient. It never constructs
powers from a range endpoint's exponent. Equality also treats signed zeros as
the same numeric value. All helper consumers are searched. Apart from the two
money modules, no existing source consumes `ExactDecimal` or `parseExactDecimal`.
`compareMoneyPercent` still accepts a finite number, whose decimal scale is
bounded by that number's spelling. Its exact ratio and ten-point offset remain.
The public money representation remains JSON-safe `number | string`.

Recorded currency, USD default, en-US display, symbol/code choice, JPY zero
fractional digits, KWD three digits and malformed-code fallback remain in the
existing formatter. Direct spending, billing, pace, null and zero retain their
existing owners and meanings. No dependency is added.

## This candidate passes the bounded correction checks

The nine new tests pass. Each has an intended failing mutation on the exact
final source. A harmless comment survives all nine tests; the restored baseline
also passes. Eight faults fail at their named assertions. Removing zero
normalization instead raises the intended immediate BigInt-size RangeError in
the named zero-exponent test. No large successful power allocation is attempted.

The production two-module probe retains the original `360420` RangeError and
confirms corrected `$0.00`, ordinary controls and nonfinite refusal. Harmless
compiled annotations and restored compilation repeat the corrected results.
All 184 tests in nine relevant files pass, including the retained 11 cent cases,
existing project/portfolio/loader/DOM tests and the nine new scale tests. Scoped
strict TypeScript and zero-warning lint pass. This is not a full suite or build.

The owned unit reaches terminal zero in 58.897 seconds. Actual peak memory is
477,630,464 bytes with zero memory events. Actual limits are 1 GiB, zero swap and
CPU50. The donor mount is read-only and the network namespace is unshared. The
compiler flock releases with the terminal unit, and root receives explicit
release notice. No unexpected source or harness failure, automatic retry or
second acquisition occurs.

## Findings and evidence boundaries

The independent review establishes one P2 and no P1 or second P2 in its scope.
Root's actual two-module diagnostic supplies `1e-9007199254740991` directly to
production formatter exports. Old `0ceed` returns `$0.00`; exact `360420` throws
`RangeError: Maximum BigInt size exceeded`. Ordinary zero, `1e-100` and nonfinite
`1e309` controls remain. Root's corrected report at `88a412fcc` distinguishes
its 99,344,384-byte in-probe sample from its later 104,587,264-byte recorder
sample. The terminal unit is zero because the diagnostic retains the failure,
not because the formatter passes. No OOM is observed.

The original auto, range and cent-validation power concerns are source
inferences before this correction. They are not separate original runtime
findings. The original independent audit supports 11 corrected cent cases and
175 selected tests. Its 24 named faults span candidate history; they are not all
exact-final reruns. This correction preserves those qualifications.

[VALIDATION.md](VALIDATION.md) records this candidate's commands, intended fault
failures, exact restoration, resources and limits. Native NUMERIC/RPC/JSON,
ACL/RLS, committed 1,201-row fixtures, snapshot concurrency, upgrade/restore,
identified desktop/390px navigation, browser Intl, usable exports and practitioner
finance remain open. M11, scientific, hosted and v1 acceptance remain open.
No full suite, app build, install, native SQL/DB/Docker, HTTP/service, provider,
account, browser, push, PR, main, release or paid infrastructure operation runs.
