"""Serial bounded workbook controls; preserve every trial and restore exact bytes."""
import copy
import hashlib
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[3]
APP = ROOT / 'openplan'
HERE = Path(__file__).resolve().parent
OUT = HERE / 'evidence'
ROUTE = APP / 'src/app/api/projects/export/workbook/route.ts'
TEST = 'src/test/project-workbook-export-pagination.test.ts'


def classify(report, code, name, marker=None):
    if report.get('numRuntimeErrorTestSuites', 0) or report.get('unhandledErrors', []):
        raise ValueError('runtime or unhandled error')
    suites = report.get('testResults', [])
    if not suites or any(s.get('message') for s in suites):
        raise ValueError('empty selection or suite/import error')
    active = [a for s in suites for a in s.get('assertionResults', []) if a['status'] not in ('pending', 'skipped')]
    if len(active) != 1 or active[0]['fullName'] != name:
        raise ValueError('wrong test identity or active count')
    assertion = active[0]
    if marker is None:
        if code != 0 or not report['success'] or assertion['status'] != 'passed' or report['numFailedTests'] != 0:
            raise ValueError('positive did not pass')
        return 'SURVIVED'
    if code != 1 or report['success'] or report['numFailedTests'] != 1 or assertion['status'] != 'failed':
        raise ValueError('not one assertion failure')
    messages = assertion['failureMessages']
    if len(messages) != 1 or marker not in messages[0] or not messages[0].startswith('AssertionError:'):
        raise ValueError('wrong assertion diagnostic')
    return 'KILLED'


def run(label, name, marker=None):
    report_path = OUT / f'{label}.json'
    log_path = OUT / f'{label}.log'
    if report_path.exists() or log_path.exists():
        raise ValueError(f'preserve existing trial before rerun: {label}')
    cmd = ['node', 'node_modules/vitest/vitest.mjs', 'run', TEST, '--config',
           '.workbook-export-qa/vitest.config.mts', '--configLoader', 'runner',
           '--maxWorkers', '1', '--no-file-parallelism', '-t', '^' + name + '$',
           '--reporter=json', '--outputFile', str(report_path)]
    result = subprocess.run(cmd, cwd=APP, env=dict(os.environ, NODE_OPTIONS='--max-old-space-size=640'),
                            text=True, capture_output=True, timeout=60)
    log_path.write_text(result.stdout + result.stderr)
    report = json.loads(report_path.read_text())
    classification = classify(report, result.returncode, name, marker)
    return {'trial': label, 'test': name, 'classification': classification, 'exitCode': result.returncode,
            'assertion': marker, 'report': report_path.name}, report


CASES = [
    ('complete', 'exports all 2000 projects through the configured row cap with original workbook values',
     'complete workbook must preserve all original rows and literal metadata',
     'projects.push(...page);', 'projects.push(...page); if (projects.length === 1000) break;'),
    ('projection', 'scopes and projects every ordered page for a read-only workspace member',
     'every page must retain scope projection stable order and bounded ranges', '  "summary",\n', ''),
    ('scope', 'scopes and projects every ordered page for a read-only workspace member',
     'every page must retain scope projection stable order and bounded ranges',
     '.eq("workspace_id", membership.workspace_id)', '.eq("workspace_id", user.id)'),
    ('tie-order', 'scopes and projects every ordered page for a read-only workspace member',
     'every page must retain scope projection stable order and bounded ranges', '\n        .order("id", { ascending: true })', ''),
    ('date-order', 'scopes and projects every ordered page for a read-only workspace member',
     'every page must retain scope projection stable order and bounded ranges',
     '.order("updated_at", { ascending: false })', '.order("updated_at", { ascending: true })'),
    ('bounded-range', 'scopes and projects every ordered page for a read-only workspace member',
     'every page must retain scope projection stable order and bounded ranges',
     'Math.min(projects.length + pageSize - 1, PORTFOLIO_IMPORT_MAX_ROWS)', 'projects.length + pageSize - 1'),
    ('short-page', 'continues after a short capped page until the scoped portfolio is exhausted',
     'short server pages must not truncate the workbook',
     'projects.push(...page);', 'projects.push(...page); if (page.length < pageSize) break;'),
    ('over-limit', 'refuses 2001 projects explicitly instead of generating a partial workbook',
     'over-limit portfolio must refuse before creating a workbook',
     'if (projects.length > PORTFOLIO_IMPORT_MAX_ROWS) {',
     'projects.splice(PORTFOLIO_IMPORT_MAX_ROWS);\n    if (projects.length > PORTFOLIO_IMPORT_MAX_ROWS) {'),
    ('late-error', 'refuses a later page error instead of exporting the earlier rows',
     'later page read failure must not export a partial workbook',
     'if (result.error || !result.data) {', 'if (result.error || !result.data) {\n        if (projects.length > 0) break;'),
    ('unavailable', 'keeps an unavailable page distinct from an empty portfolio',
     'unavailable data must not become a successful empty page',
     'if (result.error || !result.data) {', 'if (result.error || !result.data) {\n        if (projects.length > 0) break;'),
    ('empty', 'exports a genuinely empty portfolio with the original workbook headers',
     'empty successful read must still export the workbook',
     'if (page.length === 0) break;',
     'if (page.length === 0 && projects.length === 0) return NextResponse.json({ error: "empty" }, { status: 500 });\n      if (page.length === 0) break;'),
    ('anonymous', 'stops anonymous callers before membership or project reads',
     'anonymous caller must stop before portfolio access',
     'if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });',
     'if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 200 });'),
    ('membership', 'stops callers without active membership before project reads',
     'missing membership must stop before portfolio access',
     'return NextResponse.json({ error: "Workspace not found" }, { status: 404 });',
     'return NextResponse.json({ error: "Workspace not found" }, { status: 200 });'),
]


def main():
    OUT.mkdir(exist_ok=True)
    config = APP / '.workbook-export-qa/vitest.config.mts'
    config.parent.mkdir(exist_ok=True)
    config.write_text("""import { defineConfig } from 'vitest/config';
import path from 'node:path';
export default defineConfig({
  cacheDir: path.resolve(process.cwd(), '.workbook-export-qa/vite-cache'),
  resolve: { alias: { '@': path.resolve(process.cwd(), 'src') } },
  test: { environment: 'node', maxWorkers: 1, maxConcurrency: 1, fileParallelism: false,
    cache: false, clearMocks: true, unstubEnvs: true, unstubGlobals: true },
});
""")
    original = ROUTE.read_bytes()
    trials = []
    try:
        for label, name, marker, before, after in CASES:
            record, _ = run(label + '-positive', name); trials.append(record)
            ROUTE.write_bytes(original + b'\n// Harmless workbook pagination control.\n')
            record, _ = run(label + '-harmless', name); trials.append(record)
            ROUTE.write_bytes(original)
            source = original.decode()
            if source.count(before) != 1:
                raise ValueError(f'nonunique mutation binding: {label}')
            ROUTE.write_text(source.replace(before, after, 1))
            record, killed = run(label + '-fault', name, marker); trials.append(record)
            ROUTE.write_bytes(original)
            record, _ = run(label + '-restored', name); trials.append(record)
            (OUT / 'partial-controls.json').write_text(json.dumps(trials, indent=2) + '\n')
        refusals = []
        for label in ['runtime', 'import', 'empty', 'wrong-test', 'wrong-assertion', 'wrong-code', 'extra-failure']:
            candidate = copy.deepcopy(killed)
            code = 1
            if label == 'runtime': candidate['numRuntimeErrorTestSuites'] = 1
            elif label == 'import': candidate['testResults'][0]['message'] = 'Error: failed to import'
            elif label == 'empty': candidate['testResults'] = []
            elif label == 'wrong-test': candidate['testResults'][0]['assertionResults'][-1]['fullName'] = 'other test'
            elif label == 'wrong-assertion':
                for a in candidate['testResults'][0]['assertionResults']:
                    if a['status'] == 'failed': a['failureMessages'] = ['AssertionError: other assertion']
            elif label == 'wrong-code': code = 2
            elif label == 'extra-failure': candidate['numFailedTests'] = 2
            try:
                classify(candidate, code, name, marker)
            except ValueError as error:
                refusals.append({'case': label, 'result': 'REFUSED', 'reason': str(error)})
            else:
                raise AssertionError(f'classifier accepted {label}')
        (OUT / 'controls.json').write_text(json.dumps({'trials': trials, 'classifierRefusals': refusals}, indent=2) + '\n')
        print(json.dumps({'trials': len(trials), 'kills': len(CASES), 'classifierRefusals': refusals}))
    finally:
        ROUTE.write_bytes(original)
        cgroup = Path('/proc/self/cgroup').read_text().strip().split('::')[-1]
        base = Path('/sys/fs/cgroup' + cgroup)
        resources = {name: (base / name).read_text().strip() for name in
                     ('memory.max', 'memory.swap.max', 'memory.peak', 'memory.events')}
        (OUT / 'controller-resources.json').write_text(json.dumps(resources, indent=2) + '\n')
        (OUT / 'restoration.json').write_text(json.dumps({str(ROUTE.relative_to(ROOT)): {
            'sha256': hashlib.sha256(ROUTE.read_bytes()).hexdigest(), 'restored': ROUTE.read_bytes() == original}}, indent=2) + '\n')


if __name__ == '__main__':
    main()
