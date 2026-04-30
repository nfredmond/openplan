# OpenPlan Local UI/UX Settle Capture Ledger

Generated: 2026-04-30T10:45:27.260Z
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
| captured | 38 |
| captured_watch | 2 |
| fixture_required | 6 |

## Ledger

| Screenshot | Route URL | Viewport | Status | Auth/workspace | Seed/demo state | Visible target | Missing dependency | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| docs/ops/2026-04-29-test-output/ui-ux-settle/dashboard--desktop--workspace-overview.png | /dashboard | 1440x1100 | captured | NCTC demo workspace | Command board and overview populated | Shell rails visible | - | Captured populated/authenticated local route state. |
| docs/ops/2026-04-29-test-output/ui-ux-settle/projects-index--desktop--nctc-project-visible.png | /projects | 1440x1100 | captured | NCTC demo workspace | NCTC project row visible | Registry/list worksurface | - | Captured populated/authenticated local route state. |
| docs/ops/2026-04-29-test-output/ui-ux-settle/project-detail--desktop--nctc-project.png | /projects/d0000001-0000-4000-8000-000000000003 | 1440x1100 | captured | NCTC demo workspace | NCTC project detail visible | Project posture/detail regions | - | Captured populated/authenticated local route state. |
| docs/ops/2026-04-29-test-output/ui-ux-settle/plans-index--desktop--nctc-plan-visible.png | /plans | 1440x1100 | captured | NCTC demo workspace | NCTC local proof plan visible | Plan registry/detail surface | - | Captured populated/authenticated local route state. |
| docs/ops/2026-04-29-test-output/ui-ux-settle/plan-detail--desktop--nctc-plan.png | /plans/d0000001-0000-4000-8000-000000000015 | 1440x1100 | captured | NCTC demo workspace | Linked NCTC local proof plan detail visible | Plan detail surface | - | Captured populated/authenticated local route state. |
| docs/ops/2026-04-29-test-output/ui-ux-settle/programs-index--desktop--nctc-program-visible.png | /programs | 1440x1100 | captured | NCTC demo workspace | NCTC programming pipeline visible | Program registry surface | - | Captured populated/authenticated local route state. |
| docs/ops/2026-04-29-test-output/ui-ux-settle/program-detail--desktop--nctc-program.png | /programs/d0000001-0000-4000-8000-000000000016 | 1440x1100 | captured | NCTC demo workspace | Linked NCTC program detail visible | Program detail/funding lane surface | - | Captured populated/authenticated local route state. |
| docs/ops/2026-04-29-test-output/ui-ux-settle/reports-index--desktop--nctc-report-visible.png | /reports | 1440x1100 | captured | NCTC demo workspace | NCTC report packet visible | Report registry surface | - | Captured populated/authenticated local route state. |
| docs/ops/2026-04-29-test-output/ui-ux-settle/report-detail--desktop--nctc-report.png | /reports/d0000001-0000-4000-8000-000000000019 | 1440x1100 | captured | NCTC demo workspace | NCTC report packet detail visible | Report detail/artifact state | - | Captured populated/authenticated local route state. |
| - | /scenarios | 1440x1100 | fixture_required | Workspace fixture TBD | Scenario set and entries required | Scenario registry surface | Local scenario fixture missing; do not use empty-state proof. | Local scenario fixture missing; do not use empty-state proof. |
| - | /scenarios/<local-scenario-set-id> | 1440x1100 | fixture_required | Workspace fixture TBD | Scenario comparison detail required | Scenario comparison surface | Local scenario detail fixture missing; do not use empty-state proof. | Local scenario detail fixture missing; do not use empty-state proof. |
| docs/ops/2026-04-29-test-output/ui-ux-settle/models-index--desktop--workspace-models.png | /models | 1440x1100 | captured | NCTC demo workspace | Modeling readiness/run history visible | Modeling workbench surface | - | Captured populated/authenticated local route state. |
| docs/ops/2026-04-29-test-output/ui-ux-settle/county-runs-index--desktop--workspace-runs.png | /county-runs | 1440x1100 | captured | NCTC demo workspace | County run registry visible | Run registry surface | - | Captured populated/authenticated local route state. |
| docs/ops/2026-04-29-test-output/ui-ux-settle/county-run-detail--desktop--nctc-run.png | /county-runs/d0000001-0000-4000-8000-000000000005 | 1440x1100 | captured | NCTC demo workspace | County run evidence visible | Run detail/evidence panel | - | Captured populated/authenticated local route state. |
| docs/ops/2026-04-29-test-output/ui-ux-settle/data-hub--desktop--workspace-data.png | /data-hub | 1440x1100 | captured_watch | NCTC demo workspace | Connector/dataset rows preferred | Data hub worksurface | Dataset fixture may be missing; record actual local state. | Dataset fixture may be missing; record actual local state. |
| docs/ops/2026-04-29-test-output/ui-ux-settle/explore-map--desktop--nctc-layers-ready.png | /explore | 1440x1100 | captured | NCTC demo workspace | Mapbox map and layers loaded | Map controls/inspector visible | - | Captured populated/authenticated local route state. |
| docs/ops/2026-04-29-test-output/ui-ux-settle/engagement-index--desktop--workspace-campaigns.png | /engagement | 1440x1100 | captured | NCTC demo workspace | NCTC engagement campaign visible | Engagement registry/workflow surface | - | Captured populated/authenticated local route state. |
| docs/ops/2026-04-29-test-output/ui-ux-settle/engagement-detail--desktop--nctc-campaign.png | /engagement/d0000001-0000-4000-8000-000000000010 | 1440x1100 | captured | NCTC demo workspace | Campaign and approved items visible | Campaign detail/workflow | - | Captured populated/authenticated local route state. |
| - | /grants | 1440x1100 | fixture_required | Workspace fixture TBD | Opportunity/award/reimbursement state required | Grants operating lanes | Local grants fixture missing; do not use empty-state proof. | Local grants fixture missing; do not use empty-state proof. |
| docs/ops/2026-04-29-test-output/ui-ux-settle/rtp-index--desktop--nctc-cycle-visible.png | /rtp | 1440x1100 | captured | NCTC demo workspace | NCTC RTP cycle visible | RTP registry/document flow | - | Captured populated/authenticated local route state. |
| docs/ops/2026-04-29-test-output/ui-ux-settle/rtp-detail--desktop--nctc-cycle.png | /rtp/d0000001-0000-4000-8000-000000000004 | 1440x1100 | captured | NCTC demo workspace | RTP cycle and chapter visible | Cycle detail/document flow | - | Captured populated/authenticated local route state. |
| docs/ops/2026-04-29-test-output/ui-ux-settle/admin-index--desktop--authenticated-admin.png | /admin | 1440x1100 | captured | Authenticated operator workspace | Admin route reachable | Admin module surface | - | Captured populated/authenticated local route state. |
| docs/ops/2026-04-29-test-output/ui-ux-settle/pilot-readiness--desktop--local-doc-status.png | /admin/pilot-readiness | 1440x1100 | captured | Authenticated operator workspace | Local proof docs visible as readiness inputs | Readiness status list | - | Captured populated/authenticated local route state. |
| docs/ops/2026-04-29-test-output/ui-ux-settle/dashboard--mobile--workspace-overview.png | /dashboard | 390x844 | captured | NCTC demo workspace | Command board and overview populated | Shell rails visible | - | Captured populated/authenticated local route state. |
| docs/ops/2026-04-29-test-output/ui-ux-settle/projects-index--mobile--nctc-project-visible.png | /projects | 390x844 | captured | NCTC demo workspace | NCTC project row visible | Registry/list worksurface | - | Captured populated/authenticated local route state. |
| docs/ops/2026-04-29-test-output/ui-ux-settle/project-detail--mobile--nctc-project.png | /projects/d0000001-0000-4000-8000-000000000003 | 390x844 | captured | NCTC demo workspace | NCTC project detail visible | Project posture/detail regions | - | Captured populated/authenticated local route state. |
| docs/ops/2026-04-29-test-output/ui-ux-settle/plans-index--mobile--nctc-plan-visible.png | /plans | 390x844 | captured | NCTC demo workspace | NCTC local proof plan visible | Plan registry/detail surface | - | Captured populated/authenticated local route state. |
| docs/ops/2026-04-29-test-output/ui-ux-settle/plan-detail--mobile--nctc-plan.png | /plans/d0000001-0000-4000-8000-000000000015 | 390x844 | captured | NCTC demo workspace | Linked NCTC local proof plan detail visible | Plan detail surface | - | Captured populated/authenticated local route state. |
| docs/ops/2026-04-29-test-output/ui-ux-settle/programs-index--mobile--nctc-program-visible.png | /programs | 390x844 | captured | NCTC demo workspace | NCTC programming pipeline visible | Program registry surface | - | Captured populated/authenticated local route state. |
| docs/ops/2026-04-29-test-output/ui-ux-settle/program-detail--mobile--nctc-program.png | /programs/d0000001-0000-4000-8000-000000000016 | 390x844 | captured | NCTC demo workspace | Linked NCTC program detail visible | Program detail/funding lane surface | - | Captured populated/authenticated local route state. |
| docs/ops/2026-04-29-test-output/ui-ux-settle/reports-index--mobile--nctc-report-visible.png | /reports | 390x844 | captured | NCTC demo workspace | NCTC report packet visible | Report registry surface | - | Captured populated/authenticated local route state. |
| docs/ops/2026-04-29-test-output/ui-ux-settle/report-detail--mobile--nctc-report.png | /reports/d0000001-0000-4000-8000-000000000019 | 390x844 | captured | NCTC demo workspace | NCTC report packet detail visible | Report detail/artifact state | - | Captured populated/authenticated local route state. |
| - | /scenarios | 390x844 | fixture_required | Workspace fixture TBD | Scenario set and entries required | Scenario registry surface | Local scenario fixture missing; do not use empty-state proof. | Local scenario fixture missing; do not use empty-state proof. |
| - | /scenarios/<local-scenario-set-id> | 390x844 | fixture_required | Workspace fixture TBD | Scenario comparison detail required | Scenario comparison surface | Local scenario detail fixture missing; do not use empty-state proof. | Local scenario detail fixture missing; do not use empty-state proof. |
| docs/ops/2026-04-29-test-output/ui-ux-settle/models-index--mobile--workspace-models.png | /models | 390x844 | captured | NCTC demo workspace | Modeling readiness/run history visible | Modeling workbench surface | - | Captured populated/authenticated local route state. |
| docs/ops/2026-04-29-test-output/ui-ux-settle/county-runs-index--mobile--workspace-runs.png | /county-runs | 390x844 | captured | NCTC demo workspace | County run registry visible | Run registry surface | - | Captured populated/authenticated local route state. |
| docs/ops/2026-04-29-test-output/ui-ux-settle/county-run-detail--mobile--nctc-run.png | /county-runs/d0000001-0000-4000-8000-000000000005 | 390x844 | captured | NCTC demo workspace | County run evidence visible | Run detail/evidence panel | - | Captured populated/authenticated local route state. |
| docs/ops/2026-04-29-test-output/ui-ux-settle/data-hub--mobile--workspace-data.png | /data-hub | 390x844 | captured_watch | NCTC demo workspace | Connector/dataset rows preferred | Data hub worksurface | Dataset fixture may be missing; record actual local state. | Dataset fixture may be missing; record actual local state. |
| docs/ops/2026-04-29-test-output/ui-ux-settle/explore-map--mobile--nctc-layers-ready.png | /explore | 390x844 | captured | NCTC demo workspace | Mapbox map and layers loaded | Map controls/inspector visible | - | Captured populated/authenticated local route state. |
| docs/ops/2026-04-29-test-output/ui-ux-settle/engagement-index--mobile--workspace-campaigns.png | /engagement | 390x844 | captured | NCTC demo workspace | NCTC engagement campaign visible | Engagement registry/workflow surface | - | Captured populated/authenticated local route state. |
| docs/ops/2026-04-29-test-output/ui-ux-settle/engagement-detail--mobile--nctc-campaign.png | /engagement/d0000001-0000-4000-8000-000000000010 | 390x844 | captured | NCTC demo workspace | Campaign and approved items visible | Campaign detail/workflow | - | Captured populated/authenticated local route state. |
| - | /grants | 390x844 | fixture_required | Workspace fixture TBD | Opportunity/award/reimbursement state required | Grants operating lanes | Local grants fixture missing; do not use empty-state proof. | Local grants fixture missing; do not use empty-state proof. |
| docs/ops/2026-04-29-test-output/ui-ux-settle/rtp-index--mobile--nctc-cycle-visible.png | /rtp | 390x844 | captured | NCTC demo workspace | NCTC RTP cycle visible | RTP registry/document flow | - | Captured populated/authenticated local route state. |
| docs/ops/2026-04-29-test-output/ui-ux-settle/rtp-detail--mobile--nctc-cycle.png | /rtp/d0000001-0000-4000-8000-000000000004 | 390x844 | captured | NCTC demo workspace | RTP cycle and chapter visible | Cycle detail/document flow | - | Captured populated/authenticated local route state. |
| docs/ops/2026-04-29-test-output/ui-ux-settle/admin-index--mobile--authenticated-admin.png | /admin | 390x844 | captured | Authenticated operator workspace | Admin route reachable | Admin module surface | - | Captured populated/authenticated local route state. |
| docs/ops/2026-04-29-test-output/ui-ux-settle/pilot-readiness--mobile--local-doc-status.png | /admin/pilot-readiness | 390x844 | captured | Authenticated operator workspace | Local proof docs visible as readiness inputs | Readiness status list | - | Captured populated/authenticated local route state. |

