"""Run focused report tests against harmless and targeted source changes on an owned checkout."""
import hashlib
import json
import os
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[3]
app = root / 'openplan'
evidence = Path(os.environ['OPENPLAN_REPORT_PAGE_EVIDENCE'])
evidence.mkdir(parents=True, exist_ok=True)
page = app / 'src/components/reports/specialized-report-page.tsx'
route = app / 'src/app/(app)/reports/[reportId]/page.tsx'
controls = app / 'src/components/reports/report-detail-controls.tsx'
originals = {p: p.read_text() for p in [page, route, controls]}
page_source = originals[page]
route_block = '''  const specializedReport = await loadSpecializedReportPage(supabase, report, user.id);
  if (specializedReport) return specializedReport;'''

cases = [
    ('baseline', page, None, None, None),
    ('harmless-comment', page, '// Only a retained export job', '// A retained export job', None),
    ('job-read-error-hidden', page, 'if (job.error) {', 'if (false) {', 'refuses the generic route on a failed job read'),
    ('legacy-job-absence-hidden', page, 'if (!job.data) return null;', 'if (false) return null;', 'keeps the legacy route'),
    ('job-workspace-scope-removed', page, '.eq("workspace_id", report.workspace_id)', '', 'scopes the real job'),
    ('campaign-projection-incomplete', page, '.select("id, title, project_id")', '.select("id, title")', 'scopes the real job'),
    ('project-projection-incomplete', page, '.select("id, name")', '.select("id")', 'only reads a project'),
    ('null-project-query', page, '!consultation.error && consultation.data?.project_id', '!consultation.error && consultation.data', 'uses the saved job before'),
    ('campaign-failure-hidden', page, '{consultation.error ? <p role="alert">', '{false ? <p role="alert">', 'unavailable campaign context; failed read=true'),
    ('project-failure-hidden', page, '{project?.error ? <p role="alert">', '{false ? <p role="alert">', 'unavailable project context; failed read=true'),
    ('report-file-scope-wrong', page, 'reportId={report.id}', 'reportId="wrong-report"', 'scopes the real job'),
    ('route-caller-removed', route, route_block, '', 'uses the saved job before'),
    ('metadata-mode-removed', page, '<ReportDetailControls metadataOnly', '<ReportDetailControls', 'metadata-only'),
    ('viewer-editing-allowed', page, 'canAccessWorkspaceAction("reports.write",', 'canAccessWorkspaceAction("reports.read",', 'viewer'),
    ('permission-failure-hidden', page, '{membership.error ? <p', '{false ? <p', 'failed'),
    ('membership-user-scope-removed', page, '.eq("user_id", userId)', '', 'scopes the real job'),
    ('membership-workspace-scope-removed', page, '.eq("workspace_id", report.workspace_id).eq("user_id", userId)', '.eq("user_id", userId)', 'scopes the real job'),
    ('membership-projection-removed', page, '.select("role")', '.select("id")', 'scopes the real job'),
    ('metadata-panels-exposed', controls, '{!metadataOnly ? <>', '{true ? <>', 'edits saved review metadata'),
    ('metadata-generate-exposed', controls, '{!metadataOnly ? <>\n          <label', '{true ? <>\n          <label', 'edits saved review metadata'),
    ('metadata-hidden-citations-sent', controls, '...(modelRunSelectionChanged ? { modelRunIds: selectedModelRunIds } : {})', '...({ modelRunIds: [] })', 'edits saved review metadata'),
    ('land-use-owner-removed' , page, 'if (report.land_use_plan_id) return <LandUsePlanReportPage report={report} />;', '', 'preserves the land-use report owner'),
]
results = []
try:
    for label, path, old, new, failure in cases:
        for p, source in originals.items():
            p.write_text(source)
        if old is not None:
            assert old in originals[path], f'Mutation source missing: {label}'
            path.write_text(originals[path].replace(old, new, 1))
        output = evidence / f'{label}.json'
        with (evidence / f'{label}.log').open('w') as log:
            result = subprocess.run(['npm', 'exec', '--', 'vitest', 'run', 'src/test/engagement-review-report-page.test.tsx', 'src/test/report-detail-controls.test.tsx', '--reporter=json', f'--outputFile={output}'], cwd=app, stdout=log, stderr=subprocess.STDOUT)
        report = json.loads(output.read_text())
        failed = [a['fullName'] for t in report['testResults'] for a in t['assertionResults'] if a['status'] == 'failed']
        passed = report['numPassedTests']
        expected = (result.returncode == 0 and passed == 24 and not failed) if failure is None else (result.returncode != 0 and any(failure in name for name in failed))
        results.append({'case': label, 'exit': result.returncode, 'testsPassed': passed, 'failedTests': failed, 'expectedOutcome': expected})
        print(label, expected, flush=True)
        assert expected, f'Unexpected outcome: {label}; inspect {output}'
finally:
    for p, source in originals.items():
        p.write_text(source)
    (evidence / 'results.json').write_text(json.dumps({'results': results, 'sources': {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest() for p in originals}, 'limits': ['Mocked reads assert projections and filters; they do not prove live RLS or browser delivery.', 'Retained file component is replaced in this page unit suite; real downloads require the separate browser journey.']}, indent=2) + '\n')
