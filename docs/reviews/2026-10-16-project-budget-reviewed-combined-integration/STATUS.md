# Reviewed budget source and money corrections pass combined checks

October 16, 2026. Source checkpoint
`93c5a1efc514d53db953bdba5a8322dcf844e14b`, application tree
`e04a8509926c27065e77537f1816071811bb5b4d`, joins the independently reviewed
stated-budget isolation and exact-money corrections without conflicts.
All 298 selected tests in 13 files pass. Scoped strict TypeScript with 17 entry
files, changed-file lint and the nested direction check also pass.

The new owned checkout is
`/home/nathaniel/.local/state/openplan/project-budget-reviewed-combined-20261016`,
branch `work/project-budget-reviewed-combined-20261016`. It starts at frozen
`825b34a549fbd424d4148815cfa6bdb7c23f2f5c`. Cherry-picks of 360420 and 7cc519
produce 0b15db811 and 93c5a1efc. All 10 final reviewed money files and three
isolation source/test files match their reviewed bytes. Earlier author,
review and isolation checkouts remain preserved. The old root checkout's
three inherited staged files retain patch hash 404acef304a567807dc2ef2dda3292bc2e83eb0baaba9cce56d7567fe13af35c.

Review 75bf571d source-approves stated-budget isolation. Review 541f01e5
source-approves the final decimal-scale repair, with no P1/P2 in its bounded
scope. Its full report and evidence are copied byte-for-byte here. Root reads
the full report/validation and matches three report hashes and 33 private pins.
Its independent Fraction oracle checks 123 fixtures and 15,129 ordered pairs,
plus harmless survival, three intended faults, restoration and the new nine
tests. Those are independent review results, not this integration run's counts.

The combined TEST unit `op-budget-combined-checks01.service` reaches terminal
exit 0 in 67.278 seconds. Its invocation is 22254e3483364bf7b9317f7e4833bc61.
Actual limits are 1 GiB RAM, zero swap and CPU50; measured peak is 488,198,144
bytes and every recorded memory event is zero. The first dependency command
runs with the donor kernel read-only, networking unshared and private
environment/cache paths. Vitest runs one worker. The shared compiler lock
releases with the terminal unit.

Direction exits 0 in 1.745 seconds, tests in 44.307 seconds, scoped types
in 10.943 seconds and lint in 10.051 seconds. Each stage checks unchanged
source hashes. No new test, guard or source behavior is added by the mechanical
join, so the reviewed harmless/fault campaigns remain attached to their exact
source bytes rather than being counted as new campaigns. The compiler closure
is not full application compilation. This is not a full-suite or build result.

A separate unmodified-loader probe reproduces an open defect in the generic
pending classifier for stated-budget, spending and invoice sources. An internal
42703 error becomes pending and loses read-failure custody. This finding remains
at the synthetic-input boundary. Its correction runs separately; these 298
selected passing tests do not cover or clear it. The failed first probe reader
and explicitly authorized replacement remain retained by that proof's owner.

Migration 19 remains unapplied. Native NUMERIC/RPC/JSON, caller and child RLS,
committed complete HTTP fixtures, concurrent snapshots, upgrade/restore,
browser Intl, identified desktop/390px journeys, usable exports and practitioner
finance remain open. Main, hosted promotion, M11, science and v1 remain unchanged.
The separate A0 observation record in this branch names its own observed app
identity; it does not establish native acceptance of this budget application.
A push is a checkpoint, not CI or release acceptance.
