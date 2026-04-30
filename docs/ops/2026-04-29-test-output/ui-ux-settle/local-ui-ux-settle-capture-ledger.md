# OpenPlan Local UI/UX Settle Capture Ledger

Generated: 2026-04-30T03:22:39.962Z
Base URL: http://localhost:3000
Output directory: docs/ops/2026-04-29-test-output/ui-ux-settle
Storage state supplied: yes
Mutation posture: read-only browser navigation/screenshots only; no users, seeds, Supabase writes, email, billing, or credential/token persistence.

## No-Go Guard Result

- Production/Vercel URLs refused before browser launch.
- Output path confined to `docs/ops/`.
- Fixture-required routes are marked below and skipped until populated local fixtures exist.

## Status Counts

| Status | Count |
| --- | ---: |
| blocked_or_denied | 8 |
| captured | 16 |
| captured_watch | 2 |
| fixture_required | 18 |
| missing_expected_state | 2 |

## Ledger

| Screenshot | Route URL | Viewport | Status | Auth/workspace | Seed/demo state | Visible target | Missing dependency | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| docs/ops/2026-04-29-test-output/ui-ux-settle/dashboard--desktop--workspace-overview.png | /dashboard | 1440x1100 | captured | NCTC demo workspace | Command board and overview populated | Shell rails visible | - | Captured populated/authenticated local route state. |
| docs/ops/2026-04-29-test-output/ui-ux-settle/projects-index--desktop--nctc-project-visible.png | /projects | 1440x1100 | captured | NCTC demo workspace | NCTC project row visible | Registry/list worksurface | - | Captured populated/authenticated local route state. |
| - | /projects/d0000001-0000-4000-8000-000000000003 | 1440x1100 | blocked_or_denied | NCTC demo workspace | NCTC project detail visible | Project posture/detail regions | Route did not render an authorized workspace state. | No screenshot captured. |
| - | /plans | 1440x1100 | fixture_required | Workspace fixture TBD | Populated plan registry required | Plan registry/detail surface | Local plan fixture missing; do not use empty-state proof. | Local plan fixture missing; do not use empty-state proof. |
| - | /plans/<local-plan-id> | 1440x1100 | fixture_required | Workspace fixture TBD | Linked local plan detail required | Plan detail surface | Local plan detail fixture missing; do not use empty-state proof. | Local plan detail fixture missing; do not use empty-state proof. |
| - | /programs | 1440x1100 | fixture_required | Workspace fixture TBD | Populated program registry required | Program registry surface | Local program fixture missing; do not use empty-state proof. | Local program fixture missing; do not use empty-state proof. |
| - | /programs/<local-program-id> | 1440x1100 | fixture_required | Workspace fixture TBD | Linked local program detail required | Program detail/funding lane surface | Local program detail fixture missing; do not use empty-state proof. | Local program detail fixture missing; do not use empty-state proof. |
| - | /reports | 1440x1100 | fixture_required | Workspace fixture TBD | Generated/current report packet required | Report registry surface | Local report fixture missing; do not use empty-state proof. | Local report fixture missing; do not use empty-state proof. |
| - | /reports/<local-report-id> | 1440x1100 | fixture_required | Workspace fixture TBD | Report packet detail/artifact required | Report detail/artifact state | Local report detail fixture missing; do not use empty-state proof. | Local report detail fixture missing; do not use empty-state proof. |
| - | /scenarios | 1440x1100 | fixture_required | Workspace fixture TBD | Scenario set and entries required | Scenario registry surface | Local scenario fixture missing; do not use empty-state proof. | Local scenario fixture missing; do not use empty-state proof. |
| - | /scenarios/<local-scenario-set-id> | 1440x1100 | fixture_required | Workspace fixture TBD | Scenario comparison detail required | Scenario comparison surface | Local scenario detail fixture missing; do not use empty-state proof. | Local scenario detail fixture missing; do not use empty-state proof. |
| docs/ops/2026-04-29-test-output/ui-ux-settle/models-index--desktop--workspace-models.png | /models | 1440x1100 | captured | NCTC demo workspace | Modeling readiness/run history visible | Modeling workbench surface | - | Captured populated/authenticated local route state. |
| docs/ops/2026-04-29-test-output/ui-ux-settle/county-runs-index--desktop--workspace-runs.png | /county-runs | 1440x1100 | captured | NCTC demo workspace | County run registry visible | Run registry surface | - | Captured populated/authenticated local route state. |
| - | /county-runs/d0000001-0000-4000-8000-000000000005 | 1440x1100 | blocked_or_denied | NCTC demo workspace | County run evidence visible | Run detail/evidence panel | Route did not render an authorized workspace state. | No screenshot captured. |
| docs/ops/2026-04-29-test-output/ui-ux-settle/data-hub--desktop--workspace-data.png | /data-hub | 1440x1100 | captured_watch | NCTC demo workspace | Connector/dataset rows preferred | Data hub worksurface | Dataset fixture may be missing; record actual local state. | Dataset fixture may be missing; record actual local state. |
| - | /explore | 1440x1100 | missing_expected_state | NCTC demo workspace | Mapbox map and layers loaded | Map controls/inspector visible | Mapbox token or local map layer state missing. | No screenshot captured. |
| docs/ops/2026-04-29-test-output/ui-ux-settle/engagement-index--desktop--workspace-campaigns.png | /engagement | 1440x1100 | captured | NCTC demo workspace | NCTC engagement campaign visible | Engagement registry/workflow surface | - | Captured populated/authenticated local route state. |
| docs/ops/2026-04-29-test-output/ui-ux-settle/engagement-detail--desktop--nctc-campaign.png | /engagement/d0000001-0000-4000-8000-000000000010 | 1440x1100 | captured | NCTC demo workspace | Campaign and approved items visible | Campaign detail/workflow | - | Captured populated/authenticated local route state. |
| - | /grants | 1440x1100 | fixture_required | Workspace fixture TBD | Opportunity/award/reimbursement state required | Grants operating lanes | Local grants fixture missing; do not use empty-state proof. | Local grants fixture missing; do not use empty-state proof. |
| docs/ops/2026-04-29-test-output/ui-ux-settle/rtp-index--desktop--nctc-cycle-visible.png | /rtp | 1440x1100 | captured | NCTC demo workspace | NCTC RTP cycle visible | RTP registry/document flow | - | Captured populated/authenticated local route state. |
| - | /rtp/d0000001-0000-4000-8000-000000000004 | 1440x1100 | blocked_or_denied | NCTC demo workspace | RTP cycle and chapter visible | Cycle detail/document flow | Route did not render an authorized workspace state. | No screenshot captured. |
| - | /admin | 1440x1100 | blocked_or_denied | Authenticated operator workspace | Admin route reachable | Admin module surface | Route did not render an authorized workspace state. | No screenshot captured. |
| docs/ops/2026-04-29-test-output/ui-ux-settle/pilot-readiness--desktop--local-doc-status.png | /admin/pilot-readiness | 1440x1100 | captured | Authenticated operator workspace | Local proof docs visible as readiness inputs | Readiness status list | - | Captured populated/authenticated local route state. |
| docs/ops/2026-04-29-test-output/ui-ux-settle/dashboard--mobile--workspace-overview.png | /dashboard | 390x844 | captured | NCTC demo workspace | Command board and overview populated | Shell rails visible | - | Captured populated/authenticated local route state. |
| docs/ops/2026-04-29-test-output/ui-ux-settle/projects-index--mobile--nctc-project-visible.png | /projects | 390x844 | captured | NCTC demo workspace | NCTC project row visible | Registry/list worksurface | - | Captured populated/authenticated local route state. |
| - | /projects/d0000001-0000-4000-8000-000000000003 | 390x844 | blocked_or_denied | NCTC demo workspace | NCTC project detail visible | Project posture/detail regions | Route did not render an authorized workspace state. | No screenshot captured. |
| - | /plans | 390x844 | fixture_required | Workspace fixture TBD | Populated plan registry required | Plan registry/detail surface | Local plan fixture missing; do not use empty-state proof. | Local plan fixture missing; do not use empty-state proof. |
| - | /plans/<local-plan-id> | 390x844 | fixture_required | Workspace fixture TBD | Linked local plan detail required | Plan detail surface | Local plan detail fixture missing; do not use empty-state proof. | Local plan detail fixture missing; do not use empty-state proof. |
| - | /programs | 390x844 | fixture_required | Workspace fixture TBD | Populated program registry required | Program registry surface | Local program fixture missing; do not use empty-state proof. | Local program fixture missing; do not use empty-state proof. |
| - | /programs/<local-program-id> | 390x844 | fixture_required | Workspace fixture TBD | Linked local program detail required | Program detail/funding lane surface | Local program detail fixture missing; do not use empty-state proof. | Local program detail fixture missing; do not use empty-state proof. |
| - | /reports | 390x844 | fixture_required | Workspace fixture TBD | Generated/current report packet required | Report registry surface | Local report fixture missing; do not use empty-state proof. | Local report fixture missing; do not use empty-state proof. |
| - | /reports/<local-report-id> | 390x844 | fixture_required | Workspace fixture TBD | Report packet detail/artifact required | Report detail/artifact state | Local report detail fixture missing; do not use empty-state proof. | Local report detail fixture missing; do not use empty-state proof. |
| - | /scenarios | 390x844 | fixture_required | Workspace fixture TBD | Scenario set and entries required | Scenario registry surface | Local scenario fixture missing; do not use empty-state proof. | Local scenario fixture missing; do not use empty-state proof. |
| - | /scenarios/<local-scenario-set-id> | 390x844 | fixture_required | Workspace fixture TBD | Scenario comparison detail required | Scenario comparison surface | Local scenario detail fixture missing; do not use empty-state proof. | Local scenario detail fixture missing; do not use empty-state proof. |
| docs/ops/2026-04-29-test-output/ui-ux-settle/models-index--mobile--workspace-models.png | /models | 390x844 | captured | NCTC demo workspace | Modeling readiness/run history visible | Modeling workbench surface | - | Captured populated/authenticated local route state. |
| docs/ops/2026-04-29-test-output/ui-ux-settle/county-runs-index--mobile--workspace-runs.png | /county-runs | 390x844 | captured | NCTC demo workspace | County run registry visible | Run registry surface | - | Captured populated/authenticated local route state. |
| - | /county-runs/d0000001-0000-4000-8000-000000000005 | 390x844 | blocked_or_denied | NCTC demo workspace | County run evidence visible | Run detail/evidence panel | Route did not render an authorized workspace state. | No screenshot captured. |
| docs/ops/2026-04-29-test-output/ui-ux-settle/data-hub--mobile--workspace-data.png | /data-hub | 390x844 | captured_watch | NCTC demo workspace | Connector/dataset rows preferred | Data hub worksurface | Dataset fixture may be missing; record actual local state. | Dataset fixture may be missing; record actual local state. |
| - | /explore | 390x844 | missing_expected_state | NCTC demo workspace | Mapbox map and layers loaded | Map controls/inspector visible | Mapbox token or local map layer state missing. | No screenshot captured. |
| docs/ops/2026-04-29-test-output/ui-ux-settle/engagement-index--mobile--workspace-campaigns.png | /engagement | 390x844 | captured | NCTC demo workspace | NCTC engagement campaign visible | Engagement registry/workflow surface | - | Captured populated/authenticated local route state. |
| docs/ops/2026-04-29-test-output/ui-ux-settle/engagement-detail--mobile--nctc-campaign.png | /engagement/d0000001-0000-4000-8000-000000000010 | 390x844 | captured | NCTC demo workspace | Campaign and approved items visible | Campaign detail/workflow | - | Captured populated/authenticated local route state. |
| - | /grants | 390x844 | fixture_required | Workspace fixture TBD | Opportunity/award/reimbursement state required | Grants operating lanes | Local grants fixture missing; do not use empty-state proof. | Local grants fixture missing; do not use empty-state proof. |
| docs/ops/2026-04-29-test-output/ui-ux-settle/rtp-index--mobile--nctc-cycle-visible.png | /rtp | 390x844 | captured | NCTC demo workspace | NCTC RTP cycle visible | RTP registry/document flow | - | Captured populated/authenticated local route state. |
| - | /rtp/d0000001-0000-4000-8000-000000000004 | 390x844 | blocked_or_denied | NCTC demo workspace | RTP cycle and chapter visible | Cycle detail/document flow | Route did not render an authorized workspace state. | No screenshot captured. |
| - | /admin | 390x844 | blocked_or_denied | Authenticated operator workspace | Admin route reachable | Admin module surface | Route did not render an authorized workspace state. | No screenshot captured. |
| docs/ops/2026-04-29-test-output/ui-ux-settle/pilot-readiness--mobile--local-doc-status.png | /admin/pilot-readiness | 390x844 | captured | Authenticated operator workspace | Local proof docs visible as readiness inputs | Readiness status list | - | Captured populated/authenticated local route state. |

