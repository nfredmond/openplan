# OpenPlan Public URL Canonicalization

**Date:** 2026-05-10  
**Scope:** application metadata, public URL defaults, and operator-facing URL posture.  
**No external config or DNS changes were made.**

## Decision

Use the currently live OpenPlan production alias as the canonical public URL:

- **Canonical public OpenPlan URL:** `https://openplan-natford.vercel.app`
- **Compatibility alias that must not be broken:** `https://openplan-zeta.vercel.app`
- **Not canonical until DNS is configured:** `https://openplan.natfordplanning.com`

## Evidence

Runtime reachability check from this lane:

- `https://openplan-natford.vercel.app` returned HTTP 200.
- `https://openplan-zeta.vercel.app` returned HTTP 200.
- `https://openplan.natfordplanning.com` did not resolve (`curl: (6) Could not resolve host`).

## Implementation posture

The app metadata already centralizes canonical public metadata in `src/lib/public-page-metadata.ts` and `src/app/layout.tsx`. This lane added a focused guardrail test so canonical metadata remains pointed at the live production alias and does not silently drift to the unresolved custom domain.

## External blocker

Attaching `openplan.natfordplanning.com` remains an external DNS/Vercel-domain configuration task. Until that domain resolves and is attached, public copy, metadata, runbooks, and smoke defaults should continue using `https://openplan-natford.vercel.app`.
