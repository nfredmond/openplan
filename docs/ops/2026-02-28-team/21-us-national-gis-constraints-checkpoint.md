# U.S. National Expansion — GIS Lane Constraint Checkpoint
Date: 2026-02-28 (PT)
Owner: Priya (GIS)

## Scope alignment status
- ✅ Method/docs language updated to support nationwide U.S. jurisdiction contexts.
- ✅ Added explicit references to county-equivalents and tribal contexts in GIS packet docs.
- ✅ Added national jurisdiction token standards for export naming/metadata.

## Key constraints (active)
1. **State-by-state crash-data variability**
   - Current runtime has strong CA path (SWITRS adapter) + national fallback.
   - Constraint: non-CA states may rely on coarser sources unless state adapters are added.

2. **Jurisdiction taxonomy enforcement not fully runtime-bound yet**
   - Docs now require `municipality/county/county-equivalent/tribal/rtpa/state-dot` classification.
   - Constraint: enforcement in all API/export payloads is partially pending.

3. **Tribal data sovereignty/availability differences**
   - Constraint: some tribal-context datasets may require authority-specific access or custom handling.

4. **Schema heterogeneity across agencies**
   - Constraint: regional/state agency datasets vary in field conventions and refresh cadence.

## Mitigation track (next)
- Add export-time assertion that jurisdiction token is present.
- Add per-state crash adapter roadmap with confidence labels.
- Add tribal/county-equivalent metadata assertions in council export QA.

## Go/No-Go implication
- Internal concept-level analytics remain GO with caveats.
- External council-grade packet remains HOLD until canonical layer and jurisdiction-tag enforcement gates are fully satisfied.
