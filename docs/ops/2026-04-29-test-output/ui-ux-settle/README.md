# OpenPlan UI/UX Settle Proof Pack Prep

Date: 2026-04-29
Owner: Bartholomew Hale
Sponsor: Nathaniel Ford Redmond
Status: P0 preparation plus local-only capture tooling. A read-only prerequisite report was generated; no screenshots were captured because no local authenticated Playwright storage state was supplied.

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
- `local-ui-ux-settle-capture-ledger.md` / `.json` - read-only prerequisite ledger from a desktop capture attempt against localhost; it records missing local auth storage state before browser launch and does not include screenshots.
- `settle-gap-triage.md` - prioritized next-action checklist for the remaining proof gaps.
- `../../../../qa-harness/openplan-local-ui-ux-settle-capture.js` - local-only read-only Playwright capture harness for this manifest.

## Canonical Inputs

- `docs/ops/2026-04-29-openplan-ui-ux-settle-checkpoint.md`
- `docs/ops/2026-04-08-openplan-frontend-design-constitution.md`
- `docs/ops/2026-04-16-openplan-integrated-deep-dive-review.md`

## Proof Pack Rule

Future screenshots should show the actual usable worksurface in populated state. Do not accept captures that show only a loading shell, empty placeholder, marketing page, redirect screen, or cropped hero.
