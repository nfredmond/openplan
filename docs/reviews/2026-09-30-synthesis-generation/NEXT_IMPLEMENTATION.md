# Consolidation investigation, September 30, 2026

Read-only investigation against main 7726b58e plus the recorded coordinator candidate while its full tests run. This investigation is not implemented or accepted behavior and does not replace the roadmap. The later findings below identify release commit `734052b5`.

The complete M9b generation outcome remains the source-to-machine-proposal-to-explicit-staff-review chain described in [next generation boundary](../2026-09-27-synthesis-response-links/NEXT_GENERATION_BOUNDARY.md). Coordinator completion alone supplies none of the final thematic review or contextual interpretation.

## Concrete existing joins

- synthesis-generation-results.ts assembles explicit selected attempts with retained capture identity and part-level output validation. It returns ready_for_record_consolidation only when each required segment has valid complete part coverage. Empty selections remain distinct. This function already preserves unknown usage and incomplete dispositions.
- synthesis-generation-api-result.ts reinterprets a retained raw provider response and compares the result with its stored capture. A correct capture hash by itself is insufficient: changing outputText and recomputing its hash must still fail against the original response bytes.
- synthesis-generation-selections-server.ts anchors selections to a native sequence and checks complete task addresses. Its existing actor check expects the original requester. Native selection commands also retain that scope. Current campaign staff must gain historical read/review access without gaining the former requester's right to continue execution.
- Migration 35's private outputs retain capture_text as text, not PostgreSQL JSON. Preserve unusual escaped Unicode/NUL strings and original UTF8 bytes when reading them; do not introduce a PostgreSQL JSON conversion for convenience.
- The coordinator's immutable plan/header/seal reads now recover saved outputs after cancellation and requester access revocation. The native current-plan command remains necessary before new execution, and refuses a revoked original requester. Do not route historical review through it.
- synthesis-generation-api.ts currently parses authorizedNow:true in verifySynthesisGenerationApiDispatch, although its documentation also permits historical custody verification. A new native-output reader should not fabricate a fresh authorizedNow value. Separate retained receipt verification from fresh dispatch acknowledgement verification, preserving the execution adapter's requirement for a fresh acknowledgement.

## Next implementation sequence within M9b

1. Join native selected attempts, dispatch receipts and output captures to the existing complete result assembler. Pin request, plan, provider/configuration, task, attempt, native output checksum and original transport bytes. A missing output remains awaiting/unobserved evidence, not zero or processed. Keep immutable selected-result history as the input to downstream work.
2. Retain deterministic record-level inventory over every verified segment and historical reference. Never equate concatenating observations with semantic consolidation. Preserve exact source text, numeric tokens, citations, original receipts, coverage, uncertainty and unavailable linked definitions.
3. Add resumable record/context consolidation and final thematic generation with bounded, explicitly authorized work. The current native request/plan protocol is frozen to segment recipe v1. Its strict header and intent checks must not be bypassed to smuggle a different recipe into an existing authorization. Extend the native protocol additively and preserve exact old retries.
4. Retain generated proposals with machine authorship and the complete dependency chain. Import into a new staff review revision only after explicit staff acceptance; preserve current draft conflicts, old originals and approvals.
5. Join request, progress, cancellation, uncertainty, explicit retry and current-staff historical review in Analysis. Use complete browser journeys at desktop and 390px, keyboard use, private access, interrupted retries and retained outputs.

The outstanding design must address records or historical context larger than one provider window. Silently dropping text, observations, minority positions or earlier continuation state is not an acceptable bounded implementation. A configured resource ceiling may leave work explicitly incomplete. Source accounting and exact citations still do not establish semantic quality or representative participation.

This does not authorize real paid calls, change the active queue or narrow any V1 obligation.

## Staff-review integration findings against release candidate 734052b5

Read-only inspection while exact release CI runs. These findings refine the next implementation; they do not implement it or change the release candidate.

- `synthesis-review.ts` has a strict version-one staff-draft shape and only create/correct intents. `synthesis-review-server.ts` reconstructs the original category-derived draft, then replays every retained correction. A generated content blob cannot be inserted into that chain and called valid merely because its source counts match. Add an explicit retained proposal acceptance operation and teach the lineage verifier to reconstruct it from immutable proposal bytes, preserving existing version-one receipts.
- The native review writer in migration 27 binds actor, workspace, exact intent, source and expected parent revision/hash. Import must keep those fences, create a new revision and leave earlier approvals attached to their original version. A current staff member accepting a proposal is different from the machine that authored it and from the original actor who authorized provider execution.
- Staff-review text rejects NUL and malformed Unicode. The execution ledger deliberately retains such original provider response bytes. A malformed generated label or summary must remain an unusable proposal with its original receipt, rather than being silently cleaned and represented as the original model output.
- Review coverage accounts for every selected item/answer as assigned, unassigned or overlapping. Preserve this exact source inventory during proposal import. Metadata/context records and quotations are dependencies, not extra participants; do not inflate participation counts by treating them as contributions.
- The segment recipe declares references with `includedInTask:false`, and marks a record complete only when it fits one task. A complete segment result is not record-level or historical-context interpretation. The next stage must load the retained referenced definitions and all selected segment outputs, and preserve explicit incomplete status if a configured resource ceiling prevents complete contextual processing.

The native selected-output join remains the first missing implementation. Complete generation still also needs resumable contextual stages, retained machine proposals, explicit staff import/review, current-staff historical inspection and browser recovery. Do not advertise the first join as completion of that outcome.


## Context input requirements after the historical-reader candidate

The selected-output join is now on main `6b25a6d9`, with passing exact-commit CI and isolation checks. The [authenticated historical-reader candidate](HISTORY_ACCESS.md) adds current-staff access separately from execution permission. Its remaining gate status is recorded there. Neither increment implements contextual processing.

A retained selection sequence fixes the chosen attempts, but an output may arrive later for an already-selected attempt. A contextual-stage request must therefore retain the verified result inventory checksum and exact native output/capture hashes as well as the sequence. Missing, invalid, interrupted and provider-incomplete results cannot become complete inputs merely because the sequence is stable. Historical reads still allow inspection of these incomplete states.

The source records declare campaign context, historical definitions, parent comments and survey sessions as references. Resolve the entire reachable dependency graph from the saved snapshot. Use deterministic ordering and an iterative visited set, preserving cycle edges and unavailable reference identities. Do not replace a missing historical definition with a current mutable definition. Context and session records remain dependencies, not additional participant contributions.

Retain every segment observation, citation, uncertainty statement and exact source reference through subsequent processing. Part-level coverage proves accounting, not record-level or contextual interpretation. A bounded resource ceiling may leave work explicitly incomplete; it cannot silently discard a long record or prior continuation state. Final staff acceptance must retain machine authorship and dependency checksums, create a new review revision, and preserve approvals on their original revision.

These requirements guide the next implementation. No contextual stage, machine proposal or staff import is implemented by this note.


## Context request integration after d7888144

The content builder now retains full source parts and parsed selected outputs in
exact bounded frames. Main d7888144 passes CI and isolation. The next native
[context request candidate](CONTEXT_REQUESTS.md) retains a separate current staff
actor and an immutable parent/selection/result/context/content binding. Its
checksums are proposed input identities, not a verified execution receipt. The
old segment scope explicitly refuses these requests with SQLSTATE 0A000.

The application request service now loads the parent through
`loadSynthesisGenerationHistory` and reconstructs the original source, task plan,
dependency inventory and content manifests. It preserves the history reader's
final current-staff permission recheck, then rereads the immutable source through
its authenticated RPC. The history return type remains unchanged. Only complete
anchored results with an actual selected contribution can prepare model work.
The native write rechecks current staff access and retains the new actor.
The executor must independently repeat reconstruction and compare all requested
checksums, since the native request RPC accepts proposed hashes. Application
service fault checks and real authenticated HTTP integration pass. Continue with
the versioned context plan and executor; request custody grants no model call.

The base request retains provider/source intent under its existing schema. The
immutable context row identifies the new stage; it cannot be attached to an
existing segment request. New execution therefore needs a separate versioned
plan/recipe and native authorization path. The later explicit authorization must
bind the complete plan header, recipe, resource limits and current new actor. Do
not remove the old segment guard or replay an old requester JWT. Retain the
existing dispatch uncertainty, original-response journal and explicit retry rules.

Content frame bytes exclude any recipe and transport envelope. Check complete
encoded task size and provider context fit independently. Preserve the remaining
requirement for complete resumable context processing, including long records,
historical dependencies, conflicting positions and exact final source membership.
This candidate does not substitute request custody for that implementation.

## Versioned continuation candidate after 6eb041f5

The [pure continuation protocol](CONTEXT_CONTINUATION.md) now reconstructs the
request-bound plan and processes complete frames with exact preceding output.
Earlier notes and uncertainty remain unchanged prefixes; qualifications append
linked notes. Replay verifies the full chain. A complete task beyond its byte
limit remains held with the original state retained. This is not native custody,
provider dispatch or staff acceptance.

The next native protocol must bind this plan header and separate recipe, the
current task hash, an anchored predecessor output and explicit resource approval.
Do not pass context packets through the segment executor. Retain original
provider bytes before validating a continuation, preserve unknown dispatches,
and require explicit choice before another model attempt. Follow with thematic
proposals and acceptance into a new staff review revision, preserving prior
approvals and complete source membership.
