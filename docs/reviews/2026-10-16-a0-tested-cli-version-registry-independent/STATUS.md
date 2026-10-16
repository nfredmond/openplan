# Independent source review of the tested CLI version registry

## No P1 or P2 finding in the bounded candidate

I find no concrete P1 or P2 defect in implementation
`435df897e7f06259c1ebc494f540f73b611003b1`, whose sole parent is
`607ee0895a79457181eda1d2ebbda1de4f2a4d40`. No implementation correction is
required by this source review. This conclusion covers the exact-version
registry refactor. It does not close T1, establish current native acceptance,
or authorize integration, hosted operation or release.

## Checkout and review custody

The assigned T3 checkout is
`/home/nathaniel/.t3/worktrees/openplan/t3-e4f55188`, branch
`t3/review-cli-version-registry`. Its initial clean HEAD was
`05dd3e8da4a4572437f06e771b0a2477873e681f`. A local `git merge --ff-only`
advanced it to the candidate without conflicts. The implementation checkout is
separate, at `t3-e04f0f77`, branch `t3/a0-tested-cli-version-registry`.

The T3 session inventory identifies this review as a child of
`1401bb6a-70e4-42eb-a1f1-98045485f8cc`. The root and the separate preview and
pending-schema harness children were active. I changed no other checkout and
created no nested delegation. I own only this new review directory.

I read the checkout's AGENTS.md, planner-writing and prove-it skills, the full
nine-file candidate diff, complete candidate STATUS/controls/driver/tests,
all three launchers, the referenced historical reports and fixture sources,
existing launcher tests, and the relevant A0b/T1 and packaging source.

I ran no tests, compiler, build, dependency operation, provider CLI, model or
account call, browser, database, Docker or network operation. I read no
credentials, environment values or incident records. The explicit source-only
brief also excludes the usual product-direction command. Local Git reads and
read-only Python byte hashing establish source identity; they do not execute
the candidate. [Source integrity](source-integrity.json) records the inspected
bytes and reference comparisons.

## Correctness, compatibility and security

The exported version values remain Codex `0.154.0`, Claude Code `2.1.263` and
OpenCode `1.18.30`. Each real launcher calls `assertTestedCliVersion` with its
own provider and discovered stdout before resolving or reading the provider
profile. The check preserves exact trimmed-output comparison and the existing
`native_version_unsupported` error. Discovery still uses the same executable,
timeout, output bound and restricted environment. Codex's resolved `bin`
directory requirement remains immediately after version acceptance.

The remaining launch source is unchanged. The diff adds no credential access,
mount, native protocol, tool permission, model selection, account mode,
automatic update, retry or provider fallback. Existing auth and isolation
restrictions retain their source paths. Their physical behavior is outside
this review's evidence tier.

The parser bounds supplied input, validates the three distinct providers and
record shapes, freezes records recursively and binds exact manifest bytes.
That pin rejects copied version proof, crossed references and duplicate JSON
properties even when JSON parsing would otherwise overwrite a property. The
current date, proof tiers and null observation timestamps are intentionally
fixed. Expansion requires reviewed code and manifest changes. This is a dated
snapshot, not a generic mechanism that can accept future proof labels.

The pin does not defend against a local editor changing both code and evidence.
It does not authenticate historical prose. Runtime validates the manifest,
while repository tests compare the referenced source/report bytes. Runtime
does not open those historical references or fetch evidence. The candidate
states these limits explicitly.

## Evidence references retain their original claim tiers

All six distinct referenced files exist, match their manifest SHA256 values,
and are byte-identical to the parent commit. All six source hashes in the
control receipt match the candidate. These comparisons can detect missing,
changed or mismatched files; they cannot establish that a historical run occurred.

The Codex report describes installed-binary/local-fixture checks and a separate
ChatGPT-account project journey. The Claude report explicitly uses synthetic
OAuth and a scripted local Messages server, excluding live Claude generation.
The OpenCode report uses its installed executable with synthetic credentials
and scripted local Responses data, excluding real provider requests. Those
claims agree with the registry's historical/unknown distinctions.

The Codex and Claude fixture sources construct synthetic provider events.
OpenCode's referenced fixture checks filesystem visibility through the launch
descriptor and bubblewrap; it runs a Node probe inside that namespace rather
than replaying a native generation trace. The candidate STATUS explicitly
explains this difference. None of these sources establishes provenance from
recorded native frames. `recordedNativeFrames: "unknown"` is appropriate.
Missing recordings do not justify disabling the three legacy accepted versions.

## Controls are meaningful within their declared boundaries

The receipt records eight focused registry tests, 73 combined launcher cases
with zero skips, five harmless survivors, 39 targeted failures and three
earlier failed campaigns. I inspected those claims and their source bindings;
I did not independently observe or rerun the executions or inspect private logs.
The earlier campaign summaries preserve the size, version/output and live-proof
overlap problems. The current tests contain the stated stronger inputs.

The complete driver checks unique mutation anchors, process errors, exit status,
the intended failing test name and assertion failure text. Harmless comment
mutations must report all eight tests passing. Each control restores original
bytes in `finally` and compares hashes. A restored final run follows. These
checks reject the described false kills from a timeout or import-only failure.
Ordinary exception restoration does not establish recovery from forced process
termination or machine failure.

Several parser mutations remain refused by the manifest pin and fail because
the diagnostic error changes. They demonstrate diagnostic sensitivity, not 39
independent acceptance bypasses. The candidate's final claim includes diagnostics
and does not need a broader interpretation. The separate pin-removal, exact
version-refusal and evidence-hash controls address their respective boundaries.

Launcher tests combine real parser/refusal checks, synthetic executable stdout
stubs, a child that mocks only the registry seam, and real launch construction.
The mock detects retained hardcoded checks, missing calls and incorrect provider
wiring. An absent profile distinguishes pre-profile refusal. It does not prove
real CLI compatibility or actual filesystem isolation. Existing launcher tests
cover descriptor details, but unchanged tests are not new native evidence.

## Packaging has a source path; runtime acceptance remains separate

Both new runtime files sit beside the launchers and use module-relative URLs.
The documented local connector runs from the repository. The hosted-node
Dockerfile copies the entire connector directory, and the root .dockerignore
does not exclude either new file. Historical reports are not runtime imports,
so that copy does not need the docs tree for registry loading.

The application also reaches the connector through existing static imports.
Its Next configuration traces from the repository root. I found no explicit
packaging list that drops the new files. I did not build or inspect a bundled
deployment, so this review does not establish webpack asset emission, deployment
tracing or packaged runtime startup.

## T1 remains partial

Root integration still needs the T1 work defined in
[MILESTONES.md](../../product/MILESTONES.md): consented recorded native frames
with synthetic content replayed through the real adapter; separately identified
installed-CLI acceptance for each accepted version; usage-limited state with
provider-reported reset time or explicit unreported reset; no automatic retry;
installer-owned update guidance without probe-triggered updates; and identified
desktop/390px journeys. Current account availability, native behavior and browser
acceptance remain unproved here. These are remaining T1 boundaries, not defects
introduced by this exact-version preservation refactor.
