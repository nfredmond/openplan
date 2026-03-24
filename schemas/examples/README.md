# County Onramp Manifest Examples

These example manifests are generated from real OpenPlan county runs and validated with:
- `scripts/modeling/check_county_onramp_manifest.py`

## Files

### `county_onramp_manifest.nevada.validated-screening.json`
Represents a county that has:
- completed the reusable screening runtime,
- completed a local observed-count validation slice,
- and currently clears the `bounded screening-ready` screening gate.

Current example source:
- Nevada County bounded screening-ready run with improved connector heuristic.

### `county_onramp_manifest.placer.runtime-complete.json`
Represents a county that has:
- completed the reusable screening runtime,
- but has not yet been upgraded into a local observed-count validation state.

Current example source:
- Placer County transfer/runtime checkpoint.

## Why these exist
These fixtures give future backend, API, and UI work a concrete reference for:
- `runtime-complete` county state
- `validated-screening` county state

That makes it easier to build dashboards, API serializers, or database mappings without guessing what a real manifest should look like.
