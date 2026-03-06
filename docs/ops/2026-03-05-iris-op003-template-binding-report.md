# Iris OP-003 Interim Template Binding Report

Date: 2026-03-05 (PST)  
Owner: Iris Chen (expert-programmer)  
Branch: `ship/phase1-core`

## 1) What changed

Implemented minimal production-safe OP-003 interim wiring so the **current workspace bootstrap flow** now binds the California stage-gate template by default.

### Code changes
1. Added stage-gate template loader + registry for bootstrap-time binding:
   - `resolveStageGateTemplateBinding()` defaults to `ca_stage_gates_v0_1`
   - rejects unsupported template IDs
   - emits explicit `lapmFormIdsStatus: deferred_to_v0_2`
2. Updated `POST /api/workspaces/bootstrap` to:
   - accept optional `stageGateTemplateId`
   - enforce supported template selection (400 on unsupported)
   - persist bound template metadata on workspace insert
   - return `stageGateTemplate` metadata in response payload
3. Added DB migration for interim workspace-level template binding metadata:
   - `stage_gate_template_id`
   - `stage_gate_template_version`
   - `stage_gate_binding_source`
   - `stage_gate_bound_at`
   - check constraints + index for safe enforcement
4. Added/updated tests for default binding + unsupported template rejection + explicit CA binding selection.
5. Updated onboarding runbook docs to reflect current enforcement behavior and migration posture.

## 2) Files touched

- `openplan/src/lib/stage-gates/template-loader.ts` (new)
- `openplan/src/lib/stage-gates/templates/ca_stage_gates_v0.1.json` (new runtime template artifact copy)
- `openplan/src/app/api/workspaces/bootstrap/route.ts`
- `openplan/src/test/workspaces-bootstrap-route.test.ts`
- `openplan/src/test/stage-gate-template-loader.test.ts` (new)
- `openplan/supabase/migrations/20260305000009_op003_workspace_stage_gate_binding.sql` (new)
- `openplan/docs/PILOT_ONBOARDING_RUNBOOK.md`
- `docs/ops/2026-03-05-iris-op003-template-binding-report.md`

## 3) Validation output (local)

Run from: `/home/nathaniel/.openclaw/workspace/openplan/openplan`

### lint
- Command: `npm run lint`
- Result: PASS

### test
- Command: `npm test`
- Result: PASS
- Summary: `17 passed`, `63 passed`

### build
- Command: `npm run build`
- Result: PASS
- Summary: Next.js production build compiled successfully; static pages generated; API routes include `/api/workspaces/bootstrap`.

## 4) Rollback notes

If this interim OP-003 binding must be reverted:
1. Revert code changes in bootstrap route + template loader/tests.
2. Revert migration `20260305000009_op003_workspace_stage_gate_binding.sql` (or ship follow-up migration dropping interim columns/constraints/index).
3. Re-run `npm run lint && npm test && npm run build`.

## 5) Migration notes (toward v0.2)

- Current behavior is intentionally **interim**: template binding occurs at workspace bootstrap because project creation API/UI is not yet canonical.
- TODO marker is included in loader/migration to move binding ownership to project create path in v0.2.
- Exact LAPM exhibit/form identifiers remain **deferred** (`lapmFormIdsStatus: deferred_to_v0_2`) and are not hardcoded into current enforcement logic.

## 6) Local commit

- Commit hash is provided in the execution summary for this run.
