# v0.54.0: installed OpenCode for the retained project task

The project Planner Agent can use installed OpenCode 1.18.30 on Linux for the same
stored-project question and draft-submittal task already offered through Codex and
Claude Code. A version-two connection binds OpenCode to its native OpenAI API
credential mode. Each API request requires explicit charge acknowledgement. The
frozen project packet, selected model, answer, delivery retry and proposed action
remain bound to that request. A proposal reaches the existing explicit approval
flow before any project record is created.

This is partial A0/A1 progress. OpenCode OAuth/subscription modes, other OpenCode
providers, extensible API endpoints, broader grounded tasks, durable assignments
and external MCP remain unfinished. The full v1 contract is unchanged.

## Native boundary and limits

The tested native release is [OpenCode 1.18.30](https://github.com/anomalyco/opencode/releases/tag/v1.18.30),
source 3104c1428ec91f809e5ab86631300de41eb6952e. The Linux archive matched SHA256
55007246858165496ff85ba1c2b648f7421e8e2013bf4189a680c9ff8e699d17. Its MIT license
was inspected. No binary is installed automatically by OpenPlan.

Only the exact openai API record in a private, regular, current-user-owned
native auth.json is accepted. An attempt reads a bounded credential snapshot and
mounts it read-only. Other profile configuration, histories, plugins, MCP and host
project files are absent from the native filesystem. The native server uses a
random local port and password. A private loopback relay permits one bounded
request to the fixed OpenAI Responses endpoint. Native agent step counts are
advisory, so the separate relay enforces the actual request limit. Native
cancellation and process exit finish before scratch cleanup.

The native offline catalog is not account-access evidence. Native auth-list
labels proved ambiguous for differently cased provider IDs, so the adapter does
not infer identity from those labels. General native message-list reads have an
upstream schema failure in this version. Exact assistant-message reads work; the
adapter validates the selected model, session, parent, every part, one completed
StructuredOutput call and identical readback. OpenPlan retains its own validated
answer. No general native-history integration is claimed.

All OpenCode generation evidence uses the actual installed executable with
synthetic API credentials and local scripted Responses data. No real provider
request, provider charge or existing personal OpenCode profile was used. These
checks establish transport and workflow behavior, not live model availability,
account entitlement, billing or professional usefulness. They do not establish a
hostile-local-owner, separate-UID or managed-environment security boundary.

## Browser and saved-work evidence

[Browser receipt](browser-final.json) identifies source
1b5ba8bee0b2 and its full commit. The production server on 127.0.0.1:3219 was checked
with which-openplan.sh and matched this isolated checkout. Chrome journeys at
1440px and 390px entered through sign-in, Dashboard, Projects and Planner Agent.
They used keyboard activation and actual connection downloads/configuration.
Each journey recovered an interrupted browser POST using the identical request,
retained a native answer, resent a lost delivery with zero additional generations,
reloaded unchanged history, explicitly approved a draft, cancelled a held native
request and revoked another. Both prior Codex and Claude answers stayed unchanged.

Separate project-retention journeys refused deletion with zero DELETE requests,
handled an injected preflight 503 without opening deletion approval, and retained
the OpenCode answer. The 390px layout check survived a harmless attribute and
rejected deliberate missing wrapping before restoration. Connection, answer,
approval, cancellation, revocation and retention screenshots were inspected.
Only the deliberately interrupted POST and preflight 503 appeared in the respective
browser consoles; no unexpected browser errors occurred. Private setup files,
raw histories and captures stay in the dated local evidence directory. The owned
server was stopped before release metadata edits; other servers were untouched.

[Local upgrade receipt](upgrade-local.json) covers the populated 315-to-316
migration: every one of 16 existing connection-row hashes and 25 saved-turn-row
hashes remained identical. Apply
`20261011000002_assistant_opencode_connections.sql` before the app. It extends
provider/account constraints and request creation checks while preserving the
composite connection identity and existing rows. No data reset or deletion was
used. The pending reminder-constraint change remains untouched.

## Engineering checks and limitations

[Candidate QA](candidate-qa.json) records full QA and shuffled tests, seed 811348:
13,800 passed and 401 skipped in each app run. QA includes a successful production
build, zero dependency vulnerabilities and 374 default connector passes with four
native opt-in skips. The separate live RLS run passed 430 tests in 46 files on the
named disposable QA stack. All 52 Python worker suites passed. The actual-native
filesystem test separately passed without skips.

[App registration checks](app-registration-checks.json) distinguish 64 live
Codex/Claude/OpenCode parity checks from eight existing Codex/Anthropic transaction
competition checks. 136 focused app checks, TypeScript and changed-file lint passed.
Adjacent receipts preserve harmless survivors and targeted failures for native
launch, credential custody, relay budgets, process ownership, result validation,
connector dispatch, app bindings and SQL constraints. Registration alone added
22 targeted worker failures, 28 app failures and 10 transaction-scoped SQL failures.
Mocks prove their own boundaries; they do not replace native, live RLS or browser
evidence. Skipped tests are not passing evidence.

Errors were retained and corrected. The first full QA run found an omitted
migration reference in Unreleased; the guard was unchanged and full QA passed
after the changelog fix. A SQL mutation harness initially missed a copied
function's terminator; its expected-error check rejected that syntax failure.
The first desktop harness waited only 10 seconds for native startup under
concurrent test load. The fixture reached the model afterward. A bounded 90-second
observation allowance replaced that wait, with terminal-fixture detection;
production limits were unchanged. Final cancellation/revocation startup waits
were about four seconds. Earlier inadequate account, credential, result and
process fixtures remain documented in the chronological checkpoint.

## Publication

Engineering release candidate. Final release-commit CI, shuffled tests, live RLS
and the populated v0.53.0 upgrade must be inspected before tagging. A push or this
document does not establish publication. No human review or paid deployment is a
release prerequisite. Scientific accuracy and agency authority claims are unchanged.
