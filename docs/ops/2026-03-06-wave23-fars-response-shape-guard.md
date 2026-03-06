# 2026-03-06 Wave 23 — FARS Response Shape Guard

## Scope
Low-risk reliability hardening for FARS parsing when response payload shape differs from the nested `Results[0]` array pattern.

## Change Summary
- Added defensive FARS payload parsing in `src/lib/data-sources/crashes.ts`:
  - Supports both payload forms:
    - `Results: [[{...crash}]]` (nested array)
    - `Results: [{...crash}]` (flat array)
  - Treats invalid payload shapes as non-parseable for that year (skip year instead of throwing).
- Added stricter count parsing for fatality-related fields:
  - `parseCount()` now normalizes `number | string | unknown` to safe non-negative integers.
- Preserved fallback behavior:
  - If all years are non-parseable/unavailable, flow still returns the existing `fars-estimate` output.

## Validation
Added focused regression coverage in `src/test/crashes-data-source.test.ts`:
- `supports FARS responses with a top-level Results array of crash records`
- `falls back to estimate when FARS returns an unexpected payload shape`
- Existing timeout fallback test retained.

## Verification Command
```bash
npm run test -- src/test/crashes-data-source.test.ts src/test/http-fetch-json-retry.test.ts
```
