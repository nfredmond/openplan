# 2026-03-02 Practical GIS Quality Action (Priya Lane)

## Action
Implement a **geospatial artifact preflight gate** that blocks ship packaging when any map/report artifact is missing required trust metadata.

## Why this is practical
It converts today's manual QA guardrails into a deterministic pass/fail control at export time, reducing missed disclosures and improving ship reliability.

## Required checks (must all pass)
1. `methodsVersion` present
2. `sourceSnapshots` present with `source` + `fetchedAt`
3. `jurisdiction_type` token present (incl. county-equivalent/tribal/regional/state contexts)
4. confidence/caveat statement present
5. concept-level disclaimer present on external-facing exports

## Acceptance criteria
- Preflight script runs in one command and outputs PASS/FAIL + missing fields.
- FAIL result blocks artifact from being marked external-ready.
- Evidence log path added to ship evidence index.

## Proposed evidence path (tomorrow)
- `openplan/docs/ops/2026-03-02-test-output/geospatial-preflight-gate.log`
