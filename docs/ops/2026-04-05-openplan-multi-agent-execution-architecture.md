# OpenPlan Multi-Agent Execution Architecture — Honest V1 Launch

**Date:** 2026-04-05
**Author:** Bartholomew Hale (COO lane)
**Purpose:** convert the current OpenPlan truth-state into a practical multi-agent execution model for an honest v1 launch.

---

## 1) Ground truth

OpenPlan is **not** at zero. The repo and ops packet already support a narrow but real posture:
- `main` is the canonical ship line and Vercel production source.
- Planning-domain continuity, production auth flow, edit persistence, report traceability, and production QA cleanup all have real evidence.
- Principal approval already exists for **internal pre-close / pilot-readiness** with explicit external-language caution.
- The current governance lock puts priority in this order:
  1. **LAPM / PM / invoicing**
  2. **Engagement**
  3. **AI copilot**
  4. **Modeling combo**

Therefore the next execution wave should **not** reopen broad platform sprawl. It should close the highest-value operational and trust gaps, refresh proof on production, and then launch with language that matches evidence.

---

## 2) Execution posture recommendation

### Default posture
Use **direct-to-main shipping in small validated slices**.

### Why
Earlier worktree/branch lane splits were useful during collision-heavy recovery. They are no longer the right default because:
- branch audit says no product-critical work is stranded outside `main`
- Vercel production already tracks `main`
- launch risk is now more about **truth, proof, and scoped hardening** than massive isolated build waves

### Exception rule
Use a temporary branch/worktree **only if one of these is true**:
1. two active writers will touch the same file subtree for more than one short slice,
2. the lane requires a risky schema/refactor rollback envelope,
3. the shared repo checkout is dirty/untrustworthy and a clean isolated checkout is the safer short-term move,
4. a long-running modeling experiment would otherwise block day-to-day launch shipping.

If none of those are true, ship to `main` in tight increments.

---

## 3) Proposed team structure for the next execution wave

## Command lane (non-coding owner)
### Lane 0 — Command / governance / stop-go
- **Owner:** Elena Marquez
- **Support:** Bartholomew
- **Role:** single owner of execution order, lock posture, release truth, and PASS/HOLD decisions
- **Writes:** `docs/ops/*launch*`, approval memos, lane board, blocker list
- **Does not own:** feature implementation

## Active writer lanes
### Lane 1 — Operational core: LAPM / PM / invoicing / billing trust
- **Owner:** Iris Chen
- **Why first:** current governance lock says this is priority #1, and the 2026-03-22 production UX review still shows trust-critical billing/operational clarity gaps
- **Primary file boundary:**
  - `openplan/src/app/(app)/billing/**`
  - `openplan/src/app/api/billing/**`
  - `openplan/src/components/billing/**`
  - `openplan/src/lib/billing/**`
  - billing-specific docs/tests only

### Lane 2 — Engagement differentiation and report handoff reliability
- **Owner:** Iris Chen (or second engineering worker under Iris ownership)
- **Planner acceptance partner:** Owen Park
- **Why second:** priority #2 and strongest visible differentiation after operational core
- **Primary file boundary:**
  - `openplan/src/app/(app)/engagement/**`
  - `openplan/src/app/(public)/engage/**`
  - `openplan/src/app/api/engagement/**`
  - `openplan/src/app/api/engage/**`
  - `openplan/src/components/engagement/**`
  - `openplan/src/lib/engagement/**`
  - engagement-specific docs/tests only

### Lane 3 — Proof, production smoke, and evidence hygiene
- **Owner:** Mateo Ruiz
- **Support:** Bartholomew
- **Why active:** honest launch requires current-cycle proof, not stale confidence
- **Primary file boundary:**
  - `qa-harness/**`
  - `docs/ops/*proof*`
  - `docs/ops/*smoke*`
  - `docs/ops/*cleanup*`
  - current-cycle `docs/ops/<date>-test-output/**`
- **Rule:** may request tiny app hooks/selectors for harness stability, but does not own product behavior changes

## Review / acceptance lanes
### Lane 4 — Acceptance, runbooks, and client-safe wording
- **Owner:** Owen Park
- **Why active:** converts engineering progress into planner-facing acceptance and launch-safe language
- **Primary file boundary:**
  - runbooks
  - acceptance criteria docs
  - launch note drafts
  - client-safe positioning copy
- **Rule:** docs-first; no feature scope creation disguised as copy review

### Lane 5 — UX clarity audit and patch requests
- **Owner:** Camila Reyes
- **Why active:** current UX review already identified the most launch-relevant clarity bugs
- **Primary file boundary:**
  - review memos
  - annotated patch guidance
  - targeted copy/layout recommendations
- **Rule:** by default Camila should hand patch instructions to Lane 1/2 instead of co-editing the same files directly

## Bounded support lane
### Lane 6 — Geospatial / modeling dependency guard lane
- **Owner:** Priya Nanduri
- **Status:** **support-only unless explicitly unlocked**
- **Why not a primary build lane yet:** priority order lock says modeling must stay bounded until #1 and #2 are credibly advancing
- **Allowed scope now:** dependency clarification, county-onramp data QA, evidence checks, no broad modeling expansion

## Deferred until unlock
### Lane 7 — AI copilot productization
- **Owner:** hold until Lane 1 + Lane 2 are green enough
- **Unlock condition:** operational core and engagement both have current proof and no unresolved P0 blocker

---

## 4) Sequence of waves and dependencies

## Wave 0 — Command reset and lane lock (same day, short)
**Goal:** start from one truth-state, not scattered memory.

### Outputs
- lane roster
- file-boundary lock
- exact current-cycle evidence target list
- “what is blocked / what is not blocked” memo

### Dependencies
- none

### Exit
- Command lane publishes the active board for this cycle
- every lane has a bounded file surface and acceptance target

---

## Wave 1 — Operational-core truth wave (must close first)
**Lane owners:** Lane 1 + Lane 3 + Lane 4 + Lane 5

### Target outcomes
- billing / invoicing surface becomes trustworthy enough for demos and real operator use
- subscription vs consulting-invoice IA is clear
- net/preview math and workspace targeting are deterministic
- current proof is refreshed on production

### Dependencies
- starts immediately after Wave 0
- Lane 3 smoke waits until Lane 1 ships a coherent slice

### Exit condition
- no unresolved trust-critical billing/UI bug remains in the launch path
- current-cycle proof exists, not just March proof

---

## Wave 2 — Engagement launch wave
**Lane owners:** Lane 2 + Lane 3 + Lane 4 + Lane 5

### Target outcomes
- public link state is explicit and operator-readable
- live public URL becomes primary over raw token mechanics
- closeout -> handoff-report flow is reliable and documented
- current production engagement smoke passes cleanly

### Dependencies
- Wave 1 must be at least stable enough that billing/operational core is not actively red

### Exit condition
- engagement can be demoed as differentiated product value without apology-heavy caveats

---

## Wave 3 — Honest launch packet refresh
**Lane owners:** Lane 0 + Lane 3 + Lane 4

### Target outcomes
- refresh proof packet
- refresh PASS/HOLD artifacts
- publish concise launch-safe positioning note
- decide exact launch language and any remaining caveat block

### Dependencies
- Wave 1 and Wave 2 accepted

### Exit condition
- Elena can issue a dated PASS/HOLD against the exact current-cycle evidence
- Bartholomew can issue secondary verification without hedging around stale proof

---

## Wave 4 — Post-launch bounded expansion
**Not launch-blocking.**

### Order
1. AI copilot on stable surfaces
2. modeling combo / county-onramp expansion

### Rule
These waves should not steal attention from launch closure unless Nathaniel explicitly changes the priority order.

---

## 5) Per-lane acceptance criteria and proof artifacts

## Lane 1 — Operational core / billing / invoicing
### Acceptance
- billing net/preview math is correct in the live composer path
- subscription vs consulting invoice functions are visually and mentally separated
- workspace targeting is deterministic for multi-workspace users
- relevant billing tests pass locally
- live billing surface smoke passes on production after deploy

### Proof artifacts
- targeted test output (`src/test/billing-*`, invoice-related tests)
- dated ops memo in `docs/ops/2026-04-05-*billing*`
- production screenshots/logs in current-cycle test-output folder
- if data state is involved: Supabase verification note with exact workspace/record evidence

## Lane 2 — Engagement differentiation
### Acceptance
- campaign share state is explicit (`Private`, `Public link active`, `Public + accepting submissions`, or equivalent)
- public URL is primary and operator-legible
- destructive public-link action is clearly named and confirmed
- handoff-report flow works from campaign to report detail without ambiguity
- engagement closeout runbook still matches live UX
- live production engagement smoke and handoff smoke pass

### Proof artifacts
- targeted tests for engagement routes/components where touched
- refreshed runbook / ops memo
- `qa-harness/openplan-prod-engagement-smoke.js`
- `qa-harness/openplan-prod-engagement-report-handoff-smoke.js`
- screenshots + smoke note in current-cycle `docs/ops/`

## Lane 3 — Proof / smoke / evidence hygiene
### Acceptance
- every launch-critical claim has a current artifact path
- no broken references in the refreshed launch packet
- production smoke artifacts are date-grouped, readable, and cleaned up afterward
- QA cleanup is run after production proof sessions that create durable artifacts/users

### Proof artifacts
- refreshed proof index
- refreshed cross-verification report
- current-cycle smoke notes
- cleanup report

## Lane 4 — Acceptance / runbooks / claim discipline
### Acceptance
- every active lane has written acceptance criteria and pass/fail language
- launch-safe wording does not outrun proof
- runbooks match actual product behavior after the latest slices
- a dated launch memo can be read by Nathaniel without needing repo archaeology

### Proof artifacts
- acceptance matrix
- updated runbooks
- client-safe positioning note
- launch memo / status memo

## Lane 5 — UX clarity review
### Acceptance
- top launch-critical clarity issues from the 2026-03-22 UX review are either fixed or explicitly deferred with rationale
- no new ambiguous destructive actions, hidden state, or trust-damaging preview bugs remain in launch paths
- review output is patch-level, not vague aesthetic theory

### Proof artifacts
- dated UX closure memo
- before/after captures or annotated screenshots
- issue list marked fixed / deferred / not-in-scope

## Lane 6 — Geospatial / modeling guard lane
### Acceptance
- only dependency clarifications or bounded QA tasks executed
- no modeling scope ballooning while Lane 1 or Lane 2 is red

### Proof artifacts
- small bounded memo only if needed

---

## 6) Safe collaboration rules

## File-boundary rules
1. **One primary writer per subtree.** If two lanes need the same subtree, the command lane assigns a temporary owner.
2. **Shared platform surfaces are serialized.** Only one writer at a time may touch:
   - `src/app/(app)/layout.tsx`
   - `src/components/app-shell.tsx`
   - nav/shared shell files
   - `src/lib/supabase/**`
   - auth/proxy/middleware
   - `supabase/migrations/**`
3. **Docs lanes do not silently edit product code.** Review lanes request patches; owner lanes ship them.

## Parallelize when
Parallel work is safe when lanes stay in separate module trees and separate proof docs:
- Lane 1 billing code
- Lane 2 engagement code
- Lane 3 harness/docs
- Lane 4 acceptance docs
- Lane 5 review memos

## Serialize when
Serialize immediately if the work touches:
- shared auth/session logic
- workspace bootstrap or role enforcement
- any Supabase migration or RLS change
- shared report generation primitives used by multiple lanes
- app shell / navigation / global layout
- launch packet canonical docs (`PRINCIPAL_QA_APPROVAL.md`, internal ship gate, proof packet)

## Direct-to-main shipping rules
1. Pull/rebase from `main` before starting.
2. Make one bounded change.
3. Run targeted validation.
4. Push to `main`.
5. Confirm Vercel deploy.
6. Run the appropriate smoke level.
7. Record evidence path.

If the repo changes underneath a lane and creates conflict in the same subtree, stop and re-hand off. Do not turn a small slice into a merge war.

---

## 7) Supabase MCP and Vercel MCP usage guidance

## Supabase MCP — use for inspection, verification, and bounded ops
Use Supabase MCP for:
- schema inspection
- RLS/policy inspection
- verifying workspace/member/billing/report/engagement row state
- debugging whether production data reflects the intended route behavior
- checking storage/artifact continuity

Do **not** make Supabase MCP the hidden source of truth for schema changes.

### Rule
- **Schema changes must still land as repo migrations** under `supabase/migrations/**`.
- Use Supabase MCP to **inspect before** and **verify after**.
- Manual row edits in production should be rare, deliberate, documented, and tied to QA cleanup or operator repair.

## Vercel MCP — use as deployment truth and post-push verification
Use Vercel MCP for:
- deployment status
- alias mapping
- root-directory/project configuration checks
- environment presence checks
- deploy log inspection when a push behaves oddly

### Rule
- do not use Vercel MCP to compensate for skipped local validation
- local gate first, Vercel confirmation second
- after each launch-relevant push, confirm the live alias is on the intended deployment before calling anything “proven”

---

## 8) When to smoke production

## Mandatory production smoke after any slice touching
- auth/session/protected-route behavior
- billing / invoices / checkout / webhook-adjacent logic
- workspace bootstrap / membership / role gates
- engagement public portal or operator handoff flow
- report generation / report traceability / cross-module link continuity

## Consolidated smoke is acceptable for
- low-risk presentational fixes inside a single module
- copy/layout fixes that do not alter data flow
- docs-only changes (no prod smoke needed)

## Production smoke order
1. verify Vercel deployment/alias
2. run targeted smoke harness
3. record artifact paths
4. run QA cleanup if production data/users were created

---

## 9) When to stop and request review

Stop immediately for command-lane review if any of these occur:
1. a lane needs a new migration or RLS change
2. a lane touches billing truth, money movement, refund posture, or launch claims
3. a lane wants to widen scope beyond its file boundary
4. a lane cannot prove a claim with an artifact path
5. production smoke fails or yields ambiguous state
6. two lanes need the same shared file subtree
7. a change would alter external/client-safe positioning language materially

---

## 10) Concrete launch-command plan

When Nathaniel says **execute**, do **not** immediately light up every speculative lane.

### Spin up these lanes first
1. **`openplan-command-v1`**
   - Owner: Elena
   - Mission: command board, lock posture, blocker arbitration, PASS/HOLD authority
   - Writes: docs only

2. **`openplan-lane1-billing-core`**
   - Owner: Iris
   - Mission: operational core / billing / invoicing trust fixes and validations
   - Branch posture: direct-to-main
   - Smoke target after each coherent slice: billing surface + affected flow

3. **`openplan-lane2-engagement-core`**
   - Owner: Iris (second worker if available)
   - Support reviewer: Owen
   - Mission: engagement share/public-state/handoff reliability
   - Branch posture: direct-to-main
   - Smoke target after coherent slice: engagement + report handoff

4. **`openplan-lane3-proof-ops`**
   - Owner: Mateo
   - Mission: qa-harness upkeep, proof packet refresh, artifact indexing, QA cleanup
   - Branch posture: direct-to-main for harness/docs only

5. **`openplan-lane4-acceptance`**
   - Owner: Owen
   - Mission: acceptance criteria, launch-safe wording, runbook refresh, evidence translation
   - Branch posture: direct-to-main for docs only

6. **`openplan-lane5-ux-review`**
   - Owner: Camila
   - Mission: patch-level UX closure guidance against current production
   - Branch posture: docs/review only unless command lane explicitly assigns a code slice

### Keep these in reserve until unlock
7. **`openplan-lane6-copilot-bounded`**
   - unlock only after Lane 1 and Lane 2 are both green enough for launch packet refresh

8. **`openplan-lane7-modeling-guard`**
   - keep support-only unless Nathaniel explicitly overrides the priority lock

### Activation order
- Start 1–6 in that order.
- Do **not** activate 7 or 8 during launch closure unless a higher-priority lane is genuinely clear.

---

## 11) Bottom line

The right execution model is **not** another sprawling multi-worktree expansion wave.

It is:
- command-led,
- direct-to-main,
- lane-bounded by file ownership,
- proof-driven,
- with operational core first,
- engagement second,
- and AI/modeling kept explicitly behind the launch gate.

That is the shortest honest path from the current OpenPlan state to a real v1 launch without pretending the remaining caveats do not exist.
