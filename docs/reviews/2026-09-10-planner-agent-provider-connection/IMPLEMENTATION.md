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

## First browser findings and correction

Identified candidate 2e70bed4c0d7 failed at real connection creation: Chrome sent
Origin and Host 127.0.0.1:3219 while Next supplied an internal localhost handler
URL. The old origin check rejected the legitimate same-origin request with 403.
A controlled alternate-Origin probe reproduced that mismatch; its two synthetic
connections were revoked. No provider generation occurred. The corrected check
uses the addressed Host and scheme, ignores forwarded-host, and still refuses
cross-site requests. The setup download now uses that same addressed origin.

Cancellation remains available while the original save response is outstanding.
Its response reads the retained terminal state so an already completed request is
not falsely called cancelled. A confirmed terminal result aborts only the matching
held browser request and does not offer an unnecessary resend. Two DOM cases hold
the original response and check both cancelled and already-succeeded outcomes.

The 37 route and 18 panel tests pass. Harmless comments survive; reverting origin
handling, trusting a forged forwarded host, falsely reporting cancellation, or
disabling cancellation each fails the intended assertion. Mutation sources were
restored. Scoped lint and TypeScript pass. These checks do not establish rendered
browser usability; the rebuilt candidate still requires desktop and 390px journeys.

## Identified browser acceptance: 5d831adcc61c

Chrome 152 ran the production build from this isolated worktree at 127.0.0.1:3219;
which-openplan and the listening process cwd matched the candidate. Each width
(1440 and 390px) entered through home, sign-in, dashboard and Projects, then the
existing project's Planner Agent. Keyboard use covered navigation, request sending,
cancellation, retry and approval. Screenshots were inspected at both widths; the
controls and wrapped answers remain reachable without document-width overflow.

Connection creation and downloaded JSON now preserve the addressed app origin.
Cancellation stays enabled while a native request's original response is held,
then persists across a fresh browser session. Those connections were revoked.
The first screenshot captured the revoke click before its response; a subsequent
fresh session confirmed the retained revoked status rather than relying on that
premature screenshot. The visible cancelled records are retained in this bundle.

Both widths configured the outbound connector from a real UI download, inspected
the installed native account/model list, and completed one actual gpt-5.6-luna
ChatGPT-account turn. Each returned a scoped answer and draft proposal, kept costs
unknown, and retained the exact original packet/result/receipt after reload. No
second generation occurred on reload. The desktop harness initially stopped on an
incorrect exact-label selector after native recovery; it resumed from the saved
result without repeating native generation. Both native connections were revoked.

Both widths also exercised the production Anthropic SDK/route/SQL with a dedicated
process-local scripted transport and literal synthetic deployment key. No Anthropic
request left that process, and no API charges were incurred. These are API transport
integration results, not live Anthropic model-quality evidence. Returned proposals
entered the existing action approval sheet, and keyboard approval created one draft
submittal per project. Read-only SQL confirmed record IDs
2d389c10-68c6-4791-a4ea-294d08841149 (desktop) and
7811aa5f-654e-4960-a764-77e306157d13 (390px), matching consumed approval hashes,
planner_agent authorship and retained draft receipts.

For each width, deliberately severing a successful API response exposed Retry same
request. The retry sent the identical body, returned the identical saved row, and
made exactly one scripted provider call in total. Cancelling a delayed API attempt
kept a null-result cancelled row after reload, with one provider call and no restart.
Normal journeys had no console warnings/errors. Recovery journeys had only the
injected ERR_CONNECTION_RESET. The owned acceptance server was stopped before
further source changes.

Blind categories: these are synthetic project engineering journeys, not practicing
planner usefulness or live Anthropic service acceptance. Native-account success does
not prove all models/accounts/platforms. Concurrency and final full release QA are
still pending; no A0a completion or release declaration is made at this checkpoint.

## Database competition and connector exit status

Eight new live transaction cases cover identical native/API request creation,
competing native claims, concurrent membership removal/project move, cancellation
and revocation before delivery, and identical competing result delivery. The test
observes actual database lock waits, commits the competing change, and checks the
saved outcome. These and the twelve sequential provider/RLS cases pass on the named
clean disposable stack. The new suite is included in test:rls-live.

Harness errors were corrected before claiming evidence: the first invocation ran
from the repository root through an unpinned cached Vitest rather than the app's
installed runner. It still targeted the explicitly named disposable stack. A fixed
synthetic token hash collided between committed concurrency fixtures; new fixtures
use distinct hashes, and the one conflicting synthetic row's hash was changed in
that stack. The membership case initially hit the existing last-owner protection;
a separate synthetic custodian now preserves an owner while the tested membership
is removed. No app guard was weakened to accommodate these harness errors.

Harmless SQL comments survive. Missing scope locks, overlapping native claims,
falsely new duplicate requests and changed completion replays fail their targeted
assertions. Removing only the cancelled-state guard still hit the independent row
constraint; a second mutant also cleared the failure code and actually published a
late answer, which the test rejected. All SQL definitions were restored. The receipt
files retain both the independent constraint defense and the stronger mutation.

The connector's --once command previously exited zero after HTTP 503. A real local
HTTP test reproduced it. It now exits nonzero without retrying or printing the
response body/token; a valid idle response still exits zero. Harmless comment and
restored-defect mutations verify the regression check. No provider generation is
needed for this test. Concurrency controls do not simulate physical power loss,
network partitions inside Postgres, or every possible multi-transaction ordering.

Next: full QA, shuffled tests, full isolated RLS, worker/native suites and populated
upgrade evidence; prepare a bounded v0.52.0 release, merge directly to main and inspect
its final CI before tagging. A0a remains partial beyond the tested narrow project
record task; API evidence uses a scripted transport and broader chat/provider work,
additional native backends and durable assignments remain ahead.

## Full-suite integration findings

At c4026ed2, full QA and shuffled seed910052 each reached13741 passed,349 skipped
and seven failed tests in six files. Failures identified the new two-table/policy
inventory, omitted SQL-only request digest documentation, missing Unreleased
migration instructions, explicit private-provider route classifications, one copy
label, and missing project-deletion dependencies. No green full-suite claim was
made. The full isolated RLS run passed378 tests in46 files in396.86seconds. All52
Python worker suites and all33 connector tests (including actual-native fixtures)
passed. The ordinary QA connector suite remains separately default-skipped for the
two opt-in native cases when no binary is supplied.

The deletion finding required a code fix, not just inventory bookkeeping. Ordinary
user SELECT hides other users' personal provider rows. A narrow authenticated RPC
now checks current writer membership and returns only per-project counts; no
personal IDs, questions, tokens or answers. The existing preflight/DELETE count
helper uses it and refuses missing, malformed or denied results. The registry
explains preservation and retirement. A database BEFORE DELETE trigger separately
blocks deletion when private provider history exists, even if the caller bypasses
the dialog. Empty project deletion remains allowed. No existing row or constraint
was dropped. Both named disposable stacks received the new function/trigger tail
of the unreleased provider migration; the migration count remains314.

The new live case confirms another project owner's SELECT sees zero private rows,
but the administrative RPC returns exactly two counts; viewers and outsiders are
refused. It proves empty deletion and retained-history refusal. The first mutation
run exposed a surviving unreadable-private-count-as-zero mutant. Four explicit
refused/missing/negative/fractional count cases were added; preserve the first result
and record the rerun instead of erasing that coverage gap. Test fixture assumptions
about first table order, count sorting and substituted URLs were corrected without
weakening the app protections.

Pending: inspect the final mutation rerun, restored focused/RLS/lint/type checks,
commit/freeze/rebuild and desktop390px deletion-dialog acceptance, then fullQA and
shuffle again. Prepare0.52release metadata only after those checks. Merge main,
inspect exact-SHA CI and populated upgrade before tagging. No human gate.

The strengthened count tests initially compared a table-prefixed message array to
an unprefixed exact string; the harmless control correctly failed. Corrected that
assertion, checked the restored baseline first, then reran every mutation. All ten
outcomes now match: both harmless controls pass, and hidden/unreadable counts,
missing role classification/digest inventory, missing table count, copy regression,
delete cascade and viewer-count access fail the intended checks. Source and SQL
were restored. Initial failures and final results are retained separately.
