# OpenPlan V1 Execution Board — 7-Day Closeout

**Date:** 2026-04-07  
**Owner:** Bartholomew Hale (COO)  
**Status:** ACTIVE  
**Intent:** turn the v1 closeout plan into a concrete daily execution board with exact artifacts, commands, and decision checkpoints.

## Executive Read

OpenPlan should spend this sprint closing trust gaps, not opening new surface area.

The exact sequence is:
1. choose and lock the canonical proof alias,
2. run the supervised paid canary on that surface,
3. clean up billing/operator ambiguity,
4. refresh Principal QA approval,
5. lock external pilot language,
6. prepare the pilot ops pack,
7. make a formal go / no-go call.

## Ground Rules

- **No major new feature wave during this board.**
- **Canonical production alias defaults to:** `https://openplan-natford.vercel.app`
- If any proof uses a non-canonical alias, that override must be explicitly documented in the resulting artifact.
- Every proof run must emit evidence under `docs/ops/`.
- No external “v1 shipped” claim without refreshed Principal QA review or explicit CEO override.

## Working Source Documents

- `docs/ops/2026-04-07-openplan-v1-closeout-plan.md`
- `docs/ops/2026-04-07-openplan-production-authenticated-smoke.md`
- `docs/ops/2026-04-07-openplan-proof-rerun-preflight-refresh.md`
- `docs/ops/2026-04-05-openplan-proof-ops-runbook.md`
- `docs/ops/PRINCIPAL_QA_APPROVAL.md`

---

## Day 1 — Alias Lock + Proof Path Unblock

**Owner:** Iris Chen  
**Support:** Bartholomew Hale  
**Goal:** remove alias split-brain and make the billing proof path runnable.

### Tasks
1. Confirm whether `openplan-natford` remains the canonical proof surface.
2. If yes, obtain one of:
   - `OPENPLAN_VERCEL_PROTECTION_BYPASS_SECRET`, or
   - an authenticated browser session usable for proof execution.
3. If no, explicitly switch canonical proof to `openplan-zeta` and align all proof assumptions accordingly.
4. Record the decision in a fresh ops note.

### Suggested command checks
```bash
cd /home/narford/.openclaw/workspace/openplan
rg -n "openplan-natford|openplan-zeta" docs/ops openplan/scripts qa-harness
```

If checking current billing/public behavior manually:
```bash
curl -I https://openplan-natford.vercel.app/billing
curl -I https://openplan-zeta.vercel.app/billing
```

### Required artifact
- `docs/ops/2026-04-07-openplan-canonical-proof-alias-decision.md`

### Acceptance criteria
- One canonical alias is documented.
- Proof runner has a real path around deployment protection.
- No ambiguity remains about which public URL is authoritative for billing proof.

### Blockers to surface immediately
- missing bypass secret,
- deployment protection policy uncertainty,
- mismatch between public alias policy and Stripe/webhook posture.

---

## Day 2 — Supervised Paid Canary

**Owner:** Iris Chen  
**Support:** Bartholomew Hale  
**Goal:** produce a fresh, same-cycle billing proof packet on the canonical alias.

### Prep
Run local validation before touching production:
```bash
cd /home/narford/.openclaw/workspace/openplan/qa-harness
npm install
node --check harness-env.js
bash -n ../openplan/scripts/openplan-supervised-paid-canary-preflight.sh
```

### Preflight
```bash
cd /home/narford/.openclaw/workspace/openplan/openplan
./scripts/openplan-supervised-paid-canary-preflight.sh \
  --workspace-id <workspace-uuid> \
  --billing-email <operator-email>
```

### During supervised canary
- Use the exact alias and workspace id emitted by preflight.
- Do not improvise a second workspace or mixed alias path.

### Post-canary webhook proof
```bash
cd /home/narford/.openclaw/workspace/openplan/openplan
npm run ops:webhook-proof -- --workspace-id <workspace-uuid> --since-minutes 240 --env-file /tmp/openplan.vercel.env
```

### Required artifacts
- fresh dated canary packet under `docs/ops/<date>-test-output/`
- `docs/ops/2026-04-08-openplan-supervised-paid-canary-closeout.md`

### Acceptance criteria
- checkout path proven on canonical alias,
- subscription/webhook state auditable,
- evidence packet complete,
- any caveat explicit and narrow.

### If canary is waived again
Create:
- `docs/ops/2026-04-08-openplan-commercial-proof-waiver-refresh.md`

That memo must state:
- who waived it,
- why,
- what residual risk remains,
- what external language is still prohibited.

---

## Day 3 — Billing UX / Operator Clarity

**Owner:** Iris Chen  
**Support:** Owen Park  
**Goal:** make billing posture understandable and deterministic for operators.

### Tasks
1. Review current `/billing` workspace targeting behavior.
2. Determine whether ambiguity is code behavior, weak copy, or both.
3. Fix the behavior if feasible in one safe slice.
4. If not, document exact supported behavior and constrain language.
5. Ensure UI copy reflects supervised pilot posture, not broad self-serve maturity.

### Suggested investigation points
```bash
cd /home/narford/.openclaw/workspace/openplan
rg -n "workspaceId|billing|subscription|chooser" openplan/src
```

### Required artifacts
- code change if needed
- `docs/ops/2026-04-09-openplan-billing-operator-clarity-pass.md`

### Acceptance criteria
- operator can tell what workspace is being billed,
- billing review state is not misleading,
- UI language is honest about current release posture.

### Optional quality gate
```bash
cd /home/narford/.openclaw/workspace/openplan/openplan
npm run lint
npm run test
npm run build
```

---

## Day 4 — Principal QA Re-Adjudication

**Owner:** Elena Marquez  
**Support:** Bartholomew Hale, Owen Park  
**Goal:** replace stale approval ambiguity with current-cycle governance truth.

### Review packet inputs
At minimum, Elena should review:
- `docs/ops/2026-04-07-openplan-production-authenticated-smoke.md`
- `docs/ops/2026-04-07-openplan-proof-rerun-preflight-refresh.md`
- `docs/ops/2026-04-07-openplan-v1-closeout-plan.md`
- `docs/ops/2026-04-07-openplan-v1-execution-board.md`
- fresh canary closeout artifact from Day 2
- billing clarity memo from Day 3

### Required artifact
- refresh `docs/ops/PRINCIPAL_QA_APPROVAL.md`

### Acceptance criteria
- approval file is current-cycle,
- status is explicit PASS or HOLD,
- scope, assumptions, blockers, and recommendation are written plainly.

### Rule
If Elena cannot honestly issue PASS, do not soften the language. Keep HOLD and list the exact next blocker.

---

## Day 5 — COO Verification + External Language Lock

**Owner:** Bartholomew Hale  
**Support:** Elena Marquez  
**Goal:** make sure public/pilot language matches actual proof and governance state.

### Tasks
1. Reconcile proof state, billing state, and Principal review.
2. Refresh the ship-gate memo if needed.
3. Refresh client-safe/public-safe positioning language.
4. Remove any stale “broad launch” or “self-serve ready” implications.

### Required artifacts
- `docs/ops/2026-04-11-openplan-v1-status-memo-refresh.md`
- `docs/ops/2026-04-11-openplan-client-safe-positioning-refresh.md`

### Acceptance criteria
- every external claim is defensible,
- supervised pilot boundary is explicit,
- no outdated optimism remains in the active docs.

### Review lens
Check against:
- ethics,
- confidentiality,
- citation/traceability,
- commercial honesty,
- scope truth.

---

## Day 6 — Pilot Ops Pack

**Owner:** Owen Park  
**Support:** Bartholomew Hale, Mateo Ruiz  
**Goal:** make first-pilot support operationally real.

### Tasks
1. Draft a pilot onboarding checklist.
2. Define support boundaries, manual interventions, and escalation paths.
3. Define the first acceptable pilot cohort.
4. Draft a minimal auth/billing/provisioning runbook.

### Required artifacts
- `docs/ops/2026-04-12-openplan-pilot-onboarding-checklist.md`
- `docs/ops/2026-04-12-openplan-pilot-support-runbook.md`
- `docs/ops/2026-04-12-openplan-first-pilot-scope-note.md`

### Acceptance criteria
- pilot operator can explain onboarding and support,
- team knows what is manual vs automated,
- pilot scope is bounded and truthful.

---

## Day 7 — Go / No-Go Decision

**Owner:** Nathaniel Ford Redmond  
**Support:** Bartholomew Hale, Elena Marquez, Iris Chen  
**Goal:** make the release posture explicit, with rationale.

### Decision options
1. **PASS — supervised pilot v1**
2. **CONDITIONAL PASS — limited pilot admission**
3. **HOLD**

### Required artifact
- `docs/ops/2026-04-13-openplan-go-no-go-memo.md`

### Acceptance criteria
- one decision chosen explicitly,
- rationale tied to evidence,
- next queue updated based on outcome.

---

## Fast Escalation Rules

Escalate immediately if any of the following occurs:
- proof alias is still split between `natford` and `zeta`,
- deployment protection bypass is unavailable,
- Stripe webhook posture diverges from the canonical alias,
- a proof only passes through manual improvisation,
- billing language outruns current evidence,
- Principal QA stays stale while external claims are being drafted.

## Out of Scope During This Board

Do not start these unless one is required to unblock the above work:
- new engagement feature wave,
- new assistant workflow module,
- broad modeling-stack expansion,
- compliance megasystem work,
- decorative UI expansion.

## Success Condition

This board is successful if, by the end of Day 7, OpenPlan has:
- one canonical proof surface,
- a same-cycle billing proof or explicit documented waiver,
- refreshed Principal QA adjudication,
- honest pilot-facing language,
- a minimal operational support pack,
- and a written go / no-go decision.

## Immediate Next Three Actions

1. Create `2026-04-07-openplan-canonical-proof-alias-decision.md`.
2. Resolve the Vercel protection path for the canonical alias.
3. Schedule and execute the supervised paid canary on that exact surface.
