# P2C.2 Behavioral-Demand Evidence Packet

**Date:** 2026-03-27  
**Status:** prototype implemented  
**Scope:** assemble the shipped behavioral-demand prototype chain into one auditable internal evidence/validation packet

## Purpose

This slice closes the Phase 2 requirement that one internal validation/evidence packet exists for the behavioral-demand lane.

It does not inflate the claim.

The packet builder:

- reads the shipped prototype-chain artifacts rather than inventing a new runtime contract,
- accepts a behavioral prototype manifest, county onramp manifest, or runtime directory,
- emits stable JSON and Markdown packet artifacts,
- inventories the included source artifacts and missing artifacts,
- states plainly whether the runtime stopped at preflight, failed with partial outputs, or produced a real runtime success,
- preserves explicit caveats about prototype status, calibration limits, and claim boundaries.

## Script

`scripts/modeling/build_behavioral_demand_evidence_packet.py`

Default output:

- `<behavioral_root>/evidence_packet/behavioral_demand_evidence_packet.json`
- `<behavioral_root>/evidence_packet/behavioral_demand_evidence_packet.md`

## Inputs

Exactly one of:

- `--behavioral-manifest /path/to/behavioral_demand_prototype_manifest.json`
- `--county-onramp-manifest /path/to/county_onramp_manifest.json`
- `--runtime-dir /path/to/behavioral_demand_prototype/runtime`

## Packet contents

Where available, the packet records:

- source screening run context,
- ActivitySim input bundle summary,
- runtime mode, status, and stage outcomes,
- ingestion coverage and discovered common tables,
- behavioral KPI availability and lightweight totals,
- artifact inventory and path metadata,
- explicit caveats,
- validation posture:
  - internal status: `internal prototype only`
  - outward status: `not ready for outward modeling claims`

## Honesty rules

- `preflight_only` or blocked runtime:
  - the packet says the chain only reached preflight depth
  - it does not claim behavioral runtime success
- failed runtime with discovered outputs:
  - the packet says any behavioral summaries are partial-output only
- succeeded runtime:
  - the packet still does not claim calibration, behavioral realism, county-transferable validation, or client-ready forecasting

## Example

```bash
python3 scripts/modeling/build_behavioral_demand_evidence_packet.py \
  --behavioral-manifest /path/to/behavioral_demand_prototype/behavioral_demand_prototype_manifest.json
```
