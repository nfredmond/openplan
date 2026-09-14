"""Check review correction semantics and the two-table census with restored source faults."""
from pathlib import Path
import hashlib
import json
import subprocess

review = Path(__file__).resolve().parent
app = review.parents[2] / 'openplan'
model = app / 'src/lib/engagement/synthesis-review.ts'
inventory = app / 'src/test/migrations/inventory.test.ts'
originals = {p: p.read_bytes() for p in [model, inventory]}
tests = ['src/test/engagement-synthesis-review.test.ts', 'src/test/migrations/inventory.test.ts']
create = 'creates complete unassessed drafts'
correct = 'preserves the parent and source'
overlap = 'discloses overlap'
notes = 'retains complete notes'
read = 'refuses altered source identity'
delta = 'refuses stale or contradictory'
intent = 'binds strict create/correction intents'
cases = [('baseline', None, '', '', []), ('harmless-comment', model, '', '// Harmless review model comment.\n', [])]
for name, message, expected in [
 ('source-identity','Review source identity differs',read),
 ('duplicate-groups','Duplicate review group identifiers',read),
 ('duplicate-membership','Duplicate source in review group',read),
 ('unknown-source','Review references an unknown source',read),
 ('coverage-ledger','Review source coverage differs',read),
 ('existing-group','Review group already exists',delta),
 ('membership-delta','Review membership delta repeats a source',delta),
 ('stale-membership','Review membership delta differs from the parent',delta),
 ('empty-correction','Review correction changes nothing',delta),
]: cases.append((name, model, f'throw new Error("{message}")', f'void "Removed {message}"', [expected]))
cases += [
 ('drop-original-tail',model,'sourceIds: [...group.sourceIds]','sourceIds: [...group.sourceIds].slice(0, 300)',[create]),
 ('invent-initial-sentiment',model,'sentiment: "not_assessed" as const','sentiment: "neutral" as const',[create]),
 ('rewrite-parent',model,'const next = structuredClone(content);','const next = parent;',[correct]),
 ('lose-staff-wording',model,'group.label = change.label;','group.label = group.label;',[correct]),
 ('lose-staff-summary',model,'group.summary = change.summary;','group.summary = group.summary;',[correct]),
 ('lose-staff-sentiment',model,'group.sentiment = change.sentiment;','group.sentiment = group.sentiment;',[correct]),
 ('ignore-membership-removal',model,'group.sourceIds.filter(id => !remove.has(id))','group.sourceIds',[correct]),
 ('ignore-new-group-membership',model,'sourceIds: [...change.sourceIds].sort()','sourceIds: []',[correct,overlap]),
 ('hide-overlap',model,'[...frequency.values()].filter(count => count > 1).length','0',[overlap]),
 ('hide-unassigned',model,'[...all].filter(id => !frequency.has(id)).sort()','[]',[correct,overlap]),
 ('truncate-notes',model,'next.notes = change.notes;','next.notes = change.notes.slice(0, 600);',[notes]),
 ('invent-missing-context',model,'definition_unavailable: "Historical definition unavailable"','definition_unavailable: "Uncategorized"',[notes]),
 ('allow-blank-label',model,'value => value.trim().length > 0','value => true',[intent]),
 ('allow-invalid-text',model,'value => value.isWellFormed() && !value.includes("\\0")','value => true',[intent]),
 ('allow-unknown-create-data',model,'sourceId: uuid, sourceSha256: digest }).strict(),','sourceId: uuid, sourceSha256: digest }).passthrough(),',[intent]),
 ('allow-unknown-correction-data',model,'reason: label, change: synthesisReviewChangeSchema }).strict(),','reason: label, change: synthesisReviewChangeSchema }).passthrough(),',[intent]),
 ('stale-relation-inventory',inventory,'relations: 269,','relations: 267,',['reads every relation the migrations declare']),
]
results = []
try:
 for name, path, old, replacement, expected in cases:
  for file, raw in originals.items(): file.write_bytes(raw)
  if path:
   source = originals[path].decode()
   if old and source.count(old) != 1: raise RuntimeError(f'Missing/ambiguous seam: {name}')
   path.write_text(source.replace(old,replacement) if old else replacement + source)
  run = subprocess.run(['npm','exec','--','vitest','run',*tests,'--reporter=json'],cwd=app,text=True,capture_output=True,timeout=60)
  data = json.loads(run.stdout[run.stdout.index('{'):])
  failed = [a['fullName'] for f in data['testResults'] for a in f['assertionResults'] if a['status']=='failed']
  ok = data['numTotalTests']==36 and data['numPendingTests']==0 and (run.returncode==0 and not failed if not expected else run.returncode==1 and all(any(e in f for f in failed) for e in expected))
  results.append({'case':name,'exitCode':run.returncode,'failed':failed,'expectedOutcome':ok}); print(json.dumps(results[-1]),flush=True)
  if not ok: raise RuntimeError(run.stdout+run.stderr)
finally:
 for file,raw in originals.items(): file.write_bytes(raw)
(review/'review-model-mutations.json').write_text(json.dumps({'sourcesRestored':all(p.read_bytes()==raw for p,raw in originals.items()),'cases':results,
 'sourceSha256':{str(p.relative_to(app)):hashlib.sha256(raw).hexdigest() for p,raw in originals.items()},
 'testSha256':{p:hashlib.sha256((app/p).read_bytes()).hexdigest() for p in tests},
 'limits':'Pure preparation/correction and SQL-declaration census. Not persistence, authorization, browser recovery, meaningful staff interpretation, approvals, or exports.'},indent=2)+'\n')
