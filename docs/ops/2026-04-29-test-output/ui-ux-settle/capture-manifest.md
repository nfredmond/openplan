# UI/UX Settle Capture Manifest

Date: 2026-04-29
Scope: P0 proof-pack preparation for the priority routes named in the settle checkpoint.
Capture root: `docs/ops/2026-04-29-test-output/ui-ux-settle/`

## Naming

Use this screenshot naming pattern:

```text
<route-key>--<viewport-key>--<state-key>.png
```

Examples:

```text
dashboard--desktop--workspace-overview.png
rtp-detail--mobile--nctc-cycle.png
explore-map--desktop--nctc-layers-ready.png
```

Each capture should be paired with a short ledger row recording:
- route URL,
- viewport,
- auth and workspace context,
- seed/demo state,
- whether a selected object, inspector, split pane, or map layer is visible,
- any missing local dependency.

## Viewports

| Key | Size | Required | Use |
| --- | --- | --- | --- |
| `desktop` | 1440x1100 | Yes | Primary workbench proof for every priority route. |
| `mobile` | 390x844 | Yes | Narrow-width proof for every priority route. |
| `tablet` | 834x1112 | Conditional | Capture only where the route changes structure materially, especially shell rail collapse, inspector movement, map controls, or multi-column registries. |

Use full-page screenshots where the route height exceeds the viewport, but keep the viewport size fixed so route-to-route comparison is meaningful.

## Shared State

Default local context:
- Base URL: `http://localhost:3000`
- App root: `openplan/`
- Preferred workspace: `Nevada County Transportation Commission (demo)`
- Preferred workspace id: `d0000001-0000-4000-8000-000000000001`
- Preferred demo user email: `nctc-demo@openplan-demo.natford.example`

Known deterministic NCTC demo records from `openplan/scripts/seed-nctc-demo.ts`:

| Record | Id | Label |
| --- | --- | --- |
| Project | `d0000001-0000-4000-8000-000000000003` | `NCTC 2045 RTP (proof-of-capability)` |
| Plan | `d0000001-0000-4000-8000-000000000015` | `NCTC 2045 RTP local proof plan` |
| RTP cycle | `d0000001-0000-4000-8000-000000000004` | `NCTC 2045 RTP - demo cycle` |
| Report | `d0000001-0000-4000-8000-000000000019` | `NCTC 2045 RTP settle board packet` |
| Scenario set | `d0000001-0000-4000-8000-000000000030` | `NCTC 2045 RTP scenario comparison` |
| Grants open opportunity | `d0000001-0000-4000-8000-000000000018` | `Rural RTP implementation readiness call` |
| Grants awarded opportunity | `d0000001-0000-4000-8000-000000000041` | `NCTC RTP LPP construction award` |
| Grants award | `d0000001-0000-4000-8000-000000000042` | `NCTC SR-49 safety package construction award` |
| Grants reimbursement invoice | `d0000001-0000-4000-8000-000000000043` | `NCTC-LPP-2026-001` |
| County run | `d0000001-0000-4000-8000-000000000005` | `nevada-county-runtime-norenumber-freeze-20260324` |
| Engagement campaign | `d0000001-0000-4000-8000-000000000010` | `NCTC 2045 RTP community input map` |

The NCTC seed now provides deterministic plan, program, report, scenario, and grants fixtures for `/plans`, `/plans/d0000001-0000-4000-8000-000000000015`, `/programs`, `/programs/d0000001-0000-4000-8000-000000000016`, `/reports`, `/reports/d0000001-0000-4000-8000-000000000019`, `/scenarios`, `/scenarios/d0000001-0000-4000-8000-000000000030`, and `/grants`. The 2026-04-30 local harness run captured those priority operating surfaces across desktop and mobile. If a fixture is missing during a future proof pass, record the missing dependency instead of substituting an empty-state screenshot.

## Route Queue

| Priority route | Route key | URLs | Required state | Required captures | Tablet trigger |
| --- | --- | --- | --- | --- | --- |
| App shell and overview | `dashboard` | `/dashboard` | Authenticated workspace with populated command board, KPI/run history, and shell rails visible. | Desktop and mobile workspace overview. | Capture tablet if left rail or command board changes layout. |
| Projects | `projects-index`, `project-detail` | `/projects`; `/projects/d0000001-0000-4000-8000-000000000003` | NCTC project visible, with detail page showing project posture, evidence/activity, funding/RTP context, and primary action hierarchy. | Desktop and mobile index plus detail. | Capture tablet if detail columns or right-side context rail change. |
| Plans | `plans-index`, `plan-detail` | `/plans`; `/plans/d0000001-0000-4000-8000-000000000015` | NCTC local proof plan linked to the demo project and inherited engagement context. Rerun the local NCTC seed before capture if this ID is not present. | Desktop and mobile populated index plus one detail page after fixture exists locally. | Capture tablet if registry/detail split changes. |
| Programs | `programs-index`, `program-detail` | `/programs`; `/programs/d0000001-0000-4000-8000-000000000016` | NCTC programming pipeline linked to the demo project/plan and a funding opportunity lane. Rerun the local NCTC seed before capture if this ID is not present. | Desktop and mobile populated index plus one detail page after fixture exists locally. | Capture tablet if funding lanes or summary grids reflow. |
| Reports | `reports-index`, `report-detail` | `/reports`; `/reports/d0000001-0000-4000-8000-000000000019` | NCTC local proof report packet with traceable RTP cycle, model, funding, engagement, section, and HTML artifact context. Rerun the local NCTC seed before capture if this ID is not present. | Desktop and mobile populated registry plus detail/artifact state after fixture exists locally. | Capture tablet if report navigation/detail preview changes. |
| Scenarios | `scenarios-index`, `scenario-detail` | `/scenarios`; `/scenarios/d0000001-0000-4000-8000-000000000030` | NCTC scenario set with baseline/alternative entries, attached local runs, and a saved comparison snapshot. Rerun the local NCTC seed before recapture if this ID is not present. | Desktop and mobile populated registry plus detail captured in the local ledger. | Capture tablet if comparison board changes materially. |
| Modeling | `models-index`, `modeling-county-run` | `/models`; `/county-runs`; `/county-runs/d0000001-0000-4000-8000-000000000005` | Modeling surface should show county run evidence/readiness without requiring a new run launch. | Desktop and mobile models/county-run surfaces. | Capture tablet if run history/evidence panels change. |
| Data Hub | `data-hub` | `/data-hub` | Workspace membership present. Prefer at least one connector/dataset/refresh row; if absent, record missing local dependency. | Desktop and mobile data hub worksurface. | Capture tablet if data registry and map preview split. |
| Map / Analysis Studio | `explore-map` | `/explore` | Mapbox token present, workspace resolved, map loaded, NCTC layers or analysis context visible. | Desktop and mobile map worksurface, including controls and inspector/hover context where possible. | Capture tablet for map controls and rail placement. |
| Engagement | `engagement-index`, `engagement-detail` | `/engagement`; `/engagement/d0000001-0000-4000-8000-000000000010` | NCTC campaign and approved items visible; capture moderation/intake context without creating or editing items. | Desktop and mobile index plus campaign detail. | Capture tablet if moderation/detail columns change. |
| Grants | `grants` | `/grants` | NCTC grants opportunity, award, and reimbursement state visible: `Rural RTP implementation readiness call`, `NCTC RTP LPP construction award`, `NCTC SR-49 SAFETY PACKAGE CONSTRUCTION AWARD`, and `NCTC-LPP-2026-001`. Rerun the local NCTC seed before recapture if these IDs are not present. | Desktop and mobile populated grants workbench captured in the local ledger. | Capture tablet if left/right operating lanes reflow. |
| RTP | `rtp-index`, `rtp-detail` | `/rtp`; `/rtp/d0000001-0000-4000-8000-000000000004` | NCTC RTP cycle and existing-conditions chapter visible; capture registry and cycle detail. | Desktop and mobile index plus detail. | Capture tablet if chapter/detail rail changes. |
| Admin / readiness | `admin-index`, `pilot-readiness` | `/admin`; `/admin/pilot-readiness` | Authenticated route reachable. Pilot readiness reads local proof docs from `docs/ops`; do not run mutating admin actions. | Desktop and mobile admin index plus readiness center. | Capture tablet if admin module grid or readiness table changes. |

## Capture Ledger Template

| Screenshot | Route URL | Viewport | Auth/workspace | Seed/demo state | Visible selected object or inspector | Missing dependency | Reviewer notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `dashboard--desktop--workspace-overview.png` | `/dashboard` | 1440x1100 | NCTC demo workspace | Command board and overview populated | Shell rails visible | None expected after local auth | Pending capture |
| `projects-index--desktop--nctc-project-visible.png` | `/projects` | 1440x1100 | NCTC demo workspace | NCTC project row visible | Registry/list worksurface | None expected after seed | Pending capture |
| `project-detail--desktop--nctc-project.png` | `/projects/d0000001-0000-4000-8000-000000000003` | 1440x1100 | NCTC demo workspace | NCTC project detail | Project posture/detail regions | None expected after seed | Pending capture |
| `plans-index--desktop--nctc-plan-visible.png` | `/plans` | 1440x1100 | NCTC demo workspace | NCTC local proof plan visible | Plan registry/detail surface | None after 2026-04-30 local seed | Captured |
| `plan-detail--desktop--nctc-plan.png` | `/plans/d0000001-0000-4000-8000-000000000015` | 1440x1100 | NCTC demo workspace | Linked NCTC local proof plan detail | Plan detail surface | None after 2026-04-30 local seed | Captured |
| `programs-index--desktop--nctc-program-visible.png` | `/programs` | 1440x1100 | NCTC demo workspace | NCTC programming pipeline visible | Program registry surface | None after 2026-04-30 local seed | Captured |
| `program-detail--desktop--nctc-program.png` | `/programs/d0000001-0000-4000-8000-000000000016` | 1440x1100 | NCTC demo workspace | Linked NCTC program detail visible | Program detail/funding lane surface | None after 2026-04-30 local seed | Captured |
| `reports-index--desktop--nctc-report-visible.png` | `/reports` | 1440x1100 | NCTC demo workspace | NCTC report packet visible | Report registry surface | None after 2026-04-30 local seed | Captured |
| `report-detail--desktop--nctc-report.png` | `/reports/d0000001-0000-4000-8000-000000000019` | 1440x1100 | NCTC demo workspace | NCTC report packet detail visible | Report detail/artifact state | None after 2026-04-30 local seed | Captured |
| `scenarios-index--desktop--nctc-scenario-visible.png` | `/scenarios` | 1440x1100 | NCTC demo workspace | NCTC scenario set and comparison entries visible | Scenario registry surface | None after 2026-04-30 local seed recapture | Captured |
| `scenario-detail--desktop--nctc-scenario.png` | `/scenarios/d0000001-0000-4000-8000-000000000030` | 1440x1100 | NCTC demo workspace | NCTC scenario comparison detail visible | Scenario comparison surface | None after 2026-04-30 local seed recapture | Captured |
| `county-run-detail--desktop--nctc-run.png` | `/county-runs/d0000001-0000-4000-8000-000000000005` | 1440x1100 | NCTC demo workspace | County run evidence visible | Run detail/evidence panel | None expected after seed | Pending capture |
| `data-hub--desktop--workspace-data.png` | `/data-hub` | 1440x1100 | NCTC demo workspace | Connector/dataset rows preferred | Data hub worksurface | Dataset fixture may be missing | Record actual state |
| `explore-map--desktop--nctc-layers-ready.png` | `/explore` | 1440x1100 | NCTC demo workspace | Mapbox map and layers loaded | Map controls/inspector visible | Mapbox token required | Pending capture |
| `engagement-detail--desktop--nctc-campaign.png` | `/engagement/d0000001-0000-4000-8000-000000000010` | 1440x1100 | NCTC demo workspace | Campaign and items visible | Campaign detail/workflow | None expected after seed | Pending capture |
| `grants--desktop--nctc-grants-visible.png` | `/grants` | 1440x1100 | NCTC demo workspace | NCTC grants opportunity, award, and reimbursement state visible | Grants operating lanes | None after 2026-04-30 local seed recapture | Captured |
| `rtp-detail--desktop--nctc-cycle.png` | `/rtp/d0000001-0000-4000-8000-000000000004` | 1440x1100 | NCTC demo workspace | RTP cycle and chapter visible | Cycle detail/document flow | None expected after seed | Pending capture |
| `pilot-readiness--desktop--local-doc-status.png` | `/admin/pilot-readiness` | 1440x1100 | Authenticated operator workspace | Local proof docs visible as readiness inputs | Readiness status list | None expected after auth | Pending capture |

## Rejection Checks To Apply After Capture

For each route, mark `pass`, `watch`, or `fail` against these checkpoint questions:
- Does it read as a civic workbench rather than a generic widget board?
- Are cards absent unless the card is the interaction unit?
- Are chips, pills, badges, and metadata labels materially reduced?
- Is there one obvious primary action per major area?
- Is selected-object detail handled by a rail, inspector, split pane, or document-like detail flow?
- Are map and analysis surfaces treated as instrumentation rather than decorative dashboard tiles?
- Is hierarchy carried by layout, typography, alignment, spacing, and separators before color, shadows, or container chrome?
