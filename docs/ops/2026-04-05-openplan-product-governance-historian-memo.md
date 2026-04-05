# OpenPlan Product / Governance Historian Memo

**Date:** 2026-04-05
**Author:** Bartholomew Hale (historian synthesis lane)
**Purpose:** reconcile OpenPlan’s original thesis, v1 ship artifacts, governance locks, and recent April production evidence into one current-truth memo.

## Source spine reviewed
Primary historical/product/governance sources reviewed:
- `promt1.md`
- `docs/plans/2026-02-19-platform-design.md`
- `docs/plans/2026-02-19-phase1-implementation.md`
- `openplan/docs/FEATURE_PARITY_MATRIX.md`
- `docs/ops/2026-03-05-openplan-blueprint-requirements-lock.md`
- `docs/ops/2026-03-13-openplan-option-c-reset-directive.md`
- `docs/ops/2026-03-15-openplan-v1-command-board.md`
- `docs/ops/2026-03-15-openplan-v1-execution-queue.md`
- `docs/ops/2026-03-16-openplan-v1-internal-ship-gate.md`
- `docs/ops/PRINCIPAL_QA_APPROVAL.md`
- `docs/ops/2026-03-17-openplan-v1-status-memo.md`
- `docs/ops/2026-03-21-openplan-four-priority-acceleration-plan.md`
- `docs/ops/2026-03-22-openplan-priority-order-governance-lock.md`
- `docs/ops/2026-03-22-openplan-nevada-county-modeling-truth-memo.md`
- `docs/ops/2026-03-24-openplan-county-onramp-api-outline.md`
- `docs/ops/2026-04-05-openplan-vercel-consolidation.md`
- `docs/ops/2026-04-05-openplan-production-authenticated-smoke.md`
- `docs/ops/2026-04-05-openplan-production-county-scaffold-smoke.md`
- `docs/ops/2026-04-05-openplan-production-managed-run-smoke.md`
- `docs/ops/2026-04-05-openplan-production-scenario-comparison-smoke.md`
- `docs/ops/2026-04-05-openplan-responsive-layout-audit-summary.md`
- `knowledge/PARA/Projects/OpenPlan.md`

Google Docs scan result:
- no clearly OpenPlan-governing Google Doc links were found in the repo/knowledge context.
- only generic ops/business Google Docs appeared in February digests; none added better OpenPlan product truth than the repo docs above.

---

## 1. Current truth: what OpenPlan is now

OpenPlan is **not** the original all-in-one transportation-planning platform yet, and it is **not** just the old corridor-analysis app anymore.

Current honest definition:
- a **modular Planning OS** with a real authenticated app shell,
- real first-class planning records for **projects, plans, programs, models, reports, scenarios, engagement campaigns, billing, and county runs**,
- a working production lane for **planning-domain continuity**,
- a working production lane for **engagement -> report handoff and report traceability**,
- an early but real **managed modeling / county onboarding** surface,
- a partially real **LAPM / PM / invoicing backbone**,
- and a still-bounded **AI/copilot / analysis** layer.

What is materially production-proven as of 2026-04-05:
- authenticated create/list/detail continuity across **Project -> Plan -> Model -> Program**,
- billing page load in authenticated context,
- managed model-run launch + linked analysis attachment,
- scenario comparison board with baseline vs alternative deltas,
- county run creation + manifest ingest + scaffold editing workflow,
- responsive layout hardening on core authenticated pages,
- canonical deployment/project/alias consolidation to `natford/openplan` + `openplan-natford.vercel.app`.

What OpenPlan is **not** yet:
- not an honest “full transportation suite” across the original thesis,
- not a validated behavioral modeling product,
- not a fully closed external-commercial proof story,
- not yet a finished LAPM/legal-grade compliance system,
- not yet a Social Pinpoint-class engagement suite by breadth.

---

## 2. What MUST be true before honest v1 launch language

For honest v1 launch language, the following must be true **at the exact claimed scope**:

1. **The v1 boundary is written down and narrow.**
   - Must explicitly say what modules/flows are included.
   - Must stop implying the full blueprint is shipping now.

2. **Principal QA is refreshed or explicitly carried forward for the actual launch scope.**
   - Current principal PASS is narrow and historically tied to internal pre-close / pilot-readiness.
   - If launch scope differs materially, re-adjudication is needed.

3. **Commercial language matches payment proof reality.**
   - Either run a fresh paid happy-path canary, or keep launch language bounded by the existing waiver/evidence boundary.
   - No claiming “fully commercially proven” without that evidence.

4. **Current canonical production truth is the Nat Ford Vercel project/alias.**
   - `natford/openplan`
   - `https://openplan-natford.vercel.app`

5. **The planning-domain core remains production-smoked on current deploys.**
   - Project / Plan / Model / Program continuity must still hold.
   - Billing route must still behave correctly.

6. **Any launch language mentioning county/modeling must preserve screening-grade caveats.**
   - Not behavioral demand.
   - Not calibrated.
   - Not forecast-ready.
   - Not client-safe for outward modeling claims beyond bounded screening.

7. **Any launch language mentioning LAPM / PM / invoicing must reflect actual shipped operator surfaces, not template ambition.**
   - If the project-controls shell is not visibly usable and proven, do not market LAPM depth broadly.

8. **Any launch language mentioning engagement must stay inside what is actually proven.**
   - Campaigns, moderation, share/public intake, handoff to reports, traceability.
   - Not “best-in-class civic engagement platform” yet.

9. **Production QA cleanup discipline must remain in place.**
   - Proof runs cannot leave confusing debris that distorts customer/admin reality.

10. **Truth-state separation remains enforced.**
   - code truth != migration truth != deploy truth != browser proof != marketing language.

---

## 3. Outdated assumptions/docs that should no longer drive execution

These documents remain useful historically, but should **not** govern present execution without translation:

1. **`docs/plans/2026-02-19-platform-design.md`**
   - Too anchored in “AI transit analysis layer” as the whole product.
   - Pre-dates the Option C Planning OS correction.

2. **`docs/plans/2026-02-19-phase1-implementation.md`**
   - Scaffold-era implementation packet for an earlier product shape.
   - Useful as origin history, not current delivery truth.

3. **`openplan/docs/FEATURE_PARITY_MATRIX.md`**
   - Written when OpenPlan lacked many now-real modules.
   - No longer an accurate picture of current surface area.

4. **Early public no-login / top-100-GTFS / “free forever” framing as the primary go-to-market story.**
   - Historically important, but not current execution truth.
   - The product moved toward authenticated Planning OS workflows.

5. **Any doc that treats corridor analysis as the whole product.**
   - Superseded by the 2026-03-13 Option C reset.

6. **Any doc that implies modeling is already a real multi-engine production lane.**
   - The modeling truth memo explicitly rejects that claim.

7. **Any doc that assumes broad feature expansion should outrun governance priority order.**
   - Superseded by the 2026-03-22 governance lock: LAPM/PM/invoicing -> engagement -> AI copilot -> modeling.

8. **Any doc that assumes duplicate Vercel projects/aliases are acceptable.**
   - Superseded by the 2026-04-05 consolidation.

---

## 4. Top 10 blockers / open questions (priority order)

1. **What is the exact v1 product sentence now?**
   - Planning OS core + engagement/report + managed runs + county screening?
   - Or planning core only?
   - This must be explicit before launch language.

2. **Does Nathaniel want a fresh external/commercial proof cycle, or a deliberately pilot-only launch posture?**
   - This determines whether a paid canary is required.

3. **How much of LAPM / PM / invoicing is honestly launchable now?**
   - There is real scaffolding and migration/application progress, but unclear current production proof depth for a client-facing claim.

4. **Is engagement only an internal/operator-plus-public-intake lane, or a marketed differentiation headline?**
   - The latter needs stronger proof and sharper boundary discipline.

5. **Will county runs/modeling appear in v1 positioning?**
   - If yes, the product must foreground “bounded screening-grade” language everywhere.

6. **What production proof packet is the canonical launch packet after the 2026-04-05 wave?**
   - Current evidence exists, but it is distributed across March and April artifacts.

7. **What current-scope principal review artifact is canonical for the April product state?**
   - The signed artifact is from 2026-03-17 and tied to narrower scope.

8. **What is the live operator story for the AI/copilot lane?**
   - Useful grounded assistant, or core launch feature? This remains strategically ambiguous.

9. **How will Supabase/Vercel truth be checked during launch-critical work?**
   - Future execution should explicitly use Supabase MCP and Vercel MCP when they reduce drift risk.

10. **What proof closes the modeling lane enough for outward mention, if any?**
   - The current answer from Adrian is still: one bounded validation slice on the canonical run bundle.

---

## 5. Recommended v1 boundary

## In
- Authenticated **Planning OS core**:
  - projects
  - plans
  - programs
  - models
  - reports
  - scenarios / comparison board
- **Engagement core**:
  - campaign catalog/detail
  - categories/items
  - moderation
  - public/share submission flow
  - engagement -> report handoff
  - report traceability back to engagement source
- **Managed-run surface** where already proven:
  - model detail launch flow
  - linked run history
  - scenario-entry run attachment
- **County run onboarding shell**:
  - county run creation/detail
  - manifest/artifact/scaffold workflow
- **Billing / admin baseline** only to the extent production-proven and operationally usable.

## Out
- Full original-platform claims spanning the whole blueprint.
- Broad “AI-powered transportation suite” language.
- Broad “multi-engine modeling platform” language.
- Any claim of validated/calibrated forecasting.
- Any claim that OpenPlan has full LAPM legal/compliance automation.
- Any claim of feature-breadth superiority over Social Pinpoint, Replica, StreetLight, Remix/Via, etc.
- Any claim that public/open explore transit analysis is the day-one center of truth.

## Pilot/internal only
- County modeling / Nevada pipeline and similar modeling lanes.
- Any AequilibraE / ActivitySim / MATSim posture beyond bounded screening/prototype evidence.
- Any unfinished project-controls / invoicing surfaces not yet clearly browser-proven in production.
- Any copilot/assistant capabilities that are useful but not yet operationally central and repeatedly validated.

---

## Governing recommendation

Use this framing for future planning:

> OpenPlan v1 should be presented as a **production-backed, modular planning operating system for scoped pilot use**, strongest today in authenticated planning workflow continuity, engagement-to-report traceability, scenario/run coordination, and early county/modeling onboarding infrastructure — with modeling and advanced compliance claims kept explicitly bounded.

Execution posture going forward:
- ship directly to `main` in small validated slices,
- use **Supabase MCP** and **Vercel MCP** whenever they materially improve truth-state or reduce release-risk drift,
- keep launch language narrower than the product dream until the proof packet catches up.
