# PR332 QA corrections await source review and finite checks

October 17, 2026. SOURCE/PREPARATION ONLY. No subject import, evaluation,
compilation, dependency operation, test, direction check, lock acquisition,
manager, native operation, browser, SQL, application HTTP or tool dispatch runs.
No source commit, push, PR, CI retry, integration or release runs. There are no
nested agents. Proposed checks below are not authorization or results.

## The assigned source matches the failed CI input

T3 reports the attached checkout as
`/home/nathaniel/.t3/worktrees/openplan/t3-324a866d`, branch
`t3/pr332-qa-gate-source-corrections`, with Sol `gpt-6.1-sol` and
`reasoningEffort=high`. The initial worktree is clean at
`05dd3e8da4a4572437f06e771b0a2477873e681f`. A successful ancestry query precedes
the authorized local ff-only advance to
`3d6255870f9f17131f38e661fd5c11a29ee846e2`. Its application tree is
`fa58f935d012d01da7738cc3a3351c51d2804bab`. The worktree remains clean after that
advance and before these edits. No other checkout advances or receives writes.

ROOT's retained actual job is run `39020928442`, job `117362402536`.
The raw log has 2,019,431 bytes and SHA-256
`c19d87cb137dae3ce4cd818277bb8b48a3c722c57601146d3479566b3574b480`.
Its failure sections and ROOT's corrected classification name exactly:

- `src/test/data-hub-page.test.tsx`;
- `src/test/gtfs-feed-detail-route.test.ts`;
- `src/test/gtfs-feeds-route.test.ts`;
- `src/test/gtfs-staged-upload-routes.test.ts`;
- `src/test/the-refresh-route-refuses-a-widened-agent-request.test.ts`.

These five suites fail while importing `tested-cli-versions.mjs:74` through
`codex-launch.mjs:5`, with `ERR_INVALID_URL_SCHEME`. The two assertion failures
are the pending-schema scanner's new-file assertion and the Unreleased migration
coverage assertion. Actual totals remain 1,676 passed files, seven failed files,
106 skipped files, 23,434 passed tests, two failed tests and 1,662 skipped tests.
`agent-project-run-routes` is not an observed failed suite. ROOT's earlier ANSI
decoder derivative and original terminal1 remain failed evidence, without
regrading or a retry.

## The registry draft preserves the strict original input

The production delta adds `node:module`'s `createRequire` and resolves the exact
adjacent JSON filename through `createRequire(import.meta.url).resolve(...)`.
`readFileSync` still returns original UTF-8 bytes to the unchanged parser.
There is no JSON import/stringification, embedded replacement, cwd lookup,
environment path, fallback, new provider or widened version acceptance.

The manifest and its SHA-256 pin remain unchanged:
`0a32b6136c2bdef170223f43e6806aa2bc002a6d33b641cf37612ddee2931d3b`.
The full schema, recorded date, evidence paths/hashes, strict output formats,
deep freeze, unknown timestamps and native-frame semantics remain intact.
The three launchers and all existing Node tests remain unchanged.

Source loading investigation distinguishes observation from inference. CI's
actual exception establishes that the value reaching Node's filesystem reader
has a non-file scheme. The locked application uses Vite `7.3.6`, Vitest `4.1.11`
and default `jsdom`; CI selects Node 24. The failing expression is the static
`new URL(relativeAsset, import.meta.url)` form that Vite can treat as an asset.
The proposed Node resolution removes that asset-expression seam while preserving
module-relative filesystem loading.

The exact version-tagged upstream source resolves the mechanism. Vitest's
[jsdom environment](https://github.com/vitest-dev/vitest/blob/v4.1.11/packages/vitest/src/integrations/env/jsdom.ts#L40)
selects Vite's client environment and an HTTP location by default. Vite's
[asset transform](https://github.com/vitejs/vite/blob/v7.3.6/packages/vite/src/node/plugins/assetImportMetaUrl.ts#L44)
matches the static expression and substitutes its served asset path. Vitest's
[post-transform normalizer](https://github.com/vitest-dev/vitest/blob/v4.1.11/packages/vitest/src/node/plugins/normalizeURL.ts#L9)
then replaces the expression's import-meta base with `self.location` in that
client environment. The resulting URL uses HTTP, which Node's filesystem reader
refuses. This is source-derived causal analysis consistent with the actual stack,
not execution of the transform or a captured transformed CI payload.

The replacement does not match either static asset-expression transform. Vite's
[default import metadata](https://github.com/vitejs/vite/blob/v7.3.6/packages/vite/src/module-runner/createImportMeta.ts#L15)
supplies a file URL outside that rewritten expression. `createRequire` therefore
anchors its relative resolution at the module rather than at the jsdom location.
No alternate registry is admitted. Exact tagged sources were read as text only;
their URLs and line boundaries are retained in `UPSTREAM_SOURCE_INPUTS.json`.
This checkout still has no dependencies. Different cached npx versions read
earlier remain orientation only. Installed-byte correspondence and genuine
Node24/Vitest compatibility still require the finite comparison. No upstream
package is downloaded, installed, imported or evaluated here.

Two new source test files prepare complementary checks. The Node file copies
the real loader and manifest into a private directory containing spaces, `#`
and a non-ASCII character. It runs three bounded Node-only child imports from
an unrelated cwd: exact adjacent bytes succeed; a whitespace-only manifest
change refuses; a missing adjacent file refuses despite a valid ambient copy.
Its `finally` removes only its newly created scratch directory.

The Vitest file uses the application's actual jsdom/Vite loader and unmocked
registry plus all three launcher modules. It does not call a launcher. A caught
import failure reaches a named assertion, rather than failing suite collection.
Assertions retain exact manifest equality, versions, frozen records, unknown
fields, refusal of new output and byte-level pinning. The existing Node parser,
proof-reference and launcher-wiring purposes remain separate and unchanged.

## Budget classification retains source and code boundaries

`budget-queries.ts` imports the centralized `looksLikePendingSchema`. The
existing named-source relation helper first asks that classifier, then retains
its existing exact relation and supplied-SQLSTATE refinement. The deliverables
branch reuses that helper and still requires an explicit `42P01`.

The removed literal regex and reused helper have the same deliverables relation
pattern, including the original terminal-newline behavior. Deliverables without
a supplied code remain unreadable. The other sources retain their established
legacy no-code compatibility. Unknown/conflicting codes, other schemas, helper
relations, internal missing columns and generic cache failures remain unreadable
with original code/message custody. `readPendingSchemaMissingColumn` still owns
the existing qualified stated-budget column refinement. Missing snapshot RPC
recognition remains unchanged; a missing function is a separate contract from
the shared table/column classifier.

Twelve new source cases extend only
`project-budget-source-error-classification.test.ts`. They protect the narrow
deliverables boundary and preserve readable nonzero amounts in other lanes.
All prior tests remain intact. The scanner's implementation, allowlists and
thresholds remain unchanged. Money parsing/arithmetic, SQL19, snapshots,
completeness, fallback policy, statement scope and read failure outputs do not
change. The prior exact-money and complete-input design records remain source
inputs, not refreshed acceptance.

## Operators can see both missing migration names

The Unreleased note names exactly
`20261017000019_project_budget_complete_inputs.sql` and
`20261017030608_land_use_plan_publication_transaction.sql`.
It describes their source intent and requires accepted migration/recovery checks
and migration-before-dependent-app deployment. It claims no application, native,
hosted or release outcome. No migration body, name, ordinal, history, release
record or ordering test changes.

## Exact source delta and custody

Ownership is limited to these six source files and this NEW review directory:

- `workers/planner_agent_connector/tested-cli-versions.mjs`;
- NEW `workers/planner_agent_connector/test/registry-loading.test.mjs`;
- NEW `openplan/src/test/tested-cli-registry-vite-compatibility.test.ts`;
- `openplan/src/lib/projects/budget-queries.ts`;
- `openplan/src/test/project-budget-source-error-classification.test.ts`;
- `CHANGELOG.md`.

The matching NEW private root is
`/home/nathaniel/.local/state/openplan/pr332-qa-integration-correction-20261017`.
Its `SOURCE_DELTA.final.patch` includes new test source; `SOURCE_MANIFEST.final.json` records
base and candidate bytes without executing them. `SOURCE_INPUTS.json` pins the
relevant source/config/design and retained CI data. These are preparation
records, not execution receipts. There is no prepared runner or check grant.

The first metadata-capture preparation stops on a mistyped source-input path,
`openplan/src/lib/ui/optional-amount.ts`. The actual file is under `lib/money`.
That preparation's patch/manifest and error remain retained separately. The
corrected capture changes the input path only; no subject command runs in either
preparation. This metadata failure is not a test or source-runtime result.

ROOT's combined checkout, other active worktrees, M1/viewport authors, all old
A0 targets/admissions/failures and sealed proof packets remain outside ownership.
Nothing here rebinds `f8`/`d577`, connector228/421, or any native controller.
Full V1, science, installation, native finance/SQL/RLS/Auth/provider, browser,
artifact and release holds remain. SOURCE review cannot establish that a QA
failure is fixed. All new tests, mutants and compatibility claims remain unrun.
