# Resume retained API turns

Active full v1 goal remains open. v0.54.0 is already released. Main
`c858b89e7293ce90fb9afea67ce481b7bcd0a8fa` has successful CI 34722018877 and
RLS Isolation 34722018874. Continue A0b; do not repeat old releases.

Implementation checkout:
`/home/nathaniel/.local/state/openplan/agent-hold-receipts-2026-09-10`, package
`openplan/`, branch `work/planner-agent-api-connections`. Preserve the root
checkout, demo and unrelated reminder constraint. No other agent or browser
acceptance collection was observed in this tree.

The new migration `20261012000002_assistant_api_turns.sql` is implemented and
applied only to the explicitly named disposable stack at API29821/DB29822:
`/home/nathaniel/.local/state/openplan/openplan-restore-target-2026091050`.
Its matching migration file was copied into that stack's own migrations folder.
The stack now includes this migration; do not reset or apply it again manually.

`assistant-api-turns-rls.test.ts` has 16 focused live SQL cases. The final restored
run, exec 88368, passed 80 cases with the 64 existing provider-history cases.
Changed-test ESLint and diff checks also passed. Read VERIFICATION.md for the
discovered test errors and unproved boundaries.

Both mutation campaigns are terminal. Initial exec 76455 exited one because a
fault failed on an independent usage-ledger guard instead of the expected
assertion. Revised exec 83063 exited zero: one harmless control survived and 27
faults failed for their recorded reasons. All nine committed function bodies
matched the migration source afterward; hashes are retained. The 80-case replay
then passed. Do not restart any of these completed handles.

No local job is left running. Next, prove concurrent claims/edits/revocation/usage reservations with the existing
real transaction helpers. VERIFICATION.md describes a budget race that isolates
the advisory lock instead of accidentally testing a connection lock. Check actual
database function hashes after mutations, then run the full isolated database,
upgrade and applicable QA gates. Do not land this migration on main yet.

The TypeScript retained-turn validator/projection, API route selection, local
worker and project UI are not joined to these new database functions yet. Use the
already verified generation adapter and existing private journal primitives.
No new generation option or release is claimed. All local generation/SDK fixtures
stay synthetic and free; no external provider calls are needed for this increment.
