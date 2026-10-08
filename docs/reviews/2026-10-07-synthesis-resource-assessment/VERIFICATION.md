# Continuation resource assessment checkpoint

The context and thematic history readers now expose a separate resource assessment for the next continuation after the verified output prefix. The existing continuation processor supplies the task index, required bytes and saved limit. Unselected and cleared attempt states remain separate. The historical manifest and its checksum exclude this added assessment, preserving retained references. Current staff access is rechecked before returning it.

This addresses the server portion of a visible recovery gap. A worker can refuse an oversized continuation before an attempt exists. The old history path skipped absent attempts, so its later resource-limit classification did not explain that refusal.

Both history suites pass, with 89 tests total. ESLint and diff whitespace checks pass. New tests cover no selected attempt and one verified predecessor in both stages. Harmless comments preserve the new tests. Replacing each returned assessment with null fails both corresponding tests. Mutations were restored.

These tests substitute a continuation resource result to isolate history propagation. They do not prove UTF-8 byte calculations, boundary behavior, native database access or rendered usability. Existing query projection checks remain in the suites. No database projection or migration changes in this checkpoint.

Still required: real continuation byte-boundary cases, cleared/changed predecessor assessment cases, progress response validation and route wiring, visible staff guidance, production build, and T3 desktop/390px acceptance. This server checkpoint is not a released or complete user workflow. No source shortening, permission change, new attempt or provider retry is introduced.

## Progress response and staff panel

The progress response now carries the optional assessment separately from task counts. Older responses without this added field remain readable. The response validator rejects segment-stage assessments, complete/unprepared status, out-of-range task indices, invalid byte values and a claimed excess at or below the saved limit. The server retains its final current-access check.

The saved-results panel shows the task number, required bytes and saved limit. It tells staff to preserve the original request, inspect saved results and obtain separate permission for a separate request. The assessment does not establish whether a provider call occurred. This view performs reads only.

The progress transport, server, panel and route suites pass all 82 tests. Harmless comments preserve the new tests. Allowing equality as an excess, dropping the server assessment, or hiding the panel each fails the corresponding two tests. All mutations were restored. Changed-file lint and diff checks pass.

The existing real context/thematic continuation suites pass all 65 tests. Inspected cases include full UTF-8 context bytes at the exact limit and one byte below, retained non-ASCII output, first-task refusal, oversized preceding state and final thematic proposal refusal. These support the underlying processor, separately from the mocked history propagation tests. New real-history integration cases for changed/cleared predecessors, exact thematic boundary, production build and identified T3 desktop/390px evidence remain pending. No release is declared.

## Real continuation boundary follow-up

Three additional focused tests pass. Context and thematic history now replay real retained Unicode output large enough to exceed the next task budget, while that task has no selected attempt. Clearing the earlier output selection removes the assessment without deleting original output. The thematic processor accepts the complete UTF-8 task at its exact measured limit and refuses a limit one byte lower.

Harmless comments preserve each new test. Returning a null assessment fails each real-history test; changing the thematic comparison to refuse equality fails the exact-limit test. Mutations were restored. Changed-test lint passes. This targeted invocation selects three tests and skips 136 unrelated tests; it does not replace the earlier full-file runs. Native permissions, changed-predecessor integration, production compilation and actual browser presentation remain distinct checks.

## Changed predecessor integration

Two real-history cases pass for context and thematic work. A retained second output first produces an oversized third task. Changing its predecessor selection reference then leaves the output retained as `predecessor_changed` and removes the later resource assessment. Harmless comments preserve both cases. Removing the predecessor-selection comparison fails the corresponding case in each reader. Mutations were restored and changed-test lint passes.

Production compilation and T3 desktop/390px acceptance remain pending. All history tests use mocked storage transport; they do not establish native permission enforcement.
