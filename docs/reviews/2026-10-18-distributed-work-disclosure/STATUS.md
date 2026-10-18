# Recorded work-loading study disclosures

Date: October 18, 2026
Source base: `dfe86e70af12015613626aaf036d40408f506d12`
Owned branch: `t3/distributed-work-study-registry-disclosure`

The existing card now shows recorded caps, aggregation and demand policies,
acceptance-holdout custody, legacy development-input context, and the source role.
LODES endpoint weights distribute existing modeled work demand. They are not
observed vehicle or all-purpose trip counts. Geography and method counts still
come from the displayed records. Inconclusive outcomes, retired candidates,
unchanged defaults and separate methods remain visible.

The loader opens one additional fixed metadata file, the registry already bound
by the study manifest. It validates the allowed path, stored/logical lengths and
SHA-256, schema, study identity, geography names/IDs, methods, typed null caps,
required policies, custody and source fields. The read accepts at most 64 KiB,
with one overflow byte for refusal. It also checks each audit's holdout flag and
both artifact study identities. Existing numeric, summary and download checks
remain. Registry references to sources, predecessor files and legacy holdouts
are metadata only; this change does not open them. No frozen file changes.

Tracing includes the exact registry for `/models`, `/models/*` and distributed
study downloads. Current source has one card caller, `/models`.

Focused checks pass: 74 tests across the existing card, custody and study suites;
15 old download/inventory cases are deliberately deselected. The real study
loader verifies the registry at 10,184 bytes and SHA-256
`5eb3378b01e7212c61efbf503f822e275a403808f3d693850fab2a975d2c9b03`.
Scoped ESLint and TypeScript checks both exit zero. Each compiler/test process
uses the shared compiler lock without waiting, a 768 MiB Node heap, and, for
Vitest, one worker and a private cache. No install or build runs.

A harmless comment mutation survives. Eighteen focused code mutations fail their
named assertions: descriptor path/size, byte hash, schema, method/geography and
artifact identities, caps, policy/custody/source guards, audit holdout, derived
counts, false cap/acceptance/source claims, and tracing metadata. Removing the
policy/custody/source guard makes its refusal tests resolve instead of rejecting.
All changed source bytes are restored before the final passing run. Raw logs and
mutation receipts remain private outside the repository.

These checks establish source behavior and DOM text. They do not establish
browser layout, deployed file tracing, download operation after deployment,
independent scientific accuracy, or whether historical recorded custody matches
actual past access. Installation directories remain trusted. Independent review
and the parent's identified-build browser check remain pending. KI-2026-09-06-085
is not declared closed by this source checkpoint.
