# OpenPlan UI/UX Settle Gap Triage

Date: 2026-04-29
Owner: Bartholomew Hale
Sponsor: Nathaniel Ford Redmond
Source: `local-ui-ux-settle-capture-ledger.md` generated 2026-04-30T03:22:39.962Z.
Scope: docs-only next-action checklist for the local proof pack. No app/runtime, data, auth, billing, email, credential, or external-service mutation is authorized here.

## Priority Checklist

### P0 - Fixture-Required Operating Surfaces

Routes: `/programs`, `/programs/<local-program-id>`, `/reports`, `/reports/<local-report-id>`, `/scenarios`, `/scenarios/<local-scenario-set-id>`, `/grants` across desktop and mobile.

Plans update:
- `/plans` and `/plans/d0000001-0000-4000-8000-000000000015` now have a deterministic NCTC local seed fixture and harness target.
- They still need a local recapture after the updated `pnpm seed:nctc` has run against local Supabase; do not treat the historical `fixture_required` ledger rows as proof.

Safe prerequisites:
- Use only a local authenticated Playwright storage state for a non-production workspace.
- Prepare populated local fixtures before capture: program registry/detail, generated report packet/detail artifact, scenario set/detail comparison, and grants opportunity/award/reimbursement state.
- For plans, confirm the updated NCTC seed fixture ID `d0000001-0000-4000-8000-000000000015` is visible through ordinary authenticated app access before recapture.
- Use stable local IDs and update only the local capture manifest or harness route placeholders when the fixtures exist.
- Keep capture output under `docs/ops/2026-04-29-test-output/ui-ux-settle/`.

Do not do in watchdog mode:
- Do not run `pnpm supabase db reset`, seed scripts, broad fixture imports, or production/Vercel captures.
- Do not accept empty-state screenshots as proof for these routes.
- Do not create users, mutate live workspaces, expose tokens, or use service-role shortcuts to force state.

Acceptance criteria:
- Each route renders the populated usable worksurface, not a loading shell, redirect, empty placeholder, or marketing surface.
- Desktop `1440x1100` and mobile `390x844` screenshots are captured.
- Ledger status changes from `fixture_required` to `captured`.
- Screenshot filenames and route rows identify the stable local fixture state used.

### P1 - Historical Detail and Admin Authorization States

Status: resolved by the supplemental `../ui-ux-settle-detail-admin-check/` proof pack. Keep this section as regression context only; the active remaining gaps are the plan recapture and fixture-required programs/reports/scenarios/grants rows above.

Routes: `/projects/d0000001-0000-4000-8000-000000000003`, `/county-runs/d0000001-0000-4000-8000-000000000005`, `/rtp/d0000001-0000-4000-8000-000000000004`, `/admin` across desktop and mobile.

Safe prerequisites:
- Verify the local storage state belongs to a workspace member with the route-required role/scope.
- Verify the NCTC demo IDs still exist locally and are visible through normal RLS-scoped app access.
- If `/admin` intentionally requires a higher role, document that role prerequisite instead of bypassing it.

Do not do in watchdog mode:
- Do not bypass RLS, inject cookies, edit auth sessions, add admin membership, or change authorization logic.
- Do not downgrade denied states into screenshots of error pages.
- Do not alter production data or credentials to satisfy a local proof gap.

Acceptance criteria:
- Authorized detail/admin surfaces render populated operational content in both viewports, or the gap is reclassified with a precise documented role prerequisite.
- Ledger status changes from `blocked_or_denied` to `captured`, or the blocking authorization requirement is recorded as an intentional proof prerequisite.
- No screenshot contains sign-in, unauthorized, forbidden, not-found, or empty workspace messaging.

### P1 - Explore Mapbox and Layer State

Route: `/explore` across desktop and mobile.

Status: locally resolved in the supplemental proof check at `../ui-ux-settle-explore-check/` after public Mapbox token normalization was corrected to ignore invalid `sk.*` public candidates and use the available `pk.*` token. The main full-ledger row remains historical; use the supplemental ledger/screenshots as the current `/explore` proof until the next full capture run regenerates the canonical ledger.

Safe prerequisites for any recapture:
- Confirm local `.env` has the required Mapbox/public map token without printing or committing its value.
- Confirm the local app can render `.mapboxgl-canvas` and the expected map controls/inspector on localhost.
- Confirm local layer/feed state is present enough for proof; if layers require external map assets or network that are unavailable, record that blocker without faking the canvas.

Do not do in watchdog mode:
- Do not paste token values into docs, logs, commits, screenshots, or shell output.
- Do not capture production maps or write to Mapbox, Supabase, Vercel, billing, email, or auth services.
- Do not accept a blank map canvas, token error state, or layerless shell as settled proof.

Acceptance criteria:
- `.mapboxgl-canvas` is visible and the map controls/inspector render in both viewports.
- Expected local layers are visible or explicitly identified in the screenshot context.
- Ledger status changes from `missing_expected_state` to `captured`.
- No secrets or token fragments appear in output artifacts.

### P2 - Captured-Watch Data Hub State

Route: `/data-hub` across desktop and mobile.

Safe prerequisites:
- Confirm whether connector/dataset rows are required for the settle proof or whether the current captured state is sufficient.
- Use only local read-only navigation and screenshots.

Do not do in watchdog mode:
- Do not connect live external datasets or credentials.
- Do not expand this into a data ingestion task.

Acceptance criteria:
- Either the current `captured_watch` rows are accepted as proof with a short note, or the route receives a local dataset fixture and is recaptured as `captured`.

## Anti-Generic UI Rejection Reminders

Reject a new proof capture as unsettled if the screen defaults to a generic SaaS card grid, stacked dashboard boxes, chip/pill clutter, floating badge noise, many competing primary CTAs, or decorative chrome doing the work of hierarchy.

Accept only populated civic-workbench states: left rail where applicable, continuous worksurface, row/list/table/document/map structure, clear inspector or detail context, one obvious primary action per area, and hierarchy carried mainly by layout, spacing, typography, alignment, and separators.
