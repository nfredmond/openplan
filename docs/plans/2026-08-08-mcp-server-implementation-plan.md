# MCP Server — Executable Implementation Plan

**Created 2026-08-08. Status: APPROVED by Nathaniel, not started.**
Decision and reasoning: `docs/ADRs/ADR-004-mcp-server-surface.md` — **read that first.** This file is
the how; the ADR is the why, and the ADR's refusals are binding on this plan.

This plan is written to be picked up cold by a later session, possibly a different model, with no
memory of the conversation that produced it. Every step names the files it touches, what "done"
means, and — where a claim could not be verified on 2026-08-08 — says so explicitly rather than
letting a later session inherit a guess as a fact.

---

## The single rule this plan exists to protect

**One registry, two transports.** The MCP surface never gains a capability the in-app copilot does
not have, and never writes anything except through the approval seam that already exists.

If at any point implementing a step seems to require the MCP layer to call a library directly, to
mint its own approval, or to hold a service-role client — **stop.** That is the failure the ADR was
written to prevent, and it will look like the reasonable shortcut at the time.

---

## Ground truth as of 2026-08-08

Verified by reading the code on this date. Re-check before relying on any of it; the repo moves.

| Fact | Where |
|---|---|
| 11 registered actions | `src/lib/runtime/action-metadata.ts` → `ACTION_METADATA` |
| Per-kind payload schema, single-use hashed approvals | `src/lib/assistant/action-approval-server.ts` |
| Proposal tools **already** generated from the registry, returning proposals not executions | `src/lib/assistant/chat-tools.ts` → `buildAssistantProposalTools` |
| 7 read tools | `chat-tools.ts` → `search_knowledge_base`, `get_surface_context`, `list_projects`, `list_funding_opportunities`, `list_reports`, `list_pending_operations`, `get_grant_program_catalog` |
| Authorship recorded apart from session; `actor_kind CHECK IN ('user','planner_agent')` | `src/lib/assistant/agent-principal.ts`, migration `20260730000006` |
| Out-of-scope request refusal for wide routes | `src/lib/assistant/agent-request-scope.ts` |
| Route-caller guard with a named external-caller allowlist | `src/test/every-api-route-has-a-caller.test.ts` → `EXTERNAL_CALLERS` |
| App version 0.8.0; Next 16.2.11; zod ^4.3.6; ai ^6.0.94 | `openplan/package.json` |

Package targets checked on npm 2026-08-08, **not run**: `mcp-handler@2.1.0`, peer
`@modelcontextprotocol/server@^2.0.0` and `next >=13`. The repo's zod (^4.3.6) satisfies
mcp-handler's `zod ^4.2.0` peer.

---

## The stateless problem this plan has to solve first

The in-app copilot always knows which workspace it is in, because it is rendered on a page inside
one. **An MCP client has no page and no session**, and revision `2026-07-28` removed the protocol's
session entirely — the spec's own guidance is that servers needing cross-call state use explicit,
server-minted handles passed as ordinary tool arguments.

**Decision (settled here, do not re-litigate):** every OpenPlan MCP tool takes an explicit
`workspaceId` argument, and a `list_workspaces` tool returns the memberships the bearer token can
actually see. No implicit "current workspace", no server-side sticky selection. The workspace
argument is checked against the caller's memberships by RLS on every call, exactly as the chat tools
check proposal references today.

Consequence to design around in Phase 1: `buildAssistantChatTools` takes an `AssistantContext` built
from a *surface*, and the tools close over `context.workspace.id`. The MCP layer needs the same read
implementations reachable with only `(supabase, workspaceId, userId)`.

---

## Phase 1 — read-only MCP server

**Goal:** an MCP client authenticated as a real OpenPlan user can list and read what that user can
already see in the app, and can write nothing at all.

### 1.1 Extract the read tools so both transports share one implementation

This is the substance of Phase 1 and the step most likely to be skipped. Do not skip it.

Today each read tool is an AI-SDK `tool({ description, inputSchema, execute })` built inside
`buildAssistantChatTools`, closing over the chat context and a per-turn call budget. MCP needs the
same *behaviour* with a different wrapper and no budget.

- Create `src/lib/assistant/read-capabilities.ts` (name it for what it is; it is not MCP-specific).
- Move the **body** of each of the 7 read tools into a plain async function with an explicit
  signature — `(deps: { supabase, workspaceId, userId, audit }, input) => Promise<payload>` — plus
  its zod input schema and description as exported data.
- `chat-tools.ts` keeps the AI-SDK `tool()` wrapper, the `guarded()` budget wrapper and the refusal
  semantics, and calls the extracted function. **Its behaviour must not change.**
- The MCP layer wraps the same functions.

Why this shape and not "the MCP server imports chat-tools": CLAUDE.md records that *a shared
capability living inside one of its two callers will be reimplemented wrongly by the other* — it has
already cost this repo a geofence enforced on one of two doors and custody no page could display.
The extraction is the point, not a tidy-up.

**`get_surface_context` needs a decision at implementation.** It describes an assistant *surface*
(workspace + target page), which MCP does not have. Either give it a workspace-only variant, or omit
it from the MCP surface in Phase 1 and say so in the tool list. Do not fake a surface.

**Definition of done for 1.1:** the existing chat-tools tests pass unchanged, and a new test asserts
both transports resolve to the same function (see guard G-1).

### 1.2 Authentication and the resource-server surface

- `src/lib/mcp/auth.ts` — validate the bearer token, build a **session-scoped** Supabase client from
  it, resolve `userId`. Never the service-role client.
- `src/app/.well-known/oauth-protected-resource/route.ts` — RFC 9728 metadata pointing at the
  Supabase authorization server. Required by the spec for HTTP transports.
- 401 responses carry `WWW-Authenticate: Bearer resource_metadata="…", scope="…"`.
- Token audience validation: the spec requires the server to reject tokens not issued for it
  (RFC 8707). Do not skip this — accepting a token minted for something else is the confused-deputy
  case the spec names.

**VERIFY AT IMPLEMENTATION (blocks the self-host story):** whether Supabase's OAuth 2.1 server is
available on **self-hosted** Supabase or cloud only. Self-host is first-class here (CLAUDE.md,
"Who the documentation is for"). If cloud-only, the self-host path is a workspace-scoped personal
access token, **disclosed in the operator docs as a deviation** from the spec's OAuth guidance —
never presented as conformance. Decide this before writing 1.2, because it changes the shape.

### 1.3 The route

- `src/app/api/mcp/…/route.ts` via `mcp-handler`. **VERIFY:** whether mcp-handler 2.x still wants the
  `[transport]` dynamic segment used by the 2025-era Vercel template, or a single static route now
  that the protocol is stateless. Read its README before choosing the path — the path is baked into
  every client's config and into the OAuth resource identifier, so changing it later is a breaking
  change for every configured agency.
- `src/lib/mcp/server.ts` — the server definition: identity, `server/discover` capabilities,
  deterministic tool ordering, `ttlMs` / `cacheScope` on list results.
- Declare **no** support for sampling, roots, or logging. They are deprecated in this revision and
  the ADR refuses sampling on its own merits.
- Rate limiting: `src/lib/runtime/ai-rate-limit.ts` bounds Anthropic spend and does **not** cover
  this surface, which spends database instead. Give the MCP route its own per-principal bound.
- Add an `EXTERNAL_CALLERS` entry in `every-api-route-has-a-caller.test.ts` naming MCP clients as the
  caller, in the same "here is who actually calls this" style as the existing entries.

### 1.4 Operator documentation

A capability nobody can turn on is the shipped-invisible defect in another costume.

- `openplan/docs/SELF_HOSTING.md` — how to enable the MCP surface, what it exposes, what it cannot
  do, and how to connect a client. State plainly that it is optional and that OpenPlan is fully
  usable without it.
- `CHANGELOG.md` — written for whoever operates a deployment, leading with any required migration.

### Phase 1 definition of done

- An MCP client authenticated as a real user lists workspaces and reads projects, reports, funding
  opportunities, pending operations and the grant catalog — **scoped by RLS, verified against the
  live database, not a mock.** A mocked Supabase client cannot prove RLS scoping (memory:
  `service-role-pages-have-no-rls-net`, `openplan-verify-against-the-database`).
- Two workspaces, two users: user A's token cannot read workspace B. Verified live.
- No write tool exists on the surface at all.
- Guards G-1, G-2, G-3 land with Phase 1, each mutation-tested.

---

## Phase 2 — propose and approve (the real work)

**Goal:** an MCP client can *propose* any registered action; a human approves it **inside OpenPlan**;
the write then runs through the existing route with the existing verification.

### 2.1 Migration

One migration, next free number:

- `assistant_action_executions.actor_kind` CHECK gains `'external_agent'`. Keep the existing
  both-or-neither constraints on `actor_agent_id` / approver pairing.
- New table `mcp_pending_proposals`: id, workspace_id, user_id (the principal the proposal was minted
  for), client_id (the **verified** OAuth client), action_kind, payload, input_hash, created_at,
  expires_at, consumed_at, approval_id. RLS scoped to the workspace, single-use enforced by an
  atomic `UPDATE … WHERE consumed_at IS NULL … RETURNING`, exactly as
  `verifyAssistantActionApproval` consumes an approval today.
- Column comments carrying the reasoning, in the style of `20260730000006`.

**The identity rule, restated because it is the one a later session is most likely to get wrong:**
the recorded agent identifier is the OAuth `client_id` / `sub` that the authorization server vouched
for. It is **never** `io.modelcontextprotocol/clientInfo`, which the client writes about itself and
the spec explicitly says servers must not trust.

### 2.2 The proposal tools

- Generate them from `ACTION_METADATA` + `assistantApprovalActionSchema`, the same way
  `buildAssistantProposalTools` already does. Extract that generator alongside the read capabilities
  (step 1.1) rather than writing a second one.
- Reuse `PROPOSAL_REFERENCE_CHECKS` — the RLS-scoped existence checks that stop a proposal naming a
  row the caller cannot see. Read the `refresh_gtfs_feed` comment before touching them; its
  `workspace_id IS NULL` behaviour is deliberate.
- Reuse `normalizeProposalInput` (string trimming). Its docblock explains that skipping it mints
  evidence for a hash execution can never match, producing an inexplicable post-approval 403.

### 2.3 The MRTR approval loop

1. `tools/call` on a write tool → validate → write `mcp_pending_proposals` → return
   `resultType: "input_required"` with a **URL-mode elicitation** pointing at an OpenPlan approval
   page, plus `requestState`.
2. `requestState` is integrity-protected (HMAC or AEAD) and carries the authenticated principal, a
   short TTL, and a digest of the originating request — the spec's replay rules. Single use is
   enforced by the row, because the spec is explicit that `requestState` alone does not guarantee it.
3. The approval page renders **the existing approval sheet** with the real payload. It must verify
   that the signed-in browser user is the principal the proposal was minted for — the spec's
   phishing mitigation, and the same identity check the approvals route already makes.
4. Approving mints the existing single-use `assistant_action_approvals` row and links it to the
   pending proposal.
5. The client retries; the server resolves the proposal, finds the approval, and calls the target
   API route with the existing headers (`x-openplan-assistant-execution-source`,
   `…-approval-id`, `…-input-hash`).
6. If the human has not acted yet, return **another** `InputRequiredResult` — not an error. The spec
   requires this and it is also the honest answer.

**Do not let the MCP layer execute the write itself.** Going through the route is what keeps
`verifyAssistantActionApproval`, `withAssistantActionAudit`, `refuseOutOfScopeAgentRequest` and the
claim-tier guard in the path.

### 2.4 Hash discipline

`hashAssistantActionPayload` strips `NON_EXECUTED_ACTION_FIELDS` so the approval covers exactly what
gets written. Any field the MCP layer adds for its own bookkeeping is presentation-only and **must**
join that list, or it will reproduce the 403-after-approval defect that hit five quick links on
2026-07-30.

### Phase 2 definition of done

- An end-to-end run against the live local stack: MCP proposal → approval sheet in the browser →
  retry → write lands → ledger row names **three** parties (external agent as author, the OAuth
  client as its identity, the approving human as approver).
- Declining, expiring, and retrying-before-approval all behave, and none of them writes.
- A tampered `requestState` is rejected.
- A second retry with the same `requestState` cannot double-spend.
- Guards G-4 and G-5 land, mutation-tested.

---

## Phase 3 — Tasks extension over model runs

`io.modelcontextprotocol/tasks`, polled via `tasks/get`. A model run occupies the worker for minutes
and currently has no agent-facing progress story — this is exactly what the extension is for, and
`launch_model_run` is already registered. Extensions are opt-in and negotiated per request, so this
adds nothing for clients that do not ask for it.

Not before Phase 2 is proven. Nothing in Phases 1–2 should be shaped around it.

## Phase 4 — Buzz

When Nathaniel judges the modules mature. By then it is configuration: a Buzz agent holds its own
keypair, authenticates as an OAuth client, and reaches the same MCP surface with the same refusals.
**OpenPlan must remain fully functional with no Buzz instance anywhere** — that condition is binding
and is not weakened by anything in this plan.

---

## Guards — the part that survives a handoff

Each fails the build. Each must be **mutation-tested**: revert the code it guards, run it, confirm it
fails for the *right reason*, restore by editing the string back (never `git checkout`). Report which
mutation produced which failure. A mutation that changes nothing means the guard proves nothing —
say so rather than claiming coverage.

| # | Guard | Mutation that must kill it |
|---|---|---|
| G-1 | Both transports resolve to one read implementation | Copy a read tool's body into the MCP layer instead of calling the shared function |
| G-2 | No module under the MCP surface may import the service-role Supabase client | Add the import |
| G-3 | No MCP tool may execute a write — every write path returns a proposal | Make one MCP tool call its target route directly |
| G-4 | The MCP tool surface derives from `ACTION_METADATA`: a registered action missing from MCP, or an MCP tool with no registry entry, fails | Add a hand-written MCP tool with no registry entry; separately, hide one registered action |
| G-5 | An `external_agent` ledger row must carry a verified client identifier — extend `planner-agent-is-a-distinct-principal.test.ts` | Write the row using the client's self-reported `clientInfo.name` |
| G-6 | `reachable-write-surface.ts` walks the MCP route, so the claim-tier guard sees it | Have something the MCP route can reach write a `claim_status` |

G-1 through G-3 ship with Phase 1. G-4 through G-6 ship with Phase 2.

---

## Verify-at-implementation register

Consolidated so none of these is silently assumed later. **None was verified on 2026-08-08.**

1. **Supabase OAuth 2.1 server on self-hosted Supabase — cloud only, or not?** Blocks 1.2 and decides
   the self-host auth story.
2. **mcp-handler 2.x route shape** — `[transport]` segment or a single static route. The chosen path
   becomes every agency's client config and the OAuth resource identifier; it is expensive to change.
3. **`mcp-handler@2.1.0` actually serves `2026-07-28` as advertised.** Confirmed from Vercel's
   changelog and npm peer deps only. Run it before building on it.
4. **`loadAssistantContext` callable from a workspace id alone** (no surface). Shapes step 1.1.
5. **Which MCP clients honour URL-mode elicitation today.** Phase 2's whole approval loop depends on
   the client presenting the URL and retrying. If a target client does not, the honest fallback is
   that the proposal appears in OpenPlan's pending-operations list and the tool says so — never a
   silent write.
6. **Next free migration number** at the time Phase 2 starts.

---

## What this plan must not turn into

From the ADR's refusals, repeated here because a plan is read more often than an ADR:

- **No MCP client direction.** OpenPlan must not consume external MCP servers. An external tool's
  output has no claim tier and no `[fact:id]`.
- **No sampling.** Deprecated, and it would produce content no principal in the ledger authored.
- **No MCP Apps** (rendering OpenPlan panels inside a chat client) until the read and propose lanes
  are proven — a `not_determined` badge is one of someone else's CSS decisions away from vanishing.
- **No direct execution of `safe`/`review` actions over MCP.** In-app those tiers show no dialog at
  all; over MCP that means nobody saw it *and* nobody is in the room. Whether
  `generate_report_artifact` may ever execute directly over MCP is its own decision with its own
  argument, taken separately.
