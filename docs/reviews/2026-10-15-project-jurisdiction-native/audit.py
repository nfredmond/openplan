"""Read-only final custody audit and sanitized proof publication for this native run."""
import contextlib,json,os,re,sys,uuid
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from native_proof import BASE,CLUSTER,SOURCE,Proof,digest,write,REPO,command
os.umask(0o077)
b=BASE/'run-fba198344db5';p=Proof(b)
out=b/('audit-'+uuid.uuid4().hex[:10]);out.mkdir(mode=0o700)
with contextlib.closing(p.source()) as c:
 source=p.inventory(c);snapshot=p.snapshot(c)
 original=json.loads((b/'source-inventory.json').read_text())
 assert source['history']==original['history'] and source['roles']==original['roles'] and source['roleMemberships']==original['roleMemberships'],'source history and global roles unchanged'
 assert snapshot==json.loads((b/'source-snapshot.json').read_text()),'source project and corridor rows unchanged'
 write(out/'source-final.json',source)
 identity=p.query(c,'select oid,datname,datdba::regrole::text owner,datcollate,datctype,datconnlimit from pg_database where datname=any(%s) order by datname',([SOURCE,*p.targets],))
 write(out/'databases.json',identity)
 for target in p.targets:
  with contextlib.closing(p.connection(target)) as c:
   inv=p.inventory(c)
   assert len(inv['history'])==419 and inv['history'][-1]['version']=='20261017000016','both targets419'
   sql=(REPO/'openplan/supabase/migrations/20261017000016_project_jurisdiction_context.sql').read_text()
   expected=re.findall(r'AS \$\$(.*?)\$\$;',sql,re.S)
   got=p.query(c,"select proname,prosrc from pg_proc where oid in ('public.guard_project_jurisdiction_context()'::regprocedure,'public.valid_project_jurisdiction_context(jsonb)'::regprocedure) order by proname")
   assert sorted(r['prosrc'] for r in got)==sorted(expected),'exact reviewed installed SQL bodies restored'
   write(out/(target+'-inventory.json'),inv)
 info=json.loads(command(['docker','inspect',CLUSTER]))[0]
 assert info['HostConfig']['Memory']==0 and info['HostConfig']['MemorySwap']==0,'retained cluster still unbounded'
containers=[]
for d in sorted(b.glob('transport-*')):
 if (d/'receipt.json').exists():
  receipt=json.loads((d/'receipt.json').read_text())
  if 'id' not in receipt:continue
  info=json.loads(command(['docker','inspect',receipt['id']]))[0]
  assert info['Config']['Labels']['openplan.purpose']=='project-jurisdiction-native-20261015' and not info['State']['Running'],'every owned helper stopped'
  containers.append({'id':info['Id'],'name':info['Name'],'database':receipt['database'],'running':False,'oomKilled':info['State']['OOMKilled'],'exitCode':info['State']['ExitCode']})
write(out/'containers.json',containers)
cohorts={}
for label,pattern in [('native','attempt-*'),('extended','extended-*'),('races','race-controls-*'),('transport','transport-*')]:
 candidates=[d for d in b.glob(pattern) if (d/'result.json').exists()]
 d=max(candidates,key=lambda d:(d/'result.json').stat().st_mtime)
 events=json.loads((d/'observations.json').read_text())
 cohorts[label]={'directory':d.name,'observations':len(events),'resultSha256':digest((d/'result.json').read_bytes()),'observationsSha256':digest((d/'observations.json').read_bytes()),'events':events}
# Sanitization drops complete rows and JWT response records, preserving hashes and error states.
def clean(value,key=''):
 if isinstance(value,dict):
  if 'status' in value and 'body' in value:
   body=value['body'];return {'status':value['status'],'code':body.get('code') if isinstance(body,dict) else None,'bodySha256':digest(body),'rowCount':len(body) if isinstance(body,list) else None}
  return {k:({'sha256':digest(v)} if k in ('before','after','insert','afterUpdate','ids') else clean(v,k)) for k,v in value.items()}
 if isinstance(value,list):return [clean(v) for v in value]
 return value
public=REPO/'docs/reviews/2026-10-15-project-jurisdiction-native'
source_files=['native_proof.py','transport_proof.py','extended_controls.py','race_controls.py','audit.py']
summary={'candidate':p.plan['candidate'],'migration16Sha256':p.plan['migration16Sha256'],'migration15Sha256':digest((BASE/'migration15.sql').read_bytes()),'cluster':CLUSTER,'serverVersion':source['identity'][0]['version'],
 'resources':json.loads((b/'resources.json').read_text()),'databases':identity,'containers':containers,'sourceUnchanged':{'history':True,'globalRolesAndMemberships':True,'projectAndCorridorRows':True},
 'cohorts':clean(cohorts),'runnerSha256':{name:digest((public/name).read_bytes()) for name in source_files},
 'snapshots':{name:digest((b/name).read_bytes()) for name in ['source-inventory.json','source-snapshot.json','before16.json','after16.json','restore-before.json','restore-after.json','target419-inventory.json']},
 'privateRoot':str(b),'finalAudit':out.name}
write(public/'proof.json',summary)
# Inventory is schema and permissions only. It contains no row data, DSNs, JWTs or passwords.
write(public/'installed-inventory.json',json.loads((out/(p.plan['databases']['up']+'-inventory.json')).read_text()))
write(out/'result.json',{'sourceAllRecordedRowsUnchanged':True,'bothTargets419':True,'reviewedFunctionBodiesExact':True,'allNewHelpersStopped':True})
print(json.dumps({'cohorts':{k:{'directory':v['directory'],'observations':v['observations']} for k,v in cohorts.items()},'containers':containers,'audit':out.name},indent=2))
