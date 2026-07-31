# P2C.2 Behavioral-Demand Comparison Slice

> **DATED RECORD — 2026-03-27.** This describes what was true on the day it was written.
> It is kept because it records *why* decisions were made, which nothing else captures.
> **Do not treat any factual claim here as current** — verify against the code, the
> database, or `CHANGELOG.md` before acting on it. A stale doc that reads as current
> costs more than a missing one: on 2026-07-30 a roadmap in this folder listed two
> "remaining" items that had both already shipped, and nearly cost a full rebuild of a
> feature that already exists.


Date: 2026-03-27

This slice adds the first honest behavioral-demand comparison layer.

- Added `scripts/modeling/compare_behavioral_demand_outputs.py`.
- The script accepts either `activitysim_behavioral_kpi_summary.json` or `behavioral_demand_evidence_packet.json` on each side.
- Output is stable JSON plus markdown:
  - `behavioral_demand_comparison.json`
  - `behavioral_demand_comparison.md`
- The comparison reports:
  - shared KPI coverage
  - current-only and baseline-only exclusions
  - absolute and percent deltas only for shared numeric rows
  - blocked posture when either side is preflight-only, blocked, or otherwise not comparison-ready
  - partial-only posture when one or both sides contain partial outputs

App/API integration:

- Extended the model-run KPI comparison API so behavioral-demand runs return `behavioral_comparison` alongside comparison rows.
- The model evidence panel now surfaces:
  - available vs partial-only vs blocked behavioral posture
  - exclusion counts/messages
  - top caveats without inventing deltas

Supported cases:

- successful comparable outputs with shared rows
- preflight-only vs preflight-only
- partial-output vs full-output
- mismatched KPI coverage with shared-row-only comparison

Explicit non-claim:

- OpenPlan still does not claim calibrated behavioral forecasting.
- When artifacts are missing, preflight-only, blocked, or coverage does not overlap, the comparison stays blocked instead of manufacturing equivalence.
