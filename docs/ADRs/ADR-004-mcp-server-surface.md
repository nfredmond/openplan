# ADR-004: An MCP Server Surface for OpenPlan

## Status

Accepted (2026-08-08) — scope decided and **approved by Nathaniel the same day**; implementation
is deferred in `docs/ROADMAP.md` until the existing modules are mature.

Decides: **build an OpenPlan MCP _server_, read-only first, propose-with-approval second.**
Refuses (with reasons, below): **OpenPlan as an MCP _client_**, sampling, MCP Apps, and any
write tool that executes without passing through OpenPlan's existing approval seam.

## Context

The Model Context Protocol shipped revision **`2026-07-28`** on 28 July 2026. It is a rewrite
rather than an increment, and three of its changes are the ones that move OpenPlan's answer from
"not now" to "now".

### What changed in the protocol

1. **The protocol went stateless.** The `initialize` / `notifications/initialized` handshake is
   removed, the `Mcp-Session-Id` header is removed, list endpoints no longer vary per connection,
   and SSE resumability (`Last-Event-ID`) is gone. Every request self-describes: protocol version,
   client capabilities and client identity travel in `_meta`
   (`io.modelcontextprotocol/protocolVersion`, `…/clientCapabilities`, `…/clientInfo`). A new
   `server/discover` RPC advertises supported versions and capabilities.

   *Why it matters here:* an MCP server is now a plain `POST` route handler. Under the previous
   revisions a remote MCP server needed session affinity or a Redis-backed session store — real
   infrastructure, on a product with a $0 hosting budget that must also self-host cleanly. That
   blocker is gone.

2. **Multi Round-Trip Requests (MRTR).** Server-initiated requests are abolished. A server that
   needs more information returns `resultType: "input_required"` with an `inputRequests` map and an
   opaque `requestState`; the client gathers the input and **retries the original request** with
   `inputResponses` plus the echoed `requestState`. Combined with **URL-mode elicitation**
   (`mode: "url"`), the protocol now has a first-class pattern for: *stop, send the human to a page
   on my own domain, tell the client nothing about what happened there, and resume when they retry.*

   *Why it matters here:* that is, structurally, OpenPlan's approval sheet. The spec even requires
   the server to verify that whoever opens the elicitation URL is the same principal the elicitation
   was minted for (its phishing mitigation) — the same check `verifyAssistantActionApproval` already
   performs between an approval row's `user_id` and the caller.

3. **Sampling, Roots and Logging are deprecated** (minimum twelve-month window), as is the legacy
   HTTP+SSE transport and Dynamic Client Registration (superseded by Client ID Metadata Documents).
   Authorization hardens: RFC 9728 protected-resource metadata is required, RFC 9207 `iss`
   validation is required of clients, and credentials are bound to the issuing authorization server.

   *Why it matters here:* the naive integration would have reached for **sampling** — "let the
   calling client's model produce this" — which would have put un-tiered, un-attributed model output
   inside OpenPlan's evidence path. The protocol deprecating it removes both the temptation and the
   future migration.

Minor but relevant: `tools/list` and friends now carry `ttlMs` / `cacheScope`, tools should be
returned in deterministic order, requests carry `Mcp-Method` / `Mcp-Name` headers a gateway can
meter on, and Tasks moved into an official extension (`io.modelcontextprotocol/tasks`) with polled
`tasks/get` instead of a blocking result.

### What OpenPlan already has that this plugs into

The action-registry seam (see CLAUDE.md, "the ultimate goal") is already the right shape:

- `ACTION_METADATA` (`src/lib/runtime/action-metadata.ts`) — eleven registered actions, each with an
  approval tier, an audit event and a plain-language description.
- `assistantApprovalActionSchema` (`src/lib/assistant/action-approval-server.ts`) — the per-kind zod
  branch, single-use hashed approvals, `executedActionPayload` stripping presentation-only fields.
- `buildAssistantProposalTools` (`src/lib/assistant/chat-tools.ts`) — **already generates a tool per
  registered action, from the registry, that returns a _proposal_ and never executes.** It runs
  RLS-scoped reference checks so a proposal cannot name a row the caller cannot see.
- `agent-principal.ts` + migration `20260730000006` — authorship recorded separately from the
  session, with `actor_kind CHECK IN ('user', 'planner_agent')`. Its own docblock anticipates this
  ADR: *"When the agent eventually holds its own credential … that principal is a NEW value here,
  not a schema change."*

### Buzz

`block/buzz` gives agents tool access **through MCP** (`buzz-dev-mcp`; the `buzz-acp` harness
bridges Goose / Codex / Claude Code, which are MCP clients). An OpenPlan MCP server is therefore not
a detour on the way to Buzz — it *is* the Buzz integration, arrived at through a public protocol
rather than a Buzz-specific one. If Buzz stalls or is replaced, none of the work is wasted, because
Claude Code, Claude Desktop and an agency's own agent speak the same protocol.

This also satisfies the binding Buzz condition better than a direct integration could: OpenPlan
depends on a published protocol, never on a Buzz instance existing anywhere.

## Decision

### 1. Build an MCP server. One registry, two transports.

**The MCP surface must not be able to write anything the in-app copilot cannot write.**

The tool surface is *generated from* `ACTION_METADATA` and `assistantApprovalActionSchema`, exactly
as `buildAssistantProposalTools` does today. `tools/call` on any registered action returns a
**proposal**. Execution goes through the same HTTP route, with the same approval headers, so
`verifyAssistantActionApproval`, `withAssistantActionAudit`, `refuseOutOfScopeAgentRequest` and the
claim-tier guard all still run.

The failure mode this rule exists to prevent, named plainly: **an MCP server that calls the
libraries directly, holding a bearer token and minting no approval, bypasses every guardrail built
between 2026-07-30 and 2026-08-05 in a single commit — and looks entirely reasonable doing it.**
That is this repository's own documented defect class ("a shared capability that lives inside one of
its two callers will be reimplemented wrongly by the other") arriving at the highest stakes it has
yet reached.

### 2. The approval loop maps onto MRTR, and the consent surface stays inside OpenPlan.

1. MCP client calls a write tool → server validates against the registry branch, runs the RLS-scoped
   reference checks, writes a **pending proposal** row, and returns
   `resultType: "input_required"` carrying a URL-mode elicitation pointing at an OpenPlan approval
   page, plus an integrity-protected `requestState`.
2. The planner opens that page **in OpenPlan**, signed in, and sees the real approval sheet
   rendering the real payload — the same sheet the in-app copilot uses. Approving mints the existing
   single-use, hash-bound `assistant_action_approvals` row.
3. The client retries the tool call. The server resolves the pending proposal from `requestState`,
   finds the approval, and calls the target API route with the existing approval headers.
4. If the planner has not acted yet, the server returns another `InputRequiredResult` rather than an
   error, per the spec.

`requestState` is HMAC- or AEAD-protected and carries the authenticated principal, a short TTL and a
digest of the originating request, per the spec's replay rules; the pending-proposal row enforces
single use, because the spec is explicit that `requestState` alone does not.

### 3. An external agent is a third principal, and its identity must be the verified one.

`actor_kind` gains `external_agent`. The recorded identifier is the **OAuth `client_id` / `sub`**,
which the authorization server vouched for — never `io.modelcontextprotocol/clientInfo`, which is
self-reported. The elicitation spec says this directly: servers MUST NOT rely on client-provided
user identification without server verification.

### 4. Authorization: Supabase is already the authorization server.

Supabase ships an OAuth 2.1 server that advertises MCP compatibility and dynamic client
registration. OpenPlan is the resource server: `/.well-known/oauth-protected-resource` (RFC 9728),
audience-bound token validation, `WWW-Authenticate` scope challenges.

**VERIFY AT IMPLEMENTATION:** whether Supabase's OAuth 2.1 server is available on *self-hosted*
Supabase or cloud only. This decides the self-host story, and self-host is first-class here. If it
is cloud-only, the self-host path is a workspace-scoped personal access token, disclosed as a
deviation from the spec's OAuth guidance rather than presented as conformance.

### 5. Reads are RLS-scoped, and the service-role client is unreachable.

The MCP server builds its Supabase client from the caller's token. The module must not be able to
import the service-role client — the same rule, and the same style of guard, that
`chat-tools.ts` already lives under. MCP reads spend database rather than Anthropic budget, so
`ai-rate-limit.ts` does not cover them; the surface needs its own bound.

## What is refused, and why

Recorded so a future session inherits the argument instead of re-running it.

**OpenPlan as an MCP _client_** — the copilot consuming an agency's own external MCP servers.
Refused now. An external tool's output arrives with no claim tier, no `[fact:id]` and no provenance
column, and the fiscal-verdict analysis of 2026-08-05 established that a tier with no column is
still a tier. The first use anyone would find for an external MCP tool is supplying a number the
model could not otherwise obtain — which is exactly the hole the grounding firewall exists to close.
Revisit only with a designed answer to "what tier is an external tool's output, and where is it
stored", not before.

**Sampling.** Deprecated by the protocol anyway. It would let a server-side flow borrow the calling
client's model, producing content that no principal in OpenPlan's ledger authored.

**MCP Apps (the UI extension).** Genuinely attractive later — a corridor map or a fiscal table
rendered inline inside a chat client. Deferred: it puts OpenPlan's rendering, and its caveats, inside
someone else's client, where a "not_determined" badge is one CSS decision away from disappearing.
Not before the read and propose lanes are proven.

**Direct execution of `safe`- and `review`-tier actions over MCP.** In-app, those tiers show no
approval dialog at all (recorded in the `refresh_gtfs_feed` metadata comment). Over MCP that would
mean no human saw it *and* no human is in the room. Whether `generate_report_artifact` — which only
re-derives from evidence already grounded — may execute directly over MCP is its own decision with
its own argument. The default is: everything proposes.

## Phasing

- **Phase 0 (standing).** Keep registering an action-registry entry with every new write capability.
  Unchanged; it is what makes every later phase cheap.
- **Phase 1 — read-only server.** `/api/mcp` via `mcp-handler@2.1` (peer `@modelcontextprotocol/server@^2`;
  the repo already satisfies zod ^4.2 and Node 20+). Tools derived from the existing chat read tools.
  `server/discover`, deterministic tool order, `ttlMs`/`cacheScope` on lists. An `EXTERNAL_CALLERS`
  allowlist entry in `every-api-route-has-a-caller.test.ts` naming MCP clients as the caller.
- **Phase 2 — propose + approve.** The MRTR/URL-elicitation loop, the pending-proposal table, the
  `external_agent` principal migration, the approval page mode. This is the real work.
- **Phase 3 — Tasks extension.** `io.modelcontextprotocol/tasks` over model runs: a run occupies a
  worker for minutes and currently has no agent-facing progress story, which is precisely what
  polled `tasks/get` is for.
- **Phase 4 — Buzz**, when Nathaniel judges the modules mature. By then it is configuration.

## Guards this must ship with

Executable, because only executable things survive a model handoff. Each mutation-tested — revert
the code it guards, confirm it fails for the right reason, restore.

1. The MCP tool surface derives from `ACTION_METADATA`: a registered action absent from MCP, or an
   MCP tool with no registry entry, fails the build.
2. No module under the MCP surface may import the service-role Supabase client.
3. No MCP tool may execute a write. Mutation: make one tool call its target route directly.
4. An `external_agent` ledger row must carry a verified client identifier — extend
   `planner-agent-is-a-distinct-principal.test.ts`.
5. `reachable-write-surface.ts` must walk the MCP route, so the claim-tier guard sees it.

## Consequences

**Accepted risk: protocol churn.** MCP has revised roughly every four months and `2026-07-28` is a
breaking rewrite with deprecations landing across a twelve-month window. Adopting it is a commitment
to track it. Mitigated by keeping the surface thin — the registry is the source of truth and the MCP
layer is a transport over it — so a future revision changes one adapter, not eleven actions.

**Accepted risk: an optional advanced surface.** Only someone who can configure an MCP client can
use this, which is the same reasoning already recorded for Buzz: self-serve governs the base
product, and the base product must remain fully usable with no MCP client anywhere. This must never
become the way to do something.

**Not a new module** (non-negotiable #2), for the same reason Buzz is not: it is a control surface
over modules that already exist, which is exactly why it comes after they are deep.

## References

- MCP `2026-07-28` specification and changelog — <https://modelcontextprotocol.io/specification/2026-07-28/changelog>
- Release announcement — <https://blog.modelcontextprotocol.io/posts/2026-07-28/>
- Multi Round-Trip Requests — <https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr>
- Elicitation (form and URL modes) — <https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation>
- Authorization — <https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization>
- Extensions overview — <https://modelcontextprotocol.io/docs/extensions/overview>
- `vercel/mcp-handler` 2.x — <https://github.com/vercel/mcp-handler>
- Supabase OAuth 2.1 Server — <https://supabase.com/docs/guides/auth/oauth-server>
- `block/buzz` — <https://github.com/block/buzz>
