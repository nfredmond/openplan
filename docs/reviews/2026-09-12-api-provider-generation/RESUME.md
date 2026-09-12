# Resume API generation and worker join

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

At this checkpoint two local jobs were confirmed live:

- Full QA exec session 69675, private `generation-full-qa.log`.
- Shuffled seed 912128 exec session 54108, private `generation-shuffled.log`.

Both logs are under
`/home/nathaniel/.local/state/openplan/api-provider-research-2026-09-12`.
They explicitly load `api-settings.env` for the named disposable stack on
29821/29822. Do not print that file. Poll existing handles and inspect terminal
output before restarting; source changes are suspended during these suites.
No browser server or acceptance collection is active. No SQL change was made.

After final gates, update the evidence, push directly to main without a PR and
inspect its CI. Do not tag this internal increment. Then implement the retained
API turn references, connection-edit/revoke interruption, service claim/status
and common completion validator described in
`../2026-09-12-api-connection-storage/EXECUTION_JOIN.md`.
Reuse this generation adapter and the native connector's private journal, then
wire the existing project panel. Current settings continue to disclose that
saved API connections cannot yet generate Planner Agent answers.
