# Decimal-scale correction receives bounded source approval

October 16, 2026. No P1 or P2 finding is established in this new independent
review. Approve exact `7cc519c584a9c585db4a35266c84f5b083bcace0` for later reviewed
integration. Its application tree is `9c6185b267e3f14e8e2a4689137059659750f67a`;
its parent is `360420ac42f34d2514bec91a0cd796804a8bd78f`. The original P2-1
formatter objection is addressed within the inspected source and pure-unit
boundary. Native finance, browser and whole-product acceptance remain open.

## The review owns new documents and private evidence

The assigned checkout is `/home/nathaniel/.t3/worktrees/openplan/t3-2fd1bd90`,
branch `t3/review-money-decimal-scale-correction`, starting clean at
`05dd3e8da4a4572437f06e771b0a2477873e681f`. Its application tree remains
`1e0b6522002b2485d37086790808c0217ff77cfe`. Ownership covers this NEW review
directory and NEW private root
`/home/nathaniel/.local/state/openplan/project-money-decimal-scale-independent-20261016`.
The author remains clean at the reviewed commit in `t3-dd644852`. No author,
application or other root file changes. GPT-6.1 Sol runs at high reasoning;
no nested agent runs. No integration, push, PR, main or release operation runs.

The subject comes from exact Git into a private source overlay. I read the
complete changed application/test diff, both money helpers, new test, original
and correction REPORT/VALIDATION/SOURCE_SEALS/evidence, and preceding independent
REPORT/VALIDATION/SOURCE_SEALS/EVIDENCE_SUMMARY. I inspect the original arithmetic
report and its exact private pins, not broad histories. Source context includes
all internal decimal consumers, budget/portfolio arithmetic, project currency
wrapper and the retained shared-formatter consumer inventory.

AGENTS.md, planner-writing, prove-it and any-place guide the review. Product
authority includes the V1 contract, ROADMAP M11, CORE-PM-01, capability matrix,
known issues, architecture and October 6 direction review. No authority,
tolerance, scope or claim tier changes. The structural direction check passes
within the partial overlay, with its existing reminders and omissions disclosed
in [VALIDATION.md](VALIDATION.md).

## The correction addresses the actual scale failure

Internal BigInt scale preserves fraction length minus exponent, including
`0.01e-9007199254740991`, whose scale is exactly 9007199254740993. Zero normalizes
before expansion. Nonzero positive-exponent expansion follows the finite-input
check. Plain decimal strings retain values beyond Number's finite range.
No amount, exponent or row cap is introduced, and no exact aggregate becomes
floating-point arithmetic.

Rescaling discards supplied coefficient digits. It detects a fractional cent
without allocating a denominator, rounds half away from zero for display, and
returns zero directly when the discard distance exceeds the coefficient length.
The conversion to a Number index occurs only after that distance fits the
supplied string length. Auto precision uses exact whole-unit integrality.
Range comparison uses sign, decimal order and aligned supplied coefficients;
it does not construct cross-powers from endpoint scales.

The exact source search finds existing scale/parser consumers only in the two
money modules. Required cents, optional amounts, sum, subtraction, comparison,
JSON representation and formatters therefore share the changed parser. The
remaining power in `compareMoneyPercent` receives a finite number, whose decimal
spelling bounds its scale. New execution covers the smallest positive numeric
percent and zero, along with the existing ten-point boundary. This is not an
unbounded string-exponent path.

Node execution confirms the original supplied tiny string formats as `$0.00`
on this correction. Negative tiny strings preserve their displayed sign;
required-cent parsing still refuses fractional cents. Enormous signed zero
exponents, malformed/nonfinite inputs, trailing zeros, carry rounding, currency
minor units, default/code/fallback behavior and range order retain their stated
meanings. USD and en-US remain existing defaults; recorded JPY and KWD precision
remain data-driven. No place-specific rule is added.

## Independent arithmetic agrees with the focused candidate

A Python Fraction oracle generates 123 exact rational fixtures and all 15,129
ordered pairs. It supplies expected cents, integrality, half-away rounded USD,
JPY and KWD text at cents/whole/auto precision, and exact pair order. The Node
probe transpiles the actual two production modules and compares their exports
with those independently generated references. It also checks literal extreme
exponents, a 321-digit plain amount, signs, invalid strings, missing values,
JSON reconstruction, the 11 original cent references, exact subtraction and
comparison, and pace boundaries.

Baseline and harmless comment pass. Three targeted faults fail their intended
AssertionErrors: omitting half rounding, converting fractional cents to zero,
and dropping negative range-order inversion. Exact bytes restore in `finally`;
the restored oracle passes. The nine new candidate tests then pass without
failures or skips. No 184-test/full-suite rerun, type check, lint or build runs
in this review. The author retains those selected type/lint/184-test receipts.

Budget and portfolio source preserve direct cost separately from sent/paid and
draft billing, attribution/disclosure, missing versus zero budgets, coverage,
stated-budget precedence, remaining balances and exact pace verdicts. Those
consumers do not change in this correction. Their retained 184-test evidence
is inspected, not presented as this review's new execution. The separate
stated-budget isolation patch and inherited staged root files are not imported.
Loader and SQL19 remain unchanged; their native claims remain open.

## Evidence identities and qualifications remain intact

The audit matches three current source/test SHA-256, byte-length and Git-blob
seals, 84 current private pins, nine original author source seals, 126 original
author private pins, 113 original arithmetic pins, four preceding independent
public files, 18 preceding independent private pins and 19 original root scale
diagnostic pins. Final reinspection confirms preservation. Pin claims cover
listed files, not excluded scratch/cache trees or later post-commit receipts.

Current author REPORT SHA-256 is
`3e5b42bd30bafb4158c39f1187204f658db94d448f97b931ea609941258d10e1`;
current evidence SHA-256 is
`7465b584510b2bfba1ed27e3543959d65242c1123fe09155ebdda0814fc5d50b`.
Earlier independent REPORT remains
`5ec697e59e1bb0d85fc4f21a41575fb478b4026e2abcc35b7660bbe2ab85ff20`;
its evidence remains
`e9ef120a2a8d43a14ac71c762521408ef2233d725f9e80a0a7bba9cb61c4de37`.

The original 24 named faults span candidate history; only seven belong to its
final campaign. This correction has its own nine exact-final named faults.
I inspect their raw assertions: eight AssertionErrors and the intended immediate
zero-expansion RangeError, plus harmless and restored passing results. Old
source/harness/mutation-reader failures remain failures. The original root
extreme-input diagnostic exits zero because it retains the formatter mismatch;
its in-probe peak is 99,344,384 bytes and later recorder peak is 104,587,264 bytes,
with zero events. It establishes no stored/RPC/browser/exploit/P1 reachability.
Original auto/range/cent power concerns remain original source inferences.

## Source approval does not establish native or user acceptance

The new unit is terminal zero after 6.498 seconds, with 263,372,800-byte measured
peak and zero memory events. Actual limits are 1 GiB, zero swap and CPU50.
One nonblocking compiler-lock acquisition encloses the unshared network,
private environment and kernel read-only host/old source/donor mounts. Root
receives terminal/release notice. One earlier metadata-only archive path failure
is retained; no dependency starts in that failed preparation. There is no
unexpected runtime failure or runtime retry.

Native NUMERIC/RPC/JSON, ACL/RLS, committed 1,201-row fixtures, snapshot
concurrency, upgrade/restore, browser Intl, identified desktop/390px navigation,
usable exports and practitioner finance remain unproved here. M11,
CORE-PM-01, KL-023, scientific, hosted and v1 acceptance remain open.
No native SQL/DB/catalog/socket/Docker/HTTP, provider/account/recording/browser,
real CLI, install, service or paid infrastructure operation runs.
