"""Serial, source-restoring controls for the bounded unconfirmed-import claim."""
import copy
import hashlib
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[3]
APP = ROOT / 'openplan'
OUT = Path(__file__).resolve().parent / 'evidence'
ROUTE = APP / 'src/app/api/projects/import/route.ts'
LIB = APP / 'src/lib/projects/portfolio-import.ts'
TEST = 'src/test/project-portfolio-import-route.test.ts'
NAME = 'reports an unconfirmed commit and rechecks prior creations before retrying'
FULL_NAME = 'POST /api/projects/import ' + NAME
MESSAGE = 'The portfolio import result could not be confirmed. Review selections again before retrying; rows already created from this source will be locked to skip.'
OLD_MESSAGE = 'The portfolio import transaction failed. No projects or import batch were saved.'


def classify(report, code, marker=None, full_name=FULL_NAME):
    assertions = [a for r in report['testResults'] for a in r['assertionResults']]
    if len(assertions) != 1 or assertions[0]['fullName'] != full_name:
        raise ValueError('wrong test identity or count')
    a = assertions[0]
    if marker is None:
        if code != 0 or not report['success'] or a['status'] != 'passed' or report['numFailedTests'] != 0:
            raise ValueError('positive trial did not pass')
        return 'SURVIVED'
    if code != 1 or report['success'] or report['numFailedTests'] != 1 or a['status'] != 'failed':
        raise ValueError('not exactly one assertion failure')
    messages = a['failureMessages']
    if len(messages) != 1 or marker not in messages[0] or 'AssertionError:' not in messages[0]:
        raise ValueError('wrong assertion diagnostic')
    return 'KILLED'


def run(label, marker=None, name=NAME):
    report_path = OUT / f'{label}.json'
    cmd = ['node', 'node_modules/vitest/vitest.mjs', 'run', TEST,
           '--config', '.portfolio-intake-qa/vitest.config.mts', '--configLoader', 'runner',
           '--maxWorkers', '1', '--no-file-parallelism', '-t', name,
           '--reporter=json', '--outputFile', str(report_path)]
    env = dict(os.environ, NODE_OPTIONS='--max-old-space-size=640')
    result = subprocess.run(cmd, cwd=APP, env=env, text=True, capture_output=True, timeout=60)
    (OUT / f'{label}.log').write_text(result.stdout + result.stderr)
    report = json.loads(report_path.read_text())
    # Vitest includes skipped cases in assertionResults. Require exactly the
    # named active test and classify it without treating skips as successes.
    active = copy.deepcopy(report)
    for suite in active['testResults']:
        suite['assertionResults'] = [a for a in suite['assertionResults'] if a['status'] not in ('pending', 'skipped')]
    classification = classify(active, result.returncode, marker, 'POST /api/projects/import ' + name)
    return {'trial': label, 'classification': classification, 'exitCode': result.returncode,
            'assertion': marker, 'test': name, 'report': report_path.name}, active


def replace_once(path, before, after):
    source = path.read_text()
    if source.count(before) != 1:
        raise ValueError(f'mutation binding is not unique: {path.name}')
    path.write_text(source.replace(before, after, 1))


def main():
    OUT.mkdir(exist_ok=True)
    config_dir = APP / '.portfolio-intake-qa'
    config_dir.mkdir(exist_ok=True)
    config = (APP / 'vitest.config.ts').read_text()
    config = config.replace("path.resolve(__dirname, './src')", "path.resolve(process.cwd(), './src')")
    config = config.replace('  plugins: [react()],', "  cacheDir: path.resolve(process.cwd(), '.portfolio-intake-qa/vite-cache'),\n  plugins: [react()],")
    config = config.replace("    environment: 'jsdom',", "    cache: false,\n    maxWorkers: 1,\n    maxConcurrency: 1,\n    environment: 'jsdom',")
    config = config.replace('fileParallelism: !liveRls,', 'fileParallelism: false,')
    (config_dir / 'vitest.config.mts').write_text(config)
    originals = {path: path.read_bytes() for path in (ROUTE, LIB)}
    trials = []
    try:
        result, positive = run('baseline'); trials.append(result)
        ROUTE.write_bytes(originals[ROUTE] + b'\n// Harmless portfolio intake control.\n')
        result, _ = run('harmless'); trials.append(result)
        ROUTE.write_bytes(originals[ROUTE])
        replace_once(ROUTE, MESSAGE, OLD_MESSAGE)
        result, killed = run('false-rollback', 'unconfirmed commit must direct re-review without claiming rollback'); trials.append(result)
        ROUTE.write_bytes(originals[ROUTE])
        replace_once(LIB, 'const previouslyCreatedProjectId = priorByIdentity.get(', 'const previouslyCreatedProjectId = new Map<string, string>().get(')
        result, _ = run('lost-prior-identity', 're-review must lock a previously created source row'); trials.append(result)
        LIB.write_bytes(originals[LIB])
        replace_once(ROUTE, '.select("source_sha256, worksheet_index, source_row_number, row_fingerprint, created_project_id")', '.select("source_sha256, worksheet_index, source_row_number, row_fingerprint")')
        result, _ = run('missing-prior-projection', 'retry query must select the complete prior-creation identity'); trials.append(result)
        ROUTE.write_bytes(originals[ROUTE])
        result, _ = run('restored'); trials.append(result)
        pagination_trials = [
            ('project-tail', 'checks project name matches beyond the database row cap', 'project beyond row cap must require individual name confirmation', 'offset += page.length;', 'return { data: rows, error: null };'),
            ('prior-tail', 'locks every previously created source row beyond the database row cap', 'retry must recover all source rows beyond row cap', 'offset += page.length;', 'return { data: rows, error: null };'),
            ('project-projection', 'checks project name matches beyond the database row cap', 'project duplicate projection must include name and identity', '.select("id, name")', '.select("id")'),
            ('project-order', 'checks project name matches beyond the database row cap', 'project duplicate pages must use stable identity order', '          .order("id", { ascending: true }).range(from, to)),', '          .range(from, to)),'),
            ('prior-projection', 'locks every previously created source row beyond the database row cap', 'prior duplicate projection must retain full source identity', '.select("source_sha256, worksheet_index, source_row_number, row_fingerprint, created_project_id")', '.select("source_sha256, worksheet_index, source_row_number, row_fingerprint")'),
            ('prior-order', 'locks every previously created source row beyond the database row cap', 'prior duplicate pages must use stable identity order', '\n        .order("id", { ascending: true }).range(from, to)),', '\n        .range(from, to)),'),
            ('late-page-error', 'stops the review when a later duplicate page fails', 'later duplicate-page failure must stop the review', 'if (result.error) return { data: [], error: result.error };', 'if (result.error) return { data: rows, error: null };'),
        ]
        for label, name, marker, before, after in pagination_trials:
            result, _ = run(label + '-positive', name=name); trials.append(result)
            ROUTE.write_bytes(originals[ROUTE] + b'\n// Harmless pagination control.\n')
            result, _ = run(label + '-harmless', name=name); trials.append(result)
            ROUTE.write_bytes(originals[ROUTE])
            replace_once(ROUTE, before, after)
            result, _ = run(label, marker, name); trials.append(result)
            ROUTE.write_bytes(originals[ROUTE])
            result, _ = run(label + '-restored', name=name); trials.append(result)

        refusals = []
        for label in ('startup', 'wrong-name', 'wrong-assertion', 'extra-failure'):
            candidate = copy.deepcopy(killed)
            code = 1
            if label == 'startup': candidate['testResults'] = []
            elif label == 'wrong-name': candidate['testResults'][0]['assertionResults'][0]['fullName'] = 'unrelated test'
            elif label == 'wrong-assertion': candidate['testResults'][0]['assertionResults'][0]['failureMessages'] = ['AssertionError: unrelated assertion']
            else: candidate['numFailedTests'] = 2
            try:
                classify(candidate, code, 'unconfirmed commit must direct re-review without claiming rollback')
            except ValueError as error:
                refusals.append({'case': label, 'result': 'REFUSED', 'reason': str(error)})
            else:
                raise AssertionError(f'classifier accepted {label}')
        (OUT / 'controls.json').write_text(json.dumps({'trials': trials, 'classifierRefusals': refusals}, indent=2) + '\n')
    finally:
        for path, original in originals.items():
            path.write_bytes(original)
        (OUT / 'restoration.json').write_text(json.dumps({str(p.relative_to(ROOT)): {'sha256': hashlib.sha256(p.read_bytes()).hexdigest(), 'restored': p.read_bytes() == data} for p, data in originals.items()}, indent=2) + '\n')
    print(json.dumps({'trials': trials, 'classifierRefusals': refusals}, indent=2))


if __name__ == '__main__':
    main()
