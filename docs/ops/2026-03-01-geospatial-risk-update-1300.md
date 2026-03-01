# OpenPlan Day 1 — Geospatial Risk Update (for 13:00 QA Sweep)

- **Timestamp (PT):** 2026-03-01 12:08
- **Owner:** Priya (GIS)
- **Reference gate:** `openplan/docs/ops/2026-03-01-geospatial-qa-gate.md`

## Risk status summary

| Risk ID | Severity | Current status | 13:00 gate posture | Evidence |
|---|---|---|---|---|
| P0-R1 source variability confidence risk | P0 | Open (controlled by disclosure + source adapter labels) | HOLD if confidence/source disclosure missing in external artifacts | `openplan/docs/ops/2026-03-01-geospatial-qa-gate.md` |
| P0-R2 missing canonical local layers risk | P0 | Open (concept-level constraint active) | HOLD if outputs make hard-target claims without required layers | `openplan/docs/ops/2026-03-01-geospatial-qa-gate.md` |
| P0-R3 metadata omission export risk | P0 | Open (checklist-driven control in place) | HOLD if methods/source snapshot/disclaimer block absent | `openplan/docs/ops/2026-03-01-geospatial-qa-gate.md` |
| P0-R4 jurisdiction framing drift risk | P0 | Mitigated in docs, monitor at export boundary | HOLD if region-limited wording appears in ship artifacts | `openplan/docs/ops/2026-02-28-team/22-jurisdiction-coverage-addendum.md` |

## Immediate controls to verify at 13:00
1. Every geospatial artifact in ship evidence pack includes:
   - methods version,
   - source snapshot + timestamp,
   - jurisdiction token,
   - confidence/caveat statement.
2. No external-facing geospatial artifact uses engineering certainty language.
3. Nationwide applicability language remains intact for county-equivalent + tribal + state/regional contexts.

## Recommendation at 12:10
- **Geospatial lane status:** READY WITH CAVEATS
- **13:00 trigger:** Any unresolved P0 gate check in geospatial artifacts => recommend HOLD for that artifact class.
