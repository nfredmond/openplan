# Lane 23 — QGIS Automation Baseline Decision (CLI vs MCP)

- **Date (PT):** 2026-02-28
- **Owner:** Priya (GIS)
- **Decision scope:** baseline automation path for Lane 23 geospatial story fabric
- **Related board:** `24-geospatial-story-fabric-governance-board.md`

## Decision
**Adopt QGIS CLI (`qgis_process`) as Phase 1 baseline.**

### Why
1. Deterministic, script-first execution supports reproducibility and CI-style QA.
2. Better fit for one-command `story-pack` pipeline integration and auditable logs.
3. Current environment has **no QGIS MCP configured**, and governance board already marks MCP as deferred.

## Option analysis
### Option A — QGIS CLI baseline (selected)
- Pros:
  - deterministic command contract (`qgis_process run ...`)
  - straightforward integration with batch jobs and manifest logging
  - easier for smoke suites and release gates
- Cons:
  - requires local QGIS toolchain install/configuration
  - fewer interactive affordances than MCP UI-first workflows

### Option B — QGIS MCP baseline (deferred)
- Pros:
  - interactive orchestration and potentially richer tool mediation
- Cons:
  - not currently installed/configured
  - introduces additional runtime dependency before baseline output lane is stable
  - increases unknowns for tonight’s board deadlines

## Phase plan
- **Phase 1 (now):** QGIS CLI baseline + workflow docs + QA rubric integration.
- **Phase 2 (after baseline stability):** evaluate MCP adapter for orchestration convenience.

## Acceptance criteria (Phase 1)
1. `qgis_process` available in runtime.
2. One sample processing chain runs headless with captured logs.
3. Output package includes provenance metadata and QA rubric status.

## Known constraints
1. `qgis_process` is currently absent in runtime.
2. QGIS MCP server is not present in current MCP stack.

## Evidence references
- `docs/ops/2026-02-28-team/evidence/24-1-qgis-process-presence.txt`
- `docs/ops/2026-02-28-team/evidence/24-1-mcporter-server-list.txt`
- `docs/ops/2026-02-28-team/23-2-cartographic-qa-rubric.md`
