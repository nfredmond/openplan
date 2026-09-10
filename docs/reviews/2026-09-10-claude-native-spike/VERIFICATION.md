# v0.53.0: installed Claude Code for the scoped project task

The existing project Planner Agent can retain a question, answer and proposed
submittal through installed Claude Code 2.1.263 on Linux. Provider/account bindings,
private history, exact delivery retries and explicit draft approval use the same
workflow as the released Codex task. Version 1 Codex connection files remain valid.
This is partial A0/A1 progress. OpenCode, extensible API endpoints, broader grounded
context/tools, durable assignments and external MCP remain unfinished.

Apply additive migration `20261011000001_assistant_claude_connections.sql` before
the app; this release contains 315 migrations. It extends provider/account checks,
binds retained turns to their connection identity and adds a versioned issuance RPC.
Existing connection and turn rows retained identical aggregate checksums in both
named disposable QA and browser databases when the migration was applied. No reset,
record deletion, paid infrastructure or automatic native installation was used.

## Browser and native evidence

[Final browser receipt](browser-final.json) identifies source
`2d43ab89995fea373d91da6789736c16f5e34f5f`, served locally on 127.0.0.1:3219 with its
actual build stamp. Production Chrome journeys at 1440px and 390px entered through
sign-in, Dashboard, Projects and the project Planner Agent, including keyboard
activation. Each downloaded/configured the actual private connection file, recovered
an interrupted POST using the identical request, retained the native structured
answer, retried a lost delivery with no second generation, reloaded unchanged work,
approved and created a draft, cancelled a held request and revoked another. Original
Codex answers remained unchanged. The only console error was the injected aborted
POST; no page errors occurred. Separate retention journeys refused deletion, issued
zero DELETE requests, survived an injected preflight 503 and preserved native history.
Owned fixture connections were revoked after collection; unrelated connections and
histories were retained. The owned server was stopped before release metadata edits.

Claude generation used the **actual installed CLI with synthetic OAuth and a local
scripted Messages server**. No live Claude generation or paid API request occurred.
Existing-account native auth status alone was inspected without preserving personal
account fields. These checks establish transport, scope, persistence and UI behavior;
they do not establish live model quality, availability, allowance or extra-usage
settings. Users must disable paid extra usage in Claude to prevent extra charges;
OpenPlan cannot inspect that setting. The adapter refuses unsupported native versions,
managed-policy environments and mismatched provider/account/model results. It exposes
no invented model catalog and never switches provider or billing mode silently.

Two real browser defects were fixed: Claude rejected Draft 2020-12 before generation,
so its claim now uses Draft 7 while Codex retains its supported schema; mobile revoke
labels overflowed and outline-button hover contrast was poor. Full native project
schema coverage now matches the claim route. [Control measurements](control-layout-fixed.json)
show the 120-character label fits its 305px row and settled hover contrast is 14.6:1.
Screenshots were inspected locally. Raw private setup files and full retained histories
remain outside the repository in the dated local evidence directory.

## Engineering checks and challenges

On pre-browser source `6e3ed6e9`, full QA and shuffled tests (seed 9100531) each passed
13,767 tests with 371 skips. QA also built successfully, audited zero dependency
vulnerabilities and passed 93 connector tests with three native opt-in skips. The
isolated live RLS suite passed 400 tests in 46 files. After the schema correction,
all 96 connector tests passed with both installed-native flags; 103 focused app
checks passed. After the scoped CSS correction, all 67 route/panel checks and the
production build passed, followed by the final browser journeys above. These local
full-suite counts precede the two demonstrated fixes. **Final release-commit CI,
shuffled tests, live RLS and populated upgrade results must be recorded separately
before tagging.** A branch push or this document does not declare publication.

Adjacent mutation receipts retain harmless survivors and targeted failures across
launch guards, provider dispatch, result parsing, route/UI bindings, SQL functions,
constraints, access grants and schema versions. The final browser layout/contrast
checks also survived a harmless attribute and failed deliberate overflow/pale-color
mutations before restoration. Database mutations were restored and focused live
checks passed afterward. Native fixtures prove the installed CLI refuses tools and
cannot read the masked host/project canaries; they do not replace database RLS proof.

Initial inadequate checks are retained, not hidden: safe-mode removal alone survived
because other restrictions still held; the first selection-reset check missed stale
React state until it switched away and back; contrast probes initially sampled before
transitions settled. The first release-ordering run caught the omitted new migration
in Unreleased, which was corrected without weakening the guard. See the
[checkpoint history](CHECKPOINT.md) for diagnoses and corrected evidence. Tests run as
the current UID do not establish a separate-UID or installed managed-policy case.
No scientific validation, agency authority, human usefulness or whole-product claim
is promoted by this release.
