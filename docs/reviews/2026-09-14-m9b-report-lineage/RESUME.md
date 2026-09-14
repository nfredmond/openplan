# Restart after the usage reset

Saved September 14, 2026. Continue the existing active goal through the complete V1 contract. No draft PRs or human release gates. Verified changes land directly on main; do not merge this unfinished checkpoint before its remaining checks. No paid resources, destructive database operations, or reminder-constraint edits.

## Checkout and ownership

Use /home/nathaniel/.local/state/openplan/translation-command-workflow-2026-09-13, application package openplan/, branch work/engagement-decision-traceability. This branch is being backed up to origin without a PR. Another live Codex owns /home/nathaniel/code/openplan, which stays read-only. Recheck current sessions, worktrees, remote main and serving identity before edits.

## Released and unfinished

v0.60.0 is published at tag commit 29c5f7ab5140a0c71652485189d158c7099ead80. Publication evidence is committed on main at 9f7d9e4a28abe0ffc4b922175d381c95c4512669, also confirmed with git ls-remote during this checkpoint. See ../2026-09-14-m9b-decision-reports/PUBLICATION.md and RELEASE_VERIFICATION.md for CI, local QA, RLS, worker and upgrade evidence. The initial report-context implementation is fec3ed7fb8cb0316e49a932ec399ac89029f2166; the next checkpoint includes incomplete metadata-editor restoration and copy changes.

## Resume here

1. Read STATUS.md and IMPLEMENTATION_NOTES.md. Latest focused log is /home/nathaniel/.local/state/openplan/response-write-probe-20260913/decision-context/report-page-metadata-tests.log. It finished with 27 passing tests and one copy-guard failure. Find the remaining campaign count increase, fix the wording without inflating the baseline. Metadata save tests passed but are not browser proof.
2. Inspect metadataOnly behavior in report-detail-controls.tsx, specialized-report-page.tsx, their tests, and the reports/[reportId] caller. Preserve the existing editor, permissions, citations and retained file contents. Consider replacing irrelevant generation help text in metadata-only mode.
3. Update prove-report-page.py for the new userId argument, membership query, editor and new copy. Add harmless controls and targeted failures for changed permissions/metadata guards. Earlier eleven-fault evidence is for fec3ed7f only. Restore mutations without checkout/reset.
4. Run changed-file lint and TypeScript from the app package, focused checks, then build and identify a fresh server. Browser runner report-page-browser.cjs still expects Open campaign; current label is Open consultation. Exercise actual metadata save/readback, existing downloads/checksums, keyboard, anonymous refusal, desktop and 390px, inspect console and screenshots. Prior evidence is explicitly dated to fec3ed7f.
5. Run full QA, applicable shuffled/RLS/worker/upgrade checks. Push the verified result directly to main, inspect final CI separately, then continue the internal decision-history exports. No v0.61 claim or tag yet.

## Local operation and private evidence

Private evidence base is /home/nathaniel/.local/state/openplan/response-write-probe-20260913/decision-context/. Existing browser fixtures and checksum records are under browser/. Credentials remain in local files and must never be printed or committed. The report acceptance server on port 3262 was stopped before full QA; recheck before starting. The isolated document worker PID 4038996 was still live when checkpointed; verify ownership/current state before using it. Do not kill other workers.

Application isolated stack is supabase_db_openplan-restore-target-2026091050, API 29821, database port 29822, 342 migrations through 20261014000023. Stack directory is /home/nathaniel/.local/state/openplan/openplan-restore-target-2026091050. There is also a disconnected proof database openplan_decision_link_proof_20260914 in that container. Do not reset or drop either.

## Next substantive work

Internal PDF/XLSX/ZIP decision lineage is not implemented. Read openplan/src/lib/engagement/decision-links.ts and reuse its exact payload/context hash and predecessor-chain validators; do not invent current source states for historical archives. Private draft decision-context/report-decision-history-candidate.sql is UNAPPLIED and not an application migration. It proposes internal schema 2 with campaign-wide history, keeping public schema 1 and retry behavior. Public snapshots must reject private history fields because ZIP retains source snapshot text. Legacy internal schema 1 must remain readable and disclose absent history, not zero. Disclose campaign-wide private history separately from contribution filters. Preserve campaign lock order and exact PostgreSQL payload text. Continue within existing owners; M9b and the full v1 contract remain open.
