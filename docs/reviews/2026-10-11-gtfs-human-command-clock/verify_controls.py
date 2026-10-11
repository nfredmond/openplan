"""Check the acknowledgement clock oracle and restore production bytes in finally."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

REPO = Path(__file__).resolve().parents[3]
SOURCE = REPO / 'openplan/src/lib/gtfs/managed-human-command.ts'
TEST = REPO / 'openplan/src/test/gtfs-managed-human-command.test.ts'
ORIGINAL = SOURCE.read_bytes()
OUT = Path(sys.argv[1]).absolute()
OUT.mkdir(mode=0o700, exist_ok=False)
(OUT / 'original-source.ts').write_bytes(ORIGINAL)
(OUT / 'test-source.ts').write_bytes(TEST.read_bytes())
records = []


def variant(old, new):
    text = ORIGINAL.decode()
    if text.count(old) != 1:
        raise AssertionError('Ambiguous clock mutation')
    return text.replace(old, new).encode()


def run(name, content, expected=None, full=False):
    SOURCE.write_bytes(content)
    with SOURCE.open('rb') as stream:
        os.fsync(stream.fileno())
    command = ['npm', 'exec', '--', 'vitest', 'run', str(TEST.relative_to(REPO / 'openplan')),
               '--maxWorkers=1', '--reporter=verbose']
    if not full:
        command += ['-t', 'bounds acknowledgement from an uncooperative transport']
    result = subprocess.run(command, cwd=REPO / 'openplan', capture_output=True,
                            timeout=20, env={**os.environ, 'NODE_OPTIONS': '--max-old-space-size=320'})
    output = (result.stdout + result.stderr).decode()
    (OUT / (name + '.log')).write_text(output)
    if expected is None:
        if result.returncode:
            raise AssertionError('Positive clock control failed: ' + name)
    elif result.returncode == 0 or expected not in output or 'bounds acknowledgement from an uncooperative transport' not in output:
        raise AssertionError('Broken clock control missed intended oracle: ' + name)
    records.append({'case': name, 'exitCode': result.returncode,
                    'result': 'survived' if expected is None else 'failed intended assertion',
                    'expectedFailure': expected})
    (OUT / 'progress.json').write_text(json.dumps(records, indent=2) + '\n')


try:
    run('baseline', ORIGINAL, full=True)
    run('harmless-comment', ORIGINAL + b'\n// Harmless clock-control comment.\n', full=True)
    run('early-deadline', variant(')), deadlineMs);', ')), deadlineMs - 1);'), 'expected true to be false')
    run('late-deadline', variant(')), deadlineMs);', ')), deadlineMs + 1);'), 'expected false to be true')
    run('missing-deadline', variant(')), deadlineMs);', ')), 10000);'), 'expected false to be true')
    run('waits-for-transport', variant('Promise.race([service.rpc(name, structuredClone(args)).abortSignal(bounded), cancelled])',
                                    'service.rpc(name, structuredClone(args)).abortSignal(bounded)'),
        'Command still waits for uncooperative transport')
    run('missing-transport-signal', variant('.abortSignal(bounded), cancelled', ', cancelled'),
        'expected undefined to be false')
    run('wrong-timeout-reason', variant('ending.abort(new Error("GTFS human command acknowledgement is unavailable"))',
                                      'ending.abort(new Error("Wrong timeout reason"))'),
        'to contain')
    run('non-error-timeout', variant('ending.abort(new Error("GTFS human command acknowledgement is unavailable"))',
                                   'ending.abort("GTFS human command acknowledgement is unavailable")'),
        'to be an instance of Error')
    run('unconfirmed-receipt-promoted', variant('finally { ending.abort(); await lock.release(); }',
        'finally { ending.abort(); await writeConnectorJournal(options.directory, { binding, receipt: {} }); await lock.release(); }'),
        '"receipt": null')
finally:
    SOURCE.write_bytes(ORIGINAL)
    with SOURCE.open('rb') as stream:
        os.fsync(stream.fileno())
    if SOURCE.read_bytes() != ORIGINAL:
        raise AssertionError('Production clock source was not restored')

run('restored', ORIGINAL, full=True)
(OUT / 'result.json').write_text(json.dumps({'sourceSha256': hashlib.sha256(ORIGINAL).hexdigest(),
    'testSha256': hashlib.sha256(TEST.read_bytes()).hexdigest(), 'sourceRestored': SOURCE.read_bytes() == ORIGINAL,
    'cases': records}, indent=2) + '\n')
