# OpenPlan Ruthless Execution Board

**Date:** 2026-04-11  
**Owner:** Bartholomew Hale  
**Status:** Active execution board  
**Purpose:** translate the integration master plan into an immediately executable board with owners, dependencies, acceptance criteria, and the next concrete build slices.

## Executive Summary

The current rule is simple:

**Do not broaden scope faster than we close loops.**

OpenPlan already has a believable platform core and one strong flagship lane.
The next 4 to 8 weeks should be governed by this order:
1. finish the RTP flagship loop,
2. build the Grants OS foundation,
3. force modeling write-back into planning truth,
4. define and integrate aerial evidence infrastructure,
5. broaden the runtime safely,
6. run the UX coherence and proof-hardening pass.

If a task does not improve:
- workflow completion,
- cross-system integration,
- trustworthy propagation,
- runtime leverage,
- or UX coherence,
it is not a priority.

---

## 1. Active Command Posture

## Current active phase
**Phase 1: RTP flagship loop closure**

## Current objective
Turn RTP OS from the strongest vertical into the first indisputably complete operating loop inside OpenPlan.

## Why this is first
- it already has the deepest real product surface
- it is the fastest path to proving OpenPlan can close a full end-to-end operating loop
- it creates the standard that Grants, Modeling, Aerial, and the runtime should follow

## Phase exit rule
Do not call Phase 1 complete until:
- first packet creation works from live operating surfaces
- packet artifact generation/refresh works in the same flow
- post-action state re-grounding is reliable
- packet review/release posture is coherent
- public-review/comment-response foundations are real
- integrated proof for the RTP loop exists

---

## 2. Owner Map

| Lane | Primary owner | Supporting owners | Notes |
|---|---|---|---|
| Scope, sequence, acceptance criteria | Bartholomew | Nathaniel | final orchestration and tradeoff control |
| RTP planning quality and workflow truth | Elena | Owen | planning defensibility, packet quality, review logic |
| Grants and compliance operating model | Owen | Elena, Bartholomew | legal/compliance posture, reimbursement and closeout logic |
| Modeling integration and evidence write-back | Priya | Iris, Elena | method truth, caveats, scenario/run interpretation |
| Platform implementation and reliability | Iris | Bartholomew | software delivery, data flows, action registry, QA hardening |
| UI coherence and operator clarity | Mateo | Iris, Elena | workbench calmness, status language, scanability |
| Executive priority and launch-boundary decisions | Nathaniel | Bartholomew | approval of major scope and external posture |

## Operating rule
Every active ticket must name:
- primary owner
- dependencies
- acceptance criteria
- proof artifact or validation step

---

## 3. Workstream Board

## Workstream A, RTP flagship loop closure
**Status:** active, highest priority  
**Primary owner:** Iris  
**Planning QA:** Elena  
**Support:** Mateo, Bartholomew

### Definition of done
A planner can manage an RTP cycle from setup through usable packet review without losing project, report, scenario, or control context.

### Immediate tickets

#### A1. First packet record creation from live operating surfaces
- **Owner:** Iris
- **Dependency:** existing RTP registry and packet queue surfaces
- **Acceptance criteria:**
  - when no packet exists, the user can create the first packet record directly from the operating surface
  - the action is auditable
  - the surface re-grounds to the new state without refresh confusion
- **Proof:** local flow validation + production/path smoke if shipped

#### A2. Chain packet generation/refresh into the same operating flow
- **Owner:** Iris
- **Dependency:** A1 or existing packet record
- **Acceptance criteria:**
  - create/generate/refresh can occur in one coherent workflow
  - success state, failure state, and post-action posture are explicit
  - the assistant/runtime sees the updated posture immediately after action
- **Proof:** end-to-end RTP packet smoke run

#### A3. Normalize review/release semantics
- **Owner:** Elena
- **Implementation support:** Iris, Mateo
- **Acceptance criteria:**
  - review, ready, stale, blocked, released, and related states mean one thing everywhere RTP packet posture appears
  - registry, cycle detail, report detail, and runtime language match
- **Proof:** semantics checklist + UI review screenshots

#### A4. Public review and comment-response foundation
- **Owner:** Elena
- **Implementation support:** Iris
- **Acceptance criteria:**
  - RTP cycle can enter a bounded public-review state
  - comments/feedback posture can be summarized and linked into packet review status
  - response loop is at least foundationally real, not implied-only
- **Proof:** one demonstrated cycle-level review path

#### A5. Scenario/model evidence must visibly affect packet posture
- **Owner:** Priya
- **Implementation support:** Iris
- **Acceptance criteria:**
  - relevant scenario/model changes can mark packet basis as stale or refresh-recommended
  - the provenance for why the packet changed stays visible
- **Proof:** one comparison/run change causing packet posture update

#### A6. RTP flagship proof packet refresh
- **Owner:** Bartholomew
- **Support:** Mateo, Elena, Iris
- **Acceptance criteria:**
  - one current proof artifact shows the RTP loop end to end
  - screenshots, validation notes, and bounded truth language are aligned
- **Proof:** new docs/ops proof bundle

---

## Workstream B, Grants OS foundation
**Status:** queued next, second highest priority  
**Primary owner:** Owen  
**Implementation owner:** Iris  
**Support:** Elena, Bartholomew

### Definition of done
A grant can move from opportunity posture into project-linked operational truth inside OpenPlan.

### Immediate tickets

#### B1. Funding program catalog
- funding programs, source agencies, deadlines, cadence, and eligibility posture

#### B2. Opportunity registry and decision board
- pursue / monitor / skip workflow
- project/program linkage
- explicit reason and owner posture

#### B3. Award and match posture
- award state
- local match posture
- dependency on project readiness and RTP context

#### B4. Reimbursement/compliance control skeleton
- reimbursement readiness
- compliance milestones
- closeout path placeholder with explicit status

#### B5. Project and RTP write-back
- funding posture must change project readiness and RTP financial posture

### Phase gate
Do not call Grants OS real until it writes back into the shared control room.

---

## Workstream C, Modeling write-back integration
**Status:** parallel design-to-implementation lane  
**Primary owner:** Priya  
**Implementation owner:** Iris  
**Support:** Elena

### Definition of done
Modeling outputs materially affect planning decisions and artifacts rather than living in technical isolation.

### Immediate tickets

#### C1. Packet-basis invalidation from scenario/run changes
#### C2. Project prioritization context enriched by model evidence
#### C3. Grant-readiness evidence hooks for scenario/model results
#### C4. Planner-facing interpretation surfaces with caveats and safe claims

### Hard rule
No broadened external modeling claims without Priya/Iris handoff specifying method, caveats, safe claim, and next proof-critical step.

---

## Workstream D, Aerial evidence integration contract
**Status:** define before UI sprawl  
**Primary owner:** Bartholomew  
**Implementation owner:** Iris  
**Support:** Mateo

### Definition of done
Aerial outputs become first-class project-linked evidence objects inside OpenPlan.

### Immediate tickets

#### D1. Canonical object model
- mission
- AOI
- ingest job
- processing job
- QA bundle
- measurable output bundle
- share package

#### D2. Project/report linkage rules
#### D3. Evidence-chain integration rules
#### D4. Control-room implications for field verification readiness

### Hard rule
Do not build broad aerial UI before these contracts are explicit.

---

## Workstream E, Runtime action expansion
**Status:** active architecture lane, narrow implementation lane  
**Primary owner:** Iris  
**Support:** Bartholomew, Priya, Owen

### Definition of done
The runtime performs bounded useful work across modules with visible auditability.

### Immediate tickets

#### E1. Canonical action registry
- read
- create
- refresh
- generate
- attach-evidence
- propose-status-update

#### E2. Explicit approval semantics
#### E3. Post-action re-grounding contract
#### E4. Cross-module workspace operations briefing
#### E5. Outside-signal ingestion contract with provenance

### Hard rule
Do not let the assistant become a decorative chat veneer. Every expansion should improve real operator leverage.

---

## Workstream F, UX coherence and proof hardening
**Status:** continuous, but decisive before broad rollout  
**Primary owner:** Mateo  
**Implementation owner:** Iris  
**Support:** Elena, Bartholomew

### Definition of done
The platform feels like one calm workbench and the flagship loops have repeatable proof.

### Immediate tickets

#### F1. Shared status vocabulary audit
#### F2. Shared command-board behavior audit
#### F3. Left-rail / worksurface / inspector consistency review
#### F4. Multi-viewport review of flagship flows
#### F5. Known-issues register for integrated loops
#### F6. Proof pack refresh cadence

---

## 4. Immediate Next 10 Tickets

These are the most important actual next tickets in order.

1. **RTP-A1** — create first packet record directly from live operating surfaces  
2. **RTP-A2** — chain packet generation/refresh and re-ground state  
3. **RTP-A3** — normalize packet review/release semantics across surfaces  
4. **RTP-A4** — implement bounded public-review/comment-response foundation  
5. **MODEL-C1** — make scenario/run changes affect packet-basis posture  
6. **RTP-A6** — refresh proof packet for the complete RTP flagship loop  
7. **GRANT-B1** — build funding program catalog in shared spine  
8. **GRANT-B2** — build opportunity registry and pursue/monitor/skip board  
9. **GRANT-B5** — write funding posture back into project/RTP/control truth  
10. **RUNTIME-E1** — formalize the runtime action registry and approval model

---

## 5. Critical Dependencies and Rules

## Shared rules
- project is the canonical spine
- shared context beats page-local logic
- provenance beats magic
- workflow completion beats feature count
- status language must stay universal
- no speculative breadth before flagship closure

## Dependency chain
- RTP flagship closure comes before broadening grants automation
- shared status semantics come before cross-module runtime automation
- modeling write-back must exist before stronger planning claims
- aerial contract must exist before aerial UI expansion
- proof pack refresh must accompany every major loop closure

---

## 6. Weekly Operating Rhythm

## At the start of each cycle
- confirm active phase
- confirm top 3 tickets
- confirm dependencies and blockers
- confirm proof artifact target

## During implementation
- keep changes vertical and narrow
- prefer finished slices over broad partial waves
- verify affected live surfaces, not just types and tests

## At the end of each cycle
- ship to main if stable
- capture proof or validation note
- update board status
- promote durable learnings into docs

---

## 7. Phase Gates

## Gate to leave Phase 1 and enter Phase 2
All of the following must be true:
- RTP first-packet creation is real
- packet generation/refresh/re-grounding is real
- review/release semantics are normalized
- public review foundation is real
- scenario/model packet-basis propagation is demonstrated
- flagship proof packet is refreshed

## Gate to call Grants OS foundationally real
All of the following must be true:
- opportunity board exists
- pursue/monitor/skip decisions are real
- project/program linkage is real
- award and match posture are real
- reimbursement/compliance skeleton is real
- grant posture changes control-room truth

---

## 8. Known Risks

- RTP loop looks stronger than it is if first-packet creation remains a dead seam.
- Grants may drift into tracker theater if write-back is delayed.
- Modeling may drift into technical theater if caveated outputs do not affect decisions.
- Aerial may drift into separate-product thinking if evidence contracts are not locked first.
- Runtime may drift into chatbot theater if action registry and approval semantics lag.
- UX may get noisier if status language and command-board behavior diverge across modules.

---

## 9. Not-Now Enforcement

Stop or defer the following unless they directly unblock the active board:
- premature microservices splitting
- broad self-serve launch work
- decorative AI/copilot additions without action leverage
- giant scenario-editor expansion before narrow scenario workflow closure
- broad aerial UI before contract definition
- advanced MATSim work before practical AequilibraE and scenario write-back closure
- land-use/LUTI expansion before the shared scenario spine and flagship loops are stable

---

## 10. Bottom Line

This board exists to keep OpenPlan from becoming a pile of impressive but disconnected capabilities.

The right next move is not “add more features.”
The right next move is to close the RTP flagship loop so completely that it becomes the template for every other operating system in the product.

After that, the sequence is clear:
- Grants OS
- Modeling write-back
- Aerial evidence integration
- Runtime expansion
- UX coherence and proof hardening

That is how OpenPlan becomes calm, integrated, and genuinely hard to replace.
