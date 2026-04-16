# OpenPlan Owner Execution Board

**Date:** 2026-04-16  
**Owner:** Bartholomew Hale  
**Status:** Active owner-by-owner execution board  
**Purpose:** translate the integrated execution program into exact owner queues, dependencies, proof artifacts, and stop conditions for the next build chapter.

## Executive Read

This board exists to answer one question clearly:

**Who does what next, in what order, with what proof requirement?**

The governing order remains:
1. RTP flagship loop closure
2. Grants OS first-class integration
3. Modeling write-back into planning truth
4. Aerial evidence contract and first integration slice
5. Workspace runtime and control-room hardening
6. UX coherence and proof hardening

No owner should broaden scope outside that sequence unless a blocker explicitly requires it.

---

## Shared Rules

### Rule 1. Every task needs five fields
Each active task must name:
- owner
- dependency
- acceptance criteria
- validation step
- proof artifact

### Rule 2. Proof is mandatory
If a task changes product truth, it must leave behind current proof under `docs/ops/` or focused automated coverage.

### Rule 3. Close vertical slices
Do not scatter partial changes across five modules without finishing the operator loop.

### Rule 4. Shared semantics first
If a task touches readiness, freshness, review, release, evidence, or next action, it must use shared helpers or update them.

### Rule 5. Do not trample unrelated work
When committing, isolate the relevant files and do not sweep in unrelated changes.

---

## Program Command View

| Lane | Primary owner | Current posture | Next gate |
|---|---|---|---|
| RTP flagship loop | Iris | Active, highest priority | first fully closed operator loop |
| Grants OS | Owen | Ready to advance after RTP | workspace operating lane + write-back |
| Modeling write-back | Priya | Active design + integration lane | downstream planning consequence |
| Aerial evidence | Bartholomew | Contract-first | first linked project/report evidence path |
| Runtime/control room | Iris | Narrow but real | action registry + re-grounding contract |
| UX coherence | Mateo | Continuous | touched surfaces feel like one workbench |
| Planning QA | Elena | Embedded reviewer | current-cycle PASS/HOLD truth at each gate |

---

## Owner Queue — Iris Chen
**Role:** Primary implementation owner  
**Primary mission:** finish RTP properly, then carry grants/runtime integration through shared platform code.

### Active priority order
1. RTP first-packet create → generate → re-ground
2. RTP packet semantics normalization
3. Grants workspace lane hardening
4. Grants write-back into project/RTP/control truth
5. Runtime action registry and re-grounding hardening
6. Shared implementation support for modeling and aerial integration

### Exact tickets

#### IRIS-1. Close RTP first-packet execution path everywhere
- **Dependency:** existing reports create/generate seams
- **Acceptance criteria:** one action path takes a cycle from `No packet` to generated artifact and stable post-action state
- **Validation:** focused tests + build + browser smoke on RTP flow
- **Proof artifact:** RTP proof refresh memo or screenshot set

#### IRIS-2. Normalize packet posture semantics across touched surfaces
- **Dependency:** IRIS-1
- **Acceptance criteria:** registry, cycle detail, report detail, and runtime use the same current/stale/blocked/review language
- **Validation:** focused tests on posture helpers + UI review
- **Proof artifact:** semantics reconciliation note

#### IRIS-3. Harden `/grants` as the canonical workspace operating lane
- **Dependency:** RTP closure stable enough not to compete for top attention
- **Acceptance criteria:** `/grants` surfaces opportunity queue, decision posture, and funding triage from one workspace view
- **Validation:** route tests + browser smoke
- **Proof artifact:** grants workspace lane note

#### IRIS-4. Implement grants write-back into project, RTP, and command queue truth
- **Dependency:** IRIS-3
- **Acceptance criteria:** a meaningful grant change updates downstream project/RTP/control posture visibly
- **Validation:** focused tests on write-back helpers + smoke across linked surfaces
- **Proof artifact:** grants write-back proof note

#### IRIS-5. Formalize runtime action registry and post-action re-grounding contract
- **Dependency:** shared semantics stabilized in RTP and grants lanes
- **Acceptance criteria:** action classes and re-grounding behavior are explicit, reusable, and auditable
- **Validation:** tests on action helpers + one executed action smoke
- **Proof artifact:** runtime action contract note

### Stop conditions
- Stop if a fix starts inventing page-local semantics that contradict shared helpers.
- Stop if a slice broadens UI without closing a real operator loop.
- Stop if the task starts drifting into Aerial breadth before object contracts exist.

---

## Owner Queue — Owen Park
**Role:** Grants/compliance operating model owner  
**Primary mission:** make Grants OS operationally real, not tracker theater.

### Active priority order
1. funding program catalog contract
2. opportunity decision model
3. award/match/reimbursement posture model
4. compliance milestone skeleton
5. closeout posture and legal/compliance guardrails

### Exact tickets

#### OWEN-1. Define the canonical funding program catalog fields
- **Dependency:** none
- **Acceptance criteria:** source agency, cadence, eligibility, match expectations, deadline posture, and evidence links are explicit
- **Validation:** field contract review with Iris and Bartholomew
- **Proof artifact:** grants catalog contract note

#### OWEN-2. Define pursue / monitor / skip decision standards
- **Dependency:** OWEN-1
- **Acceptance criteria:** each decision state has required reason, owner, timing posture, and next-action rule
- **Validation:** decision rubric review against current `/grants` implementation
- **Proof artifact:** grants decision rubric memo

#### OWEN-3. Define award, match, reimbursement, and invoice posture semantics
- **Dependency:** OWEN-1
- **Acceptance criteria:** these states are distinct, legible, and capable of writing back into project/control truth
- **Validation:** semantics review with Elena and Iris
- **Proof artifact:** grants control semantics memo

#### OWEN-4. Define compliance milestone and closeout skeleton
- **Dependency:** OWEN-3
- **Acceptance criteria:** compliance does not overclaim automation, but establishes a truthful skeleton for milestones, missing items, and closeout posture
- **Validation:** review for legal/compliance honesty
- **Proof artifact:** compliance skeleton note

### Stop conditions
- Stop if grant language implies legal-grade automation that does not yet exist.
- Stop if reimbursement/compliance concepts are defined in a way that cannot write back into shared control posture.

---

## Owner Queue — Priya Nanduri
**Role:** Modeling truth owner  
**Primary mission:** make model outputs matter in operator-facing planning truth.

### Active priority order
1. packet-basis invalidation logic
2. comparison snapshot reuse
3. project prioritization write-back
4. grant-readiness evidence hooks
5. caveat/confidence discipline

### Exact tickets

#### PRIYA-1. Define the exact conditions under which scenario/run changes invalidate packet basis
- **Dependency:** current RTP packet posture helpers
- **Acceptance criteria:** invalidation conditions are explicit and narrow enough to be trustworthy
- **Validation:** review with Iris and Elena against existing packet semantics
- **Proof artifact:** packet-basis invalidation rule note

#### PRIYA-2. Define reusable comparison evidence outputs
- **Dependency:** PRIYA-1 not strictly required, but helpful
- **Acceptance criteria:** comparison snapshots can support more than one surface without semantic drift
- **Validation:** review across reports, RTP, and project prioritization contexts
- **Proof artifact:** comparison reuse memo

#### PRIYA-3. Define planner-facing interpretation copy rules
- **Dependency:** PRIYA-2
- **Acceptance criteria:** methods, caveats, and confidence remain visible wherever model evidence is shown
- **Validation:** surface copy review with Elena and Mateo
- **Proof artifact:** model evidence language note

#### PRIYA-4. Specify grant-readiness evidence hooks
- **Dependency:** OWEN-2 and PRIYA-2
- **Acceptance criteria:** model evidence can support grant readiness without overstating predictive certainty
- **Validation:** grants/model joint review
- **Proof artifact:** grant-readiness evidence memo

### Stop conditions
- Stop if a requested UI feature hides confidence or caveat posture.
- Stop if modeling claims outrun proven engine behavior.
- Stop if downstream write-back becomes hand-wavy instead of rule-based.

---

## Owner Queue — Mateo Ruiz
**Role:** UX coherence and operator clarity owner  
**Primary mission:** keep touched surfaces calm, scannable, and consistent while integration deepens.

### Active priority order
1. RTP touched-surface coherence
2. grants workbench coherence
3. shared status language review
4. workspace command queue clarity
5. screenshot review and known-issues logging

### Exact tickets

#### MATEO-1. Review RTP registry, cycle detail, and report detail as one workbench
- **Dependency:** IRIS-1 and IRIS-2 slices ready for review
- **Acceptance criteria:** the user can scan, inspect, and act without feeling route fragmentation
- **Validation:** screenshot review at key viewports
- **Proof artifact:** RTP UI coherence note

#### MATEO-2. Review `/grants` as a real operating lane
- **Dependency:** IRIS-3 first implementation slice
- **Acceptance criteria:** the grants lane behaves like a workbench, not a card pile or passive registry
- **Validation:** viewport review + operator-flow critique
- **Proof artifact:** grants UI coherence note

#### MATEO-3. Audit touched status language across modules
- **Dependency:** ongoing
- **Acceptance criteria:** no stray local synonyms for freshness, review, blocked, current, or next action remain on touched screens
- **Validation:** UI text audit
- **Proof artifact:** status-language cleanup note

#### MATEO-4. Maintain known-issues register for integrated flows
- **Dependency:** ongoing
- **Acceptance criteria:** real UI issues are captured with severity, owner, and disposition rather than lost in chat
- **Validation:** weekly review with Bartholomew
- **Proof artifact:** known-issues markdown artifact

### Stop conditions
- Stop if design work drifts into decorative polish that does not improve task flow.
- Stop if touched screens regress into card/chip sprawl that weakens scanability.

---

## Owner Queue — Elena Marquez
**Role:** Principal planning QA  
**Primary mission:** keep the product operationally truthful, planner-safe, and governance-clean.

### Active priority order
1. RTP semantics and public-review foundation review
2. grants operating truth review
3. modeling interpretation and caveat review
4. gate decisions on integrated loops

### Exact tickets

#### ELENA-1. Review RTP packet posture semantics
- **Dependency:** IRIS-2
- **Acceptance criteria:** review/release/current/stale/blocked language is planner-legible and consistent
- **Validation:** artifact review + targeted product walkthrough
- **Proof artifact:** approval note or requested changes memo

#### ELENA-2. Review RTP public-review/comment-response foundation
- **Dependency:** RTP public review slice ready
- **Acceptance criteria:** review posture is bounded, honest, and operationally meaningful
- **Validation:** flow walkthrough
- **Proof artifact:** public review QA note

#### ELENA-3. Review Grants OS operating truth
- **Dependency:** OWEN and IRIS grants foundation slices
- **Acceptance criteria:** grants posture genuinely supports planning operations and does not mislead about compliance maturity
- **Validation:** grants lane review
- **Proof artifact:** grants QA note

#### ELENA-4. Review modeling-backed planning claims
- **Dependency:** PRIYA-3 / PRIYA-4 and implementation slices
- **Acceptance criteria:** planner-facing wording stays accurate, caveated, and decision-useful
- **Validation:** surface review
- **Proof artifact:** modeling claim note

### Stop conditions
- Stop and hold a lane if the product starts implying certainty or compliance maturity that has not been proven.

---

## Owner Queue — Bartholomew Hale
**Role:** COO / orchestration owner  
**Primary mission:** sequence the work ruthlessly, maintain artifacts, and keep the product honest.

### Active priority order
1. maintain the canonical program and board artifacts
2. keep not-now boundaries intact
3. define aerial evidence contracts
4. reconcile proof, docs, and current truth
5. cut scope when integration quality drops

### Exact tickets

#### BART-1. Maintain the canonical execution documents
- **Dependency:** ongoing
- **Acceptance criteria:** active board, integrated program, and roadmap docs remain aligned
- **Validation:** cross-doc review after meaningful changes
- **Proof artifact:** dated doc updates

#### BART-2. Define the aerial evidence contract
- **Dependency:** none, but implementation should wait until earlier waves stabilize
- **Acceptance criteria:** mission, AOI, ingest, processing, QA, measurable output, and share package objects are explicit
- **Validation:** contract review with Iris and Mateo
- **Proof artifact:** aerial evidence contract memo

#### BART-3. Maintain integrated proof discipline
- **Dependency:** ongoing
- **Acceptance criteria:** each major loop has a current proof artifact or explicit bounded note
- **Validation:** periodic proof inventory review
- **Proof artifact:** refreshed proof notes and README links

#### BART-4. Run scope control
- **Dependency:** ongoing
- **Acceptance criteria:** side quests are cut quickly when they do not improve loop closure, write-back, or coherence
- **Validation:** weekly review against active board
- **Proof artifact:** board updates and deferred-work notes

---

## 10-Day Suggested Cadence

## Days 1–2
- Iris: RTP first-packet closure
- Elena: review RTP semantics as they settle
- Mateo: RTP touched-surface coherence review
- Bartholomew: capture proof and board updates

## Days 3–4
- Iris: RTP semantics normalization and public-review foundation
- Priya: packet-basis invalidation rules finalized
- Elena: RTP public-review and packet posture review
- Mateo: status-language audit on RTP surfaces

## Days 5–6
- Owen: grants catalog + decision model locked
- Iris: `/grants` workbench slice
- Priya: comparison evidence reuse rules
- Bartholomew: grants/model integration notes

## Days 7–8
- Iris: grants write-back into project/RTP/control room
- Owen: reimbursement/compliance posture review
- Priya: grant-readiness evidence hooks
- Mateo: grants workbench review
- Elena: grants truth review

## Days 9–10
- Bartholomew: aerial evidence contract draft
- Iris: runtime action registry and re-grounding contract
- Mateo: workspace command queue coherence review
- Elena: gate review of integrated progress

---

## Phase Gates

## Gate A — RTP loop closure
All must be true:
- first-packet create/generate/re-grounding is real
- packet semantics are normalized across touched surfaces
- packet-basis invalidation is demonstrated
- at least one public-review foundation path exists
- RTP proof artifact is refreshed

## Gate B — Grants foundation is real
All must be true:
- workspace grants lane exists and is operable
- pursue/monitor/skip decisions are real
- award/match/reimbursement/compliance skeleton is real
- grants changes write back into project/RTP/control posture
- one proof note shows the downstream consequence

## Gate C — Modeling write-back is consequential
All must be true:
- at least one model/scenario change visibly affects planning posture
- comparison evidence is reusable across multiple surfaces
- planner-facing caveat/confidence language is intact
- one proof note shows downstream planning impact

---

## Bottom Line

This board is the operational version of the strategy.

It tells the team exactly what to do next and what counts as done.

The standard is simple:
- close the RTP flagship loop,
- make Grants OS real,
- make modeling consequential,
- define and connect aerial evidence,
- harden the runtime,
- and keep the whole product calm, honest, and integrated.
