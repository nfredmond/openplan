"""Probe candidate revision DDL and faults inside rollback-only native transactions."""
import argparse,hashlib,json,subprocess
from pathlib import Path
parser=argparse.ArgumentParser()
parser.add_argument('--app',type=Path,required=True)
parser.add_argument('--container',required=True)
parser.add_argument('--output',type=Path,required=True)
args=parser.parse_args();app=args.app.resolve()
subprocess.run(['npm','exec','--','tsx','-e','import {requireContractVerificationStack} from "./src/test/helpers/contract-verification-stack"; requireContractVerificationStack(process.argv[1]);',args.container],cwd=app,check=True,capture_output=True)
migration=app/'supabase/migrations/20261016000003_land_use_plan_draft_revision.sql'
fixture=app/'src/test/fixtures/land-use-plans/draft-revision.sql'
original=migration.read_text();test=fixture.read_text()
args.output.mkdir(parents=True,exist_ok=False)
cases=[('baseline',None,None,None),('harmless',None,'\n-- Harmless verification comment.\n',None)]
for table,label in [('content_nodes','node'),('relationships','relationship'),('designations','designation'),('designation_policy_links','policy link'),('implementation_actions','implementation'),('process_records','process'),('consultation_records','consultation')]:
 old="'land_use_plan_"+table+"'"
 # Remove an element without leaving an invalid array literal.
 if old+', ' in original:old+=', '
 elif old+',' in original:old+=','
 else:old=',\n    '+old
 cases.append(('omit-'+table,old,'',label+' insert revision delta'))
for field in ['title','descriptor_id','plan_kind_key','authority_label','geography_label','geography_geojson','plan_context']:
 label={'geography_geojson':'plan study geometry','plan_context':'saved plan context'}.get(field,'plan '+field)
 cases.append(('identity-'+field,'NEW.'+field+' IS NOT DISTINCT FROM OLD.'+field,'true',label+' revision delta'))
for field,label in [('version_number','version number'),('version_kind','version kind'),('based_on_version_id','base version'),('applicable_requirement_keys','applicability')]:
 cases.append(('metadata-'+field,'NEW.'+field+' IS DISTINCT FROM OLD.'+field,'false',label+' revision delta'))
cases.extend([
 ('initial-counter','IF NEW.draft_revision <> 0 THEN','IF false THEN','invented initial counter refused: accepted'),
 ('direct-counter',"NEW.draft_revision IS DISTINCT FROM OLD.draft_revision AND pg_trigger_depth() = 1",'false','direct counter overwrite refused: accepted'),
 ('ownership','NEW.id IS DISTINCT FROM OLD.id','false','version ownership rewrite refused: accepted'),
 ('frozen-counter',"OLD.state <> 'working' AND NEW.draft_revision IS DISTINCT FROM OLD.draft_revision",'false','nested frozen counter rewrite refused: accepted'),
 ('move-source','targets := ARRAY[OLD.version_id, NEW.version_id]','targets := ARRAY[NEW.version_id]','move source revision'),
 ('frozen-move',"TG_OP = 'UPDATE' AND OLD.version_id IS DISTINCT FROM NEW.version_id AND version_state <> 'working'",'false','move out of frozen content refused: accepted'),
 ('child-counter',"IF version_state = 'working' THEN",'IF false THEN','node insert revision delta'),
 ('identity-counter','IF FOUND THEN','IF false THEN','plan title revision delta'),
])
rows=[]
try:
 for name,old,new,marker in cases:
  candidate=original
  if old is None:candidate+=new or ''
  else:
   assert candidate.count(old)==1,(name,candidate.count(old))
   candidate=candidate.replace(old,new)
  r=subprocess.run(['docker','exec','-i',args.container,'psql','-U','postgres','-d','postgres','-qAt','-v','ON_ERROR_STOP=1'],input="BEGIN; SET LOCAL statement_timeout='15s';\n"+candidate+'\n'+test+'\nROLLBACK;',text=True,capture_output=True,timeout=25)
  output=r.stdout+r.stderr
  (args.output/(name+'.log')).write_text(output)
  matched=(r.returncode==0 and 'draft revision verified' in output) if marker is None else r.returncode!=0 and marker in output
  rows.append({'case':name,'exitCode':r.returncode,'target':marker,'matched':matched})
  if not matched:raise RuntimeError(name+': unexpected test outcome; inspect retained log')
finally:
 unchanged=migration.read_text()==original and fixture.read_text()==test
 (args.output/'report.json').write_text(json.dumps({'cases':rows,'sourceUnchanged':unchanged,'migrationSha256':hashlib.sha256(original.encode()).hexdigest(),'fixtureSha256':hashlib.sha256(test.encode()).hexdigest()},indent=2)+'\n')
print(json.dumps({'cases':len(rows),'allMatched':all(r['matched'] for r in rows),'sourceUnchanged':unchanged}))
