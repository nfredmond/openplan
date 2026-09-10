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
