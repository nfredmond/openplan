# Continuation resource assessment checkpoint

The context and thematic history readers now expose a separate resource assessment for the next continuation after the verified output prefix. The existing continuation processor supplies the task index, required bytes and saved limit. Unselected and cleared attempt states remain separate. The historical manifest and its checksum exclude this added assessment, preserving retained references. Current staff access is rechecked before returning it.

This addresses the server portion of a visible recovery gap. A worker can refuse an oversized continuation before an attempt exists. The old history path skipped absent attempts, so its later resource-limit classification did not explain that refusal.

Both history suites pass, with 89 tests total. ESLint and diff whitespace checks pass. New tests cover no selected attempt and one verified predecessor in both stages. Harmless comments preserve the new tests. Replacing each returned assessment with null fails both corresponding tests. Mutations were restored.

These tests substitute a continuation resource result to isolate history propagation. They do not prove UTF-8 byte calculations, boundary behavior, native database access or rendered usability. Existing query projection checks remain in the suites. No database projection or migration changes in this checkpoint.

Still required: real continuation byte-boundary cases, cleared/changed predecessor assessment cases, progress response validation and route wiring, visible staff guidance, production build, and T3 desktop/390px acceptance. This server checkpoint is not a released or complete user workflow. No source shortening, permission change, new attempt or provider retry is introduced.
