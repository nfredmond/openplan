import hashlib,json,subprocess,os
from pathlib import Path
root=Path(__file__).resolve().parents[4];app=root/'openplan'
page=app/'src/app/(app)/models/page.tsx';migration=app/'supabase/migrations/20261016000023_model_recovery_decisions.sql';changelog=root/'CHANGELOG.md';originals={p:p.read_text() for p in [page,migration,changelog]}
tests=['src/test/county-models-pages-disclose-failed-reads.test.tsx','src/test/a-column-nothing-reads-is-a-question.test.ts','src/test/migrations/inventory.test.ts','src/test/migrations/release-ordering.test.ts']
controls=[('baseline',page,None,None,None),('harmless',page,originals[page]+'\n// Harmless catalog explanation.\n',None,None),('omit-count-projection',page,originals[page].replace(', model_runs(count)',''),'counts saved model executions separately','model_runs(count)'),('invent-zero',page,originals[page].replace('? savedCount : null;', '? savedCount : 0;'),'keeps an unassessed saved-run count unavailable','Unable to find'),('count-links-as-executions',page,originals[page].replace('        modelRunCount,','        modelRunCount: workspaceSummary.linkageCounts.runs,'),'counts saved model executions separately','Unable to find'),('untracked-relation',migration,originals[migration]+'\nCREATE TABLE public.openplan_mutation_probe(id uuid);\n','reads every relation the migrations declare','321'),('unread-column',migration,originals[migration]+'\nALTER TABLE public.model_run_recovery_receipts ADD COLUMN unassessed_probe text;\n','finds no unread column that is not accounted for','unassessed_probe'),('omit-upgrade-note',changelog,originals[changelog].replace('20261016000023_model_recovery_decisions.sql','model recovery migration'),"the CHANGELOG's Unreleased section names every migration",'20261016000023_model_recovery_decisions.sql'),('restored',page,None,None,None)]
out=Path(os.environ['OPENPLAN_CATALOG_SCHEMA_CONTROLS_OUTPUT']);out.mkdir(exist_ok=False);records=[]
try:
 for name,p,changed,target,marker in controls:
  for f,s in originals.items():f.write_text(s)
  if changed is not None:assert changed!=originals[p];p.write_text(changed)
  cmd=['npm','test','--','--maxWorkers=1',*tests]
  if target:cmd+=['-t',target]
  r=subprocess.run(cmd,cwd=app,capture_output=True,text=True,timeout=90);log=r.stdout+r.stderr;(out/(name+'.log')).write_text(log)
  if target:assert r.returncode!=0 and marker in log and target in log,name+log
  else:assert r.returncode==0,log
  records.append({'control':name,'exit_code':r.returncode,'target':target,'failure_marker':marker})
finally:
 for f,s in originals.items():f.write_text(s)
report={'controls':records,'sha256':{str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in [*originals,*[app/t for t in tests]]},'limits':'Mocked page queries and source migration parsing. Not browser visual acceptance, installed SQL mutation, or whole-suite CI. Native catalog count and authenticated aggregate are separate observations.'}
(root/'docs/reviews/2026-10-08-model-custody-metadata/prototype/catalog-schema-controls.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
