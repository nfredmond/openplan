"""Prove SQL-reader accounting, migration census and operator upgrade notes."""
from pathlib import Path
import hashlib,json,re,subprocess,time
review=Path(__file__).resolve().parent;root=review.parents[2];app=root/'openplan'
paths={'ledger':app/'src/test/a-column-nothing-reads-is-a-question.test.ts','parser':app/'src/test/migrations/schema-inventory.ts','changelog':root/'CHANGELOG.md'}
originals={key:path.read_text() for key,path in paths.items()};private=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913/public-release-record-controls')/time.strftime('%Y%m%dT%H%M%S');private.mkdir(parents=True)
tests=['src/test/a-column-nothing-reads-is-a-question.test.ts','src/test/migrations/inventory.test.ts','src/test/migrations/release-ordering.test.ts']
cases=[('baseline','ledger',originals['ledger'],None),('harmless-comment','ledger',originals['ledger']+'\n// Harmless SQL reader accounting control.\n',None)]
for column in ['engagement_public_translation_requests.previous_request_id','engagement_public_translation_requests.share_token_hash','engagement_public_translation_requests.source_snapshot','engagement_translation_generation_requests.authority_kind']:
 lines=[line for line in originals['ledger'].splitlines(keepends=True) if 'column: "'+column+'"' in line];assert len(lines)==1
 cases.append(('unaccounted-'+column.split('.')[-1],'ledger',originals['ledger'].replace(lines[0],''),'finds no unread column that is not accounted for'))
def mutate(name,key,old,new,target):
 body=originals[key];assert body.count(old)==1,(name,body.count(old));cases.append((name,key,body.replace(old,new,1),target))
mutate('invisible-relation','parser','relations: () => relations,','relations: () => relations.filter(name => name !== "engagement_public_translation_requests"),','reads every relation the migrations declare')
mutate('invisible-table','parser','tables: () => [...tableColumns.keys()].sort(),','tables: () => [...tableColumns.keys()].filter(name => name !== "engagement_public_translation_requests").sort(),','reads every relation the migrations declare')
mutate('invisible-rls','parser','rlsEnabled: (table) => rlsTables.has(bare(table)),','rlsEnabled: (table) => table !== "engagement_public_translation_requests" && rlsTables.has(bare(table)),','reads every relation the migrations declare')
mutate('missing-upgrade-migration','changelog','`20261014000020_engagement_public_translation_queue.sql`.', '`migration name omitted`.', "the CHANGELOG's Unreleased section names every migration landed since the newest tag")
results=[]
try:
 for name,key,body,expected in cases:
  assert all(paths[k].read_text()==v for k,v in originals.items());output=private/(name+'.json');paths[key].write_text(body)
  args=['npm','exec','--','vitest','run',*tests,'--reporter=json','--outputFile='+str(output)]
  if expected:args+=['-t',re.escape(expected)]
  try:run=subprocess.run(args,cwd=app,text=True,capture_output=True,timeout=35)
  finally:paths[key].write_text(originals[key])
  (private/(name+'.log')).write_text(run.stdout+run.stderr);report=json.loads(output.read_text());failed=[a['fullName'] for suite in report['testResults'] for a in suite['assertionResults'] if a['status']=='failed']
  assert report['numPassedTests']+report['numFailedTests']>0,(name,'no selected tests')
  correct=run.returncode==0 and report['numPassedTests']==40 if expected is None else run.returncode!=0 and any(expected in f for f in failed)
  results.append({'case':name,'file':str(paths[key].relative_to(root)),'outcome':'survived' if run.returncode==0 else 'killed','expectedFailure':expected,'failedTests':failed,'expectedOutcome':correct});print(name,correct,flush=True);assert correct,(name,failed)
finally:
 assert all(paths[k].read_text()==v for k,v in originals.items())
 (review/'public-release-record-controls.json').write_text(json.dumps({'files':{str(paths[k].relative_to(root)):hashlib.sha256(v.encode()).hexdigest() for k,v in originals.items()},'privateEvidence':str(private),'results':results,'limits':'Static source/schema accounting and changelog inclusion. The census checks parser visibility, not database enforcement; installed RLS/custody faults and browser journeys establish runtime behavior separately. The SQL-only column reasons are backed by the recorded native queue tests, not inferred from their prose.'},indent=2)+'\n')
