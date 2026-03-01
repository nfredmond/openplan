# Jurisdiction Coverage Addendum (Nationwide U.S.)

- **Date (PT):** 2026-02-28
- **Owner:** Priya (GIS)
- **Purpose:** Confirm active GIS methods/docs support nationwide U.S. jurisdiction applicability.

## Covered jurisdiction types (required language)
1. Municipalities (city/town)
2. Counties
3. County-equivalents
   - Parish (LA)
   - Borough / census area (AK)
   - Municipio (PR)
   - Independent city
4. Tribal governments / tribal transportation contexts
5. Regional transportation agencies/commissions (MPO/RTPA/TC)
6. State agencies (including state DOTs)

## Method framing requirements (applies to all active GIS docs)
- Avoid region-limited wording unless explicitly labeled as a sample profile.
- Include jurisdiction classification in metadata/export packages.
- Mark source adapter by state/jurisdiction (state/local feed vs national fallback).
- Add confidence/caveat notes whenever fallback data are used.
- For tribal contexts, include data authority/sovereignty availability notes when relevant.

## Current constraints (tracked)
- State-by-state crash/safety source depth still varies.
- Full runtime enforcement of jurisdiction tokens in every export path is in progress.
- Canonical layer completeness gates still required before council-grade external release.

## Go-forward note
Legacy `norcal_*` sample artifact names may remain for continuity, but they do **not** limit nationwide applicability.
