# Validation stays within the isolated source boundary

October 16, 2026. The final bounded unit completes after the compiler coordination window.
This document distinguishes completed probes, intentional fault failures and
preparation failures. An exited controller alone does not establish arithmetic.

## Isolation and dependencies

The first dependency command runs through the new private `run.sh`. Its
bubblewrap namespace mounts `/` read-only, then the assigned checkout and NEW
private proof root writable, then the donor's node_modules read-only at the
assigned package's dependency path. That last mount prevents a writable checkout
bind from reopening donor files. The donor is
`/home/nathaniel/.t3/worktrees/openplan/t3-0f743997/openplan/node_modules`.
No donor files, caches or permissions are modified.

Each command clears the environment, unshares networking and uses private HOME,
tmp, XDG, npm and Vite caches. Separate empty user and global npm config files
replace the rejected first config arrangement. Node has a 512 MiB heap.
Systemd limits each TEST unit to 1 GiB RAM, zero swap, 50 percent CPU and a finite
180-second runtime. The shared compiler flock encloses the namespace and its
command. Vitest uses one worker and no file parallelism. No nested flock runs.
Later resource receipts read actual cgroup limits, memory events, the read-only
donor mount and the distinct network namespace.

The relevant assigned and donor locks agree on TypeScript 5.9.3, Vitest 4.1.11,
Vite 7.3.6, jsdom 28.1.0, React/React DOM 19.2.3, Zod 4.4.3 and Testing Library
React 16.3.2. `The final installed package manifests match these lock versions.`.
No decimal.js dependency, package addition or install is needed.

## Before and after use actual production exports

`before-probe.cjs` adapts the root probe to this assigned checkout and NEW output
path. It invokes the production loader and calculator over supplied RPC rows.
Every case passes the production schema, keeps all rows and has no pending or
unreadable flag. Its independent reference reads literal digits into BigInt
cents. Six mismatches reproduce, including four within safe-integer cents.

The 11 cases are 10,000 rows of 0.01; 10,000 rows of 19999.99; and 2, 19, 33,
49, 79, 89, 90, 101 and 1,001 rows of 999999999999.99. Controls at ordinary
values and 2/19/49 maximum rows match before the repair. The reproduced exact
large references are:

- 33 rows: 32999999999999.67.
- 79 rows: 78999999999999.21.
- 89 rows: 88999999999999.11.
- 90 rows: 89999999999999.10.
- 101 rows: 100999999999998.99.
- 1,001 rows: 1000999999999989.99.

The before campaign repeats a harmless compiled comment and original bytes.
Known 124.00, wrong reference 124.01 and supplied wrong total 99.99 distinguish
agreement from disagreement. Its exit zero preserves failures rather than
accepting them.

`after-probe.cjs` uses the same row cases and supplied transport, with the
corrected production exports. It compares independently reconstructed decimal
cent text, checks JSON roundtrips and compares displayed money with separately
grouped reference digits. It repeats the harmless compiled comment and restored
input bytes. `All 11 corrected cases match. Both the harmless compiled comment and restored input bytes repeat those exact results.`.

Neither transport probe executes native SQL, typmods, RLS or a real database.
The supplied transport asserts its RPC name and project argument. It cannot
establish that a native deployment returns the same snapshot.

## Focused checks and controls

The first focused run has 142 passing tests and one real failure. Grouping in a
pace sentence changed from `$1100.00` to `$1,100.00`. The production sentence
formatter is corrected; the existing test is preserved. The second run passes
174 tests across eight focused files, including real budget/portfolio helpers,
loader boundaries, money formatters and DOM consumers. The latest added
percentage-base case brings the selected count to 175; the final run passes all 175 tests across the same eight files.

The tight TypeScript run passes over the owned production units and their
focused test/consumer import graph, using the package's strict compiler options.
It is not a full application type check. Final types, zero-warning focused lint, all 175 selected tests and the
after-probe each exit zero. The final unit exits zero after 102.149 seconds,
with actual peak memory 485,269,504 bytes and zero memory events. Its actual
limits are memory.max 1073741824, memory.swap.max 0 and cpu.max 50000 100000.
The read-only donor mount and separate network namespace checks pass. The
controller reaches a terminal state and releases the compiler lock.

The new tests cover exact accumulation on both sides of safe-integer cents,
checked number/string representation, JSON reconstruction, billing versus cost,
drafts, attribution, deliverable budget sums, exact remaining amounts, null and
zero, invalid data refusal, over-budget precedence and exact ten-point pace
boundaries. Portfolio coverage includes exact aggregate and stated budgets plus
a percentage half-rounding case. Formatter cases include USD default, EUR,
JPY zero digits, KWD three digits, symbol/code, whole/auto, malformed-code
fallback, missing values, negative/small-negative and exact range ordering.
DOM cases inspect real project money text and the direct-spending chip.

Mutation readers require the named test to run and fail at its intended
assertion. A runner setup failure or an unrelated test failure is refused. The
harmless source comment must survive. Every trial restores original bytes in
`finally`, and the campaign records restoration hashes.

Campaign 3 records baseline and harmless survival, then named assertion failures
for float accumulation, unchecked Number conversion, billing added to cost,
float subtraction/comparison, null as zero, invalid required money as zero,
sub-cent truncation, negative input acceptance, rounded pace verdicts, invalid
percentage-base/input acceptance, portfolio float-percent rounding, portfolio
Number conversion, shared formatter conversion and project helper conversion.
Its last chip-label fault reaches the expected missing-label query. The strict
control reader refuses that Testing Library query error class, so the campaign
ends nonzero and restores its sources.

Campaign 4 records baseline and harmless survival, then rejects removal of the
fixed-cent number check and unchecked Number conversion. Its chip-label fault
again reaches the intended DOM expectation, but the DOM extension reports a
generic Error rather than AssertionError. The campaign remains a nonzero trial
with restored source, not a green campaign. The chip assertion now uses the
native nullable-value assertion. `The final seven-fault guard campaign passes its baseline, harmless survivor and restored baseline. Each named fault fails its intended assertion, including the corrected chip-label assertion.`.

The added guard campaign also targets invalid optional budgets, nonfinite
exponent input, currency-specific fractional digits, currency from data, small
negative signs and exact range ordering. `All six added formatter/validation faults fail their named assertions. Every owned source file restores to its original campaign bytes.

Across the recorded candidate sequence, 24 distinct named faults reach their
intended assertions. Per-campaign restoration hashes identify those source
states. The first 16 faults precede the stricter fixed-cent representation
check, which has its own failing removal control. The final seven-fault
campaign exercises the final candidate, followed by the final 175-test run.
Earlier completed faults are not repeated after root requests the shared
compiler window. The two nonzero mutation-reader trials remain explicit.`.

## Blind categories stay visible

The synthetic and DOM checks cannot see native amount typmods, native JSON/RPC
transport, role grants/RLS, snapshot concurrency or database upgrade/recovery.
The DOM environment cannot establish desktop/390px navigation, layout,
accessibility, browser-specific Intl behavior or usable exports. Financial
reconstruction here is an independent integer reference over supplied rows;
it does not replace a practitioner reconciling actual finance records.

No full suite, build, service, native database fixture, browser journey,
account/provider/cloud interaction, package installation, push, PR, integration
merge, tag or release runs. A fresh independent review is required before the
later join with root's disjoint loader correction.
