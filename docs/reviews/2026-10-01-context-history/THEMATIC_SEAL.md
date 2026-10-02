# Complete-source thematic input custody

October 2, 2026. Internal M9b checkpoint on `3f6be63f`, based on main
`24022411`. This is not a release or a completed thematic workflow.

The worker can inspect retained contribution proofs in bounded pages and seal
an exact complete-source inventory. Native commands independently compare every
original item and survey-answer identifier against choices and retained inputs
in both directions. They reject missing, duplicate, unknown and same-count
substituted membership. A fixed byte ordering and versioned hash chain bind the
new request, actor, intent, thematic binding, source, each proof, each original
output hash and exact UTF-8 output byte count.

Migration `20261015000007_engagement_synthesis_thematic_input_seals.sql` adds an
immutable private RLS table, a cursor-order index and named service commands.
Fresh sealing requires current requester scope and an uncancelled request.
Existing exact seals remain recoverable after cancellation. Fresh input writes
stop after sealing, while exact earlier input retries preserve their bytes.
Current staff history remains separate from service preparation and supports
inspection after the original requester leaves.

The TypeScript reader checks native identity before private source access,
checks its exact source projection, reads every bounded metadata page and
rechecks authority after the last page. It refuses changing identities,
disappearing seals or cancellations, duplicated ordering and new tail entries.
Incomplete inventory remains inspectable but cannot become a smaller ready set.
An uncertain save acknowledgement remains unconfirmed until an exact later read
or retry succeeds.

## Checks and corrections

The owned stack is `openplan-restore-target-2026091050`, API port 29821 and database
port 29822. No other stack, canonical checkout or demo was modified. Migration
007 was tested in rolled-back candidate transactions, then installed additively
on this stack. Its installed catalog contains 275 application tables, all with
RLS, and 14 application views. PostGIS extension relations are excluded.

- The focused application suite passes 48 tests across manifest, inventory/seal
  service and existing per-input custody. A 302-contribution mixed source and
  survey-only input exercise membership; same-count replacement and repeated
  context use are rejected. Transport fixtures assert the private projection.
- The final candidate native suite passes 41 tests: protocol comparison, harmless
  control and 39 deliberate faults. It exercises more than 300 actual retained
  SQL contributions, pages, exact retries, cancellation, departure, privileges,
  immutable history, source scope and exact membership. The application builds
  its own manifest from the native compatibility packet and must agree with the
  separately computed database manifest.
- The initial application mutation record includes three harmless controls and
  49 fault probes. Two individual manifest comparisons survived because exact
  text plus its digest redundantly bind the same bytes. Removing both together
  fails against a self-hashed alternate manifest with the original receipt.
  The individual survivors remain recorded; they are not counted as isolated
  detections.
- An oversized receipt initially failed its stale digest as well as its byte
  limit. Rehashing the padded receipt isolates the byte limit and catches its
  removal. Removing the empty-continuation guard originally caused a test
  timeout. The fixture now denies a second page, so the missing guard fails the
  asserted pre-access boundary promptly. Corrected controls still pass.
- The first SQL fixture attempt failed because it altered a source table while
  that table was used in a function argument subquery. Moving the fixture-only
  trigger change before the subquery fixes that transaction. A later inventory
  dependency fault hit the metadata assertion before the expected missing-tail
  assertion. The expected message now describes the observed failure; no
  production predicate was weakened.
- Initial schema checks failed for the new relation count and unread
  `manifest_text` column. The installed catalog establishes the revised count;
  the column explanation identifies its native reader and exact retry use.
- An initial unit invocation from the repository root used the wrong Vitest
  installation and failed module aliases before running tests. All reported
  application runs use the application package directory and its Vitest 4.1.11.

The installed native regression passes 81 tests across the new seal and prior
per-input custody suites, run sequentially in 251.69 seconds. The application
seed-protocol mutation fails the independent native comparison; its harmless
control passes. Schema mutation controls pass, while disabling the new table's
RLS and adding an unread column each fail the intended assertion. The migration
and application sources are restored to the hashes recorded in
[the mutation record](thematic-seal-mutations.json).

Full QA has passed 16,868 application tests with 1,353 explicit skips, and 382
connector tests with four skips. Lint, configured deadcode and dependency audit
pass; the audit reports zero findings. The webpack production build, including
TypeScript, passes. Local QA intentionally skips live RLS; the separate native
suite above establishes only the affected database boundaries.

## Evidence limits and remaining implementation

The native fixture uses synthetic context outputs to establish custody and
permissions. It does not run a thematic model or establish semantic quality,
representativeness, legal sufficiency or practitioner acceptance. The mocked
service suite does not establish HTTP behavior. This checkpoint adds no live
HTTP seal journey or browser workflow. Prior per-input HTTP evidence remains
in [input custody](THEMATIC_CUSTODY.md), with its narrower scope.

A seal is complete-source byte custody. It is not execution authorization,
original-history replay, a thematic recipe, staff approval or a proposal import.
Every retained context and output must still be reconstructed before execution.
The metadata reader cannot determine semantic validity from hashes. Catalog
and unread-column guards cannot establish runtime access behavior; native
permission tests cover a different boundary.

Next, share immutable source and anchored parent reconstruction within one
request while retaining each contribution's native authority checks. Then
complete the versioned thematic recipe, approved resources, resumable worker,
original proposal storage and explicit expected-parent staff import. Retain
old approvals on their original revision. The connected acceptance case still
needs long and multilingual sources, historical definitions, minority and
conflicting responses, overlapping groups, stale drafts, interruption recovery,
departed authors and identified desktop and 390px navigation.

Main integration remains with the other active owners. At the last check,
main is UI commit `8cb534f5` and correction PR 112 remains open at `ca3e442c`.
The synthesis branch is published separately. Merge future main into that
branch without rewriting its published history, preserve the combined RLS test
list and migration accounting, and inspect exact-commit CI before any release.
The full v1 contract and roadmap remain unchanged.
