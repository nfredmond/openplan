"""Retain the lower jargon count while keeping real regressions detectable."""
from pathlib import Path
import hashlib
import json
import subprocess
import sys

root = Path(__file__).resolve().parents[3]
app = root / "openplan"
out = Path(sys.argv[1])
out.mkdir(mode=0o700, parents=True, exist_ok=False)
guard = app / "src/test/planner-copy-says-the-plain-thing.test.ts"
panel = app / "src/components/data-hub/gtfs-ingest-panel.tsx"
original = {p: p.read_bytes() for p in [guard, panel]}
before = '''{feed.current_version_id
                      ? "Service details for the version in use are unavailable. Review the feed’s version history before using its results."
                      : "No version of this feed is in use. Review and adopt a completed version before using its service results."}'''
assert original[panel].decode().count(before) == 1
assert original[guard].decode().count('  ingest: 7,') == 1
variants = [
    ("baseline", {}, False),
    ("harmless", {p: data + b"\n// Harmless registry language control.\n" for p,data in original.items()}, False),
    ("reintroduced-ingest", {panel: original[panel].decode().replace(before, 'No ingest of this feed has been adopted, so it derives no service levels yet.').encode()}, True),
    ("stale-counter", {guard: original[guard].decode().replace('  ingest: 7,', '  ingest: 8,').encode()}, True),
    ("incorrectly-lowered-counter", {guard: original[guard].decode().replace('  ingest: 7,', '  ingest: 6,').encode()}, True),
    ("restored", {}, False),
]
records = []
try:
    for name, changes, broken in variants:
        for path,data in original.items():
            path.write_bytes(changes.get(path,data))
        report = out/(name+'.json')
        child = subprocess.run([str(app/'node_modules/.bin/vitest'),'run','src/test/planner-copy-says-the-plain-thing.test.ts','--maxWorkers=1','--reporter=json','--outputFile='+str(report)],cwd=app,capture_output=True,text=True,timeout=30)
        (out/(name+'.log')).write_text(child.stdout+child.stderr)
        data = json.loads(report.read_text())
        failures = [t['fullName'] for s in data['testResults'] for t in s['assertionResults'] if t['status']=='failed']
        if broken:
            assert child.returncode != 0 and failures == ['planner copy says the plain thing uses no term from the ledger more often than the recorded baseline'], (name,failures)
        else:
            assert child.returncode == 0 and not failures, (name,failures)
        records.append({'variant':name,'result':'expected assertion failure' if broken else 'pass','passedTests':data['numPassedTests'],'failedTests':data['numFailedTests'],'failedAssertions':failures})
        print(name,records[-1]['result'],flush=True)
finally:
    for path,data in original.items():
        path.write_bytes(data)
assert all(p.read_bytes()==data for p,data in original.items())
(out/'controls.json').write_text(json.dumps({'variants':records,'restoredSha256':{str(p.relative_to(root)):hashlib.sha256(d).hexdigest() for p,d in original.items()},'boundary':'Actual nested-directory source scan and protected-copy assertions. No browser, layout or comprehension acceptance.'},indent=2)+'\n')
