# Assistant Action Audit — Live-Loop Proof (T5 + T6)

**Date:** 2026-04-18
**Phase:** M
**Status:** live
**Predecessors:** Phase J (safety + observability), Phase K (modeling honest surface), Phase L (pilot-readiness runtime quota gate)

## Summary

Phase M closes the live-loop gap for tickets **T5 (canonical ActionRecord type)** and **T6 (assistant_action_executions audit table)** from the 2026-04-16 integrated deep-dive review. Before Phase M, the `ActionRecord` registry and the `recordAssistantActionExecution` helper were implemented and unit-tested but had only two production callers. Every other assistant-executed mutation ran without persisting a business-audit row.

Phase M adds a `withAssistantActionAudit<T>` wrapper and wires it into the five previously-unwired ActionRecord-backed API routes. All seven action kinds now persist one row per execution in `assistant_action_executions` with `outcome='succeeded'` on success and `outcome='failed'` + `error_message` on a thrown body. T5+T6 move from **unit-only** to **live** in the 18-ticket ledger.

## Before / after coverage map

| Action kind | Route file | Before | After |
|---|---|---|---|
| `generate_report_artifact` | `src/app/api/reports/[reportId]/generate/route.ts` | inline `recordAssistantActionExecution` (succeeded-only) | unchanged — already live |
| `create_rtp_packet_record` | `src/app/api/reports/route.ts` | inline `recordAssistantActionExecution` (succeeded-only, rtp_cycle path) | unchanged — already live |
| `create_funding_opportunity` | `src/app/api/funding-opportunities/route.ts` | **none** | `withAssistantActionAudit` (success + failure) |
| `update_funding_opportunity_decision` | `src/app/api/funding-opportunities/[opportunityId]/route.ts` | **none** | `withAssistantActionAudit` (gated on `decisionState` in patch) |
| `create_project_funding_profile` | `src/app/api/projects/[projectId]/funding-profile/route.ts` | **none** | `withAssistantActionAudit` (success + failure) |
| `create_project_record` | `src/app/api/projects/[projectId]/records/route.ts` | **none** | `withAssistantActionAudit` (covers 7 record types) |
| `link_billing_invoice_funding_award` | `src/app/api/billing/invoices/[invoiceId]/route.ts` | **none** | `withAssistantActionAudit` (gated on `fundingAwardId` in patch) |

**Grep check:**

```
$ grep -rl recordAssistantActionExecution src/app/api --include=route.ts
src/app/api/reports/[reportId]/generate/route.ts
src/app/api/reports/route.ts

$ grep -rl withAssistantActionAudit src/app/api --include=route.ts
src/app/api/projects/[projectId]/records/route.ts
src/app/api/projects/[projectId]/funding-profile/route.ts
src/app/api/funding-opportunities/[opportunityId]/route.ts
src/app/api/funding-opportunities/route.ts
src/app/api/billing/invoices/[invoiceId]/route.ts
```

Combined: 7 route files cover 7 action kinds — 1:1 parity with `ACTION_REGISTRY`.

## Wrapper contract

`withAssistantActionAudit<T>(supabase, meta, body)` in `src/lib/observability/action-audit.ts`:

- Looks up the `ActionRecord` via `getActionRecord(meta.actionKind)` — single source of truth for `auditEvent`, `approval`, `regrounding`.
- Captures `started_at` before the body runs.
- On success: awaits `body()`, captures `completed_at`, inserts a `succeeded` row, returns the body's result.
- On throw: captures `completed_at`, inserts a `failed` row with `error_message = err.message`, re-throws so outer route-level catch can return its 500 response.
- If the audit insert itself fails, a `console.warn` surfaces the failure but the business-logic result (or error) is never masked.

The two existing inline wirings (`reports/route.ts`, `reports/[reportId]/generate/route.ts`) are deliberately left unchanged — they use the succeeded-only pattern and are already in production. Future refactors can migrate them to the wrapper for consistency, but that is out of Phase M scope.

## Two gated wirings

Two PATCH routes accept multiple unrelated fields; audit rows fire only when the patch matches the registered action semantics:

- `funding-opportunities/[opportunityId]` — writes `update_funding_opportunity_decision` only when `decisionState` is in the patch. Non-decision edits (title, notes) bypass the wrapper.
- `billing/invoices/[invoiceId]` — writes `link_billing_invoice_funding_award` only when `fundingAwardId` is in the patch. Status-only edits bypass the wrapper.

This keeps the audit trail aligned with the registry's declared intent (`link`, `update_decision`) rather than flooding it with unrelated PATCHes.

## Verification

### Typecheck

```
$ pnpm tsc --noEmit
# exit 0
```

### Test suite

```
$ pnpm test --run | tail -3
 Test Files  169 passed (169)
      Tests  761 passed (761)
```

Baseline 745/168 → 761/169 (+16 new assertions, +1 new test file). All existing route tests updated to stub `assistant_action_executions` inserts so their mocked supabase clients no longer throw on the wrapper's audit write.

### Live-loop test file

`src/test/action-audit-live-loop.test.ts` drives `withAssistantActionAudit` directly for all 7 action kinds:

- 1 coverage test — asserts the registry has exactly the 7 expected kinds.
- 7 success-path tests — each asserts the inserted row carries the kind's registry-driven `audit_event`, `approval`, `regrounding`, plus `outcome='succeeded'`, `error_message: null`, the caller's `inputSummary`, and ISO `started_at` / `completed_at`.
- 7 failure-path tests — each forces the body to throw `boom:<kind>`, asserts the thrown error propagates, and asserts the inserted row has `outcome='failed'` + `error_message='boom:<kind>'`.
- 1 insert-failure test — asserts the body's return value is still surfaced when the audit insert itself errors, and that a `console.warn` fires.

### Expected live readback

After exercising each action once against the running dev server (or a staging workspace):

```sql
SELECT action_kind, outcome, COUNT(*) AS n
FROM assistant_action_executions
WHERE completed_at > now() - interval '1 hour'
GROUP BY 1, 2
ORDER BY 1;
```

Expected: 7 rows across 7 distinct `action_kind` values, all `outcome = 'succeeded'`. The query hits the `kind_idx` index `(action_kind, completed_at DESC)` defined in migration `20260416000050_assistant_action_executions.sql`.

## What lifts to live

Per the 2026-04-18 program retrospective's open-ticket ledger:

- **T5 — canonical ActionRecord type:** was unit-only. Now live: every action kind has production call-sites using the registry as its source of truth for `auditEvent`, `approval`, `regrounding`.
- **T6 — assistant_action_executions audit table:** was unit-only. Now live: every ActionRecord-backed mutation persists one row per invocation with `outcome` semantics and `input_summary` for forensic audit.

Live ticket count moves from **10/18 → 12/18**. Unit-only count drops from **7/18 → 5/18** (T2, T3, T10, T16 caveat-gate wiring, T18 remain).

## Scope boundaries respected

- No schema changes. `assistant_action_executions` schema matches `recordAssistantActionExecution`'s insert shape; no migration added.
- No ActionRecord contract changes. `action-registry.ts` untouched.
- No client-side action-dispatch changes. Client `postJson`/`patchJson` calls in the registry are unchanged.
- Truth-state lock unchanged. No `StateBlock` or `StatusBadge` copy altered. `internal prototype only` and Nevada County max APE 237.62% language is preserved.

## What comes after M (not in this phase)

Per plan Phase M → (push + verify) → STOP, successor phases stay queued:

- **Phase N (T2+T3):** stale-mark / variant reader wiring to live proof
- **Phase O (T10):** 2–3 more extractions from `/grants/opportunities` following the T7+T10 pattern
- **Phase P (T18):** TBD, requires re-reading the deep-dive T18 spec
- **Phase Q (T16):** reader-surface design call unblock — lock-lifter

Pilot-readiness breadth (legal pages, quota asymmetry across reports/engagement/projects, nested error boundaries) waits until at least N and O land, per the retrospective's "What not to do next" guidance.
