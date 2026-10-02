# Shared thematic preparation within one request

October 2, 2026. Internal M9b continuation from `9c64786d`. This checkpoint
reduces repeated reads of immutable parent data while preserving each chosen
contribution's context replay and current native authority. It adds no execution
permission, provider call, proposal import or visible workflow.

`createSynthesisThematicPreparationReader` holds a private, in-memory cache for
one campaign, workspace and thematic request. It stores source and anchored
parent reconstruction only after a complete context replay, matching pinned
hashes and a successful final authority check. Each later contribution obtains
fresh native delegation, compares immutable request/binding/source identities,
reconstructs its own original context and rechecks authority before returning.
Historical cancellation of earlier authors remains inspectable; cancellation of
the new thematic request or loss of its requester's access prevents preparation.

Cache values are detached from mutable caller results on both insertion and
reuse. Separate reader instances share no cache. Concurrent initial calls may
repeat work, but they cannot promote incomplete results or return inconsistent
immutable roots after another call establishes the cache. There is no public
argument for supplying trusted parent data. A restarted process reconstructs
originals again.

`createSynthesisThematicInputPreparer` connects this reader to the existing
native input save. Every contribution and exact retry still reaches the native
writer. Failed acknowledgements remain unconfirmed. Native cancellation, scope
and complete-source seal checks remain authoritative at the write boundary.
The single-input API preserves its behavior without creating an unused cache.
No database migration changes in this increment.

## Checks and initial findings

- Existing preparation and input custody tests pass after the refactor. The
  extended focused suite passes 50 tests, and the final reader suite passes 16
  after adding the concurrent-root check. Full QA passes 16,886 application tests
  with 1,353 explicit skips, 382 connector tests with four skips, lint, configured
  deadcode, dependency audit with zero findings, and the webpack production build
  including TypeScript. Ordinary QA skips native RLS; the separately invoked HTTP
  checks below cover this increment's current-access and retry boundary.
- A mixed-source fixture creates two distinct context executions over the same
  source and parent. Both outputs must match their independent historical reads.
  The two preparations perform one parent-selection read and two total source
  reads, both during initial reconstruction. One source read belongs to direct
  preparation and one to verification of the original parent authorization.
  Context frames, captures and authority are still read separately. Corrupting
  the second context's retained output after reuse is detected.
- Initial tests expected one source read, overlooking the parent authorization's
  own source verification. They failed and were corrected to account for both
  reads. A first mixed-source fixture selected the same survey target twice
  because survey answers sort before items; selecting the other record type
  exercises distinct contributions. An explicit completeness check also resolves
  the fixture's initially nullable historical selection sequence.
- Application fault probes detect removed root identity fields/checks, disabled
  reuse, aliasing of cached values, stale context reuse, skipped native saves and
  conflicting concurrent roots. Harmless controls pass. The two alias probes
  initially failed with direct production errors outside the harness's expected
  labels; explicit promise assertions now capture these failures. Initial and
  corrected records are preserved.
- The native HTTP recovery case passes in 144.57 seconds on the owned
  `openplan-restore-target-2026091050` stack. It runs the real CLI, PostgreSQL,
  PostgREST and gateway with a synthetic model. It checks warm exact input retry,
  cancellation refusal, departed earlier authors and current requester access
  loss. Its harmless control passes in 145.53 seconds. Deliberately returning the
  first saved result on a later call fails the native retry assertion in 143.85
  seconds: the stale record still says `replayed: false`. Sources are restored.
  [Mutation records](thematic-shared-preparation-mutations.json) retain initial
  classifications, corrected probes, native outcomes and final source hashes.

## Limits and next connected work

The cache relies on existing immutable database records and anchored selections;
it is not an independent disk-corruption audit between reads. Transport mocks
cannot establish RLS. Native HTTP uses a synthetic provider and does not measure
language quality, representativeness or real provider behavior. This two-context
reuse result is not a complete large-source throughput benchmark. Per-context
reconstruction still reads original frames and provider captures; the cache is
not a durable job journal or an execution authorization.

Continue the [connected thematic workflow](THEMATIC_NEXT.md): a versioned recipe
and bounded tasks, explicit resource authorization, resumable execution, original
proposal retention and reasoned staff import against an exact parent revision.
The complete large mixed/survey-only, multilingual, historical-definition,
minority/conflict, overlap and interruption cases remain required, along with
identified desktop and 390px navigation. The full v1 contract remains intact.

Main remains `8cb534f5`; correction PR 112 remains open at `ca3e442c` on final
inspection. This checkpoint is backed up on the synthesis branch without
advancing main or tagging a release. The canonical checkout and demo remain
untouched. Join the other owners' completed work and inspect combined CI before
release claims.
