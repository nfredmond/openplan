# OpenPlan Pilot Demo Script (10–15 minutes)

## Objective
Show a transportation agency or tribal partner a complete corridor workflow:
1) corridor upload, 2) automated analysis, 3) grant-ready narrative/report output.

## Prerequisites (2 minutes before meeting)
- App running (`pnpm dev`) and reachable in browser.
- Test user account available.
- Environment configured:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `CENSUS_API_KEY`
  - `ANTHROPIC_API_KEY` (optional but recommended)
- Sample file: `docs/samples/demo-corridor-grass-valley.geojson`

## Demo Flow

### 1) Setup + framing (1 minute)
- Open `/sign-in` and log in.
- Explain value proposition: “From corridor boundary to defensible grant narrative in minutes.”

### 2) Corridor upload + run (3 minutes)
- Open `/explore`.
- Upload `docs/samples/demo-corridor-grass-valley.geojson`.
- Enter prompt, e.g.:
  - “Evaluate this corridor for ATP/SS4A safety and equity funding readiness.”
- Click run/analyze.

### 3) Explain results (4 minutes)
- Highlight three score pillars:
  - Accessibility
  - Safety
  - Equity
- Point out sourced indicators:
  - Census demographics + commute mode
  - LODES employment
  - Transit stop coverage
  - Crash and injury indicators
  - CEJST-proxy disadvantaged tract screening

### 4) AI grant narrative (2 minutes)
- Show AI interpretation section.
- Explain fallback behavior:
  - If AI key not available, product returns deterministic summary.

### 5) Report generation (2 minutes)
- Generate report from run.
- Show sections:
  - Summary + AI interpretation
  - Demographics/commute
  - Safety and equity tables
  - Data quality notes suitable for grant appendix context

### 6) Close + pilot CTA (1 minute)
- Propose 2-week pilot:
  - 3 real corridors
  - 1 debrief workshop
  - conversion to monthly subscription on success

## Suggested Talk Track
- “You currently pay consultant rates for repeated corridor analyses. OpenPlan compresses that cycle while preserving transparent metrics and assumptions.”
- “This is not replacing planners; it is accelerating technical production and draft narrative quality for constrained teams.”

## Common Questions
- **Can we use our own corridor files?** Yes, GeoJSON polygon/multipolygon supported.
- **Can we validate assumptions?** Yes, report surfaces metric-level inputs and screening method.
- **Is this grant-specific?** Current workflow is optimized for ATP/SS4A/RAISE framing; templates can be expanded.
