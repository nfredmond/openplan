# UI/UX Settle Fixture/Auth Continuation

Date: 2026-04-29
Scope: practical next-step runbook for the remaining local proof gaps after the main `ui-ux-settle` ledger and supplemental `ui-ux-settle-explore-check` pack. This is not a capture result and does not authorize runtime code changes, seed scripts, database resets, service-role access, or production/Vercel activity.

## Current State

- `/explore` is separately settled by `../ui-ux-settle-explore-check/`.
- Current remaining proof-pack gaps are:
  - reports are settled in the main ledger as `/reports/d0000001-0000-4000-8000-000000000019` with desktop/mobile captures.
  - `seed_backed_recapture_pending`: `/scenarios`, `/scenarios/d0000001-0000-4000-8000-000000000030` at desktop and mobile.
  - `fixture_required`: `/grants` at desktop and mobile.
- Historical `blocked_or_denied` rows for project detail, county-run detail, RTP detail, and `/admin` were resolved by the supplemental detail/admin auth check; keep those rows only as regression context.
- The capture harness now separates hard denial terms from workspace-prerequisite phrases and no longer treats ordinary compliance/readiness uses of `Required` as an authorization failure (`qa-harness/openplan-local-ui-ux-settle-capture.js`). Treat the historical blocked/detail rows as classifier false positives unless a fresh capture finds hard denial language or missing expected route text.

## Grounding From Repo Inspection

- The app shell requires an authenticated user for all `(app)` routes (`openplan/src/app/(app)/layout.tsx:10-17`).
- Current workspace selection reads `workspace_members` and picks the first available membership when no explicit workspace is requested (`openplan/src/lib/workspaces/current.ts:132-152`).
- Workspace member, admin, and owner can read/write plans, programs, reports, scenarios, and generate reports; invoice writes require owner/admin (`openplan/src/lib/auth/role-matrix.ts:33-56`).
- Plans require workspace membership and read `plans`, `plan_links`, project scenario/campaign/report counts for populated registry/detail proof (`openplan/src/app/(app)/plans/page.tsx:87-125`; `openplan/src/app/(app)/plans/[planId]/page.tsx:178-234`).
- Programs require workspace membership and read `programs`, `program_links`, project plans/reports/campaigns, and funding opportunities (`openplan/src/app/(app)/programs/page.tsx:165-241`; `openplan/src/app/(app)/programs/[programId]/page.tsx:191-245`).
- Reports require workspace membership and read report artifacts plus project/RTP context; generation checks workspace membership, subscription/quota posture, and `report.generate` (`openplan/src/app/(app)/reports/page.tsx:219-281`; `openplan/src/app/api/reports/[reportId]/generate/route.ts:317-362`).
- Scenarios require workspace membership and read scenario entries, runs, models, comparison snapshots, and linked reports (`openplan/src/app/(app)/scenarios/page.tsx:63-84`; `openplan/src/app/(app)/scenarios/[scenarioSetId]/page.tsx:94-184`).
- Grants require workspace membership and read opportunities, projects, programs, awards, invoices, funding profiles, reports, and comparison summaries (`openplan/src/app/(app)/grants/page.tsx:95-154`; `openplan/src/app/(app)/grants/page.tsx:180-260`).
- `/admin` has no page-level owner/admin gate; it is inside the authenticated app shell and renders static admin module links (`openplan/src/app/(app)/admin/page.tsx:64-203`).

## Route Groups And Safe Next Steps

| Group | Routes | Local-only prerequisites | Safe continuation steps | Acceptance |
| --- | --- | --- | --- | --- |
| Plans | `/plans`, `/plans/d0000001-0000-4000-8000-000000000015` | Authenticated local storage state for a workspace member; updated NCTC local seed run against local Supabase; no production Supabase. | Rerun the local NCTC seed, then run the capture harness for `plans-index` and `plan-detail`. If the plan ID is missing, record the local seed prerequisite instead of substituting an empty-state capture. | Registry shows `NCTC 2045 RTP local proof plan`; detail shows scope/context, the linked NCTC project, and inherited engagement context. Desktop/mobile rows become `captured`. |
| Programs | `/programs`, `/programs/d0000001-0000-4000-8000-000000000016` | Resolved in the main ledger after the updated local NCTC seed and capture. | Keep the deterministic seed fixture (`NCTC 2045 RTP programming pipeline`) and linked funding opportunity (`Rural RTP implementation readiness call`) as regression coverage. | Registry/detail rows are captured on desktop and mobile. |
| Reports | `/reports`, `/reports/d0000001-0000-4000-8000-000000000019` | Resolved in the main ledger after the updated local NCTC seed and capture. | Keep the deterministic RTP board-packet fixture, sections, and HTML artifact as regression coverage; do not generate reports during capture-only passes. | Registry/detail rows are captured on desktop and mobile. |
| Scenarios | `/scenarios`, `/scenarios/d0000001-0000-4000-8000-000000000030` | Same local NCTC demo workspace; updated NCTC local seed run against local Supabase; no new model worker launch. | Rerun the local NCTC seed, then run the capture harness for `scenarios-index` and `scenario-detail`. The seed supplies two local `runs`, one baseline entry, one alternative entry, and one comparison snapshot. | Registry shows `NCTC 2045 RTP scenario comparison`; detail shows `SR-49 safety package` comparison readiness/snapshot state. Desktop/mobile rows become `captured`. |
| Grants | `/grants` | Same local workspace; local project and preferably a linked program; owner/admin role if invoice writes are needed. | Build the minimal local grants stack through normal UI/API only: project funding profile (`/api/projects/<projectId>/funding-profile`), one funding opportunity (`/api/funding-opportunities`), one award (`/api/funding-awards`), and one invoice through `/api/billing/invoices` only if the storage-state role is owner/admin. If invoice write is not authorized, record the owner/admin prerequisite instead of weakening the proof. | Grants page shows opportunity queue, award/obligation posture, and reimbursement/invoice state, not just an empty opportunity form. |
| Detail/admin checks | Project detail, county-run detail, RTP detail, `/admin` | Existing local storage state; no auth-session edits; no RLS bypass; no service-role reads. | First confirm whether each blocked row is a real app denial or a capture-classifier false positive. Read-only checks: route should stay on its target URL, not `/sign-in`; expected object text should be present; detail APIs should return 200 under the same browser session where applicable. For `/admin`, do not escalate role before checking the harness pattern, because the page itself has no owner/admin gate. If a stable demo id no longer exists, update the manifest to the actual local id discovered from the captured index route. | Each row is either recaptured as populated content in both viewports or reclassified with an exact cause: missing local record id, expired storage state, wrong current workspace, owner/admin-only invoice prerequisite, or capture harness overmatch. |

## No-Go Checks

- Do not run seed scripts, `pnpm supabase db reset`, Supabase CLI mutations, Vercel commands, production harnesses, browser captures, or external writes in this docs-only pass.
- Do not create users, alter auth sessions, paste tokens, print secrets, bypass RLS, or use service-role shortcuts to make rows visible.
- Do not direct-insert fixture rows with elevated credentials. When a future local fixture-write pass is approved, use normal app UI/API flows with the same local authenticated session the capture will use.
- Do not accept empty-state, sign-in, unauthorized, forbidden, not-found, loading-only, or marketing screenshots as settled proof.
- Do not update route placeholders until the local fixture id exists and is visible through ordinary RLS-scoped app access. The scenario placeholder is now resolved to the NCTC seed ID; grants remains unresolved.
- Do not treat `/admin` as requiring owner/admin unless repo behavior changes; today it is auth-only through the app layout.

## Capture Acceptance Criteria

1. Run only against `http://localhost:3000` or an explicitly documented private local URL accepted by the local harness.
2. Use a local authenticated Playwright storage state for the same workspace that owns every fixture id in the manifest.
3. For each route, capture desktop `1440x1100` and mobile `390x844`.
4. Ledger rows move from `fixture_required` or `blocked_or_denied` to `captured`, except rows deliberately reclassified with a concrete local prerequisite.
5. Screenshot names keep the manifest pattern and include route key, viewport, and state key.
6. The captured page body shows populated civic-workbench content: left rail where applicable, continuous worksurface, detail/inspector/document/map context, and one clear primary action area.
7. No output artifact contains credentials, token fragments, session values, production URLs, or service-role evidence.
