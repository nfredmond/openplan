# Accepted budget rows can produce inaccurate cent totals

October 16, 2026. Root reproduces an arithmetic defect in the existing project
budget helper. The complete-input candidate does not change that helper.
This readback does not accept M11, KL-023, native finance behavior or v1.

## The probe uses the frozen production loader and calculator

The subject is `ae3f4c72d5d4e17f3aa9970a0cef2d8f9afd7dd1`, application tree
`ef1674c66de60487c15c54a52b2e8e2f4e71d22e`, in the author's frozen checkout.
Root owns a separate report checkout at
`/home/nathaniel/.local/state/openplan/project-budget-cent-readback-worktree-20261016`,
branch `work/project-budget-cent-readback-20261016`. Neither checkout's
application source changes during this readback.

The probes compile the actual budget loader, calculator and four supporting
modules with the installed TypeScript transpiler. They execute those production
exports over supplied RPC rows. The supplied transport asserts the RPC name and
project argument. Every case reaches the production schema validator, remains
readable without pending flags, retains its complete row count, and reaches the
production calculator. No database, API row cap, RLS or browser executes.

The independent reference parses the two-decimal input literals directly into
BigInt cents and multiplies by the row count. It never accumulates floating
point dollar values. The displayed production value uses its existing numeric
result's `toFixed(2)`. Project and deliverable direct-cost totals show the same
error. Billing and spending bases remain separate.

## The error also occurs within the safe-integer cent range

Each row below has an accepted amount of `999999999999.99`. These are extreme
schema-boundary inputs, not a claim about typical planning expenses or the
frequency of real errors.

| Rows | Exact reference | Production result | Exact cents within Number.MAX_SAFE_INTEGER |
|---|---|---|---|
| 33 | 32999999999999.67 | 32999999999999.65 | Yes |
| 79 | 78999999999999.21 | 78999999999999.20 | Yes |
| 89 | 88999999999999.11 | 88999999999999.05 | Yes |
| 90 | 89999999999999.10 | 89999999999999.03 | Yes |
| 101 | 100999999999998.99 | 100999999999998.86 | No |
| 1001 | 1000999999999989.99 | 1000999999999998.25 | No |

The initial six-case probe finds the last two errors. A separate nine-case
follow-up tests the safe-cent boundary and finds the first four. The shared
ordinary cases, 10,000 rows of 0.01 and 10,000 rows of 19999.99, reproduce their
reference totals. Two and 19 maximum rows also match. The follow-up's 49-row
maximum case matches. These surviving cases matter: the comparator does not
report a mismatch for every input.

The current helper adds floating point dollar values, then rounds the total.
That loses cents for some admitted inputs. A safe-integer check on aggregate
cents alone would not repair every observed error. Converting an exact cent
total back to a dollar Number also needs an explicit representation check.

## Controls and isolation preserve the evidence boundary

Each campaign repeats with an added harmless comment in a private compiled
copy, then repeats the original bytes. All results remain equal. Actual source
files stay unchanged and their six hashes match before and after.
The reference reconstructs 123.45 plus 0.55 as 124.00. A changed reference of
124.01 and a supplied wrong production total of 99.99 fail equality controls.
These are comparator counterfactuals and a harmless source-copy control.
They are not a mutation campaign accepting a corrected calculator.

Both probes use an actual 1 GiB, zero-swap, 50 percent CPU cgroup and the shared
compiler flock. Their first dependency command runs with kernel read-only
subject and donor mounts, an unshared network and a cleared environment. Only
the new private proof root is writable. No installed package or donor cache is
changed. The subject's existing unrelated proof and failed trials remain intact.

The first unit exits zero with invocation
`75ab87f974b84871a68a3b4c29e6a178`, 3.288 seconds runtime,
144,961,536 bytes measured peak memory and zero memory events.
The follow-up exits zero, reports 1.906 seconds runtime and records its actual
cgroup census. Its manager stream omits an invocation ID; no ID is inferred.
Zero means the probe completed and retained its discrepancies, not that the
money arithmetic passed.

Private receipts remain at
`/home/nathaniel/.local/state/openplan/project-budget-cent-arithmetic-readback-20261016`
and the separate `project-budget-cent-arithmetic-readback-20261016-safe-range`
root. The new report checkout's nested direction check exits zero, with the
existing product-review reminders. No reminder date, release or hold changes.

## The repair must preserve complete inputs and exact money

The next implementation should use the existing money and budget owners.
The bounded repository search finds no exact cent accumulator in those owners
and no declared decimal.js dependency. Built-in BigInt can provide integer
cent accumulation without a paid service or new package.

The repair needs an exact amount representation through project and portfolio
consumers, remaining balances, comparisons and displayed or exported totals.
It must preserve optional money as unknown, distinct from zero; attribution,
invoice statuses and direct-cost formulas must stay unchanged. Financial
comparisons should use exact amounts, even when a displayed percentage uses
rounded decimal arithmetic. A row cap, wider tolerance or discarded large
record would leave the requested complete-input behavior unfulfilled.

This is an engineering requirement derived from the reproduced defect, not
approval of a new money API. The implementation must inspect every affected
consumer, preserve ordinary behavior, test exact large totals independently,
and receive fresh review. Native typmods, JSON transport, grants/RLS, concurrent
snapshot consistency, usable exports, desktop/390px navigation and practitioner
finance acceptance remain separate and unproved. No severity beyond this
reproducible numerical finding is invented.
