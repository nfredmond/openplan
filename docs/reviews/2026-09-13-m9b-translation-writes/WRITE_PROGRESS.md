# Translation write recovery checkpoint

Saved for the weekly usage reset on September 13, 2026. This is unfinished
development work on `work/translation-command-workflow`, not a release or a
verified main merge. The preceding verified snapshot checkpoint is `440eb03a`.
Read this file first, then SNAPSHOT_PROGRESS.md and NEXT.md. The full V1 goal
remains authorized. Resume implementation without asking for renewed permission.

## Checkout and saved work

Use `/home/nathaniel/.local/state/openplan/translation-command-workflow-2026-09-13`,
application package `openplan/`. The original checkout and demo are untouched.
No other editing agent, Vitest run or Next dev server was observed when this
checkpoint was prepared. Recheck ownership and remote state when resuming.

Five new files are preserved with this checkpoint:

- `src/lib/engagement/translation-write.ts` validates exact manual save, accept
  and withdraw intents and acknowledgements. It retains raw Unicode wording,
  nullable source locale, source availability, observed row/revision, correction
  reasons and caller request identity. Batches allow 200 entries and an 8 MiB
  streamed request. The helper makes one RPC and never retries automatically.
- `src/lib/engagement/pending-translation.ts` retains each request separately in
  localStorage, scoped to user and campaign. Frozen before copies and exact
  payload identity protect retries. Readback verifies storage writes, malformed
  records remain visible as unreadable, and archiving retains original bytes.
  Confirmation checks saved words and original authorship before clearing.
- `src/test/engagement-translation-write.test.ts` contains 35 tests. The preceding
  session recorded all 35 passing after fixing an invalid positive fixture that
  added an extra result-envelope key. This reset checkpoint has not rerun them.
  Harmless and targeted mutation controls for these new guards remain outstanding.
- `src/app/api/engagement/campaigns/[campaignId]/translations/commands/route.ts`
  adds an authenticated, campaign-scoped POST with private/no-store replies.
  It deliberately does not reread current source before a confirmed retry.
- `src/app/api/engagement/campaigns/[campaignId]/translations/snapshot/route.ts`
  adds an authenticated GET using the complete atomic snapshot reader.

The two routes have no route tests yet. Type checking and lint have not run for
these five new files. The editor and existing loader are unchanged. No new
browser acceptance, full QA, shuffled suite or release claim is made here.

## Resume at the integration

First test the routes and add meaningful mutation controls for new guards. Cover
duplicate acknowledgement addresses/row IDs, exact expected IDs and revisions,
unchanged-word saves, scope/locale mismatches and storage failure paths. Retain
the harmless control and targeted failure evidence, including blind categories.

Then join `loadCampaignTranslationState` in campaign-translations.ts and
campaign-translations-panel.tsx to the atomic reader and new commands. The old
loader makes separate reads and trims source/translation words. Preserve raw
words and use the single snapshot for observed source, row/revision and before
copies. Pass user ID, workspace ID and snapshot from the campaign detail page.
Use the existing response-write-recovery.tsx pattern for uncertain outcomes,
but retain separate translation requests rather than overwriting one slot.
Never send before durable local retention succeeds. Storage quota failure must
keep the user's words and explain recovery. Retry the original request exactly.

Build public coverage from available fields. Retained translations for unavailable
sources still need a visible withdrawal path without counting as public coverage.
Save/accept/generation require available source; withdrawal can retain an
unavailable baseline. Adapt page and panel tests to the new RPC contract and
valid UUID fixtures. Existing confirmation-decline tests remain relevant.

Migration 20261014000010 still revokes command execution from authenticated
callers. The disconnected proof database alone has a test grant. Decide staged
activation coherently while integrating the editor; no app migration/grant was
changed for this checkpoint. Legacy direct table producers remain. Generated
publication explicitly refuses until durable generation is implemented. Do not
describe that refusal, a manual prototype or a temporary test grant as completion.

After manual integration, finish durable generation/leases, retained outputs,
attempt accounting and public cache provenance, then convert every producer and
retire direct writes. Exercise identified desktop and 390px real navigation,
keyboard, console, exact retry and recovery. Run applicable QA, shuffled, isolated
RLS, workers, upgrade/restore and final main CI before tagging. Merge directly
when ready, without a PR or human-review release gate. Continue the full roadmap.

## Retained infrastructure

Private evidence base:
`/home/nathaniel/.local/state/openplan/response-write-probe-20260913`.
The disconnected `openplan_translation_command_proof_20260913` database is in
container `supabase_db_openplan-restore-target-2731143`. Source DB `postgres`
remains at 328 migrations through 20261014000009 according to the previous
checkpoint's rollback census. Do not reset or drop either database.
The separate app stack uses 29821/29822. The owned HTTP proof container
`openplan_translation_snapshot_rest_20260913` was stopped, and dev port 3260 was
stopped. Recheck before starting them. Secrets remain only in local private files.

v0.58.0 was already published before this work. Do not restart the obsolete
v0.47 release plan. Full V1 and its separate scientific validation obligations
remain unfinished. Preserve the pending reminder constraint and free/local scope.
