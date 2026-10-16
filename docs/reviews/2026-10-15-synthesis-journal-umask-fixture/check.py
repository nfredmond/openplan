"""Run serial fixture checks with child-only umasks and read-only dependencies."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
APP = ROOT / 'openplan'
PRIVATE = Path('/home/nathaniel/.local/state/openplan/synthesis-journal-umask-fixture-20261015')
DEPS = Path('/home/nathaniel/code/openplan/openplan/node_modules')
TEST = 'openplan/src/test/engagement-synthesis-generation-worker.test.ts'
CLIENT = 'workers/planner_agent_connector/connector-client.mjs'
WORKER = 'openplan/src/lib/engagement/synthesis-generation-worker.ts'
NAME = 'refuses nonprivate and malformed saved journals'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def run(label, mask, overlay=None, focused=False):
    label = phase + '-final-' + label
    out = HERE / 'evidence' / label
    out.mkdir(parents=True, exist_ok=False)
    cache = PRIVATE / label
    cache.mkdir(mode=0o700)
    env = dict(os.environ, SYNTHESIS_UMASK_CACHE=str(cache), NODE_OPTIONS='--max-old-space-size=640')
    command = ['bwrap', '--die-with-parent', '--ro-bind', '/', '/', '--bind', str(PRIVATE), str(PRIVATE),
               '--bind', str(out), str(out), '--ro-bind', str(DEPS), str(APP / 'node_modules'),
               '--tmpfs', '/tmp', '--proc', '/proc', '--dev', '/dev', '--chdir', str(APP)]
    if overlay:
        command += ['--ro-bind', str(overlay[1]), str(ROOT / overlay[0])]
    command += ['node', '--max-old-space-size=640', 'node_modules/vitest/vitest.mjs', 'run',
                '--configLoader', 'runner', '--config', str(HERE / 'vitest.config.mts'),
                str(Path(TEST).relative_to('openplan')), '--maxWorkers=1', '--no-file-parallelism',
                '--reporter=default', '--reporter=json', '--outputFile=' + str(out / 'tests.json')]
    if focused:
        command += ['-t', NAME]
    with (out / 'run.log').open('w') as log:
        result = subprocess.run(command, env=env, stdout=log, stderr=subprocess.STDOUT,
                                umask=mask, timeout=180)
    report = json.loads((out / 'tests.json').read_text())
    assertions = [a for suite in report['testResults'] for a in suite['assertionResults']]
    record = {'label': label, 'umask': f'{mask:04o}', 'exitCode': result.returncode,
              'passed': sum(a['status'] == 'passed' for a in assertions),
              'failed': sum(a['status'] == 'failed' for a in assertions),
              'focused': focused,
              'skipped': sum(a['status'] in ['pending', 'skipped'] for a in assertions),
              'failures': [{'name': a['fullName'], 'messages': a['failureMessages']} for a in assertions if a['status'] == 'failed'],
              'sourceHashes': {p: sha((ROOT / p).read_bytes()) for p in [TEST, CLIENT, WORKER]},
              'overlay': {'target': overlay[0], 'sha256': sha(overlay[1].read_bytes())} if overlay else None,
              'command': command}
    (out / 'result.json').write_text(json.dumps(record, indent=2) + '\n')
    print(label, result.returncode, record['passed'], record['failed'], flush=True)
    return record


def expect_result(record, failed, message=None):
    assert record['exitCode'] == (1 if failed else 0), record
    assert record['failed'] == failed, record
    executed = 1 if record['focused'] else 40
    assert record['passed'] == executed - failed, record
    assert record['skipped'] == 40 - executed, record
    if failed:
        assert NAME in record['failures'][0]['name'], record
        if message:
            assert message in '\n'.join(record['failures'][0]['messages']), record


if __name__ == '__main__':
    phase = sys.argv[1]
    group = Path('/sys/fs/cgroup') / Path('/proc/self/cgroup').read_text().strip().split('::', 1)[1].lstrip('/')
    resources = {key: (group / key).read_text().strip() for key in ['memory.max', 'memory.swap.max']}
    assert resources == {'memory.max': '1073741824', 'memory.swap.max': '0'}, resources
    original = {p: (ROOT / p).read_bytes() for p in [TEST, CLIENT, WORKER]}
    results = []
    try:
        if phase == 'original':
            for mask in [0o077, 0o022]:
                row = run(f'original-{mask:04o}', mask)
                results.append(row)
                expect_result(row, 1 if mask == 0o077 else 0, 'connector_file_not_private')
        elif phase == 'fixed':
            for mask in [0o077, 0o022]:
                row = run(f'fixed-{mask:04o}', mask)
                results.append(row)
                expect_result(row, 0)
        if phase in ['controls', 'fixed']:
            mutations = [
                ('harmless-comment', CLIENT, '// Harmless survivor control.\n' + original[CLIENT].decode(), False, None),
                ('privacy-bypass', CLIENT, original[CLIENT].decode().replace('(info.mode & 0o077) !== 0', 'false'), True, 'connector_file_not_private'),
                ('schema-bypass', WORKER, original[WORKER].decode().replace('const value = journalSchema.parse(raw);', 'const value = raw as Journal;'), True, 'to match object'),
                ('query-before-private-read', WORKER, original[WORKER].decode().replace('    let pending: Journal | null;', '    service.from("engagement_synthesis_generation_requests");\n    let pending: Journal | null;'), True, 'not be called'),
                ('query-before-schema', WORKER, original[WORKER].decode().replace('try { pending = checkedJournal(await readPrivateJson(join(args.directory, "pending.json"), SYNTHESIS_WORKER_JOURNAL_BYTES)); }', 'try { const raw = await readPrivateJson(join(args.directory, "pending.json"), SYNTHESIS_WORKER_JOURNAL_BYTES); service.from("engagement_synthesis_generation_requests"); pending = checkedJournal(raw); }'), True, 'not be called'),
            ]
            for label, target, source, killed, message in mutations:
                copy = PRIVATE / ('mutation-' + Path(target).name)
                copy.write_bytes(original[target])
                try:
                    assert source.encode() != original[target]
                    copy.write_text(source)
                    for mask in [0o077, 0o022]:
                        row = run(f'controls-{label}-{mask:04o}', mask, (target, copy), focused=True)
                        results.append(row)
                        expect_result(row, int(killed), message)
                finally:
                    copy.write_bytes(original[target])
                    assert copy.read_bytes() == original[target]
        elif phase != 'original':
            raise ValueError(phase)
    finally:
        resources.update({key: (group / key).read_text().strip() for key in ['memory.peak', 'memory.events', 'memory.swap.peak']})
        out = HERE / 'evidence'
        out.mkdir(exist_ok=True)
        (out / (phase + '-summary.json')).write_text(json.dumps({'results': results, 'resources': resources,
            'sourceRestored': {p: (ROOT / p).read_bytes() == data for p, data in original.items()},
            'privateMutationCopiesRestored': {p.name: sha(p.read_bytes()) for p in PRIVATE.glob('mutation-*')}}, indent=2) + '\n')
        assert all((ROOT / p).read_bytes() == data for p, data in original.items())
