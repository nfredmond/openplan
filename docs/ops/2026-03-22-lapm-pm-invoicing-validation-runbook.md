# LAPM / PM / Invoicing — Post-Deploy Validation Runbook

**Date:** 2026-03-22  
**Author:** Mateo Ruiz (Assistant Planner — release support lane)  
**Companion:** `2026-03-22-lapm-pm-invoicing-release-checklist.md`  
**Purpose:** Step-by-step validation script for production after Lane C merge + deploy. Copy-paste ready.

---

## Step 0 — Confirm migration applied

Run in Supabase SQL editor (production project):

```sql
-- Expect 3 rows
SELECT tablename FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('project_milestones', 'project_submittals', 'billing_invoice_records')
ORDER BY tablename;

-- Expect all true
SELECT tablename, rowsecurity FROM pg_tables
WHERE tablename IN ('project_milestones', 'project_submittals', 'billing_invoice_records');

-- Expect 9 rows
SELECT tablename, policyname FROM pg_policies
WHERE tablename IN ('project_milestones', 'project_submittals', 'billing_invoice_records')
ORDER BY tablename, policyname;

-- Expect 4 rows
SELECT indexname FROM pg_indexes
WHERE tablename IN ('project_milestones', 'project_submittals', 'billing_invoice_records')
  AND indexname LIKE 'idx_%';

-- Expect 3 rows
SELECT trigger_name, event_object_table FROM information_schema.triggers
WHERE trigger_name LIKE 'trg_%updated_at'
  AND event_object_table IN ('project_milestones', 'project_submittals', 'billing_invoice_records');
```

**PASS:** all counts match. **FAIL:** any missing → migration did not apply cleanly.

---

## Step 1 — Verify Vercel deploy

```bash
npx vercel ls openplan --scope natford | head -5
```

Confirm latest deployment status is `Ready` and timestamp is after merge.

Visit: `https://openplan-zeta.vercel.app` — confirm app loads, no build error page.

---

## Step 2 — Auth + project detail smoke

1. Sign in with a workspace-member account.
2. Navigate to an existing project: `/projects/<project-id>`.
3. **PASS criteria:**
   - Page loads without error.
   - Milestones section is visible (may be empty).
   - Submittals section is visible (may be empty).
   - Existing project fields (title, description, etc.) still render correctly.

---

## Step 3 — Milestone CRUD round-trip

1. On project detail, create a new milestone:
   - Title: `QA-test-milestone-delete-me`
   - Type: `schedule`
   - Phase: `initiation`
   - Status: `not_started`
   - Target date: tomorrow
2. **PASS:** milestone appears in list after save.
3. Edit the milestone: change status to `complete`, set actual date to today.
4. **PASS:** updated values persist after page reload.
5. Screenshot: project detail showing the test milestone.

---

## Step 4 — Submittal CRUD round-trip

1. On project detail, create a new submittal:
   - Title: `QA-test-submittal-delete-me`
   - Type: `progress_report`
   - Status: `draft`
   - Due date: tomorrow
2. **PASS:** submittal appears in list after save.
3. Edit the submittal: change status to `internal_review`, increment review cycle.
4. **PASS:** updated values persist after page reload.
5. Screenshot: project detail showing the test submittal.

---

## Step 5 — Billing / invoice register smoke

1. Navigate to `/billing`.
2. **PASS:** page loads, invoice register section is visible.
3. Create a new invoice record:
   - Amount: `5000.00`
   - Retention percent: `10`
   - Status: `draft`
   - Due date: 30 days from now
4. **PASS:** record appears with computed retention ($500) and net ($4500).
5. Edit the invoice: change status to `submitted`.
6. **PASS:** status persists after page reload.
7. Screenshot: billing page showing the test invoice.

---

## Step 6 — RLS isolation check

1. Sign in with a **different** workspace-member account (different workspace).
2. Navigate to `/billing`.
3. **PASS:** the test invoice from Step 5 is **not visible** (workspace-scoped).
4. Navigate to `/projects/<same-project-id>`.
5. **PASS:** returns 404 or empty if user is not a member of that project's workspace.

If only one workspace exists: skip this step and note "RLS isolation not tested — single workspace" in the proof log.

---

## Step 7 — Role-matrix enforcement check

1. Sign in as a `member` role user (not owner/admin).
2. Navigate to `/billing`.
3. Attempt to create an invoice record.
4. **PASS:** creation is denied (403 or UI prevents action). Members can read but not write invoice records per role matrix:
   - `billing.invoices.read` → owner, admin, **member** ✓
   - `billing.invoices.write` → owner, admin only (member excluded) ✓

---

## Step 8 — Regression spot-check

1. Navigate to `/projects` list → **PASS:** loads, shows existing projects.
2. Navigate to a model detail page → **PASS:** loads, no error.
3. Navigate to `/billing` (existing Stripe section) → **PASS:** existing billing/subscription info still renders.
4. Run one existing Analysis Studio action → **PASS:** no regression.

---

## Step 9 — Proof capture

Save all screenshots + this log to:
```
docs/ops/2026-03-22-test-output/
```

Files to capture:
- `lapm-milestone-crud.png`
- `lapm-submittal-crud.png`
- `lapm-invoice-crud.png`
- `lapm-rls-isolation.png` (if tested)
- `lapm-role-matrix-deny.png`
- `lapm-validation-log.md` (copy of pass/fail results)

---

## Step 10 — Cleanup

Delete all QA test records created above:
- `QA-test-milestone-delete-me`
- `QA-test-submittal-delete-me`
- Invoice record created in Step 5

Verify: no QA debris remains in production.

---

## Verdict Template

```
## LAPM Lane C Validation — 2026-03-22

Migration applied: PASS / FAIL
Vercel deploy confirmed: PASS / FAIL
Project detail loads: PASS / FAIL
Milestone CRUD: PASS / FAIL
Submittal CRUD: PASS / FAIL
Invoice register CRUD: PASS / FAIL
RLS isolation: PASS / FAIL / SKIPPED
Role-matrix enforcement: PASS / FAIL
Regression spot-check: PASS / FAIL
Proof captured: YES / NO
Cleanup done: YES / NO

VERDICT: GO / HOLD
HOLD REASON (if any): ___

Signed: ___
Date: ___
```
