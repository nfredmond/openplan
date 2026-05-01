# OpenPlan UI/UX Settle Review

- **Date:** 2026-05-01
- **Status:** PASS
- **Checkpoint:** `2026-04-29-openplan-ui-ux-settle-checkpoint.md`
- **Evidence folder:** `2026-04-29-test-output/ui-ux-settle/`
- **Watch recapture:** `2026-05-01-test-output/ui-ux-watch-recapture/`

## Result

The UI/UX settle proof pack is sufficient to unblock the next roadmap slice. The existing local-only capture set shows populated desktop and mobile operating surfaces for the app shell and the priority routes requested by the checkpoint. The two original watch items were closed by the 2026-05-01 local recapture pack.

Evidence reviewed:

- Main ledger: 46 screenshots across 23 route groups, desktop `1440x1100` and mobile `390x844`.
- Supplemental `/explore` proof: Mapbox canvas, controls, and inspector capture after public-token normalization.
- Supplemental detail/admin proof: project detail, county-run detail, RTP detail, and `/admin` captured without hard denial terms.
- Supplemental watch recapture: `/data-hub` and `/admin/pilot-readiness` desktop/mobile captured after the Data Hub fixture and readiness parser repairs.
- Source guardrails: frontend design constitution, 2026-04-29 settle checkpoint, and current web interface guidelines.

No priority route is currently marked `fail`.

## Route Review

| Route group | Status | Notes |
| --- | --- | --- |
| Dashboard | pass | Command-center posture is visible in both viewports; not a generic marketing or widget-only board. |
| Projects index/detail | pass | Project registry and detail surfaces show project-centered planning context. |
| Plans index/detail | pass | Plan registry and detail surfaces show NCTC seeded planning workflow context. |
| Programs index/detail | pass | Program/funding cycle context is populated and connected to the shared spine. |
| Reports index/detail | pass | Report packet workflow and artifact posture are visible. |
| Scenarios index/detail | pass | Scenario comparison fixtures render in both viewports. |
| Models index | pass | Modeling readiness/run history is visible as an operating surface. |
| County runs index/detail | pass | County run evidence and runtime detail are populated. |
| Engagement index/detail | pass | Campaign registry, moderation/readiness context, and campaign detail are populated. |
| Grants | pass | Opportunity, award, funding profile, and reimbursement context are visible. |
| RTP index/detail | pass | RTP cycle registry and detail/document flow are populated. |
| Explore map | pass | Supplemental proof confirms Mapbox canvas, controls, and inspector in both viewports. |
| Admin index | pass | Authenticated admin surface captured without hard denial terms. |
| Pilot Readiness | pass | Supplemental 2026-05-01 desktop/mobile recapture shows the parser-repaired readiness surface with four passing checks and no pending/failing checks. |
| Data Hub | pass | Supplemental 2026-05-01 desktop/mobile recapture requires and captures the NCTC Data Hub connector plus three seeded datasets. |

## Anti-Generic Review

- Workbench posture: pass. Priority screenshots show authenticated planning work surfaces, not public hero pages or empty placeholders.
- Card/grid risk: pass with watch. Remaining card-like elements are mostly summary blocks, interaction units, or status panels; no priority route fails as a generic SaaS card grid.
- Pill/badge risk: pass with watch. Status badges are mainly status-critical. Future work should keep metadata chips out of primary hierarchy when adding filters or summaries.
- Inspector/detail posture: pass. Detail pages use document, registry, rail, panel, map, or selected-object context instead of scattering unrelated metadata boxes.
- Primary action hierarchy: pass. No captured priority route shows a broad cluster of equal-weight primary CTAs.
- Mobile posture: pass with watch. Captures exist for all route groups; no route is marked failed for overlap or redirect/empty state in the ledger.

## Card/Pill/Badge Inventory

No full component census is needed because there are no route failures. Current classifications:

- `module-summary-card`, `module-metric-card`: summary blocks, acceptable when used for compact operational metrics.
- Registry rows, tables, and document sections: preferred structures for scan/compare/review tasks.
- `StatusBadge`: status-critical when tied to readiness, freshness, funding, moderation, or review posture.
- Explore map chips/badges: acceptable as map control or inspector affordances, but keep under watch because map surfaces can drift into badge noise quickly.
- Data Hub capture: pass after the 2026-05-01 recapture pack; the harness now requires the seeded connector and datasets before it marks the route captured.

## Bounded Follow-Up

1. On the next major UI change, rerun the same local-only settle harness before broad refactors.
2. Keep the NCTC Data Hub fixture in `scripts/seed-nctc-demo.ts` aligned with the Data Hub route expectations.

## Definition Of Settled

The UI/UX overhaul is settled enough for the next implementation wave:

- The proof pack exists for all priority route groups.
- No priority route fails the rejection criteria.
- The original watch items have local desktop/mobile recapture proof.
- The app preserves the civic workbench posture: left rail where applicable, continuous worksurface, row/table/document/map structures, clear context panels, and restrained status language.
- Future UI work should start from this review, the frontend constitution, and the 2026-04-29 checkpoint.
