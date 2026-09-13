# Usage-limit pause, September 13, 2026

> Superseded runtime and next steps: read [RESET_HANDOFF.md](RESET_HANDOFF.md), the later September 13 checkpoint. The text below preserves the earlier pause evidence.

User is pausing around a weekly usage reset. Resume the existing full v1 goal;
do not recreate it, shrink its scope, or treat this checkpoint as a release.
Direct main after verification, no PRs, no human review release gate. Existing
Playwright authorization continues. Keep local/free operation and the pending
reminder constraint unchanged.

## Ownership and checkpoint

Owned checkout: /home/nathaniel/.local/state/openplan/engagement-response-writes-2026-09-12
Branch: work/engagement-response-writes. App package: openplan/.
Previous checkpoint: b1d41c188bc467bd90b06d7bea9da0f9e32baaaf.
This pause checkpoint preserves unfinished changes; do not merge or tag it on
this evidence alone. Main/release last established at v0.56.1 / 3f70af98;
refresh remote status on resume. No subagents were spawned.

No prove-transaction, prove-broadcast or prove-authority process remains in the
process inventory at pause. Tool session 19089 is no longer available, so its
final exit status was not recovered. The complete JSON artifacts are present:
transaction 17 cases, broadcast 16, authority 9, editor recovery risks 6;
every case records matched=true. This is artifact inspection, not a fresh rerun.
No app or worker for this checkout was started. Leave the demo next-server and
other sessions alone. Recheck process ownership before editing on resume.

## Latest changes

The editor now offers reviewed correction after HTTP 413, preserves unreadable
sessionStorage bytes before reopening the editor, and removes accepted AI
suggestions using the same trimmed text as the retained request. Preservation
checks archive readback, concurrent changes and valid replacement requests.
Original failed regressions remain in the private probe folder; four targeted
editor mutations and a harmless control are retained in the review artifacts.

New authority probes cover actor replay, campaign scoping, viewer/outsider
access, revocation and anonymous execution. Earlier fixture errors are retained
in the initial logs. The owner-floor guard was respected by adding a synthetic
replacement owner inside the rolled-back probe.

A separate-connection test reproduced a save committing after revocation had
completed. The write RPC now locks the checked workspace membership FOR SHARE.
The concurrency probe checks both orderings and removes the lock to reproduce
the failure. It restores the actual previous clone function definition and
records that restoration separately.

New migration 20261014000003_engagement_response_recovery.sql is assembled from
the transaction, guards and broadcast queue companions. IT IS NOT APPLIED.
It includes the membership lock. Fresh complete TypeScript/lint checks for these
latest edits, full QA/shuffle/RLS/workers/upgrade, live browser acceptance and
final release CI are still outstanding. Prior editor-checks.json is historical.

## Database custody

Disposable container: supabase_db_openplan-restore-target-2026091050.
Source app/PostgREST database: postgres, API 29821, DB 29822.
Last source inspection: 321 migrations through 20261014000002; new receipts
table absent. Prototype probes run BEGIN/ROLLBACK. Before migration, verify the
exact old ledger and retain a private backup. Apply only to this named stack.
Preserve campaign a3c41566-bfd4-40f2-b467-96ee79054ec6 and its 1,005 responses.
Retained history checksum: 8bfd7b6e9182f0c5c889954e7baf2eeacdd38c73e5e21b2633956324f161b1ae.
Find the original checksum query in the review scripts; do not guess its ordering.

Clone response_write_probe_20260913 in that container is NOT the app target.
It contains synthetic failed mutation records and an older transaction prototype,
not the complete queue schema. The new authority-concurrency script restores
its actual original function. The older mutate-concurrency.py restoration must
be inspected before reuse because it uses a source-derived definition.
Private dump/logs: /home/nathaniel/.local/state/openplan/response-write-probe-20260913/.
Private config: /home/nathaniel/.local/state/openplan/api-provider-research-2026-09-12/.
Never print or commit credentials. Owned checkout currently has no .env.local.

## Resume next

1. Refresh ownership, working tree, current main/CI and product direction.
2. Run fresh focused tests, TypeScript and lint for the latest recovery changes.
3. Verify migration matches companions, back up the named source database,
   apply the additive migration and verify the original fixture/checksum.
   After applying, do not run prototype installers against that migrated source;
   adapt probes to installed schema or another explicit clean test database.
4. Join Activity to durable attempting/uncertain outcomes before enabling worker.
5. Check concurrent queue claims, unsubscribe races, empty/no-share states and
   live PostgREST-to-worker recovery. Use local mail fixtures, no external sends.
6. Start an owned identified build; use which-openplan.sh and real navigation
   at desktop/390px with keyboard, recovery, history, privacy and console checks.
7. Complete QA, shuffled tests, RLS isolation, workers and upgrade checks. Prepare
   the coherent next minor release, land directly on main and inspect final CI
   before tagging. Then continue the roadmap toward the complete v1 contract.

Read RESUME.md, EDITOR_JOIN.md and the earlier implementation/verification notes
for background. This document supersedes their older statements about the latest
unapplied migration and completed authority probes only.
