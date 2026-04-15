# OpenPlan Engagement + Stakeholder Operations + Unified Platform Strategy

Date: 2026-04-14  
Owner: Nathaniel Ford Redmond  
Drafted by: Claire Donovan  
Status: Strategic planning draft, not approved for execution  
Purpose: Define how OpenPlan should expand using the recent community engagement and stakeholder relationship management research lanes without discarding the current product spine, repo investments, or evidence-bound product posture.

---

# 1. Executive recommendation

The correct strategic move is **not** to rebuild OpenPlan as a separate OpenPoint clone.

The correct move is to evolve OpenPlan into a **unified planning operations platform** with three tightly connected layers:

1. **Planning OS core**  
   Projects, plans, programs, models, reports, scenarios, RTP cycles, county-run workflows, funding, and evidence-linked controls.

2. **Participation layer**  
   Public engagement campaigns, stage-aware public input, surveys/forms, map-based comments, moderation, reporting-back, and public-record-friendly exports.

3. **Stakeholder operations layer**  
   Stakeholder profiles, organizations, interaction history, commitments, outreach follow-up, tasks, issues, and institutional memory.

This path preserves the current OpenPlan product and codebase while opening a much larger long-term category position.

---

# 2. Grounding in current repo truth

## Current product truth

OpenPlan is already a real, production-backed supervised-pilot Planning OS, not a blank slate.

Current proven surfaces and product truth include:
- authenticated workspace flows,
- projects, plans, programs, models, reports, and scenarios,
- engagement campaigns and public/share intake,
- geospatial analysis surfaces,
- report traceability,
- county-run onboarding/scaffold workflows,
- bounded billing/admin/pilot support operations,
- pilot-bounded positioning and evidence-aware language.

## Relevant existing repo direction

OpenPlan already contains architectural direction that supports this strategy:
- the existing **Projects** module as a real planning-domain anchor,
- the current **Engagement** module with campaigns/categories/items/public-share flow,
- the existing **engagement-to-report handoff** logic,
- the proposed **Unified Platform Execution Plan**,
- the existing **project control room** direction,
- the existing **RTP cycle** direction,
- the current emphasis on auditability, traceability, and pilot-safe claims.

## Strategic implication

We should treat the research as an **expansion of the current OpenPlan architecture**, not as a reason to fork product identity or restart the app.

---

# 3. What the two research lanes mean in OpenPlan terms

# 3A. Community engagement research lane

The community engagement lane indicates that OpenPlan should mature from basic campaign intake into a more complete planning-grade engagement system with:
- public project pages,
- staged engagement windows,
- multiple participation methods,
- moderation workflows,
- map-based input,
- public reporting-back,
- accessibility and multilingual posture,
- exportable records and evidence packs,
- optional AI-assisted synthesis with provenance.

In OpenPlan terms, this extends the existing:
- `engagement_campaigns`
- `engagement_categories`
- `engagement_items`
- share-token public engagement pages
- campaign-to-report linkage

rather than replacing them.

# 3B. Stakeholder relationship management research lane

The SRM lane indicates that OpenPlan should support:
- stakeholder profiles,
- organization records,
- stakeholder-project relationships,
- engagement timeline/history,
- commitments and issues,
- tasks and follow-ups,
- outreach capture,
- import/migration from legacy spreadsheets,
- audit history and defensible records.

In OpenPlan terms, this should become a new domain layer that plugs into:
- projects,
- engagement campaigns,
- reports,
- RTP cycles,
- funding/grants,
- project controls,
- evidence trails.

# 3C. The synthesis

These two lanes are not separate products.

They should form one end-to-end chain:

**public input -> moderation -> categorization -> stakeholder follow-up -> commitments/issues/tasks -> project decisioning -> report outputs -> audit/evidence preservation**

That chain is more valuable than either lane on its own.

---

# 4. Product thesis

## Recommended thesis

OpenPlan should become:

> A planning operations platform that unifies project workflow, public engagement, stakeholder continuity, evidence-grade reporting, and operational controls inside one auditable workspace.

## Why this thesis is stronger than a pure clone strategy

A clone strategy would:
- narrow the product to parity-chasing,
- create pressure for a rewrite,
- risk fragmenting the repo into overlapping systems,
- weaken OpenPlan's planning-domain differentiation.

A unified-platform strategy instead:
- preserves existing work,
- compounds the value of the current repo,
- fits the planning/government domain better,
- lets engagement and stakeholder features feed planning outputs,
- creates a bigger moat than “another engagement SaaS.”

---

# 5. Strategic principles

## Principle 1: additive expansion, not replacement

All new work should extend the current OpenPlan spine.

Do not delete or invalidate current modules unless replacement is clearly proven and migration-safe.

## Principle 2: project remains the main anchor object

The project should remain the central operational container for:
- engagement,
- stakeholders,
- decisions,
- commitments,
- reports,
- scenarios,
- funding posture,
- evidence and controls.

## Principle 3: one evidence spine across all modules

Every major object should write into shared:
- audit history,
- provenance,
- timeline/event streams,
- reporting,
- export,
- AI annotation boundaries.

## Principle 4: no generic SaaS drift

OpenPlan should not become a generic CRM plus generic PM board plus generic survey app.

It should remain planning-native and public-sector-workflow-native.

## Principle 5: no big-bang rewrite

Prefer:
- vertical slices,
- new tables with adapters,
- compatibility views,
- migrations and backfills,
- service-layer normalization,
- progressive UI upgrades.

Do not attempt a large product reset.

## Principle 6: AI comes after record integrity

AI should accelerate:
- synthesis,
- classification,
- summarization,
- surfacing of next actions,

but must not outrun:
- auditability,
- record truth,
- moderation,
- human review,
- evidence-bound product claims.

---

# 6. Recommended end-state platform model

The long-term product should look like a coherent set of connected operating surfaces.

## 6A. Core planning surfaces
- Dashboard
- Projects
- Plans
- Programs
- Models
- Reports
- Scenarios
- RTP Cycles
- County Runs
- Data Hub
- Billing/Admin

## 6B. Engagement and participation surfaces
- Campaign catalog
- Campaign detail
- Public project/campaign pages
- Stage-based participation windows
- Tool library: map, form, poll, Q&A, discussion, idea capture
- Moderation center
- Public reporting-back
- Comment summary/export center

## 6C. Stakeholder operations surfaces
- Stakeholder registry
- Organization registry
- Stakeholder profile with timeline
- Relationship view
- Outreach/tasks/commitments
- Issue tracker
- Import/migration tools
- Search/segmentation

## 6D. Project control room surfaces
- Milestones
- Deadlines
- Risks/issues
- Decisions
- Meetings/notes
- Commitments
- Deliverables/submittals
- Reimbursement/invoice posture
- Linked engagement
- Linked stakeholders
- Linked reports/scenarios
- Evidence freshness

## 6E. Shared intelligence surfaces
- Action center / command queue
- Operations copilot
- Workspace ops summary
- AI analysis assistant
- Cross-module search
- Audit/provenance views

---

# 7. Recommended domain architecture

## 7A. Current preserved objects

These should be preserved and extended:
- `projects`
- `plans`
- `programs`
- `reports`
- `scenarios`
- `engagement_campaigns`
- `engagement_categories`
- `engagement_items`
- `rtp_cycles`
- existing report traceability contracts
- existing workspace/auth model

## 7B. New domain objects to introduce gradually

### Participation objects
- `campaign_stages`
- `campaign_tool_instances`
- `contributions` or contribution-normalization layer
- `moderation_actions`
- `public_response_items`
- `report_back_snapshots`

### Stakeholder objects
- `stakeholders`
- `organizations`
- `stakeholder_organizations`
- `stakeholder_relationships`
- `stakeholder_project_links`
- `stakeholder_interactions`
- `stakeholder_tasks`
- `stakeholder_commitments`
- `stakeholder_issues`
- `stakeholder_segments`
- `consent_records`

### Shared control/evidence objects
- `timeline_events`
- `audit_events`
- `ai_annotations`
- `export_jobs`
- `action_queue_items`
- `deadline_items`
- `evidence_links`

## 7C. Guidance on `engagement_items`

Do not rush to replace `engagement_items` with a whole new contribution system.

Recommended path:
1. keep `engagement_items` as the live current input record,
2. introduce a service-layer abstraction for “contributions,”
3. only later decide whether to:
   - keep `engagement_items` as canonical, or
   - introduce a generalized `contributions` table and backfill.

This avoids unnecessary churn.

---

# 8. Integration model across modules

## 8A. Project as operational hub

Every project detail page should evolve toward one integrated control-room view with sections for:
- project metadata and status,
- linked RTP/program/funding context,
- engagement campaigns,
- stakeholder roster and key contacts,
- commitments/issues/tasks,
- deadlines and milestones,
- reports and evidence packs,
- scenarios and linked runs,
- financial posture,
- field/aerial evidence where relevant.

## 8B. Engagement as public input intake and synthesis lane

Engagement should become the managed intake lane for:
- public comments,
- map pins,
- polls,
- forms,
- stage-specific consultation,
- RTP chapter/project review,
- project-specific feedback.

Outputs should feed:
- project issues,
- stakeholder records,
- report sections,
- public summaries,
- response matrices,
- action-center items.

## 8C. Stakeholder operations as continuity layer

Stakeholder operations should carry context across long-running projects and planning cycles:
- who is affected,
- who has been contacted,
- what commitments exist,
- what issues remain unresolved,
- what organizations matter,
- what sentiment or concerns recur.

## 8D. Reports as evidence package layer

Reports should become the place where planning, engagement, stakeholder, and evidence outputs converge into:
- board-ready outputs,
- comment summaries,
- response-to-comments matrices,
- stakeholder contact logs,
- project status packets,
- scenario-linked narrative outputs,
- RTP/public review documentation.

---

# 9. Detailed phased roadmap

# Phase 0: preservation, normalization, and architecture discipline

## Objective
Create the architecture guardrails that allow expansion without repo damage.

## Why this phase matters
Without a normalization phase, OpenPlan risks building:
- duplicate object models,
- parallel engagement systems,
- isolated stakeholder logic,
- incompatible reporting outputs,
- avoidable migration debt.

## Deliverables
- canonical object registry across OpenPlan
- domain map of current modules and related repos
- source-of-truth matrix for planning, engagement, stakeholder, report, funding, and control objects
- naming and migration policy
- compatibility policy for current engagement objects
- “do not duplicate these objects” architecture memo

## Decisions to lock
- project remains the anchor object
- workspace remains tenant boundary
- evidence/audit/provenance are shared services
- engagement extends current campaign architecture
- SRM is a new connected layer, not a detached CRM

## Acceptance criteria
- every planned new object has a declared anchor and reporting path
- every planned module has explicit write targets and read dependencies
- migration strategy exists before major object creation

---

# Phase 1: deepen engagement into a planning-grade participation layer

## Objective
Extend the current Engagement module from early intake/moderation into a richer public participation system.

## Why first
This is the highest-leverage expansion because the repo already contains:
- engagement catalog,
- campaign detail,
- categories,
- items,
- share page,
- moderation posture,
- report handoff logic.

## Scope
### 1. Campaign staging
Add stage-aware engagement windows:
- draft
- open for review
- targeted public window
- closed
- report-back

Each campaign can have one or more stages tied to:
- project lifecycle,
- RTP chapter,
- corridor phase,
- plan alternatives.

### 2. Tool-type expansion
Extend campaign engagement modes beyond a single intake model:
- comment collection
- quick poll
- map feedback
- form/survey
- Q&A
- discussion/conversation

Do this with a tool-instance model layered on the current campaign object.

### 3. Public project/campaign pages
Upgrade current share pages into more complete public surfaces with:
- project context,
- why input matters,
- timeline/stage context,
- participation instructions,
- approved published feedback,
- report-back/output sections.

### 4. Moderation center
Strengthen moderation with:
- queue views,
- category review,
- spam/flag states,
- redaction capability,
- public/private visibility controls,
- audit history of moderation actions.

### 5. Public reporting-back
Add a “what we heard / what changed / what happens next” pattern with:
- human-reviewed summaries,
- linked categories/themes,
- counts and simple charts,
- downloadable summary and raw-data exports where appropriate.

### 6. Accessibility and inclusive participation
Bake in:
- keyboard-safe UX,
- map alternatives/list views,
- readable forms,
- multilingual-ready content structure,
- privacy warnings for location-based comments.

### 7. AI-assisted synthesis v0
AI may assist with:
- draft summaries,
- suggested themes/tags,
- sentiment labels,
- PII detection,
- summary drafts for report sections.

All outputs must be reviewable and traceable to source contributions.

## Deliverables
- campaign stages model
- tool-instance model
- upgraded public campaign pages
- moderation queue improvements
- report-back output blocks
- exportable engagement summary packs
- AI annotation support objects

## Acceptance criteria
- one real project can run a richer public campaign end to end
- moderation and reporting-back are clear and auditable
- campaign outputs can feed reports without ad hoc stitching
- current engagement architecture is preserved, not bypassed

---

# Phase 2: turn projects into a real planning control room

## Objective
Make `Projects` the main operational hub for planning work.

## Why second
Once engagement is richer, project pages need a better place to receive, organize, and act on those outputs.

## Scope
### 1. Project summary model
Add a stable project-control aggregate summarizing:
- milestones,
- deadlines,
- deliverables,
- submittals,
- issues,
- risks,
- decisions,
- meetings,
- linked campaigns,
- linked reports,
- linked scenarios,
- evidence freshness.

### 2. Action-center-ready deadlines
Normalize due dates from multiple modules into one deadline layer:
- milestones
- review windows
- deliverables
- grant deadlines
- hearing dates
- invoice/reimbursement due dates
- follow-up commitments

### 3. Planning-native PM records
Add planning-specific sub-records rather than generic task-board abstractions:
- decision logs
- meeting records
- issue register
- commitments
- milestone tracker
- packet/submittal readiness

### 4. Engagement landing zone on project pages
Every project should show:
- linked campaigns,
- campaign status,
- readiness for handoff,
- summary of comments/themes,
- report-back status,
- open issues generated from engagement.

## Deliverables
- project control room aggregate model
- deadline normalization layer
- project-native issue/decision/meeting/commitment surfaces
- linked engagement panels on project detail pages

## Acceptance criteria
- a project page feels like the operating center for real planning work
- upcoming obligations are visible in one place
- engagement and report outputs are project-visible without duplication

---

# Phase 3: add stakeholder operations / SRM as a connected domain layer

## Objective
Introduce stakeholder continuity and outreach management without becoming a generic CRM.

## Why third
Stakeholder operations become much more valuable once projects and engagement already have stronger context and landing zones.

## SRM V1 scope
### 1. Stakeholder registry
Add stakeholder profiles with:
- contact identity fields,
- role/type,
- geography/location where relevant,
- tags/attributes,
- linked organizations,
- linked projects.

### 2. Organization registry
Track:
- agencies,
- advocacy groups,
- businesses,
- partners,
- community organizations,
- tribal entities,
- consultants,
- institutional stakeholders.

### 3. Interaction timeline
Track interactions such as:
- calls,
- meetings,
- emails,
- public comments,
- follow-up notes,
- commitments created,
- issues raised.

### 4. Commitments and issues
Add a formal lane for:
- commitments owed,
- issues raised,
- status,
- owner,
- due dates,
- related project/report/campaign linkage.

### 5. Tasks and follow-up
Add staff-facing operational tasks tied to:
- stakeholder contacts,
- unresolved issues,
- campaign outreach,
- board responses,
- grant partner follow-up.

### 6. Imports and migration
Support practical CSV import and deduplication for the common reality that agencies already have stakeholder lists in spreadsheets.

## SRM V2 scope
- email capture/sync posture
- SMS capture/logging
- stakeholder segmentation
- relationship graph
- stakeholder map views
- semantic search across interactions and attachments

## Deliverables
- stakeholder and organization data model
- interaction timeline model
- commitments/issues/tasks support
- import and dedupe workflow
- project-linked stakeholder panels

## Acceptance criteria
- one project can maintain a credible stakeholder roster and interaction history
- commitments and unresolved concerns are visible and actionable
- stakeholder continuity survives beyond a single campaign or meeting

---

# Phase 4: unify engagement, stakeholder operations, and reports

## Objective
Connect public participation, stakeholder follow-up, and reporting into one evidence-grade operational chain.

## Core workflow targets
### Workflow A: public contribution to structured issue
- public contribution arrives
- contribution is moderated and categorized
- contribution becomes a project issue, theme, or response item
- issue can be assigned or tracked
- issue is reflected in report output

### Workflow B: identified contributor to stakeholder continuity
- public contribution links to a known stakeholder or creates a provisional stakeholder record
- staff follow-up is logged
- commitments/tasks are attached
- history becomes searchable and reportable

### Workflow C: campaign to board/report output
- campaign closes
- comments/themes are summarized
- response matrix is generated
- project/report sections are updated
- public report-back is published

### Workflow D: engagement to RTP/plan context
- campaign targets RTP cycle, chapter, or project
- chapter-level concerns roll up to plan narrative
- constrained/illustrative project logic remains visible
- public review record becomes exportable

## Reporting outputs to add
- comment summary packs
- response-to-comments matrix
- stakeholder contact log
- issue and commitment tracker
- “what we heard” report block
- “what changed” report block
- public-review appendix for RTP/plan packets

## Deliverables
- crosswalk logic for contribution -> issue/task/commitment/report
- report section types for engagement/SRM outputs
- export-ready structured output packs
- public/internal summary variants

## Acceptance criteria
- comments no longer die in a moderation queue
- stakeholder continuity no longer lives outside the product
- report outputs can show traceable public-input handling

---

# Phase 5: operations copilot and AI-assisted planning workflows

## Objective
Add intelligence on top of a mature record system.

## What AI should do
- summarize large feedback sets
- suggest themes and tags
- detect PII and moderation risks
- surface stale commitments or overdue follow-up
- draft report narratives from cited source material
- generate operational briefs across projects/programs/reports
- suggest next actions based on deadlines and unresolved items

## What AI should not do
- silently become the record of truth
- publish unreviewed public summaries
- replace human review in official outputs
- make compliance/legal claims
- hide the source material behind abstraction

## Key build slices
### 1. Workspace operations summary
A shared cross-module operational brief for dashboards and assistant surfaces.

### 2. Action queue / command queue
A normalized queue of next actions across:
- project deadlines,
- engagement moderation,
- report freshness,
- stakeholder follow-up,
- funding opportunities,
- evidence gaps.

### 3. Cross-module copilot context
The assistant should be able to reason across:
- project state,
- engagement state,
- report state,
- stakeholder state,
- funding state,
- scenario state.

### 4. Internet-connected signal ingestion later
Outside information should eventually be attached as provenance-backed signals, not free-floating prompt context.

## Acceptance criteria
- AI improves operator speed without reducing auditability
- action recommendations are grounded in real records
- summaries cite actual source content and object links

---

# 10. Recommended data evolution strategy

## Rule 1: preserve current schema investments
Do not deprecate current core OpenPlan objects casually.

## Rule 2: use compatibility layers before migrations that break assumptions
If a broader abstraction is needed, introduce:
- service-layer adapters,
- SQL views,
- backfills,
- dual-read phases,
- feature flags.

## Rule 3: expand current engagement schema instead of replacing it first
Suggested sequence:
1. add stage/tool metadata,
2. add richer moderation/audit objects,
3. add public-response/report-back objects,
4. only then decide whether generalized contribution tables are worth the migration cost.

## Rule 4: keep one shared audit and provenance language
New modules should not invent their own incompatible event logging if a shared audit/provenance layer can cover them.

## Rule 5: make report outputs a first-class consumer of every domain object
Every major object family should have a clear path to:
- summary display,
- export,
- report section integration,
- evidence trail.

---

# 11. Repo and implementation strategy

## Primary home
The main implementation home should remain the existing `openplan` repo.

## Other repos
Other repos should be treated as:
- idea donors,
- reference implementations,
- experimental/proof lanes,
- source material for modular extraction,

not as reasons to create overlapping production products.

## Recommended approach
- OpenPlan remains the canonical integrated platform repo
- utility logic can be extracted into packages where helpful
- repo-level architecture should favor one coherent product surface over many semi-duplicated ones

## Why this matters
The biggest strategic risk is not underbuilding. It is spreading the same product ambition across too many repos with partial overlap and weak canonical ownership.

---

# 12. Suggested build sequencing

## Recommended order
1. preservation and normalization
2. engagement deepening
3. project control room
4. stakeholder operations
5. report/evidence unification
6. AI operations copilot

## Why this is the right order
This sequence:
- reuses the most existing work,
- yields product-visible progress early,
- avoids isolated CRM work with no landing zone,
- avoids overbuilding AI on top of weak records,
- protects the current pilot-bounded posture.

---

# 13. Risks and mitigations

## Risk 1: building disconnected subsystems
**Mitigation:** enforce project/report/evidence anchors for all new domains.

## Risk 2: engagement overbuild before operations readiness
**Mitigation:** grow from current campaign architecture with staged, reviewable slices.

## Risk 3: generic PM or CRM drift
**Mitigation:** keep all new surfaces planning-native and public-sector-workflow-specific.

## Risk 4: schema churn and migration debt
**Mitigation:** use additive schema evolution, views, adapters, and backfills.

## Risk 5: losing existing repo value
**Mitigation:** preserve current OpenPlan repo as canonical home and extend what already works.

## Risk 6: AI overclaiming or poor governance
**Mitigation:** AI only after audit/provenance and moderation flows are solid; human review remains explicit.

## Risk 7: external posture outruns product truth
**Mitigation:** keep all positioning inside the current supervised-pilot boundary until broader proof exists.

---

# 14. Success definition

This strategy is succeeding when OpenPlan can truthfully demonstrate a chain like this:

1. a project exists in a real planning workspace,
2. it has linked planning, scenario, and report context,
3. it runs a public engagement campaign,
4. public comments are moderated and categorized,
5. important contributors and organizations are tracked as stakeholders,
6. issues and commitments are created and followed through,
7. project controls show deadlines, decisions, and readiness,
8. reports and public summaries point back to real evidence,
9. the whole process is auditable,
10. and the product still feels like one coherent Planning OS rather than a bolted-together set of tools.

---

# 15. Final recommendation

OpenPlan should not abandon its current identity in order to chase engagement or SRM parity.

Instead, it should become the stronger thing the research points toward:

> a unified planning operations platform that combines planning workflow, public engagement, stakeholder continuity, project controls, and evidence-grade reporting.

This path:
- preserves the months of work already invested,
- fits the current repo truth,
- compounds the value of current modules,
- creates a stronger category position,
- and gives the team a disciplined way to expand without rewrite chaos.

---

# 16. Immediate next planning artifacts recommended

When ready, the next useful non-execution planning documents would be:

1. **Canonical domain model and migration policy**  
   Lock object ownership and compatibility rules.

2. **Engagement V2 product spec**  
   Stage/tool/public-report-back expansion of the current engagement module.

3. **Project control room spec**  
   Normalized deadlines, issues, decisions, commitments, and linked readiness panels.

4. **Stakeholder Operations V1 spec**  
   Minimal but real SRM layer connected to projects and campaigns.

5. **Unified reporting and evidence spec**  
   How engagement, stakeholder, and project-control outputs flow into reports and exports.

6. **Action center / operations copilot spec**  
   Shared queue and assistant context layer across modules.

These should be planning artifacts only until Nathaniel approves execution sequencing.
