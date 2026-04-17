---
title: OpenPlan caveat-gate invocation audit (T16)
date: 2026-04-16
head_sha: d95e1b5 (post-slice-3)
status: audit-only (no wiring change; escalation needed)
---

# OpenPlan caveat-gate invocation audit

The 2026-04-16 program landed T16 — a caveat gate
(`partitionScreeningGradeRows`) that is supposed to refuse
screening-grade rows unless the caller passes
`consent.acceptScreeningGrade=true`, so that preliminary county-run
outputs don't silently feed into planning-grade reads.

**This audit answers: is the gate actually exercised by any
production read path?**

Short answer: **no**. It is well-tested as a pure function and it is
wired into a loader function, but the loader is never called from any
production-facing API route, page, or hook. Screening-grade refusal is
an invariant the codebase *could* enforce and *does not currently*
enforce anywhere a user can see.

## Inventory

`partitionScreeningGradeRows` is referenced in three files:

| File | Role |
| --- | --- |
| `src/lib/models/caveat-gate.ts` | gate definition |
| `src/lib/models/behavioral-onramp-kpis.ts:191` | used inside `loadBehavioralOnrampKpisForWorkspace()` |
| `src/test/caveat-gate.test.ts` | unit tests (accept, reject, mixed) |

Tracing the only non-test caller (`loadBehavioralOnrampKpisForWorkspace`):

```
$ grep -R loadBehavioralOnrampKpisForWorkspace src
src/lib/models/behavioral-onramp-kpis.ts          — definition
src/test/behavioral-onramp-kpis.test.ts           — 3 call sites (tests)
```

No production call sites. The loader is defined but never invoked by
any API route, page, or component.

## How the data currently flows

The *write* side is wired through production code:

- `POST /api/county-runs/[countyRunId]/manifest/route.ts:188` calls
  `persistBehavioralOnrampKpis()` when a county-run manifest is
  uploaded. Rows land in `model_run_kpis` with
  `kpi_category='behavioral_onramp'`, `run_id=NULL`,
  `county_run_id=<countyRunId>`.

The *read* side has **two** functions that touch `model_run_kpis`, and
**neither** of them routes behavioral_onramp rows through the gate:

1. `GET /api/models/[modelId]/runs/[modelRunId]/kpis/route.ts:139-144`
   filters by `run_id=<modelRunId>`. Behavioral-onramp rows have
   `run_id=NULL`, so they are **never returned** by this route.
2. `loadBehavioralOnrampKpisForWorkspace()` in
   `src/lib/models/behavioral-onramp-kpis.ts` — the only function that
   *could* return these rows with gate enforcement — has zero
   production callers.

Net result: behavioral_onramp KPIs land in the database on every
county-run manifest upload and then sit there unread. No UI surface
currently displays them. The gate protects a read path that no user
can take.

## Why this matters

The gate itself is correct (tests pass). But "correct but unreachable"
is not the same as "enforced." The T16 ticket's intent was to stop
screening-grade outputs from displacing planning-grade outputs in
reader surfaces. That invariant is vacuously satisfied right now —
there's no reader surface — but any future wiring that loads behavioral
KPIs must go through the gate, and nothing in the code enforces that
today (no linter rule, no narrowed type at a repository boundary, no
shared "must-consent" wrapper).

If someone ships a new county-run detail page or a behavioral-KPI
table tomorrow and calls `supabase.from('model_run_kpis').select(...)`
directly (as the existing `/api/models/.../kpis/route.ts` already
does), they will likely bypass the gate without realizing it exists.

## Options

1. **Keep the gate as-is; wait for the first read surface to need it.**
   Low effort, but carries the risk above.
2. **Wire the gate into a "safe default reader" wrapper.**
   Replace direct `from('model_run_kpis')` calls with
   `loadBehavioralOnrampKpisForWorkspace` (or an equivalent) and make
   consent explicit at the route level. Requires a small refactor in
   `/api/models/[modelId]/runs/[modelRunId]/kpis/route.ts` and any new
   readers.
3. **Narrow the type at the repository boundary.** Introduce a
   `loadCountyRunKpisSafely` helper that the repository exposes
   instead of raw `from('model_run_kpis')`, and have that helper
   require a `CaveatGateConsent` argument. Strongest enforcement;
   highest short-term cost (touches existing reader routes).

## What the proof plan deferred

The original plan anticipated this:

> **Risk:** Audit may reveal the gate is dead code. In that case,
> escalate — the decision to wire (and where) is a design call, not a
> mechanical one.

The audit confirms the risk materialized. Rather than picking a
wiring target without Nathaniel's input (the reader surface doesn't
exist yet; "wire it" would implicitly also mean "build the reader
surface"), this slice stops here and escalates. The ticket is
**audited, not closed**.

## Recommended next action

Pair this audit with the upcoming "county-run KPIs on the detail page"
product work. When that reader surface is specified, wire it through
`loadBehavioralOnrampKpisForWorkspace` (or a refactor thereof) from
day one — and add a banner + toggle that mirrors
`describeScreeningGradeRefusal(count)` when rows are held back.

Until then, the gate remains a ready-to-use helper with 100% unit-test
coverage and zero production invocations.
