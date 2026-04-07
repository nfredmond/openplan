# 2026-04-06 — OpenPlan engagement handoff readiness slice

**Owner:** Revenue lane / engagement polish  
**Scope:** make engagement more legible in demos and sales conversations by turning moderation state into an explicit handoff decision surface.

## What shipped

### 1) Reusable handoff-readiness logic
Added `openplan/src/lib/engagement/readiness.ts` to convert current campaign state into a planner-facing readiness posture:
- `Ready for handoff`
- `Nearly ready`
- `Needs attention`

The helper evaluates five explicit checks:
1. linked project
2. categories defined
3. review queue resolved
4. approved categorized items present
5. campaign status supports handoff

This keeps the module honest: it does not imply a campaign is packet-ready just because items exist.

### 2) Campaign detail now shows a real handoff decision
The engagement campaign detail page now surfaces:
- top-level handoff readiness score (`x/5`)
- clear overall label (`Ready for handoff`, `Nearly ready`, `Needs attention`)
- a specific next-action sentence
- per-check pass/open cards for operator review

This is the missing transition between moderation stats and report creation. It makes the module easier to demo because the operator can answer, in one screen, whether the campaign is actually ready to move downstream.

### 3) Engagement catalog now signals handoff posture at a glance
The engagement list page now includes per-campaign readiness badges and readiness check counts.

That improves the sales/demo posture because a reviewer can see which campaigns are operationally mature without opening every record.

## Validation

### Targeted engagement tests
Passed:
- `src/test/engagement-readiness.test.ts`
- `src/test/engagement-campaign-detail-page.test.tsx`
- `src/test/public-engagement-portal.test.tsx`
- `src/test/public-engagement-page.test.tsx`

### Repo safety checks
Passed:
- `npm run lint`
- `npm run build`

### Full suite note
`npm run qa:gate` is not clean at repo level because unrelated preexisting tests outside this slice are currently failing (including evidence-packet and county-runs suite expectations). This engagement slice itself is green.

## Revenue/demo impact

This slice makes Engagement easier to sell as a planning operations workflow rather than just a comment bucket:
- clearer operator story
- clearer moderation closure story
- clearer handoff-to-report story
- better live-demo narrative for "what do I do next?"

## Remaining logical next step

If we continue in this lane, the next highest-value follow-on would be a compact public-portal/operator-state bridge (portal live state + published feedback posture + moderation queue posture in one place), but that is secondary to the handoff decision surface now shipped.
