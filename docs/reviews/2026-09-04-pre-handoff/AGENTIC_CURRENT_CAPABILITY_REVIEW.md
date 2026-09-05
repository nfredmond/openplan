# Current Planner Agent capability review

Reviewed 2026-09-04 at active checkout `/home/nathaniel/code/openplan`, HEAD `e6900750e0472260b9a7ce774609ade774659f58`, commit timestamp `2026-09-04T17:18:27-07:00`, subject `Make saved plan content editable`. Source references below are relative to the repository root. This is a bounded source review, not live capability certification.

The Planner Agent already has useful context retrieval, a bounded model/tool loop, structured proposals, human approval, and twelve executable actions. It does not yet provide durable control of planning workflows across sessions, worker waits, failures and multiple modules. Extend the existing components. Before increasing autonomy, repair execution-outcome integrity and recovery; otherwise a larger agent inherits misleading success records and ambiguous retries.

## Current capability

| Layer | Source evidence | Practical limit |
| --- | --- | --- |
| Deterministic assistant | `openplan/src/app/api/assistant/route.ts:17-131` authenticates, loads context, selects a catalog workflow and builds a response. | Useful context/navigation assistance without a model; no independent planning or execution. |
| Model conversation | `openplan/src/app/api/assistant/chat/route.ts:29-54,114-217` accepts recent history, uses Anthropic access and streams a bounded tool loop. | Browser-supplied text history. Provider-specific route. A configurable model identifier is not backend interchangeability or proof that the provider currently serves it. |
| Evidence reads | `openplan/src/lib/assistant/chat-tools.ts:1425-1430,1698-1715` combines twelve named read tools with proposal tools. | User-scoped reads with bounded lists and excerpts, not complete workspace knowledge. |
| Proposed actions | `openplan/src/lib/assistant/chat-tools.ts:377` onward builds registry-backed proposals with schema and workspace reference checks. | Returns proposed payloads, not writes. Reference existence does not establish every role or action prerequisite. |
| Approved execution | `openplan/src/components/assistant/app-copilot.tsx:2056-2094`; `openplan/src/lib/runtime/action-registry.ts:355-398`. | Real API effects, dispatched in the browser after approval. Common effects check HTTP success but do not return an authoritative result identifier to the agent. |
| Persistent action evidence | Approval/execution tables and `openplan/src/app/(app)/assistant-activity/page.tsx:18,101-194`. | Last 50 execution rows; not a durable conversation, plan, step queue, approval wait or retry coordinator. Integrity gaps below. |
| Multistep behavior | Six-step chat bound; registry preview refresh and bounded post-action prompting at `openplan/src/lib/runtime/action-registry.ts:329-398`. | Request-local reasoning plus browser continuation. No durable agent-run orchestrator found in the sampled runtime, routes and migrations. |

The twelve reads are `search_knowledge_base`, `get_surface_context`, `list_projects`, `list_funding_opportunities`, `list_reports`, `list_pending_operations`, `get_grant_program_catalog`, `get_model_run_results`, `explain_model_claim`, `search_grants_gov`, `list_workspace_records`, and `get_engagement_responses`. Static grant references explicitly require jurisdiction and current-cycle verification. Engagement reads deliberately limit comments and avoid individual survey answers. These restrictions must remain visible.

`openplan/src/lib/runtime/action-metadata.ts:20-146` defines this write coverage:

| Action | Permitted scope | Tier |
| --- | --- | --- |
| `generate_report_artifact` | Existing report artifact generation | Safe |
| `create_rtp_packet_record` | Create RTP packet record | Review |
| `create_funding_opportunity` | Create opportunity record | Approval required |
| `create_project_funding_profile` | Create profile anchor, not invent amounts | Approval required |
| `update_funding_opportunity_decision` | Update opportunity decision | Approval required |
| `link_billing_invoice_funding_award` | Link invoice and award | Approval required |
| `record_stage_gate_hold` | HOLD, never PASS | Approval required |
| `create_project_record` | Project subrecord, not general project administration | Approval required |
| `refresh_gtfs_feed` | Refetch existing feed's stored URL | Approval required |
| `create_survey_question_draft` | Unpublished question draft | Approval required |
| `create_rtp_horizon_bands_from_cycle_horizon` | Derived periods for eligible empty cycle | Approval required |
| `launch_model_run` | Requeue existing configured eligible run; no engine/study-area/configuration changes | Approval required |

Report/document revision, contract task/staff/budget administration, sponsor reporting, procurement submissions and other domain writes need explicit coverage decisions. A registry entry alone would not make a complete workflow usable or safe.

## Source trace: approve and record a stage-gate HOLD

1. Chat creates a structured proposal through registry-backed schemas and workspace reference checks in `openplan/src/lib/assistant/chat-tools.ts:377` onward. No model write tool executes it.
2. The planner selects the proposal. `openplan/src/components/assistant/app-copilot.tsx:1581-1589,2056-2094` requests explicit approval, then asks the approval endpoint for evidence with `requireApproval: true`.
3. `openplan/src/app/api/assistant/actions/approvals/route.ts:34-100` verifies user and supplied workspace membership, rejects read-only membership, hashes the action and persists expiring approval evidence. Domain authority remains the target route's responsibility.
4. The client registry sends the registered payload and execution-source, input-hash and approval-id headers. Common request helpers are at `openplan/src/lib/runtime/action-registry.ts:36-64`.
5. `openplan/src/app/api/stage-gates/decisions/route.ts:262-325` rejects widened agent payloads and agent PASS requests. Lines 327-375 enforce authentication, membership and decision-write role. Subsequent code checks project, template/gate and citation context. Lines 555-584 reconstruct the narrow action from server-parsed fields and invoke approval verification.
6. `openplan/src/lib/assistant/action-approval-server.ts:293-367` verifies hash, user, workspace, action, expiry and unused approval. Its conditional update at lines 343-361 permits one consumer of that approval row.
7. The insert at `openplan/src/app/api/stage-gates/decisions/route.ts:594-643` includes decision, rationale, template/citation context, deciding user and agent authorship. The audit wrapper runs at lines 648-665. The database error is checked only at line 667.
8. Client execution completion precedes preview refresh. Refresh failure can therefore occur after a successful write.

This is a source trace. No request or database operation was exercised.

## Prerequisites for platform-wide agent control

### 1. Correct authoritative outcomes and audit promises

A concrete source defect exists in the HOLD path. The insert resolves to a Supabase `{data,error}` result. `withAssistantActionAudit` treats any resolved promise as success and persists `outcome: "succeeded"`. Only afterward does the route inspect the database error and return failure. See `openplan/src/lib/observability/action-audit.ts:162-196` and `openplan/src/app/api/stage-gates/decisions/route.ts:648-674`.

Audit insertion failure is also warning-only; the original business result returns. A compatibility fallback can write without authorship columns and warn, at `openplan/src/lib/observability/action-audit.ts:86-105`. The chat's unconditional “The change is recorded in the action log” at `openplan/src/components/assistant/app-copilot.tsx:680` and the activity page's “Every execution writes one audit row” exceed the mechanism's guarantee.

Require typed authoritative effect results, including committed, rejected and unknown states. A fulfilled database error must never become success. Establish recoverable audit receipts, transactionally recorded with the effect where feasible. Preserve historical uncertainty instead of rewriting old rows into assumed outcomes.

### 2. Recover effects separately from approval and refresh

Approval consumption, domain write and execution log are separate operations. A crash after consumption can leave no effect; a lost response after commit can leave an unknown result. Single-use approval is not effect idempotency across a newly approved retry. The HOLD trace and `openplan/src/lib/assistant/action-approval-server.ts:343-361` show this separation.

The registry calls `onCompleted` before refresh. A refresh exception reaches the chat catch and changes an executed proposal to failed. See `openplan/src/lib/runtime/action-registry.ts:368-376` and `openplan/src/components/assistant/app-copilot.tsx:2070-2094`.

Require stable operation/attempt IDs, result receipts with record IDs and versions, reconciliation after response loss and separate effect/refresh status. Add stale-target preconditions; approval of a payload is not approval of a materially changed planning context.

### 3. Retain explicit chat consent consistently

All chat proposals request approval with `requireApproval: true`; the endpoint can mint a row for safe/review actions. Yet the verifier exits early for those tiers, ignores approval evidence and records no approver. See `openplan/src/app/api/assistant/actions/approvals/route.ts:77-100` and `openplan/src/lib/assistant/action-approval-server.ts:278-290`.

This does not establish an unauthorized write: those tiers permit execution without separate approval. It means chat's actual human approval is not retained as verified consent. Define a consistent contract for optional explicit approval and preserve it when supplied.

### 4. Add durable orchestration and verifiable delegation

Messages, operation history and pending approval are component state at `openplan/src/components/assistant/app-copilot.tsx:1445-1452`. The history builder at line 104 sends recent text, not an authoritative persisted plan with evidence and effect receipts. Sampled migrations contain approvals/executions; searches for agent runs, chat sessions/messages, conversations and workflow runs found no matching definitions. API inventory exposed deterministic responses, context, chat and approvals, with no MCP endpoint found in that route inventory.

Extend the existing registry with durable runs/steps, approval waits, worker waits, cancellation, resumable attempts, blocked/unknown states and visible evidence/results. Long model jobs remain worker jobs. Queue acceptance must not become completion or scientific validation.

`openplan/src/lib/assistant/agent-principal.ts:1-24` explicitly says current attribution derives from a header under a user's session, not independently authenticated agent credentials. Missing execution-source headers select manual authorship at `openplan/src/lib/assistant/action-approval-server.ts:225-228,272-274`. This is not anonymous authentication bypass. A future agent entrusted with general authenticated API access needs verifiable delegated identity, revocable scope, current-role checks and attribution it cannot remove by choosing another transport.

### 5. Govern expansion of reads and refused actions

Several lists cap results without query/pagination inputs: `openplan/src/lib/assistant/chat-tools.ts:1270-1305,1510-1547`. Older records can be missing from discovery. Model and engagement evidence are sampled at lines 739-827 and 1313-1397. Require scoped search/pagination, source IDs/versions, freshness and coverage gaps. Unreturned records must not become evidence of absence.

Refusal tests intentionally exclude portfolio imports, evidence bundles and aerial operations, among other writes. See `openplan/src/test/refused-project-portfolio-import-action.test.ts`, `refused-project-evidence-bundle-action.test.ts` and `refused-aerial-actions-stay-refused.test.ts`. These are current design boundaries, not proof that every such workflow must remain permanently manual. Extend existing workflows through previews, narrow payloads and explicit approvals. Do not delete refusal guards to inflate coverage. Publication, adoption, external submission, money movement, raw evidence changes and scientific claim promotion each need an authority decision.

### 6. Enforce budgets and preserve semantic tool status

The rate check counts completed usage rows; query errors fail open and metering is best effort. Concurrent requests can pass before completed usage arrives. The cost warning occurs after consumption. See `openplan/src/lib/runtime/ai-rate-limit.ts:83-105,110-148` and `openplan/src/app/api/assistant/chat/route.ts:193-217`. These throttles are not hard spending ceilings. Unattended execution needs admission/reservation controls, concurrency limits, per-run/operator caps and cancellation.

The tool wrapper records `ok: true` for returned payloads, including returned refusal/error states, while budget refusals return before ledger insertion. See `openplan/src/lib/assistant/chat-tools.ts:165-213`. Transport completion, semantic outcome and coverage must remain distinct in telemetry.

## Verification required

Read test sources, including chat tools/route, approval verification, HOLD/PASS behavior, action audit, registry route coverage and selected refusals. None ran. HOLD tests exercise hashes, single-use approvals, authorship, widened-body refusal and registry-to-route dispatch with mocked dependencies. They do not establish live RLS, usable approvals, recovery or deployment behavior.

`openplan/src/test/every-action-route-verifies-its-own-approval.test.ts:45-85` checks actual verifier/audit calls after stripping comments. It detects missing calls but not ordering, every branch, durable logging or semantic write outcomes. The resolved-database-error defect can coexist with this guard.

The first agent milestone should require:

- Fulfilled database errors never record success; audit-write failure has visible recoverable status. A no-op mutation survives and the wrong-success regression fails.
- A committed write followed by refresh failure remains committed. Inject failures before/after approval consumption, commit and receipt persistence; response loss and retry must not duplicate effects.
- Exact payload, current authority and target version remain bound to approval. Concurrent consumption has one winner. Optional chat consent remains traceable.
- Omitting headers or choosing another route cannot evade delegated scope or claim manual authorship. Test role revocation and cross-workspace references at execution.
- Browser closure and orchestrator restart preserve plans, approvals and worker waits. Cancellation prevents new steps and names already committed effects.
- Incomplete retrieval prevents a complete-read claim. Refusals and errors remain negative evidence.
- Concurrent requests cannot exceed admission budgets unnoticed; provider/metering outages preserve blocked or unknown states.

Then require identified-checkout desktop and narrow-screen browser journeys. A planner must approve HOLD, reject another proposal, inspect exactly what changed and who approved it, resume interrupted work and distinguish queued modeling from scientifically supported completion. The planner should explain scope, evidence gaps, next approval and recovery status without reading code. No human validation was performed here.

## Sampling limits

Read current instructions and the shared operating manual. Fully read action metadata/registry, chat route, approval route/verifier, principal definition, audit wrapper and rate limiter. Sampled larger chat-tool, copilot, context and stage-gate implementations plus related tests/migrations. Reviewed activity and deterministic assistant routes. This was not an exhaustive audit of every action endpoint, RLS policy, UI entry point, provider adapter or worker. No model API validity, hosting behavior, browser usability, tests or runtime identity was verified. Only this scratch report was written; no checkout or existing report changed.
