# OpenPlan Alias Reference Policy — 2026-04-05

## Purpose

Prevent future confusion between:
- **current operational alias policy**, and
- **historical evidence documents** that correctly mention older aliases used at the time.

## Canonical alias policy (current)

For all active tooling, future proofs, and current operational references, use:

- **Canonical production alias:** `https://openplan-natford.vercel.app`

Legacy compatibility only:

- `https://openplan-zeta.vercel.app`

## Why historical docs still mention `openplan-zeta`

Many March/early-April evidence packets, smoke reports, and billing/proof artifacts reference `openplan-zeta.vercel.app` because that was the production alias being actively verified during those passes.

Those references are **not necessarily wrong**. They are often historically accurate snapshots.

## Interpretation rule

When reading OpenPlan repo docs:

1. If the document is a **historical proof artifact** or **test-output capture**, leave the alias exactly as recorded.
2. If the document is a **current operational policy**, **active runbook**, or **tool default**, prefer `openplan-natford.vercel.app`.
3. Do **not** rewrite old evidence just to normalize naming, unless a document explicitly claims to describe the current canonical setup.

## Practical split

### Keep historical as-is
Examples:
- prior smoke reports
- promotion closure notes
- billing proof packets
- test-output JSON/text captures
- screenshots or logs captured against older aliases

### Update to canonical alias when touched
Examples:
- active QA harness defaults
- supervised canary scripts
- new runbooks
- current deployment/consolidation docs
- future proof reports unless they intentionally target legacy alias behavior

## Current verified state

- Canonical Vercel project: `natford/openplan`
- Canonical production alias: `https://openplan-natford.vercel.app`
- Legacy compatibility alias retained: `https://openplan-zeta.vercel.app`
- Broken duplicate project removed: `nat-ford-planning/openplan`

## Related records

- `docs/ops/2026-04-05-openplan-vercel-consolidation.md`
- `docs/ops/2026-04-05-openplan-production-authenticated-smoke.md`
- `docs/ops/2026-04-05-openplan-production-county-scaffold-smoke.md`
