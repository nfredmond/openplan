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

Full campaigns started on final storage source, and must be polled by their exact
live handles before restarting anything:

- QA exec session 27903, `api-storage-qa.log`.
- Shuffled seed 912055 exec session 21941, `api-storage-shuffled.log`.
- Full isolated RLS exec session 48326, `api-storage-full-rls.log`.

All logs are under `/home/nathaniel/.local/state/openplan/api-provider-research-2026-09-12`.
Mutation runs are finished and restored; concurrency controls and failures are in
this review folder. The named disposable restore DB has 317 migrations. There is
no need to reset it. No changed worker code or UI has been added yet.

After these gates, land the verified internal increment directly on main without
a PR. Inspect the new CI/RLS/Upgrade Path runs; the migration push triggers the
populated v0.54 upgrade automatically. Do not tag a release for storage alone.

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
