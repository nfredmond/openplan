# ADR-002: Multi-Engine Modeling Stack for OpenPlan

## Status
Accepted (2026-03-17)

## Context
OpenPlan is evolving from a planning UI and analysis-adjacent platform into a more serious planning operating system with explicit model records, managed model runs, and stronger scenario/report continuity.

Current product/repo facts:

- OpenPlan now has first-class `models` and `model_runs` concepts.
- Current model family support includes:
  - `travel_demand`
  - `activity_based_model`
  - `scenario_model`
  - `accessibility`
- Current managed execution exists, but is still an early-stage orchestration layer around a single backend posture (`deterministic_corridor_v1`) and early engine keys (`aequilibrae`, `activitysim`).
- Current command-board direction explicitly calls for a future **"chained demand-model / transportation-model posture."**

OpenPlan needs a modeling architecture that can:

1. support fast, explainable planner workflows,
2. grow into behaviorally richer demand modeling,
3. support higher-fidelity dynamic simulation where justified,
4. preserve strong artifact traceability and client-safe evidence posture,
5. avoid collapsing the product into a brittle research-code monolith.

Three open-source engines are strong candidates for a combined stack:

- **AequilibraE**
- **ActivitySim**
- **MATSim**

The central architectural question is whether OpenPlan should deeply fuse these tools into one integrated engine stack or orchestrate them as bounded components.

## Decision
Adopt a **layered multi-engine modeling architecture** in which **OpenPlan remains the canonical planning/data/orchestration layer** and external modeling engines operate as bounded execution backends.

The engine roles are:

- **AequilibraE** = fast network preparation, skimming, assignment, accessibility, and GIS-friendly transport preprocessing backbone
- **ActivitySim** = behavioral demand-generation engine
- **MATSim** = advanced dynamic agent-based simulation engine

OpenPlan will expose these as **analysis/run classes**, not primarily as raw engine brands:

- **Fast screening** → AequilibraE
- **Behavioral demand** → ActivitySim + AequilibraE
- **Dynamic operations** → ActivitySim + MATSim, with AequilibraE still supporting prep/postprocessing where useful

OpenPlan will not treat MATSim as the default backend for ordinary planning workflows.

OpenPlan will not initially implement a tightly coupled all-at-once three-engine pipeline.

Instead, implementation order is:

1. **Phase 1:** AequilibraE-first production backbone
2. **Phase 2:** ActivitySim integration
3. **Phase 3:** MATSim as bounded advanced engine
4. **Phase 4:** controlled feedback loop between ActivitySim and MATSim

## Consequences

### Positive
- Preserves OpenPlan as a planner-safe product instead of a raw research harness.
- Gives OpenPlan immediate practical value through a fast AequilibraE-first lane.
- Creates a disciplined path to richer behavioral and dynamic modeling.
- Supports explicit artifact lineage, run manifests, and report-grade evidence.
- Avoids making MATSim the universal hammer for every use case.
- Keeps engine-specific complexity away from core UI/domain logic.
- Creates a clean architecture for future calibration, validation, and package-specific governance.

### Negative
- Requires more orchestration and artifact-schema work than a simple single-engine implementation.
- Introduces nontrivial adapter work, especially ActivitySim → MATSim.
- Delays any claim of a fully integrated feedback-loop stack until later phases.
- Requires careful licensing/packaging review for MATSim before deep commercialization.
- Increases platform surface area in infrastructure, queues, and run-state management.

## Implementation Notes

### Product posture
OpenPlan should package this as **analysis packages** and **run modes**, not primarily as engine names.

### Architectural posture
- OpenPlan owns projects, scenarios, models, artifacts, reports, and validation posture.
- Engines communicate through explicit artifacts and manifests.
- Long-running jobs run in worker/service boundaries, not in the web app process.
- `model_runs` should evolve into staged execution with artifact tracking rather than a single thin run row.

### Schema direction
The current `model_runs` schema is a good starting point but should be extended with:

- run stages
- artifact registry
- engine registry
- validation/calibration packet support
- adapter/runtime versioning
- queue and worker metadata

### Decision rules
- Prefer AequilibraE where a fast, explainable run answers the planning question sufficiently.
- Add ActivitySim when demand-side behavioral structure materially matters.
- Use MATSim only where dynamic network/agent effects materially change the answer.
- Never overstate model credibility beyond calibration and validation evidence.

## Related Documents
- `docs/ops/2026-03-15-openplan-v1-command-board.md`
- `docs/ops/2026-03-17-openplan-aequilibrae-activitysim-matsim-architecture-memo.md`
- `docs/ops/2026-03-17-openplan-modeling-stack-build-backlog-and-execution-plan.md`
- `docs/ops/2026-03-17-openplan-modeling-stack-technical-spec.md`
