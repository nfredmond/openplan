# Resolution API and concurrent recovery progress

Continues `bc6df350` in the owned translation checkout. The previous goal turn made concrete progress through native custody tests, pre-write scope validation and a pushed checkpoint. This increment adds the authenticated resolution API and queue preflight. It is unfinished and unreleased; the full V1 contract stays active.

## Current installed state

Migration 19 is now installed in the isolated browser stack, `supabase_db_openplan-restore-target-2026091050`, database `postgres`, workdir `/home/nathaniel/.local/state/openplan/openplan-restore-target-2026091050`. It has **338 migrations through 20261014000019**. All 337 older copied migrations matched the owned source before copying only migration 19. Authenticated resolution execution is allowed; anonymous and service-role execution and direct authenticated receipt updates are denied. At activation, existing fields remained 27 cancelled/four completed, with no queued/reserved/running fields.

The old `prove-generation-resolution.py` is a pre-activation candidate experiment and must not be rerun on this now-installed stack. Its final retained run covers 30 native tests plus 39 receipt/helper tests, baseline/harmless controls and 35 killed faults. Normal installed `translation-generation-resolution-live.test.ts` now runs without the candidate flag and is registered in `test:rls-live`. All 30 tests passed installed, along with six release-ordering cases. This covers incomplete output and prior failed/interrupted/cancelled states in addition to the earlier cases.

**Full isolated RLS passed: 56 files / 525 tests, 387.72 seconds, exit 0.** Private log: `/home/nathaniel/.local/state/openplan/response-write-probe-20260913/translation-migration19-full-rls.log`. The suite added one cancelled concurrency fixture; final application states were 28 cancelled/four completed, none queued/reserved/running. This job is terminal.

## Concurrent database behavior

The new schema-only proof database `openplan_translation_resolution_proof_20260913` lives in the same container. No app, PostgREST or worker is connected; no source records were copied. `translation-resolution-proof-database.json` identifies the schema source, candidate digest and private restore logs. Do not attach a worker or treat its empty migration bookkeeping as an installed application stack.

`prove-generation-resolution-concurrency.py` uses independent psql connections with actual transaction readiness and liveness checks. Seven baseline and seven harmless cases pass: resolution before create, create before resolution, identical resolution overlap, resolution rollback, resolution before claim, claim before resolution and dispatch before resolution. Contention returns busy; exact retry preserves the receipt or completes the intended transition. Rollback leaves no tombstone. Cancelled/interrupted attempts cannot dispatch afterward. Removing either lock or the authoritative resolved-request gate fails the intended case. Definitions are restored afterward, and all retained synthetic proof fields are terminal. `generation-resolution-concurrency.json` records the evidence.

The first fault setup used `postgres`, which lacks CREATE rights on this proof database's public schema. All seven baseline races passed, then harmless replacement was refused before any fault was installed. The runner now uses the schema administrator for setup/replacement and explicitly assumes authenticated/service roles for actual calls. The corrected complete run passed and restored both definitions.

## HTTP and queue behavior

New POST endpoint: `/api/engagement/campaigns/[campaignId]/translations/generation/resolutions`. It checks origin, bounded streaming input, strict UTF-8/intent, current user and staff campaign access, and invokes only the authenticated resolution RPC. Marked Planner Agent execution is refused because no registered action exists. It returns a verified private receipt, 201 for a new resolution and 200 for exact replay. Logs carry IDs and outcome, never copied words or reasons. Ambiguous failures retain the exact retry instruction.

Before preparing a credential for an absent generation request, the queue now checks resolution metadata scoped by request/workspace/campaign/actor, limited to one row. It reads only service-permitted columns and refuses lookup failures or mismatched metadata. SQL remains authoritative if resolution commits after this preflight. Existing creation replays still use their original retained intent and the SQL gate.

There are 26 endpoint tests and 52 generation-route/queue tests; combined with 39 receipt/helper tests, **117 tests pass**. TypeScript and focused ESLint pass. `prove-generation-resolution-api.py` proves baseline/harmless survival and 22 targeted failures for origin, agent refusal, bounds/encoding, authorization, replay, private caching/logging and queue metadata/error/filter/projection controls. These tests invoke real route/helpers with mocked Supabase transport. They do not establish actual HTTP/database integration or browser recovery. One initial expected audit shape incorrectly included workspaceId; corrected to the existing campaign/actor audit contract before the full fault run.

The new private table is registered in the live census with its dedicated suite. Baseline and harmless changes pass; removing only this table's probe fails naming this table. The first matcher refused a truncated Vitest error that hid the missing table name. The census now includes actual missing names in its diagnostic; the complete rerun passed. `generation-resolution-census-controls.json` records the result and its limits.

## Next integration

Connect durable browser resolution intent, exact retry, checked receipt storage and original-copy archive behavior. Fix the old recovery error that claims both copies exist after a failed server read. Preserve running-provider uncertainty, original output/history and account/campaign lifecycle boundaries; no replacement generation starts automatically. Re-identify ordinary dev on 3260 before browser work. Manual/access/generation browser scripts now expect 338/19. The wrapper control suite passes four tests, all six targeted faults, and four actual normal/abrupt child exits preserving installed command grants. `translation-browser-wrapper-338-controls.json` retains these results; the earlier 337 report remains. These exit probes did not launch browser journeys. The wrappers protect their existing command permissions; new resolution browser acceptance must also check its own privacy and recovery boundaries. No new browser acceptance is claimed here.

The original checkout and demo remain untouched; another Codex process is active in the original checkout. No main merge/tag occurred. Full QA, shuffle, worker/upgrade checks, actual desktop/390px/keyboard/console journeys, remaining public-generation durability and final main CI remain release work. User authorization remains direct verified main merges, no PRs, no human-review release gate, free local operation and the complete V1 scope.

## Broader integration result

The full unit run completed: **1,291 files / 14,930 tests passed; one test failed; 49 files / 503 tests skipped**, 294.67 seconds. The failure is `every-api-route-has-a-caller`: the resolution endpoint has no production editor caller yet. Do not exempt it, add a prose-only reference, or add an unused caller to make this green. Finish the reachable editor workflow and exercise it. Private log: `translation-resolution-api-full-unit.log`. This job is terminal.

A focused broader check initially found two stale schema inventory counts after adding the resolution table and policy. The isolated catalog confirmed one new RLS table and one permissive SELECT policy. Expected policy/table/relation/RLS counts now reflect that deliberate addition. All 29 inventory tests pass; baseline/harmless source controls pass, and omitting the new policy or its RLS activation fails the appropriate inventory case. `generation-resolution-inventory-controls.json` records the checks. Action registry and existing engagement refusal checks passed in that same focused review.

Read-only PostgREST probes with zero-row limits confirm that its schema cache sees the new table: service metadata projection returns 200, service payload projection returns 403/42501, anonymous payload projection returns 401/42501. `generation-resolution-postgrest.json` records these limits; this is not a substitute for real resolution HTTP/browser integration.

Live GitHub main remains `ef16f166447ab477ea36588a5c01620f61560b19`: CI 34779793816 and RLS 34779793752 succeeded. These are main's existing checks, not validation of this unpublished branch. No PR or tag was created. All jobs launched in this increment are terminal.

## Editor implementation constraints

The current `recover(key)` archives only after matching a readable server request; it cannot resolve the absent/unreadable case. Its failure message overclaims that both copies exist. The current refused-request archive also lacks a durable resolution of the original identity; route it through the new resolution workflow where the original work must be closed. Keep ordinary recovery of a readable acknowledged request distinct from explicitly resolving its work.

Persist an exact resolution intent and original raw string before dispatch. Retain it on lost acknowledgement or failed storage/readback. Verify receipt bytes and identity before archiving; preserve the receipt with the original copy. Another tab changing or removing the pending source must not cause the new copy to be overwritten or discarded. Multiple resolution IDs/copies are supported deliberately. A new generation remains a separate explicit action. Explain the actual outcome: waiting work cancelled, running work uncertain, existing output retained.

Bind async work to the authenticated user/workspace/campaign lifecycle and abort or ignore stale completions before any storage/UI mutation. Review the interval between preparing a persisted intent and dispatching under a changed login; server matching of an expected scope may be appropriate in addition to client lifecycle cancellation. Caller identity must always be checked against authenticated identity, never trusted as authorization. Retrying a confirmed receipt after a local archive failure must remain safe without claiming the provider stopped.
