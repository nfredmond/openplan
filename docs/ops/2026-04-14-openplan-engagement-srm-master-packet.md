# OpenPlan Engagement + Stakeholder Operations Master Packet

Date: 2026-04-14  
Owner: Nathaniel Ford Redmond  
Prepared by: Claire Donovan  
Status: Planning packet only, not execution approval

## Purpose

This packet organizes the April 14 strategy materials into one clear reading sequence.

It is meant to help Nathaniel, Bartholomew, and future product/engineering readers quickly understand:
- the core recommendation,
- the strategic rationale,
- the implementation shape,
- and the intended order of planning review.

---

# 1. Recommended reading order

## Read first
### 1. Executive summary
`docs/ops/2026-04-14-openplan-engagement-srm-strategy-executive-summary.md`

Use this first if the question is:
- What is the decision?
- Are we rewriting OpenPlan?
- What is the main recommendation in plain terms?
- What is the sequencing at a high level?

## Read second
### 2. Full strategy document
`docs/ops/2026-04-14-openplan-engagement-srm-unified-platform-strategy.md`

Use this second if the question is:
- Why is this the right strategic move?
- How do the two research lanes fit together?
- How do we preserve the current repo and product truth?
- What is the target architecture and end-state platform model?

## Read third
### 3. Implementation roadmap
`docs/ops/2026-04-14-openplan-engagement-srm-implementation-roadmap.md`

Use this third if the question is:
- What are the workstreams?
- What are the epics?
- What should happen first, second, and later?
- What are the dependencies and acceptance criteria?

---

# 2. Packet summary in one page

## Core recommendation

Do **not** rebuild OpenPlan as a separate OpenPoint clone.

Instead, expand OpenPlan into one unified platform with three connected layers:

1. **Planning OS core**  
   Projects, plans, programs, reports, scenarios, RTP, funding, county workflows, controls.

2. **Engagement layer**  
   Public campaigns, staged participation, map/form/poll/Q&A tools, moderation, reporting-back.

3. **Stakeholder operations layer**  
   Stakeholder profiles, organizations, interaction history, issues, commitments, tasks, outreach continuity.

## Core architectural rule

**Add to the current OpenPlan spine. Do not replace it.**

That means:
- preserve the existing project/report/scenario/engagement architecture,
- extend current engagement tables and flows before inventing parallel ones,
- make project pages the main operating/control hub,
- unify all new outputs into evidence, exports, and reporting.

## Why this is the correct direction

OpenPlan already has a real product foundation.

This strategy compounds existing value by connecting:
- public input,
- moderation,
- stakeholder follow-up,
- project controls,
- report outputs,
- and auditable evidence.

That is strategically stronger than shipping:
- a detached engagement tool,
- a detached mini-CRM,
- or a rewrite driven by parity-chasing.

---

# 3. Key decisions this packet recommends

## Decision 1
**Keep OpenPlan as the canonical integrated platform repo.**

Do not split the future product into overlapping production systems unless a later architecture review proves that necessary.

## Decision 2
**Treat the project as the anchor object.**

Engagement, stakeholder operations, reports, controls, RTP, and funding should all resolve back to project-linked planning context.

## Decision 3
**Deepen current engagement before adding a broad SRM layer.**

This is the best leverage point because the repo already contains real engagement foundations.

## Decision 4
**Build the project control room before heavy AI/copilot expansion.**

The record system has to be stronger before intelligence layers can be trusted.

## Decision 5
**Add stakeholder operations as a connected planning domain, not a generic CRM.**

Stakeholder objects should support planning work, engagement continuity, and reportable obligations.

---

# 4. Recommended review sequence by audience

## Nathaniel
Read:
1. executive summary
2. packet summary section in this file
3. strategy doc only if deeper review is needed

## Bartholomew
Read:
1. executive summary
2. full strategy doc
3. implementation roadmap

## Engineering / architecture leads
Read:
1. full strategy doc
2. implementation roadmap
3. this packet for sequencing and decision framing

## Future planning/product contributors
Read:
1. this master packet
2. executive summary
3. strategy doc
4. roadmap

---

# 5. Recommended discussion sequence for a later working session

If Nathaniel and Bartholomew review this packet together, the cleanest discussion order is:

## A. Confirm the strategic stance
- Are we aligned that OpenPlan should expand additively, not via rewrite?
- Are we aligned that the target is a unified planning + engagement + stakeholder operations platform?

## B. Confirm the architectural guardrails
- Is project the anchor object?
- Is OpenPlan the canonical repo?
- Is one shared audit/evidence spine required?

## C. Confirm the sequence
- architecture guardrails first,
- engagement deepening second,
- project control room third,
- stakeholder operations fourth,
- reports/evidence unification fifth,
- AI/copilot later.

## D. Decide whether to commission the next planning specs
Likely next specs:
- canonical domain model and migration policy,
- engagement V2 spec,
- project control room spec,
- stakeholder operations V1 spec,
- unified reporting/evidence spec.

---

# 6. What this packet is not

This packet is:
- a strategy and sequencing bundle,
- a product planning artifact,
- a preservation-first expansion plan.

This packet is **not**:
- an approval to execute immediately,
- a claim that OpenPlan is already broadly self-serve,
- a mandate to rewrite schemas now,
- or a reason to loosen current evidence-bound external positioning.

---

# 7. Bottom line

If read together, these materials support one coherent conclusion:

> OpenPlan should evolve into the system that connects planning workflow, public engagement, stakeholder continuity, project controls, and evidence-grade reporting inside one auditable workspace.

That path preserves current work, fits the repo truth, and opens the strongest long-term product direction.

---

# 8. Linked documents

- Executive summary: `docs/ops/2026-04-14-openplan-engagement-srm-strategy-executive-summary.md`
- Full strategy: `docs/ops/2026-04-14-openplan-engagement-srm-unified-platform-strategy.md`
- Implementation roadmap: `docs/ops/2026-04-14-openplan-engagement-srm-implementation-roadmap.md`

---

# 9. Recommended next planning move

When Nathaniel is ready, the next non-execution step should be to commission the first implementation-adjacent planning doc:

**`canonical domain model + migration policy`**

That is the right bridge from strategy into disciplined build planning.
