# OpenPlan UI/UX Settle Proof Pack Prep

Date: 2026-04-29
Owner: Bartholomew Hale
Sponsor: Nathaniel Ford Redmond
Status: P0 local-only capture evidence complete. The main read-only capture ledger now includes 44 populated screenshots plus 2 watch captures, including plans, programs, reports, scenarios, grants, project detail, county-run detail, RTP detail, `/explore`, and admin routes in the primary ledger. The capture harness classifier has been narrowed so ordinary `Required` copy no longer causes false authorization blocks.

## Scope

This folder prepares the P0 UI proof pack requested by
`docs/ops/2026-04-29-openplan-ui-ux-settle-checkpoint.md`.

The work here is local proof-pack preparation:
- no app runtime behavior changes,
- no live data or external service mutation,
- no credentials, billing, email, auth-session, Supabase, or Vercel writes,
- no broad redesign or feature implementation.

## Files

- `capture-manifest.md` - route, viewport, state, and artifact manifest for the priority routes.
- `local-capture-prerequisites.md` - exact local prerequisites plus existing scripts and tests inspected for capture support.
- `local-ui-ux-settle-capture-ledger.md` / `.json` - read-only authenticated local capture ledger with populated route evidence for all priority operating surfaces.
- `../../2026-05-01-test-output/ui-ux-watch-recapture/` - supplemental local recapture that closes the original Data Hub and Pilot Readiness watch rows.
- `settle-gap-triage.md` - closure checklist for the proof gaps settled by the local-only capture pass.
- `fixture-auth-continuation.md` - practical local-only runbook retained as regression context now that scenario/grants recaptures and blocked/detail/admin authorization-check gaps are closed.
- `../ui-ux-settle-explore-check/` - supplemental read-only `/explore` Mapbox proof pack.
- `../ui-ux-settle-detail-admin-check/` - supplemental read-only project/county-run/RTP detail and `/admin` proof pack; confirms the earlier blocked rows were `required`-word classifier false positives rather than auth failures.
- `../../../../qa-harness/openplan-local-ui-ux-settle-capture.js` - local-only read-only Playwright capture harness for this manifest.

## Canonical Inputs

- `docs/ops/2026-04-29-openplan-ui-ux-settle-checkpoint.md`
- `docs/ops/2026-04-08-openplan-frontend-design-constitution.md`
- `docs/ops/2026-04-16-openplan-integrated-deep-dive-review.md`

## Fixture Status

- Plans: fixture supplied by `openplan/scripts/seed-nctc-demo.ts` as `d0000001-0000-4000-8000-000000000015`; desktop/mobile index and detail captures complete.
- Reports: fixture supplied by `openplan/scripts/seed-nctc-demo.ts` as `d0000001-0000-4000-8000-000000000019`; desktop/mobile index and detail captures complete.
- Scenarios: fixture supplied by `openplan/scripts/seed-nctc-demo.ts` as `d0000001-0000-4000-8000-000000000030`; desktop/mobile index and detail captures complete.
- Grants: fixture supplied by `openplan/scripts/seed-nctc-demo.ts` with opportunity `d0000001-0000-4000-8000-000000000018`, awarded opportunity `d0000001-0000-4000-8000-000000000041`, award `d0000001-0000-4000-8000-000000000042`, and invoice `d0000001-0000-4000-8000-000000000043`; desktop/mobile captures complete.
- Data Hub: fixture supplied by `openplan/scripts/seed-nctc-demo.ts` with connector `d0000001-0000-4000-8000-000000000050` and three datasets; desktop/mobile watch recapture complete in the 2026-05-01 supplemental pack.

## Proof Pack Rule

Screenshots should show the actual usable worksurface in populated state. Do not accept captures that show only a loading shell, empty placeholder, marketing page, redirect screen, or cropped hero. The priority desktop/mobile operating-surface rows are now settled in the local ledger.
