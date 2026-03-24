# OpenPlan Nevada Scalar 0.369 — Operating Guardrails

**Date:** 2026-03-24  
**Author:** Dr. Adrian Velasco, Principal Travel Demand Modeler  
**Purpose:** Prevent overclaiming and misuse of the new Nevada bounded screening-ready result

## Governing fact
Nevada County currently has a **bounded screening-ready** reusable-runtime run under:
- corrected mainline observed-count validation, and
- a **Nevada-specific overall-demand scalar of `0.369`**.

Canonical checkpoint:
- `docs/ops/2026-03-24-openplan-nevada-bounded-screening-ready-scalar-0369.md`

## What this scalar IS
- a **county-specific screening control setting**
- a practical way to keep the Nevada lane inside the current provisional bounded screening gate
- evidence that the reusable runtime can be tuned into a bounded validation band for one real county case

## What this scalar is NOT
- not a universal runtime default
- not a behavioral calibration parameter
- not evidence that all counties are bounded screening-ready
- not evidence that Nevada is forecast-ready or client-ready for outward model claims
- not evidence that gateway, purpose mix, or corridor realism are “solved” in general

## Allowed use
Use the scalar when:
- reproducing the current Nevada bounded screening checkpoint
- discussing the Nevada lane internally as a bounded screening prototype
- demonstrating the reusable runtime with explicit caveats in technical review contexts

## Disallowed use
Do **not**:
- apply `0.369` silently as the general default for all counties
- present the scalarized Nevada run as calibrated behavioral demand
- market Nevada as validated forecasting
- imply that passing the provisional Nevada gate means OpenPlan’s modeling lane is broadly proven everywhere

## Required language when referenced
When referencing the result, preserve all of the following:
- Nevada-specific
- screening-grade
- bounded screening-ready
- uncalibrated
- not behavioral demand
- not client-ready forecasting

## Preferred short wording
- "Nevada currently has a bounded screening-ready prototype run in the reusable runtime under a county-specific screening scalar and corrected mainline validation."

## Preferred caution wording
- "This Nevada result is a bounded screening checkpoint, not a transferable forecasting claim or a universal runtime default."

## Next methodological step
The next technical lane should reduce reliance on blanket county-specific scaling by testing whether the remaining Nevada fit can be preserved or improved through:
- local corridor refinement,
- better gateway inference,
- or improved trip-generation logic.

## Bottom line
`0.369` is useful because it gives OpenPlan a real Nevada bounded screening checkpoint.

Its value comes from **honest scope control**. If we present it as a local screening control setting, it is a strength. If we present it as general validation, it becomes misleading.
