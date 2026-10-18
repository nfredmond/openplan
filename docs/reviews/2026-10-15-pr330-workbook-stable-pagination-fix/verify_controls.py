"""Focused synthetic controls. Run inside the owned locked, bounded check service."""
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]
APP = ROOT / 'openplan'
ROUTE = APP / 'src/app/api/projects/export/workbook/route.ts'
PAGINATION = APP / 'src/test/project-workbook-export-pagination.test.ts'
LEGACY = APP / 'src/test/project-portfolio-export-route.test.ts'
FILES = [ROUTE, PAGINATION, LEGACY]
OUT = Path(sys.argv[1]).resolve()
RESUME = sys.argv[2:] == ['--resume']
CONFIG = OUT / 'vitest.config.mts'
DOM_CONFIG = OUT / 'vitest-dom.config.mts'
PTEST = str(PAGINATION.relative_to(APP))
LTEST = str(LEGACY.relative_to(APP))
COHORT = [PTEST, LTEST, 'src/test/portfolio-workbook-export.test.ts']


def classify(report, code, expected, marker=None):
    if report.get('numRuntimeErrorTestSuites', 0) or report.get('unhandledErrors', []):
        raise ValueError('runtime or unhandled error')
    suites = report.get('testResults', [])
    if not suites or any(s.get('message') for s in suites):
        raise ValueError('missing suite or suite error')
    active = [(Path(s['name']).name, a) for s in suites for a in s['assertionResults']
              if a['status'] not in ('pending', 'skipped')]
    actual = {(file, a['fullName']) for file, a in active}
    if actual != expected or len(active) != len(expected):
        raise ValueError('wrong test identity or count')
    failed = [a for _, a in active if a['status'] == 'failed']
    if marker is None:
        if code or not report['success'] or failed or report['numFailedTests'] or any(a['status'] != 'passed' for _, a in active):
            raise ValueError('positive did not pass')
        return 'SURVIVED'
    if code != 1 or report['success'] or report['numFailedTests'] != 1 or len(failed) != 1:
        raise ValueError('not one assertion failure')
    messages = failed[0]['failureMessages']
    if len(messages) != 1 or not messages[0].startswith('AssertionError:') or marker not in messages[0]:
        raise ValueError('wrong assertion diagnostic')
    return 'KILLED'


def run(label, files, expected, marker=None, name=None, dom=False):
    report_path = OUT / (label + '.json')
    log_path = OUT / (label + '.log')
    if report_path.exists() or log_path.exists():
        raise ValueError('preserve existing trial: ' + label)
    cmd = ['node', 'node_modules/vitest/vitest.mjs', 'run', *files,
           '--config', str(DOM_CONFIG if dom else CONFIG), '--configLoader', 'runner',
           '--maxWorkers', '1', '--no-file-parallelism', '--reporter=json', '--outputFile', str(report_path)]
    if name:
        cmd += ['-t', '^' + re.escape(name) + '$']
    result = subprocess.run(cmd, cwd=APP, env=dict(os.environ, NODE_OPTIONS='--max-old-space-size=1024'),
                            text=True, capture_output=True, timeout=90)
    log_path.write_text(result.stdout + result.stderr)
    report = json.loads(report_path.read_text())
    (OUT / (label + '.process.json')).write_text(json.dumps({'exitCode': result.returncode}) + '\n')
    status = classify(report, result.returncode, expected, marker)
    record = {'trial': label, 'classification': status, 'exitCode': result.returncode,
              'activeTests': len(expected), 'assertion': marker,
              'reportSha256': hashlib.sha256(report_path.read_bytes()).hexdigest()}
    print(json.dumps(record), flush=True)
    return record, report


Q = 'every page must retain workspace projection ID cursor and bounded limit'
LQ = 'every legacy read must preserve projection scope ID cursor and limit'
CASES = [
    ('complete', PTEST, 'exports all 2000 projects through the configured row cap with original workbook values',
     'complete workbook must preserve all original rows and literal metadata', ROUTE,
     'projects.push(...page);', 'projects.push(...page); if (projects.length === 1000) break;'),
    ('projection', PTEST, 'scopes and projects every ordered page for a read-only workspace member', Q, ROUTE,
     '  "summary",\n', ''),
    ('workspace', PTEST, 'scopes and projects every ordered page for a read-only workspace member', Q, ROUTE,
     '.eq("workspace_id", membership.workspace_id)', '.eq("workspace_id", user.id)'),
    ('cursor-column', PTEST, 'scopes and projects every ordered page for a read-only workspace member', Q, ROUTE,
     'query.gt("id", lastId)', 'query.gt("updated_at", lastId)'),
    ('cursor-order', PTEST, 'scopes and projects every ordered page for a read-only workspace member', Q, ROUTE,
     '.order("id", { ascending: true })', '.order("id", { ascending: false })'),
    ('plus-one', PTEST, 'scopes and projects every ordered page for a read-only workspace member', Q, ROUTE,
     'PORTFOLIO_IMPORT_MAX_ROWS + 1 - projects.length', 'PORTFOLIO_IMPORT_MAX_ROWS - projects.length'),
    ('short-page', PTEST, 'continues after a short capped page until the scoped portfolio is exhausted',
     'short server pages must not truncate the workbook', ROUTE,
     'projects.push(...page);', 'projects.push(...page); if (page.length < pageSize) break;'),
    ('over-limit', PTEST, 'refuses 2001 projects explicitly instead of generating a partial workbook',
     'over-limit portfolio must refuse before creating a workbook', ROUTE,
     'if (projects.length > PORTFOLIO_IMPORT_MAX_ROWS) {', 'projects.splice(PORTFOLIO_IMPORT_MAX_ROWS);\n    if (projects.length > PORTFOLIO_IMPORT_MAX_ROWS) {'),
    ('late-error', PTEST, 'refuses a later page error instead of exporting the earlier rows',
     'later page read failure must not export a partial workbook', ROUTE,
     'if (result.error || !result.data) {', 'if (result.error || !result.data) { if (projects.length) break;'),
    ('unavailable', PTEST, 'keeps an unavailable page distinct from an empty portfolio',
     'unavailable data must not become a successful empty page', ROUTE,
     'if (result.error || !result.data) {', 'if (result.error || !result.data) { if (projects.length) break;'),
    ('empty', PTEST, 'exports a genuinely empty portfolio with the original workbook headers',
     'empty successful read must still export the workbook', ROUTE,
     'if (page.length === 0) break;', 'if (page.length === 0 && projects.length === 0) return NextResponse.json({}, { status: 500 }); if (page.length === 0) break;'),
    ('anonymous', PTEST, 'stops anonymous callers before membership or project reads',
     'anonymous caller must stop before portfolio access', ROUTE,
     'if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });', 'if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 200 });'),
    ('membership', PTEST, 'stops callers without active membership before project reads',
     'missing membership must stop before portfolio access', ROUTE,
     'return NextResponse.json({ error: "Workspace not found" }, { status: 404 });', 'return NextResponse.json({ error: "Workspace not found" }, { status: 200 });'),
    ('old-offset', PTEST, 'retains each project exactly once when an unread project is updated between pages',
     'mutable update must not omit or duplicate a project', ROUTE,
     '''        .order("id", { ascending: true });
      if (lastId !== null) query = query.gt("id", lastId);
      const result = await query.limit(Math.min(pageSize, PORTFOLIO_IMPORT_MAX_ROWS + 1 - projects.length));''',
     '''        .order("updated_at", { ascending: false }).order("id", { ascending: true });
      const result = await query.range(projects.length, Math.min(projects.length + pageSize - 1, PORTFOLIO_IMPORT_MAX_ROWS));'''),
    ('presentation', PTEST, 'sorts presentation by timestamp instant and breaks ties by ID after cursor reads',
     'presentation must use descending instants and ascending IDs for ties', ROUTE,
     'return milliseconds || submillisecond(right.updated_at) - submillisecond(left.updated_at)',
     'return -milliseconds || submillisecond(right.updated_at) - submillisecond(left.updated_at)'),
    ('microseconds', PTEST, 'sorts presentation by timestamp instant and breaks ties by ID after cursor reads',
     'presentation must use descending instants and ascending IDs for ties', ROUTE,
     'submillisecond(right.updated_at) - submillisecond(left.updated_at)', '0'),
    ('legacy-query', LTEST, 'GET /api/projects/export/workbook exports only the active workspace and allows read-only members', LQ, ROUTE,
     '  "summary",\n', ''),
    ('legacy-async', LTEST, 'GET /api/projects/export/workbook catches an asynchronous serializer failure before logging or sending a workbook',
     'async formatting failure is handled', ROUTE,
     'return NextResponse.json({ error: "Unexpected error while exporting the project portfolio" }, { status: 500 });',
     'return NextResponse.json({ error: "Unexpected error while exporting the project portfolio" }, { status: 200 });'),
    ('legacy-membership', LTEST, 'GET /api/projects/export/workbook stops before a project read when the user has no active workspace',
     'missing workspace must stop before reads', ROUTE,
     'return NextResponse.json({ error: "Workspace not found" }, { status: 404 });', 'return NextResponse.json({ error: "Workspace not found" }, { status: 200 });'),
    ('legacy-limit', LTEST, 'GET /api/projects/export/workbook refuses an over-limit portfolio instead of silently truncating it',
     'legacy over-limit export must refuse without a workbook', ROUTE,
     'if (projects.length > PORTFOLIO_IMPORT_MAX_ROWS) {', 'projects.splice(PORTFOLIO_IMPORT_MAX_ROWS);\n    if (projects.length > PORTFOLIO_IMPORT_MAX_ROWS) {'),
    ('legacy-year', LTEST, 'GET /api/projects/export/workbook exports and reimports a recorded cost with an unknown price year',
     'legacy round trip must preserve an unknown price year', ROUTE,
     '    const generatedAt = new Date();', '    projects.forEach(project => { project.estimated_cost_basis_year = 2026; });\n    const generatedAt = new Date();'),
    ('legacy-read-error', LTEST, 'GET /api/projects/export/workbook fails closed when the workspace-scoped read fails',
     'denied project read must fail without a workbook', ROUTE,
     'return NextResponse.json({ error: "Failed to read the project portfolio" }, { status: 500 });',
     'return NextResponse.json({ error: "Failed to read the project portfolio" }, { status: 200 });'),
    ('fake-cursor-corrected-diagnostic', PTEST, 'retains each project exactly once when an unread project is updated between pages',
     'expected 409 to be 200', PAGINATION,
     'String(row[key as keyof Row]) > value', 'String(row[key as keyof Row]) >= value'),
    ('legacy-fake-cursor', LTEST, 'GET /api/projects/export/workbook exports only the active workspace and allows read-only members',
     'viewer export must remain successful', LEGACY,
     'String(row[column]) > value', 'true'),
]


def main():
    baseline = {path: path.read_bytes() for path in FILES}
    controls = json.loads((OUT / 'partial-controls.json').read_text()) if RESUME else []
    if RESUME:
        restored = json.loads((OUT / 'initial-restoration.json').read_text())
        for path, content in baseline.items():
            receipt = restored[str(path.relative_to(ROOT))]
            if not receipt['restored'] or receipt['sha256'] != hashlib.sha256(content).hexdigest():
                raise ValueError('resume source differs from restored initial candidate')
    completed = {record['trial']: record for record in controls}
    try:
        positive = json.loads((OUT / 'candidate-dom-focused.json').read_text())
        identities = {(Path(s['name']).name, a['fullName']) for s in positive['testResults']
                      for a in s['assertionResults']}
        if len(identities) != 24:
            raise ValueError('expected exactly 24 baseline identities')
        classify(positive, 0, identities)
        route_identities = {(file, name) for file, name in identities if file != 'portfolio-workbook-export.test.ts'}
        if RESUME:
            receipt = completed['harmless-cohort']
            harmless = OUT / 'harmless-cohort.json'
            if hashlib.sha256(harmless.read_bytes()).hexdigest() != receipt['reportSha256']:
                raise ValueError('changed survivor report')
            classify(json.loads(harmless.read_text()), receipt['exitCode'], route_identities)
        else:
            ROUTE.write_bytes(baseline[ROUTE] + b'\n// Harmless pagination control.\n')
            survivor, _ = run('harmless-cohort', [PTEST, LTEST], route_identities)
            controls.append(survivor)
            ROUTE.write_bytes(baseline[ROUTE])
        for label, test, name, marker, path, before, after in CASES:
            if label in completed:
                receipt = completed[label]
                raw = OUT / (label + '.json')
                if hashlib.sha256(raw.read_bytes()).hexdigest() != receipt['reportSha256']:
                    raise ValueError('changed accepted trial: ' + label)
                classify(json.loads(raw.read_text()), receipt['exitCode'], {(Path(test).name, name)}, marker)
                continue
            original = baseline[path]
            source = original.decode()
            if source.count(before) != 1:
                raise ValueError('nonunique mutation: ' + label)
            try:
                path.write_text(source.replace(before, after, 1))
                record, killed = run(label, [test], {(Path(test).name, name)}, marker, name)
                controls.append(record)
            finally:
                path.write_bytes(original)
                if path.read_bytes() != original:
                    raise ValueError('restoration failed: ' + label)
            (OUT / 'partial-controls.json').write_text(json.dumps(controls, indent=2) + '\n')
        refusals = []
        expected = {(Path(test).name, name)}
        for label in ['runtime', 'suite-error', 'empty', 'wrong-test', 'wrong-file', 'wrong-assertion', 'wrong-code', 'extra-failure']:
            report = copy.deepcopy(killed)
            code = 1
            if label == 'runtime': report['numRuntimeErrorTestSuites'] = 1
            elif label == 'suite-error': report['testResults'][0]['message'] = 'import failed'
            elif label == 'empty': report['testResults'] = []
            elif label == 'wrong-test':
                for suite in report['testResults']:
                    for a in suite['assertionResults']:
                        if a['status'] == 'failed': a['fullName'] = 'other'
            elif label == 'wrong-file': report['testResults'][0]['name'] = '/other.test.ts'
            elif label == 'wrong-assertion':
                for suite in report['testResults']:
                    for a in suite['assertionResults']:
                        if a['status'] == 'failed': a['failureMessages'] = ['AssertionError: other']
            elif label == 'wrong-code': code = 2
            elif label == 'extra-failure': report['numFailedTests'] = 2
            try:
                classify(report, code, expected, marker)
            except ValueError as error:
                refusals.append({'case': label, 'classification': 'REFUSED', 'reason': str(error)})
            else:
                raise AssertionError('classifier accepted ' + label)
        restored, _ = run('restored-cohort', COHORT, identities, dom=True)
        controls.append(restored)
        (OUT / 'controls.json').write_text(json.dumps({'trials': controls, 'classifierRefusals': refusals}, indent=2) + '\n')
    finally:
        for path, content in baseline.items(): path.write_bytes(content)
        cgroup = Path('/proc/self/cgroup').read_text().strip().split('::')[-1]
        base = Path('/sys/fs/cgroup' + cgroup)
        resources = {name: (base / name).read_text().strip() for name in
                     ('memory.max', 'memory.swap.max', 'memory.peak', 'memory.events')}
        (OUT / 'control-resources.json').write_text(json.dumps(resources, indent=2) + '\n')
        (OUT / 'restoration.json').write_text(json.dumps({str(path.relative_to(ROOT)): {
            'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'restored': path.read_bytes() == content}
            for path, content in baseline.items()}, indent=2) + '\n')


if __name__ == '__main__': main()
