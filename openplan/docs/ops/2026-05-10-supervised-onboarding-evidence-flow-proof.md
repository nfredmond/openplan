# Supervised onboarding evidence flow proof

**Date:** 2026-05-10  
**Scope:** bounded proof/test/docs improvement connecting request-access intake, `/admin/operations`, manual provisioning, and `/admin/pilot-readiness` evidence.  
**Schema:** no schema changes.

## What changed

OpenPlan now has a reusable supervised-onboarding evidence bridge that is rendered on both operator surfaces:

- `/admin/operations` shows the bridge directly below the access-request intake queue so an allowlisted reviewer can see how prospect intake flows into pilot-readiness evidence.
- The bridge now includes a compact operator evidence ledger for three high-risk checkpoints: manual provisioning guard, post-deploy production-health evidence, and pilot-readiness handoff.
- `/admin/pilot-readiness` shows the same bridge inside the readiness evidence center so the exported/readiness posture remains tied back to the real admin intake and provisioning controls.
- Shared source data lives in `openplan/src/lib/operations/supervised-onboarding-evidence.ts`.
- Shared rendering lives in `openplan/src/components/operations/supervised-onboarding-evidence-flow.tsx`.

## Operator evidence ledger

- **Manual provisioning guard:** confirms `manual_provisioning_no_email` stays explicit before invite creation and does not authorize email, billing, or autonomous account activation.
- **Production health evidence:** points operators to the Admin Ops → Production Health Evidence Bridge so post-deploy admin proof stays paired with Vercel Ready state and public `/api/health` evidence.
- **Pilot-readiness handoff:** reminds operators to export/read the readiness packet and carry caveats into buyer-facing handoff notes before reliance.

## Evidence chain

1. **Public request intake captured**
   - Surface: `/request-access → access_requests`
   - Proof: `openplan/src/test/access-request-route.test.ts`
   - Boundary: a stored request is a prospect signal only; it does not create a workspace, send email, or imply acceptance.

2. **Admin Operations reviewer triages**
   - Surface: `/admin/operations → Recent supervised onboarding requests`
   - Proof: `openplan/src/test/admin-operations-page.test.tsx`
   - Boundary: prospect rows render only for allowlisted operators; do not paste prospect PII into external proof notes.

3. **Manual provisioning acknowledgement gates invite creation**
   - Surface: `POST /api/admin/access-requests/[accessRequestId]/provision`
   - Proof: `openplan/docs/ops/2026-05-10-access-request-manual-provisioning-guard-proof.md`
   - Boundary: invite creation requires contacted/invited posture plus `manual_provisioning_no_email`; no autonomous onboarding email is claimed.

4. **Pilot Readiness packet carries caveats**
   - Surface: `/admin/pilot-readiness`
   - Proof: `docs/ops/2026-05-10-openplan-final-pilot-readiness-smoke-checklist.md`
   - Boundary: PASS supports a supervised pilot-readiness conversation only; it is not a launch certificate or finished-suite claim.

## Why this matters

Before this slice, request-access, Admin Operations, and Pilot Readiness each had proof, but the operator had to mentally connect the chain. The new bridge makes the relationship explicit in-product and testable:

- intake evidence starts with a real stored request;
- admin review stays allowlisted and service-role controlled;
- provisioning remains manual and acknowledgement-gated;
- pilot readiness carries the same caveats before buyer reliance;
- production health evidence is kept adjacent to admin proof after deploys without inspecting Supabase rows or mutating production.

This is deliberately not a schema or automation expansion. It improves proof traceability without increasing the activation blast radius.

## Validation

Targeted validation for this slice:

```bash
corepack pnpm exec vitest run \
  src/test/admin-operations-page.test.tsx \
  src/test/supervised-onboarding-evidence-flow.test.tsx \
  src/test/admin-ops-prod-health-evidence-bridge.test.ts
```

Optional focused lint:

```bash
corepack pnpm exec eslint \
  src/lib/operations/supervised-onboarding-evidence.ts \
  src/components/operations/supervised-onboarding-evidence-flow.tsx \
  src/test/supervised-onboarding-evidence-flow.test.tsx \
  src/test/admin-operations-page.test.tsx
```

## Supabase assessment

No migration is required. This slice reads no new database fields and applies no Supabase writes. It only documents and renders the existing access-request/admin/pilot-readiness proof chain plus the already-documented no-write production-health evidence bridge.
