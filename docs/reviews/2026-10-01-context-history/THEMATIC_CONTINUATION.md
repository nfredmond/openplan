# Versioned thematic frames and proposal continuation

October 2, 2026. Internal M9b continuation from `0850f0ef`. This checkpoint
implements a deterministic task protocol over reconstructed sealed inputs. It
processes original evidence frames before a separate final proposal task. It
adds no native task staging, execution grant, provider dispatch, proposal table,
staff import or visible workflow. Those remain the connected implementation goal.

## Retained evidence and task identity

`synthesis-thematic-content.ts` reuses the existing retained JSON-field parser to
frame the original source snapshot, each chosen context binding and each exact
original context output. The source includes historical definitions, record
relationships and actual missing values. Frames preserve numeric token spelling,
empty structures and strings, UTF-16 offsets, Unicode, original citations and
uncertainty. Entity kinds distinguish source records from model outputs and their
bindings. Referenced context does not create another participant. Provider
responses use an `originalOutputText` scalar so duplicate keys, whitespace and
escape spellings survive framing. Their separately checked contextual projection
supplies parsed notes and uncertainty without replacing the original response.

The content builder reconstructs the complete manifest from original bytes,
verifies its seal, and checks the projected context evidence against those bytes.
These consistency checks cannot authenticate a caller-created history. The
service adapter `loadSynthesisThematicPlan` first uses the native sealed-input
reader and complete original-history replay. The pure processor's synthetic
fixtures explicitly do not establish native custody or permissions.

The immutable `openplan.engagement.synthesis.thematic.v1` recipe is separate from
segment and context v1. Its semantic JSON SHA-256 is
`7310c615ecff9ec8d67f498d188321c2bc104cec6020b206481953c7f88eda69`.
The plan binds this recipe, actor, original request intent, thematic binding,
complete input manifest and seal, content manifest, frame count and task byte
limit. Existing frozen recipes are unchanged.

Each frame task includes the original frame and exact preceding response. A
checked response must cover the supplied parts in order, preserve prior notes
and uncertainty as unchanged prefixes, continue note identifiers, reference only
earlier notes, and quote actual retained scalar parts. This preserves a place to
record minority and conflicting interpretations without averaging or deleting
earlier notes. New thematic uncertainty must be valid display text, while unusual
characters in original context uncertainty remain attached unchanged.

After every frame, the final task receives the full preceding interpretation and
all verified contextual evidence. The existing proposal converter checks complete
source membership, group overlap, reasoned unassigned contributions and exact
quotations from original contextual notes. Contextual note identifiers and frame
note identifiers have separate meanings. Final thematic uncertainty must retain
the preceding prefix. The complete original final response remains retained; the
result has machine-unreviewed authorship and changes no staff review or approval.

Continuation receipts bind request, plan header, task index, exact task, preceding
result and original output. Replaying every receipt recreates the next task or
same final proposal. Wrong hashes, reordered or substituted receipts, unexpected
fields and noncanonical receipt encodings are refused. Failed output validation
leaves the in-memory journal unchanged. Returned receipts and completed proposals
are detached from caller mutation.

## Checks and findings

- The focused suite passes 47 tests, including exact receipt encoding and provider-byte preservation.
  A synthetic 302-contribution mixed source completes all frames and final
  proposal, then replays to the same result. Every original field is reconstructed
  from its parts and compared, including exact numeric tokens, multilingual
  text, original context uncertainty, empty structures and historical-definition
  absence. Survey-only continuation and interrupted mixed-source replay pass.
- A transport-only native-reader fixture reconstructs both original item and
  survey histories before planning and refuses cancellation. It makes no writes.
  The native HTTP baseline passes in 148.37 seconds before the final uncertainty
  refinement. It uses real CLI, PostgreSQL and PostgREST with a synthetic provider
  and one contribution. The pre-raw-text native harmless control passes in 148.49 seconds
  including runner overhead. Substituting the input manifest hash for its seal
  hash fails the real-stack plan assertion in 146.87 seconds. Sources are restored.
  This is a read/plan assertion, not native enforcement of a thematic task write.
  The final raw-text native control passes in 148.54 seconds; reverting to
  parsed-only output framing fails the exact original-byte assertion in 147.23
  seconds. Both durations include runner overhead. Sources are restored.
- The first historical-definition absence fixture removed definition records but
  retained references to them. Source verification correctly refused it. The
  corrected fixture retains an actual legacy source with null configuration
  references and its original question snapshot. The initial 37-pass/one-failure
  result remains recorded.
- Review after the first full QA pass identified that typed JSON parsing can
  discard earlier duplicate-key values. Framing now carries exact original
  provider response text. Dedicated duplicate-key and escape-spelling tests pass;
  reverting to parsed-only framing fails them. The first full QA pass, 16,944
  application tests and 382 connector tests with build, describes the earlier
  candidate. The final QA result below covers the corrected representation.
- Fault checks cover omitted original content, numeric token rounding, frame and
  task ceilings, altered recipe identity, wrong seal binding, changed frames,
  omitted final contexts, dropped previous responses, task/finish identity,
  incomplete coverage, discarded state, invalid citations and note references,
  lost final uncertainty, corrupted receipts and Unicode limits. Harmless source
  comments and recipe JSON whitespace pass.
- The first oversized-output test used invalid JSON, so the later parser masked
  removal of the size check. A valid oversized output now isolates and detects
  that fault. Removing the explicit surrogate-boundary adjustment did not break
  these fixtures. That survivor remains recorded; a separate deliberate Unicode
  corruption fails field reconstruction. The evidence does not establish that
  the adjustment is individually necessary under every encoding boundary.
- Resource tests preserve all earlier receipts when accumulated state exceeds the
  next task ceiling, and when the final 302-context payload exceeds a selected
  65,536-byte task limit. They return `resource_limit` without clipping inputs or
  producing a smaller ready proposal. Raising the approved task limit to the
  supported 1,048,576 bytes allows this synthetic complete case.
- Oversized container and scalar field metadata stop preparation explicitly.
  Targeted faults that skip those fields fail their tests. Negative selection
  sequences and nonsequential note identifiers are also refused, with isolated
  fault checks. These refusals do not clip a field into a smaller ready input.
- Both frozen output schemas compile under JSON Schema 2020-12. The uncertainty
  schema accepts meaningful multilingual text and rejects blank text, NUL,
  unpaired surrogates and more than 4,000 Unicode code points. A harmless schema
  description passes; weakening the uncertainty constraints is detected. This
  does not establish any particular provider's schema compatibility.
- [Mutation records](thematic-continuation-mutations.json) preserve initial
  survivors, isolated probes, final recipe checks, native results and restored
  source hashes. Final QA passes 16,950 application tests with 1,353 explicit
  skips, 382 connector tests with four skips, lint, configured deadcode,
  dependency audit with zero findings, and the webpack production build including
  TypeScript. Ordinary QA skips live RLS; the separate native HTTP checks above
  cover this increment's original-input and plan binding boundary.

## Limits and connected work

This is an in-memory deterministic protocol. Database staging, resumable worker
journals, explicit resource authorization and native current-scope checks at each
dispatch remain unfinished. A self-hashed receipt supplied to the pure processor
is not an original-provider-response attestation. The native executor must replay
retained original captures and recheck scope before dispatch or proposal storage.

The frame/task ceilings use encoded UTF-8 bytes, not a provider tokenizer or its
HTTP envelope. The final task carries the whole contextual evidence collection;
large evidence or accumulated state can exceed the maximum supported task budget.
That case remains unresolved work, not permission to omit or summarize away
required evidence. Source, frames and original outputs also remain memory
resident. The 302-contribution synthetic result does not establish arbitrary
campaign scale, actual provider context fit, semantic quality, representativeness
or planner acceptance.

Continue native task staging and execution using existing journal/attempt/original
capture mechanisms, then original proposal retention and exact-parent staff
import. Complete connected large mixed/survey-only, multilingual, missing
historical definition, minority/conflict, overlap, interrupted-delivery and
cancelled/departed-requester cases. Identified desktop and 390px journeys remain
required before a visible workflow claim. M9b and the full v1 contract stay open.
