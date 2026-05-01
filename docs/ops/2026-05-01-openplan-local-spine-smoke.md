# OpenPlan Local Phase 1 Spine Smoke - 2026-05-01

- Base URL: http://localhost:3000
- Supabase URL: http://127.0.0.1:54321
- QA user email: openplan-local-spine-smoke@natfordplanning.com
- QA user id: 8be10853-724d-4e02-8014-8afdeba15e50
- Workspace id: d0000001-0000-4000-8000-000000000001
- Project id: d0000001-0000-4000-8000-000000000003
- RTP cycle id: d0000001-0000-4000-8000-000000000004
- Project RTP link id: d0000001-0000-4000-8000-000000000006
- Program id: d0000001-0000-4000-8000-000000000016
- Funding opportunity ids: d0000001-0000-4000-8000-000000000018, d0000001-0000-4000-8000-000000000041
- Funding award id: d0000001-0000-4000-8000-000000000042
- Billing invoice id: d0000001-0000-4000-8000-000000000043
- Engagement campaign id: d0000001-0000-4000-8000-000000000010
- Engagement item ids: d0000001-0000-4000-8000-000000000011, d0000001-0000-4000-8000-000000000012, d0000001-0000-4000-8000-000000000013, d0000001-0000-4000-8000-000000000014
- Scenario set id: d0000001-0000-4000-8000-000000000030
- Scenario entry ids: d0000001-0000-4000-8000-000000000033, d0000001-0000-4000-8000-000000000034
- Linked run ids: d0000001-0000-4000-8000-000000000031, d0000001-0000-4000-8000-000000000032
- County run id: d0000001-0000-4000-8000-000000000005
- Project-targeted report id: c00db1b1-6cc3-43b8-98d4-143adfca754c
- Report run link ids: ab8a512f-4f91-40d2-a271-bf1525bdfda1, c53ec100-85e2-4fa5-bc79-530d2b86d0db
- Data dataset ids: d0000001-0000-4000-8000-000000000051, d0000001-0000-4000-8000-000000000052, d0000001-0000-4000-8000-000000000053
- Project corridor ids: d0000001-0000-4000-8000-00000000000e, d0000001-0000-4000-8000-00000000000f
- Aerial mission ids: d0000001-0000-4000-8000-000000000008, d0000001-0000-4000-8000-000000000009, d0000001-0000-4000-8000-00000000000a
- Aerial evidence package ids: d0000001-0000-4000-8000-00000000000b, d0000001-0000-4000-8000-00000000000c, d0000001-0000-4000-8000-00000000000d

## Pass/Fail Notes
- PASS: Ran pnpm seed:nctc and the deterministic NCTC fixture completed.
- PASS: Updated deterministic QA auth user openplan-local-spine-smoke@natfordplanning.com.
- PASS: Attached the QA user to the seeded NCTC demo workspace.
- PASS: Scoped the QA login to the NCTC workspace so current-workspace map APIs load the seeded spine.
- PASS: Verified the canonical NCTC project exists once in the seeded workspace.
- PASS: Signed into the local app through Playwright as the QA user.
- PASS: Verified current workspace selection resolves to the NCTC demo workspace.
- PASS: Verified map feature APIs expose the seeded project, RTP cycle, corridors, aerial AOIs, and engagement points.
- PASS: Created a project-targeted analysis_summary report through /api/reports.
- PASS: Rendered the seeded project detail surface with the shared project spine.
- PASS: Rendered the project-targeted report detail page with both seeded analysis runs linked.
- PASS: Verified RTP linkage reuses the canonical project_id.
- PASS: Verified grants funding profile, program, opportunities, award, and invoice all reuse the canonical project_id.
- PASS: Verified engagement campaign and items hang from the same project/RTP spine.
- PASS: Verified scenario runs, county run, and modeling evidence backbone rows share the seeded workspace/project spine.
- PASS: Verified the project-targeted report and report_runs preserve county-run and seeded run linkage.
- PASS: Verified Data Hub, corridor map, aerial mission, and aerial evidence rows all reuse the canonical project_id.

## Artifacts
- 2026-05-01-local-spine-smoke-01-project-detail.png
- 2026-05-01-local-spine-smoke-02-report-detail.png

## Verdict
- PASS: Local API/rendered smoke confirms project_id d0000001-0000-4000-8000-000000000003 is reused across RTP, grants, engagement, analysis/scenario runs, county-run modeling evidence, project-targeted report/report_runs, Data Hub, map corridor rows, aerial missions, and aerial evidence packages without creating a duplicate project.
