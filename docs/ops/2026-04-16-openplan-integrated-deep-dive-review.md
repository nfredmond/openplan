# OpenPlan — Integrated Deep-Dive Review and 4-Week Execution Program

**Date:** 2026-04-16
**Owner:** Bartholomew Hale
**Executive sponsor:** Nathaniel Ford Redmond
**Status:** Canonical strategic review. Start-here document for cold-start agent chats and active execution.
**Purpose:** unify the 2026-04-16 integrated execution program with a fresh six-lane code-grounded deep-dive, so any new agent can pick up the work without prior context and so the team can execute against one shared punch list.

---

## TL;DR for a cold-start agent

You are working on **OpenPlan**, a shared planning operating system for small agencies, RTPAs, counties, tribes, and planning consultancies. The product unifies planning, funding, modeling, delivery, compliance, engagement, and field evidence around one project spine, with four operating systems (RTP, Grants, Modeling, Aerial) + one control-room runtime on top.

**Today's truth (verified in code 2026-04-16):**
- Build + lint + tests pass.
- All major lanes have real schema and routes. 54 migrations. 447 TS/TSX files. 147 tests. 14 prod smoke scripts.
- The platform is a **credible supervised-pilot Planning OS**, not yet the fully integrated operating system of the vision.
- The next chapter is **integration discipline**, not invention.

**Today's biggest pattern problem (the one to fix first):**
Write-back is one-directional everywhere. Every lane reads upstream state; no lane marks upstream state stale. Fix the write-back pattern and every scorecard line improves at once.

**What to do this chapter:**
Execute the 18-ticket 4-week program below in order. Do not start ticket N+1 until N is merged.

**How to use this doc:**
1. Skim this TL;DR + the "cross-cutting pattern" section (5 minutes).
2. Jump to your lane's section and read the findings (5-10 minutes).
3. Open the punch list and start the next unclaimed ticket.
4. Maintain the cross-cutting acceptance rules on every PR.

---

## Why this doc exists

OpenPlan has accumulated several strong planning memos:
- `docs/ops/2026-04-11-openplan-master-product-roadmap.md`
- `docs/ops/2026-04-13-openplan-canonical-architecture-status-and-build-plan.md`
- `docs/ops/2026-04-16-openplan-integrated-execution-program.md`

Those memos define the vision and phase order correctly. This document adds what they did not: **a fresh code-grounded verification of the scorecard, specific file:line evidence for every claim, a single unifying diagnosis, and one concrete 18-ticket punch list that spans every lane.**

Read this doc alongside those memos. When they disagree, trust this one (it is more recent and code-grounded); when they reinforce each other, execute.

---

## The single pattern that explains every gap

**Write-back is one-directional, everywhere.** Every lane reads upstream state. No lane marks upstream state stale.

| Where it hurts | Evidence |
|---|---|
| Modeling → RTP | `touchScenarioLinkedReportPackets()` updates `reports.updated_at`. No `rtp_basis_stale` column exists. (`src/lib/reports/scenario-writeback.ts:70-74`) |
| Grants → Project/RTP | No `rtp_posture` column on projects. "Awards recorded" is a textual comment only. (`src/lib/projects/funding.ts:193`) |
| Aerial → Project | Creating `aerial_evidence_packages` does not trigger `buildAerialProjectPosture()` rebuild. `verification_readiness` recomputes only at page render. |
| Modeling spine → anything | `scenario_assumption_sets` + `scenario_indicator_snapshots` triggers fire, but no consumer exists. (`src/lib/reports/evidence-packet.ts:384` returns null for `shared_spine`.) |
| Action → Audit | Client logs to localStorage. No server-side `assistant_action_executions` table. |

**Everything else — UX debt, Aerial skeleton, narrow runtime — compounds on top of this.** Fixing the write-back pattern is the most leveraged single investment the platform can make.

**The architectural commitment going forward:** no write to a primary record (scenario entry, model run, funding award, aerial mission/package) is complete until it has marked every downstream record that depends on it.

---

## Recalibrated scorecard (evidence-grounded)

| Lane | Prior memo | This doc | Shift reason |
|---|---:|---:|---|
| Shared platform core | 7/10 | **7/10** | Confirmed. 54 migrations through 2026-04-15, RLS consistent. |
| RTP OS | 8/10 | **7.5/10** | Registry / cycle-detail / report-detail read packet freshness via **three independent code paths**. Drift risk real, not hypothetical. |
| Grants OS | 5.5/10 | **5/10** | `src/components/grants/` **does not exist**. 2139 LOC single-file page with zero component extraction. Application phase + closeout missing. |
| Transportation Modeling OS | 6/10 | **5.5/10** | `scenario_shared_spine` migration is orphan (tables created, zero consumers). ActivitySim is "preflight-backed" messaging without demand-KPI bridge. Caveats are strings, not gates. |
| Aerial Operations OS | 2.5/10 | **3/10** | Schema + 3 API routes + 3 components + project-detail embed is more than 2.5 implies. But only **2 of 7 canonical objects** present. No geometry. No nav link. |
| Runtime / control room | 5/10 | **5/10** | 7 actions across 3 files with no canonical `ActionRecord` contract. Approval field decorative. Audit localStorage-only. |
| UX coherence | 6/10 | **5/10** | Component extraction wildly uneven — `rtp/`: 12, `engagement/`: 11, `grants/`: **0**, `dashboard` widgets: 0. Missing primitives: table, form, inspector, data-grid. |
| Cross-system write-back | 5.5/10 | **4/10** | Biggest downgrade. One-directional pattern is universal. **This is the real platform gap.** |

---

## Per-lane findings

Each lane block is structured: **what works · what's stubbed · specific risks · file:line references**.

### 1. RTP OS — 7.5/10

**What works end-to-end:**
- Cycle create → `POST /api/rtp-cycles`, project linkage, chapters, exports.
- Packet create → `POST /api/reports` accepts `rtpCycleId + reportType='board_packet'`.
- Packet generate → `POST /api/reports/[reportId]/generate` persists artifact + metadata.
- Client abstraction `src/lib/reports/client.ts:39-81` wraps create+generate with `generateAfterCreate` flag.
- Registry/cycle-detail/report-detail surfaces all render packet posture.

**Stubbed / bounded:**
- Public-review comment-response workspace (schema + read-only UI exist; no authoring/moderation).
- Scenario/model propagation to packet basis is **read-only snapshot** — no live-link invalidation.
- No "response memo" / adoption packet authoring flow.
- Linked runs explicitly rejected for RTP cycle packet records (`src/app/api/reports/route.ts:58-66`).

**Specific drift risks with file evidence:**

1. **Packet-freshness labels live in three places.** `src/lib/reports/catalog.ts:91-120` defines canonical enums. `src/lib/rtp/catalog.ts:5-11` resolves work-posture labels. `src/app/(app)/rtp/page.tsx:789-810` constructs custom display strings ("No packet record"). Any update to one layer that misses the others produces visible drift.

2. **Cycle detail recomputes public-review counts fresh** instead of reading the packet-generation snapshot (`src/app/(app)/rtp/[rtpCycleId]/page.tsx:~667`). Cycle detail and packet detail therefore answer the same question differently.

3. **Generation metadata has no version marker.** `src/app/api/reports/[reportId]/generate/route.ts:867-950` builds `sourceContext` inline. Future structural changes will silently fail to parse old packets.

4. **Scenario spine schema-pending errors are swallowed silently.** `src/lib/reports/scenario-provenance.ts:30-50` catches errors, returns empty arrays, logs nothing. Spine rollbacks lose packet context invisibly.

5. **No server-side workspace check on RTP cycle PATCH** — RLS-only, opaque failure surface.

**Test coverage gaps:**
- No full integration test covering create → generate → re-ground chain.
- No test for "Public review active" → "Review loop still open" transition with pending comments during generation.

**Top 5 RTP tickets:**
1. **T1. Close RTP first-packet create → generate → re-ground path end-to-end** so a planner moves no-packet → generated → review posture without a manual refresh.
2. **T2. Unify packet freshness labels into one module; delete local label construction.** Create `src/lib/reports/packet-labels.ts` as sole source; refactor all three consumers.
3. **Align cycle-detail public-review counts to the packet-generation snapshot** so drift between cycle and packet surfaces is impossible.
4. **Add metadata schema version marker** (`metadata_schema_version: "2026-04"`) on every generated packet; emit warning log from the schema-pending catch.
5. **Add server-side workspace check on RTP cycle PATCH** (belt-and-braces over RLS).

---

### 2. Grants OS — 5/10

**Loop completeness matrix:**

| Stage | Status | Evidence |
|---|---|---|
| Opportunity catalog | ✓ real | `funding_opportunities` + routes |
| Decision (pursue/monitor/skip) | ✓ real | `decision_state`, `FundingOpportunityDecisionControls` |
| Application tracking | ⚠ stubbed | Status jumps pursue→award, no "applied/under_review/denied" states |
| Award | ✓ real | `funding_awards` + `ProjectFundingAwardCreator` |
| Reimbursement | ✓ real | `billing_invoice_records` + `buildProjectFundingStackSummary()` |
| Compliance milestones | ⚠ orphan | `project_submittals` + `project_milestones` tables exist but nothing writes/reads them |
| Closeout | ✗ missing | No reconciliation workflow, no sign-off |

**What does NOT write back:**
- No `rtp_posture` column on projects. Grants cannot change RTP constrained/unconstrained posture.
- No command-queue emission for compliance/closeout milestones.
- `isClosingSoon()` / `isDecisionSoon()` computed at render, never persisted as project urgency signals.
- LAPM/invoicing `lane_c` migration's tables are orphans — `caltrans_posture` enum never set.

**Architectural smell:**
- **`src/components/grants/` does not exist.** All grants UI lives in one 2139 LOC page:
  - Lines 215–507: 23 utility helpers (formatters, filters, priority logic) — should extract to `src/lib/grants/page-helpers.ts`.
  - Lines 620–698: seven Supabase queries in one `Promise.all`, no pagination, no lazy boundary.
  - Lines 700–1113: 400 LOC of derived state (modeling evidence, queues, filter counts).
  - Lines 1115–1720: left column with three sub-sections (funding need, opportunity creator, reimbursement triage).
  - Lines 1720–2139: right column opportunity board with filters, modeling callouts, decision controls.

**Test coverage:** strong for existing features (~3875 LOC across grants-related tests), but zero tests for RTP write-back, compliance milestone emission, or closeout — because those features do not exist yet.

**Top 5 Grants tickets:**
1. **T10. Decompose `grants/page.tsx` into `components/grants/*`.** Extract helpers to `lib/grants/page-helpers.ts`; create `funding-need-editor.tsx`, `opportunity-creator.tsx`, `reimbursement-triage.tsx`, `opportunity-decision-board.tsx`, `opportunity-calendar.tsx`. Target: `grants/page.tsx` ≤ 700 LOC.
2. **T11. Add `rtp_posture` column to `projects`; wire grants → RTP write-back.** New migration + update `src/lib/projects/funding.ts` + `src/app/api/funding-awards/route.ts`. When `committed_funding >= funding_need`, set `rtp_posture='funded'`.
3. **T12. Emit `project_milestones` on award creation** — activates the `lane_c` orphan tables. `milestone_type='obligation'`, `phase_code='programming'`, `target_date=obligation_due_at`.
4. **T13. Closeout reconciliation route `/api/funding-awards/[awardId]/closeout`.** Validates 100% invoice coverage; sets `spending_status='fully_spent'`; emits compliance sign-off.
5. **Add application-status states** to `funding_opportunities` (`applied / under_review / denied`) so the pursue→award jump is no longer silent.

---

### 3. Transportation Modeling OS — 5.5/10

**Engine integration state:**

- **AequilibraE (~40% wired):** worker exists + deploys; `model_run_stages` + `model_run_artifacts` + `model_run_kpis` schema present; evidence packet extraction works. But **nothing consumes KPIs downstream** — not prioritization, not RTP basis, not grant readiness.
- **ActivitySim (~15% wired):** `county_onramp_worker` + preflight real; `run-modes.ts:48-61` honestly labels "prototype/preflight-backed". **No demand-KPI bridge into OpenPlan.** County onramp touches Supabase but does not register trips/mode-share/accessibility deltas into `model_run_kpis`.
- **MATSim (absent):** no worker, no schema. Correctly deferred per ADR-002.

**Write-back propagation map (the one real write-back path):**

```
model_run success (POST /api/models/[modelId]/runs)
  ↓
touchScenarioLinkedReportPackets() [src/lib/reports/scenario-writeback.ts:31-81]
  ↓
scenario_entries.attached_run_id := model_run.id
  ↓
reports.updated_at := now()    ← THE ONLY WRITE-BACK
```

**What this does NOT do:**
- Does NOT mark RTP packet basis stale (no `rtp_basis_stale` column).
- Does NOT feed project prioritization (no link projects → model_runs → prioritization).
- Does NOT invalidate grant readiness (`src/lib/grants/modeling-evidence.ts` reads reports but never marks anything stale on scenario change).
- Does NOT reuse comparison snapshots across surfaces (single-use per report + scenario pair).

**Orphan infrastructure found:**
- `scenario_shared_spine` migration (`20260410000045`): `scenario_assumption_sets`, `scenario_data_packages`, `scenario_indicator_snapshots` tables + triggers + RLS exist. **Zero consumers in `src/lib`.** `evidence-packet.ts:384` returns null for `shared_spine` unconditionally.
- `idx_scenario_comparison_snapshots_candidate` index created for cross-report reuse. Feature does not exist.
- Triggers fire on `scenario_assumption_sets` but nothing cascades staleness to linked reports.

**Caveats exist as strings, not gates:**
- `GRANT_MODELING_PLANNING_CAVEAT` defined (`src/lib/grants/modeling-evidence.ts:57-58`), shown in UI.
- No query-time gate prevents using screening-grade county-onramp runs in RTP / prioritization / grant readiness.
- `resolveProjectGrantModelingQueuePosture()` (modeling-evidence.ts:120-138) does not check caveat eligibility.

**Top 5 Modeling tickets:**
1. **T3. Add `rtp_basis_stale` column + stale-marking on model_run completion.** New migration; update `scenario-writeback.ts`. When a linked `model_run.status` transitions to `succeeded`, all linked reports get `rtp_basis_stale = true` + reason.
2. **T14. Wire county_onramp + ActivitySim outputs into `model_run_kpis`** with `kpi_category='behavioral_onramp'` so grants and RTP can read them through a shared helper.
3. **T15. `scenario_comparison_summary` view for cross-surface reuse** (`scenario_set_id, indicator_key, latest_delta_json, ready_snapshot_count`). Grants and RTP read from it.
4. **T16. Caveat gate (not just text).** Refuse to consume screening-grade runs in RTP / prioritization / grant-readiness unless caller explicitly passes `{acceptScreeningGrade: true}`. Fail closed.
5. **Hydrate `assumption_sets + indicator_snapshots` on comparison snapshot POST** so the shared-spine migration stops being orphan.

---

### 4. Aerial Operations OS — 3/10

**Schema contract coverage: 2 of 7 canonical objects.**

| Canonical object | Present? |
|---|---|
| mission | ✓ `aerial_missions` |
| AOI (geometry) | ✗ no table, no geometry columns anywhere |
| ingest job | ✗ |
| processing job | ✗ |
| QA bundle (distinct) | ~ collapsed into `package_type` enum |
| measurable output | ✓ `aerial_evidence_packages` |
| share package (distinct) | ~ collapsed into `package_type` enum |

**API routes (real, not stubs):**
- `POST /api/aerial/missions` — validates project access via `loadProjectAccess()` (programs.write scope), inserts mission.
- `PATCH /api/aerial/missions/[missionId]` — verifies workspace membership, updates.
- `POST /api/aerial/evidence-packages` — resolves mission → workspace/project, inserts package.
- **Missing:** GET single mission, delete/soft-delete, package detail.

**Cross-module touch points:**
- `src/app/(app)/projects/[projectId]/page.tsx:2726-2815` loads missions + packages for the project, renders "Aerial evidence" section, mounts three aerial creators (`AerialMissionCreator`, `AerialMissionStatusEditor`, `AerialEvidencePackageCreator`).
- `src/lib/operations/workspace-summary.ts:733+` exposes `buildAerialProjectPosture()` but **not surfaced in the command board**.
- **No `/aerial` route, no nav link, no report binding, no stage-gate evidence integration.**

**Write-back missing:** creating an evidence package does not trigger posture rebuild. `verification_readiness` recomputes only at render — caches go stale invisibly.

**Top 5 Aerial tickets:**
1. **T8a. Create `/aerial` route** — `src/app/(app)/aerial/page.tsx` (worksurface mission list) + `src/app/(app)/aerial/missions/[missionId]/page.tsx` (detail + package log). Respect design constitution: table + inspector, not card grid.
2. **T8b. Add Aerial nav link** in `src/components/app-shell.tsx:14-44` (icon: Radar) under a "Field" group or existing Operate group.
3. **T9. Wire evidence-package creation → `buildAerialProjectPosture()` rebuild** in `src/app/api/aerial/evidence-packages/route.ts`. Verification readiness updates immediately.
4. **Add GET endpoint** `GET /api/aerial/missions/[missionId]` for single mission + cascaded packages (needed for detail page).
5. **Add geometry columns** (or `aerial_aoi` table) before first real ingest. Without geometry, aerial cannot answer "which missions cover this corridor?" — which is the whole point of field evidence.

---

### 5. Runtime / Control Room — 5/10

**Current surface:**
- **Workspace Command Board** (`src/components/operations/workspace-command-board.tsx`): two-column grid showing packet work / plan setup / funding pressure. Data from `loadWorkspaceOperationsSummaryForWorkspace()`.
- **Workspace Runtime Cue** (`src/components/operations/workspace-runtime-cue.tsx`): single-message callout driven by `operationsSummary.nextCommand`.
- **App Copilot** (`src/components/assistant/app-copilot.tsx`): client-side stateful operation executor, 7 action kinds, tracks linkId/label/workflow/audit/status/timing in localStorage.
- **Assistant context** (`src/app/api/assistant/context/route.ts`): per-page linked-record assembly, returns `operationsSummary` + page-specific slices.

**Seven action kinds, no canonical contract:**
- `generate_report_artifact`
- `create_rtp_packet_record`
- `create_funding_opportunity`
- `create_project_funding_profile`
- `update_funding_opportunity_decision`
- `create_project_record`
- `link_billing_invoice_funding_award`

These live across `src/lib/assistant/catalog.ts:23-115`, `src/lib/assistant/operations.ts:1-100`, and the dispatch in `app-copilot.tsx:380-600`. There is **no `ActionRecord<Kind, Preconditions, Effects, Approval, Regrounding, Audit>` type** anyone can import.

**Approval field is decorative:** `approval: "approval_required"` metadata exists on `AssistantQuickLink` but is not enforced client or server side. LocalStorage can be edited to remove it.

**Audit is localStorage-only.** No `assistant_action_executions` table. Cannot prove "who approved what, when" after the session ends.

**Command board coverage:**
- Included: RTP packet work, plan setup, funding pressure (opportunities / awards / invoices).
- **Missing:** modeling run readiness, scenario comparison board state, engagement campaigns, aerial mission/package posture. **Four of seven lanes invisible in the runtime queue.**

**No regrounding-depth guard.** `postActionPrompt` + `postActionWorkflowId` can chain indefinitely — risk of self-perpetuating action loops.

**Proposed canonical `ActionRecord` type** (for reference when building `src/lib/runtime/action-registry.ts`):

```ts
export type ActionKind =
  | "generate_report_artifact"
  | "create_rtp_packet_record"
  | "create_funding_opportunity"
  | "create_project_funding_profile"
  | "update_funding_opportunity_decision"
  | "create_project_record"
  | "link_billing_invoice_funding_award";

export type ActionApprovalModel = "safe" | "review" | "approval_required";

export type ActionEffect = {
  mutatesTable: string;
  createsRecord?: boolean;
  triggersSideEffect?: string;
};

export type ActionRegrounding = {
  postActionWorkflowId?: string;
  postActionPrompt?: string;
  postActionPromptLabel?: string;
  refreshContextKind: "full" | "partial" | "none";
};

export type AuditShape = {
  eventName: string;
  auditNote?: string;
  captureInputs?: string[];
  captureResult?: boolean;
};

export type ActionRecord<Kind extends ActionKind = ActionKind> = {
  id: string;
  kind: Kind;
  label: string;
  description: string;
  inputs: Record<string, unknown>;
  preconditions: {
    resourceMissing?: (ctx: unknown) => boolean;
    alreadyExists?: (ctx: unknown) => boolean;
    dependencyUnmet?: (ctx: unknown) => boolean;
  };
  approval: ActionApprovalModel;
  effects: ActionEffect[];
  regrounding: ActionRegrounding;
  audit: AuditShape;
};
```

**Top 5 Runtime tickets:**
1. **T5. Create `src/lib/runtime/action-registry.ts` with canonical `ActionRecord<Kind>` + migrate existing 7 actions.** `app-copilot.tsx` dispatches exclusively through a new `executeAction<K>()` wrapper.
2. **T6. `assistant_action_executions` audit table + server-side logger** (new migration + `src/lib/observability/action-audit.ts`). Every action execution produces a row (kind, workflow_id, inputs_snapshot, result_snapshot, status, user_id, timing).
3. **Enforce the `approval` field.** `approval: "approval_required"` actions prompt user confirmation before dispatch; `"safe"` skips modal. Server-side validates approval before mutation.
4. **Expand command board to include modeling, scenarios, engagement, aerial.** Currently four of seven lanes are invisible.
5. **T17. Regrounding-depth guard** — cap auto-fired `postActionPrompt` chains at 2. Prevents self-perpetuating action loops.

---

### 6. UX Coherence — 5/10

**App shell is correct** (`src/components/app-shell.tsx:14-44`): three nav groups (Operate, Analyze, Govern), left rail, secondary nav, context-aware footer. Follows the design constitution.

**UI primitives are solid but incomplete** (13 primitives in `src/components/ui/`):
- Present: badge, button, card, chip-multi-select, input, meta-item, scroll-area, separator, sonner, state-block, status-badge, tabs, textarea.
- **Missing: table, form, inspector/drawer, data-grid.** These are the four primitives that worksurface-style pages need most.

**Component extraction is inversely correlated with page size — the biggest pages have the fewest extracted components:**

| Page | LOC | Domain components |
|---|---:|---:|
| `projects/[projectId]/page.tsx` | 2862 | 5 |
| `rtp/page.tsx` | 2408 | 12 (best ratio) |
| `grants/page.tsx` | 2139 | **0** |
| `rtp/[rtpCycleId]/page.tsx` | 914 | (via rtp dir) |
| `dashboard/page.tsx` | 346 | 0 widgets |

Full component inventory by domain:
- `ui`: 13 primitives
- `rtp`: 12 · `engagement`: 11
- `reports`: 5 · `projects`: 5 · `models`: 5 · `billing`: 5
- `scenarios`: 4 · `programs`: 4
- `nav`: 3 · `aerial`: 3
- `plans`: 2 · `operations`: 2 · `county-runs`: 2
- `workspaces`: 1 · `runs`: 1 · `data-hub`: 1 · `corridor`: 1 · `assistant`: 1
- **`grants`: 0** · **`dashboard` widgets: 0**

**Status-label drift is UX drift.** Every surface that re-derives a label ("No packet record" vs "No packet") breaks the calm-workbench feel.

**Design constitution location:** `/home/narford/.openclaw/workspace/openplan/docs/ops/2026-04-08-openplan-frontend-design-constitution.md` (outer repo, not inner Next.js app).

**Top 5 UX tickets:**
1. **T7. Extract `worksurface + rail + inspector` primitive** — `src/components/ui/worksurface.tsx`, `inspector.tsx`, `data-table.tsx`. Pilot on the next page to be edited anyway (`grants/page.tsx` — T10).
2. **T18. Dashboard decomposition.** Extract 4-6 widget components (packet posture, funding pressure, scenario freshness, aerial verification, next action).
3. **Harmonize status badge language** across all surfaces — enforce via `packet-labels.ts` (T2) and similar shared label modules.
4. **Add table + form + inspector UI primitives** to `src/components/ui/` so mega-pages have a decomposition target that respects the design constitution.
5. **Cap single-page LOC in `src/app/(app)/`** at 1200 via ESLint `max-lines` rule post-T10 and T18.

---

## The unified 4-week execution program (18 tickets)

All tickets ordered by dependency. Do not start N+1 until N is merged.

### Week 1 — RTP closure + propagation backbone

**T1. Close RTP first-packet create → generate → re-ground path end-to-end.**
- Files: `src/app/api/reports/route.ts:25-85`, `src/app/api/reports/[reportId]/generate/route.ts:432-465`.
- Accept: planner moves no-packet → generated → review posture without manual refresh; integration test covers full chain in `rtp-cycles-route.test.ts`.

**T2. Unify packet freshness labels into one module.**
- Files: create `src/lib/reports/packet-labels.ts`; refactor `rtp/page.tsx:789-810`, `rtp/catalog.ts:5-11`, `reports/catalog.ts:91-120` to import it.
- Accept: a single grep for status strings returns one file's worth of constants.

**T3. Add `rtp_basis_stale` column + stale-marking on model_run completion.**
- Files: new migration `2026041700xxxx_reports_rtp_basis_staleness.sql`; update `src/lib/reports/scenario-writeback.ts:31-81`.
- Accept: linked `model_run.status → succeeded` marks all linked reports `rtp_basis_stale = true` with reason; packet detail shows "basis stale since {run}" banner.

**T4. Metadata version marker + schema-pending warning.**
- Files: `src/app/api/reports/[reportId]/generate/route.ts:867-950`; `src/lib/reports/scenario-provenance.ts:30-50`.
- Accept: every generated packet has `metadata_schema_version: "2026-04"`; schema-pending catches emit audit-log warnings.

### Week 2 — Runtime contract + UX primitive + Aerial seam

**T5. `src/lib/runtime/action-registry.ts` canonical `ActionRecord<Kind>` + migrate existing 7 actions.**
- Accept: one source of truth for inputs / preconditions / approval / effects / regrounding / audit; `app-copilot.tsx` dispatches exclusively through a new `executeAction<K>()` wrapper.

**T6. `assistant_action_executions` audit table + server-side logger.**
- Files: new migration + `src/lib/observability/action-audit.ts`; hook into `/api/reports` POST + generate POST.
- Accept: every action execution produces a row; test verifies two executions create two audit records.

**T7. Extract `worksurface + rail + inspector` primitive.**
- Files: `src/components/ui/worksurface.tsx`, `inspector.tsx`, `data-table.tsx`. Pilot on `grants/page.tsx` (since T10 edits it next anyway).
- Accept: primitive has `{ leftRail, worksurface, inspector }` API + variants; story/test harness passes.

**T8. Stub `/aerial` route + add nav link.**
- Files: `src/app/(app)/aerial/page.tsx` (missions worksurface list), `src/app/(app)/aerial/missions/[missionId]/page.tsx` (detail), update `src/components/app-shell.tsx:14-44`.
- Accept: aerial one click from overview; mission detail shows packages with evidence-chain card.

**T9. Wire aerial evidence-package write → `buildAerialProjectPosture()` rebuild.**
- Files: `src/app/api/aerial/evidence-packages/route.ts:~115`.
- Accept: creating a package updates linked project's aerial posture immediately; test covers it.

### Week 3 — Grants decomposition + write-back

**T10. Decompose `grants/page.tsx` into `components/grants/*`.**
- Extract to: `lib/grants/page-helpers.ts` (helpers 215-507); `components/grants/funding-need-editor.tsx`, `opportunity-creator.tsx`, `reimbursement-triage.tsx`, `opportunity-decision-board.tsx`, `opportunity-calendar.tsx`.
- Accept: `grants/page.tsx` ≤ 700 LOC, composed on the T7 worksurface primitive.

**T11. Add `rtp_posture` column to `projects`; grants → RTP write-back.**
- Files: new migration; update `src/lib/projects/funding.ts`, `src/app/api/funding-awards/route.ts`.
- Accept: when `committed_funding >= funding_need`, `projects.rtp_posture = 'funded'`; RTP constrained-portfolio surface reads this.

**T12. Emit `project_milestones` on award creation.**
- Files: `src/app/api/funding-awards/route.ts`.
- Accept: award creation produces `project_milestones` row with `milestone_type='obligation'`, `phase_code='programming'`, `target_date=obligation_due_at`, visible in project detail.

**T13. Closeout reconciliation route `/api/funding-awards/[awardId]/closeout`.**
- Accept: validates 100% invoice coverage; sets `spending_status='fully_spent'`; emits compliance sign-off row.

### Week 4 — Modeling propagation + caveat gating + remaining UX

**T14. Wire county_onramp + ActivitySim outputs into `model_run_kpis`.**
- Accept: run success populates KPI rows with `kpi_category='behavioral_onramp'`; grants + RTP read them through a shared helper.

**T15. `scenario_comparison_summary` view for cross-surface reuse.**
- Migration adds view `(scenario_set_id, indicator_key, latest_delta_json, ready_snapshot_count)`.
- Accept: grants + RTP read from it instead of re-aggregating; comparison snapshots reused across surfaces.

**T16. Caveat gate (not just text).**
- Refuse to consume screening-grade runs in RTP / prioritization / grant-readiness unless caller explicitly passes `{acceptScreeningGrade: true}`. Fail closed.

**T17. Regrounding-depth guard** in `executeAction` wrapper — cap auto-fired `postActionPrompt` chains at 2.

**T18. Dashboard decomposition.**
- Extract 4-6 widget components: packet posture, funding pressure, scenario freshness, aerial verification, next action.
- Accept: `dashboard/page.tsx` uses widgets; each widget tests independently.

---

## Cross-cutting acceptance rules

These apply to every ticket above and every PR touching the relevant surface.

1. **No new action without a registry entry.** After T5, PRs adding an action must also register it; reviewers block on missing entry.
2. **No new status label outside `packet-labels.ts` (or its peers).** After T2, grep CI rule fails PRs that hardcode status strings.
3. **No new write without a corresponding stale-mark.** After T3, any write to a primary record (scenario, run, award, mission) must call the matching stale-marker helper.
4. **No monolithic page > 1200 LOC in `src/app/(app)/`.** After T10, enforce via ESLint `max-lines` rule on that directory.
5. **Known issues register** — `docs/ops/KNOWN_ISSUES.md`, opened in week 1 and kept current. Ship-quality gate = zero open blockers in flagship flows + current proof.

---

## Out of scope this chapter

Explicitly defer these unless they directly unblock active tickets:

- **MATSim integration** — no worker, no schema. Revisit only after ActivitySim is genuinely write-back-useful.
- **Multi-viewport visual regression sweep** — out of scope until T10 + T18 land; re-polish once decomposition is in.
- **Enterprise auth (WorkOS)** — blocked on customer trigger.
- **Public self-serve launch / marketing rollout** — product must close flagship loops first.
- **Broad LAPM/legal-grade compliance automation claims** — lane_c tables become productive via T12; broader claims deferred.
- **Decorative AI assistant expansion** detached from real actions — every runtime expansion must register an action and produce an audit row (T5 + T6).
- **Broad aerial UI before contract is complete** — T8 + T9 lock the seam; AOI/ingest/processing tables come after.
- **Speculative LUTI / land-use breadth** before shared scenario spine is consumed (T14 + T15).
- **Cosmetic redesign** that does not improve operator clarity or integration truth.

---

## How to use this document

### If you are a new agent picking up work

1. Read the TL;DR + "single pattern" + scorecard (top ~100 lines).
2. Open the lane most relevant to the user's ask and read that block.
3. Pick the next unclaimed ticket from the 4-week program.
4. Before writing code, verify: (a) the migration you'd add is not already present; (b) the helper you'd create does not exist under a different name; (c) the ticket's dependencies are merged.
5. Apply the five cross-cutting acceptance rules on every PR.

### If you are the product owner / strategic reviewer

- Track completion against the 18 tickets.
- Use the scorecard as the health dashboard.
- When something feels "done," verify against the lane's acceptance criteria, not against the ticket title.

### If you are a code reviewer

- Enforce the cross-cutting acceptance rules ruthlessly. They compound.
- Block PRs that add new actions, status labels, primary-record writes, or page LOC without conforming to the corresponding rule.

---

## Bottom line

The 2026-04-16 integrated execution program was right about sequencing. What this review adds is the single architectural diagnosis: **write-back is one-directional everywhere, and that is the one pattern that explains every scorecard gap.**

Land T1–T13 in order and the scorecard moves from `{7, 7.5, 5, 5.5, 3, 5, 5, 4}` to roughly `{8, 8.5, 7, 7, 6, 6.5, 7, 7}` — two flagship loops closed (RTP + Grants), one real runtime contract, the Aerial spine anchored, the UX-debt compounding stopped at the source. Week 4 compounds write-back across modeling and finishes the UX pass.

That is the path to "amazing fully working solution, loaded with all the features, bug-free, and intuitive to use" — not by building more, but by forcing every module to write back into one shared truth.
