# OpenPlan Known Issues Register

> **DATED RECORD — date not in filename.** This describes what was true on the day it was written.
> It is kept because it records *why* decisions were made, which nothing else captures.
> **Do not treat any factual claim here as current** — verify against the code, the
> database, or `CHANGELOG.md` before acting on it. A stale doc that reads as current
> costs more than a missing one: on 2026-07-30 a roadmap in this folder listed two
> "remaining" items that had both already shipped, and nearly cost a full rebuild of a
> feature that already exists.


**Last updated:** 2026-07-28
**Status:** Active quality register
**Scope:** the free, open-source, self-serve OpenPlan product

## Purpose

This register turns known product and operating caveats into explicit tracked items. It is not a
backlog replacement: flagship flows should have zero open blockers, and non-blocking risks should
have a severity, a disposition, and a source reference.

The pre-2026-07 register tracked commercial-era items (billing canaries, buyer proof packets,
supervised-sales boundaries) against a product posture that no longer exists; those rows were
retired when the commercial-era docs were deleted on 2026-07-27. Git history preserves them.

## Severity

| Severity | Meaning |
|---|---|
| Blocker | Must stop a release or production mutation until resolved. |
| High | Must be resolved before relying on the affected workflow. |
| Medium | Operator/user caveat; acceptable only if disclosed and actively tracked. |
| Low | Hygiene, future-proofing, or non-user-facing issue that should not be lost. |

## Open Watch Items

| ID | Severity | Area | Issue | Disposition | Source |
|---|---|---|---|---|---|
| KI-2026-05-01-002 | Medium | Modeling claims | Screening-grade county-run and behavioral-onramp evidence must not be described as calibrated or validated forecasting. | Keep all product and public language in screening-grade / human-review posture. The claim guards (`no-paid-tier-guard`, `public-page-claims-guardrails`, `safety-claim-boundaries`, run-mode caveat strings) enforce this on live surfaces. | `openplan/docs/ops/2026-04-16-caveat-gate-audit.md` |
| KI-2026-05-01-003 | Medium | Recovery operations | Restore confidence depends on quarterly non-production restore drills. | Not a release blocker. Any operator running a production deployment should drill per the procedure; next drill for the reference deployment was due by 2026-08-01. | `openplan/docs/ops/2026-05-01-openplan-backup-restore-procedure.md` |
| KI-2026-07-27-001 | Medium | Hosted availability | No hosted OpenPlan deployment currently exists (the previous Vercel deployment is offline). Public copy must say self-host until a hosted URL is real. | Hosted deploy is an operator action item; do not claim a hosted option ahead of it. | this register |

## Closed

| ID | Severity | Area | Issue | Resolution | Source |
|---|---|---|---|---|---|
| KI-2026-07-28-001 | Blocker | Workspace authorization | The read-only `viewer` tier (shipped 2026-07-28, `20260728000003`) was enforced only in the API route layer. Supabase's default privileges left `authenticated` holding INSERT/UPDATE/DELETE on every workspace table, and 192 write policies across 80 tables tested membership but never role — so a viewer with the public anon key and their own session JWT could write directly through PostgREST, past every route guard. Bounded: `workspace_members` carries only a SELECT policy, so a viewer could tamper with workspace content but could **not** promote themselves. | Closed 2026-07-28 by `20260728000006` / `20260728000007`: a shared `workspace_member_can_write()` predicate plus additive RESTRICTIVE INSERT/UPDATE/DELETE policies over all 80 tables. Verified live — a viewer session is refused insert/update/delete and still reads, and the same user promoted to member writes normally. `viewer-write-denial-guard.test.ts` fails the build if a new role-blind write policy lands on an ungated table; `rls-viewer-denial.test.ts` proves it against a real session under `npm run test:rls-live`. | `openplan/src/test/rls-viewer-denial.test.ts` |

## Update Rules

- Add a row when a test, smoke, review, or user report reveals a real caveat.
- Promote to **Blocker** when the issue invalidates a release gate, risks user data, weakens
  workspace isolation, or causes any surface to overclaim.
- Close a row only when a linked commit or verified behavior demonstrates the issue is controlled.
- Do not hide product boundaries by deleting watch items; close them only when the boundary is
  replaced by working, verified behavior.
