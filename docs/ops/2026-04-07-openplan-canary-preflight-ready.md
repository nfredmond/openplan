# OpenPlan Canary Preflight Ready — 2026-04-07

**Date:** 2026-04-07  
**Owner:** Bartholomew Hale (COO)  
**Status:** READY FOR SUPERVISED EXECUTION

## Executive Summary

The OpenPlan supervised paid canary is now cleanly preflighted on the canonical alias.

Current validated target:
- **Canonical alias:** `https://openplan-natford.vercel.app`
- **Workspace id:** `3aba7677-1826-49ff-8df7-983fd78c7d3e`
- **Workspace name:** `Prod QA Project 4 2026-03-23T03-09-24-366Z`
- **Subscription state:** `checkout_pending`
- **Plan marker:** `starter`

## What is now proven

- canonical alias policy is locked to `openplan-natford`
- Vercel protection bypass path works for proof access on the canonical alias
- production env posture is present
- Supabase service-role proof posture is present
- live Starter Stripe price is valid
- canonical Stripe webhook endpoint posture is valid
- workspace snapshot capture succeeds
- monitor snapshot capture succeeds
- explicit blockers: none

## Exact operator route

- `https://openplan-natford.vercel.app/billing?workspaceId=3aba7677-1826-49ff-8df7-983fd78c7d3e`

## Exact monitor command

```bash
cd /home/narford/.openclaw/workspace/openplan/openplan
./scripts/openplan-starter-canary-monitor.sh --workspace-id 3aba7677-1826-49ff-8df7-983fd78c7d3e --since-minutes 180 --watch 15 --env-file /tmp/openplan.vercel.env
```

## Remaining action

The remaining step is no longer technical prep.

It is the supervised money-moving checkout itself, followed immediately by read-only webhook-proof verification and evidence capture.

## Evidence

- `docs/ops/2026-04-07-test-output/20260407T201100Z-supervised-paid-canary-preflight/preflight-summary.md`

## Bottom line

The canary lane is ready.

What remains is a supervised live billing execution decision, not more setup work.
