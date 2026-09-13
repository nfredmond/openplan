# Staff translation queue API checkpoint, September 13, 2026

This continues pushed 62a0c261 in the owned translation checkout. The staff queue
creation and request-reader API are implemented. The editor still uses the old
machine path, retained generated publication is still refused, and the complete
workflow remains unreleased. Full M9b and V1 stay active. No PRs or human-review
release gate; continue local/free development and direct verified main releases.

## Implemented boundary

POST `/api/engagement/campaigns/[campaignId]/translations/generation` accepts one
strict request ID, target locale and up to 25 stable field IDs with their observed
source and saved-translation versions. It derives campaign/workspace/user access,
model and credentials on the server, uses the existing browser-origin guard and
refuses marked unregistered Planner Agent executions. It never invokes a model.
New requests return 202; confirmed retries return 200 with the same identity.

The queue service checks a private scoped replay projection before preparing a
key. A retained request can therefore be confirmed after its first response was
lost and the key removed. Its exact actor/campaign/locale/field intent must match.
The service then calls the existing constructor RPC, which repeats current staff
permission and handles the receipt before new source/key checks. SQL owns atomic
creation and source-version validation. The service lookup and SQL constructor protect separate stages.

GET with `requestId` uses the caller's authenticated RPC, without service keys.
Migration 20261014000014 adds the staff-only scalar reader. It returns all fields,
the original packets and encoded output plus safe credential identity/configuration
metadata. It grants no private table access or credential ciphertext. The server
checks scope, count, duplicate identities/addresses, packets, claim completeness,
output status/digest and receipt binding before returning staff display words.
Equivalent timestamp spelling is allowed without changing the retained receipt.
Lost SQL access returns forbidden, while an unconfirmed read remains unavailable.

The client-safe request/read contract has no server credential or crypto imports.
The server helpers perform hash/receipt checks. No editor or browser-use claim is
made for these endpoints yet.

## Evidence and instrumentation corrections

The final focused run passed six suites and 240 tests. TypeScript passed. Focused
lint passed after removing one unused fixture variable. Release-ordering checks
passed after the changelog named the new migration. These are not the full QA,
shuffled, whole RLS, worker campaign or upgrade/restore release gates.

`generation-request-controls.json` records 46 route/reader tests and 48 control
cases: ten baselines/harmless survivors, 38 targeted failures, all expected.
Controls remove retry binding, scope checks, source/input bounds, origin and staff
gates, agent refusal, acknowledgement checks, SQL permission, field completeness,
output retention and credential exclusion. Each targeted result names a failed
assertion; startup or syntax failure is not a substitute.

The first wrong-scope reader fixture was inconsistent with its receipt. Removing
the requested-scope check survived because the receipt check still refused it.
The fixture now uses a coherent queued request from another scope, with no receipt
to mask that boundary. Each removed request/workspace/campaign check now fails its
named assertion. The initial survivor and subsequent repairs remain in private
logs; it was a coverage gap in the first fixture, not proof of the intended guard.

`generation-request-read-restored.json` records an actual two-field PostgreSQL
read through the native TypeScript decoder. The existing proof case has one
completed output with NUL/lone-surrogate provider metadata and one queued field.
Owner and member reads agree. A removed member, viewer, outsider, foreign request
and anonymous role are refused. Captured credentials and private tables remain
inaccessible to those ordinary roles. The anon grant control tests the database
role boundary even with an existing staff subject in the controlled session; it
is not an ability for an external anonymous user to forge a signed subject.

The first fixture removal matched the synthetic member's automatically-created
personal workspace too, and the owner-floor trigger stopped it. The corrected
removal names both the test member and target workspace. The entire failed and
successful probe transactions rolled back. An initial TypeScript test annotation
used DOM RequestInit with nullable signal, conflicting with NextRequest's stricter
type; the inferred request initializer fixed it.

## State and private evidence

Owned checkout is
`/home/nathaniel/.local/state/openplan/translation-command-workflow-2026-09-13`,
branch `work/translation-command-workflow`, application package openplan/. Main
v0.58.1 metadata was already merged at bc7cd8c2. Previous live main/CI evidence is
in GENERATION_WORKER_PROGRESS.md; recheck current external state before release.
No edits were made to the original checkout, demo or pending reminder constraint.

Migration 14 was applied only inside BEGIN/ROLLBACK in
`supabase_db_openplan-restore-target-2731143`, database
`openplan_translation_command_proof_20260913`. It is not installed permanently in
any stack. The app stack remains through migration 20261014000012. The separate
worker proof database and stopped HTTP container remain as recorded in the worker
checkpoint. No provider call or new worker process was started by this increment.

Private evidence root is
`/home/nathaniel/.local/state/openplan/response-write-probe-20260913`.
Logs include generation-request-controls-origin-final.log,
generation-request-read-restored.json, generation-request-read-native.log,
generation-queue-routes-tests-final.log, generation-queue-routes-type-final.log,
generation-queue-routes-lint-final.log and generation-queue-routes-release-ordering.log.
Earlier failed logs are retained under distinct names. Mutation scripts verify
restoration of all modified source. Existing command/output proofs remain separate.

## Next implementation

1. Add staff discovery of saved requests by campaign with complete, paginated
   records. GET currently requires a known request ID. Browser storage alone must
   not be the only way to find an already-created batch after a reload/reset.
   Expose lease timing if the editor needs to distinguish an expired saved claim
   from current worker activity; the current display DTO returns saved state only.
2. Implement `publish_generated` through the existing exact-source command and
   history receipts. Bind field/attempt/delivery digest, original source/locale
   and observed translation version. Read exact retained words from the database;
   a client-supplied text/model cannot substitute for model-origin evidence. A
   completed prior artifact must remain usable without another key/model call.
   Preserve original generation actor and the separate staff publication actor.
3. Connect the existing CampaignTranslationsPanel to queue creation, progress,
   retry and retained output, with request storage that survives uncertain
   acknowledgements and does not replace manually typed drafts. Retire its old
   sequential suggest/publish_machine path. All legacy content-translation DML
   found by the bounded source search is in translations/route.ts; audit the
   broader repository before revoking direct producers and enabling command EXECUTE.
4. Public comment cache provenance and public dispatch allowance are still an
   explicit following obligation. They use separate cache records; assess their
   actual shared guards rather than treating an unrelated path as an automatic
   blocker on a coherent staff-workflow release. Keep the full original scope and
   state any bounded release limits clearly; do not silently close M9b.
5. Install additive migrations only in an identified, owned app test stack after
   accounting for historical probes that currently expect migration 13 absent.
   Prove queue creation/worker/result/publication from real navigation at desktop
   and 390px, with keyboard, console, saved originals and interrupted retries.
   This turn's auth/service queries are mocked in route tests; SQL access tests
   are real but are not an HTTP route or UI journey.
6. Finish applicable QA, shuffled tests, isolated RLS, worker, upgrade/restore and
   final-main CI evidence before a release tag. Keep V1, national/territory/tribal
   scope and separate model validation unchanged.
