# Public translation HTTP and browser integration reset checkpoint

This is an unfinished development checkpoint after `fad0ed25`, saved for the weekly usage reset. It is not a release. Worktree `/home/nathaniel/.local/state/openplan/translation-command-workflow-2026-09-13`, branch `work/translation-command-workflow`. Original checkout and demo remain untouched. The full V1 objective, local/free operation, direct-main releases without PRs and no human-review release gate remain authorized. Do not restart the obsolete v0.48 release task; v0.58.1 is already released.

## Saved implementation

The public comment translation route now uses the durable queue and read helpers instead of directly calling the provider. GET observes existing work without creating attempts. POST requires the displayed source hash, same-origin browser authority, bounded strict input and an explicit predecessor for retries of terminal requests. Responses use a shared browser-safe schema and private/no-store caching. Existing source-matched legacy cache words remain readable without selecting a new credential or paying for regeneration.

The public portal now uses `use-public-comment-translations.ts` for bounded GET polling, explicit status checks and explicit new attempts. Source, share-token, locale, preview, clear and unmount changes invalidate old observations. The original comment stays visible. English and Spanish status messages are wired. This has focused component evidence, not a completed browser journey.

The SQL candidate appends a source-bound legacy cache reader. It remains under this review directory, not in the migration directory, and is NOT installed in the browser application database.

## Checks and errors

The 41 database control cases and 28 server control cases finished with all expected outcomes. Their JSON manifests record source hashes, harmless survivors and targeted failures. At this checkpoint the candidate, server helper and extracted contract match those recorded hashes, so no fault edit remains. These checks do not prove HTTP/browser or actual provider execution. New route/hook guards and cache-helper guards still need their own targeted mutation coverage.

Focused tests passed 128 tests across three files. ESLint passed for all changed application/test files. The first standalone type check failed because a test cast a union of header objects to a string dictionary. The test table now declares its dictionary type directly. The final standalone type check exited 0, and the final focused rerun exited 0 with all 128 tests passing. Logs are private under `/home/nathaniel/.local/state/openplan/response-write-probe-20260913/public-reset-*`.

Earlier full QA, shuffled tests, RLS, worker suites and browser evidence belong to earlier commits. Do not promote them to this checkpoint or a release claim. The old concurrency evidence also predates the cache-reader append.

## Resume next

1. Read this note, current git status and live jobs before restarting anything. Both public mutation runners were terminal at checkpoint. No Next dev server was found running for this worktree. Do not assume any process survives the usage reset.
2. Finish route/hook/cache-helper mutation controls and existing portal/preview/i18n checks. Update stale public-route exception prose in `workspace-write-role-gate-guard.test.ts` that still describes only a cache write.
3. Finish additive migration and actual worker/HTTP integration in the named isolated application stack. Container `supabase_db_openplan-restore-target-2026091050`, API 29821, DB 29822, application database `postgres`, last observed migration 338 / 20261014000019. Recheck before changing it.
4. NEVER attach a worker or PostgREST to `openplan_public_translation_proof_20260913` or `openplan_public_translation_retry_proof_20260913`. These retained schema-only proof databases contain synthetic queued/reserved requests. Preserve them without resets or drops. Existing resolution proof DB also remains separate.
5. Use the existing local Playwright harness and synthetic network guard with no paid provider calls. Identify the served checkout with `which-openplan.sh`. Exercise real navigation into the public portal and its about/comment page at desktop and 390px, keyboard and console included. Prove cache recovery, lost acknowledgements, explicit retries, source/privacy changes and worker interruption behavior. Earlier screenshots are not a rerun.
6. Run final QA, shuffled tests, isolated RLS, worker and populated upgrade checks. Inspect CI on the final main release commit before tagging. Continue the actual roadmap and full V1 contract afterward.

Existing server startup, synthetic account location and private evidence recipes are preserved in the preceding progress notes. Never print account secrets. The current checkpoint requires no user decision to resume.
