# OpenPlan Day 1 — Engineering P0 Burn Plan (Auth/Session/Workspace Roles/Billing Webhook)

- **Date (PT):** 2026-03-01
- **Owner:** Iris Chen (Expert Programmer)
- **Source Matrix:** `openplan/docs/ops/2026-03-01-team-tasking-matrix.md`
- **Ship Board:** `openplan/docs/ops/2026-03-01-openplan-ship-board.md`

## 1) P0 Must-Ship Mapping (Current)

| P0 lane | Current status | Evidence | Immediate closure target |
|---|---|---|---|
| Auth/session regression baseline | **PASS (partial coverage)** | `2026-03-01-p0-auth-workspace-billing-vitest.log` (middleware/auth tests) | Expand from proxy-only checks to route-level unauthorized/cross-workspace checks on critical APIs |
| Workspace membership + role gates | **MIXED** | `analysis` route enforces membership; `billing/checkout` enforces owner/admin; coverage scan shows `runs` + `report` routes missing explicit `auth.getUser` checks | Add shared auth/membership gate helper + apply to `runs` and `report` |
| Billing checkout + webhook reliability | **MIXED** | Unit tests pass; deterministic DB mutation check passes; live canary still not fully closed | Enforce strict workspace ID validity + non-zero workspace mutation + replay pending Stripe deliveries |
| Billing cancel/refund operational reliability | **PARTIAL** | Existing canary document has refund/cancel evidence IDs but undelivered webhook gap remains | Complete live replay + document final PASS conditions |

---

## 2) Current Pass/Fail Evidence Snapshot

### PASS evidence
1. **P0 auth/workspace/billing regression tests**: **15/15 passing**
   - Command output: `openplan/docs/ops/2026-03-01-test-output/2026-03-01-p0-auth-workspace-billing-vitest.log`
   - Includes:
     - `src/test/middleware.test.ts`
     - `src/test/workspaces-bootstrap-route.test.ts`
     - `src/test/billing-checkout.test.ts`
     - `src/test/billing-webhook-route.test.ts`

2. **API guardrail smoke tests**: **7/7 passing**
   - Command output: `openplan/docs/ops/2026-03-01-test-output/2026-03-01-p0-api-smoke-report.log`
   - Includes:
     - `src/test/api-smoke.test.ts`
     - `src/test/report-route.test.ts`

3. **Deterministic workspace billing mutation check**: **PASS**
   - Command output: `openplan/docs/ops/2026-03-01-test-output/2026-03-01-p0-billing-workspace-mutation-check.log`
   - Confirms update+revert flow for `plan`, `subscription_plan`, `subscription_status`, `stripe_customer_id`, `stripe_subscription_id`.

### FAIL / open-risk evidence
1. **Live webhook canary not closed yet**
   - Monitor output: `openplan/docs/ops/2026-03-01-test-output/2026-03-01-p0-billing-live-canary-monitor.log`
   - Stripe events found (`checkout.session.completed`, `customer.subscription.created`, `invoice.payment_succeeded`, `charge.refunded`, `customer.subscription.deleted`) but:
     - no matching production `billing_events` rows in the monitor window,
     - no matching `billing_webhook_receipts` rows except test receipt.

2. **Auth/role explicit coverage gap in API routes**
   - Scan output: `openplan/docs/ops/2026-03-01-test-output/2026-03-01-p0-api-auth-coverage-scan.log`
   - Routes without explicit `auth.getUser` call:
     - `src/app/api/report/route.ts`
     - `src/app/api/runs/route.ts`
     - `src/app/api/billing/webhook/route.ts` (expected exception: provider webhook endpoint)

---

## 3) Closure Plan (P0)

## A) Auth/Session Closure

### A1 — Add explicit auth guard to critical APIs (P0)
- Apply explicit authenticated-user guard in:
  - `src/app/api/runs/route.ts` (`GET`, `DELETE`)
  - `src/app/api/report/route.ts` (`POST`)
- Return deterministic `401` for unauthenticated requests.

### A2 — Add route-level auth regression tests (P0)
- Add/extend tests to verify:
  - unauthenticated => `401`
  - authenticated but unauthorized workspace/run => `403` or `404` per policy
  - authorized => success path

**Exit condition:** all critical read/write APIs return deterministic auth outcomes and are covered by tests.

## B) Workspace Role/Membership Closure

### B1 — Centralize workspace authorization helper (P0)
- Introduce shared helper(s) for:
  - membership check
  - role check (`owner`/`admin` where needed)
- Reuse in billing checkout + workspace-scoped data routes to reduce policy drift.

### B2 — Enforce run/report workspace ownership checks (P0)
- Ensure run fetch/delete/report generation are limited to requesting user’s workspace membership.

**Exit condition:** no workspace-scoped API path allows cross-tenant access by request parameter alone.

## C) Billing/Webhook Closure

### C1 — Strict webhook workspace identity validation (P0)
- Treat Stripe metadata `workspaceId` as required UUID.
- Reject/ignore events with missing/invalid workspace IDs with explicit audit reason.

### C2 — Deterministic mutation check (P0)
- Update webhook mutation path to fail-safe when update target row count is zero (no silent success).
- Keep idempotency receipt status aligned with outcome (`processed` / `ignored` / `failed`).

### C3 — Live replay closure (P0)
- Replay pending Stripe events after endpoint/secret validation.
- Verify all required artifacts:
  - `billing_webhook_receipts` rows for replayed events,
  - `billing_events` rows for workspace mutation events,
  - workspace subscription state reflects replayed lifecycle state.

**Exit condition:** one full starter lifecycle (checkout -> active -> refund/cancel) completes with matching Stripe + Supabase evidence.

---

## 4) Regression Command Pack (Executable)

Run from: `cd /home/nathaniel/.openclaw/workspace/openplan/openplan`

```bash
# 1) P0 auth/session/workspace-role/billing route tests
npm test -- \
  src/test/middleware.test.ts \
  src/test/workspaces-bootstrap-route.test.ts \
  src/test/billing-checkout.test.ts \
  src/test/billing-webhook-route.test.ts

# 2) API guardrail + report route smoke tests
npm test -- src/test/api-smoke.test.ts src/test/report-route.test.ts

# 3) Deterministic billing workspace mutation probe (dev DB)
npx tsx --env-file=.env.local scripts/verify-webhook-ingestion.ts

# 4) Live canary monitor (Vercel env snapshot)
./scripts/openplan-starter-canary-monitor.sh --since-minutes 720 --env-file /tmp/openplan.vercel.env

# 5) Route auth coverage scan (quick risk scan)
python3 - <<'PY'
from pathlib import Path
root=Path('src/app/api')
print('API routes without auth.getUser call:')
for p in sorted(root.rglob('route.ts')):
    txt=p.read_text()
    if 'auth.getUser' not in txt:
        print(str(p))
PY
```

---

## 5) Day 1 Burn Sequence (Execution Order)

1. **Auth/role hardening patch** (`runs` + `report` explicit auth + membership checks)
2. **Webhook identity/mutation hardening patch** (UUID validation + zero-row mutation guard)
3. **Regression pack rerun** (commands #1–#5)
4. **Live webhook replay + evidence capture**
5. **Update ship board + QA evidence index with PASS/HOLD posture**

---

## 6) Current P0 Posture

- **Auth/session:** YELLOW (baseline pass, route-level closure still open)
- **Workspace roles:** YELLOW (partial enforcement, helper unification + route expansion pending)
- **Billing webhook:** YELLOW/RED boundary (unit pass, live replay closure still open)
- **Overall Day 1 posture:** **HOLD until live webhook replay evidence and route-level auth/membership closure are complete.**
