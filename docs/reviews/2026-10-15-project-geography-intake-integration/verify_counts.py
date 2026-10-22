"""Assert the joined cohort's file identities, complete execution and actual counts."""
import copy
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
EXPECTED = {
    'geometry-bbox.test.ts': 16, 'jurisdiction-readiness-evidence-bundle.test.ts': 3,
    'jurisdiction-readiness-routes.test.ts': 7, 'portfolio-import-review.test.ts': 12,
    'portfolio-price-year.test.ts': 11, 'portfolio-workbook-export.test.ts': 5,
    'portfolio-workbook-import.test.ts': 16, 'project-detail-page.test.tsx': 67,
    'project-evidence-bundle-route.test.ts': 15, 'project-evidence-generated-pagination.test.ts': 5,
    'project-geography-upload.test.tsx': 8, 'project-geopackage-reachability.test.tsx': 2,
    'project-geopackage-route.test.ts': 5, 'project-geopackage.test.ts': 3,
    'project-identity-editor.test.tsx': 18, 'project-jurisdiction-artifacts.test.ts': 2,
    'project-jurisdiction-editor.test.tsx': 17, 'project-jurisdiction-export-corrections.test.ts': 2,
    'project-jurisdiction-picker.test.tsx': 1, 'project-jurisdiction-route.test.ts': 9,
    'project-jurisdiction.test.ts': 7, 'project-map-presence-routes.test.ts': 20,
    'project-portfolio-export-route.test.ts': 5, 'project-portfolio-import-route.test.ts': 15,
    'project-portfolio-importer.test.tsx': 3, 'project-record-route.test.ts': 18,
    'project-saved-map.test.tsx': 23, 'project-workbook-export-pagination.test.ts': 9,
    'refused-project-jurisdiction-action.test.ts': 1, 'refused-project-portfolio-import-action.test.ts': 3,
    'report-generate-route.test.ts': 72, 'saved-geometry-frame.test.ts': 10,
    'study-area-picker.test.tsx': 5, 'wgs84-bounds.test.ts': 11,
}

def check(report):
    assert (report.get('success') is True and report.get('numTotalTests') == 426
            and report.get('numPassedTests') == 426 and report.get('numFailedTests') == 0
            and report.get('numPendingTests') == 0 and report.get('numTodoTests') == 0
            and not report.get('numRuntimeErrorTestSuites') and not report.get('unhandledErrors')
            and not report.get('errors')), 'combined summary must declare 426 passed and zero omitted or failed cases'
    suites = report.get('testResults', [])
    assert len(suites) == 34 and sorted(s['name'] for s in suites) == sorted(str(ROOT / 'openplan/src/test' / p) for p in EXPECTED), 'combined files must match the 34 identified suites'
    assert all(len(s['assertionResults']) == EXPECTED[Path(s['name']).name] for s in suites), 'combined per-file counts must match all 426 assertions'
    assert all(t['status'] == 'passed' and not t.get('failureMessages') for s in suites for t in s['assertionResults']), 'combined assertions must all pass without diagnostics'

report = json.loads((HERE / 'evidence/combined-01/tests.json').read_text())
check(report)
rows = []
for key, diagnostic in [
    ('summary', 'combined summary must declare 426 passed and zero omitted or failed cases'),
    ('file', 'combined files must match the 34 identified suites'),
    ('case', 'combined per-file counts must match all 426 assertions'),
    ('status', 'combined assertions must all pass without diagnostics'),
]:
    harmless = copy.deepcopy(report); harmless['integrationControlComment'] = 'harmless'; check(harmless)
    fault = copy.deepcopy(report)
    if key == 'summary': fault['numPassedTests'] -= 1
    elif key == 'file': fault['testResults'][0]['name'] += '.wrong'
    elif key == 'case': fault['testResults'][0]['assertionResults'].pop()
    else: fault['testResults'][0]['assertionResults'][0]['status'] = 'skipped'
    try:
        check(fault)
    except AssertionError as error:
        if str(error) != diagnostic: raise
        rows.append({'guard': key, 'harmless': 'survived', 'targetedFailure': str(error)})
    else:
        raise RuntimeError('Count guard fault survived: ' + key)
check(report)
(HERE / 'evidence/counts.json').write_text(json.dumps({'files': EXPECTED, 'total': 426, 'importSubtotal': 49, 'exportSubtotal': 19, 'priceYearSubtotal': 11, 'combinedWorkbookSubtotal': 79, 'guardControls': rows}, indent=2) + '\n')
print('426 passed across 34 identified files; workbook subset 49 + 19 + 11 = 79; four harmless survivors and four intended count faults')
