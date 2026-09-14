# Portable translation isolation and recovery checks

Continues `aca3c6b8` on the owned translation worktree and branch. The previous goal turn made progress by fixing shared reads, installing migration 18, completing generation browser journeys and pushing evidence. This turn makes that database regression portable and strengthens the existing recovery checks. It does not declare a new release or change the full V1 destination.

## Regular isolation coverage

`openplan/src/test/engagement-translation-read-concurrency.test.ts` is now registered in `npm run test:rls-live`. It resolves the selected stack using the existing Supabase workdir/port helpers and requires an explicitly disposable container. It uses fresh synthetic identities and the real generation creation and stop RPCs in one transaction. The request is cancelled before commit; no queued fixture becomes visible to a worker. Immutable cancelled records are retained in the disposable stack.

The eleven checks exercise simultaneous detail/catalog readers, exclusion of writers and source/campaign/membership changes, recovery after the lock is released, viewer/outsider/anonymous refusal, revoked staff access and private-helper grants. Independent psql sessions report actual readiness and remain open until competing operations return. The detail response also passes the native decoder.

`prove-portable-translation-read-tests.py` runs the same Vitest tests against baseline, harmless SQL and ten deliberate faults. Baseline and harmless changes survive. All targeted faults fail the named assertions, including exclusive readers, missing locks, viewer/outsider/anonymous disclosure, direct helper access and unlocked write replay. It restores function definitions and grants between cases and verifies equality afterward. `portable-translation-read-controls.json` records current source/test hashes and private evidence. These tests do not measure high-volume performance or establish browser usability.

The full isolated suite passed **55 files and 495 tests in 360.75 seconds**, against `supabase_db_openplan-restore-target-2026091050`, database `postgres`, workdir `/home/nathaniel/.local/state/openplan/openplan-restore-target-2026091050`. Private log: `translation-migration18-full-rls.log`. Migration count remains **337 through 20261014000018**. At the final database check, all 27 new concurrency-fixture fields were cancelled and the four earlier browser fields remained completed; no fields were queued/reserved/running. No provider was called.

## Recovery and browser wrapper coverage

Four added React/native cases protect request readback before dispatch, volatile refusal state when storage updates fail, preservation of an unreadable copy after a failed server read, and preservation of the refused source when archive readback differs. The complete generation-editor file passes 32 tests. Baseline and harmless helper/panel changes survive; each of four targeted faults fails its intended case. `generation-recovery-controls.json` records evidence and limits. No production editor behavior changed in this turn.

The active manual/access browser wrappers now expect installed 337/18 and still never add grants. Their controlled process tests pass; six targeted faults fail. Four actual normal/abrupt child exits preserve installation state and permissions. Results are in `translation-browser-wrapper-337-controls.json`. The migration-17 report is retained separately. These exit probes do not rerun browser journeys; prior browser evidence is in the shared-read note.

TypeScript, focused lint, browser-script syntax checks and `git diff --check` pass on the final checkpoint files. Full QA, shuffled tests and release CI have not been rerun in this turn.

## Remaining software work

The unreadable-request test verifies preservation, not a complete resolution path. `recover(key)` in `translation-generation-panel.tsx` requires a readable matching server request before archiving the local copy. If none can be retrieved, the UI stays blocked from generating again. The current error's statement that both copies remain retained also overstates what a failed read proves.

Do not solve this by deleting local storage or treating a missing response as proof that a request was never saved. An earlier POST may still be in flight. A safe resolution needs a durable decision associated with the original request identity that future retries and workers respect, retains any original bytes/output, and distinguishes absent, queued, running and completed outcomes. Extend the existing generation workflow and action/receipt patterns, then exercise interrupted resolution and late retries. This is the next implementation task within the existing M9b lane, not a new module or reduced V1 scope.

Catalog pagination/lifecycle and worker-transport failure controls remain to finish. Public comment generation still uses the legacy producer and lacks the new durable reservation/recovery behavior. Production browser review, the recorded 404 console issue, full QA/shuffled/worker/upgrade checks and final main CI remain release work. Current main must be rechecked and coordinated with its other session before joining. No PR, tag or main update occurred here.

## Runtime and corrections

The ordinary owned webpack dev server remains on 3260, launch CLI 1065976 from the previous checkpoint; revalidate the PID/cwd before operating on it. Synthetic provider overrides remain removed, `.env.local` unchanged, and the older proof databases and original/demo checkouts untouched. All test and mutation jobs in this note are terminal.

The initial portable fixture tried to demote its only owner and correctly hit the owner-floor rule before testing access revocation. A separate synthetic custodian now keeps the fixture valid. The first fault runner omitted statement terminators from `pg_get_functiondef` output and stopped with SQL syntax errors before committing replacements; it was corrected and rerun. Type checking caught UUID-default parameter inference and Playwright-only `exact` options mistakenly used with Testing Library; both were corrected, and the fault controls reran on the corrected files. These failed attempts are not counted as acceptance.
