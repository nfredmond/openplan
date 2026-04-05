# LAPM / PM / Invoicing — Release & Validation Checklist

**Date:** 2026-03-22  
**Author:** Mateo Ruiz (Assistant Planner — release support lane)  
**Source branch:** `lapm-pm-invoicing` worktree  
**Source commit:** `58d3534`  
**Scope:** Migration application, post-deploy validation, and handoff proof for Lane C merge into `main`.

---

## Pre-Merge Gate

### 1. Migration safety review
- [ ] **Migration file exists:** `openplan/supabase/migrations/20260321000032_lane_c_lapm_pm_invoicing.sql` (321 lines)
- [ ] **Tables created (3):**
  - `project_milestones` — milestone tracking with LAPM phase codes
  - `project_submittals` — submittal tracking with review cycles
  - `billing_invoice_records` — workspace-scoped invoice register
- [ ] **All tables use `IF NOT EXISTS`** — safe for re-run
- [ ] **RLS enabled on all 3 tables** — confirmed
- [ ] **RLS policies (9):**
  - `project_milestones`: read / insert / update (workspace-member scoped via project → workspace join)
  - `project_submittals`: read / insert / update (same join pattern)
  - `billing_invoice_records`: read / insert / update (direct workspace-member scope)
- [ ] **Policies use `IF NOT EXISTS` guard** — confirmed (pg_policies check before create)
- [ ] **Indexes (4):**
  - `idx_project_milestones_project_updated`
  - `idx_project_submittals_project_updated`
  - `idx_billing_invoice_records_workspace_updated`
  - `idx_billing_invoice_records_project_updated`
- [ ] **Triggers (3):** `updated_at` auto-set on all 3 tables via existing `set_project_subrecord_updated_at()` function
- [ ] **No destructive operations:** no `DROP TABLE`, no `ALTER TABLE DROP COLUMN`, no data deletes
- [ ] **Foreign keys verified:**
  - `project_milestones.project_id` → `projects(id)` ON DELETE CASCADE
  - `project_submittals.project_id` → `projects(id)` ON DELETE CASCADE
  - `billing_invoice_records.workspace_id` → `workspaces(id)` ON DELETE CASCADE
  - `billing_invoice_records.project_id` → `projects(id)` ON DELETE SET NULL
  - `billing_invoice_records.created_by` / `*.created_by` → `auth.users(id)` ON DELETE SET NULL

### 2. Code diff scope review
- [ ] **25 files changed** (per `git diff main --name-only`)
- [ ] **New API routes (2):**
  - `openplan/src/app/api/billing/invoices/route.ts`
  - `openplan/src/app/api/projects/[projectId]/records/route.ts`
- [ ] **New libraries (3):**
  - `openplan/src/lib/billing/invoice-records.ts`
  - `openplan/src/lib/projects/controls.ts`
  - `openplan/src/lib/stage-gates/operator-controls.ts`
- [ ] **New components (1):**
  - `openplan/src/components/billing/invoice-record-composer.tsx`
- [ ] **Modified components (1):**
  - `openplan/src/components/projects/project-record-composer.tsx`
- [ ] **Modified pages (2):**
  - `openplan/src/app/(app)/billing/page.tsx`
  - `openplan/src/app/(app)/projects/[projectId]/page.tsx`
- [ ] **New tests (5):**
  - `billing-invoice-records.test.ts`
  - `billing-invoices-route.test.ts`
  - `op001-role-matrix-conformance.test.ts`
  - `project-controls-summary.test.ts`
  - `project-records-route.test.ts`
- [ ] **Modified test (1):**
  - `stage-gate-operator-controls.test.ts`
- [ ] **Config/template files (4):**
  - `docs/ops/templates/ca_stage_gates_v0.1.json` (updated)
  - `docs/ops/templates/ca_stage_gates_v0.2_draft.json` (updated)
  - `openplan/src/lib/stage-gates/templates/ca_stage_gates_v0.1.json` (updated)
  - `openplan/src/lib/stage-gates/templates/lapm_pm_invoicing_controls_v0.1.json` (new)
- [ ] **Docs (2):**
  - `docs/ops/2026-03-05-ca-stage-gate-lapm-v02-review-pack.md` (updated)
  - `docs/ops/2026-03-05-california-stage-gate-template-pack.md` (updated)
- [ ] **No changes to auth, billing Stripe logic, or unrelated modules**

### 3. Local quality gate (run by engineering before merge)
- [ ] `npm run lint` — PASS
- [ ] `npm test` — PASS (confirm new tests included)
- [ ] `npm run build` — PASS
- [ ] Git working tree clean after build

---

## Post-Merge / Post-Deploy Validation

### 4. Migration application
- [ ] Migration applied to Supabase (production or linked project)
- [ ] Verify tables exist: `SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('project_milestones','project_submittals','billing_invoice_records');` → 3 rows
- [ ] Verify RLS enabled: `SELECT tablename, rowsecurity FROM pg_tables WHERE tablename IN ('project_milestones','project_submittals','billing_invoice_records');` → all `true`
- [ ] Verify policies: `SELECT tablename, policyname FROM pg_policies WHERE tablename IN ('project_milestones','project_submittals','billing_invoice_records') ORDER BY tablename, policyname;` → 9 rows

### 5. Production smoke (after Vercel deploy)
- [ ] **Project detail page loads** — `/projects/<id>` renders milestones and submittals sections
- [ ] **Milestone CRUD** — create a test milestone, verify it appears, edit it, verify update persists
- [ ] **Submittal CRUD** — create a test submittal, verify it appears, edit it, verify update persists
- [ ] **Billing page loads** — `/billing` renders invoice register section
- [ ] **Invoice CRUD** — create a test invoice record, verify it appears, edit it, verify update persists
- [ ] **RLS isolation** — confirm records are scoped to workspace membership (no cross-workspace leakage)
- [ ] **Stage-gate controls** — verify operator-controls surface reflects LAPM phase codes
- [ ] **No regression** — existing project detail, billing, and model surfaces still work

### 6. Proof capture
- [ ] Screenshot: project detail with milestone + submittal sections
- [ ] Screenshot: billing page with invoice register
- [ ] Screenshot or log: successful CRUD round-trip
- [ ] Save to: `docs/ops/2026-03-22-test-output/`

---

## Post-Smoke Cleanup
- [ ] Delete any test milestones/submittals/invoices created during smoke
- [ ] Verify cleanup: no QA debris remains in production

---

## Handoff Summary

| Item | Status |
|---|---|
| Migration reviewed | ☐ |
| Code diff scoped | ☐ |
| Local quality gate passed | ☐ |
| Migration applied | ☐ |
| Production smoke passed | ☐ |
| Proof captured | ☐ |
| QA cleanup done | ☐ |
| **RELEASE VERDICT** | **☐ GO / ☐ HOLD** |

**Sign-off:** Bart (overwatch) + Nathaniel (CEO)
