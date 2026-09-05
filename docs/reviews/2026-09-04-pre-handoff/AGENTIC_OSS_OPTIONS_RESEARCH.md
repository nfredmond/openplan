# Open-source options for platform-wide agent control

Research date: 2026-09-04/05 UTC. Read-only research for the OpenPlan technical review. Recommendations are engineering judgments, not implemented or acceptance-tested changes. Only this scratch report was written.

## Recommendation

Extend OpenPlan's existing AI SDK integration for API models. Add a small, durable Postgres assignment state machine around the existing job and worker services. Put planning operations behind one authenticated domain tool service that both the embedded agent and external clients can use. Add native CLI adapters using the T3 Code patterns already reviewed. Expose the same domain operations through MCP where client compatibility is proven.

Do not put another model reasoning loop around Codex, Claude Code or OpenCode's existing loop. The assignment coordinator should dispatch work, record progress, wait for approval or a job, resume, and report partial failure. It should not become a second competing agent.

LangGraph JS is the best shortlisted alternative when an actual assignment requires persistent branching and checkpoint replay beyond that bounded state machine. Reserve it as an executor implementation, not a second source of truth alongside OpenPlan's task records. A small interruption/recovery experiment should decide whether it earns that dependency. Do not adopt LangGraph, Mastra and CopilotKit's built-in agent together.

This recommendation keeps OpenPlan responsible for its planning semantics and uses existing libraries for model calls, transport and optional orchestration. A general agent workbench cannot decide whether a planner may publish a plan, revise a contract, open a scientific holdout or approve an invoice.

## Scope and evidence

Reviewed official repositories, current licenses, public GitHub commit metadata and targeted documentation for seven projects, plus the existing T3 and provider reports. No dependencies were installed, no agents or model requests were launched, and no accounts, browser sessions, app data or workers were touched. Current code was inspected only to confirm the package declarations: OpenPlan declares `ai: ^6.0.94` and `@ai-sdk/anthropic: ^3.0.46` in `openplan/package.json`. That is a declaration, not proof of the exact resolved runtime version.

The broader OpenPlan audit, not this library review, establishes defects in current authorization, approval consumption, audit truthfulness and worker recovery. The recommendations below require those defects to be repaired. This report does not compare the user's Buzz implementation; another review lane owns its actual code and identity.

### Pinned repository snapshot

These are observed main-branch commits, not recommended release versions. All seven repositories were non-archived at lookup. Recent commits establish activity, not quality or support guarantees. Dependency and transitive-license checks remain required for the exact packages eventually selected.

| Project | Commit observed | Commit date UTC | License evidence and boundary |
| --- | --- | --- | --- |
| Vercel AI SDK | `6359fd58fe68eaade096b5d923bac26de84ca3bd` | Sep 4, 21:36 | [Root LICENSE](https://github.com/vercel/ai/blob/6359fd58fe68eaade096b5d923bac26de84ca3bd/LICENSE) is Apache-2.0. GitHub's generic OTHER classification is not the license text. |
| LangGraph JS | `2fab6fda74714cd792fed24e5416cec66fdbc105` | Sep 4, 22:19 | [Root LICENSE](https://github.com/langchain-ai/langgraphjs/blob/2fab6fda74714cd792fed24e5416cec66fdbc105/LICENSE) is MIT. Optional hosted products have separate arrangements. |
| Mastra | `0c622712c3e62fb3108ec6090f2187df38666437` | Sep 4, 23:40 | [LICENSE.md](https://github.com/mastra-ai/mastra/blob/0c622712c3e62fb3108ec6090f2187df38666437/LICENSE.md) assigns Apache-2.0 outside `ee/` directories and other stated exclusions. All `ee/` directories use a separate license; third-party components retain their own. |
| CopilotKit | `428fcbd60dc7ae687c0273569670d520dc3b83e4` | Sep 4, 23:46 | [Root LICENSE](https://github.com/CopilotKit/CopilotKit/blob/428fcbd60dc7ae687c0273569670d520dc3b83e4/LICENSE) and [`packages/runtime/package.json`](https://github.com/CopilotKit/CopilotKit/blob/428fcbd60dc7ae687c0273569670d520dc3b83e4/packages/runtime/package.json) say MIT. Runtime and react-core packages inspected declare version 1.70.1 and MIT. Current marketing docs instead say Apache-2.0, an unresolved documentation inconsistency. |
| AG-UI | `54c155826620892610d6f9cc0d697d0c6f70ae7c` | Sep 4, 20:37 | [Root LICENSE](https://github.com/ag-ui-protocol/ag-ui/blob/54c155826620892610d6f9cc0d697d0c6f70ae7c/LICENSE) is MIT. |
| OpenHands | `fe09f319b0e66dbbcd2779e6b44c928d8516b44d` | Sep 4, 13:46 | [Root LICENSE](https://github.com/OpenHands/OpenHands/blob/fe09f319b0e66dbbcd2779e6b44c928d8516b44d/LICENSE) is MIT. Separate SDK, automation and runtime components need their own dependency audit if adopted. |
| MCP TypeScript SDK | `5119ee7fd7790e335a3fb60ef36f85334e2a6326` | Sep 3, 16:36 | [Root LICENSE](https://github.com/modelcontextprotocol/typescript-sdk/blob/5119ee7fd7790e335a3fb60ef36f85334e2a6326/LICENSE) describes transition from MIT to Apache-2.0, retaining MIT for unrelicensed earlier contributions; non-specification documentation is CC-BY-4.0. Do not label the entire snapshot simply MIT. |

T3 Code was previously inspected at `b906ce2d73d025e801877f42a35b7a2f5629806f`, with MIT root license. See `T3_CODE_REUSE_RESEARCH.md` for actual integration paths, tests sampled and limitations. This report did not re-clone it.

## What each option actually supplies

| Option | Fit for OpenPlan | Durable execution and approvals | Provider and native CLI fit | Decision |
| --- | --- | --- | --- | --- |
| Existing AI SDK core | Typed model calls, streaming and tool loop inside the current TypeScript app | Loop controls and tool approvals; OpenPlan must persist assignments and recover execution | Direct API provider adapters and compatible/custom providers. A coding CLI is a distinct execution backend, not automatically an AI SDK provider | Keep; expand deliberately |
| LangGraph JS | Explicit stateful orchestration for complex assignments | Persistent checkpoints and interrupts when a durable checkpointer is configured. Application side effects still need idempotency | Can call model adapters or delegate tasks to an external CLI service; does not supply native CLI subscription integration itself | Conditional replacement for a growing assignment executor |
| Mastra | Broad TypeScript framework covering agents, workflows, storage and server deployment | Persisted workflow suspension/resume and workers are documented; still requires application authorization and effect control | Broad model integration; native CLI bridge would remain separate | Credible alternative, too much duplicate machinery as an additive dependency |
| CopilotKit plus AG-UI | Chat, tool UI, shared frontend state and event interoperability | UI approval patterns and runner interfaces; durable storage choices exist but UI interaction does not establish permission | Can connect existing AG-UI agents, own backend or model router; native CLI requires a backend adapter | Consider UI components/protocol only after a concrete usability gap |
| OpenHands Agent Canvas | General developer agent control center | Agent/server/automation services, scheduled and event-triggered work; no proven OpenPlan approval or planning-job semantics | Current README includes OpenHands, Claude Code, Codex, Gemini and ACP-compatible agents | Optional external power-user client; don't adopt its whole product inside OpenPlan |
| T3 Code patterns | Installed CLI lifecycle, event normalization, approvals and reconnection | Useful implementation references, not OpenPlan's persistent planning authority | Actual Codex app-server, Claude Code executable/SDK and OpenCode server adapters already reviewed | Reuse the design selectively; preserve notices for copied code |
| MCP SDK | Shared tool/data interface to external agents | Protocol progress/cancellation and optional task extension; actual durable jobs and access control remain server responsibilities | Appropriate way for native clients and other agent apps to reach OpenPlan | Adopt a compatible, narrowly scoped tool server |

### AI SDK and version drift

The current [loop-control documentation](https://ai-sdk.dev/docs/agents/loop-control) supports bounded execution through stop conditions and per-step preparation. That saves custom model plumbing. It does not make a streamed request a recoverable background assignment.

Current public docs are on a newer v7 line: [tool execution approval](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling) deprecates `needsApproval` in favor of `toolApproval`. OpenPlan declares SDK 6. Do not copy the latest sample into that code or propose a broad upgrade as a prerequisite without checking the installed lockfile and corresponding versioned APIs.

Use explicit provider configuration. [Provider documentation](https://ai-sdk.dev/providers/ai-sdk-providers) includes direct providers and compatible/custom integrations. A supported endpoint does not establish that every model supports tools, structured output, images or the same streaming events. Record tested capabilities. Do not silently route through a hosted gateway or fall back to an API bill when a subscription CLI exhausts its quota.

### LangGraph JS versus a bounded assignment state machine

LangGraph's [interrupt documentation](https://docs.langchain.com/oss/javascript/langgraph/interrupts) describes persisted pause/resume tied to a thread and a checkpointer. On resume the interrupted node starts again. Writes before the interrupt may run twice unless the application separates or deduplicates them. Its [persistence documentation](https://docs.langchain.com/oss/javascript/langgraph/persistence) distinguishes in-memory examples from persistent database-backed checkpointing.

For the first OpenPlan assignment, persist a finite status, current step, immutable request, proposed action, approval reference, provider session reference, worker job reference and result or error. Keep the job queue responsible for execution leases and recovery. This is sufficient for a sequential task such as importing evidence, requesting approval, starting analysis and drafting a report. It avoids managing a graph checkpoint and a separate OpenPlan record that disagree about completion.

Select LangGraph if that real case grows into complex branching, several independently resumable steps or repeated custom checkpoint code. Then preserve the OpenPlan assignment as the public record and let LangGraph own executor checkpoints beneath it. No paid LangSmith service is needed merely to run the OSS graph with a configured local database. This is an architecture recommendation; no comparative prototype or crash test was performed.

### Mastra

Mastra documents [suspending and resuming workflows](https://mastra.ai/docs/workflows/suspend-and-resume), including snapshots in configured storage and resumption after process restart. Its [deployment guidance](https://mastra.ai/docs/deployment/overview) includes self-hosted servers and separate workers. It is a plausible choice for a new TypeScript agent service.

OpenPlan already has an app, authentication, storage, workers and AI SDK integration. Adding Mastra wholesale would create more integration and migration work than the initial task requires. If the simpler approach fails, compare Mastra against LangGraph as alternatives, with the exact non-enterprise package set pinned. Do not assume that self-hosting means all included enterprise code is freely reusable.

### CopilotKit and AG-UI

[AG-UI](https://docs.ag-ui.com/introduction) connects agents to frontends. MCP connects agents to tools and data. Neither replaces the other. CopilotKit's [human-in-the-loop guide](https://docs.copilotkit.ai/langgraph-fastapi/human-in-the-loop) distinguishes a model-selected interactive tool from a graph interrupt enforced in code. OpenPlan still needs a server-side decision about whether the original action may execute.

The current CopilotKit docs require care. The [OSS/Intelligence comparison](https://docs.copilotkit.ai/concepts/oss-vs-enterprise) advertises persistence as an Intelligence capability, but also says an application's own backend can provide it. The more specific [AgentRunner documentation](https://docs.copilotkit.ai/backend/agent-runner) documents a first-party SQLite runner, an in-memory default and a custom shared-store runner option. Therefore it would be wrong to claim that all durable OSS usage requires a paid platform. It would also be wrong to treat the default runner as crash-resilient. Current [runtime documentation](https://docs.copilotkit.ai/backend/copilot-runtime) exposes enough integration options to make version and storage ownership decisions necessary.

Consider a small UI component trial if OpenPlan's own conversation and approval interface is the bottleneck. Keep its current database as the record of planning work. Avoid introducing Kubernetes, Redis and a separate Intelligence service merely to show a progress card. The pinned MIT package evidence and conflicting Apache documentation should be recorded in any adoption decision.

### OpenHands and native clients

The current [OpenHands README](https://github.com/OpenHands/OpenHands/blob/fe09f319b0e66dbbcd2779e6b44c928d8516b44d/README.md) describes Agent Canvas, a general agent control center with native coding agents and ACP support. It separates the agent runtime, TypeScript client and automation services. An older comparison treating this repository only as a Python coding-agent monolith would be stale.

Agent Canvas may be useful as an optional external application connected to OpenPlan tools. Embedding a second developer workspace would add installations, service supervision, security boundaries and a second interaction model. Its broad filesystem/code execution capabilities do not automatically fit public planning records. T3's smaller integration patterns are the closer reference for the requested installed CLI choice, although its own permissive approval defaults must not become OpenPlan defaults.

A hosted OpenPlan page cannot execute a visitor's installed CLI without a paired local runner. Provider login and credentials should remain with the native installed application. Subscription eligibility and permitted deployment arrangements are provider-specific, not a universal right conferred by an OSS wrapper. See `PLANNER_AGENT_PROVIDER_RESEARCH.md` for the separately verified official requirements.

### MCP revision and compatibility

The current [MCP specification is dated 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28), with stateless requests and optional extensions including tasks. Pin the SDK and prove compatibility against actual clients; do not assume older clients support a newly documented task extension. OpenPlan should expose ordinary job status operations even when that extension is unavailable. MCP does not implement the underlying planning job, tenancy boundary or approval ledger.

## Bounded implementation experiment and decision gates

After the development handoff and separate implementation authorization, use one consequential workflow across modules, not a generic chatbot demo: intake a source, create a draft plan section, propose a linked task, wait for human approval, start a worker operation and report the resulting artifact with provenance. The exact pilot belongs in the whole-product roadmap.

Verify the same tool service with an API model and one supported native CLI. Use recorded/offline protocol fixtures first; live calls require the user's available provider capacity and must not silently spend money. Verify process interruption before and after a domain mutation, duplicate delivery, expired or changed approval, cancellation during a worker wait, provider disconnect/quota exhaustion, and a truthful partial result. Failed execution must never become a successful audit entry. Include a harmless mutation that survives and consequential mutations the guards reject.

Choose the simple executor if these checks pass without a growing collection of special cases. Choose LangGraph only if the experiment demonstrates a specific persistence or branching requirement it addresses more cleanly. In either case, keep browser sessions and transient streaming requests separate from durable work.

Operating costs remain real even with free libraries: model usage or native subscription quota, local worker memory and CPU, checkpoint/event storage, backups, dependency upgrades and provider protocol changes. Set retention and concurrency limits, redact sensitive event payloads, and measure the pilot rather than inventing performance estimates. None of the frameworks was benchmarked or independently crash-tested in this research.
