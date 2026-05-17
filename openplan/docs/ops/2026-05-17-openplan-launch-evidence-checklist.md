# OpenPlan launch evidence checklist — project report attention lane

**Date:** 2026-05-17  
**Prepared for:** Nathaniel Ford Redmond  
**Scope:** ASAP launch/evidence packet for the current OpenPlan urgent lane: project detail report-attention posture and packet deep-linking. This is a completion checklist, not a public marketing claim.

## Launch decision

**Decision:** **GO for internal/demo use after normal deploy**, with **buyer-facing caution**.  
The current slice is tested and coherent for the project detail workflow. It should not be represented as a fully fresh production-smoked buyer launch until a live Vercel smoke confirms the deployed URL and project packet links in the authenticated app.

## What changed in this lane

Recent shipped commits in `openplan` show the urgent lane is tightening project-level governance/report evidence:

- `1a0aec0` — prioritizes governance-only report holds in the project posture header.
- `d802dd9` — treats report governance holds as project attention items.
- `7e9d940` — avoids duplicate report attention counts.
- `07444c1` — deep-links project report cards to packet work.

Primary touched surfaces:

- `openplan/src/app/(app)/projects/[projectId]/page.tsx`
- `openplan/src/app/(app)/projects/[projectId]/_components/project-posture-header.tsx`
- `openplan/src/lib/projects/controls.ts`
- `openplan/src/test/project-detail-page.test.tsx`
- `openplan/src/test/project-controls-summary.test.ts`

## Acceptance criteria

- [x] Project-level report/governance holds are counted as attention-worthy project issues.
- [x] Governance-only report holds appear in the project posture priority ordering instead of being buried.
- [x] Duplicate report attention counts are suppressed so the project posture does not exaggerate risk.
- [x] Report cards link users into the relevant packet work instead of leaving the next action ambiguous.
- [x] Unit/component coverage exists for the changed posture/count/link behavior.
- [x] Live shallow production deployment smoke has been captured for the exact deployed commit.
- [x] Authenticated user walkthrough confirms the deep-link target resolves correctly in production data, not just test fixtures.

## Validation proof captured in this pass

Command run from `openplan/openplan`:

```bash
npm test -- --run src/test/project-detail-page.test.tsx src/test/project-controls-summary.test.ts
```

Result:

- Test files: **2 passed**
- Tests: **12 passed**
- Relevant suites:
  - `src/test/project-controls-summary.test.ts` — 6 tests passed
  - `src/test/project-detail-page.test.tsx` — 6 tests passed
- Duration: 3.52s

Additional validation captured by the ASAP strike-team pass:

```bash
npm run lint
npm test
npm run build
npm run ops:check-migration-inventory
curl https://openplan-natford.vercel.app/api/health
npm test -- --run src/test/access-request-query.test.ts src/test/pilot-preflight-script.test.ts
npm run ops:check-pilot-preflight
```

Results:

- Full OpenPlan lint: **passed**
- Full OpenPlan test suite: **310 files passed, 1555 tests passed, 4 skipped**
- OpenPlan production build: **passed**
- Migration inventory guard: **passed**
- Production health endpoint: **HTTP 200 / app ok**
- Focused CTA + pilot preflight tests: **2 files passed, 9 tests passed**
- Pilot preflight bundle: **OK** after correcting the read-only Vercel inspect scope to `natford`

Production-readiness snapshot captured before commit/push on 2026-05-17:

- Production alias: `https://openplan-natford.vercel.app`
- Latest inspected deployment: `https://openplan-idn37usze-natford.vercel.app`
- Deployment state: **READY**
- Health URL: `https://openplan-natford.vercel.app/api/health`
- Current deployed health commit before the next local commit: `07444c17fead`

Post-commit deployment proof captured 2026-05-17:

- Commit: `23a832638db3` (`chore: capture OpenPlan launch evidence`)
- Production deployment: `https://openplan-d04936lgu-natford.vercel.app`
- Canonical alias: `https://openplan-natford.vercel.app`
- Vercel inspect state: **READY**
- Deployment health: `https://openplan-d04936lgu-natford.vercel.app/api/health` returned `status: ok`, `app: ok`, commit `23a832638db3`
- Alias health: `https://openplan-natford.vercel.app/api/health` returned `status: ok`, `app: ok`, commit `23a832638db3`

Latest docs/evidence deployment proof captured 2026-05-17:

- Commit: `44457d6a5e91` (`test: clean OpenPlan TypeScript baseline`)
- Production deployment: `https://openplan-5itde6l26-natford.vercel.app`
- Canonical alias: `https://openplan-natford.vercel.app`
- Vercel inspect state: **Ready**
- Alias health: `https://openplan-natford.vercel.app/api/health` returned `status: ok`, `app: ok`, commit `44457d6a5e91`
- Generated shallow production-health evidence artifact: `docs/ops/2026-05-17-test-output/prod-health-evidence/20260517T220335Z-prod-health-evidence.md` with **Gate decision: PASS**

Authenticated production deep-link proof captured 2026-05-17:

- Proof artifact: `docs/ops/2026-05-17-openplan-production-project-report-deeplink-smoke.md`
- QA user/workspace/project/report were created in production for an isolated bounded smoke.
- Verified href: `/reports/a90d42df-d7c4-4093-bb83-44d3d18be84c#drift-since-generation`
- Result: PASS — clicking the project report card landed on the supported report detail packet-work anchor.

Latest code-quality baseline through 2026-05-17:

- Commit: `44457d6` (`test: clean OpenPlan TypeScript baseline`)
- Scope: test fixture/baseline cleanup only; useful QA evidence and now shallow production-health checked, but not a separate buyer functionality/workflow smoke.
- Validation rerun during buyer-packet consolidation: `npm run test:sales-proof-claim-boundaries` passed; `npx tsc --noEmit` passed.

Related safe fixes included in/after this launch slice:

- Public OpenPlan `Request access` CTAs now preserve the `open-source-services-review` intent note without incorrectly preselecting the legacy implementation/onboarding defaults.
- The pilot preflight script now runs Vercel inspect under the `natford` scope by default, matching the active production team.
- Project control attention lanes now carry row-level anchors for the first blocked/overdue milestone, submittal, or invoice instead of stopping at the lane section; proof: `2026-05-17-openplan-project-control-row-deeplink-proof.md`.
- Command Center report-governance attention now includes open RTP release-review loops so current packets with unresolved release-review posture are still counted as operator work.

## Remaining evidence caveats before stronger launch language

1. **Workflow currency after test-only commits:** commit `44457d6` is shallow production-health checked, but it is TypeScript/test-baseline cleanup and should not be described as new buyer functionality or as replacing workflow-specific smoke evidence.
2. **Shallow health boundary:** `/api/health` intentionally does not check database or billing dependencies.
3. **Buyer caveats:** billing, modeling, recovery, and legal/compliance boundaries remain governed by `docs/ops/KNOWN_ISSUES.md` and the buyer caveat sheet.

## Operator note

This lane improves trustworthiness of the internal project workspace: it points attention to report governance holds and gives the operator a more direct path to packet remediation. The safe launch language is: **“Project report attention routing is tested locally, deployed, shallow production-health checked, and authenticated deep-link smoked for supervised internal/demo use; latest test-baseline cleanup is shallow health checked but does not expand buyer functionality claims.”**
