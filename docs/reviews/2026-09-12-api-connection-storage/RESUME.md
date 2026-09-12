# Resume API connection implementation

Active v1 goal remains open. Latest release is v0.54.0, already published. Do not
repeat earlier releases. Full planning scope and separate model validation remain.

Checkout: `/home/nathaniel/.local/state/openplan/agent-hold-receipts-2026-09-10`.
Package: `openplan/`. Branch: `work/planner-agent-api-connections`.
Main foundation commit: `57a7b6aed1d0262ee847e1e80a6183b35728e142`; both CI34716932357
and RLS34716932401 are successful. The new storage code is not yet on main.
No other session was observed owning this checkout. No acceptance server is running
from it; do not touch the separate demo or old browser stacks.

Read `VERIFICATION.md` here and the previous
`../2026-09-12-api-provider-transport/RESUME.md` for transport context. The latter's
statement that no API tables/routes exist is superseded by this checkpoint.

Usage-reset checkpoint, September 12: source checkpoint `bbf0d4d0` is confirmed
pushed to `origin/work/planner-agent-api-connections`; the working tree was clean.
The test sessions have ended and their old handles are no longer available.
Read the retained logs instead of polling those handles:

- Full QA `api-storage-qa.log`: 13,923 passed, four failed, 413 skipped.
- Shuffled seed 912055 `api-storage-shuffled.log`: the same four failures,
  13,923 passed and 413 skipped.
- Full isolated RLS `api-storage-full-rls.log`: 442 passed across 48 files.

The four QA failures are described below. Inventory and changelog fixes are in
`bbf0d4d0`; those fixes have not yet received a fresh full run. The missing real
UI caller remains unfinished. No test process was observed running at checkpoint.
Resume at the configuration UI, then run the final gates. Do not declare this
storage increment released or fully green.

All logs are under `/home/nathaniel/.local/state/openplan/api-provider-research-2026-09-12`.
Mutation runs are finished and restored; concurrency controls and failures are in
this review folder. The named disposable restore DB has 317 migrations. There is
no need to reset it. No changed worker code or UI has been added yet.

The first full shuffled run failed four checks: the new route has no product
caller, the policy/schema inventory counts were not updated, and the changelog
omitted the new migration. Inventory counts are now reconciled with the live
catalog, and the changelog names the migration. DO NOT exempt the orphan route
or add a dummy caller. Its remaining failure requires the planned real UI join
before this storage increment can land on main. The checkpoint's prior idea of
landing routes before UI is superseded by this observed guard failure.

Immediate next implementation: add configuration controls through the existing
`/workspace` page's `workspace-integrations` area. Existing component:
`openplan/src/components/workspaces/workspace-integration-keys-panel.tsx`;
parent `openplan/src/app/(app)/workspace/page.tsx`. Keep that working integration
panel intact; add the API connection controls alongside it. Owner/admin can save
and revise exact endpoints/model IDs/key mode, inspect history and revoke. Members
can read permitted destination metadata. Preserve ephemeral key inputs, one stable
revision ID for a failed-save retry, truthful network/save outcomes and pagination.
Saving configuration must not contact a model. Do not claim generation is wired.

The openplan-browser and look skills were read on this turn. Use the existing
Playwright harness with installed Chrome. Before browser evidence, start an
identified isolated build and use `which-openplan.sh`. This checkout's `.env.local`
still points at the old browser stack on 22301; the active disposable QA/API stack
is 29821/29822. Prepare a private environment file from that stack's status without
printing keys. Use actual account/workspace creation and UI producers; do not
hand-seed API connections. Never build/edit a served acceptance checkout while
collecting evidence. No UI code or browser server has been started for this increment.

After reachable settings and their relevant browser tests, repeat final full QA,
shuffled and isolated RLS on unchanged source. Land directly on main without a PR;
inspect CI/RLS/Upgrade Path. No tag for the partial provider workflow.

Then finish A0b API execution in existing `assistant_provider_turns`: immutable
revision reference and request hash/charge acknowledgement, one queued attempt,
operator-run Node worker for up-to-900-second calls, no browser-triggered duplicate
generation, exact retained completion retry, cancellation/revocation and late-result
refusal. Extend shared result/proposal validation, not a second job-state owner.
Settle edit semantics explicitly: interrupt superseded active work or retain its
old authorization, never move an old attempt to a new endpoint/key. Preserve
membership/project/connection/turn lock order and exercise concurrency.

Connect owner/admin configuration and ordinary member selection to the existing
Planner Agent/provider UI. Run the browser skills, identify the served build, and
exercise real navigation at desktop and 390px, keyboard, console, retry, provider
switching, retained history and exact submittal approval. Free local fixture
providers are authorized. No live provider spend or human engineering review gate.
Keep the pending reminder constraint untouched and continue the full v1 roadmap.
