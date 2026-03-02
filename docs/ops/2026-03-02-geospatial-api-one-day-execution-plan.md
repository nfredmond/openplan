# 2026-03-02 Geospatial API One-Day Execution Plan (Go-Ahead Mode)

## Purpose
Compress the previously phased geospatial API readiness effort into a **single 24-hour execution cycle** once both Nathaniel + Bart issue a formal GO command.

## Governance Constraint
- Until GO is issued, this remains a planning artifact only.
- No production feature implementation occurs under the current lock.

## Internet Research Inputs (validated/attempted today)
1. OSM/OSMF policy pages indicate attribution is mandatory and usage policies apply for API consumers.
2. OSMF attribution guideline emphasizes legible, proximate attribution and license linkage.
3. Geoapify pricing + pricing-details indicate credit-based billing, commercial free-plan caveat (attribution requirement), and explicit rate-limit posture.
4. openrouteservice services/restrictions document strong fallback utility for isochrones/matrix and concrete request constraints.
5. Distancematrix.ai pricing page indicates free + usage-based growth model and element-based billing.
6. Mapillary docs/terms endpoints were partially blocked by anti-bot/Meta rendering during automated fetch; policy details must be manually re-verified at GO time.

## Outcome Definition (what “everything in a day” means)
By the end of 24 hours, deliver:
1. Provider decision memo with ranked primary/secondary/deferred providers.
2. Benchmark evidence pack (raw outputs, scoring matrix, QA notes).
3. License/attribution compliance matrix with pass/fail by provider.
4. Cost model + monthly burn forecast at Low/Med/High usage.
5. Operational runbook (request templates, retries, cache policy, QA gates).
6. Go/No-Go recommendation for implementation start.

## Team Roles (execution-day)
- **GIS lane (Priya):** benchmark design, geospatial QA scoring, cartographic/legal attribution checks.
- **COO lane (Bart):** decision authority, scope control, blocker escalation.
- **Engineering lane (if authorized):** controlled script execution for benchmark automation only.
- **Principal QA lane:** independent validation of scoring outputs + reproducibility checks.

## 24-Hour Detailed Timeline

## T-0 to T+1h — Command + Preflight Freeze
- Confirm written GO from Nathaniel + Bart.
- Open war-room note and assign owners.
- Freeze benchmark geography list and test corpus.
- Freeze metric definitions (no metric changes mid-run).
- Confirm legal checklist template and attribution requirements.

Deliverables:
- `go-command-log.md`
- `benchmark-spec-v1.md`
- `license-checklist-v1.md`

## T+1h to T+3h — Query Corpus + Harness Lock
- Build fixed query corpus for:
  - forward geocoding (n>=150)
  - reverse geocoding (n>=150)
  - matrix OD cases (n>=60 scenarios)
  - isochrone cases (n>=60 scenarios)
  - POI category pulls (n>=40 scenarios)
- Lock request templates for each provider.
- Define retry policy (e.g., exponential backoff, max retries = 3).
- Define output schema for comparable scoring.

Deliverables:
- `query-corpus.json`
- `provider-request-templates.json`
- `result-schema.json`

## T+3h to T+8h — Parallel Benchmark Runs
- Execute runs by provider in fixed sequence windows.
- Capture per-call telemetry:
  - status code
  - latency
  - retries
  - response payload size
  - normalized result fields
- Run each suite twice (fresh + repeat) to detect instability.

Mandatory controls:
- No manual edits to result payloads.
- All failures retained in raw logs.
- Timestamp every batch start/stop.

Deliverables:
- `raw-results/<provider>/<timestamp>/*.json`
- `run-log.md`

## T+8h to T+11h — Quality Scoring Pass
- Geocoding scoring:
  - match rate
  - rooftop/interpolated/approx distributions where available
  - admin-level correctness checks
- Routing/matrix scoring:
  - response success
  - gross outlier detection (e.g., unrealistic durations/distances)
  - consistency across repeated runs
- Isochrone scoring:
  - geometry validity
  - topology sanity
  - expected containment checks
- POI scoring:
  - category relevance
  - duplicate rate
  - rural completeness spot-check

Deliverables:
- `scoring-matrix.csv`
- `qa-findings.md`

## T+11h to T+13h — Compliance + Attribution Audit
- For each provider, verify:
  - permitted use assumptions
  - attribution text requirements
  - link/display obligations
  - redistribution constraints
- Tag each provider as:
  - Green = clear + implementable
  - Yellow = usable with explicit controls
  - Red = unresolved legal/attribution ambiguity

Deliverables:
- `license-attribution-matrix.md`

## T+13h to T+15h — Cost + Capacity Modeling
- Build scenario model (monthly):
  - Low: pilot usage
  - Medium: initial production
  - High: scale scenario
- Calculate effective cost per useful result (not just per request).
- Include retry overhead and cache-adjusted cost.

Deliverables:
- `cost-model.xlsx` (or CSV)
- `cost-summary.md`

## T+15h to T+17h — Reliability + Ops Hardening Plan
- Create provider fallback tree:
  - Primary route
  - fallback provider
  - fail-closed behavior
- Define observability KPIs:
  - p95 latency thresholds
  - error-rate alert thresholds
  - attribution check failures
- Define cache policy by endpoint class.

Deliverables:
- `ops-runbook.md`
- `fallback-decision-tree.md`

## T+17h to T+19h — Synthesis + Decision Draft
- Compile weighted provider scorecard:
  - quality
  - reliability
  - cost
  - legal clarity
  - operational complexity
- Draft recommendation:
  - Primary stack
  - backup stack
  - deferred stack
- Explicitly list unresolved unknowns.

Deliverables:
- `decision-memo-draft.md`

## T+19h to T+21h — Independent QA Replay
- Principal QA reruns sample subset (10–15% corpus).
- Validate reproducibility of top-line metrics.
- Confirm no silent transformations.

Deliverables:
- `independent-qa-replay.md`

## T+21h to T+23h — Executive Packet Assembly
- Assemble one packet with:
  - executive summary (1 page)
  - scorecard
  - legal/attribution matrix
  - cost forecast
  - risk register
  - recommendation
- Prepare concise verbal readout script.

Deliverables:
- `executive-packet.md`
- `appendix-evidence-index.md`

## T+23h to T+24h — Final Readout + Decision
- Live review with Nathaniel + Bart.
- Final call options:
  - GO (implementation authorized)
  - GO with conditions
  - HOLD for specific gaps
- Capture decisions with owner + due date.

Deliverables:
- `final-decision-log.md`

## Success Metrics (Day-complete definition)
- 100% benchmark corpus executed for all in-scope providers (or blocked with documented reason).
- 100% outputs traceable to raw evidence files.
- 100% provider attribution requirements documented at minimum operational level.
- Recommendation accepted or returned with explicit gap list (no ambiguous status).

## Risk Register (One-day compression risks)
1. **Rate-limit/temporary bans** during benchmark bursts.
   - Mitigation: controlled pacing, retry windows, run batching.
2. **Policy ambiguity** (especially Mapillary due access friction).
   - Mitigation: manual legal verification checkpoint before recommendation finalization.
3. **False confidence from single-run benchmarks**.
   - Mitigation: duplicate runs + independent replay.
4. **Scope drift into implementation** under urgency pressure.
   - Mitigation: hard governance gate; strategy evidence only.
5. **Cost misestimation due unrealistic traffic assumptions**.
   - Mitigation: low/med/high scenario model + sensitivity analysis.

## Immediate Pre-GO Preparation (can do now, no lock violation)
- Pre-build empty template files/folders for evidence capture.
- Pre-define corpus schema and scoring schema.
- Pre-draft attribution text snippets by provider.
- Pre-book review windows with Bart for T+12h and T+23h checkpoints.

---
Prepared by: GIS lane (Priya)
Date: 2026-03-02
Status: Ready-to-run upon dual approval (Nathaniel + Bart)
