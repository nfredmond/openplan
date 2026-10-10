"""Compose the real Storage/parser/journal path with controlled lifecycle replies."""
from pathlib import Path
import hashlib
import json
import os
import signal
import subprocess
import sys

here = Path(__file__).resolve().parent
root = here.parents[2]
sys.path.insert(0, str(here.parent / '2026-10-09-gtfs-ingest-recovery'))
from isolated_storage import storage

config = json.loads(Path(sys.argv[1]).read_text())
archive = Path(sys.argv[2]).resolve(strict=True)
out = Path(sys.argv[3]).resolve()
out.mkdir(parents=True, exist_ok=True)
directory = out/'worker'
assert not directory.exists(), 'Use a new proof directory'
build = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
results = []
with storage(config) as native:
    env = {**os.environ, 'NODE_OPTIONS': '--max-old-space-size=512',
           'OPENPLAN_PROOF_STORAGE_URL': native['url'], 'OPENPLAN_PROOF_STORAGE_TOKEN': native['token'],
           'OPENPLAN_PROOF_PARSER_BUILD': build}
    loader = ['node', '--import', str(root/'openplan/node_modules/tsx/dist/loader.mjs')]
    seed = loader+[str(here.parent/'2026-10-09-gtfs-worker-ownership/verify_native_archive.mts')]
    seeded = subprocess.run(seed+['seed', str(archive)], cwd=root/'openplan', env=env, text=True, capture_output=True, timeout=30)
    assert seeded.returncode == 0, 'Owned Storage seed failed'
    identity = json.loads(seeded.stdout)
    env['OPENPLAN_PROOF_ARCHIVE_IDENTITY'] = json.dumps(identity)
    try:
        for mode in ['interrupt', 'recover', 'retained']:
            child = subprocess.Popen(loader+[str(here/'verify_worker_publication_native.mts'), str(directory), mode],
                                     cwd=root/'openplan', env=env, text=True, stdout=subprocess.PIPE,
                                     stderr=subprocess.PIPE, start_new_session=True)
            try:
                stdout, stderr = child.communicate(timeout=60)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.communicate(timeout=10)
                raise
            (out/f'{mode}.log').write_text(stdout+stderr)
            assert child.returncode == 0, (mode, stderr[:2000])
            row = json.loads(stdout)
            assert row['parsedFiles'] == 1
            assert row['parserRoutes'] == 14 and row['parserStops'] == 287
            assert row['routeRows'] > row['parserRoutes'] and row['stopRows'] > row['parserStops']
            if mode == 'interrupt':
                assert row['outcome']['state'] == 'unknown_completion' and row['terminalResolved'] is False
                assert row['downloads'] == 1 and row['workCalls'] == 1
            else:
                assert row['outcome']['state'] == 'recovered_terminal' and row['terminalResolved'] is True
                assert row['downloads'] == 0 and row['workCalls'] == 0
                assert row['terminalCommand'] == results[0]['terminalCommand']
                assert row['outputSha256'] == results[0]['outputSha256']
                assert row['outcome']['result']['retained'] == (mode == 'retained')
                expected_calls = ['claim_gtfs_ingest', 'read_gtfs_ingest_attempt']
                if mode == 'recover': expected_calls.append('complete_gtfs_ingest')
                assert row['calls'] == expected_calls
                assert row['outcome']['result']['receipt']['tractOutcome']['computed'] is False
                assert row['outcome']['result']['receipt']['tractOutcome']['rows'] is None
            results.append(row)
    finally:
        cleaned = subprocess.run(seed+['cleanup'], cwd=root/'openplan', env=env, text=True, capture_output=True, timeout=30)
        assert cleaned.returncode == 0, 'Owned Storage cleanup failed'
sources = ['parsed-artifact', 'managed-worker-publication', 'managed-worker-service', 'managed-worker-artifact',
           'managed-worker-attempt', 'managed-worker-dispatch', 'managed-worker-journal']
record = {'sources': {name: hashlib.sha256((root/f'openplan/src/lib/gtfs/{name}.ts').read_bytes()).hexdigest() for name in sources},
          'parserBuild': build, 'archiveSha256': identity['checksumSha256'], 'archiveBytes': identity['byteSize'],
          'runs': results, 'nativeStorageRemoved': True,
          'scope': 'Actual isolated Storage, production parser child, private journal and installed SDK; controlled database lifecycle and tract replies. Not native SQL fencing, publication, scientific or browser acceptance.'}
(out/'native.json').write_text(json.dumps(record, indent=2)+'\n')
print(json.dumps({'runs': len(results), 'routeRows': results[0]['routeRows'], 'stopRows': results[0]['stopRows'],
                  'exactCompletionRecovery': True, 'nativeStorageRemoved': True}))
