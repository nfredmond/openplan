"""Native Storage/parser custody; controlled renewal and lifecycle acknowledgements."""
from pathlib import Path
import hashlib
import json
import os
import selectors
import signal
import subprocess
import sys
import time

here = Path(__file__).resolve().parent
root = here.parents[2]
sys.path.insert(0, str(here.parent / '2026-10-09-gtfs-ingest-recovery'))
from isolated_storage import storage

config = json.loads(Path(sys.argv[1]).read_text())
archive = Path(sys.argv[2]).resolve(strict=True)
out = Path(sys.argv[3]).resolve()
out.mkdir(parents=True, exist_ok=True)
directory = out / 'artifact'
assert not directory.exists(), 'Use a new proof directory'
build = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
with storage(config) as native:
    env = {**os.environ, 'NODE_OPTIONS': '--max-old-space-size=384',
           'OPENPLAN_PROOF_STORAGE_URL': native['url'], 'OPENPLAN_PROOF_STORAGE_TOKEN': native['token'],
           'OPENPLAN_PROOF_PARSER_BUILD': build}
    loader = ['node', '--import', str(root/'openplan/node_modules/tsx/dist/loader.mjs')]
    seed = loader + [str(here.parent/'2026-10-09-gtfs-worker-ownership/verify_native_archive.mts')]
    seeded = subprocess.run(seed+['seed', str(archive)], cwd=root/'openplan', env=env, text=True, capture_output=True, timeout=30)
    assert seeded.returncode == 0, 'Owned Storage fixture seed failed'
    identity = json.loads(seeded.stdout)
    env['OPENPLAN_PROOF_ARCHIVE_IDENTITY'] = json.dumps(identity)
    command = loader + [str(here/'verify_worker_artifact_native.mts'), str(directory)]
    try:
        child = subprocess.Popen(command+['crash'], cwd=root/'openplan', env=env, text=True,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
        try:
            with selectors.DefaultSelector() as observer:
                observer.register(child.stdout, selectors.EVENT_READ)
                assert observer.select(45), 'Artifact child did not reach consumption'
                line = child.stdout.readline()
                assert line, 'Artifact child exited before consumption: ' + child.stderr.read()[:2000]
                first = json.loads(line)
            assert first['event'] == 'artifact' and first['retained'] is False
            assert first['downloads'] == 1 and first['renewals'] >= 3
            assert first['delivered'] == ['confirm_archive', 'stage']
            os.killpg(child.pid, signal.SIGKILL)
            child.communicate(timeout=10)
            assert child.returncode == -9
        finally:
            if child.poll() is None:
                os.killpg(child.pid, signal.SIGKILL)
                child.communicate(timeout=10)
        deadline = time.monotonic()+5
        while subprocess.run(['/usr/bin/flock', '--exclusive', '--nonblock', str(directory/'run.lock'), '/usr/bin/true']).returncode:
            assert time.monotonic() < deadline, 'Artifact lock did not release'
            time.sleep(.05)
        saved = json.loads((directory/'pending.json').read_text())
        assert saved['output']['receipt'] == first['receipt']
        result = subprocess.run(command+['recover'], cwd=root/'openplan', env=env, text=True, capture_output=True, timeout=30)
        (out/'recover.log').write_text(result.stdout+result.stderr)
        assert result.returncode == 0, result.stderr[:2000]
        recovered = json.loads(result.stdout)
        assert recovered['retained'] is True and recovered['downloads'] == 0 and recovered['renewals'] == 1
        assert recovered['receipt'] == first['receipt']
        assert recovered['delivered'] == ['confirm_archive']
        assert len(list(directory.glob('parsed-*.json'))) == 1
        output = directory/saved['output']['name']
        original = output.read_bytes()
        try:
            changed = bytearray(original)
            changed[0] ^= 1
            output.write_bytes(changed)
            corrupt = subprocess.run(command+['corrupt'], cwd=root/'openplan', env=env, text=True, capture_output=True, timeout=30)
            (out/'corrupt.log').write_text(corrupt.stdout+corrupt.stderr)
            assert corrupt.returncode == 0, corrupt.stderr[:2000]
            assert json.loads(corrupt.stdout)['event'] == 'corruption-refused'
        finally:
            output.write_bytes(original)
    finally:
        cleaned = subprocess.run(seed+['cleanup'], cwd=root/'openplan', env=env, text=True, capture_output=True, timeout=30)
        assert cleaned.returncode == 0, 'Owned Storage fixture cleanup failed'
record = {'sourceSha256': hashlib.sha256((root/'openplan/src/lib/gtfs/managed-worker-artifact.ts').read_bytes()).hexdigest(),
          'parserBuild': build, 'archiveSha256': identity['checksumSha256'], 'archiveBytes': identity['byteSize'],
          'first': first, 'recovered': recovered, 'killedOwnParentAfterRetainedOutput': True,
          'observedLockRelease': True, 'corruptOutputRefused': True, 'nativeStorageRemoved': True,
          'scope': 'Actual isolated Storage and production parser child; controlled RPC acknowledgements, no native managed database lifecycle or power-loss proof'}
(out/'native.json').write_text(json.dumps(record, indent=2)+'\n')
print(json.dumps(record))
