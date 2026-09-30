# Retained generation input

September 30, 2026. This is an unreleased internal foundation for the roadmap's optional complete resumable synthesis generation. No model dispatch, database migration, browser control or generated staff review is enabled by this change.

`openplan/src/lib/engagement/synthesis-generation-input.ts` starts with the existing server verifier for an immutable saved source. It retains the original snapshot text and records its workspace/campaign/source identity, byte length and checksum. The manifest enumerates every selected comment/reply and survey-answer identity, separates unanswered sessions and preserves `not_assessed` interpretation. Identical UUIDs in different contribution kinds remain distinct.

The input is divided into ordered UTF-8 frames with exact byte ranges and per-frame checksums. Frame size is configurable from 256 bytes through 1 MiB and defaults to 64 KiB. That is a transport-frame limit, not a source-size or contribution limit. A source larger than one frame continues without clipping. Unicode characters remain intact. Original JSON text is retained instead of being parsed and re-serialized, which would round some recorded numeric values or change original bytes.

The verifier rebuilds the manifest and frames from the authoritative saved source and compares the full input. Self-hashed false coverage, missing/repeated/reordered parts, wrong offsets, modified text and changed source identity are refused. An empty selected contribution set remains observed empty and unassessed; campaign totals and sessions without selected answers remain in the original source. Missing historical definitions remain missing.

## Verification and limits

The focused suite covers 301 comments plus survey input, long/multilingual text, escaped JSON, original numeric spellings, a source larger than the largest frame, reply/answer identity collisions, unanswered sessions, survey-only input, empty selections, invalid frame limits, malformed Unicode, wrong source identity and corrupt retained parts. The source/preparation/route companion run passes 84 tests across four files. Changed-file lint passes.

[Mutation runner](prove-input.py) performs a baseline and harmless comment control before targeted faults. It restores the original module in `finally`. [Recorded outcomes](input-mutations.json) show both controls passing and all 19 targeted faults caught by assertions. The module is restored. Full QA and shuffled tests pass 15,974 tests with 828 explicit skips across 1,345 passing files. The shuffle seed is 650930. Full QA also passes lint, configured dead-code checks, provider connector tests, dependency audit with zero vulnerabilities and the production build/typecheck. Ordinary QA skips the opt-in live database gate. This pure input change adds no migration or database write.

These are input-integrity checks. They do not prove database retention, permissions at a new route, job leases, cancellation, provider behavior, complete model interpretation, semantic accuracy, staff acceptance or browser usability. The saved-source argument must come from an authenticated authoritative loader. Self-consistent caller data is not authority. The current source loader and verifier hold the snapshot in memory; this is not streaming database intake.

Frames are continuations of one JSON document. They are not independent model prompts, per-contribution summaries or evidence that a provider read or understood anything. The later executor must use the reconstructed complete source, retain every planned semantic unit and return explicit incomplete states. Do not send an arbitrary fragment as a complete contribution or present byte coverage as analysis completion.

[Complete logical records](SEMANTIC_RECORDS.md) now extend this input foundation, with separate historical context and exact numeric tokens. They do not enable model execution.

## Continue the connected workflow

Follow the [generation boundary](../2026-09-27-synthesis-response-links/NEXT_GENERATION_BOUNDARY.md). Build complete semantic input planning and retained model-output receipts, then durable native request/attempt custody, provider dispatch and recovery, explicit staff acceptance into a new retained review version, and the Analysis interface. Reuse existing saved sources, revisions, approval history and worker journaling. Preserve manual preparation/review without a model. Keep the retired clipping generator disabled.

Any provider or local-model execution must preserve exact backend selection, source scope, disclosure and spending controls. Synthetic execution tests establish custody and recovery, not real model quality. No V1 obligation or capability rating changes at this checkpoint.
