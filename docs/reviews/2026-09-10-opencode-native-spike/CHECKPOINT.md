# OpenCode protocol investigation, September 10, 2026

v0.53.0 is published at e1618aa1; main publication receipt is de01ce9b. This separate OpenCode investigation is not app support.

Source: anomalyco/opencode v1.18.30, tag commit 3104c1428ec91f809e5ab86631300de41eb6952e. MIT license inspected. Official CLI/server/config/provider docs read; served native OpenAPI captured. Linux binary archive SHA256 55007246858165496ff85ba1c2b648f7421e8e2013bf4189a680c9ff8e699d17 matched GitHub digest. Installed only under this private evidence folder, not user PATH. No existing OpenCode installation/profile was found in standard paths. No real credential or paid model request.

The actual CLI can serve a Basic-authenticated loopback API from a private bwrap mount. Fresh process, random password and port. Native /global/health refuses anonymous calls with401; authenticated health/config/provider/doc return200. An empty enabled_providers list exposes no providers. Custom synthetic @ai-sdk/openai-compatible provider with exact model returns full project-output schema through /session/{id}/message. One native model call, only StructuredOutput advertised, actual assistant message retains providerID, modelID, sessionID, parentID, messageID, structured output and completed output-tool part.

Failed probes are material. Initial fixture used invalid citations and permission deny-all, which also removed StructuredOutput. The CLI repeatedly called an unavailable tool until the outer30s timeout. Native agent steps=2 did not cap requests; first log reached step628. Correcting citations alone did not fix tool denial. Allowing only StructuredOutput at both config/agent and session scope produced one successful local request. A later malformed-output probe capped its local fixture responses and retained six attempted requests (including native retries). This is a protocol finding, not an OpenPlan production incident.

Proposed implementation seam: existing outbound connector + owned isolated OpenCode server + native account inspection + exact selected provider/model + full schema + existing durable delivery journal. Do not import T3 editor orchestration. No external server attachment, arbitrary tool/config passthrough or inherited project state. Native owns its credentials; OpenPlan never uploads credentials to its application. Account modes must be discovered and checked rather than inferred from a connected-provider list or available login-method list.

A hard request bound needs an enforcement mechanism outside advisory agent steps. For an initial API path, a per-turn authenticated loopback relay can forward the selected native request to the fixed permitted upstream while allowing at most the declared number of model calls. It must stream with byte/time limits, refuse redirects/wrong method/path/model and not log credentials. Requests past the bound fail locally; no silent provider fallback. Explore exact native auth-status output first. Subscription adapters require separate provider entitlement and refresh acceptance; existing native Codex/Claude paths remain available. Do not promise arbitrary OpenCode subscription access.

Before app integration: unit/parser/launch/relay challenges; actual-native wrong tool/private-file canaries, unsupported schema/model/account, truncation, cancellation, no duplicate generation, positive and negative authentication; harmless and targeted mutations. Then provider-bound SQL/routes/UI migration and real desktop/390px workflows. A0/A1 remain partial.

Separate code-review finding: older codexLaunch checks do not mirror Claude scratch-root and reciprocal-overlap refusals. The public connector generates fresh scratch dirs itself, so this is not an established user-visible exploit. Investigate with bounded local regression as follow-up hardening.

Native `auth list --pure` was exercised offline with synthetic OpenAI API and Anthropic OAuth entries. It prints provider display name plus api/oauth and no credential content (ANSI escapes remain even with NO_COLOR). This can support a pinned, strict parser for explicitly supported provider IDs; display-name parsing cannot safely establish arbitrary custom-provider identities. Native OpenAPI version says1.0.0 while binary says1.18.30, so the binary pin and schema facts must be recorded separately.


Primary sources read September10:
- https://github.com/anomalyco/opencode/releases/tag/v1.18.30
- https://opencode.ai/docs/cli/
- https://opencode.ai/docs/server/
- https://opencode.ai/docs/config/
- https://opencode.ai/docs/providers/
- https://github.com/anomalyco/opencode/blob/3104c1428ec91f809e5ab86631300de41eb6952e/packages/opencode/src/session/prompt.ts
- https://github.com/anomalyco/opencode/blob/3104c1428ec91f809e5ab86631300de41eb6952e/packages/opencode/src/effect/runtime-flags.ts
- https://github.com/anomalyco/opencode/blob/3104c1428ec91f809e5ab86631300de41eb6952e/packages/opencode/src/auth/index.ts

Next: first bound transport for native OpenCode with an explicitly supported OpenAI API account. Production OpenAI uses Responses, so the initial compatible-provider Chat Completions probe is only exploratory; verify the actual native OpenAI provider path before support. Keep other OpenCode providers/account modes explicit remaining scope. Native inspection, model identity, bounded response delivery, unsupported tools, private profile masks and exact retry must be proved before any UI/migration integration.


## Bounded relay checkpoint

The worker now contains an unconnected OpenCode relay helper. A random per-turn
loopback path forwards one OpenAI Responses request with the exact selected model,
store=false, streaming output and only StructuredOutput. It refuses other origins,
methods, paths, tools, redirects, oversized bodies/output and stalled IO. Native
credentials travel in the request header to the fixed upstream; they are not read
from disk, logged or sent to OpenPlan. Native retries cannot forward a second model
request. This helper is not yet dispatched by any app/connector configuration.

All28 relay tests pass. One harmless unit mutation survived;21 targeted defects
failed their relevant assertions. With the actual installed OpenCode OpenAI adapter,
one full-schema synthetic Responses call passed through the relay. A forced tool
response prompted another native model request, which the relay blocked locally.
A native harmless control passed; removing the reservation guard forwarded two
requests and completed an extra result, failing the expected refusal. The guard
was restored and all28 tests passed again. Default connector suite:121pass,
3native opt-in skips. See adjacent receipts; no real provider request occurred.

The exploratory Responses fixture first omitted function_call_arguments.done;
the actual SDK retained a structured-output failure. Adding that required native
stream event completed the structured result. The relay concurrency test initially
expected an HTTP failure status when the socket was correctly closed; it now accepts
that refusal while requiring exactly one upstream call. Deadline tests have separate
watchdogs so removing the deadline fails an assertion without stranding a process.

Next implement the native launch/account/result wrapper. For this first API-only
path, bind only the private native auth.json file read-only, with fresh runtime/data,
configuration, cache and session directories. API keys do not refresh; OAuth modes
must refuse instead of pretending this mount supports native credential refresh.
Do not mount the user's history or project directory. Broader native modes require
separate acceptance. Then run actual-native canaries and cancellation before SQL/UI.


## Weekly-limit checkpoint, September10

The OpenCode launch helper is now implemented separately from the app. It pins
Linux1.18.30, mounts only a private native auth.json read-only, uses fresh private
runtime/data/config/cache/state and disables inherited context/plugins/tools,
auxiliary model tasks and model-catalog network fetching. Thirty launch tests pass.
One harmless launch mutation survived and34 targeted changes failed. The first
file-type mutation survived because the test directory had public permissions;
changing the synthetic directory to0700 isolated the file-type check. The initial
receipt remains. An existing-runtime-before-task-directory case also prevents
reuse from passing through a later incidental mkdir refusal.

The actual launch with synthetic native OpenAI API credentials completed one
Responses request through the relay using the catalog's gpt-6-astra. It reread the
exact assistant message and matched the supplied parent message ID. Physical mount
checks found no private profile/scratch canary and refused an auth-file write with
EROFS. No canary or synthetic key entered the model request. Default connector
suite now passes151 with3 native opt-in skips; no app or browser support is claimed.

Two protocol details must survive resumption. The exploratory custom model gpt-6
was synthetic; the production native catalog does not contain that exact ID and
refused it before any request. Use actual native model IDs such as the observed
gpt-6-astra, without promising remote account availability. Also GET/provider
includes credential fields: never expose its raw result. Use native auth-list and
model-list commands plus strict sanitized parsing. The native list-message endpoint
rejects its stored plain OutputFormat class on readback in1.18.30. Exact assistant
message GET succeeds, so the bounded adapter can verify that message and its exact
supplied parent ID while OpenPlan retains its own frozen question/result. Do not
claim general native history interoperability or patch native databases.

See [RESUME.md](RESUME.md) for the precise next boundary and local commands. This
checkpoint intentionally stops before account/result/process wrapper and SQL/UI
integration. Native physical guard mutations are next; generated-option mutations
and one positive native launch do not independently prove every runtime restriction.

## Physical filesystem verification continued, September 10

The next physical checks are now complete. The production native probe passed
with a harmless comment change and failed when credentials became writable or
the whole scratch directory became visible. The scratch mutation also corrected
its working directory so the failure came from reading the private canary,
not from failing to start the process. Source was restored after each series.

The committed `opencode-native-filesystem.test.mjs` repeats the physical mount
checks using the pinned native binary for version inspection and Node inside
the generated sandbox to attempt reads and writes. It uses generated synthetic
credentials and makes no model request. One harmless mutation survived. Five
targeted mutations failed with distinct assertions for writable credentials,
exposed scratch, exposed profile, inherited task context and missing credentials.
The restored test passes. The default connector suite passes 151 tests with four
explicit native opt-in skips, including this new test.

Blind categories remain native account parsing, actual provider account access,
native model behavior, network egress beyond the relay, and app reachability.
This physical test does not execute native generation; the separate production
probe supplies the bounded synthetic native-generation evidence. No OpenCode
user-facing support or release is claimed. Continue with sanitized account/model
parsing and the owned server lifecycle in RESUME.md.

## Native account ambiguity and parser checkpoint, September 10

The earlier instruction to infer account mode from native `auth list` was
insufficient. The pinned native CLI prints a model-database display name, falling
back to the literal credential ID. Synthetic records under `openai` and `OpenAI`
produced byte-identical successful credential-list output. Native `models openai`
also returned the same 49 IDs for valid API, OAuth, display-collision and empty
credential fixtures. Every command ran with `bwrap --unshare-net`, so this is an
offline catalog, not proof of provider access. Primary source:
[provider-list implementation](https://raw.githubusercontent.com/anomalyco/opencode/3104c1428ec91f809e5ab86631300de41eb6952e/packages/opencode/src/cli/cmd/providers.ts).

`opencode-account.mjs` now projects only the exact own `openai` credential record
to a nonidentifying mode/status. It returns no secret or metadata. API mode is
`opencode_api`, distinct from Codex's API mode; unsupported modes remain explicit.
The separate plain model parser preserves exact IDs and supplies no default or
access claim. Its 38 tests pass. One harmless mutation survived and 19 targeted
changes failed. The first catalog-size mutation survived because invalid text
also triggered the syntax check. The corrected fixture contains valid unique
model records below the count limit and above the byte limit. Both receipts remain.
The restored complete connector suite passes 189 tests with four native skips.

This is a pure projection, not an integrated connection check. A bounded private
reader, binding the inspected credentials to the native process, server lifecycle,
turn verification and app integration remain unfinished. Do not feed untrusted
provider labels into this projection or treat a local configured status as proven
remote access. The four native catalogs were parsed successfully against retained
synthetic command output; no live account or model call was used. Private probe:
`probe-account-identity.mjs` in the evidence directory recorded in RESUME.md.
