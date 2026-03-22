# OpenPlan #1 Priority Support — LAPM / PM / Invoicing Planning Checkpoint

Date: 2026-03-22  
Owner: Owen Park (planning/ops support only)  
Audience: Iris (engineering), Mateo (QA/runbooks/handoff), Elena (governance)  
Scope boundary: docs-only support for #1 priority. No code direction beyond defining a reviewable checkpoint.

## Purpose
Define the **smallest reviewable checkpoint** for OpenPlan priority #1 (LAPM / PM / invoicing) using current truth from existing OpenPlan evidence.

This memo is meant to help Iris build toward a clear checkpoint without expanding scope. It focuses on:
1. workflow language,
2. acceptance criteria,
3. user-facing planning logic.

## Evidence base used
- `docs/ops/2026-03-05-ca-stage-gate-lapm-v02-review-pack.md`
- `docs/ops/2026-03-16-openplan-billing-workspace-selection-elena-handoff.md`
- `docs/ops/2026-03-16-v1-provisioning-hardening.md`
- `docs/ops/2026-03-16-openplan-live-billing-hold-canary.md`
- `docs/ops/2026-03-16-billing-identity-review-hardening.md`

---

## 1) Smallest reviewable checkpoint

### Checkpoint name
**Project controls shell: workspace-scoped compliance + PM + invoicing baseline**

### Plain-English checkpoint definition
A checkpoint is reviewable when an authenticated operator can open the correct workspace/project context and see a **single project-controls shell** that clearly answers:
- What project is this?
- What compliance / delivery stage is it in?
- What evidence or approvals are still pending?
- What invoicing/control posture applies right now?
- What is safe to do next, and what must be reviewed first?

### What this checkpoint is **not**
- not full LAPM legal automation,
- not final invoice generation,
- not full engagement workflow,
- not modeling execution,
- not a substitute for principal/legal signoff on exact LAPM IDs.

This checkpoint should prove that OpenPlan can hold the **right project-control structure** before deeper feature expansion.

---

## 2) Workflow language (for product and review alignment)

Use this sequence as the planning/ops truth model for #1.

### Step 1 — Confirm workspace and project context
The operator must be in the **intended workspace/project context** before viewing compliance or invoicing controls.

**Reason from current evidence:** prior billing ambiguity proved that silent fallback across workspaces is unsafe on control-critical routes.  
Source: `docs/ops/2026-03-16-openplan-billing-workspace-selection-elena-handoff.md`

**Preferred user-facing idea:**
- “Select the workspace and project you are managing before reviewing compliance or invoicing controls.”

### Step 2 — Establish project-control baseline
The workspace/project should show a concise control summary:
- project name / sponsor context
- current stage/gate
- responsible role(s)
- current readiness / hold state
- whether evidence is complete, partial, or pending review

**Reason from current evidence:** stage-gate work already defines gate/evidence structure; provisioning hardening established that trust-critical routes should avoid ambiguous partial states.  
Sources: `docs/ops/2026-03-05-ca-stage-gate-lapm-v02-review-pack.md`, `docs/ops/2026-03-16-v1-provisioning-hardening.md`

### Step 3 — Separate “documented” from “approved”
Any LAPM/compliance item must distinguish between:
- documented/scaffolded,
- pending review,
- approved for use,
- not applicable.

**Reason from current evidence:** LAPM v0.2 pack explicitly keeps exact IDs and legal-sensitive fields in `PENDING_REVIEW` until planning/legal/principal signoff.  
Source: `docs/ops/2026-03-05-ca-stage-gate-lapm-v02-review-pack.md`

**Preferred user-facing idea:**
- “Draft compliance references are visible for coordination, but only approved references should be treated as active controls.”

### Step 4 — Keep invoicing status tied to compliance/project state
Invoicing/control language should answer:
- is invoicing allowed now,
- what prerequisite evidence is still missing,
- whether identity/workspace context is confirmed,
- and whether the item is ready for review, hold, or closeout.

**Reason from current evidence:** billing hold and identity review work proved that control-sensitive actions need explicit state, not implied readiness.  
Sources: `docs/ops/2026-03-16-openplan-live-billing-hold-canary.md`, `docs/ops/2026-03-16-billing-identity-review-hardening.md`

### Step 5 — Make the next safe action explicit
The project-controls shell should point to one next safe step such as:
- continue setup,
- gather missing evidence,
- request review,
- resolve hold,
- prepare closeout.

This keeps the lane operationally useful without pretending to automate every decision.

---

## 3) Acceptance criteria for the reviewable checkpoint

### A. Context integrity
1. The operator can only review controls inside an explicit workspace/project context.
2. The experience does **not** silently fall back to another workspace when context is ambiguous or invalid.
3. The visible header/state makes it obvious which workspace/project is being managed.

### B. Project-controls shell exists
4. A single project-control view/surface presents, at minimum:
   - project identity,
   - current gate/stage,
   - current control status,
   - assigned responsibility,
   - next required action.
5. The control view is understandable without needing raw internal IDs or engineering jargon.

### C. Compliance state discipline
6. LAPM/compliance references can be shown only in clearly separated states such as:
   - approved,
   - pending review,
   - optional,
   - not applicable.
7. No draft LAPM citation or scaffold field is presented as final legal certainty.
8. Unresolved compliance items are visible as blockers/review items, not hidden gaps.

### D. PM / invoicing logic discipline
9. The view distinguishes between:
   - ready for next step,
   - hold for missing evidence,
   - hold for review,
   - closeout-ready.
10. Invoicing/control status is tied to project state and evidence state, not shown as a free-floating financial label.
11. Any hold or restriction is explained in plain language the operator can act on.

### E. Review-readiness
12. A reviewer can inspect the checkpoint and answer, without guesswork:
   - what is known,
   - what is pending,
   - what is blocked,
   - what is the next safe move.
13. The checkpoint is narrow enough for Mateo to write QA/runbook steps against it.
14. The checkpoint is restrained enough for Elena to review governance posture without treating it as a final LAPM/legal pass.

---

## 4) User-facing planning logic

These are the planning rules the interface should embody, regardless of final UI shape.

### Rule 1 — Control context before action
If the operator has not selected the correct workspace/project context, the product should ask for that context **before** exposing compliance or invoicing controls.

### Rule 2 — Draft is not approval
If a compliance reference, evidence item, or control note is still draft/pending, the product should say so plainly.

### Rule 3 — Holds must be actionable
A hold should never read like a vague warning. It should indicate what kind of hold it is, such as:
- missing evidence,
- pending principal/legal review,
- workspace/context mismatch,
- identity/control prerequisite not satisfied.

### Rule 4 — Invoicing follows project-control truth
The product should avoid implying that invoicing is clean or ready when compliance/evidence state is still unresolved.

### Rule 5 — Next step beats dashboard noise
The most useful output at this stage is one recommended next step, not a crowded management surface.

---

## 5) Crisp scope guardrails for Iris’s lane

To keep #1 small and reviewable, this checkpoint should **not** require:
- final legal-grade LAPM citation binding,
- full accounting workflows,
- external invoice templates/export polish,
- cross-lane engagement features,
- modeling outputs,
- broad role/permission redesign beyond explicit context integrity.

If a proposed addition does not improve the reviewability of the **project-controls shell**, it is likely outside the smallest viable checkpoint.

---

## 6) Recommended checkpoint PASS test (planning/ops view)

I would treat the checkpoint as planning/ops-PASS-ready when this statement is true:

> In the correct workspace/project context, an operator can see the current project-control state, distinguish approved vs pending compliance items, understand invoicing/control posture, and know the next safe step without hidden assumptions or false certainty.

If that statement is not yet true, keep the checkpoint in HOLD and cut scope until it is.

---

## Bottom line
The right #1 checkpoint is **not** “build all LAPM / PM / invoicing features.”  
The right #1 checkpoint is a **workspace-scoped project-controls shell** that:
- preserves context integrity,
- shows stage/control status clearly,
- distinguishes draft from approved compliance state,
- ties invoicing posture to real project-control truth,
- and points the operator to one next safe move.

That is small enough to review, strong enough to QA, and disciplined enough not to step on broader scope.