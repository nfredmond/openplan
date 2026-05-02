# OpenPlan Local Phase 1 Spine Smoke - 2026-05-02

## Local Targets
- App URL: http://localhost:3000
- Supabase URL: http://127.0.0.1:54321
- Local guard result: Local guard passed for local Phase 1 spine smoke: app=http://localhost:3000, supabase=http://127.0.0.1:54321.

## Mutation Summary
- Refreshed the deterministic NCTC seed, scoped one deterministic local QA user to the NCTC workspace, and created one fresh project-targeted analysis_summary report with two report_run links.

## Cleanup / Idempotency Posture
- Before creating the report, the harness deletes prior harness-owned reports whose title starts with `NCTC Phase 1 Spine Smoke` in the deterministic NCTC workspace/project, plus their report artifacts, sections, and report_run links.
- Cleanup removed 2 report(s), 0 artifact(s), 10 section(s), and 4 report_run link(s).
- The NCTC seed and QA membership are deterministic; the only fresh harness residue after a successful run is the current proof report and screenshots.

## Key IDs
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
- Project-targeted report id: f7c6008b-f2b4-4e16-8e2d-730eaf2f7d8f
- Report run link ids: da0dda2c-4fa9-4472-b61c-79b285ede2ee, d8dd3cfa-3490-46b4-9538-5a50233f0ca8
- Data dataset ids: d0000001-0000-4000-8000-000000000051, d0000001-0000-4000-8000-000000000052, d0000001-0000-4000-8000-000000000053
- Project corridor ids: d0000001-0000-4000-8000-00000000000e, d0000001-0000-4000-8000-00000000000f
- Aerial mission ids: d0000001-0000-4000-8000-000000000008, d0000001-0000-4000-8000-000000000009, d0000001-0000-4000-8000-00000000000a
- Aerial evidence package ids: d0000001-0000-4000-8000-00000000000b, d0000001-0000-4000-8000-00000000000c, d0000001-0000-4000-8000-00000000000d

## Pass/Fail Notes
- PASS: Local guard passed for local Phase 1 spine smoke: app=http://localhost:3000, supabase=http://127.0.0.1:54321.
- PASS: Ran pnpm seed:nctc and the deterministic NCTC fixture completed.
- PASS: Removed 2 prior spine-smoke report(s), 0 artifact(s), 10 section(s), and 4 report-run link(s) before creating the fresh report.
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
- 2026-05-02-local-spine-smoke-01-project-detail.png
- 2026-05-02-local-spine-smoke-02-report-detail.png

## Verdict
- PASS: Local API/rendered smoke confirms project_id d0000001-0000-4000-8000-000000000003 is reused across RTP, grants, engagement, analysis/scenario runs, county-run modeling evidence, project-targeted report/report_runs, Data Hub, map corridor rows, aerial missions, and aerial evidence packages without creating a duplicate project.
