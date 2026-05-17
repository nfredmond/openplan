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
- [ ] Authenticated user walkthrough confirms the deep-link target resolves correctly in production data, not just test fixtures.

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

- Commit: `92b2a832804f` (`chore: reduce migration inventory false positives`)
- Production deployment: `https://openplan-f0h4g47cc-natford.vercel.app`
- Canonical alias: `https://openplan-natford.vercel.app`
- Vercel inspect state: **Ready**
- Deployment health: `https://openplan-f0h4g47cc-natford.vercel.app/api/health` returned `status: ok`, `app: ok`, commit `92b2a832804f`
- Alias health: `https://openplan-natford.vercel.app/api/health` returned `status: ok`, `app: ok`, commit `92b2a832804f`
- Generated shallow production-health evidence artifact: `docs/ops/2026-05-17-test-output/prod-health-evidence/20260517T201518Z-prod-health-evidence.md` with **Gate decision: PASS**

Related safe fix included in this launch slice:

- Public OpenPlan `Request access` CTAs now preserve the `open-source-services-review` intent note without incorrectly preselecting the legacy implementation/onboarding defaults.
- The pilot preflight script now runs Vercel inspect under the `natford` scope by default, matching the active production team.

## Missing evidence before calling it fully launched

1. **Authenticated workflow proof:** use a real or seeded workspace/project to click from project report card → packet work and record the outcome.
2. **Screenshot or trace artifact:** optional but recommended: one screenshot of the project detail posture area and one of the linked packet destination.

## Operator note

This lane improves trustworthiness of the internal project workspace: it points attention to report governance holds and gives the operator a more direct path to packet remediation. The safe launch language is: **“Project report attention routing is tested locally, deployed, and shallow production-health checked for internal/demo use; authenticated production deep-link proof is still pending.”**
