# Planner Agent provider connection — implementation checkpoint

Base: published v0.51.0, 38f951eb. Own isolated checkout:
`/home/nathaniel/.local/state/openplan/agent-hold-receipts-2026-09-10`, branch
`work/planner-agent-provider-connection`. No browser server currently runs here.
Root main and other app servers are not being edited during this work.

The current direction check passes with an honest older-review reminder. A0a and
A1a's scoped read/proposal boundary follow the released effect/consent/recovery
repairs. This does not require finishing every action's durable transaction before
provider choice begins. The full v1 contract, separate model validation, A0b's
three native providers, assignments, capital, engagement, RTP and other gaps remain.
No human review is a development release gate; actual adoption remains a domain
fact. No paid infrastructure or model calls are needed for protocol fixtures.

Extend the existing Planner Agent. Start with selected-project grounding and
submittal proposals, using its existing action schema and exact browser approval
path. A native process receives selected evidence and a narrow revocable connection;
it never receives a browser session or database key. API and native reasoning use
the same task/output scope. Keep actual provider/model/auth mode visible, avoid
fallback billing, retain interrupted work, and refuse wider capabilities explicitly.

Research, September 10: installed `codex-cli 0.154.0`; its generated app-server
schema has explicit empty `environments` to disable environment access. App-server
supports streamed events and native account management, but its launcher lacks
`--ignore-user-config`. The installed `codex exec` has that flag (auth remains
native), `--ignore-rules`, ephemeral operation and JSON output. Relay Lab's existing
`src/cli-adapters.mjs` uses these flags and argument-array spawning. Reuse those
ideas; its unbounded output, permissive parsing and inherited environment do not
establish a confidential project boundary. Test both inherited configuration and
forced tool execution before selecting the transport. Read-only shell permission
alone does not restrict reads to the selected project.

Primary references retrieved today:
- [Official OpenAI App Server documentation](https://learn.chatgpt.com/docs/app-server)
- [Official Codex configuration reference](https://developers.openai.com/codex/config-reference)
- Installed CLI help and generated schema, retained in local evidence directory.
The documentation establishes interfaces, not OpenPlan runtime acceptance.

Next: controlled no-cost native-runtime protocol/capability tests; implement the
connection and retained-turn boundary, existing chat integration, desktop/390px
keyboard/recovery/access journeys, guard mutations and applicable full release
checks. No new provider or visible capability is implemented or verified yet.

## Native boundary and task-format checkpoint

Owned files: `workers/planner_agent_connector/`, the new
`openplan/src/lib/assistant/provider-project-task.ts` and its test, QA command
registration, and this evidence directory. At the initial native checkpoint no route or schema had changed. The database
checkpoint below now supersedes that state; no browser acceptance is claimed.

Two candidate configurations were rejected by controlled native execution:
`codex exec --ignore-user-config` still included home AGENTS instructions, and the
old `tools.view_image=false` setting did not remove that tool in installed0.154.0.
The generated current config schema has no `view_image` setting. An App Server
thread with empty environments removed file-reading tools, but an empty
`mcp_servers` override merged with inherited entries and launched the synthetic
MCP canary. These were real native-runtime findings using a local scripted model
endpoint, not successful isolation checks.

The implemented launcher instead gives the native process a restricted filesystem
view and masks every existing profile entry except its native auth file. Source
files are not rewritten. Both thread and turn disable environments, and the
bounded stdio reader requires correlated responses and a final completed turn.
The initial implementation supports the tested standalone Linux0.154.0 binary.
No silent fallback to a different provider, model, auth mode or unconfined process
is permitted. The local fixture endpoint is an internal test argument, not a
browser/connection request field.

Eleven process/protocol tests pass. Native runtime tests independently force six
forbidden tool calls and inspect actual model-visible inputs and refusals; they
also prove a changed native auth mode stops before any model request. Harmless
controls survive. Removing profile-config masking exposes MCP; removing home
instruction masking leaks the marked text; reattaching environments exposes image
reading; accepting mismatched responses, granting permissions or omitting EOF
failure handling fails the corresponding assertion. Removing the account-mode
comparison allows a model request and fails the mismatch test. Mutation receipts
are retained here, with source restored after every case.

The first EOF mutation exposed a weak test harness: the runner hung rather than
settling a failed assertion. Added an independent observation deadline to the test
and repeated the mutation; it now fails for an unresolved protocol request. The
first permission fixture sent its inspection response before that request existed;
fixed the fixture correlation without weakening the production response check.
The first synthetic native-auth fixture omitted the current auth-mode field and
used a provider declared to need no OpenAI auth, so native account reading returned
needs-login. Corrected that synthetic configuration and reran both auth cases.

The app task format now selects only the project's own stored name, summary,
status/type/phase and updated time, with a source identity and retained content
hash. It does not silently include workspace counts, other cases, uploaded files
or chat history. API and native output share a schema for a cited answer and an
optional draft submittal. Wrong project/source, extra fields, wider action/status,
missing facts and oversized input are refused or preserved explicitly. The
existing submittal canonicalizer removes the default draft status; corrected a
test that incorrectly expected that default to remain serialized. Its resulting
draft meaning and existing approval metadata remain asserted.

A native account read through the implemented boundary returned connected ChatGPT
authentication without exposing account identifiers or credential contents. Its
native catalog returned model choices. One real turn selected `gpt-5.6-luna` with
expected ChatGPT mode and answered the synthetic culvert record: the cost estimate
is unavailable. It returned a final native turn receipt. This consumed the
existing native account's allowance, with no API-key or paid infrastructure
fallback. A local scripted endpoint supplied all adverse protocol tests; the
single real turn is separate evidence.

Remaining: saved scoped connections, outbound connector polling, durable request
and result delivery, direct API parity, visible provider/model/auth selection and
real desktop/390px project/approval/recovery navigation. Then full QA/shuffle,
scoped live RLS and applicable upgrade/worker checks, final main CI and release.
This checkpoint is not an A0a release or complete connection workflow.

## Durable storage checkpoint

Added migration `20261010000001_assistant_provider_connections.sql` and eleven
live transaction cases. The named disposable stack
`openplan-restore-target-2026091050` at workdir
`/home/nathaniel/.local/state/openplan/openplan-restore-target-2026091050`
now has 314 migrations. This is the clean QA stack, not the demo or prior browser
fixture stack. The new SQL preserves original request packets, content hashes,
model/auth selection and results across retries; claims are one-shot and expired
attempts become interrupted without another generation. Revocation cancels pending
work and denies subsequent connector reads and result delivery. Membership,
project movement, exact attempt and source identities are rechecked.

Eleven live cases pass after SQL restoration. A harmless function comment survives;
nine targeted SQL defects fail the named assertions in `sql-mutation-results.json`.
These are sequential transaction/ACL checks; concurrent lock ordering and competing
claims remain unproved. The native, task and SQL mutation receipts are committed
here. The shared task also rejects multibyte prompts above the native byte limit.

One resumption rerun used a nonexistent `OPENPLAN_RLS_DB_CONTAINER` variable and
therefore reached the default local database; all eleven tests failed on the absent
new function. Their BEGIN transactions rolled back. Corrected the invocation to
`OPENPLAN_SUPABASE_WORKDIR` and added a preflight requiring an explicit absolute
workdir outside GitHub's isolated runner. An omitted target now fails before Docker
fixture execution. The successful rerun used the named clean stack above.

No provider route, connector polling loop or visible selector consumes this storage
yet. This foundation is unreleased; full QA, browser journeys, upgrade and final CI
are still required for a coherent provider-choice release. Local raw native records
and credentials remain outside the repository.

## Routes and outbound connector checkpoint

Added authenticated project connection issuance/revocation, retained turn creation,
recovery and cancellation, and a separate scoped-bearer native endpoint. Browser
mutations require the same origin. Connection metadata projections exclude token
hashes. Native claims return only the original checked project packet and one
attempt. Completion checks current access before reading the packet and repeats
that check inside the final SQL transaction. No native cookie-auth fallback or
business-action dispatcher exists.

The API path uses the existing Anthropic integration and same project answer
schema. It requires explicit credential-source/charge selection; stored-key metadata
and actual loaded source must match, so an unreadable workspace key cannot silently
use deployment billing. A newly saved API request has one generation, zero SDK
retries, a 55-second deadline and cancellation/access polling. Retries recover the
original result without making another call. These API tests use a stub provider;
no real API charge was made. Interface reference checked against the installed SDK
and [official generateText documentation](https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-text).

The local connector now has configure/models/run commands, private token/config
files, an OS lock and outbound-only polling. It pins the app origin, refuses
redirects, bounds responses and verifies the packet hash and project audience.
An actual two-server loopback test proves a redirect destination receives no bearer.
The native process receives neither the connection token nor browser credentials.
It syncs the pending attempt before generation and the completed answer before
HTTP delivery. Restart resends that exact completed delivery; a crash during
execution records interruption without another model call. Confirmed cancellation
or expiry retires only the matching attempt. Its own temporary native directories
are removed after the owned process closes; retained result delivery stays private.

Focused app suites pass 69 cases (17 project-format, 33 routes, 19 API). Live SQL
now passes 12 cases with explicit disposable workdir, including owner-only browser
recovery and durable expiry. The connector has 19 configuration/CLI/recovery tests,
plus the earlier 11 protocol tests and two separately enabled actual-native cases.
Harmless controls and targeted route, API, recovery SQL and connector mutations are
retained in the accompanying receipts. TypeScript and scoped ESLint pass.

Harness corrections: the first cancellation mutation hit the suite timeout; an
independent observation deadline now fails the cancellation assertion directly.
The first CLI harmless comment was inserted before its executable header and was
not harmless; moved it below that header. The first weakened-lock test leaked its
unexpectedly acquired competing handle until the harness timed out; the test now
releases that handle before reporting the failed exclusion assertion. All source
and SQL mutations were restored and no fixture process remained after inspection.

Blind categories: mocked route queries do not establish PostgREST grants or real
navigation. Sequential live SQL does not prove competing transaction lock order.
Journal write-order and OS-lock tests do not simulate physical power loss. The
browser selector, proposal handoff and desktop/390px journeys are still unfinished.
The CLI setup path is tested with synthetic downloaded credentials. No release or
complete A0a/A1a capability claim is made at this checkpoint.

## Browser candidate checkpoint

The existing project Planner Agent now contains provider/model/account controls,
connection setup/revocation, saved requests and cancellation. The small project task
is distinct from the existing broader chat. Native API-key turns require the same
explicit per-request charge acknowledgement as direct API turns; the server checks
it too. An interrupted POST retries its frozen question/model/request identity.
Recovery uses an exact request-id query rather than relying on the latest 20 rows.
Confirmed writes retain their success wording if only the following history refresh
fails. Saved draft proposals enter the existing conversation approval sheet and
registry; polling and recovery execute no business action. Reopening the same
provider draft does not duplicate its card within that conversation.

The 16 panel tests and 24 existing/new copilot tests exercise those user controls;
route tests now include native API billing acknowledgement. The appended UI mutation
receipt covers project/source boundaries, API consent, identical retries, IME
handling, duplicate proposal cards and an injected business write before approval.
These are DOM tests, not layout or real-browser acceptance.

Actual installed-native tests now additionally force the skills namespace's read
operation with two credential-file resource formats. Both return `skill package is
not available`; a fully qualified alternate function name returns unsupported-call.
The model-input corpus contains neither the native credential canary nor private
project/home/skill markers. The first expected-error pattern omitted the runtime's
actual unavailable-package wording and failed; inspected the returned refusals and
corrected that pattern without changing the native launcher. No real provider call
or credential is used by these tests.

Chrome 152.0.7977.82 launches through the existing root QA harness. This worktree
has no separate harness node_modules, so the first local import failed; reused the
installed root harness dependency without installing another browser. The named
browser fixture stack `openplan-restore-target-3390964` at
`/tmp/openplan-restore-drill.yBEWX9/openplan-restore-target-3390964` now also has the
additive provider migration (314 total). No reset or demo database change occurred.
Next: freeze this candidate, identify the served build, exercise desktop and 390px
navigation, downloads, provider delivery, cancellation, retries and proposal approval;
then run full QA/shuffle, isolated RLS/concurrency and applicable upgrade checks.
