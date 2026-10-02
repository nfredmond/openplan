# Current-staff thematic proposal history

October 2, 2026. This checkpoint connects retained thematic execution to a
reconstructed machine proposal under the current staff member's own access.
It remains internal application work. Explicit staff import and the connected
Analysis workflow are unfinished; this does not close M9b or the v1 contract.

## Original evidence and current access

The reader uses existing authenticated request, choice, input, input-seal and
selection-history RPCs. It never invokes a worker's current-execution delegation
as a substitute for staff permission. No new migration or proposal storage table
is needed for this read: original task inputs, dispatch receipts and provider
captures already retain the proposal's source bytes.

The input reader verifies the retained source and reconstructs every chosen
context at its pinned selection sequence. It checks the requested parent, source,
context, chosen final capture and result, then compares the entire original proof
and output with retained custody. It recomputes complete source membership and
the input seal. It subsequently reconstructs original thematic frames, references
and the separate final proposal slot against their staged bytes and seal.

Fresh content and continuation entry points still refuse cancelled requests.
Explicit historical entry points replay the same frozen recipe while retaining
cancellation. They perform no provider call and grant no preparation, selection,
resource or execution authority. The staff reader checks current access after
private input reads and again after inspecting all selected provider captures.
Cancellation may arrive during inspection; immutable request bytes and an already
observed cancellation cannot change.

Selected output replay uses a fixed historical selection sequence. Each attempt
must match its original grant, task, dispatch and capture. Later captures are
still authenticated when an earlier response prevents continuation. The reader
keeps unselected, cleared, claimed, awaiting-output, provider-incomplete,
invalid-output, changed-predecessor and resource-limit states distinct. Missing
input seals and incomplete staging also remain distinct from completed output.
An unsealed input set or incomplete staging has no observed selection snapshot;
its reported sequence stays null even when the caller requested a sequence.
Only a full replay including the final task returns a derived proposal, with
`machine_unreviewed` authorship and its original final response text.

The existing immutable captures remain the storage authority. The returned
history manifest binds selected receipts, tasks, dispatches, captures and replayed
result hashes. Staff import must retain that lineage and the proposal hash in a
new review revision with an exact expected parent. Existing approvals stay with
their original review revisions. This checkpoint does not implement that write.

## Evidence and limits

- Initial application replay exposed a canonical proof-order mismatch. The
  reader now uses the established proof schema to reconstruct the same original
  representation; it does not rewrite stored proof or output bytes.
- The first two end-to-end application cases pass, including cancellation.
  Expanded history, continuation and projection checks pass 138 cases before the
  final fault-isolation refinements.
- The installed native HTTP case passes in 170.41 seconds including runner
  overhead. A new staff reviewer reconstructs the same final proposal after the
  original requesters depart. Revocation during inspection blocks the final
  access check, and provider call count remains unchanged. This uses one
  synthetic original contribution and a synthetic local provider.
- Application fault controls cover 43 deliberate faults. The first selection-
  origin probe survives because a later attempt comparison also rejects the
  changed grant field. The isolated follow-up keeps that binding valid and adds
  an improper predecessor to an initial authorization selection. Removing the
  origin guard then accepts it and fails the intended rejection assertion. Both
  results remain recorded. The final harmless application control passes 78
  cases before the additional isolated selection-origin case.
- The first native control/fault pair passes its expected outcomes in 171.21 and
  171.65 seconds. Its revocation hook depends on entering the final RPC, however,
  so removing that RPC also removes the event. The stronger pair moves revocation
  to delivery of the last original capture and verifies the retained database
  role before asserting refusal. The earlier pair is preserved with this limit.
- The independent native control passes in 172.16 seconds. Removing the final
  access check returns history after the proxy has revoked membership and the
  test has confirmed the database role is `viewer`; the intended refusal
  assertion fails in 171.36 seconds. The source is restored.
- Three preparation-state tests initially expose an unobserved-sequence reporting
  defect. The reader now returns null for that unknown snapshot. A harmless
  control passes all three states; restoring the echoed sequence fails their null
  assertions. This later reporting correction leaves the native complete-proposal
  path unchanged and adds one distinct fault probe.
- Initial full QA passes 17,305 application tests and fails the static projection
  coverage guard. Four object-backed projections raise unresolved sites to 253,
  above the unchanged strict limit of 250. The reader now uses the same literal
  projections, preserving all fields and filters. This repeats the earlier
  execution checkpoint's documented static-reader boundary; the first run is
  retained. A focused invocation from the repository root runs no tests because
  package aliases are unavailable; the corrected invocation uses `openplan/`.
- The corrected history and static projection checks pass 85 cases. Omitting an
  original capture checksum column fails its targeted projection assertion;
  the harmless control passes. First-read-only source and seal failures each
  expose removal of their error checks without relying on a later failed read.
- Final QA records 17,306 passing application tests with 1,429 skipped, and 382
  passing connector tests with four skipped. Lint, configured dead-code checking,
  dependency audit with zero findings, webpack and TypeScript complete. The
  original shell process has terminated and the log reaches the completed build
  route inventory. Its tool session handle was lost during context compaction,
  so an exact terminal exit code is not retained. The run was not restarted.
  Broad live RLS remains skipped in QA; the separate native HTTP evidence above
  covers this checkpoint's specified access and recovery boundaries.

Mocked transport cannot prove native permissions or transaction behavior. The
native case covers one permitted synthetic journey, not external model quality,
representativeness, planner usefulness, vendor billing or browser acceptance.
The history reader currently reconstructs each context separately and retains
originals in memory. The existing pure 302-contribution continuation test is not
a large-campaign history performance result. Large final-task limits, shared
historical reconstruction, explicit staff import, self-service journal recovery
and identified desktop/390px journeys remain open under the current roadmap.
