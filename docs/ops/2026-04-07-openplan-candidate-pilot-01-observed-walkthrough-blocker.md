# OpenPlan Candidate Pilot 01 — Observed Walkthrough Blocker

**Date:** 2026-04-07  
**Owner:** Bartholomew Hale (COO)  
**Status:** blocked at live browser-access layer  
**Purpose:** record the exact blocker encountered while attempting the next-step observed operator walkthrough for Candidate Pilot 01.

## What was attempted

The next strengthening move after the dry-run closeout was attempted directly:
- run the production authenticated walkthrough harness,
- run the production report-traceability walkthrough harness,
- capture a named observed walkthrough for Candidate Pilot 01.

## What happened

The live production walkthrough did not fail on OpenPlan planning-domain logic first.
It failed earlier at the browser-access boundary.

Observed failure:
- the signed-out redirect step resolved to `https://vercel.com/login`
- instead of the expected OpenPlan sign-in route with redirect continuity

## What this means

This indicates the current runner still does not have a usable browser path through Vercel deployment protection for this observed walkthrough lane.

The practical consequence is:
- OpenPlan's current evidence packet remains valid,
- Candidate Pilot 01 dry-run closeout remains valid,
- but the stronger observed walkthrough is still blocked at access/protection posture rather than product continuity.

## Why this matters

This is an operational blocker, not a reason to invent a false walkthrough result.

The honest interpretation is:
- the product may still be ready for a supervised observed walkthrough,
- but this machine/session does not yet have the approved browser-access path needed to execute that walkthrough end to end.

## Exact blocker

**Missing or unusable live browser bypass/auth path for the protected canonical alias during the observed walkthrough harness run.**

## Recommended next step

One of the following must be supplied before retrying:
1. a working Vercel protection bypass path usable by the harness, or
2. an intentionally authenticated browser session for the walkthrough lane.

## Effect on current status

This blocker does **not** undo:
- the April principal PASS for supervised pilot posture,
- the dry-run conditional pass,
- or the pilot-target/brief/context work already completed.

It simply prevents the next stronger observed-walkthrough evidence step from being closed tonight through this runner.

## Bottom line

Candidate Pilot 01 is still the right next lane.
But the observed walkthrough remains **blocked at browser-access posture**, not completed.
