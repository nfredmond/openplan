# Resume API connection implementation

Active full v1 goal remains open. v0.54.0 is already published. Do not repeat
v0.48 or v0.54 release work. Preserve all planning and separate model obligations.

Implementation checkout:
`/home/nathaniel/.local/state/openplan/agent-hold-receipts-2026-09-10`
Package `openplan/`, branch `work/planner-agent-api-connections`.
Settings code and browser evidence are on remote main at
`100216a32c458e0c1cc85c050fb088891565c5d0`. The previous foundation CI/RLS were
green; inspect the new main runs below before advancing the next increment. Root checkout and demo are separate and
must not be switched or modified. No other agent was observed owning this tree.
No PR exists; land verified work directly to remote main.

## Current source and evidence

Storage/routes are implemented. The real settings caller and paginated history
are now implemented too, alongside existing integrations on `/workspace`.
Current product source checkpoint: `92b927fc0e2e069be87f56eb51f44c578e3c58c5`,
pushed. See `VERIFICATION.md` and `settings-mutations.json` in this folder.
The original instruction to add a caller is superseded; do not duplicate the UI.

Settings have 15 focused component cases; routes have 22. Mutation evidence has
one harmless control, 21 targeted failures and one explained redundant-lock
survivor. Actual duplicate dispatch fails. Sources are restored. The existing
storage SQL and route/concurrency campaigns remain separate evidence.

Source 6afabe2c passed full QA, shuffled seed 350666, connector 382/4 skipped,
audit zero and webpack build. Full isolated RLS passed 442 cases in 48 files.
A browser on that exact build committed an original save, discarded the response,
and recovered the same revision with created:false. Editing then exposed unstable
accessible names on implicit textarea/select labels. Source 92b927fc fixes them
with explicit labels; detached-label mutations fail. No source changes are pending.

## Settings landed; inspect main CI

Both corrected browser journeys passed on identified source 908b576c at desktop
1440x1000 and 390x1000. Viewport captures were inspected. Original/corrected/revoked
history, exact post-commit response-loss retry, failed refresh, private credential
denial and keyboard navigation passed. See the retained browser JSON and PNGs.
Only two deliberate abort errors occurred per journey, with no page errors and
zero model requests. Our acceptance server is now stopped; no browser collection
is active in this checkout.

Corrected full QA exec 67000 and shuffled exec 85865 both completed exit 0:
13,944 passed, 413 skipped; QA includes 382 connector passes/four skipped, zero
audit vulnerabilities and successful webpack build. Full RLS exec 95861 completed
exit 0: 442 tests in 48 files. The final label-only correction does not change SQL.
Upgrade Path 34720213220 succeeded on 92b927fc from v0.54.0.
All old handles listed in earlier notes are terminal; do not poll or restart them.

The evidence checkpoint was pushed directly to main successfully. Current final
main runs for 100216a3: CI 34720524596, RLS Isolation 34720524628 and Upgrade Path
34720524696. They were confirmed queued/running, not yet complete, at checkpoint.
Poll these exact GitHub runs; do not mistake the earlier branch upgrade pass for
a completed main run. This resume-note-only follow-up is saved on the work branch
so it does not restart the main checks. Preserve the root checkout and
its unrelated reminder change. No PR or tag is needed for this unfinished API
execution increment. After main checks, continue the API turn/worker join in
`EXECUTION_JOIN.md` and the existing scoped Planner Agent task, without duplicating
configuration UI or creating a second job-state owner.

Private evidence/environment/scripts remain under
`/home/nathaniel/.local/state/openplan/api-provider-research-2026-09-12`.
The browser driver uses the actual Work email label and explicit form labels.
The account file and environment contain synthetic account credentials/operator
secrets and must not be printed or committed. All API connections came from the UI.

The active disposable stack is API29821/DB29822, workdir
`/home/nathaniel/.local/state/openplan/openplan-restore-target-2026091050`, container
`supabase_db_openplan-restore-target-2026091050`. Its 317 migrations include the
new API storage migration. No reset is needed. The private environment explicitly
targets this stack; checkout `.env.local` still targets an old stack on 22301.
Do not print keys or touch the demo. Do not edit/rebuild during browser collection.

After browser acceptance, update this note/evidence, push directly to main and
inspect CI, RLS and Upgrade Path. Do not tag this partial provider workflow.
Then join retained API turns and the local worker as described in
`EXECUTION_JOIN.md` here and `../2026-09-10-opencode-native-spike/API_PROVIDER_NEXT.md`.
Settings explicitly disclose that they are not yet selectable for generation.
No human engineering review gate or paid provider service is needed. Keep the
pending reminder constraint untouched and continue the complete v1 roadmap.
