# OpenPlan V1 Command Board

**Date:** 2026-03-15  
**Owner:** Bartholomew Hale (COO)  
**Executive Sponsor:** Nathaniel Ford Redmond  
**Purpose:** single-source status board for what is done, what is partially done, and what must close before OpenPlan can be called a credible v1.

## Executive Status

**Last refreshed:** 2026-03-17

### Current scorecard
- **Pilot-ready v1 confidence:** ~85%
- **Original-plan coverage:** ~35%
- **Product posture:** evidence-backed planning-domain v1 candidate with production-proven report traceability and cleaned QA residue
- **Ship posture:** principal-approved for internal pre-close / pilot-readiness; external language must remain evidence-accurate because the fresh paid canary was waived rather than re-run

### Plain-English read
OpenPlan now has real current-production proof for the planning-domain core, real same-cycle principal adjudication, real production proof for the report-traceability backlink lane, and a cleaned production QA surface after today’s proof work.

The answer today is:
- **technical/product evidence:** strong and materially real
- **governance closure:** sufficient for internal pre-close / pilot-readiness
- **commercial closure:** accepted for now under CEO waiver, but not freshly re-proven with a same-cycle paid canary

### Current packet links
- Proof packet: `docs/ops/2026-03-16-openplan-v1-proof-packet.md`
- Internal ship gate: `docs/ops/2026-03-16-openplan-v1-internal-ship-gate.md`
- Current status memo: `docs/ops/2026-03-17-openplan-v1-status-memo.md`
- QA cleanup note: `docs/ops/2026-03-17-openplan-production-qa-cleanup.md`
- Client-safe/public-safe positioning note: `docs/ops/2026-03-17-openplan-client-safe-positioning-note.md`

---

## GREEN — materially shipped / real now

### Planning OS foundation
- Authenticated app shell and left-nav structure are in place.
- Projects are now a real first-class domain module.
- Project subrecords and timeline structure exist.

### Analysis + geospatial core
- Analysis Studio is real and operational.
- Data Hub is real and operational.
- SWITRS collision mapping is real when local geometry exists.
- Overlay readiness tiers are surfaced.
- Map context now persists into run history, reports, and comparison/export artifacts.

### Planning-domain module progress
- Programs v1 foundation shipped.
- Plans v1 foundation shipped.
- Models v1 foundation shipped.
- Models UX refinement shipped.
- Models now integrate into Plan detail and Program detail surfaces.
- Models catalog now supports real filtering/search.

### Recent shipping evidence
- `7a8c9a9` — provisioning cleanup hardening
- `518b342` — planning save rollback hardening
- `cdd2404` — billing purchaser-identity review hardening
- `6a4f6b5` — docs: close production alias promotion lane
- current proof notes:
  - `docs/ops/2026-03-16-openplan-production-authenticated-smoke.md`
  - `docs/ops/2026-03-16-openplan-production-edit-update-smoke.md`
  - `docs/ops/2026-03-16-openplan-live-billing-hold-canary.md`

---

## YELLOW — real progress, but still incomplete or not fully closed

### Cross-module workflow continuity
- Current production now proves create/list/detail continuity and safe edit/update persistence across Project / Plan / Model / Program.
- The remaining question is less about whether these surfaces work at all and more about whether every critical operator path is supportable enough for external v1 language.

### Billing/commercial closure depth
- The purchaser-identity mismatch hold branch is production-proven on the live app/webhook/UI/DB path.
- However, that proof still stops short of a real paid charge and does not freshly close cancel/refund posture in the same packet.

### Auth/access confidence
- Auth/proxy closure and protected-route continuity are now strong.
- A broader current-cycle auth evidence pass for every historical auth scenario (for example reset/session-expiry edge cases) is still lighter than the planning-domain proof lane.

### Launch readiness artifacts
- The current proof packet and internal ship-gate memo now exist.
- The canonical current-cycle principal artifact now exists as `docs/ops/PRINCIPAL_QA_APPROVAL.md`, but it remains HOLD / unsigned pending fresh Principal Planner adjudication against this exact packet.

---

## RED — still blocking an honest external v1 PASS

### Formal internal ship gate
- Principal Planner review is **not yet refreshed** for the present 2026-03-16 v1 packet.
- No honest external ship declaration should bypass that gate unless Nathaniel explicitly overrides it in writing.

### Final commercial release decision
- Current billing evidence is strong, but a decision is still required on whether “production-proven short of a real paid charge” is sufficient for pilot release.
- If not, a supervised paid canary and refreshed cancel/refund closeout remain blocking work.

### Operational support caveat
- Multi-workspace billing selection is still ambiguous enough to create operator confusion during billing review states.
- That is narrow, but it should be fixed or explicitly documented before strong external confidence language.

---

## ORIGINAL-PLAN TRACK — beyond pilot v1, but must keep moving now

These are part of the original OpenPlan thesis and should guide execution so v1 grows in the right direction:

### Still early relative to original plan
- community engagement as a real integrated module and data loop
- deeper scenario/planning/report orchestration
- chained demand-model / transportation-model posture
- AI-assisted workflow layer across planning tasks
- compliance / construction / implementation tracking
- broader integrated public/planner workflow continuity

### Current strategy
Do **not** try to finish the entire original vision in one reckless wave. Instead:
1. keep strengthening the Planning OS spine,
2. make the planner workflows deterministic,
3. close ship-critical auth/billing/reliability gaps,
4. add original-plan foundations in high-leverage slices that compound rather than sprawl.

## Research alignment update (2026-04-10)

The platform thesis has now been sharpened by the deep research synthesis.

OpenPlan should be treated as a **four-system regional planning operating system** built on one shared project/scenario/evidence spine:
- RTP OS
- Grants OS
- Aerial Operations OS
- Transportation Modeling OS

That changes the command-board interpretation in three useful ways:
1. the next high-compounding work is not random feature breadth, but shared scenario/data/indicator infrastructure,
2. modeling should be treated as a distinct product lane that writes back into planning decisions,
3. accessibility, equity, and environmental outputs should be planned as reusable platform outputs rather than report-only narrative fragments.

### Immediate strategic consequence
After the current control-room and pilot-proof lanes, the strongest next architecture-aligned work should move toward:
- scenario/versioning contracts,
- standards-first data and network package contracts,
- reusable indicator contracts,
- and then deeper RTP/grants/modeling integration through those shared objects.

---

## Immediate Next Actions

### 1. Principal Planner re-adjudication
Have Elena review the current packet:
- `docs/ops/2026-03-16-openplan-v1-proof-packet.md`
- `docs/ops/2026-03-16-openplan-v1-internal-ship-gate.md`

### 2. Commercial decision on billing sufficiency
Decide whether the current live billing proof posture is enough for pilot release or whether OpenPlan still requires:
- a supervised paid canary, and/or
- refreshed cancel/refund closeout documentation

### 3. Billing workspace-selection disposition
Either:
- tighten `/billing` workspace targeting for multi-workspace users, or
- explicitly document the current behavior as an operational caveat

### 4. Original-plan-aligned next module foundations
Once the gate posture is settled, prioritize the next slice that most improves the original platform thesis without destabilizing v1. Current likely candidates:
- engagement foundation tightening
- planning/report orchestration
- compliance/readiness scaffolding
- assistant workflow surface

### 5. Active execution queue
The immediate working queue remains at:
- `openplan/docs/ops/2026-03-15-openplan-v1-execution-queue.md`

---

## Decision Rule
If a task improves **trust, workflow determinism, pilot readiness, or the original platform spine**, it is in scope. If it is merely decorative, speculative, or isolated from actual operator value, defer it.
