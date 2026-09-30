# Retained synthesis in decision evidence

September 30, 2026. Unreleased implementation checkpoint based on main
`10e0d694237abfae2862677bdc34f5cf6b78ff0d`.

The preceding response-link checkpoint has successful exact-commit GitHub CI
36680559816, RLS Isolation 36680560032 and Upgrade Path 36680559724. Full QA,
shuffled tests and RLS were green before this implementation began. The local
demo remains v0.63.0. This checkpoint does not add a release or change the demo.

## What changes

New private decision context uses schema 2. It captures every retained synthesis
response-link chain for the selected response across reviews and groups,
including original links, corrections and withdrawals. It retains exact event,
source, review, approval and response bytes. It does not filter that history by
current group existence, current source availability or participation filters.
Historical approval is evidence of the recorded action, not a claim that the
approval or publication remains current.

The reader still accepts schema 1. Earlier packets remain immutable and continue
to support exact retries and withdrawals. An earlier packet did not capture
synthesis history; it must not be displayed as an observed count of zero. New
schema-2 packets explicitly record empty history when no events exist at capture.

Browser-compatible readers check scope, inventory, predecessor chains, response
versions and shared immutable identities. Authenticated server loaders, save
acknowledgements and reviewed-export parsing also recompute retained preparation
and verify full source membership through the existing synthesis readers.

Migration `20261014000030_engagement_decision_synthesis_history.sql` preserves the
existing authenticated context function's identity with `CREATE OR REPLACE`.
Its version-one helper is private. New non-withdrawal writes require READ
COMMITTED and the same campaign response lock used by synthesis writes. Exact
saved receipt recovery occurs before those new capture guards. Withdrawals keep
the prior packet byte for byte.

## Checks performed

- 110 related tests pass across decision contexts, HTTP routes, pending recovery,
  the existing panel, reviewed decision history and export generation.
- 15 focused native probes pass on the isolated reference stack. Candidate DDL
  and synthetic records roll back. Concurrent commits use separately owned,
  disposable schema copies with no unrelated source records.
- Native probes cover observed empty history, multiple reviews, complete event
  order, withdrawals, unrelated response exclusion, removed review groups,
  later source correction, stale previews, exact old retries, private grants,
  viewer and foreign actors, campaign lock contention, READ COMMITTED and
  REPEATABLE READ, and preserved old withdrawals.
- A preactivation probe writes a real schema-1 decision through the old writer,
  keeps a prepared preview open across the migration, and checks the new preview,
  unchanged function identity, old receipt and original context bytes.
- Native harmless controls survive. Targeted faults in event capture,
  withdrawals, response scope, ordering, shared locks, helper grants,
  transaction isolation and entry-point replacement are caught.
- TypeScript fault proof has 21 valid executions: seven baseline or harmless
  controls and 14 targeted faults. All source files are restored afterward.
- TypeScript with an 8 GB Node heap, focused ESLint and `git diff --check` pass.
  The initial type-check process exceeded the default 4 GB heap; the larger-heap
  run completed successfully.

The first reader run caught an extra decision-address field passed into a strict
synthesis scope. The corrected reader selects the five expected fields explicitly.
Native fixture development also caught an unsupported hard deletion, missing
review-intent fields, an incorrect revision property and an account that the
shared fixture had promoted from viewer to owner. The probes now use a reasoned
source correction, the actual revision request ID, and explicitly establish and
check the viewer role. Those fixture errors did not justify relaxing application
guards. Failed runs remain in the private evidence directory.

Evidence logs and the mutation report are under the local
`approval-resume-2026-09-27` state directory, with the `decision-synthesis-`
prefix. The report in this directory contains only checks and source identities,
not private consultation records.

## Limits and next work at the foundation checkpoint

The later [display and export checkpoint](DECISION_DISPLAY_VERIFICATION.md)
supersedes the implementation and activation status below. These paragraphs
preserve what remained unproved when the foundation commit was prepared.

These checks prove candidate custody and transaction behavior. They do not prove
new browser reachability, readable PDF pagination, workbook navigation, downloaded
file custody, a full installed-schema QA run or a release. Nested verification
establishes internal consistency of retained evidence, not its current legal or
agency authority. Synthetic fixtures do not establish professional usefulness.

Migration 30 has not been applied to the reference database or demo. The reference
stack retains its 348 installed migrations. Before activation, focused native
probes require `OPENPLAN_DECISION_SYNTHESIS_CANDIDATE=1` in addition to live RLS
opt-in. After activation, normal live QA runs the installed contracts without
candidate DDL. The preactivation upgrade probe remains explicitly opt-in.

Next, display the full retained chain in decision previews and saved history.
Change the old current-sources wording to describe a current preview difference,
which may include the new packet format. Extend reviewed PDF, XLSX and ZIP files
with readable source, review, approval and response evidence, preserving original
files and public exclusion. Then apply the migration to the isolated reference
stack, exercise desktop and 390px journeys with keyboard and console inspection,
run the applicable full QA, shuffled, RLS, worker and upgrade checks, push directly
to main, inspect final CI, and finish the coherent release. No human software
release review is required. M9b and the complete V1 contract remain open.
