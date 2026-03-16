# OpenPlan Modeling Engine Options Note

Date: 2026-03-15  
Owner: Bartholomew / architecture support  
Status: Decision-support note — not an active implementation directive

## Why this note exists

OpenPlan’s original vision explicitly included a chained-activity model process and transportation demand modeling. At the same time, the current live priority is still product hardening, auth closure, and proving the planning workflow in production. This note is meant to support engine selection without creating a side quest.

This recommendation is grounded in OpenPlan’s existing repo direction:
- original platform vision: demand modeling + planning + engagement in one system
- prior research: activity-based modeling is strategically important, but operationally heavy
- current rollout discipline: **do not pull full ABM into MVP before the product spine is stable**
- blueprint direction: Phase 4 is **containerized managed model runs + output warehouse**, not a giant modeling rewrite inside the app

---

## Bottom line

**Recommendation:**
1. **Wrap AequilibraE first** as OpenPlan’s first practical managed modeling engine.
2. **Plan ActivitySim as the first serious chained-activity / ABM layer** once the run pipeline, data contracts, and provenance model are stable.
3. **Treat MATSim as a later advanced option**, not the first backbone choice.
4. **Treat SUMO as a specialist downstream operations tool**, not the core modeling backbone.

If Nathaniel wants a product-oriented answer in one sentence:

> Build the first OpenPlan modeling wrapper around **AequilibraE** because it is the fastest path to useful, traceable, scenario-ready network runs inside the current Python/PostGIS-friendly stack; then add **ActivitySim** when OpenPlan is ready for true chained-activity demand modeling.

---

## What each engine is best at

| Engine | Best at | What it is not best at |
|---|---|---|
| **AequilibraE** | Network prep, skimming, traffic/transit assignment, matrix handling, accessibility/sketch planning workflows | Full activity-based demand modeling by itself |
| **ActivitySim** | Tour-based / chained-activity demand modeling; household/person choice modeling; MPO-style ABM workflows | Detailed dynamic traffic simulation or corridor operations |
| **MATSim** | Large-scale agent-based multimodal simulation with network feedback, policy experimentation, dynamic behavior, DRT/AV/fleet extensions | Low-friction productization for a small SaaS team under delivery pressure |
| **SUMO** | Microscopic/mesoscopic traffic operations, intersections, signal timing, corridor operations, vehicle-level simulation | Regional planning backbone or first-choice demand model engine |

---

## Strategic fit for OpenPlan

### 1) AequilibraE
**Strategic fit: strong for near-term OpenPlan.**

Why it fits:
- It is the most natural bridge from OpenPlan’s current stack into real managed model runs.
- Python + geospatial workflows are a better match for the current operating environment than introducing a large Java-first simulation stack immediately.
- It supports the kind of outputs OpenPlan can actually use soon: skims, assignments, accessibility surfaces, scenario comparisons, and reproducible run artifacts.
- It can serve as the **run-contract proving ground** for the Phase 4 blueprint idea: containerized runs, versioned configs, stored outputs, and traceable evidence.

Best OpenPlan role:
- **First wrapped engine for managed runs**
- Network/accessibility/scenario engine
- Foundation layer that later supports ActivitySim inputs/outputs

### 2) ActivitySim
**Strategic fit: strongest fit to OpenPlan’s original chained-activity vision.**

Why it fits:
- OpenPlan’s original modeling vision was explicitly tour-based and chained-activity oriented.
- ActivitySim is the clearest match to that vision and is credible in the North American planning domain.
- It gives OpenPlan a serious answer to “where does the demand model live?” for plan/scenario evaluation.
- It aligns better than SUMO with the product’s planning use case and better than MATSim with the current need for planning-grade—not simulation-lab-grade—execution.

Best OpenPlan role:
- **Primary future ABM / chained-activity engine**
- Demand-generation and choice layer feeding OpenPlan scenario evaluation
- Medium-term backbone component once data and ops maturity exist

### 3) MATSim
**Strategic fit: promising but not first.**

Why it fits:
- MATSim is powerful when the product needs **dynamic agent behavior plus network feedback**, not just static demand outputs.
- It becomes especially attractive if OpenPlan expands into demand-responsive transit, shared mobility, AVs, freight, or richer multimodal operational simulation.
- It could become a differentiator for advanced clients if OpenPlan eventually wants a stronger “digital twin” posture.

Why it is not the first fit:
- It adds substantial integration and operational complexity before OpenPlan has even finished stabilizing its core product spine.
- It is better suited to a later stage where OpenPlan already has durable run orchestration, scenario data contracts, and funded advanced-modeling demand.

Best OpenPlan role:
- Advanced simulation tier for selected clients or later product phases
- Potential future backbone for dynamic multimodal simulation if that becomes a real commercial lane

### 4) SUMO
**Strategic fit: useful, but narrow.**

Why it fits:
- SUMO is excellent when OpenPlan needs corridor-level or intersection-level operations analysis.
- It could be valuable for validating plan recommendations in specific places: signal timing, bus priority, lane reallocation, queueing, or work-zone effects.
- It pairs better as a **specialized downstream validator** than as a primary model engine.

Why it is not the backbone:
- SUMO does not solve OpenPlan’s core planning need around regional demand modeling or chained-activity model structure.
- It requires highly detailed network preparation and calibration that do not map cleanly to a generalized SaaS workflow for small/rural agencies.
- It risks pushing OpenPlan toward traffic-ops complexity before the planning product is mature enough to absorb it.

Best OpenPlan role:
- Corridor operations module
- Optional downstream simulation tool for specific project types
- Not the core modeling backbone

---

## Shortcomings, integration burden, and operational complexity

| Engine | Main shortcomings | Integration / ops burden |
|---|---|---|
| **AequilibraE** | Not a full ABM; less compelling if OpenPlan wants tour-based behavior immediately | **Low to moderate** relative to the others; easiest first operational fit |
| **ActivitySim** | Heavy data requirements, calibration burden, not plug-and-play for small agencies, usually needs supporting skim/assignment infrastructure | **Moderate to high**; justified only after run contracts and data governance are stable |
| **MATSim** | Larger conceptual and operational leap; Java ecosystem; more complex deployment, debugging, and product abstraction | **High**; strong upside, but only worth it once OpenPlan has a mature modeling lane |
| **SUMO** | Too operational/microscopic for backbone use; can become a rabbit hole of network detail and calibration | **High for the value returned** if used too early |

### Practical burden callout
The hardest part is not just “running the engine.” It is building the surrounding product system:
- scenario snapshotting
- input data versioning
- run orchestration
- status/log capture
- output normalization
- provenance and review metadata
- repeatable packaging into plans, programs, and reports

That surrounding system is exactly why OpenPlan should **not** start with the most complex engine first.

---

## Recommended phased adoption order

### Phase 1 — AequilibraE
**Objective:** prove OpenPlan can manage real model runs end-to-end.

Use it to establish:
- versioned run configs
- network snapshot inputs
- managed execution
- output warehouse pattern
- run-to-plan/report linkage
- operator review and provenance workflow

This phase gives OpenPlan real modeling credibility without overcommitting to full ABM too early.

### Phase 2 — ActivitySim
**Objective:** add the first true chained-activity / ABM capability.

Bring it in only after OpenPlan has:
- stable run orchestration
- durable data provenance
- clear scenario contracts
- a credible need for tour-based modeling in real workflows

This is the right moment to realize the original chained-activity vision.

### Phase 3 — MATSim
**Objective:** expand into dynamic multimodal simulation where network feedback matters.

Only pursue if one of the following becomes true:
- a pilot/customer explicitly needs advanced agent simulation
- OpenPlan wants deeper digital twin capability
- DRT/shared mobility/AV/fleet behavior becomes a real commercial differentiator

### Phase 4 — SUMO
**Objective:** use as a targeted specialist tool for operational validation.

Good use cases:
- corridor redesign validation
- signal/intersection studies
- queue/spillback questions
- bus priority or work-zone operational testing

Not a default engine; a specialist attachment.

---

## What OpenPlan should wrap first

**Clear recommendation: wrap AequilibraE first.**

### Why AequilibraE should be first
1. **Fastest path to useful product value**  
   It can produce outputs OpenPlan can actually surface soon: assignments, skims, accessibility measures, scenario comparisons, and reproducible run artifacts.

2. **Best fit with current delivery reality**  
   OpenPlan is still closing core auth/prod-QA and validating the planning workflow. AequilibraE adds capability without requiring a massive new platform commitment.

3. **Creates the right abstraction layer**  
   If OpenPlan can successfully wrap AequilibraE behind a clean run contract, it will be much easier later to add ActivitySim and MATSim without redesigning the product.

4. **Supports, rather than distracts from, the chained-activity future**  
   Starting with AequilibraE does **not** mean giving up on ActivitySim or MATSim. It means building the plumbing first so those engines can be integrated cleanly later.

### What *not* to wrap first
- **Do not wrap SUMO first.** It is too specialized and operationally expensive for the value it unlocks at this stage.
- **Do not make MATSim the first backbone move.** It is attractive, but premature.
- **Do not jump straight to ActivitySim without the run-management layer.** That would likely recreate the “too much too soon” failure pattern already seen in prior attempts.

---

## Architecture implication for OpenPlan

OpenPlan should treat model engines as **pluggable managed-run adapters**, not as logic embedded directly into the web app.

A minimal shared contract should cover:
- input bundle reference
- scenario/project/plan anchors
- versioned config
- execution status + logs
- normalized output manifest
- provenance/review metadata

That approach keeps OpenPlan product-first and allows multiple engines to coexist over time:
- **AequilibraE** for early practical runs
- **ActivitySim** for chained-activity demand modeling
- **MATSim** for advanced dynamic simulation
- **SUMO** for detailed operational studies

---

## Final recommendation

If OpenPlan wants a serious modeling backbone without derailing the current ship lane, the right answer is:

- **Near-term backbone:** OpenPlan-managed runs + **AequilibraE**
- **First true chained-activity engine:** **ActivitySim**
- **Advanced future option:** **MATSim**
- **Specialist operational validator:** **SUMO**

That sequence best matches the product, the original vision, and the current operational reality.
