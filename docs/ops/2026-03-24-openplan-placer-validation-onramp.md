# OpenPlan Placer Validation On-Ramp

**Date:** 2026-03-24  
**Author:** Dr. Adrian Velasco, Principal Travel Demand Modeler  
**Purpose:** Convert the completed Placer transfer run into a first truth-gated validation slice quickly

## What already exists
Completed transfer run:
- `data/screening-runs/placer-county-runtime-connectorbias2-20260324/`

Manual starter validation scaffold:
- `data/pilot-placer-county/validation/placer_priority_count_scaffold.csv`

Auto-generated starter validation scaffold:
- `data/pilot-placer-county/validation/placer_priority_count_scaffold_auto.csv`

New scaffold-generation helper:
- `scripts/modeling/generate_validation_scaffold.py`

Template updated for honest mainline matching:
- `data/templates/screening_validation_station_template.csv`

## Why this matters
Placer now proves runtime portability, but it still lacks the local observed-count slice needed to say anything comparable to Nevada’s bounded screening-ready checkpoint.

The fastest path forward is to turn the scaffold into a real count file rather than rebuilding county logic.

## Current scaffold contents
The manual starter Placer station file includes runtime-seeded candidate facilities and tight-ish bounding boxes for:
- Douglas Boulevard
- Sunrise Avenue
- Auburn Folsom Road
- Grass Valley Highway
- Taylor Road
- Bell Road
- Lincoln Way

The auto-generated scaffold currently surfaces a slightly different high-volume starter set directly from the completed run:
- Alan S. Hart Freeway
- Blue Oaks Boulevard
- Grass Valley Highway
- Pleasant Grove Boulevard
- Lincoln Boulevard
- Atlantic Street
- Sierra College Boulevard

These are **not** yet validation-ready counts. They are seeded station definitions awaiting actual observed-volume values and final count-location confirmation.

## Next steps
1. Choose either the manual or auto-generated scaffold as the starting lane (or merge them).  
2. Source observed counts for the seeded Placer facilities (Caltrans/local counts).  
3. Replace `TBD` placeholders with real `count_year`, `count_type`, `observed_volume`, and precise source text.  
4. Tighten each bbox and exclusion list if interchange ambiguity exists.  
5. Run the validator against the completed CSV.  
6. If needed, use the candidate-audit outputs to correct any cross-street or ramp contamination before interpreting metrics.

## Guardrail
Do not treat the scaffold as evidence of validation. It is only an on-ramp.

The important win is workflow speed:
- the improved runtime already ran,
- the starter facilities are identified,
- and the county can now enter the same truth-gated process Nevada used.

## Bottom line
Placer is no longer blocked on modeling-runtime setup.

It is now blocked on observed-count ingestion, which is exactly the kind of bottleneck we want at this stage because it means the technical core is stabilizing and the remaining work is moving into repeatable truth-gating.
