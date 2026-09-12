# Resume API connection implementation

Active full v1 goal remains open. v0.54.0 is already published. Do not repeat
v0.48 or v0.54 release work. Preserve all planning and separate model obligations.

Implementation checkout:
`/home/nathaniel/.local/state/openplan/agent-hold-receipts-2026-09-10`
Package `openplan/`, branch `work/planner-agent-api-connections`.
Remote main is `57a7b6aed1d0262ee847e1e80a6183b35728e142`; CI 34716932357 and
RLS 34716932401 were confirmed green. Root checkout and demo are separate and
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

## Live work to resume, September 12 about 14:33 local

- Corrected full QA: exec 67000, `api-settings-labels-qa.log`, last observed running.
- Corrected shuffled seed 350666: exec 85865 completed exit 0, 13,944 passed,
  413 skipped. `api-settings-labels-shuffled.log`.
- Full RLS exec 95861 completed exit 0, 442 passed. `api-settings-rls.log`.
  The later label-only changes do not alter database or route behavior.
- Branch push exec 96881 completed exit 0 for 92b927fc.
- Upgrade Path dispatch from v0.54.0 was requested on this branch, exec 50580.
  Inspect its output/run ID and GitHub state before claiming it started or passed.

All private logs/scripts/environment files are under:
`/home/nathaniel/.local/state/openplan/api-provider-research-2026-09-12`.
Poll these exact handles or authoritative logs/processes. Do not restart because
an observation timed out. No browser acceptance server is currently running; our
previous port 3248 server was stopped before the label edits.

## Immediate next action

Finish QA/build, then start the corrected identified production build on 3248:
`node --env-file=<private root>/api-settings.env node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3248`.
Set OPENPLAN_COMMIT_SHA to the FULL current source SHA, not eight characters.
Run `bash scripts/ops/which-openplan.sh http://127.0.0.1:3248` from the package.
The short-SHA launch was correctly refused; the full-SHA launch matched.

Run `<private root>/api-settings-browser.cjs` with that environment, SOURCE_COMMIT
and WIDTH=1440 then WIDTH=390. It uses the repository Playwright dependency at
`/home/nathaniel/code/openplan/qa-harness/node_modules/playwright/test`, installed
Chrome, real sign-in and navigation. The synthetic auth producer created the
account/workspace; `api-settings-account.json` is private and must not be printed
or committed. Configuration records must come from UI producers.

The driver now uses the actual Work email label and exact explicit field names.
It aborts the save response after route.fetch committed, checks exact retry,
corrects the original, compares retained history, simulates failed refresh,
revokes, checks credential denial, screenshots and console. Earlier failed
selector runs are not completed browser evidence. Inspect new screenshots and
console at both widths; adapt navigation from the actual UI if necessary.
No model call should occur; the local fixture listener on 3217 counts them.

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
