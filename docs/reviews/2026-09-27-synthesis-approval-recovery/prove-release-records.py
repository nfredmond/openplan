"""Challenge release accounting without claiming installed upgrade or browser coverage."""
from pathlib import Path
import hashlib
import json
import subprocess
import tempfile
from datetime import datetime, timezone
review = Path(__file__).resolve().parent
root = review.parents[2]
app = root / 'openplan'
ledger = app / 'src/test/migrations/release-ordering.test.ts'
changelog = root / 'CHANGELOG.md'
original = {p: p.read_bytes() for p in [ledger, changelog]}
entry = '''    tag: "0.63.0",
    lastMigration: "20261014000028_engagement_synthesis_approvals.sql",
    migrationsAtRelease: 347,
  },'''
cases = [
 ('baseline', ledger, '', '', None),
 ('harmless-comment', ledger, 'const RELEASES:', '// Harmless release accounting control.\nconst RELEASES:', None),
 ('wrong-migration-count', ledger, entry, entry.replace('347', '346'), 'no migration has been inserted at or below a shipped high-water mark'),
 ('missing-migration', ledger, entry, entry.replace('engagement_synthesis_approvals.sql', 'synthetic_missing_approval.sql'), "every release's recorded last migration exists on disk"),
 ('missing-release-section', changelog, '## 0.63.0 (', '## SYNTHETIC-absent (', "the CHANGELOG's newest release section exists"),
 ('missing-migration-disclosure', changelog, '`20261014000028_engagement_synthesis_approvals.sql`', '`SYNTHETIC undisclosed migration`', "the CHANGELOG's newest release section exists"),
]
results = []
try:
 with tempfile.TemporaryDirectory(prefix='openplan-v063-release-proof-') as tmp:
  for name, target, before, after, assertion in cases:
   for p, raw in original.items(): p.write_bytes(raw)
   if before:
    value = target.read_text(); assert value.count(before) == 1, (name, value.count(before)); target.write_text(value.replace(before, after))
   output = Path(tmp) / 'results.json'; output.unlink(missing_ok=True)
   run = subprocess.run(['node_modules/.bin/vitest', 'run', 'src/test/migrations/release-ordering.test.ts', '--reporter=json', '--outputFile=' + str(output)], cwd=app, capture_output=True, text=True, timeout=60)
   data = json.loads(output.read_text())
   failures = [t['fullName'] for f in data['testResults'] for t in f['assertionResults'] if t['status'] == 'failed']
   expected = run.returncode == 0 and data['numPassedTests'] > 0 and not failures if assertion is None else run.returncode != 0 and any(assertion in name for name in failures)
   results.append({'case':name,'exit':run.returncode,'passedTests':data['numPassedTests'],'failures':failures,'expectedOutcome':expected})
   print(name, expected, flush=True)
   assert expected, (name, failures, run.stdout[-1000:], run.stderr[-1000:])
finally:
 for p, raw in original.items(): p.write_bytes(raw)
 (review/'release-records-mutations.json').write_text(json.dumps({'recordedAt':datetime.now(timezone.utc).isoformat(),'cases':results,'sourcesRestored':all(p.read_bytes() == raw for p,raw in original.items()),'sources':{str(p.relative_to(root)):hashlib.sha256(raw).hexdigest() for p,raw in original.items()},'limits':'Metadata accounting only. Does not prove populated upgrade, private database permissions or browser behavior.'},indent=2)+'\n')
