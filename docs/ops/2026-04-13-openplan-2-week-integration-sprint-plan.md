# OpenPlan 2-Week Integration Sprint Plan

**Date:** 2026-04-13  
**Owner:** Bartholomew Hale  
**Executive sponsor:** Nathaniel Ford Redmond  
**Sprint window:** 14 days, aggressive but evidence-bound  
**Status:** Canonical near-term execution plan  
**Purpose:** convert the April 2026 OpenPlan architecture and status synthesis into a safe, ruthless 2-week build sequence that closes the highest-value integration gaps without letting scope sprawl outrun proof.

## Executive Summary

This sprint is not for random feature expansion.

It is for turning OpenPlan into a more coherent operating system by closing the next set of integrated loops in the right order.

### Sprint priorities, in order
1. **Finish RTP flagship loop closure**
2. **Make Grants OS first-class and write back into planning truth**
3. **Force Modeling OS write-back into packet, project, and grant posture**
4. **Define and land the first Aerial evidence contracts**
5. **Unify the control-room/runtime layer across modules**
6. **Run a final UX and proof-hardening pass on the integrated result**

### What success looks like at the end of 2 weeks
By sprint close, OpenPlan should be able to demonstrate:
- one completed RTP operating loop,
- one real workspace Grants OS lane,
- one visible modeling-to-planning write-back path,
- one first-class aerial evidence contract and first linked in-product evidence path,
- one stronger workspace control room with shared command posture,
- and one refreshed proof bundle showing these systems working together.

### What this sprint is not
This sprint is **not** for:
- broad self-serve launch claims,
- complete LAPM automation,
- fully mature dynamic simulation,
- full aerial UI breadth,
- or decorative redesign disconnected from product truth.

---

## Operating Rules

### Rule 1. Close loops before broadening scope
Every slice must improve workflow completion, write-back, or propagation. If not, it is out.

### Rule 2. Shared semantics are mandatory
Freshness, readiness, release, evidence, blocked status, and next action must mean the same thing across modules.

### Rule 3. Every active ticket needs proof
Each ticket must name:
- owner,
- dependency,
- acceptance criteria,
- validation step,
- and proof artifact if shipped.

### Rule 4. No silent drift
If a change affects packet posture, grant readiness, modeling evidence, or field verification, the system must say so.

### Rule 5. Do not outrun honest claims
Sprint progress can exceed documentation, but public claims may not exceed evidence.

---

## Sprint Structure

The sprint is organized into six workstreams running in one controlled sequence with limited overlap.

## Workstream A. RTP flagship loop closure
**Primary owner:** Iris Chen  
**Planning QA:** Elena Marquez  
**Support:** Mateo Ruiz, Bartholomew Hale

### Goal
Make RTP OS the first indisputably complete loop in OpenPlan.

### Scope
- first packet creation from live operating surfaces
- create + generate in one coherent flow
- post-action re-grounding
- normalized review/release semantics
- public review/comment-response foundation
- packet drift from scenario/model evidence
- fresh RTP proof bundle

### Acceptance criteria
- an operator can move from no packet to generated packet to review posture without losing context
- RTP registry, cycle detail, report detail, and runtime agree on packet posture
- at least one bounded public review/comment-response path is real
- scenario/model updates can truthfully mark a packet stale or refresh-recommended

---

## Workstream B. Grants OS first-class integration
**Primary owner:** Owen Park  
**Implementation owner:** Iris Chen  
**Support:** Elena Marquez, Bartholomew Hale

### Goal
Turn grants from distributed local surfaces into one real shared operating lane.

### Scope
- strengthen `/grants` as the canonical workspace grants surface
- opportunity calendar / board posture
- pursue / monitor / skip workflow
- award and match posture
- reimbursement and invoicing posture
- compliance milestone skeleton
- project and RTP write-back
- command-room visibility

### Acceptance criteria
- a planner can manage grants at workspace level without hunting through project detail pages
- grants posture changes project readiness and RTP financial posture visibly
- reimbursement and compliance status appear in shared operations summaries
- grants pressure is visible in the unified queue and not siloed

---

## Workstream C. Modeling write-back integration
**Primary owner:** Priya Nanduri  
**Implementation owner:** Iris Chen  
**Support:** Elena Marquez

### Goal
Make modeling outputs influence planning truth, not just exist as technical artifacts.

### Scope
- scenario/run change invalidates packet basis when appropriate
- model evidence feeds project prioritization context
- model evidence supports grant-readiness summaries
- comparison snapshots are reusable in reports and RTP surfaces
- planner-facing interpretation remains caveated and explicit

### Acceptance criteria
- at least one modeling change causes visible downstream packet or planning posture change
- comparison outputs are reusable across more than one surface
- confidence and method caveats remain visible everywhere model evidence is shown

---

## Workstream D. Aerial evidence contract and first integration slice
**Primary owner:** Bartholomew Hale  
**Implementation owner:** Iris Chen  
**UI support:** Mateo Ruiz

### Goal
Establish the first OpenPlan-native aerial evidence contract and link it into the shared project/report spine.

### Scope
- canonical object model for mission / AOI / ingest / processing / QA / measurable output / share package
- project-linkage rules
- report/evidence ledger linkage
- one first field-verification posture path in shared operations truth

### Acceptance criteria
- aerial evidence objects are explicitly defined and attached to the shared core
- at least one project can hold first-class aerial evidence in a way that reports and operators can see
- no separate “drone app truth model” is created inside OpenPlan

---

## Workstream E. Control room and runtime unification
**Primary owner:** Iris Chen  
**Product owner:** Bartholomew Hale  
**Support:** Priya Nanduri, Owen Park

### Goal
Make the control room see the whole operation more truthfully.

### Scope
- stronger workspace operations summary
- one clearer command queue across RTP / grants / reports / controls / evidence
- post-action re-grounding contracts
- approval-aware action posture
- provenance-aware outside-signal contract, if time permits

### Acceptance criteria
- users can understand what matters now across modules from one workspace-level view
- the runtime can explain what changed and what should happen next using shared module truth
- command priority is not page-fragmented

---

## Workstream F. UX coherence and proof hardening
**Primary owner:** Mateo Ruiz  
**Implementation support:** Iris Chen  
**Product QA:** Elena Marquez, Bartholomew Hale

### Goal
Make the integrated result calmer, clearer, and more trustworthy.

### Scope
- navigation and lane naming aligned with the real operating systems
- worksurface + rails discipline on touched screens
- reduce semantic drift across touched surfaces
- final proof refresh for integrated flows
- regression coverage for the highest-risk seams

### Acceptance criteria
- touched surfaces feel like one workbench, not disconnected pages
- the major next-action states are obvious
- proof artifacts exist for the sprint’s core claims

---

## Day-by-Day Plan

## Day 1. RTP execution path closure
### Primary focus
Close first-packet creation + generate loop.

### Targets
- verify and patch the RTP create + generate action path
- ensure stable post-action re-grounding
- confirm queue and report posture update truthfully

### Deliverables
- merged RTP action-path fix(es)
- test coverage for create/generate transition
- local validation artifacts

### Gate to pass
No stale “No packet” posture after successful creation/generation.

---

## Day 2. RTP release semantics and public-review foundation
### Primary focus
Normalize packet posture everywhere RTP appears.

### Targets
- unify review / current / stale / blocked / released semantics
- add bounded public review/comment-response foundation
- align runtime and registry language

### Deliverables
- shared posture semantics on all touched RTP surfaces
- first public-review foundation slice
- updated screenshots / proof notes

### Gate to pass
RTP registry, cycle detail, report detail, and runtime all agree on packet status language.

---

## Day 3. Grants OS operating surface hardening
### Primary focus
Turn `/grants` into a true workspace operating lane.

### Targets
- strengthen workspace grants board posture
- expose lead queue items cleanly
- improve award / reimbursement / invoice triage visibility
- verify project/program links remain canonical

### Deliverables
- hardened `/grants` surface
- grant decision and reimbursement triage improvements
- validation on project/program write-through

### Gate to pass
A planner can work an actual grants queue from one workspace view.

---

## Day 4. Grants write-back into RTP and controls
### Primary focus
Make grant changes affect planning truth outside `/grants`.

### Targets
- reflect funding posture in RTP financial posture
- reflect reimbursement/compliance pressure in command summaries
- ensure packet/control surfaces see funding reality

### Deliverables
- grants-to-RTP write-back improvements
- shared control-room grant pressure improvements
- proof notes for changed downstream behavior

### Gate to pass
A meaningful grant update changes RTP or project-control posture visibly.

---

## Day 5. Modeling write-back, packet basis, and comparison reuse
### Primary focus
Make scenario/model outputs affect packet and planning posture.

### Targets
- propagate scenario/run changes into packet drift or refresh posture
- tie comparison snapshots into at least two operator surfaces
- keep caveats explicit

### Deliverables
- modeling-driven packet drift path
- shared comparison reuse improvements
- regression coverage on touched seams

### Gate to pass
At least one model/scenario change causes visible downstream planning-state change.

---

## Day 6. Modeling write-back into grant and prioritization posture
### Primary focus
Broaden modeling relevance beyond packet posture.

### Targets
- attach model evidence to project prioritization context
- support grant-readiness summaries with model-backed evidence where appropriate
- improve planner-facing interpretation copy

### Deliverables
- prioritization and/or grant-readiness write-back slice
- method/caveat presentation improvements
- proof notes

### Gate to pass
Model evidence is visible as planning support, not hidden in technical pages.

---

## Day 7. Mid-sprint proof and stabilization checkpoint
### Primary focus
Pause expansion briefly and verify truth.

### Targets
- run local validation on RTP + grants + modeling seams
- review semantic consistency across touched modules
- cut or defer anything unstable

### Deliverables
- midpoint status memo
- issue list for unstable seams
- refined sprint-back-half scope

### Gate to pass
No known critical cross-system drift in the shipped/touched slices.

---

## Day 8. Aerial evidence object model
### Primary focus
Define the first OpenPlan-native aerial evidence contract.

### Targets
- finalize canonical aerial object set
- define project/report/evidence relationships
- avoid side-truth creation

### Deliverables
- aerial evidence contract doc/code scaffolding
- first schema or application-layer object implementation path
- integration plan for touched records

### Gate to pass
The aerial model is explicit enough to support one in-product evidence path.

---

## Day 9. Aerial first linked evidence slice
### Primary focus
Connect one project-linked aerial evidence path into OpenPlan.

### Targets
- link one aerial evidence type into project and report context
- surface field-verification posture in shared operations truth
- ensure artifacts join the evidence ledger pattern

### Deliverables
- first aerial evidence integration slice
- field-verification posture signal
- proof screenshots or notes

### Gate to pass
Aerial evidence is visible as project-linked operational truth, not a placeholder.

---

## Day 10. Control room unification pass
### Primary focus
Improve the workspace-level operations summary.

### Targets
- unify queue signals across RTP / grants / controls / evidence
- improve next-action posture
- reduce route-local logic where practical

### Deliverables
- stronger workspace operations summary
- shared command queue improvements
- clearer cross-module control posture

### Gate to pass
One workspace-level view can explain the next important actions across at least RTP, grants, and reporting/evidence.

---

## Day 11. Runtime action and re-grounding hardening
### Primary focus
Make the runtime more trustworthy after actions occur.

### Targets
- tighten post-action re-grounding
- improve approval-aware action framing
- ensure module actions stop leaving stale assistant posture behind

### Deliverables
- runtime hardening patches
- tests for re-grounding on high-risk actions
- updated operator language

### Gate to pass
After major actions, runtime guidance reflects the new truth without manual refresh confusion.

---

## Day 12. UX coherence pass on touched surfaces
### Primary focus
Make the integrated sprint work feel like one workbench.

### Targets
- align naming, navigation, and lane emphasis
- apply worksurface + rails discipline to touched modules
- reduce badge/card/chip drift where it obscures scanability

### Deliverables
- targeted UI coherence pass across sprint-touched surfaces
- screenshot review at key viewports
- UI QA notes

### Gate to pass
Touched modules look and behave like one operating system, not six parallel mini-products.

---

## Day 13. Proof refresh and regression pass
### Primary focus
Re-prove the sprint’s core claims.

### Targets
- run local and production-style validation where appropriate
- refresh docs/ops evidence for RTP, grants, modeling, and aerial evidence slice
- verify no major semantic regressions in touched shared helpers

### Deliverables
- refreshed proof bundle
- updated validation notes
- regression checklist result

### Gate to pass
Every major sprint claim has a current proof artifact or explicit bounded note.

---

## Day 14. Closeout, truth memo, and next-wave queue
### Primary focus
Finish cleanly and prepare the next chapter.

### Targets
- write sprint closeout memo
- summarize what became materially real
- list unresolved risks and not-now items
- prepare the next build queue

### Deliverables
- sprint closeout memo
- updated command board / README index if needed
- phase-2 follow-on queue

### Gate to pass
The sprint ends with clearer product truth, not just more code.

---

## Cross-Sprint Validation Gates

The following checks must recur during the sprint:
- relevant tests on touched seams
- local build on meaningful checkpoints
- browser verification on touched operator flows
- shared-semantics review when freshness/readiness/release logic changes
- proof-note refresh on major phase completion

### Required recurring questions
At each major checkpoint, ask:
- Did this slice close a real operator loop?
- Did it improve shared write-back?
- Did it introduce semantic drift?
- Can we prove the new claim?
- Did we accidentally broaden scope without integration value?

---

## Not-Now List

To protect the sprint, explicitly defer the following unless they become directly required blockers:
- full broad public self-serve launch work
- full LAPM or legal-grade compliance automation
- major billing/commercial expansion beyond current bounded needs
- broad consumer-facing marketing polish unrelated to sprint loops
- large standalone AI experiments detached from shared operations truth
- broad aerial UI flourishes before core integration is stable
- dynamic simulation expansion beyond what supports current planning write-back
- speculative land-use/zoning wave beyond simple contract planning

---

## Risk Register

### Risk 1. Scope sprawl
**Mitigation:** cut any slice that does not improve workflow closure, write-back, or proof.

### Risk 2. Semantic drift across modules
**Mitigation:** centralize posture/freshness/readiness helpers and review them whenever touched.

### Risk 3. Runtime becoming decorative instead of useful
**Mitigation:** require each runtime change to improve a real operator action or post-action understanding.

### Risk 4. Modeling overclaiming
**Mitigation:** keep explicit caveat and confidence language, and prove write-back before broadening claims.

### Risk 5. Aerial becoming a side product inside the app
**Mitigation:** define the shared object contract first and keep project/report/evidence linkage mandatory.

### Risk 6. QA debt from rapid pace
**Mitigation:** midpoint stabilization day, recurring proof checks, explicit closeout documentation.

---

## Bottom Line

This 2-week sprint is the safe aggressive version.

It is fast enough to materially change OpenPlan’s integrated reality, but disciplined enough to preserve proof, honest claims, and architecture quality.

If executed well, the result will not merely be “more features.”
It will be a stronger operating system with:
- a finished RTP flagship loop,
- a truly first-class Grants OS lane,
- a more consequential Modeling OS,
- the first OpenPlan-native Aerial evidence integration,
- a stronger control room,
- and a more coherent operator experience.
