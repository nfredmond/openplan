# Extensible API choice: implementation boundary, September 12

This is preparation for roadmap A0b, not an implemented capability or a second
queue. The corrected v0.54.0 release at 33a5fb0c is now published.
[Publication receipt](publication.json) records successful CI 34713463150,
RLS 34713463159 and Upgrade Path 34713492994. The failed 4e9de713 candidate
remains historical evidence.

## Reuse and transport decision

Extend the retained project question/draft task, its existing provider panel,
request records and exact submittal approval. Keep ordinary chat, public AI and
unattended jobs on their separately declared providers until their workflows
are adapted. Native connections and their credentials remain separate.

Reuse the existing integration encryption and owner/admin authorization patterns.
`workspace_integration_keys` currently has one replaceable key per fixed provider,
with a database check allowing only Anthropic, Census and Mapbox. It cannot
represent multiple custom endpoints or bind historical requests to an immutable
endpoint revision. Extend the integration system with versioned API connection
records rather than overloading the native device token or rewriting old keys.

The selected library is the AI SDK 6-compatible `@ai-sdk/openai-compatible`
2.0.75. Its published archive was inspected locally without installing it into
the app. It uses LanguageModelV3, permits an injected fetch and supports a
declared structured-output mode. Its Apache-2.0 license is compatible with this
repository. Package integrity:
`sha512-W9w3tCoYrevct2Ips2X4EFOow8Kzrg0nqVJi9jm0lHiMlTmTON4nzaCv3Zkzg6eFCJJVH60kd4+t7tHgtOxx9Q==`.
The [provider documentation](https://ai-sdk.dev/providers/openai-compatible-providers)
describes custom endpoints and fetch injection; the pinned package source is the
implementation authority. No SDK major migration or new orchestration system is
needed.

The pinned compatible adapter permits missing response model/ID fields. Installed
AI SDK 6.0.278 `generate-text.ts` then substitutes the selected model when response
model metadata is absent. Therefore checking only `generation.response.modelId`
would falsely certify model identity for a response that omitted it. Validate the
bounded raw response's model and response ID before letting the SDK normalize it.
Wrong, missing or aliased model identity must remain an explicit refusal unless
an exact alias policy has separately been configured and bound to the request.

The [executed SDK probe](api-model-identity-probe.json) now confirms this behavior
with the actual pinned packages. Exact identity and a harmless extra field pass;
missing model, wrong model and missing ID all produce SDK-successful structured
answers but fail the raw identity comparison. Each case makes one injected
transport call and no network request. This is adapter research, not acceptance
of an implemented API connection.

## Connection and request custody

Workspace owner/admin setup should name the endpoint, protocol, exact model IDs,
structured-output support and credential mode. Ordinary project users choose an
authorized saved connection and model. Show the destination and data sent before
generation. Empty configuration is not a working provider; opening configuration
must not make a billable request. Local no-key models remain possible under
explicit operator network configuration, without claiming every local model can
complete this task.

Retain immutable endpoint revisions with encrypted credentials available only to
server code. Updating an endpoint, credential or model list makes a new revision;
revocation prevents new attempts and cancels active attempts while preserving old
answers. Bind the connection revision, protocol, endpoint, selected model,
credential mode and exact charge acknowledgement into the saved request identity.
Never use an edited destination or another key when retrying an old request.

Add an optional API connection-revision reference to the existing turn record,
with composite workspace identity. Preserve existing native and Anthropic rows
unchanged. Extend the existing creation/finish functions and row locks; do not
create a second owner of generation state. Keep one generation, zero SDK retries,
current cancellation checks, an actual attempt receipt and identical-request
recovery. Saved proposals still enter the existing exact approval flow.

## Outbound boundary

`lib/http/outbound-url.ts` already exports byte-based address classification.
Reuse it, but its documented resolve-then-fetch helper cannot pin DNS to the
socket. A custom provider carrying selected case data and credentials needs a
request transport that resolves once, checks every answer, then connects only to
one approved address while preserving TLS hostname verification. Do not weaken
the shared feed-fetch guard or accept an arbitrary browser-supplied fetch URL.

The transport must allow exactly the configured protocol path, one POST, bounded
request/response bytes and cancellation. Refuse redirects, credential-bearing
URLs, ambient proxy credentials and unexpected custom headers. Default to public
HTTPS. Local HTTP endpoints require an exact operator-configured allowance and
their own address policy; a workspace admin cannot thereby access metadata,
database or unrelated private services. Preserve self-hosted/local operation
without a broad private-network bypass.

## Evidence required for the implementation

Exercise the actual pinned SDK against local scripted providers. Inspect the
wire request and bounded raw response, including absent/wrong model ID,
incomplete output, malformed schema, unsupported capabilities, redirects,
DNS answer changes, mixed private/public answers, excessive bodies, cancellation
and zero additional calls after retry. Harmless mutations must survive while
removed guards fail for the stated reason.

Live database tests must cover cross-workspace connection/revision references,
credential exclusion from member reads, concurrent edit/revoke/create/finish,
exact request identity and old-row upgrade preservation. Real navigation at
desktop and 390px must cover admin setup, member selection, charge acknowledgement,
provider switching, saved history, interruption/retry and exact draft approval.
Inspect console and stored artifacts. No real provider spend is required for
these engineering fixtures; live availability and usefulness remain separate.

This does not close broader A1 assignments, remaining native account modes or
any of the planning/scientific requirements in the full v1 contract.
