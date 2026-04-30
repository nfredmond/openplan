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
| County run | `d0000001-0000-4000-8000-000000000005` | `nevada-county-runtime-norenumber-freeze-20260324` |
| Engagement campaign | `d0000001-0000-4000-8000-000000000010` | `NCTC 2045 RTP community input map` |

The NCTC seed now provides a deterministic plan fixture for `/plans` and `/plans/d0000001-0000-4000-8000-000000000015`. The seed does not currently provide deterministic program, report, model-detail, or scenario-set detail IDs. Those routes still need a local populated fixture before final capture. If the fixture is missing during the proof pass, record the missing dependency instead of substituting an empty-state screenshot.

## Route Queue

| Priority route | Route key | URLs | Required state | Required captures | Tablet trigger |
| --- | --- | --- | --- | --- | --- |
| App shell and overview | `dashboard` | `/dashboard` | Authenticated workspace with populated command board, KPI/run history, and shell rails visible. | Desktop and mobile workspace overview. | Capture tablet if left rail or command board changes layout. |
| Projects | `projects-index`, `project-detail` | `/projects`; `/projects/d0000001-0000-4000-8000-000000000003` | NCTC project visible, with detail page showing project posture, evidence/activity, funding/RTP context, and primary action hierarchy. | Desktop and mobile index plus detail. | Capture tablet if detail columns or right-side context rail change. |
| Plans | `plans-index`, `plan-detail` | `/plans`; `/plans/d0000001-0000-4000-8000-000000000015` | NCTC local proof plan linked to the demo project and inherited engagement context. Rerun the local NCTC seed before capture if this ID is not present. | Desktop and mobile populated index plus one detail page after fixture exists locally. | Capture tablet if registry/detail split changes. |
| Programs | `programs-index`, `program-detail` | `/programs`; `/programs/<local-program-id>` | At least one local program linked to a project/plan and funding lane. NCTC seed does not provide this today. | Desktop and mobile populated index plus one detail page after fixture exists. | Capture tablet if funding lanes or summary grids reflow. |
| Reports | `reports-index`, `report-detail` | `/reports`; `/reports/<local-report-id>` | At least one generated or current report packet with traceable source context. NCTC seed does not provide this today. | Desktop and mobile registry plus detail/artifact state after fixture exists. | Capture tablet if report navigation/detail preview changes. |
| Scenarios | `scenarios-index`, `scenario-detail` | `/scenarios`; `/scenarios/<local-scenario-set-id>` | At least one scenario set with entries/comparison state. NCTC seed does not provide this today. | Desktop and mobile registry plus detail after fixture exists. | Capture tablet if comparison board changes materially. |
| Modeling | `models-index`, `modeling-county-run` | `/models`; `/county-runs`; `/county-runs/d0000001-0000-4000-8000-000000000005` | Modeling surface should show county run evidence/readiness without requiring a new run launch. | Desktop and mobile models/county-run surfaces. | Capture tablet if run history/evidence panels change. |
| Data Hub | `data-hub` | `/data-hub` | Workspace membership present. Prefer at least one connector/dataset/refresh row; if absent, record missing local dependency. | Desktop and mobile data hub worksurface. | Capture tablet if data registry and map preview split. |
| Map / Analysis Studio | `explore-map` | `/explore` | Mapbox token present, workspace resolved, map loaded, NCTC layers or analysis context visible. | Desktop and mobile map worksurface, including controls and inspector/hover context where possible. | Capture tablet for map controls and rail placement. |
| Engagement | `engagement-index`, `engagement-detail` | `/engagement`; `/engagement/d0000001-0000-4000-8000-000000000010` | NCTC campaign and approved items visible; capture moderation/intake context without creating or editing items. | Desktop and mobile index plus campaign detail. | Capture tablet if moderation/detail columns change. |
| Grants | `grants` | `/grants` | Populated opportunity/award/reimbursement state. NCTC seed does not provide this today. | Desktop and mobile grants workbench after local fixture exists. | Capture tablet if left/right operating lanes reflow. |
| RTP | `rtp-index`, `rtp-detail` | `/rtp`; `/rtp/d0000001-0000-4000-8000-000000000004` | NCTC RTP cycle and existing-conditions chapter visible; capture registry and cycle detail. | Desktop and mobile index plus detail. | Capture tablet if chapter/detail rail changes. |
| Admin / readiness | `admin-index`, `pilot-readiness` | `/admin`; `/admin/pilot-readiness` | Authenticated route reachable. Pilot readiness reads local proof docs from `docs/ops`; do not run mutating admin actions. | Desktop and mobile admin index plus readiness center. | Capture tablet if admin module grid or readiness table changes. |

## Capture Ledger Template

| Screenshot | Route URL | Viewport | Auth/workspace | Seed/demo state | Visible selected object or inspector | Missing dependency | Reviewer notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `dashboard--desktop--workspace-overview.png` | `/dashboard` | 1440x1100 | NCTC demo workspace | Command board and overview populated | Shell rails visible | None expected after local auth | Pending capture |
| `projects-index--desktop--nctc-project-visible.png` | `/projects` | 1440x1100 | NCTC demo workspace | NCTC project row visible | Registry/list worksurface | None expected after seed | Pending capture |
| `project-detail--desktop--nctc-project.png` | `/projects/d0000001-0000-4000-8000-000000000003` | 1440x1100 | NCTC demo workspace | NCTC project detail | Project posture/detail regions | None expected after seed | Pending capture |
| `plans-index--desktop--nctc-plan-visible.png` | `/plans` | 1440x1100 | NCTC demo workspace | NCTC local proof plan visible | Plan registry/detail surface | Rerun updated local NCTC seed if missing | Pending capture |
| `plan-detail--desktop--nctc-plan.png` | `/plans/d0000001-0000-4000-8000-000000000015` | 1440x1100 | NCTC demo workspace | Linked NCTC local proof plan detail | Plan detail surface | Rerun updated local NCTC seed if missing | Pending capture |
| `programs-index--desktop--fixture-required.png` | `/programs` | 1440x1100 | Workspace fixture TBD | Populated program registry required | TBD | Local program fixture missing | Do not use empty-state proof |
| `reports-index--desktop--fixture-required.png` | `/reports` | 1440x1100 | Workspace fixture TBD | Generated/current report packet required | TBD | Local report fixture missing | Do not use empty-state proof |
| `scenarios-index--desktop--fixture-required.png` | `/scenarios` | 1440x1100 | Workspace fixture TBD | Scenario set and entries required | TBD | Local scenario fixture missing | Do not use empty-state proof |
| `county-run-detail--desktop--nctc-run.png` | `/county-runs/d0000001-0000-4000-8000-000000000005` | 1440x1100 | NCTC demo workspace | County run evidence visible | Run detail/evidence panel | None expected after seed | Pending capture |
| `data-hub--desktop--workspace-data.png` | `/data-hub` | 1440x1100 | NCTC demo workspace | Connector/dataset rows preferred | Data hub worksurface | Dataset fixture may be missing | Record actual state |
| `explore-map--desktop--nctc-layers-ready.png` | `/explore` | 1440x1100 | NCTC demo workspace | Mapbox map and layers loaded | Map controls/inspector visible | Mapbox token required | Pending capture |
| `engagement-detail--desktop--nctc-campaign.png` | `/engagement/d0000001-0000-4000-8000-000000000010` | 1440x1100 | NCTC demo workspace | Campaign and items visible | Campaign detail/workflow | None expected after seed | Pending capture |
| `grants--desktop--fixture-required.png` | `/grants` | 1440x1100 | Workspace fixture TBD | Opportunity/award/reimbursement state required | Grants operating lanes | Grants fixture missing | Do not use empty-state proof |
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
