"""One-time file preparation only. No database, Docker, npm or browser dispatch."""
import difflib
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
from urllib.parse import urlsplit, urlunsplit

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
ROOT = Path('/home/nathaniel/.local/state/openplan/project-portfolio-skip-preview-20261015-v4')
OLD = Path('/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/project-geography-preview-final-20261015')
V3 = Path('/home/nathaniel/.local/state/openplan/current-project-preview-app-binding-20261015-v3')
HOST = Path('/home/nathaniel/.local/state/openplan/current-project-preview-host-attestation-v2-20261015')
HEAD = '49e3fa2004c1336ffa36c134a8f21bcc2d72d327'
TARGET = 'openplan_project_portfolio_preview_8f43260b95a071cc4e6d2b90'
MIG = 'openplan/supabase/migrations/20261017000017_portfolio_skip_invalid_classifications.sql'
MIG_SHA = 'b129f80e37aa9be71069683acd42df3fb6fdb94078ed0458f20b6e9c5155a41b'
DUMP_SHA = '181caa01d5ebe66b50da9dcba1242b225e75cfdc8bd0fe03e3c4a9ae86e4d398'

def sha(p):
 h=hashlib.sha256()
 with Path(p).open('rb') as f:
  for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
 return h.hexdigest()
def read(p):return json.loads(Path(p).read_text())
def put(name,data):
 p=ROOT/name
 with p.open('xb') as f:f.write(data.encode() if isinstance(data,str) else data)
 p.chmod(0o600)
def js(name,data):put(name,json.dumps(data,indent=2)+'\n')
def template(name,base,text):
 original=base.read_text() if base else ''
 put(name,text)
 (HERE/'templates'/name).write_text(text)
 (HERE/(name+'.patch')).write_text(''.join(difflib.unified_diff(original.splitlines(True),text.splitlines(True),fromfile=str(base) if base else '/dev/null',tofile=name,n=0)))

def main():
 os.umask(0o077)
 assert subprocess.check_output(['/usr/bin/git','-C',str(REPO),'rev-parse','HEAD']).decode().strip()==HEAD
 assert not ROOT.exists() and not ROOT.is_symlink(), 'new-root-reserved'
 # Read socket inventory only. Parent's last-moment bind probes remain required.
 rows=subprocess.check_output(['/usr/bin/ss','-H','-ltn','sport = :29949 or sport = :3586']).decode()
 assert not rows.strip(), 'new-ports-occupied'
 assert sha(OLD/'source-private.dump')==DUMP_SHA and (OLD/'source-private.dump').stat().st_size==16232305
 assert sha(REPO/MIG)==MIG_SHA
 ROOT.mkdir(mode=0o700)
 for name in ['execution','tmp','home','cache','npm-cache']: (ROOT/name).mkdir(mode=0o700)
 # Small frozen files only. No source dump, Storage, caches or candidate is copied.
 for name in ['source-binding-private.json','storage-binding-private.json','input-bindings-private.json','old-helper-bindings-private.json','configured-source-private.json']:
  put(name,(OLD/name).read_bytes())
 put('dependency-binding.json',(V3/'dependency-binding.json').read_bytes())
 put('candidate17.sql',(REPO/MIG).read_bytes())
 baseline=read(OLD/'candidate-migrations.json')
 assert len(baseline)==419
 current={str(p.relative_to(REPO)):sha(p) for p in sorted((REPO/'openplan/supabase/migrations').glob('*.sql'))}
 assert current=={**baseline,MIG:MIG_SHA} and len(current)==420
 js('migrations.json',current)
 plan=read(OLD/'plan-private.json');oldtarget=plan['target']
 plan.update(head=HEAD,target=TARGET,api='http://127.74.19.11:29949',web='http://127.74.19.11:3586',root=str(ROOT))
 plan['names']={k:'openplan-portfolio-v4-'+k+'-8f43260b95a0' for k in ['rest','auth','storage','gateway']}
 js('plan-private.json',plan)
 acl=read(OLD/'acl-private.json');acl['sql']=acl['sql'].replace(oldtarget,TARGET);js('acl-private.json',acl)
 # Use the successful native-URI recovery input, preserving existing role passwords.
 envs=read(OLD/'rest-uri-recovery-01/envs-v1-private.json')
 for kind,key in {'rest':'PGRST_DB_URI','auth':'GOTRUE_DB_DATABASE_URL','storage':'DATABASE_URL'}.items():
  u=urlsplit(envs[kind][key]);envs[kind][key]=urlunsplit(u._replace(path='/'+TARGET))
 def rebind(x):
  if isinstance(x,str):
   x=x.replace('127.74.19.10:29948','127.74.19.11:29949').replace('127.74.19.10:3585','127.74.19.11:3586')
   for k,v in read(OLD/'plan-private.json')['names'].items():x=x.replace(v,plan['names'][k])
   return x
  if isinstance(x,list):return [rebind(v) for v in x]
  if isinstance(x,dict):return {k:rebind(v) for k,v in x.items()}
  return x
 envs=rebind(envs);app=rebind(read(V3/'app-env-private.json'));app['OPENPLAN_COMMIT_SHA']=HEAD
 js('envs-private.json',envs);js('app-env-private.json',app)
 put('app-v1.env',''.join(k+'='+json.dumps(v)+'\n' for k,v in app.items()))
 js('kong-private.json',rebind(read(OLD/'kong-private.json')))
 # Preserve every immediate old-packet file and nested operational receipts, not runtime caches.
 pins={}
 for root in [OLD,V3,HOST]:
  for p in root.iterdir():
   if p.is_file() and not p.is_symlink():pins[str(p)]={'sha256':sha(p),'mode':p.stat().st_mode&0o777}
 for directory in [OLD/'rest-uri-recovery-01',V3/'execution']:
  for p in directory.iterdir():
   if p.is_file() and not p.is_symlink():pins[str(p)]={'sha256':sha(p),'mode':p.stat().st_mode&0o777}
 js('preservation-files.json',pins)
 # Fixed source/old target facts are not refreshed to pass a check.
 js('protected-databases.json',[oldtarget,'openplan_portfolio_skip_137003c3b2dc1aa54af843e5'])
 oldbody=(REPO/'openplan/supabase/migrations/20260905000001_portfolio_unknown_price_year.sql').read_text().split('CREATE OR REPLACE FUNCTION public.commit_project_portfolio_import_v2(',1)[1].split('AS $$',1)[1].split('$$;',1)[0]
 newbody=(REPO/MIG).read_text().split('AS $$',1)[1].split('$$;',1)[0]
 snapshot=read(OLD/'source-binding-private.json')['snapshot']
 hist=next(x for x in snapshot if x.get('table')=='supabase_migrations.schema_migrations')
 js('upgrade-expectations.json',{'oldBody':oldbody,'newBody':newbody,'history':hist,'versions':next(x['versions'] for x in snapshot if 'versions' in x),'candidateSHA256':MIG_SHA})
 # Reuse native URI policy and successful old helper primitives, never old entrypoints.
 policy=(OLD/'rest_uri_recovery_01_policy.py').read_text().replace("HEAD = '06a108010ab39aa42eed4c2bcda3e1371b8aa813'",f"HEAD = '{HEAD}'")
 policy=policy.replace("HOST = '127.74.19.10'","HOST = '127.74.19.11'").replace(':29948',':29949').replace(':3585',':3586')
 policy=policy.replace("PURPOSE = 'project-geography-preview-final-20261015'","PURPOSE = 'project-portfolio-skip-preview-20261015-v4'")
 policy=policy.replace("ROOT = '/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/' + PURPOSE","ROOT = '/home/nathaniel/.local/state/openplan/' + PURPOSE")
 policy=policy.replace('openplan_project_combined_preview_','openplan_project_portfolio_preview_')
 template('policy.py',OLD/'rest_uri_recovery_01_policy.py',policy)
 helper=(OLD/'launcher.py').read_text().replace('Private parent-operated preview preparation. Default command is pure controls.\n\nNo cleanup, migrations, global role changes, hosted calls, downloads or resets.','Parent-only v4 operating stages. Preparation never dispatches these stages.\n\nOnly the new target receives the exact migration-17 upgrade. No source capture,\nglobal role changes, hosted calls, downloads, cleanup or resets.')
 helper=helper.replace("OLD = OUT.parent / 'stage-a-main323-preview-20261015'", "OLD = Path('/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/stage-a-main323-preview-20261015')")
 helper=helper.replace('29948','29949').replace('3585','3586')
 start=helper.index('    dump=OUT/\'source-private.dump\'')
 end=helper.index("    args=['docker','exec',p.DB_ID,'createdb'",start)
 helper=helper[:start]+"    dump=FROZEN/'source-private.dump'\n    retained_dump()\n"+helper[end:]
 helper=helper.replace("read('dump-result.json')['sha256']","DUMP_SHA")
 helper=helper.replace("    p.configuration(plan,read('envs-private.json'),read('kong-private.json'),app,optional)","    p.native_rest_uri(read('envs-private.json')['rest']['PGRST_DB_URI'])\n    p.configuration(plan,read('envs-private.json'),read('kong-private.json'),app,optional)")
 helper=helper.replace("    p.files(read('storage-binding-private.json'),inventory(OLD_STORAGE))\n\n\ndef target_identity", "    p.files(read('storage-binding-private.json'),inventory(OLD_STORAGE))\n    preserve()\n\n\ndef target_identity")
 helper=helper.replace("    plan=pinned_files();db_check();target_check()", "    plan=pinned_files();db_check();target_check();upgrade_ready()")
 helper=helper.replace("    plan=pinned_files();source_check();unchanged_inputs();free_ports();target_check()", "    plan=pinned_files();source_check();unchanged_inputs();free_ports();target_check();upgrade_ready()")
 # Helper has no application methods or controls dispatch. App owns its own stages.
 helper=helper[:helper.index('\ndef checkout():')]
 helper=helper.replace('    plan=pinned_files();source_check();unchanged_inputs();free_ports()\n','    plan=pinned_files();source_check();unchanged_inputs();free_ports();fresh_target()\n')
 helper=helper.replace("    target=plan['target'];props=plan['properties']", "    p.exact({'target':TARGET},{'target':read('preflight-ready.json')['target']},'preflight-readiness')\n    target=plan['target'];props=plan['properties']")
 # Strengthen append-only durability without changing log behavior.
 helper=helper.replace("with path.open('x') as stream:json.dump(value,stream,indent=2);stream.write('\\n')", "with path.open('x') as stream:\n        json.dump(value,stream,indent=2);stream.write('\\n');stream.flush();os.fsync(stream.fileno())\n    fd=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY)\n    try:os.fsync(fd)\n    finally:os.close(fd)")
 additions=(HERE/'helper_additions.py.txt').read_text()
 helper=helper.replace('def clone():','def restore():')+additions
 template('helper.py',OLD/'launcher.py',helper)
 # Reuse successful v3 build/start guards and host-v2 attestor, adapting only their new helper acquisition.
 a=(V3/'app_binding_v1.py').read_text().replace(str(V3),str(ROOT)).replace('21510042e94bcaf80f262205ad156a7bb639e35c',HEAD)
 a=a.replace("SOURCE_REPO = Path('/home/nathaniel/.t3/worktrees/openplan/t3-e33fc359')",f"SOURCE_REPO = Path('{REPO}')")
 a=a.replace('127.74.19.10','127.74.19.11').replace('29948','29949').replace('3585','3586')
 begin=a.index('def load_recovery():');end=a.index('\ndef bindings():',begin)
 a=a[:begin]+(HERE/'app_helper_acquisition.py.txt').read_text()+a[end:]
 begin=a.index('def app_values(r):');end=a.index('\ndef dependencies():',begin)
 a=a[:begin]+(HERE/'app_values.py.txt').read_text()+a[end:]
 a=a.replace("'recovery-active-binding.json', 'attest_start_v1.py'","'upgrade-expectations.json', 'attest_start_v1.py'")
 begin=a.index('HELPERS = {');end=a.index('\nGiB',begin)
 a=a[:begin]+"HELPERS = "+repr({n:sha(ROOT/n) for n in ['helper.py','policy.py']})+a[end:]
 template('app_binding_v1.py',V3/'app_binding_v1.py',a)
 att=(HOST/'attest_start_v2.py').read_text().replace(str(HOST),str(ROOT)).replace(str(V3),str(ROOT))
 att=att.replace('c195d3be5eb3bcafb016f8794bf77e704d940bbf878bd725a874d85559c58329',sha(ROOT/'app_binding_v1.py'))
 att=att.replace('openplan-current-project-preview-app-21510042e-v3-web.service','openplan-portfolio-skip-preview-49e3fa200-v4-web.service').replace('3585','3586').replace("{'expected':419,'latest':'20261017000016'}","{'expected':420,'latest':'20261017000017'}")
 att=att.replace("NEW_ROOT/'attest_start_v2.py'","NEW_ROOT/'attest_start_v1.py'")
 template('attest_start_v1.py',HOST/'attest_start_v2.py',att)
 # Remove obsolete old active identifiers from the new app module, not its preservation pins.
 # They are inert constants in the proven source; the diff retains them for review.
 js('binding-private.json',{'schema':1,'appHead':HEAD,'helperHead':'06a108010ab39aa42eed4c2bcda3e1371b8aa813','producer':'d71e0aa7aa1b2c3c945ee87a54ea49d6a5772378','sourceAnchor':read(OLD/'source-binding-private.json')['sha256'],'files':{n:sha(ROOT/n) for n in ['app_binding_v1.py','app-env-private.json','app-v1.env','migrations.json','dependency-binding.json','upgrade-expectations.json','attest_start_v1.py']}})
 js('private-bindings.json',{n:sha(ROOT/n) for n in ['plan-private.json','acl-private.json','envs-private.json','app-env-private.json','kong-private.json','source-binding-private.json','storage-binding-private.json','input-bindings-private.json','old-helper-bindings-private.json','configured-source-private.json','candidate17.sql','upgrade-expectations.json','protected-databases.json','preservation-files.json']})
 js('template-binding.json',{n:sha(ROOT/n) for n in ['policy.py','helper.py']})
 for n in ['run_stage.sh']:
  put(n,(HERE/'templates'/n).read_bytes());(ROOT/n).chmod(0o700)
 # Fixed external seal excludes receipts that cannot exist before actual execution.
 sealed={str(p):sha(p) for p in sorted(ROOT.iterdir()) if p.is_file()}
 put('operation-files.sha256',''.join(h+'  '+p+'\n' for p,h in sealed.items()))
 manifest={'schema':1,'preparedOnly':True,'appHead':HEAD,'targetProposal':TARGET,'targetAllocated':False,'source419':419,'expected420':420,'latest':'20261017000017','migrationSHA256':MIG_SHA,'dumpBytes':16232305,'dumpSHA256':DUMP_SHA,'api':plan['api'],'web':plan['web'],'root':str(ROOT),'files':{Path(p).name:h for p,h in sealed.items()},'checksumListSHA256':sha(ROOT/'operation-files.sha256'),'candidateAbsent':not (ROOT/'candidate').exists(),'runtimeReceiptAbsent':not (ROOT/'runtime-start-attestation.json').exists()}
 (HERE/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
 js('preparation.json',manifest)
 print(json.dumps({'preparedOnly':True,'files':len(sealed),'targetAllocated':False,'candidateAbsent':manifest['candidateAbsent']}))
if __name__=='__main__':main()
