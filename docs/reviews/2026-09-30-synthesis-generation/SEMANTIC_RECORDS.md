# Complete retained records for synthesis generation

September 30, 2026. Unreleased internal development after the [input protocol](INPUT_PROTOCOL.md). No model calls, new database writes or browser generation controls are enabled.

`openplan/src/lib/engagement/synthesis-generation-records.ts` verifies the complete input against its saved-source authority, then creates separate campaign/selection context, historical definitions, survey sessions, comments/replies and survey answers. Every record retains its complete content, byte length and checksum. A manifest binds ordered record descriptors, contribution identities and references to the original source and input manifest. Verification recomputes that complete structure from the authority; self-hashed supplied records do not establish permission or authenticity.

Node 24's JSON reviver exposes original numeric tokens. An internal numeric wrapper preserves those tokens while serializing a logical record, including large integers, negative zero, decimal precision and exponent spelling. A participant object with a `token` property remains participant data. A runtime without original tokens is refused instead of silently rounding. Original whole-document bytes remain separately retained by the input protocol; logical record serialization can change JSON whitespace and string escaping without changing their values.

The record IDs keep comment, answer, session, definition and context identities separate. References identify retained context and definition/session links. A reply parent outside the selected snapshot stays explicitly unavailable, with no live lookup. Null historical definitions and question prompts stay null. Empty selections retain sessions, campaign totals and `not_assessed` interpretation. There is no per-record text cap.

## Verification

The focused record suite passes 14 tests. The combined input/source/preparation/route run passes 98 tests across five files. Changed-file lint and TypeScript checks pass on restored source.

[Recorded mutation outcomes](records-mutations.json) contain two passing controls and 20 caught targeted faults. The [runner](prove-records.py) requires an owned checkout, changes one implementation at a time and restores the source. Faults include the old 300-record cap, omitted answers/definitions, clipped words, rounded numeric tokens, invented neutral assessment, false reference availability, collapsed identities, wrong digests/byte counts, omitted reference binding, bypassed source checks and participant objects misread as numeric wrappers. Named failing tests are retained with log hashes.

[Broader checks](records-checks.json) pass full QA and shuffled tests with 15,988 passes and 828 explicit skips across 1,346 passing files. The shuffle seed is 650931. Full QA also passes configured lint/dead-code checks, provider connector tests, a zero-vulnerability dependency audit and the production build/typecheck. No migration or database write is added; ordinary QA skips the opt-in live database gate. These tests do not establish model interpretation, context-window planning, provider disclosure/spending controls, native job custody, cancellation/revocation, worker recovery, staff acceptance or a usable browser workflow. The current producer holds the source in memory. It does not stream a database or make an oversized record fit a model.

The [typed-field extension](FIELDS.md) preserves complete values for subsequent request planning.

## Next implementation boundary

Plan complete processing across actual selected provider limits, including long records and their historical context. Retain every request and output, source coverage and incomplete/uncertain states. Do not substitute transport frames for independently meaningful model prompts or equate input delivery with complete analysis. Reuse existing request identities, leases, cancellation and local worker journals. Exact explicit staff acceptance must create a new retained draft with machine authorship disclosed; approval and publication stay separate.

The [full generation boundary](../2026-09-27-synthesis-response-links/NEXT_GENERATION_BOUNDARY.md) remains active. Manual preparation and review stay available without a model, and the retired generator stays disabled. This record promotes no capability or scientific rating and does not close M9b or V1.
