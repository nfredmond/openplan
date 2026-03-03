# OpenPlan Ship Week Day 1 — Geospatial QA Gate (Priya Lane)

- **Date (PT):** 2026-03-01
- **Owner:** Priya Nanduri (GIS)
- **Ship posture:** v1 pilot trust protection (P0-first)
- **Applies to:** planner report outputs, council packet maps, web map exports, motion-ready layer exports

---

## 1) v1 Scope Constraints (In / Out)

### IN (must-ship this week)
1. **Geometry ingest hard gate**
   - WGS84 bounds validation + closed-ring checks for corridor polygon ingestion.
2. **Source traceability metadata in analysis outputs**
   - Source tags + fetched timestamps + methods version attached to outputs.
3. **Concept-level disclaimer discipline**
   - All external-facing map/report artifacts include non-engineering disclaimer + confidence caveats.
4. **Jurisdiction-agnostic framing (nationwide U.S.)**
   - Language supports municipalities, counties, county-equivalents, tribal, regional commissions, state agencies.
5. **Minimum cartographic QA pass**
   - CRS/legend/readability/accessibility/metadata checks logged before release.

### OUT (defer unless directly needed to close P0)
1. Full QGIS MCP orchestration baseline (CLI-first path remains canonical for now).
2. Complete state-by-state crash adapter parity (beyond current configured adapters/fallbacks).
3. Advanced topology cleaning for all future canonical layers (beyond current ingest gate and baseline checks).
4. Full dynamic tile stack/performance tuning for high-scale production usage.
5. Cosmetic cartography enhancements not tied to trust/readability/compliance.

---

## 2) Geospatial QA Gate (v1 Ship Gate)

## PASS requires all checks below

### A. Spatial integrity gate (required)
- [ ] Geometry valid for ingest type (Polygon/MultiPolygon as applicable)
- [ ] WGS84 coordinate sanity pass
- [ ] No critical geometry corruption in output maps

### B. Provenance + methods gate (required)
- [ ] Methods version present
- [ ] Source snapshots include source + fetchedAt at minimum
- [ ] Jurisdiction token/classification included
- [ ] Confidence/caveat statement present

### C. Cartographic readability gate (required)
- [ ] Title/subtitle clearly state place + metric + timeframe
- [ ] Legend correctly matches encoded values
- [ ] Labels legible at published size
- [ ] Required context elements present (scale/north/context note where needed)

### D. Accessibility gate (required)
- [ ] Contrast acceptable for core text/symbols
- [ ] Critical meaning not encoded by color alone
- [ ] Major classes remain distinguishable in common color-vision deficiency scenarios

### E. Release caveat gate (required)
- [ ] Concept-level/non-engineering disclaimer included
- [ ] Any fallback source usage explicitly labeled as reduced confidence

**Gate policy:** Any unresolved P0 defect = **NO-GO / HOLD**.

---

## 3) P0 Geospatial Risk Flags (Day 1)

### P0-R1 — State/jurisdiction source variability can misstate confidence
- **Risk:** Non-uniform crash/safety source depth across states/jurisdictions can produce overconfident outputs if not labeled.
- **Impact:** Pilot trust + external defensibility risk.
- **Mitigation (must-ship):** Force confidence label + source adapter disclosure in every external metric/map package.

### P0-R2 — Missing canonical local layers for some jurisdictions
- **Risk:** Incomplete curb/ADA/intersection inputs can produce misleading precision.
- **Impact:** Decision-quality degradation for council/pilot outputs.
- **Mitigation (must-ship):** Hold external claims to concept-level language; block hard target claims without required layers.

### P0-R3 — Metadata omission risk at export boundary
- **Risk:** Map/report artifacts exported without provenance/method tags.
- **Impact:** Auditability failure; external release vulnerability.
- **Mitigation (must-ship):** Release checklist requires metadata block + disclaimer before ship sign-off.

### P0-R4 — Jurisdiction framing drift (region-limited wording)
- **Risk:** Legacy wording implies NorCal-only scope despite nationwide directive.
- **Impact:** Positioning inconsistency + governance conflict.
- **Mitigation (must-ship):** Enforce nationwide wording + county-equivalent/tribal/state-regional applicability in active GIS docs.

---

## 4) Evidence Paths (current)

- Baseline decision (QGIS CLI vs MCP):
  - `openplan/docs/ops/2026-02-28-team/24-1-qgis-automation-baseline-decision.md`
- Cartographic QA rubric seed:
  - `openplan/docs/ops/2026-02-28-team/23-2-cartographic-qa-rubric.md`
- Sample map output checklist:
  - `openplan/docs/ops/2026-02-28-team/23-3-sample-map-output-checklist.md`
- Jurisdiction coverage addendum:
  - `openplan/docs/ops/2026-02-28-team/22-jurisdiction-coverage-addendum.md`
- National directive reference:
  - `openplan/docs/ops/2026-02-28-team/20-us-national-expansion-directive.md`

---

## 5) Day 1 Ship Recommendation (GIS lane)

- **Internal ship-week status:** READY with caveats.
- **External council-grade ship status:** CONDITIONAL (requires full PASS on all required gates above; unresolved P0 triggers HOLD).
