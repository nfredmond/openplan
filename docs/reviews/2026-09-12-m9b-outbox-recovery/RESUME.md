# Usage-reset checkpoint, September 12, 2026 Pacific

This supersedes pending release and job status in the earlier response-snapshot
resume note and this review's implementation note. The full v1 goal remains active.
The user expects direct main after verification, no PRs, no human release gate,
free local operation, and the complete current V1 contract. Leave the pending
reminder constraint untouched. Do not recreate the old v0.47/v0.48 work.

## Saved work

Live GitHub readback confirmed v0.56.0 published at 2026-09-13T05:29:22Z, not draft.
Remote main and the peeled release tag both point to
e006b98bd8aeedbde48a74bec2169e1f1d01c9ad. The preceding turn recorded successful
final CI 34739606630, RLS 34739606639 and populated Upgrade 34739606645 before
tagging. Their private receipts are in the directory below. Do not release again.

Active checkout:
/home/nathaniel/.local/state/openplan/engagement-write-recovery-2026-09-12
Branch: work/engagement-write-recovery. Application package: openplan/.
Source bce8c31a6bb16f58b41b5845989be6a0a94a7133 was clean and matched the remote
branch at this checkpoint. It includes outbox fix bae56101 and the final main
merge. This note is a subsequent documentation checkpoint, not release evidence.
The root checkout and demo are older separate copies; do not switch or alter them.

The outbox fix refuses transport when persistence fails, reports unsaved broadcast
emails accurately, and preserves public confirmation retry controls. Read
IMPLEMENTATION.md, checks.json, mutations.json and mutations.py here. Prior
results: 115 focused tests in nine files, TypeScript and changed-file lint passed;
one harmless mutation survived and ten targeted failures were detected. These
were not rerun during checkpointing. Full QA and browser acceptance remain pending.
No schema, RLS policy, geography or reminder change is included.

## Exact stopping point

Private evidence and runners:
/home/nathaniel/.local/state/openplan/api-provider-research-2026-09-12

The current runner m9b-outbox-browser.cjs stopped at the missing link named
"Open portal" after successful UI campaign creation and three PATCH 200 replies.
Inspect m9b-outbox-1440-failure.png and its JSON, then the ready-state early return
in campaign-publish-flow.tsx around lines 188-246. The screenshot was not yet
visually inspected. Determine whether the runner expects the wrong label or the
UI has a real defect. Earlier duplicate "Generate link" selection was a runner
defect corrected by scoping controls to their publish-step containers.
Latest synthetic campaign: e8e4e951-950a-47aa-b7a2-f8ae2c929543.

Continue real staff navigation and anonymous public opt-in at 1440px and 390px.
Inject an outbox write refusal, verify the pending subscription survives without
an outbox row, retry by keyboard, and confirm through the retained local message.
Then publish a staff response under a scoped outbox refusal and verify the warning,
saved response/history, and exact counts. No actual external email is authorized
by this test; the runner's child explicitly disables the mail transport. Inspect
screenshots and console. Do not call these unfinished journeys accepted.

Owned proxy/dev were still running at checkpoint: proxy PID 3684731, Next child
3684806, tool session 90213. App 3256, proxy 3219, database API 29821. Recheck
process ownership and health; process survival across a reset is not assumed.
No browser collector or QA suite was running. The proxy's failure control is
disabled by the runner's finally block. Start instructions are in the private
m9b-outbox-proxy-dev.cjs; its parent loads api-settings.env without printing it.
Never print or commit credentials, raw account files, or confirmation tokens.
Identify this build using scripts/ops/which-openplan.sh from the app package.
Stop owned dev before a production build because both use this checkout's .next.

The isolated stack is openplan-restore-target-2026091050, API 29821 / DB 29822,
with 321 migrations through 20261014000002. Do not reset or reapply migrations.
Preserve original 1,005-response fixture a3c41566-bfd4-40f2-b467-96ee79054ec6.
Other stacks, sessions and the demo are not test targets.

## After browser acceptance

Run applicable full QA, shuffled tests and isolated checks. Preserve the initial
failed runners and honest limits. Prepare the appropriate next version, land
verified changes directly on main, inspect final CI before tagging, and continue
the roadmap. Complete M9b still requires reasoned and conflict-safe writes,
durable request replay, source withdrawals, translation custody, subscriber-read
completeness and delivery-result recovery. This small fix is not all of M9b.
Run product:direction:check and reread current authorities before selecting the
next substantial lane. The full v1 contract and separate scientific validation
obligations remain unchanged.

## Superseding browser checkpoint, September 12 Pacific

Both desktop and 390px browser journeys passed on b158f28f with unchanged runtime
source. See VERIFICATION.md and browser/. The missing portal link was in Setup
after activation switched the default tab to Responses. Signup correctly hides
when email is disabled, so the final local browser used a process fetch stub with
a dummy key and synthetic-only recipients. Both failures caused zero transport
attempts, and successful keyboard retry caused exactly one stub call. No external
email was sent. Final screenshots were inspected and console records were empty.

Owned proxy 3890893/dev 3890901 were stopped after acceptance. Session 84719 was
their handle; confirm terminal state on resume. No browser collector remains.
Package/release metadata now prepare v0.56.1, without new migrations. Full QA,
shuffled tests and isolated RLS are next; the candidate is not on main or released.
The previous publication-pending wording has been superseded and v0.56.0 final
CI/publication is retained in the response-history review.

## Full-check correction checkpoint

6fbbd72b's full QA and shuffled tests ended with the same seven failures. They
are corrected as described in VERIFICATION.md; 66 focused checks and the added
mutation proof passed. Full QA and shuffle require a new run after this checkpoint.
Live RLS session 99564, PID 3983051, remained running on source 6fbbd72b; it has
not been restarted. Its schema and live test source are unchanged by the follow-up
unit-test corrections. Poll the same handle; do not infer termination from quiet
output. The private m9b-outbox-release-check.cjs records terminal receipts.
