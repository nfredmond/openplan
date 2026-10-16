"""Review exact Git objects in a disposable copy. Run inside the documented scope."""
import copy
import argparse
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
OUT = HERE / 'evidence'
HEAD = '54537205a4f7c47f1f68f0827209bbf55de505d9'
PARENT = '702ee1270de23cb9e469711398c580d9a977878b'
BASE = 'b259d73e56d22d4935ef2789874cf69901786b33'
ROUTE = 'openplan/src/app/api/projects/export/workbook/route.ts'
LEGACY = 'openplan/src/test/project-portfolio-export-route.test.ts'
PAG = 'docs/reviews/2026-10-15-project-workbook-export-pagination'
INT = 'docs/reviews/2026-10-15-project-workbook-export-integration'
COUNTS = dict(zip(['project-portfolio-export-route.test.ts', 'project-workbook-export-pagination.test.ts',
    'portfolio-workbook-export.test.ts', 'portfolio-price-year.test.ts', 'portfolio-import-review.test.ts',
    'portfolio-workbook-import.test.ts', 'project-portfolio-import-route.test.ts',
    'project-portfolio-importer.test.tsx', 'refused-project-portfolio-import-action.test.ts'], [5, 9, 5, 11, 12, 16, 11, 3, 3]))


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)


def blob(path, commit=HEAD):
    return git('show', commit + ':' + path)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def save(name, value):
    with (OUT / name).open('x') as stream:
        json.dump(value, stream, indent=2)
        stream.write('\n')


def load_module(path):
    spec = importlib.util.spec_from_file_location('reviewed_controller', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def evidence_audit(private):
    ctrl = load_module(private / INT / 'verify_controls.py')
    accepted = []
    groups = {}
    refused = []
    for folder in ['', 'continuation/']:
        source = private / INT / 'evidence' / folder
        for trial in json.loads((source / 'controls.json').read_text()):
            report = json.loads((source / (trial['trial'] + '.json')).read_text())
            ctrl.APP = Path('/home/nathaniel/.t3/worktrees/openplan/t3-32433c82/openplan')
            try:
                result = ctrl.classify(report, trial['exitCode'], trial['testFile'], trial['test'], trial['marker'])
            except ValueError as error:
                assert trial['classification'] == 'REFUSED' and trial['exitCode'] == 0
                assert trial['trial'] == 'legacy-fake-inclusive-range-fault'
                refused.append({'trial': trial['trial'], 'reason': str(error), 'actualPassed': report['numPassedTests']})
                continue
            assert result == trial['classification']
            accepted.append(trial['trial'])
            label, phase = trial['trial'].rsplit('-', 1)
            groups.setdefault(label, {})[phase] = result
    assert len(accepted) == 118 and len(refused) == 1 and len(groups) == 29
    assert all(value == dict(positive='SURVIVED', harmless='SURVIVED', fault='KILLED', restored='SURVIVED') for value in groups.values())
    original = json.loads((private / PAG / 'evidence/controls.json').read_text())
    ctrl.APP = Path('/home/nathaniel/.t3/worktrees/openplan/t3-9142741a/openplan')
    for trial in original['trials']:
        report = json.loads((private / PAG / 'evidence' / trial['report']).read_text())
        assert ctrl.classify(report, trial['exitCode'], 'src/test/project-workbook-export-pagination.test.ts', trial['test'], trial['assertion']) == trial['classification']
    assert len(original['trials']) == 52
    # Validate every recorded file hash against Git objects, not owner checkouts.
    bindings = json.loads(blob(INT + '/evidence/source-bindings.json'))
    for entry in bindings['files']:
        assert digest(blob(entry['path'], PARENT)) == entry['candidateSha256']
        assert digest(blob(entry['path'])) == entry['integrationSha256']
        assert (entry['candidateSha256'] == entry['integrationSha256']) == entry['unchanged']
    assert digest(blob(INT + '/verify_controls.py')) == bindings['controllerSha256']
    for entry in json.loads(blob(PAG + '/evidence/source-bindings.json'))['files']:
        assert digest(blob(entry['path'], PARENT)) == entry['candidateSha256']
        if entry['baselineSha256'] is not None:
            assert digest(blob(entry['path'], BASE)) == entry['baselineSha256']
    restoration = []
    for folder in [PAG + '/evidence', INT + '/evidence', INT + '/evidence/continuation', INT + '/evidence/cohort-final', INT + '/evidence/cohort-count-corrected']:
        record = json.loads(blob(folder + '/restoration.json'))
        for path, value in record.items():
            assert value['restored'] is True and value['sha256'] == digest(blob(path))
        restoration.append(folder)
    ctrl.APP = Path('/home/nathaniel/.t3/worktrees/openplan/t3-32433c82/openplan')
    expected = {'src/test/' + key: value for key, value in COUNTS.items()}
    corrected = json.loads(blob(INT + '/evidence/cohort-count-corrected/combined-focused.json'))
    assert ctrl.classify_cohort(corrected, 0, expected) == 'SURVIVED'
    harmless = copy.deepcopy(corrected)
    harmless['reviewComment'] = 'harmless'
    assert ctrl.classify_cohort(harmless, 0, expected) == 'SURVIVED'
    broken = copy.deepcopy(corrected)
    broken['testResults'][0]['assertionResults'].pop()
    try:
        ctrl.classify_cohort(broken, 0, expected)
    except AssertionError as error:
        assert str(error) == 'combined cohort must execute every expected case'
    else:
        raise AssertionError('removed case accepted')
    wrong_counts = dict(expected, **{'src/test/portfolio-price-year.test.ts': 3})
    retained = json.loads(blob(INT + '/evidence/cohort-final/combined-focused.json'))
    try:
        ctrl.classify_cohort(retained, 0, wrong_counts)
    except AssertionError:
        assert retained['numPassedTests'] == 75
    else:
        raise AssertionError('incorrect 67-case expectation accepted')
    # Exercise the candidate's own synthetic strict-classifier refusals again.
    ctrl.APP = private / 'openplan'
    ctrl.OUT = OUT
    ctrl.classifier_controls()
    save('evidence-audit.json', {'integrationAcceptedTrials': len(accepted), 'completeGroups': groups,
        'originalPaginationTrials': len(original['trials']), 'retainedSurvivor': refused,
        'sourceBindingsMatchGit': True, 'controllerHashMatchesGit': True, 'restorationRecords': restoration,
        'correctedCounts': expected, 'incorrect67ExpectationRefused': True,
        'cohortControl': {'harmless': 'SURVIVED', 'removedCase': 'KILLED'}})


def run_tests(app, label, files):
    report_path = OUT / (label + '.json')
    if report_path.exists():
        raise ValueError('refuse overwritten trial: ' + label)
    command = ['node', 'node_modules/vitest/vitest.mjs', 'run', *files, '--config', str(app / 'review.config.mts'),
        '--configLoader', 'runner', '--maxWorkers', '1', '--no-file-parallelism', '--reporter=json', '--outputFile', str(report_path)]
    result = subprocess.run(command, cwd=app, env=dict(os.environ, NODE_OPTIONS='--max-old-space-size=640'), capture_output=True, text=True, timeout=60)
    (OUT / (label + '.log')).write_text(result.stdout + result.stderr)
    report = json.loads(report_path.read_text())
    assert report.get('numRuntimeErrorTestSuites', 0) == 0 and not report.get('unhandledErrors', [])
    assert report['testResults'] and all(not s.get('message') for s in report['testResults'])
    return result.returncode, report


def additional_controls(private):
    app, route = private / 'openplan', private / ROUTE
    original = route.read_bytes()
    records = []
    probes = ['src/test/workbook-independent-probe.test.ts']
    try:
        for label, before, after, marker, named_count in [
            ('range-contract', 'projects.length + pageSize - 1', 'projects.length + pageSize - 2', 'independent query contract', 13),
            ('byte-parity', '      projects,', '      projects: projects.map(project => ({ ...project, summary: null })),', 'independent complete byte parity', 8),
        ]:
            assert original.decode().count(before) == 1
            route.write_text(original.decode().replace(before, after, 1))
            code, report = run_tests(app, 'probe-' + label, probes)
            failures = [a for s in report['testResults'] for a in s['assertionResults'] if a['status'] == 'failed']
            assert code == 1 and failures
            assert all(len(a['failureMessages']) == 1 and a['failureMessages'][0].startswith('AssertionError:') for a in failures)
            assert sum(marker in a['failureMessages'][0] for a in failures) == named_count
            records.append({'fault': label, 'classification': 'KILLED', 'marker': marker,
                'namedFailures': named_count, 'totalFailures': len(failures)})
            route.write_bytes(original)
    finally:
        route.write_bytes(original)
    code, report = run_tests(app, 'extra-restored', probes)
    assert code == 0 and report['numPassedTests'] == 17
    assert route.read_bytes() == original
    cgroup = Path('/sys/fs/cgroup' + Path('/proc/self/cgroup').read_text().strip().split('::')[-1])
    save('extra-controls.json', {'controls': records, 'restoredCases': 17, 'routeRestoredSha256': digest(route.read_bytes()),
        'resources': {key: (cgroup / key).read_text().strip() for key in ['memory.max', 'memory.swap.max', 'memory.peak', 'memory.events']}})


def main():
    private = Path(tempfile.mkdtemp(prefix='openplan-workbook-independent-'))
    archive = git('archive', HEAD, 'openplan/src', 'openplan/package.json', 'openplan/tsconfig.json', PAG, INT)
    with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
        tar.extractall(private, filter='data')
    app = private / 'openplan'
    (app / 'node_modules').symlink_to('/home/nathaniel/code/openplan/openplan/node_modules', target_is_directory=True)
    (app / 'src/test/workbook-independent-probe.test.ts').write_bytes((HERE / 'probe.test.ts').read_bytes())
    (app / 'review.config.mts').write_text('''import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';
export default defineConfig({ plugins: [react()], cacheDir: path.resolve('review-cache'),
  resolve: { alias: { '@': path.resolve('src') } },
  test: { environment: 'jsdom', globals: true, setupFiles: ['./src/test/setup.ts'], maxWorkers: 1, testTimeout: 20000,
    fileParallelism: false, maxConcurrency: 1, cache: false, clearMocks: true, unstubEnvs: true, unstubGlobals: true } });
''')
    evidence_audit(private)
    print('Evidence audit complete', flush=True)
    ctrl = load_module(private / INT / 'verify_controls.py')
    ctrl.APP = app
    code, report = run_tests(app, 'independent-75', ['src/test/' + f for f in COUNTS])
    assert ctrl.classify_cohort(report, code, {'src/test/' + f: n for f, n in COUNTS.items()}) == 'SURVIVED'
    print('75 focused cases complete', flush=True)
    probe = ['src/test/workbook-independent-probe.test.ts']
    code, report = run_tests(app, 'independent-boundaries', probe)
    assert code == 0 and report['numPassedTests'] == 17 and report['success']
    print('17 independent boundaries complete', flush=True)
    route = private / ROUTE
    original = route.read_bytes()
    all_faults = []
    # First prove the same runner and fixture admit a harmless survivor.
    changes = [
        ('harmless', original + b'\n// Independent harmless control.\n', 0, None),
        ('success-status', original.replace(b'      status: 200,', b'      status: 201,'), 9, 'boundary status'),
        ('refusal-status', original.replace(b'{ status: 409 }', b'{ status: 200 }'), 4, 'boundary status'),
        ('failure-status', original.replace(b'{ status: 500 }', b'{ status: 200 }'), 4, 'independent no partial workbook'),
        ('truncate-first-page', original.replace(b'projects.push(...page);', b'projects.push(...page); break;'), None, 'independent exact termination'),
    ]
    try:
        for label, changed, failed, marker in changes:
            assert changed != original
            route.write_bytes(changed)
            code, report = run_tests(app, 'probe-' + label, probe)
            failures = [a for s in report['testResults'] for a in s['assertionResults'] if a['status'] == 'failed']
            if marker is None:
                assert code == 0 and report['numPassedTests'] == 17
            else:
                assert code == 1 and failures and (failed is None or len(failures) == failed)
                assert all(len(a['failureMessages']) == 1 and a['failureMessages'][0].startswith('AssertionError:') for a in failures)
                assert any(marker in a['failureMessages'][0] for a in failures)
            all_faults.append({'label': label, 'classification': 'SURVIVED' if not failures else 'KILLED',
                'failures': [{'test': a['fullName'], 'diagnostic': a['failureMessages'][0].splitlines()[0]} for a in failures]})
            print(label, all_faults[-1]['classification'], flush=True)
            route.write_bytes(original)
    finally:
        route.write_bytes(original)
    # Independently rerun concrete legacy fake faults, including its true survivor.
    legacy = private / LEGACY
    legacy_original = legacy.read_bytes()
    fake_faults = [
        ('projection', 'query.columns.split(",").map((column) => column.trim()).map((column) => [column, row[column]])',
            'Object.keys(row).map((column) => [column, row[column]])'),
        ('inclusive-row', 'rows.slice(from, from + count)', 'rows.slice(from, from + count - 1)'),
    ]
    try:
        for label, before, after in fake_faults:
            assert legacy_original.decode().count(before) == 1
            legacy.write_text(legacy_original.decode().replace(before, after, 1))
            code, report = run_tests(app, 'fake-' + label, ['src/test/project-portfolio-export-route.test.ts'])
            failures = [a for s in report['testResults'] for a in s['assertionResults'] if a['status'] == 'failed']
            assert code == 1 and len(failures) == 1
            marker = 'legacy workbook must retain ordered scoped original metadata' if label == 'projection' else 'legacy over-limit export must refuse without a workbook'
            assert marker in failures[0]['failureMessages'][0] and failures[0]['failureMessages'][0].startswith('AssertionError:')
            if label == 'inclusive-row':
                viewer = next(a for s in report['testResults'] for a in s['assertionResults'] if 'allows read-only members' in a['fullName'])
                assert viewer['status'] == 'passed'
            all_faults.append({'label': 'fake-' + label, 'classification': 'KILLED', 'test': failures[0]['fullName'], 'marker': marker,
                'viewerSurvives': label == 'inclusive-row'})
            legacy.write_bytes(legacy_original)
    finally:
        legacy.write_bytes(legacy_original)
    code, report = run_tests(app, 'independent-restored', probe + ['src/test/project-portfolio-export-route.test.ts'])
    assert code == 0 and report['numPassedTests'] == 22
    assert route.read_bytes() == original and legacy.read_bytes() == legacy_original
    additional_controls(private)
    cgroup = Path('/sys/fs/cgroup' + Path('/proc/self/cgroup').read_text().strip().split('::')[-1])
    save('run-summary.json', {'candidate': HEAD, 'parent': PARENT, 'fetchedMain': BASE, 'privateCopy': str(private),
        'focusedCases': 75, 'independentBoundaryCases': 17, 'restoredCases': 22, 'controls': all_faults,
        'restoredRouteSha256': digest(route.read_bytes()), 'restoredLegacySha256': digest(legacy.read_bytes()),
        'candidateImportCorrectionIntegrated': subprocess.run(['git', 'merge-base', '--is-ancestor', '536d4ccbd6', HEAD], cwd=ROOT).returncode == 0,
        'resources': {key: (cgroup / key).read_text().strip() for key in ['memory.max', 'memory.swap.max', 'memory.peak', 'memory.events']}})
    print('Review evidence and private probes complete', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=OUT)
    parser.add_argument('--extra-private', type=Path)
    args = parser.parse_args()
    OUT = args.output.resolve()
    OUT.mkdir(parents=True, exist_ok=True)
    if args.extra_private:
        additional_controls(args.extra_private.resolve())
    else:
        main()
