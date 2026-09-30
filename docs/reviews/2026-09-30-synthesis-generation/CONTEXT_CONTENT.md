# Retained context content

September 30, 2026. Internal implementation after main `0b9f37f8`. This extends
[dependency preparation](CONTEXT_DEPENDENCIES.md) into complete content frames.
It does not add contextual model execution, a staff interface or proposal import.

The builder reconstructs the saved source, task plan, selected results and
dependency inventory before materializing a target's complete reachable context.
Each segment includes its original typed source parts and every parsed observation,
citation and uncertainty statement. Record and reference descriptors preserve the
dependency order, cycle edges and unavailable parent identities. Original numeric
spellings remain text inside typed source parts. Context, definitions and sessions
remain dependencies, not additional contributions.

The content manifest binds the source, request, native selection sequence, selected
result checksum, dependency checksum, target and byte limit. Entity descriptors
bind their exact JSON bytes and typed-field checksums. Frames include field
identity and exact UTF-16 ranges so a reader can reconstruct every field without
parsing broken JSON fragments. The complete encoded frame, including metadata,
must fit its UTF-8 limit. Empty scalar values and container markers are retained.
Future encoding changes must preserve this version for replay or use a new version.
Exact reconstruction refuses a caller's altered content, even if rehashed.

An incomplete selected result remains incomplete. Parsed output from a
provider-truncated response retains that disposition; it is not promoted to
complete input. Missing and invalid outputs retain null parsed content and their
existing receipt or attempt address. Original raw responses remain in the separate
capture ledger. A later output arrival changes the result and content checksums,
even when the selection sequence has not changed. An empty contribution selection
produces no content entities or frames.

## Verification

Final full QA and shuffled seed `481939` each pass 16,418 tests with 1,041
explicit skips across 1,365 passing and 67 skipped files. Lint, TypeScript, the
Next.js 16.3.8 webpack build and the dependency audit pass; the audit reports zero
vulnerabilities. Exact-commit GitHub checks follow the push.

The first related run caught two test-fixture errors: the default target was the
survey answer, while two assertions expected a comment. Explicit comment targets
fix those fixtures. The final four related suites pass 33 tests, including the
new long-Unicode case. The empty-selection target assertion also passes its
separate targeted fault check.

The first fault campaign preserves its harmless control and catches 23 of 24
targeted faults. These include removed source parts, observations, citations and
uncertainty; false source hashes and participation; incomplete-result promotion;
omitted dependency pages and final frames; wrong ranges and field identities;
and byte-limit bypass. Removing the surrogate adjustment survives these fixtures.
A second campaign preserves its control and catches a forced surrogate split in
the Unicode assertion. The survivor remains recorded, rather than being counted
as a caught fault. All temporary source changes are restored.

The first full QA run exposed a performance failure. The unchanged 30-second
301-comment test took 43.7 seconds under the full suite. The encoder repeatedly
serialized the pending frame while searching for each fragment boundary. It now
counts each serialized part and separator once, and accepts a whole field when it
fits. The same four related suites pass 33 tests in 4.2 seconds, compared with
23 seconds before the change. A direct before/after comparison produces identical
bytes across all 2,419 entities and 563 frames for the 301-comment fixture. That
single comparison takes 21 seconds before and 1.7 seconds after; it is not a
general capacity benchmark.

The final campaign preserves its control and catches 26 targeted faults, including
missing frame headers and separator bytes. A separate control and targeted fault
prove that even an empty selection cannot name an unavailable target. The earlier
surrogate-removal survivor remains in the [proof record](context-content-proof.json). The one-off comparison
initially could not resolve the private script's `zod` import; using the checkout's
installed dependencies resolves that harness error.

The tests independently reconstruct the typed entity fields from frame fragments
and compare them with the retained payload. They cover original numeric tokens,
empty values, escaped keys, malformed original Unicode, long multilingual text,
301 linked comments, a reply cycle, unavailable parents, late results, empty
selection and altered source/result authority. The 301-comment case proves the
tested closure and final-source retention, not maximum-corpus capacity.

## Limits and continuation

The builder still holds sources, results, entities and frames in memory. A bounded
frame does not establish out-of-core processing or fit within a provider's token
limit. The byte limit excludes any future recipe and transport envelope. Frames
are data, not independent model tasks, execution permission or evidence of semantic
interpretation. No database, worker execution path, route or browser capability
changes in this increment.

The next stage needs an explicit versioned recipe and durable request binding
these content checksums. Preserve the existing frozen segment recipe and its
authorization rules. Current staff may authorize new work from permitted history;
they do not inherit the original requester's execution permission. Continue
resumable contextual processing, machine proposal retention and explicit staff
acceptance into a new review revision, with old approvals left on their original
revision. Add browser journeys when that workflow is connected.
