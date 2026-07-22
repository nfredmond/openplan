# OpenPlan Engagement + Stakeholder Operations Implementation Roadmap

Date: 2026-04-14  
Owner: Nathaniel Ford Redmond  
Drafted by: Claire Donovan  
Status: Planning roadmap only, not approved for execution

## Purpose

Translate the engagement + SRM unified-platform strategy into a practical implementation roadmap with epics, build slices, sequencing, dependencies, and acceptance criteria.

This roadmap assumes the guiding rule:

**Expand OpenPlan additively. Do not discard or destabilize the current Planning OS spine.**

---

# 1. Implementation goals

## Primary goals
- deepen OpenPlan's engagement capability,
- turn projects into a real operational control room,
- add stakeholder continuity and follow-up management,
- unify outputs into reports/evidence,
- prepare for later operations-copilot workflows.

## Non-goals
- no full product rewrite,
- no immediate generic CRM build,
- no generic PM tool duplication,
- no premature AI-heavy architecture before record integrity,
- no external positioning beyond current supervised-pilot proof boundary.

---

# 2. Workstream structure

## Workstream A
Architecture preservation and domain normalization

## Workstream B
Engagement V2, planning-grade participation layer

## Workstream C
Project Control Room

## Workstream D
Stakeholder Operations V1

## Workstream E
Reports, exports, evidence, and response outputs

## Workstream F
Operations summary, action center, and AI assist

---

# 3. Workstream A: architecture preservation and domain normalization

## Objective
Create the guardrails needed to expand safely.

## Why first
Without normalization, later work will likely create duplicate models for contributions, stakeholders, tasks, and summaries.

## Epic A1: Canonical domain registry

### Outcome
A written object-ownership map for the OpenPlan domain.

### Scope
- identify canonical objects in current repo,
- identify overlapping concepts,
- assign source-of-truth ownership,
- define which objects may be extended vs wrapped vs replaced later.

### Deliverables
- canonical domain registry doc,
- source-of-truth matrix,
- naming guidelines,
- migration policy.

### Acceptance criteria
- every planned object has a declared owner,
- no new domain object is introduced without anchor/dependency definitions.

## Epic A2: Shared evidence and audit conventions

### Outcome
A consistent event/audit/provenance posture across new modules.

### Scope
- audit event naming,
- timeline event model,
- provenance field standards,
- export job conventions,
- AI annotation boundaries.

### Acceptance criteria
- new engagement/SRM features can write to shared evidence conventions,
- no incompatible event schemes are introduced.

## Epic A3: Engagement schema evolution plan

### Outcome
A compatibility-safe path from current engagement tables to richer participation architecture.

### Scope
- assess whether `engagement_items` remains canonical short-term,
- define service abstraction for contributions,
- define when new tables are required,
- define backfill/adapter strategy.

### Acceptance criteria
- no premature migration churn,
- current engagement surfaces remain stable while new participation capabilities are added.

---

# 4. Workstream B: Engagement V2, planning-grade participation layer

## Objective
Expand current engagement from basic campaign intake into a richer planning/public participation system.

## Dependencies
- Workstream A domain guardrails

## Epic B1: Campaign staging and lifecycle

### Outcome
Campaigns support explicit participation phases.

### Scope
- add stage model,
- add open/close windows,
- allow stage descriptions/goals,
- support stage-specific tool visibility,
- support report-back stage.

### Build slices
1. stage schema and API
2. stage-aware campaign detail UI
3. public page stage rendering
4. close/report-back controls

### Acceptance criteria
- a campaign can run in named phases,
- users can tell what is open now and what happened before.

## Epic B2: Tool instance model

### Outcome
Campaigns support multiple participation methods without fragmented architecture.

### Scope
- tool instance model linked to campaign/stage,
- first supported tool types:
  - comment collection,
  - quick poll,
  - map feedback,
  - form/survey,
  - Q&A.

### Build slices
1. tool-instance schema
2. campaign page tool renderer
3. public input handling per tool type
4. moderation compatibility layer

### Acceptance criteria
- multiple tool types can live under one campaign,
- reporting and moderation remain unified.

## Epic B3: Public campaign/page upgrade

### Outcome
Public participation pages become clearer and more trustworthy.

### Scope
- better project context,
- instructions and participation purpose,
- stage visibility,
- approved public items,
- submission expectations,
- submission closed/report-back state.

### Acceptance criteria
- public users understand what the page is for,
- project context is not lost,
- the page feels like a planning-grade participation surface.

## Epic B4: Moderation center improvements

### Outcome
Staff can review, classify, and publish input more cleanly.

### Scope
- queue views,
- moderation states,
- flag/redact/reject controls,
- category and tool filters,
- audit history,
- public/private visibility settings.

### Acceptance criteria
- moderation is explicit and auditable,
- comments do not disappear into opaque workflow.

## Epic B5: Public reporting-back outputs

### Outcome
Campaigns support “what we heard / what changed / next steps.”

### Scope
- report-back content blocks,
- campaign summary metrics,
- downloadable summary output,
- report linkage,
- public summary publishing state.

### Acceptance criteria
- a campaign can close with a public-facing outcome artifact,
- internal and public outputs remain distinct.

## Epic B6: AI-assisted engagement analysis v0

### Outcome
AI accelerates synthesis without becoming the record of truth.

### Scope
- topic suggestions,
- sentiment suggestions,
- summary drafts,
- PII detection,
- annotation storage with provenance.

### Acceptance criteria
- AI outputs are reviewable,
- source items remain visible,
- no auto-published AI summaries.

---

# 5. Workstream C: Project Control Room

## Objective
Make projects the operational hub for planning work.

## Dependencies
- current projects module
- Workstream A conventions
- Workstream B engagement outputs

## Epic C1: Project control summary aggregate

### Outcome
One stable summary model for project operations.

### Scope
- milestones,
- deadlines,
- issues,
- decisions,
- meetings,
- commitments,
- linked campaigns,
- linked reports,
- linked scenarios,
- evidence freshness.

### Acceptance criteria
- one project page can render a coherent control summary,
- summary degrades safely when some linked objects are absent.

## Epic C2: Deadline normalization layer

### Outcome
A consistent upcoming-actions layer across domains.

### Scope
- normalize dates from milestones, review windows, deliverables, commitments, grants, invoices,
- group by urgent/soon/healthy,
- support project and workspace rollups.

### Acceptance criteria
- a project can show upcoming deadlines in one ordered list,
- date logic is reusable across modules.

## Epic C3: Planning-native records

### Outcome
Projects support structured planning operations records.

### Scope
- issue register,
- decision log,
- meeting log,
- commitment log,
- milestone tracker,
- submittal/readiness posture.

### Acceptance criteria
- project work is captured in planning-native forms,
- no dependence on generic task-board metaphors.

## Epic C4: Engagement landing zone in project detail

### Outcome
Projects show meaningful engagement status, not just links.

### Scope
- linked campaigns panel,
- counts and readiness,
- key themes/issues,
- report-back state,
- handoff-ready items,
- unresolved public-input issues.

### Acceptance criteria
- a project page shows the real engagement state at a glance.

---

# 6. Workstream D: Stakeholder Operations V1

## Objective
Introduce stakeholder continuity and follow-up management tied directly to projects and campaigns.

## Dependencies
- Workstream A domain rules
- Workstream C control room landing zones

## Epic D1: Stakeholder and organization registry

### Outcome
A basic but credible stakeholder system of record.

### Scope
- stakeholder profiles,
- organization records,
- stakeholder-organization links,
- stakeholder-project links,
- tags/attributes,
- optional geography fields.

### Acceptance criteria
- users can create and view stakeholder profiles linked to projects.

## Epic D2: Stakeholder interaction timeline

### Outcome
Stakeholder history is visible and accumulative.

### Scope
- meeting/call/email/public-comment interactions,
- notes,
- linked campaign/project context,
- attachments where appropriate,
- timeline rendering.

### Acceptance criteria
- a stakeholder profile shows a useful interaction history,
- project pages can surface key stakeholder interactions.

## Epic D3: Commitments, issues, and follow-up tasks

### Outcome
Concerns and obligations become trackable work.

### Scope
- commitments,
- issues,
- task/follow-up objects,
- due dates,
- owner,
- related stakeholder/project/campaign/report links.

### Acceptance criteria
- users can track unresolved stakeholder concerns and obligations,
- these items roll up into project control views.

## Epic D4: Stakeholder import and dedupe

### Outcome
Real-world spreadsheet migration is supported.

### Scope
- CSV import,
- field mapping,
- dedupe review,
- project association,
- tag assignment.

### Acceptance criteria
- agencies can seed stakeholder records without hand entry.

## Epic D5: Search and segmentation v1

### Outcome
Users can find and group stakeholders meaningfully.

### Scope
- search by name/org/tag/project,
- filter by contact status/issue state/type,
- save simple segments later if useful.

### Acceptance criteria
- stakeholder records are operationally retrievable, not static.

---

# 7. Workstream E: Reports, exports, evidence, and response outputs

## Objective
Turn engagement and stakeholder activity into usable planning outputs.

## Dependencies
- Workstreams B, C, D
- existing report framework

## Epic E1: Engagement summary report blocks

### Outcome
Reports can render structured engagement outputs.

### Scope
- participation counts,
- category/theme summaries,
- stage summaries,
- campaign posture,
- handoff readiness,
- public-report-back excerpts.

### Acceptance criteria
- reports can include engagement outputs without custom one-off code every time.

## Epic E2: Response matrix outputs

### Outcome
Structured response-to-comments workflow.

### Scope
- source contribution,
- category/theme,
- staff response,
- disposition/status,
- linked project/report/chapter context,
- export formats.

### Acceptance criteria
- one campaign can produce a board-usable response matrix.

## Epic E3: Stakeholder log and commitment outputs

### Outcome
Reports and exports can reflect stakeholder continuity.

### Scope
- contact log output,
- unresolved issue summary,
- commitments by status,
- outreach activity summary.

### Acceptance criteria
- stakeholder work can be exported in planning-grade formats.

## Epic E4: Evidence and provenance views

### Outcome
Outputs are traceable and defensible.

### Scope
- show source campaign/stakeholder/project links,
- audit timestamps,
- moderation state references,
- generated/exported artifact metadata.

### Acceptance criteria
- users can verify where a report section came from.

---

# 8. Workstream F: Operations summary, action center, and AI assist

## Objective
Create a shared operations layer across modules once the records are mature.

## Dependencies
- Workstreams B through E at sufficient maturity

## Epic F1: Workspace operations summary

### Outcome
A truthful cross-module operational brief.

### Scope
- counts and statuses across projects,
- moderation pressure,
- overdue commitments,
- stale reports,
- deadlines,
- readiness flags.

### Acceptance criteria
- one workspace can render a reliable operations summary.

## Epic F2: Action center / command queue

### Outcome
One normalized queue of next actions.

### Scope
- queue item model,
- priority scoring,
- target navigation,
- reason/evidence strings,
- module-agnostic action categories.

### Acceptance criteria
- next-action logic is shared rather than reimplemented per page.

## Epic F3: Cross-module assistant context

### Outcome
Assistant workflows can reason over real workspace state.

### Scope
- project summary context,
- engagement summary context,
- stakeholder summary context,
- report/funding/deadline context,
- action suggestions.

### Acceptance criteria
- assistant recommendations are grounded in actual app records.

## Epic F4: AI analysis assistant v1

### Outcome
AI helps operators synthesize work faster.

### Scope
- cited summary drafts,
- issue/theme rollups,
- overdue follow-up surfacing,
- risk flags,
- suggested report language.

### Acceptance criteria
- AI saves time without reducing traceability or review.

---

# 9. Suggested release sequencing

## Release train 1
### Focus
Architecture guardrails + Engagement V2 foundation

### Included
- Workstream A core deliverables
- campaign stages
- tool instance model foundation
- upgraded public campaign pages
- moderation improvements

### Exit criteria
- engagement can grow safely without schema chaos
- one campaign can run in real stages with clearer public UX

## Release train 2
### Focus
Project Control Room foundation

### Included
- project control summary aggregate
- deadlines layer
- issues/decisions/meetings/commitments basics
- project-linked engagement status panels

### Exit criteria
- projects function as credible operational hubs

## Release train 3
### Focus
Stakeholder Operations V1

### Included
- stakeholder registry
- organization registry
- interaction timeline
- commitments/issues/tasks
- CSV import

### Exit criteria
- a project team can maintain stakeholder continuity inside OpenPlan

## Release train 4
### Focus
Reports/evidence unification

### Included
- engagement summary report blocks
- response matrix output
- stakeholder logs and commitment outputs
- stronger provenance views

### Exit criteria
- public input and stakeholder work can become report-ready artifacts

## Release train 5
### Focus
Workspace ops summary and AI assist

### Included
- operations summary
- action queue
- cross-module assistant context
- AI-assisted summaries and follow-up surfacing

### Exit criteria
- OpenPlan begins to behave like an integrated operations platform

---

# 10. Priority rating matrix

## Highest priority
- Workstream A guardrails
- Workstream B engagement deepening
- Workstream C project control room

## Medium-high priority
- Workstream D stakeholder operations V1
- Workstream E report/evidence unification

## Later but important
- Workstream F operations summary and AI assist

---

# 11. Key dependencies and gating rules

## Dependencies
- stakeholder tasks/commitments should roll into project control views
- response matrix/report outputs depend on moderation and categorization discipline
- AI assistance depends on stable audit/provenance and source linking

## Gating rules
- no broad external launch language should be based on roadmap intent alone
- every major workstream should produce internal proof artifacts
- domain object duplication must be treated as architecture debt, not acceptable speed
- current proven flows must stay stable while new modules land

---

# 12. Recommended success metrics

## Product metrics
- campaigns created and closed with report-back
- percentage of contributions moderated and categorized
- number of project-linked engagement outputs used in reports
- number of stakeholder records linked to projects/campaigns
- percentage of stakeholder commitments with tracked status
- number of projects with active control-room usage

## Operational quality metrics
- audit coverage of major mutations
- export/report provenance completeness
- reduction in orphaned public-input items
- reduction in unresolved unowned commitments
- assistant recommendation accuracy/trustworthiness later

---

# 13. Key risks and mitigations

## Risk: duplicate contribution systems
Mitigation: service abstraction first, migration later if needed.

## Risk: stakeholder layer becomes detached mini-CRM
Mitigation: require project/report/control integration from day one.

## Risk: project control room becomes generic PM software
Mitigation: stay planning-native with issues, decisions, meetings, commitments, deadlines, and packets.

## Risk: AI lands before records are trustworthy
Mitigation: AI only after moderation, audit, and provenance rules are stable.

## Risk: too many parallel repos or execution lanes
Mitigation: keep OpenPlan as canonical integrated home.

---

# 14. Final roadmap recommendation

The practical path is:

1. lock the architecture,
2. deepen engagement,
3. build the project control room,
4. add stakeholder operations,
5. unify outputs into reports/evidence,
6. then add operations-copilot intelligence.

That sequence gives OpenPlan the highest leverage growth while preserving the current codebase, product truth, and supervised-pilot operating posture.
