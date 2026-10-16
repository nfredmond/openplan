"""Prepare new v5 files only. Never dispatch an operating stage or observer."""
import ast
import difflib
import hashlib
import json
import os
from pathlib import Path
import shutil

HERE=Path(__file__).resolve().parent
REPO=HERE.parents[2]
V4=Path('/home/nathaniel/.local/state/openplan/project-portfolio-skip-preview-20261015-v4')
ROOT=Path('/home/nathaniel/.local/state/openplan/project-portfolio-skip-preview-20261015-v5')
PUBLIC4=REPO/'docs/reviews/2026-10-15-portfolio-skip-preview-v4-preparation'
HEAD='49e3fa2004c1336ffa36c134a8f21bcc2d72d327'
CHECKS={
 'statusConstraint':"CHECK (((decision <> 'create'::text) OR (resolved_status = ANY (ARRAY['draft'::text, 'active'::text, 'on_hold'::text, 'complete'::text]))))",
 'phaseConstraint':"CHECK (((decision <> 'create'::text) OR (resolved_delivery_phase = ANY (ARRAY['scoping'::text, 'analysis'::text, 'engagement'::text, 'programming'::text, 'delivery'::text, 'complete'::text]))))"}

def sha(path):
 h=hashlib.sha256()
 with path.open('rb') as f:
  for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
 return h.hexdigest()
def inventory(root):
 result={'.':{'mode':root.stat().st_mode&0o777,'kind':'directory'}}
 for p in sorted(root.rglob('*')):
  record={'mode':p.lstat().st_mode&0o777}
  if p.is_symlink():record.update(kind='symlink',target=os.readlink(p))
  elif p.is_dir():record.update(kind='directory')
  else:record.update(kind='file',bytes=p.stat().st_size,sha256=sha(p))
  result[str(p.relative_to(root))]=record
 return result
def put(name,value):
 path=ROOT/name
 with path.open('xb') as f:f.write(value.encode() if isinstance(value,str) else value)
 path.chmod(0o600)
def js(name,value):put(name,json.dumps(value,indent=2)+'\n')
def read(name):return json.loads((V4/name).read_text())
def replace_function(text,name,replacement):
 tree=ast.parse(text);node=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name==name)
 lines=text.splitlines(True);return ''.join(lines[:node.lineno-1])+replacement.rstrip()+'\n'+''.join(lines[node.end_lineno:])

def main():
 os.umask(0o077)
 if ROOT.exists() or ROOT.is_symlink():raise ValueError('v5-root-reserved')
 old_roots=[V4,PUBLIC4,Path('/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/project-geography-preview-final-20261015'),Path('/home/nathaniel/.local/state/openplan/current-project-preview-app-binding-20261015-v3'),Path('/home/nathaniel/.local/state/openplan/current-project-preview-host-attestation-v2-20261015')]
 before={str(p):inventory(p) for p in old_roots}
 ROOT.mkdir(mode=0o700)
 for name in ['execution','tmp','home','cache','npm-cache','observer-home','observer-receipts','context-tests']:(ROOT/name).mkdir(mode=0o700)
 (HERE/'templates').mkdir()
 js('v4-full-inventory-before.json',before)
 for name in ['source-binding-private.json','storage-binding-private.json','input-bindings-private.json','old-helper-bindings-private.json','configured-source-private.json','dependency-binding.json','candidate17.sql','migrations.json','upgrade-expectations.json','protected-databases.json','acl-private.json']:
  put(name,(V4/name).read_bytes())
 plan=read('plan-private.json');plan['root']=str(ROOT)
 plan['names']={k:v.replace('-v4-','-v5-') for k,v in plan['names'].items()};js('plan-private.json',plan)
 # Only helper service DNS names change. Endpoints, target, secrets and app SHA do not.
 def names(value):
  if isinstance(value,str):
   for k,old in read('plan-private.json')['names'].items():value=value.replace(old,plan['names'][k])
   return value
  if isinstance(value,list):return [names(v) for v in value]
  if isinstance(value,dict):return {k:names(v) for k,v in value.items()}
  return value
 for name in ['envs-private.json','kong-private.json']:js(name,names(read(name)))
 for name in ['app-env-private.json','app-v1.env']:put(name,(V4/name).read_bytes())
 # Keep existing old-root pins, and freeze every V4 public/private file and mode.
 pins=read('preservation-files.json')
 for base,items in before.items():
  if base not in [str(V4),str(PUBLIC4)]:continue
  for relative,entry in items.items():
   if entry['kind']=='file':pins[str(Path(base)/relative)]={'sha256':entry['sha256'],'mode':entry['mode']}
 js('preservation-files.json',pins)
 js('v4-full-inventory-binding.json',{'sha256':sha(ROOT/'v4-full-inventory-before.json')})
 js('expected-checks.json',{'migrationSHA256':'b129f80e37aa9be71069683acd42df3fb6fdb94078ed0458f20b6e9c5155a41b','postgresMajor':17,'derivation':'Fixed source reasoning: pg_get_constraintdef wraps CHECK, Boolean OR and explicit IN deparsing as = ANY with text-cast ARRAY elements. Values and operators follow exact candidate17.sql. No target read establishes or replaces this oracle. Any different normalization refuses for review.','constraints':CHECKS})
 (HERE/'expected-checks.json').write_bytes((ROOT/'expected-checks.json').read_bytes())
 for name in ['observer.py','observer_transport.py']:
  put(name,(HERE/name).read_bytes())
 policy=(V4/'policy.py').read_text().replace('project-portfolio-skip-preview-20261015-v4','project-portfolio-skip-preview-20261015-v5')
 put('policy.py',policy)
 helper=(V4/'helper.py').read_text()
 helper=helper.replace('Parent-only v4 operating stages','Parent-only v5 operating stages')
 helper=replace_function(helper,'protected_web',(HERE/'protected_web.txt').read_text())
 helper=replace_function(helper,'preserve',(HERE/'preserve.txt').read_text())
 helper=helper.replace('    preserve()\n\n\ndef target_identity',"    return preserve()\n\n\ndef target_identity")
 old="""    # The receipt below pins the exact server-normalized CHECK definitions too.
    for key in ['statusConstraint','phaseConstraint']:
        p.exact({'check':True},{'check':isinstance(actual.get(key),str) and \"decision <> 'create'::text\" in actual[key]},'upgrade-'+key)"""
 assert old in helper
 helper=helper.replace(old,"    expected_checks=read('expected-checks.json')\n    p.exact({'migrationSHA256':MIG_SHA},expected_checks,'expected-check-source')\n    p.exact(expected_checks['constraints'],actual,'upgrade-checks')")
 # The final observer is explicit and append-only; it never compares new app data to restore.
 insert=helper.index('\ndef main():')
 helper=helper[:insert]+(HERE/'post_journey.txt').read_text()+helper[insert:]
 helper=helper.replace("'verify-services':verify_services}","'verify-services':verify_services,'post-journey':post_journey}")
 helper=helper.replace("    p.files(read('storage-binding-private.json'),inventory(OLD_STORAGE))\n    return preserve()", "    p.files(read('storage-binding-private.json'),inventory(OLD_STORAGE))\n    return preserve()")
 # Only new sealed files extend the helper's pre-existing input bindings.
 put('helper.py',helper)
 app=(V4/'app_binding_v1.py').read_text().replace(str(V4),str(ROOT))
 start=app.index('HELPERS = ');end=app.index('\nGiB',start)
 app=app[:start]+'HELPERS = '+repr({n:sha(ROOT/n) for n in ['helper.py','policy.py']})+app[end:]
 put('app_binding_v1.py',app)
 att=(V4/'attest_start_v1.py').read_text().replace(str(V4),str(ROOT)).replace('-v4-web.service','-v5-web.service')
 start=att.index("BINDING_SHA = '")+len("BINDING_SHA = '");att=att[:start]+sha(ROOT/'app_binding_v1.py')+att[start+64:]
 put('attest_start_v1.py',att)
 runner=(V4/'run_stage.sh').read_text().replace(str(V4),str(ROOT)).replace('-v4-','-v5-')
 runner=runner.replace('services|verify-services)','services|verify-services|post-journey)')
 put('run_stage.sh',runner);(ROOT/'run_stage.sh').chmod(0o700)
 b=read('binding-private.json');b['files']={n:sha(ROOT/n) for n in b['files']};js('binding-private.json',b)
 bindings={n:sha(ROOT/n) for n in read('private-bindings.json')}
 bindings.update({n:sha(ROOT/n) for n in ['expected-checks.json','v4-full-inventory-before.json','v4-full-inventory-binding.json','observer.py','observer_transport.py']});js('private-bindings.json',bindings)
 js('template-binding.json',{n:sha(ROOT/n) for n in ['helper.py','policy.py']})
 # Transport script is hash-pinned in the helper, and the host observer in transport.
 transport=(ROOT/'observer_transport.py').read_text().replace('__OBSERVER_SHA__',sha(ROOT/'observer.py'))
 (ROOT/'observer_transport.py').write_text(transport)
 helper=(ROOT/'helper.py').read_text().replace('__TRANSPORT_SHA__',sha(ROOT/'observer_transport.py'))
 (ROOT/'helper.py').write_text(helper)
 app=(ROOT/'app_binding_v1.py').read_text();start=app.index('HELPERS = ');end=app.index('\nGiB',start)
 app=app[:start]+'HELPERS = '+repr({n:sha(ROOT/n) for n in ['helper.py','policy.py']})+app[end:];(ROOT/'app_binding_v1.py').write_text(app)
 att=(ROOT/'attest_start_v1.py').read_text();start=att.index("BINDING_SHA = '")+len("BINDING_SHA = '");att=att[:start]+sha(ROOT/'app_binding_v1.py')+att[start+64:];(ROOT/'attest_start_v1.py').write_text(att)
 for name in ['private-bindings.json','template-binding.json']:
  b=json.loads((ROOT/name).read_text());(ROOT/name).write_text(json.dumps({n:sha(ROOT/n) for n in b},indent=2)+'\n')
 b=json.loads((ROOT/'binding-private.json').read_text());b['files']={n:sha(ROOT/n) for n in b['files']};(ROOT/'binding-private.json').write_text(json.dumps(b,indent=2)+'\n')
 files={p.name:sha(p) for p in sorted(ROOT.iterdir()) if p.is_file()}
 put('operation-files.sha256',''.join(h+'  '+str(ROOT/n)+'\n' for n,h in files.items()))
 for name in ['helper.py','policy.py','app_binding_v1.py','attest_start_v1.py','run_stage.sh','observer.py','observer_transport.py']:
  new=(ROOT/name).read_text();(HERE/'templates'/name).write_text(new)
  if (V4/name).exists():
   (HERE/(name+'.patch')).write_text(''.join(difflib.unified_diff((V4/name).read_text().splitlines(True),new.splitlines(True),fromfile=str(V4/name),tofile=name,n=0)))
 after={str(p):inventory(p) for p in old_roots}
 if before!=after:raise ValueError('v4-changed')
 js('v4-full-inventory-after-preparation.json',after)
 manifest={'schema':1,'preparedOnly':True,'appHead':HEAD,'root':str(ROOT),'targetProposal':plan['target'],'targetAllocated':False,'api':plan['api'],'web':plan['web'],'files':files,'checksumListSHA256':sha(ROOT/'operation-files.sha256'),'V4Preserved':True,'V4InventorySHA256':sha(ROOT/'v4-full-inventory-before.json'),'reviewRequired':'Fresh independent ROUND2 before any operating stage. R1 context test is old-web observation only.'}
 (HERE/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');js('preparation.json',manifest)
 print(json.dumps({'preparedOnly':True,'sealedFiles':len(files),'V4Preserved':True}))
if __name__=='__main__':main()
