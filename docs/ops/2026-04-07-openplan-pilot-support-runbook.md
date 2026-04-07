# OpenPlan Pilot Support Runbook — 2026-04-07

**Owner:** Owen Park  
**Support:** Bartholomew Hale, Mateo Ruiz  
**Status:** active internal runbook

## Purpose

Define how Nat Ford supports a supervised OpenPlan pilot without overpromising autonomy or support depth.

## Support model

- Support is human-led and bounded.
- Kickoff, midpoint, and closeout are standard.
- Material blockers escalate to the ops owner.
- Principal review is required where governance judgment matters.

## Named roles

- **Primary ops owner:** Bartholomew Hale
- **Principal reviewer:** Elena Marquez
- **Executive sponsor:** Nathaniel Ford Redmond
- **Ops support:** Owen Park / Mateo Ruiz

## Standard support expectations

- Acknowledge email support within 2 business days during the pilot window.
- Use scheduled review calls for major scope or interpretation changes.
- Do not improvise legal/compliance/modeling claims under pressure.
- Pause rather than bluff when context is unclear.

## Common issue categories

### 1. Workspace / access issue
- Confirm the correct workspace id and user role.
- Confirm the operator is in the intended workspace.
- Confirm the issue is not caused by stale QA/test context.
- Escalate if membership, provisioning, or role behavior looks wrong.

### 2. Billing confusion
- Confirm which workspace is being reviewed.
- Use the canonical billing truth language.
- Do not imply a fresh same-cycle paid canary happened.
- Pause if workspace targeting is ambiguous.

### 3. Workflow confusion
- Re-state the current in-scope workflow.
- Confirm what part is guided vs automated.
- Redirect out-of-scope asks into a follow-on note rather than winging it.

### 4. Product limitation or bug
- Capture exact route, object, and behavior.
- Record whether the problem blocks the current pilot objective.
- If blocking, escalate immediately.
- If non-blocking, document it in the closeout note.

## Escalation rules

Escalate immediately if:
- wrong workspace or wrong organization context appears,
- billing path is ambiguous,
- product behavior conflicts with documented proof,
- a claim would exceed current evidence,
- governance review is required.

## Required closeout note fields

Each pilot support closeout should include:
- pilot name / agency,
- workflow(s) exercised,
- what worked,
- what remained bounded or manual,
- what support was required,
- next recommended step.

## Bottom line

Support quality for a supervised pilot comes from clarity, restraint, and fast honest escalation, not from pretending the product is broader than it is.
