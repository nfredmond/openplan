# M9b retained synthesis source backend checkpoint

Later implementation: [source interface verification](SOURCE_UI_VERIFICATION.md) supersedes this checkpoint’s pending source-selection/inspection/browser work. The full preparation/generation/review outcome remains open.

September 14, 2026. Implemented source custody and staff capture/read API; not a completed or released synthesis workflow. v0.61.1 remains the published release. The old synthesis panel/POST still uses the capped mutable generation path until the connected review implementation replaces it. Do not claim that the currently visible synthesis is repaired by this checkpoint.

## Implemented

Migration 20261014000025 adds immutable private source records, generated exact-text checksums and authenticated staff capture/read functions. A single database snapshot includes every selected comment and survey answer, its original captured text/typed value, existing geometry and applicable retained configuration definitions. Counts distinguish selected rows from campaign totals. Selection names included kinds, statuses, categories and explicit date offsets. These are contribution records, not distinct respondents or representative support.

An exact request retry returns the original saved receipt before considering changed source rows. A changed selection or actor conflicts. Failed persistence throws rather than returning a successful receipt. Current staff access is rechecked on capture, retry and source read; anonymous, viewer, foreign-workspace and revoked-staff cases are denied. Direct authenticated table reads/writes are absent. Update/delete triggers retain originals. No old synthesis, report snapshot or migration is rewritten.

The new /synthesis/sources POST and GET enforce staff scope, private/no-store responses, body limits, browser origin and an executable refusal for unregistered Planner Agent writes. The reader verifies outer and inner scope, exact snapshot/definition checksums, counts, unique references, retained definitions and explicit filters. Query errors and corrupt records stay unavailable. Capture/read invokes no model. Contact/fingerprint/request metadata is excluded; retained comment bodies and staff moderation context are still private. Future model input must select participant content, not mistake moderation notes for participant statements.

## Verification completed

- 47 focused application tests; 59 tests including unchanged synthesis and release-ordering controls. Changed-file ESLint passed. TypeScript passed before the later live-test wrapper was added; broad QA will cover the final checkpoint.
- source-api-mutations.json records 47-test baseline and harmless survivor, plus 25 targeted mutations. Removed checksum/scope/count/selection/reference/privacy/origin/request guards fail the intended tests. Sources were restored byte-for-byte.
- source-custody-native-results.json records baseline/harmless survival and 14 targeted native faults, including the 301st concern, full long text, original definitions, survey coverage, exact retry/actor, date/category selection, private access, mutation/deletion and swallowed persistence errors. All use real PostgreSQL inside rolled-back synthetic transactions on supabase_db_openplan-restore-target-2026091050.
- Nine registered live-suite tests pass in explicit candidate mode. Candidate mode installs migration 25 only inside each rolled-back test transaction. CI/default live mode exercises the installed migration. The test is included in npm run test:rls-live.
- native-reader-handoff.json records an actual PostgreSQL saved result accepted by the actual TypeScript verifier: 301 comments, one survey session, two answers, two retained definitions and the complete final source text. Raw synthetic response remains private. This checks the SQL/parser join; it is not HTTP or browser evidence.

The local application stack remains at 343 installed migrations with no synthesis source table after these proofs. No reset/drop or lasting fixture write was performed. Separate production browser, concurrent transaction, worker, populated upgrade and final release CI checks remain necessary for the eventual connected increment. No full-QA result for this backend is claimed here yet.

## Errors corrected during verification

The first native fixture had an ambiguous SQL value reference. Its revocation case then attempted to remove the only owner; the fixture now preserves another owner. These were fixture errors, not production source-capture failures. The first TypeScript test command ran from the repository root and loaded no tests because aliases were missing; it was rerun from openplan/ using the repository Vitest configuration. The wrong-root invocation is not evidence.

## Continue here

First finish any QA process named in RESUME.md and inspect its exact source commit. Then connect this saved source to complete free deterministic preparation, bounded resumable optional model batches, retained coverage/results, staff theme review/correction and response/decision links. Read IMPLEMENTATION_BOUNDARY.md for the full seam and source-kind/publication requirements. Do not narrow M9b to this storage/API foundation or raise an arbitrary cap instead of completing the workflow.

The browser must offer real source selection, show confirmed saved scope/counts, and retain the same request across an interrupted response. Reuse existing pending-request patterns scoped to user/workspace/campaign. Reopening a saved review must not recapture current source; returning after membership or account changes must not expose stale private content. Introduce a paginated source inspection path for large selections, with exact archive access, rather than repeatedly transferring duplicate whole snapshots to the UI. Profile capture and preparation with larger campaigns before claiming large-corpus operation. Survey attachments/typed answers and missing historical context must remain explicitly assessed or unassessed.

Add generation/review worker and UI before browser acceptance. Only then apply the additive migration to the named app stack, identify the served build, exercise desktop/390px/keyboard/private access/retry and inspected outputs, run applicable complete QA/RLS/worker/upgrade checks and inspect final release CI. Human software-release review and paid infrastructure remain unnecessary; full V1 scope stays active.
