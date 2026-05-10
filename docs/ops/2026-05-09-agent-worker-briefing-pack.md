# OpenPlan Agent Worker Briefing Pack

**Date:** 2026-05-09
**Owner:** Bartholomew Hale
**Purpose:** Standard briefing for OpenPlan coding agents so each lane advances the saleable rural-county/RTPA planning OS without drifting into generic feature work.

## Product Truth

OpenPlan is an Apache-2.0 open-source planning operating system plus Nat Ford managed hosting, onboarding, implementation, support, and planning services.

Near-term release is a **supervised planning workbench**, not fully self-serve SaaS.

Do **not** claim or implement language implying:
- fully self-serve municipal SaaS,
- validated behavioral forecasting,
- legal-grade LAPM/compliance automation,
- autonomous AI planning,
- or a finished all-in-one planning suite.

## Roadmap Priority Order

Prioritize slices that move toward saleable rural county/RTPA v1:

1. **Shared planning spine** — projects reused across RTP, grants, engagement, analysis, reports, maps, and evidence.
2. **RTP/report packet loop** — cycle, board packet, chapters, stale-basis posture, artifact generation, adoption record.
3. **Grants/funding operations** — opportunities, awards, reimbursement posture, invoice/closeout proof, project funding profile.
4. **Engagement evidence** — public/share intake, moderation, categorization, comment matrix, report handoff, provenance.
5. **Analysis/modeling with caveats** — model runs, scenario comparison, evidence packets, explicit non-forecast caveats.
6. **Admin/support/hosting proof** — request access, reviewer triage, provisioning, invitations, pilot readiness, audit trails.
7. **Aerial/asset evidence** — mission packages, AOI, evidence chain, report/grant attachment readiness.
8. **Sales/proof packaging** — buyer-safe demo scripts, one-pagers, proof packets, caveat sheets, Vercel/Supabase QA evidence.

## Non-Negotiable Gates

- No production data writes.
- No billing/Stripe mutation.
- No outbound email, public posting, customer contact, or external outreach.
- No secret exposure.
- No broad dependency upgrades.
- No broad `SECURITY DEFINER` query pass-throughs.
- No new planning write without stale-marking/readiness recalculation where relevant.
- No AI output without citations/editable text/human-review posture if AI surfaces are touched.
- No modeling claim beyond current proof boundaries.
- No raw behavioral-onramp KPI reads outside the fixed SQL/RPC caveat gate.
- No generic SaaS card-grid UI drift; keep civic workbench posture.

## Known-Issue Constraints

Every worker must preserve these constraints:

- **Billing:** current posture is waiver/non-money-moving proof, not a fresh paid canary.
- **Onboarding:** supervised implementation step, not instant self-serve activation.
- **RPO/RTO:** per engagement in managed-hosting service schedule, not global promise.
- **Workspace isolation:** read-side smoke exists; do not weaken fixture/guard posture.
- **Modeling:** behavioral-onramp KPIs must stay behind `load_behavioral_onramp_kpis_for_workspace(...)` and consent logic.
- **UI:** avoid badge/card/pill clutter; prefer scanable workbench rows, callouts only when action-guiding.

## Standard Worker Contract

Each worker gets exactly one lane and must return:

- branch name,
- worktree path,
- commit hash,
- files changed,
- what changed,
- validation run,
- blockers or known unrelated failures,
- merge risk,
- next recommended slice.

Workers may commit locally but must **not push**.

## Validation Expectations

Minimum:

```bash
cd /home/narford/.openclaw/workspace/openplan/openplan
npm test -- <focused tests>
npm run lint
```

If a slice touches package/deploy/build-sensitive code, also run:

```bash
npm ci --ignore-scripts --dry-run
npm run build
```

If a slice touches QA harness:

```bash
cd /home/narford/.openclaw/workspace/openplan/qa-harness
npm run check:local-guards
npm run check:workspace-isolation-fixture
```

## Detailed Lane Prompt Template

Use this structure for future agents:

> You are working on OpenPlan, a supervised open-source planning OS for rural RTPAs/counties. First read:
> - `docs/ops/2026-05-01-openplan-full-os-roadmap.md`
> - `docs/ops/2026-05-01-openplan-release-to-sale-plan.md`
> - `docs/ops/2026-05-01-openplan-known-issues-register.md`
> - `docs/ops/2026-05-01-openplan-autonomous-build-protocol.md`
> - `docs/ops/2026-05-09-agent-worker-briefing-pack.md`
>
> Implement exactly one bounded vertical slice for `[LANE]`.
>
> Acceptance criteria:
> 1. Advances `[ROADMAP PHASE/GATE]`.
> 2. Adds real UI/API/helper/QA behavior, not docs-only filler unless the lane is explicitly proof packaging.
> 3. Preserves product truth: open-source core + managed services; supervised workbench, not self-serve SaaS.
> 4. Preserves known-issue constraints and stop conditions.
> 5. Includes focused tests or proof script where practical.
> 6. Runs focused validation and lint.
> 7. Commits locally only; does not push.
>
> Stop immediately if the work requires production data writes, secrets, billing/customer/email/public outreach, broad dependency upgrades, or unsupported modeling/legal/compliance claims.

## Higher-Complexity Lane Ideas

### Phase 1 — Shared Spine
- Add stale-evidence/readiness rollup that shows which project outputs need regeneration after related records change.
- Improve report/project/source-context trace from project detail into generated reports and evidence packets.
- Add command-center next-action grouping by workflow: RTP, grants, engagement, analysis/modeling, aerial, admin.

### Phase 2 — RTP + Grants
- RTP adoption record proof: adoption target, public review window, chapter readiness, board-packet artifact, responsible operator.
- Grants reimbursement proof: invoice status breakdown, paid/active/draft amounts, closeout blockers, RTP write-back posture.
- Project funding profile scanability: match, obligation, reimbursement, closeout, missing evidence.

### Phase 3 — Engagement/Data Hub
- Engagement handoff readiness: moderation, categorization, duplicate review, public/private posture, report appendix readiness.
- Data Hub lineage: source, license, vintage, geography, QA status, dependent maps/reports.
- Public portal proof: share token, public description, submission posture, moderation queue, report handoff.

### Phase 4 — Modeling/Scenarios
- Strengthen caveat labels and KPI display formatting without changing SQL/RLS boundaries.
- Add scenario comparison source-context summary: assumptions, baseline/alternative pairing, caveat posture, export readiness.
- Add tests that prevent direct behavioral-onramp KPI reader drift.

### Phase 5 — Aerial/Assets
- Mission package attachment readiness for report/grant evidence.
- AOI/evidence package scanability on mission detail.
- Aerial-to-project/report source-context helper and test.

### Phase 6 — Ops/Hosting
- Supabase local preflight and migration inventory proof, read-only.
- Vercel deployment status/prod health proof script, read-only.
- Admin pilot readiness export with proof filenames and follow-up action language.

## Integration Rule

Main integrator merges only clean commits, then runs focused tests, lint, build if relevant, pushes `main`, and verifies latest Vercel production deployment is Ready.
