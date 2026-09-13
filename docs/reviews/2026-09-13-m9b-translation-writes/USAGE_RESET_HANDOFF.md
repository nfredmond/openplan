# Usage reset checkpoint, September 13, 2026

Resume this existing work after the usage reset. This is an unfinished backup,
not a release or a verified main merge. The user wants direct main after checks,
no PRs, local/free operation, and continued development through the full V1 contract.
Do not restart the obsolete v0.47 plan. v0.58.0 was already published.

## Owned work and evidence

Worktree: `/home/nathaniel/.local/state/openplan/translation-command-workflow-2026-09-13`.
Branch: `work/translation-command-workflow`. Previous checkpoint: `c5a221e1`.
Original checkout `/home/nathaniel/code/openplan` and demo remain untouched.
Another Codex process was active at the original checkout; recheck ownership.
This checkpoint owns the translation panel, write/draft recovery components,
snapshot-backed campaign state, campaign page wiring and their editor tests.

Read WRITE_BOUNDARY_PROGRESS.md for the previously tested command boundary,
SNAPSHOT_PROGRESS.md for SQL/HTTP/concurrency evidence, and NEXT.md for the full
remaining workflow. Recheck product direction and live main/CI before landing.

Manual save/accept/withdraw now use exact source/version commands and retained
request recovery. The panel reads one complete scalar snapshot. Unavailable or
unsupported-language retained wording stays visible for review/withdrawal.
Unsent drafts now retain their original source/version and reason in scoped
sessionStorage so refreshed props cannot silently rebase them. Submitted request
copies remain in localStorage. These new UI/draft guards still need mutation proof.

## Real browser failure and immediate next work

The desktop journey navigated from sign-in through Engagement and campaign Setup.
It committed an original, deliberately lost its acknowledgement, reloaded and
replayed the identical request, then saved a reasoned correction. A second browser
saved a competing correction. The first browser's unsent wording disappeared and
its Save button became disabled before it could submit the stale edit. The exact
remount cause was not established. The new draft retention/frozen-origin code is
intended to fix this; it has NOT yet been rerun in the browser.

Private evidence directory:
`/home/nathaniel/.local/state/openplan/response-write-probe-20260913`.
Harness: `translation-editor-browser.cjs`, uses canonical qa-harness Playwright.
Failed artifact prefix: `translation-editor-1440-1789321480908`.
Synthetic campaign: `9de46a23-a0f8-4bdc-b9a2-173190d2db4c`.
Do not publish raw account/session captures. Credentials are read from the existing
private api-settings-account.json, never pasted or committed.

Fix harness cleanup before rerunning: pending waitForResponse promises need
immediate rejection handling; context-close errors must not bypass SQL finally.
The unhandled rejection interrupted cleanup in the failed run. Root manually
revoked the temporary grant, and has_function_privilege was rechecked false during
this checkpoint. Correct history region label to "Translation history", include
new draft files in source hashes, and add stage logs/readiness checks. Do not
replace the actual draft-retention fix with harness delays.

Then run desktop and 390px keyboard journeys, inspect console and saved artifacts,
including conflict review, archived original bytes/checksums, withdrawal/recreation,
private history access and interrupted recovery. Only the earlier desktop stages
above were observed. Do not describe the unfinished browser run as passing.

## Disposable infrastructure

App stack: `supabase_db_openplan-restore-target-2026091050`, API 29821, DB 29822,
workdir `/home/nathaniel/.local/state/openplan/openplan-restore-target-2026091050`.
Now 330 migrations through 20261014000011, installed via db:sync this turn.
Authenticated EXECUTE on write_engagement_translations is REVOKED. Temporary
browser grants must be contained and revoked even on failures. Migration still
withholds production grant while legacy producers remain unconverted.

Owned webpack dev server was running on 127.0.0.1:3260, node PID 3219499, at
checkpoint. Reinspect before use; restart if absent from this worktree's openplan/
with `npm exec -- next dev --webpack --hostname 127.0.0.1 --port 3260`.
Identify served checkout using which-openplan.sh. The earlier Turbopack launch
failed on an external node_modules symlink; webpack rendered the identified app.
Do not depend on process/tool handles surviving the usage reset. No browser or
Vitest job was active at checkpoint. Preserve databases and others' processes.

## Checks and remaining limits

Latest focused log translation-draft-recovery-second.log records 110 tests in
four files completing successfully. Current checkpoint TypeScript exited 0.
These are preliminary checks, not complete workflow or new-guard verification.
Earlier route/SQL mutation evidence applies to the source identified in its
records, not automatically to the new UI and draft code. Check current lint log
translation-editor-checkpoint-lint.log and resolve any remaining failures.

Still unfinished: durable generation/leases/retained publication/attempt accounting,
cache provenance, conversion of legacy producers and retirement of direct table
writes, receipt reason/exact-source metadata in history UI, new guard controls and
targeted mutations, full QA/shuffle, applicable isolated RLS/worker/upgrade/restore
checks, and exact final main CI before release. Generation still uses legacy paths.
Review draft recovery on storage failure and delayed acknowledgements. Keep old
unknown evidence unknown. Continue source-to-decision and the remaining roadmap
once this coherent translation increment is complete; V1 is not complete.
