# Resume API generation and worker join

The main adapter CI and RLS runs below have now succeeded. The database lifecycle
is implemented on the work branch, with concurrency and broader gates pending.
Continue from `../2026-09-12-api-turn-lifecycle/RESUME.md`; do not duplicate it.

Use checkout `/home/nathaniel/.local/state/openplan/agent-hold-receipts-2026-09-10`,
package `openplan/`, branch `work/planner-agent-api-connections`.
The full v1 goal remains active; v0.54.0 is already released. Do not repeat old
release chores, change the root checkout/demo, or touch the reminder constraint.

The settings increment at main `100216a3` has successful CI, RLS Isolation and
Upgrade Path. This next increment implements the real SDK generation adapter
in `provider-api-generation.ts` with 28 local fixture tests. It has no production
worker caller yet. See `VERIFICATION.md` for evidence and explicit limits.
The final mutation run had one harmless survivor and 21 targeted failures;
137 restored focused cases passed. Sources are not being mutated anymore.

Both local jobs are now terminal with exit zero:

- Full QA exec session 69675: 13,972 app passes/413 skips, 382 connector
  passes/four skips, zero audit vulnerabilities, successful TypeScript and build.
- Shuffled seed 912128 exec session 54108: 13,972 passes/413 skips.

Both logs are under
`/home/nathaniel/.local/state/openplan/api-provider-research-2026-09-12`.
They explicitly loaded `api-settings.env` for the named disposable stack on
29821/29822. Do not print that file. Do not restart these completed local jobs.
Source checkpoint is `b9e93348b4d425fa520883ffca0a24c6e0a0373b`.
No browser server or acceptance collection is active. No SQL change was made.

The evidence child landed directly on remote main at
`c858b89e7293ce90fb9afea67ce481b7bcd0a8fa`, without a PR. Exact main runs are
CI `34722018877` and RLS Isolation `34722018874`, confirmed queued at this
checkpoint. Inspect these exact runs for completion before advancing; the prior
main passes do not prove this commit's CI. This resume-only follow-up stays on
the work branch so it does not restart main checks. No new upgrade run was
dispatched for this SQL-unchanged adapter. Do not tag this internal increment.
Then implement the retained
API turn references, connection-edit/revoke interruption, service claim/status
and common completion validator described in
`../2026-09-12-api-connection-storage/EXECUTION_JOIN.md`.
Reuse this generation adapter and the native connector's private journal, then
wire the existing project panel. Current settings continue to disclose that
saved API connections cannot yet generate Planner Agent answers.
