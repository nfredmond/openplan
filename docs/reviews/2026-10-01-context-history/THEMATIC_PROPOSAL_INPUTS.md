# Complete sealed inputs for thematic proposals

October 2, 2026. Internal M9b continuation from `301429b0`. The new reader
reconstructs every chosen context in a sealed source before supplying evidence
to the existing thematic proposal converter. It makes no provider call and
performs no write. Versioned task execution and staff import remain unfinished.

`loadSynthesisThematicProposalInputs` reads the bounded native inventory,
reconstructs its complete manifest and verifies its retained seal. It refuses
an unsealed or cancelled request. Each contribution then reads its original
retained input and replays the chosen context under the new requester's current
native authority. Source and anchored parent reconstruction are shared only
within this reader call. Per-contribution context histories and authority checks
remain separate.

The reader compares inventory metadata with original retained bytes, then
rebuilds the proof from actual history and requires exact proof and output text.
Self-hashed replacements cannot pass merely by supplying a matching inventory
seal. Each context keeps its source identifier, request, selection sequence,
history/capture/result hashes, exact note text and uncertainties. Original output
bytes remain alongside this projection, including original citations, related
note identifiers and coverage. A contribution with no notes remains present and
needs a reasoned unassigned result in proposal conversion.

After all contexts, the reader rereads the complete inventory and checks the
request, thematic binding, source and seal against the initial values. Current
cancellation or requester access loss prevents return. The separate historical
custody readers still support inspection after cancellation. This increment
requires no additional database migration.

## Checks and initial findings

- Seventeen new reader tests pass. The mixed-source fixture has distinct item
  and survey contexts, one with multilingual retained notes and one without
  notes. It exercises real context replay and manifest/proposal conversion with
  mocked transport. No writer is called. Four native inventory calls, four
  delegation calls, one parent-selection read and four source reads cover the
  initial/final inventory plus shared reconstruction.
- Fault probes cover metadata substitution, cancellation, replayed and final
  identities, skipped final authorization, omitted contributions, lost notes
  or uncertainty, incorrect manifest binding and replaced original bytes.
  Harmless controls pass. The first source-date probe survived because a later
  read rejected the altered source too. The corrected fixture restores that
  later source and requires the intended comparison error. The isolated fault
  now fails. Explicit absent-seal and missing-custody guards also detect their
  targeted faults. Eighteen distinct application faults are detected in total.
  [Mutation records](thematic-proposal-inputs-mutations.json) preserve the initial
  survivor, corrected probes, native outcomes and restored source hashes.
- The first fixture TypeScript check rejected a recursive inferred page type;
  an explicit page type resolves it. The initial reader run passed fourteen
  tests and failed one test-only trace lookup. Correcting the fixture depth
  preserves the production read-count assertion. Final TypeScript checking
  passes. An attempted local helper used the unavailable `python` alias; it
  made no edit and was rerun with `python3`.
- The native HTTP recovery case passes in 147.74 seconds on the owned
  `openplan-restore-target-2026091050` stack. It uses the real CLI, PostgreSQL,
  PostgREST and gateway with a synthetic provider. It refuses an unsealed input,
  retains the complete source seal, reconstructs original context evidence and
  bytes, and checks cancellation and requester access loss. This native fixture
  contains one contribution. Its uncertainty includes escaped NUL and unpaired
  surrogate values, preserved as original JSON text and decoded evidence.
- The native harmless control passes in 146.97 seconds including runner
  overhead. Deliberately removing contextual uncertainty fails the exact original
  evidence assertion in 145.78 seconds. The production reader is restored to its
  recorded SHA-256.
- Full QA passes 16,903 application tests with 1,353 explicit skips, 382 connector
  tests with four skips, lint, configured deadcode, dependency audit with zero
  findings, and the webpack production build including TypeScript. Ordinary QA
  skips native RLS. The separately invoked HTTP checks above cover this reader's
  native seal, recovery and current-access boundary.

## Limits and next connected work

The reader currently collects all reconstructed contexts and original outputs in
memory. Bounded inventory pages do not prove bounded total memory or large-source
throughput. Prior 302-contribution manifest/converter tests cover other boundaries;
they do not establish this outer reader's complete large-source behavior.
Transport tests do not prove RLS, and synthetic native output does not establish
semantic quality, participant representation or actual provider behavior.

Continue the [connected thematic workflow](THEMATIC_NEXT.md): versioned bounded
tasks, explicit resource authority, resumable execution, original proposal
retention and reasoned staff import against an exact parent revision. Preserve
original source text and historical definitions through task construction.
Complete the large mixed and survey-only, multilingual, minority/conflict,
overlap and interruption cases with identified desktop and 390px navigation.
This internal reader does not close M9b or reduce the full v1 contract.

Main remains `8cb534f5` and correction PR 112 remains open at `ca3e442c` on the
latest read. This lane preserves that owner's integration path. The canonical
checkout and demo remain unchanged; no release tag or visible workflow is claimed.
