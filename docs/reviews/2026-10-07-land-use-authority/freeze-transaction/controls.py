"""Probe candidate freeze DDL and faults inside rollback-only native transactions."""
import argparse,hashlib,json,subprocess
from pathlib import Path
parser=argparse.ArgumentParser()
parser.add_argument('--app',type=Path,required=True)
parser.add_argument('--container',required=True)
parser.add_argument('--output',type=Path,required=True)
args=parser.parse_args();app=args.app.resolve()
subprocess.run(['npm','exec','--','tsx','-e','import {requireContractVerificationStack} from "./src/test/helpers/contract-verification-stack"; requireContractVerificationStack(process.argv[1]);',args.container],cwd=app,check=True,capture_output=True)
migration=app/'supabase/migrations/20261016000004_land_use_plan_freeze_commands.sql'
fixture=app/'src/test/fixtures/land-use-plans/freeze-persistence.sql'
original=migration.read_text();test=fixture.read_text()
args.output.mkdir(parents=True,exist_ok=False)
cases=[('baseline',None,None,None),('harmless',None,'\n-- Harmless verification comment.\n',None),
 ('revision-guard','working.draft_revision IS DISTINCT FROM p_expected_draft_revision','false','stale-revision readiness or precondition refused: accepted'),
 ('current-pointer','plan_row.current_working_version_id IS DISTINCT FROM p_version_id','false','noncurrent-version readiness or precondition refused: accepted'),
 ('permission',"AND role IN ('owner','admin','member')",'', 'viewer freeze refused: accepted'),
 ('replay-actor','previous.actor_id IS DISTINCT FROM p_actor_id','false','other writer cannot reuse command: accepted'),
 ('replay-version','previous.version_id IS DISTINCT FROM p_version_id','false','changed replay version refused: accepted'),
 ('replay-revision','previous.expected_draft_revision IS DISTINCT FROM p_expected_draft_revision','false','changed replay revision refused: accepted'),
 ('replay-bytes','previous.command_text IS DISTINCT FROM p_command_text','false','changed request bytes refused: accepted'),
 ('descriptor-edition',"IF p_descriptor_text IS NULL OR declared_rules IS DISTINCT FROM rules\n     OR encode(extensions.digest(p_descriptor_text,'sha256'),'hex') IS DISTINCT FROM command->>'expectedDescriptorHash' THEN",'IF false THEN','descriptor substitution refused: accepted'),
 ('snapshot-identity',"AND snapshot#>>'{plan,title}'=plan_row.title",'', 'plan identity substitution refused: accepted'),
 ('snapshot-revision',"AND snapshot#>'{version,draftRevision}'=to_jsonb(p_expected_draft_revision)",'','snapshot revision substitution refused: accepted'),
 ('required-sections',"AND btrim(body,trim_chars)<>''",'', 'section-whitespace readiness or precondition refused: accepted'),
 ('required-descriptor-section',"WHERE requirement->>'applicability'='required'",'WHERE false','required-section readiness or precondition refused: accepted'),
 ('required-process',"AND step->'reviewPrerequisite'='true'::jsonb",'AND false','process readiness or precondition refused: accepted'),
 ('required-consultation',"WHERE step->>'key'='tribal_consultation' AND step->'required'='true'::jsonb",'WHERE false','consultation readiness or precondition refused: accepted'),
 ('pointer-clear','UPDATE public.land_use_plans SET current_working_version_id=NULL WHERE id=p_plan_id;','NULL;','working pointer cleared'),
 ('hash-original-bytes',"snapshot_hash:=encode(extensions.digest(p_snapshot_text,'sha256'),'hex');", "snapshot_hash:=repeat('a',64);", 'frozen hash covers original bytes'),
 ('event-attribution',"'Frozen public draft '||snapshot_hash,p_actor_id)","'Frozen public draft '||snapshot_hash,NULL)",'one attributed event'),
 ('journal-rls','ALTER TABLE public.land_use_plan_freeze_commands ENABLE ROW LEVEL SECURITY;','','journal RLS enabled'),
 ('journal-read-grant','GRANT SELECT, INSERT ON public.land_use_plan_freeze_commands TO service_role;','GRANT SELECT, INSERT ON public.land_use_plan_freeze_commands TO service_role; GRANT SELECT ON public.land_use_plan_freeze_commands TO authenticated;','private journal'),
 ('rpc-definer',') RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER',') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER','security invoker'),
 ('helper-definer','RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER','RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER','snapshot helper security invoker'),
 ('helper-grant','GRANT EXECUTE ON FUNCTION public.land_use_plan_freeze_content(uuid) TO service_role;','GRANT EXECUTE ON FUNCTION public.land_use_plan_freeze_content(uuid) TO service_role,authenticated;','private snapshot helper'),
]
for field in ['nodes','relationships','designations','implementationActions']:
 cases.append(('snapshot-'+field,"snapshot->'"+field+"' IS DISTINCT FROM current_content->'"+field+"'",'false',field+' omission refused: accepted'))
cases.extend([
 ('projection-nodes','node_kind,requirement_key,title,body,sort_order','node_kind,requirement_key,title,sort_order','nodes exact projection'),
 ('projection-relationships','relationship_kind,notes','relationship_kind','relationships exact projection'),
 ('projection-designations','d.public_field_keys,d.legend_field,d.map_note','d.public_field_keys,d.legend_field','designations exact projection'),
 ('projection-actions','title,description,responsible_party,due_on','title,responsible_party,due_on','implementationActions exact projection'),
])
# Replace whole readiness clauses so later gates cannot mask the intended fault.
start=original.index('  IF NOT EXISTS (SELECT 1 FROM public.land_use_plan_designations d JOIN')
end=original.index('  IF NOT EXISTS (SELECT 1 FROM public.land_use_plan_implementation_actions',start)
cases.append(('missing-designations',original[start:end],'','designations readiness or precondition refused: accepted'))
start=end;end=original.index('  FOR required_key IN SELECT step',start)
cases.append(('missing-actions',original[start:end],'','actions readiness or precondition refused: accepted'))
start=original.index('CREATE TRIGGER land_use_plan_freeze_commands_append_only')
end=original.index('\n\n',start)
cases.append(('journal-rewrite',original[start:end],'','journal rewrite refused: accepted'))
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
  matched=(r.returncode==0 and 'freeze persistence verified' in output) if marker is None else r.returncode!=0 and marker in output
  rows.append({'case':name,'exitCode':r.returncode,'target':marker,'matched':matched})
  if not matched:raise RuntimeError(name+': unexpected test outcome; inspect retained log')
finally:
 unchanged=migration.read_text()==original and fixture.read_text()==test
 (args.output/'report.json').write_text(json.dumps({'cases':rows,'sourceUnchanged':unchanged,'migrationSha256':hashlib.sha256(original.encode()).hexdigest(),'fixtureSha256':hashlib.sha256(test.encode()).hexdigest()},indent=2)+'\n')
print(json.dumps({'cases':len(rows),'allMatched':all(r['matched'] for r in rows),'sourceUnchanged':unchanged}))
