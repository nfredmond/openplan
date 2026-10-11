"""Kill only this proof's child after prepared dispatch; recover in new processes."""
from pathlib import Path
import hashlib
import json
import os
import selectors
import subprocess
import sys
import time

root = Path(__file__).resolve().parents[3]
out = Path(sys.argv[1]).resolve()
out.mkdir(parents=True, exist_ok=True)
directory = out / 'attempt'
assert not directory.exists(), 'Use a new proof directory'
command = ['node', '--import', str(root/'openplan/node_modules/tsx/dist/loader.mjs'), str(Path(__file__).with_suffix('.mts')), str(directory)]
child = subprocess.Popen(command+['crash'], cwd=root/'openplan', stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env={**os.environ,'NODE_OPTIONS':'--max-old-space-size=256'})
try:
    with selectors.DefaultSelector() as observer:
        observer.register(child.stdout, selectors.EVENT_READ)
        assert observer.select(10), 'child did not reach dispatch'
        first = json.loads(child.stdout.readline())
    assert first['event'] == 'dispatch'
    child.kill()
    stdout, stderr = child.communicate(timeout=10)
    assert child.returncode == -9, (child.returncode, stderr)
finally:
    if child.poll() is None:
        child.kill()
        child.communicate(timeout=10)
prepared = json.loads((directory/'command-route-0/pending.json').read_text())
identity = json.loads((directory/'pending.json').read_text())
assert prepared['resolved'] is False and prepared['receipt'] is None
assert prepared['commandId'] == first['commandId'] and identity['token'] == first['token']
# Observe actual OS-lock release; a retained lock file is not a running owner.
deadline = time.monotonic()+5
while subprocess.run(['/usr/bin/flock','--exclusive','--nonblock',str(directory/'run.lock'),'/usr/bin/true']).returncode != 0:
    assert time.monotonic() < deadline, 'child lock did not release'
    time.sleep(.05)
results = []
for mode in ['recover','retained']:
    result = subprocess.run(command+[mode],cwd=root/'openplan',text=True,capture_output=True,timeout=15,env={**os.environ,'NODE_OPTIONS':'--max-old-space-size=256'})
    (out/f'{mode}.log').write_text(result.stdout+result.stderr)
    assert result.returncode == 0,result.stderr
    events = [json.loads(line) for line in result.stdout.splitlines()]
    assert [row['event'] for row in events] == (['dispatch','finished'] if mode=='recover' else ['finished'])
    final = events[-1]
    assert final['commandId'] == first['commandId'] and final['token'] == first['token']
    assert final['retained'] == (mode=='retained')
    results.append({'mode':mode,'sameCommand':True,'sameAttempt':True,'retained':final['retained'],'logSha256':hashlib.sha256(result.stdout.encode()).hexdigest()})
assert directory.stat().st_mode & 0o777 == 0o700
assert (directory/'command-route-0/pending.json').stat().st_mode & 0o777 == 0o600
record={'sourceSha256':hashlib.sha256((root/'openplan/src/lib/gtfs/managed-worker-journal.ts').read_bytes()).hexdigest(),'killedOwnChildAfterPreparedDispatch':True,'observedLockRelease':True,'recovery':results,'scope':'Native filesystem/process proof with synthetic delivery, not PostgreSQL or power-loss recovery'}
(out/'native.json').write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps(record))
