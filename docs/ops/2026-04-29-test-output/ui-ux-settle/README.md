# OpenPlan UI/UX Settle Proof Pack Prep

Date: 2026-04-29
Owner: Bartholomew Hale
Sponsor: Nathaniel Ford Redmond
Status: P0 preparation plus local-only capture evidence. The main read-only capture ledger now includes 38 populated screenshots plus 2 watch captures, including plans, programs, reports, project detail, county-run detail, RTP detail, `/explore`, and admin routes in the primary ledger. The capture harness classifier has been narrowed so ordinary `Required` copy no longer causes false authorization blocks. Scenario routes are now seed-backed and recapture-pending; grants is the only fixture-required operating surface remaining.

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
- `local-ui-ux-settle-capture-ledger.md` / `.json` - read-only authenticated local capture ledger with populated route evidence plus historical fixture-required rows from the pre-scenario-fixture run.
- `settle-gap-triage.md` - prioritized next-action checklist for the remaining proof gaps.
- `fixture-auth-continuation.md` - practical local-only runbook for closing the remaining scenario recapture, grants fixture, and blocked/detail/admin authorization-check gaps.
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
- Scenarios: seed-backed by `openplan/scripts/seed-nctc-demo.ts` as `d0000001-0000-4000-8000-000000000030`; desktop/mobile index and detail recapture pending.
- Grants: still fixture-required.

## Proof Pack Rule

Screenshots should show the actual usable worksurface in populated state. Do not accept captures that show only a loading shell, empty placeholder, marketing page, redirect screen, or cropped hero. Remaining unsettled rows are scenario recapture and the grants fixture-required operating surface.
