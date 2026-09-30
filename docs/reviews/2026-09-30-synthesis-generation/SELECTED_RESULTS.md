# Selected synthesis output verification

September 30, 2026. Unreleased implementation after v0.65.0 and publication checkpoint `87b28534`. This advances the first missing join in [the implementation findings](NEXT_IMPLEMENTATION.md). Full QA, shuffled tests, TypeScript and the full native worker suite pass for the source hashes recorded below. Exact-commit GitHub checks remain a separate follow-up after committing.

The service reader reconstructs the saved source and its anchored native selection inventory. It joins each selected attempt to its resource authorization, task, provider configuration, dispatch receipt and retained output. It reinterprets the original provider response bytes before accepting the stored capture. A changed interpretation with a recomputed capture checksum is rejected. A missing output stays incomplete. Database read failure stays unavailable.

Historical dispatch verification now accepts the retained receipt without manufacturing `authorizedNow`. Fresh execution still requires its separate acknowledgement. The reader does not retrieve credentials, renew authorization or call a model. Clearing a selection preserves its source task. An explicitly chosen retry keeps the unselected source tasks incomplete.

## Verification

The original focused run passed 160 tests after correcting a fixture that covered only one of several source tasks. The refined selected-output suite also tests explicit retry selection. The first fixture failures remain recorded. The final TypeScript check passes. Full QA and shuffled seed `481936` each pass 16,388 tests with 1,022 explicit skips across 1,363 passing and 66 skipped files. Lint, dead-code checks, provider connector checks, the dependency audit and the Next.js 16.3.8 production build pass. The audit reports zero vulnerabilities. Ordinary QA does not run database fixtures; the separate full native worker suite passes all 10 cases.

The native baseline uses PostgreSQL, PostgREST, Kong, the actual worker CLI and private task journals in the isolated verification stack. It joins every selected output to its original capture, preserves escaped NUL and malformed Unicode, refuses current reads after requester access loss, and makes no extra provider call. The synthetic provider intentionally returns unusable synthesis text, so the result remains incomplete.

[Fault evidence](selected-results-proof.json) preserves two harmless unit/census controls and 21 targeted faults. Three early-rejection mutants initially survived because later checks also rejected the altered data. The refined tests require rejection before loading unrelated grants or dispatches; all three faults then fail. A separate native harmless control passes; dropping the returned captures fails the native output count. Restoring a stale column exemption fails the census for that exact field. Temporary mutations were restored.

These checks establish byte and identity custody for the exercised records. Mocked projection assertions do not establish native permission behavior. The native case checks loss of the original requester's access; current-staff historical review is still missing. This reader is service-only and has no browser route. It must not be treated as an authorization layer.

## Remaining complete generation work

The selected source and capture inventory remain memory resident. Large-corpus capacity and resumable contextual processing are not established. Implement retained record/context stages, explicit resource authorization, recoverable machine proposals and exact staff acceptance into a new review revision. Preserve all selected segments, historical definitions, minority positions and unknown outcomes. Add current-staff historical access separately from permission to continue the original requester's execution.

No capability rating changes. This checkpoint does not complete M9b, staff-facing generation or V1. The published v0.65.0 application and demo remain unchanged.

The next historical reader must accept a retained selection sequence so later staff choices cannot change a saved contextual-stage input. Current-staff access needs a separate caller-bound read path. Keep the original-requester scope lock unchanged for plan writes and provider execution. Neither a service-role read nor the returned original author identity grants the current caller access by itself.
