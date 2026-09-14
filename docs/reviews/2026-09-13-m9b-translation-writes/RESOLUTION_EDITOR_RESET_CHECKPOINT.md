# Recovery editor usage-reset checkpoint

The user requested a safe pause near the weekly usage limit. Resume in the same thread if available; repository notes are the durable fallback. Full V1 remains authorized. Direct verified main merges and releases, no PRs or human-review release gate; free local operation. Preserve the original checkout, demo and pending reminder constraint.

## Checkout and saved state

Owned checkout: `/home/nathaniel/.local/state/openplan/translation-command-workflow-2026-09-13`, branch `work/translation-command-workflow`. Run application commands from its `openplan/` directory. The preceding pushed checkpoint is `054a2e6378ae75957d0fc704f53e0348fdc40309`.

This backup adds the unfinished `openplan/src/lib/engagement/translation-resolution-recovery.ts`. It has NOT been compiled, tested, integrated into the editor or released. Do not merge this checkpoint as a verified capability. Read `RESOLUTION_API_PROGRESS.md` for the verified preceding work and its explicit limits.

The previous full unit run has one real failure: `every-api-route-has-a-caller` finds the new generation resolution endpoint unused. Finish a reachable editor caller; do not exempt the route or add a fake caller. The preceding full isolated RLS run passed 525 tests. These are retained results, not reruns during this pause.

## Exact next implementation

The helper freezes one or two surviving original browser copies into durable resolution intents, verifies exact receipt hashes and scope, and archives before removing matching originals. Multiple copies have separate resolution IDs under the same original request ID. Retrying must keep these IDs, preserve changed copies from other tabs and never automatically start replacement generation.

Before testing, replace the partial-object `as PendingResolution` cast in `preparePendingResolution` with a plain copy-comparison helper. Add an explicit source-key versus pending-key collision guard. Test scope/key binding, both copies, quota/readback failures, changed source/pending bytes, checksum and receipt binding, replay after archive-cleanup failure and lifecycle cancellation. Every changed guard needs harmless and targeted failure controls.

Connect the helper to `translation-generation-panel.tsx`, including refused and unreadable recovery. Replace the false failure message claiming both copies remain retained. Clear remembered/volatile originals only when represented by archived copies. Share the busy guard with queue dispatch. Verify the parent user/workspace/campaign key rather than assuming it exists. Bind all async effects to that lifecycle, abort or ignore stale completions before storage or UI mutation.

Review expected-user/workspace headers at the resolution endpoint so changed login cookies cannot dispatch an old browser intent under a new actor. Compare against authenticated identity; headers are never authorization. The endpoint currently has no such headers. Preserve running-provider uncertainty and original retained output/history.

Then run actual desktop and 390px journeys from navigation with keyboard, console, privacy and interrupted-retry checks. Full QA/shuffle, workers, upgrade, remaining public-generation durability and final main CI remain release work. Do not restart from the obsolete v0.47 plan; latest recorded release is v0.58.1, but recheck remote release state before landing.

## Local services and evidence

At this pause, no Vitest, Playwright acceptance or proof runner was live. The owned ordinary webpack dev server remained on 3260 under this session. Browser root access had been checked in the preceding work, not new recovery acceptance. Do not assume any process survives the reset. Re-identify served checkout using `bash scripts/ops/which-openplan.sh http://127.0.0.1:3260` before browser work.

The isolated browser stack is `supabase_db_openplan-restore-target-2026091050`, API29821, DB29822, workdir `/home/nathaniel/.local/state/openplan/openplan-restore-target-2026091050`. Migration19 is installed, 338 migrations through20261014000019. Do NOT rerun preactivation `prove-generation-resolution.py` against this installed stack. Use normal installed native tests. Separate schema-only proof DB `openplan_translation_resolution_proof_20260913` has no attached app or worker.

Ordinary server configuration has no synthetic provider overrides. Do not run the controlled generation-worker browser scenario without restoring its documented isolated transport. Private logs and fixtures remain under `/home/nathaniel/.local/state/openplan/response-write-probe-20260913`; do not print credentials. Account file location and commands are in preceding review scripts/notes.

Another Codex process was still active in the original checkout at pause. Recheck ownership and live work before editing or joining main. No process was killed, no database reset was performed, and no main merge or release was attempted for this backup.
