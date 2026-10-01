# Retained context staging candidate

September 30, 2026. This internal increment follows main `91eec38b`.
It retains a complete reconstructed context plan and its original frames across
interrupted acknowledgements. Context authorization, provider execution,
retained-frame consumption and staff generation remain unfinished.

The staging envelope binds the request actor, exact intent and context-request
hashes, frozen continuation recipe, pure continuation header, content/context
manifests, target, frame limit, count, total original bytes and final chain hash.
The service reconstructs all inputs on each invocation and checks each returned
prefix and completion receipt against those originals. Packets contain at most
128 frames and 4 MiB including JSON escaping. Frames are never clipped. A lost
acknowledgement stops that invocation; a later exact retry resumes the saved
prefix. Cancellation refuses new preparation, new frames and new seals, while
retained exact retries remain readable by a current authorized requester.

## Original bytes and native storage

Apply `20261014000038_engagement_synthesis_context_plans.sql` before using these
commands. It adds one private immutable frame table and service-only context
commands. The existing segment commands still refuse context requests.

The initial live implementation exposed a PostgreSQL boundary: JSON field access
and `IS JSON OBJECT WITH UNIQUE KEYS` reject escaped NUL and lone-surrogate
strings. The generic task ledger uses that uniqueness constraint. Staging now
stores opaque syntax-valid JSON frame text separately and puts safe frame
references in the generic ledger. Original frame bytes and hashes remain intact.
The chain and cumulative byte totals describe original frames, whereas the generic
ledger's generated task hash and size describe its safe reference. A future
context reader must preserve that distinction.

Native staging deliberately does not decode frame parts, enforce unique part
keys, or prove their semantic relationship to the source. The application driver
independently reconstructs canonical original frames before staging and verifies
their complete chain. Direct service proposals remain proposals; a seal proves
byte custody, not source authenticity or permission to dispatch. The future
executor must independently reconstruct retained inputs and verify exact frames
before obtaining execution authority. Generated per-frame hashes and sizes are
retained but do not yet have an application reader.

## Evidence and limits

[Recorded checks](context-staging-proof.json) preserve initial failures,
mutation results, source hashes and the additive upgrade evidence. The upgrade
preserves counts and sorted-row SHA-256 fingerprints across eight existing
request, context, plan, task, seal, attempt, output and selection tables. The
installed catalog has 270 RLS-enabled application tables and 14 views.

Focused unit tests cover original chains, strict prefixes/seals, encoded packet
bounds, cancellation, aborts, lost acknowledgements and missing progress. A
harmless source control passes and all 25 TypeScript faults fail. The native
suite checks exact retries, access, immutable originals, cancellation at each
stage, byte/count limits, complete seals and advisory-lock contention. Two
initial single faults survived later refusal checks. Combined probes remove
those redundant checks to expose the intended sequence and overlap failures.
One overlap probe initially failed on an earlier unrelated retry assertion; the
corrected probe preserves that earlier check. No production guard was weakened.

The real HTTP journey runs synthetic segment output through the existing local
worker, creates a new staff context request after parent cancellation and author
departure, then drops a successful context-frame acknowledgement. Resume seals
the same original frames without another stage call or provider call. Escaped
NUL, lone-surrogate, accented and supplementary Unicode survive. Cancellation
preserves the seal; requester revocation refuses further service access. Its
harmless control passes and a wrong-prefix fault fails at the intended boundary.

Full QA and shuffled tests each pass 16,451 tests, with 1,121 skipped.
The production build passes and the dependency audit reports no vulnerabilities.
The complete isolated RLS suite passes 1,025 tests across 76 files, with 125
skipped, including 48 context-staging cases and 12 native worker cases.
Exact main CI remains pending for this internal increment.
These engineering probes establish neither interpretation quality nor provider
billing, agency acceptance, browser usability or physical power-loss recovery.
There is no new staff-visible workflow and no browser acceptance claim. Keep the
complete M9b and V1 requirements, including complete thematic proposals, exact
membership, explicit staff import and original approval history.
