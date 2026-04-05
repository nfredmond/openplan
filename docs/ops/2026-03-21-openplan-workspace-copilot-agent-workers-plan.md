# OpenPlan Workspace Copilot + Agent Workers — Architecture and Packaging Plan

**Date:** 2026-03-21  
**Owner:** Elena Marquez (Principal Planner)  
**Status:** proposed packaging / architecture memo  
**Scope:** docs-only product architecture recommendation for OpenPlan AI + automation packaging  

## Grounding
This recommendation is grounded in:
- `memory/2026-02-24-planning-saas.md`
- `memory/2026-03-13.md`
- `docs/ops/2026-03-13-openplan-option-c-reset-directive.md`
- `docs/ops/2026-03-15-openplan-v1-command-board.md`
- `docs/ADRs/ADR-002-multi-engine-modeling-stack.md`
- `docs/ops/2026-03-17-openplan-modeling-stack-technical-spec.md`
- `docs/ops/2026-03-18-p1b2-aequilibrae-worker-prototype.md`
- 2026-03-21 assistant-lane and modeling-lane support notes in active worktrees
- current OpenClaw browser-control reality: Browser Relay is useful but user-attached, operationally flaky at times, and should not be treated as the default commercial control plane for customer deployments

---

## 1. Executive recommendation

OpenPlan should productize AI and automation as **Workspace Copilot + Agent Workers** inside the Planning OS, **not** as a default per-customer root-ish OpenClaw install controlling customer machines or the shared production app.

### Recommended default posture
- **Primary product:** multi-tenant SaaS on OpenPlan
- **AI surface:** a **module-aware workspace copilot** anchored to current OpenPlan records, workflows, and permissions
- **Automation surface:** **bounded agent workers** for long-running or asynchronous jobs such as modeling, data refresh, classification, packaging, and report generation
- **Enterprise exception:** optional **local companion / node** only where a customer truly needs inside-network data access, local file access, or customer-browser-of-record automation

### Core product boundary
OpenPlan remains the **canonical planning/data/orchestration layer**.  
Workers execute bounded jobs.  
Any local node is an **optional enterprise extension**, not the baseline architecture.

This is the safest path commercially, technically, and politically.

---

## 2. Why this is safer and more sellable than per-customer root-ish OpenClaw

### Safer
1. **Clear trust boundary**
   - Customer data stays inside the OpenPlan workspace, database, storage, and audited worker flows.
   - We avoid making “remote machine control” the default value proposition.

2. **Least-privilege by design**
   - Workspace Copilot acts on supported OpenPlan objects and routes.
   - Agent Workers handle explicit job classes with known inputs/outputs.
   - No default shell/root posture on customer endpoints.

3. **Better tenant isolation**
   - A shared SaaS app with workspace-scoped permissions is easier to secure and explain than many semi-managed machine agents.

4. **Easier auditability**
   - OpenPlan already wants artifacts, run manifests, report traceability, and evidence packets.
   - That fits a bounded worker model far better than free-form machine automation.

5. **Lower support risk**
   - Troubleshooting a Vercel/Supabase/worker stack is supportable.
   - Troubleshooting arbitrary customer desktops, networks, permissions, browsers, and security software is expensive and hard to standardize.

### More sellable
1. **Procurement-friendly**
   - Agencies, tribes, and consultants can buy “secure planning SaaS with AI copilots and managed workers.”
   - They are much less likely to buy “agent software with broad machine control.”

2. **Matches the Planning OS thesis**
   - Current OpenPlan direction is a modular Planning OS with Projects, Plans, Programs, Engagement, Analysis Studio, Scenarios, Models, Data Hub, Reports, and Admin.
   - A workspace copilot fits that posture directly.

3. **Supports honest commercialization now**
   - Current assistant direction already favors a constrained action router over existing modules, not a generic autonomous chat shell.
   - Current modeling direction already favors bounded workers outside the web app path.

4. **Leaves room for enterprise upsell later**
   - Customers with internal-network or local-browser needs can buy an enterprise hybrid layer without forcing every customer into that complexity.

---

## 3. Product definition

### Workspace Copilot
A planner-facing assistant embedded in OpenPlan that:
- understands current workspace and module context
- drafts and updates supported records
- launches supported workflows
- explains readiness gaps and evidence posture
- asks for confirmation before consequential writes

This should begin as a **constrained action router + confirmation UX + module-aware prompt contract**, not a generic chat shell.

### Agent Workers
Bounded execution services that run:
- AequilibraE / later ActivitySim and related model jobs
- dataset refresh and provenance jobs
- report generation / packaging jobs
- engagement classification or summarization jobs
- artifact postprocessing and QA jobs

Workers should communicate through explicit job records, stages, artifacts, and manifests.

### Optional Local Companion / Node
An enterprise-only extension for:
- internal network data access
- file-share or local database access
- customer-browser-of-record tasks where APIs do not exist
- local heavy compute or customer-hosted modeling lanes

This should be opt-in, explicitly approved, and tightly bounded.

---

## 4. Three-phase packaging plan

## Phase 1 — Standard SaaS tier
**Positioning:** “AI-assisted Planning OS for day-to-day planning work.”

### What is included
- OpenPlan multi-tenant web app
- Workspace Copilot for supported module actions
- cloud Agent Workers for OpenPlan-native async jobs
- initial managed modeling lane using bounded worker execution
- report, artifact, and evidence continuity

### Best-fit use cases
- create and maintain projects, plans, programs, and engagement records
- launch analysis and managed runs from inside OpenPlan
- generate structured handoff/report artifacts
- run workspace-scoped data refresh and classification jobs

### Deployment topology
- **Frontend / API:** Vercel
- **Auth / relational data / storage:** Supabase
- **Async worker runtime:** Railway, Fly.io, or equivalent container worker
- **Queue posture:** database-backed staged jobs / polling first, then optional broker later
- **No local customer agent by default**

### Security / permission model
- workspace-scoped auth and row-level access
- module-aware permissions by role
- confirmation required for consequential writes
- audit log for copilot actions and worker actions
- artifact provenance stored with runs/reports where applicable
- no browser/device control promise in the standard tier

### Commercial posture
This is the default product and should carry the main go-to-market message.

---

## Phase 2 — Pro Automation tier
**Positioning:** “OpenPlan with advanced workflow automation and managed job orchestration.”

### What is added
- scheduled automation jobs
- richer data connector refreshes and provenance monitoring
- advanced report packaging and readiness checks
- expanded modeling orchestration and longer-running worker pipelines
- module-specific copilots for engagement, reporting, and model operations
- admin controls for workspace automation policies and approvals

### What this is not
- not default machine control
- not broad unattended browser RPA as a core promise
- not autonomous policy/compliance authority

### Deployment topology
- **Frontend / API:** Vercel
- **Data / storage / auth:** Supabase
- **Worker layer:** dedicated container workers with clearer queue separation
- **Scheduler / orchestration:** container cron / managed scheduler / job service
- **Optional isolated browser runner:** only for tightly defined approved tasks, if later justified

### Security / permission model
- workspace-scoped secrets and connector credentials
- approval gates for high-impact actions
- run manifests, job identity, and retry history
- stricter automation policy controls per workspace
- explicit allowlists for any non-API automation

### Commercial posture
Sell this as **automation inside the Planning OS**, not “agent takeover.”  
The value is saved staff time, continuity, and evidence quality.

---

## Phase 3 — Enterprise Local-Agent tier
**Positioning:** “Secure hybrid deployment for customers with internal systems, local data, or controlled browser-of-record needs.”

### What is added
- optional local companion / node deployed in the customer environment
- outbound-secure connection back to OpenPlan control plane
- local data-access jobs against customer-approved systems
- optional local modeling or file-processing workers
- optional user-attached browser automation where APIs are unavailable

### Appropriate use cases
- internal file shares or GIS stores not exposed to public cloud
- customer databases or line-of-business systems inside VPN/private network
- local or sovereign deployment requirements
- controlled browser tasks that must occur in the customer’s own authenticated browser context

### Deployment topology
- **Control plane:** OpenPlan SaaS or enterprise-hosted OpenPlan stack
- **Core app:** Vercel + Supabase in standard cloud deployments, or enterprise-managed equivalents if needed
- **Local companion / node:** customer VM, desktop, or lightweight server
- **Local workers:** containerized jobs on the customer side when required
- **Browser connection:** user-attached / explicitly approved relay posture only where justified

### Security / permission model
- no root/admin by default
- explicit node enrollment and machine identity
- outbound-only connection preference
- signed/allowlisted job classes only
- workspace-to-node scoping
- customer-admin approval for local capabilities
- strong audit trail for file, browser, and local-job actions
- visible user approval for browser-attached flows
- kill switch / revoke path

### Commercial posture
This is an **enterprise add-on**, not the default product story.

---

## 5. Deployment topology summary by phase

| Phase | Web/App | Data/Auth | Worker Runtime | Local Companion | Browser-Control Posture |
|---|---|---|---|---|---|
| Phase 1 — Standard SaaS | Vercel | Supabase | Shared cloud worker container | No | None promised as product baseline |
| Phase 2 — Pro Automation | Vercel | Supabase | Dedicated worker pool + scheduler | Optional only if justified later | Limited, allowlisted, approval-based if ever exposed |
| Phase 3 — Enterprise Local-Agent | Vercel or enterprise-hosted equivalent | Supabase or enterprise-managed equivalent | Cloud + optional local workers | Yes, opt-in | User-attached / approved local browser relay only |

---

## 6. Security and permission model by phase

## Phase 1
- user and role scoped to workspace
- copilot can act only on supported module routes
- confirmation before consequential writes
- worker jobs tied to explicit run/action records
- no customer endpoint control

### Phase 2
- Phase 1 controls plus:
- per-workspace automation policy
- connector secret isolation
- action approvals for sensitive automation
- queue/job observability and retry controls
- explicit unsupported-capability responses from assistant

## Phase 3
- Phase 2 controls plus:
- node registration and trust policy
- local capability allowlists
- admin-approved scopes for file, data, browser, and local-compute access
- stronger revocation, heartbeat, and audit controls
- no silent cross-tenant or cross-workspace local access

---

## 7. Honest constraints and what should **not** be built yet

### Do not build yet
1. **Do not make per-customer root-ish OpenClaw the default commercial architecture.**
2. **Do not make the assistant a generic autonomous chat shell first.**
3. **Do not promise broad browser automation as a standard feature.**
4. **Do not couple the shared production app directly to arbitrary customer machine control.**
5. **Do not overstate modeling maturity.**
   - AequilibraE worker posture is still early/prototype.
   - ActivitySim and broader multi-engine orchestration are still under active build.
6. **Do not jump to microservices sprawl prematurely.**
   - Modular monolith + bounded workers remains the right near-term architecture.
7. **Do not market legal/compliance certainty or autonomous planning judgment.**

### Current practical constraints
- Browser Relay / attached-browser control is real, but operationally user-attached and not yet stable enough to be the center of the core product promise.
- Current assistant lane evidence strongly supports constrained module actions, confirmations, and truthful refusal behavior.
- Current modeling lane supports worker-oriented packaging direction, but not a mature all-purpose enterprise modeling cloud yet.

---

## 8. Suggested packaging and positioning language

### Product line
- **OpenPlan Standard** — Planning OS + Workspace Copilot
- **OpenPlan Pro Automation** — Planning OS + advanced workflow automation + managed workers
- **OpenPlan Enterprise Hybrid** — Planning OS + secure local companion for internal systems and controlled local execution

### Short positioning statement
OpenPlan combines a modular Planning OS, a workspace-aware copilot, and bounded agent workers to help planning teams organize records, run analysis, package evidence, and keep work auditable across the planning lifecycle.

### Safer sales language
- “AI-assisted planning operations”
- “workspace-aware copilot”
- “managed worker execution”
- “auditable automation”
- “human approval at critical actions”
- “secure hybrid option for internal systems”

### Language to avoid
- “full autonomous planner”
- “remote computer control for every customer”
- “self-driving planning department”
- “agent with unrestricted machine access”
- “fully automated compliance”

### Recommended elevator framing
> OpenPlan is a Planning OS with an embedded workspace copilot and bounded agent workers. The core product helps agencies and consultants manage projects, engagement, analysis, reporting, and model operations in one auditable system. For customers with stricter internal-system needs, OpenPlan can add a secure local companion as an enterprise hybrid extension rather than making local machine control the default.

---

## 9. Immediate next implementation steps that do not conflict with current work

These steps stay aligned with the current four-lane push and should not step on active builders.

1. **Adopt this product boundary explicitly in packaging docs and internal positioning.**
   - Standard = SaaS copilot + cloud workers
   - Enterprise = optional local companion

2. **Carry the assistant action-contract posture into the mainline product spec after Lane D merges.**
   - constrained action router
   - module-aware context
   - confirmation UX
   - truthful unsupported-capability handling

3. **Keep the worker architecture bounded and boring at first.**
   - continue staged jobs, artifacts, manifests, and cloud workers
   - avoid premature expansion into free-form agent execution

4. **Draft a workspace automation policy matrix.**
   - who can run what
   - which actions need approval
   - which jobs are cloud-only vs enterprise-local

5. **Draft an enterprise local-companion ADR before building it.**
   - enrollment
   - identity
   - allowed job classes
   - browser/file/data boundaries
   - revoke path

6. **Prepare packaging/pricing copy tied to the three tiers.**
   - no engineering dependency
   - useful for sales and website planning once current build lanes stabilize

7. **Do not interrupt the four active build worktrees to chase local-agent engineering now.**
   - finish the current engagement, modeling, LAPM/PM, and assistant slices first
   - then unify packaging around what is real

---

## 10. Bottom line

The right product is **OpenPlan as the Planning OS**, with:
- a **workspace-aware copilot** in the app,
- **bounded cloud agent workers** for asynchronous execution,
- and an **optional enterprise local companion** only where customer constraints justify it.

That is safer, easier to procure, easier to support, and more consistent with the current OpenPlan architecture than making per-customer root-ish OpenClaw control the default commercial model.
