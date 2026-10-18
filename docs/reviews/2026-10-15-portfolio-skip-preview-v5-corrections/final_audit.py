"""File custody, narrow mechanical comparison and public privacy audit only."""
import ast
import difflib
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
HERE=Path(__file__).resolve().parent
ROOT=Path('/home/nathaniel/.local/state/openplan/project-portfolio-skip-preview-20261015-v5')
V4=Path('/home/nathaniel/.local/state/openplan/project-portfolio-skip-preview-20261015-v4')
def sha(path):
 h=hashlib.sha256()
 with path.open('rb') as f:
  for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
 return h.hexdigest()
def functions(path):return {n.name:ast.dump(n,include_attributes=False) for n in ast.parse(path.read_text()).body if isinstance(n,ast.FunctionDef)}
def main():
 spec=importlib.util.spec_from_file_location('v5prep',HERE/'prepare_v5.py');prep=importlib.util.module_from_spec(spec);spec.loader.exec_module(prep)
 before=json.loads((ROOT/'v4-full-inventory-before.json').read_text())
 after={name:prep.inventory(Path(name)) for name in before}
 assert before==after,'frozen-old-root-inventory-drift'
 with (ROOT/'old-roots-after-final-audit-03.json').open('x') as f:json.dump(after,f,indent=2);f.write('\n')
 manifest=json.loads((HERE/'manifest.json').read_text())
 assert all(sha(ROOT/name)==expected for name,expected in manifest['files'].items())
 assert sha(ROOT/'operation-files.sha256')==manifest['checksumListSHA256']
 subprocess.run(['/usr/bin/sha256sum','--check','--strict',str(ROOT/'operation-files.sha256')],check=True,stdout=subprocess.DEVNULL)
 for name in ['helper.py','policy.py','app_binding_v1.py','attest_start_v1.py','run_stage.sh','observer.py','observer_transport.py']:
  assert (ROOT/name).read_bytes()==(HERE/'templates'/name).read_bytes()
  if (V4/name).exists():
   diff=''.join(difflib.unified_diff((V4/name).read_text().splitlines(True),(ROOT/name).read_text().splitlines(True),fromfile=str(V4/name),tofile=name,n=0))
   assert diff==(HERE/(name+'.patch')).read_text()
 for name in ['app_binding_v1.py','attest_start_v1.py','policy.py']:
  assert functions(ROOT/name)==functions(V4/name),'inherited-function-changed:'+name
 old=functions(V4/'helper.py');new=functions(ROOT/'helper.py')
 for name in old.keys()-{'preserve','protected_web','unchanged_inputs','upgraded','main'}:assert old[name]==new[name],'unrelated-helper-function-changed:'+name
 old_tree=ast.parse((V4/'helper.py').read_text())
 node=next(n for n in old_tree.body if isinstance(n,ast.FunctionDef) and n.name=='unchanged_inputs')
 last=node.body[-1]
 assert isinstance(last,ast.Expr) and isinstance(last.value,ast.Call) and isinstance(last.value.func,ast.Name) and last.value.func.id=='preserve' and not last.value.args and not last.value.keywords
 node.body[-1]=ast.Return(value=last.value)
 assert ast.dump(node,include_attributes=False)==new['unchanged_inputs']
 assert (ROOT/'candidate17.sql').read_bytes()==(V4/'candidate17.sql').read_bytes()
 assert sha(ROOT/'candidate17.sql')=='b129f80e37aa9be71069683acd42df3fb6fdb94078ed0458f20b6e9c5155a41b'
 for name in ['app-env-private.json','app-v1.env','dependency-binding.json','source-binding-private.json','configured-source-private.json','migrations.json','upgrade-expectations.json']:
  assert (ROOT/name).read_bytes()==(V4/name).read_bytes(),'immutable-binding-changed:'+name
 envs=json.loads((ROOT/'envs-private.json').read_text());old_envs=json.loads((V4/'envs-private.json').read_text())
 for kind,key in [('rest','PGRST_DB_URI'),('auth','GOTRUE_DB_DATABASE_URL'),('storage','DATABASE_URL')]:assert envs[kind][key]==old_envs[kind][key]
 assert not list((ROOT/'execution').iterdir()) and not (ROOT/'candidate').exists()
 for name in ['clone-intent.json','target-identity.json','upgrade-ready.json','service-receipts-private.json','runtime-start-attestation.json','post-journey-result.json','storage-objects','source-private.dump']:assert not (ROOT/name).exists()
 assert ROOT.stat().st_mode&0o777==0o700
 for name in manifest['files']:assert (ROOT/name).stat().st_mode&0o777==(0o700 if name=='run_stage.sh' else 0o600)
 for path in HERE.glob('*.py'):compile(path.read_text(),str(path),'exec')
 for path in [HERE/'parent_recipe.sh',ROOT/'run_stage.sh']:
  good=subprocess.run(['/bin/sh','-n'],input=('# harmless\n'+path.read_text()).encode(),capture_output=True);assert good.returncode==0
  bad=subprocess.run(['/bin/sh','-n'],input=(path.read_text()+'\nif\n').encode(),capture_output=True);assert bad.returncode!=0 and b'Syntax error' in bad.stderr
 assert (ROOT/'parent_recipe.sh').read_bytes()==(HERE/'parent_recipe.sh').read_bytes()
 # Actual context code matches the currently pinned observer. Values are hashes only.
 contexts=json.loads((HERE/'context-evidence.json').read_text())
 for item in contexts['actualContexts']:
  value=item['oldWebObservation'];assert value['observerSHA256']==sha(ROOT/'observer.py')
  assert item['boundaryEnvironment']=={'hasXDG':False,'hasDBus':False}
  assert all(p['writeOpenErrno']==30 for p in item['readonlyProtectedPaths'])
 # Known-secret screen covers authorized copied credentials and full role URIs.
 secret_values=set()
 for obj in [json.loads((ROOT/'app-env-private.json').read_text()),*envs.values()]:
  for key,value in obj.items():
   if any(word in key for word in ['KEY','SECRET','DATABASE_URL','DB_URI']) and len(value)>15:secret_values.add(value.encode())
 assert secret_values,'empty-known-secret-screen'
 def screen(data):
  assert not any(value in data for value in secret_values),'known-secret-in-public'
  assert bytes.fromhex('e28094') not in data,'em-dash'
 def detects(fn,data,reason):
  try:fn(data)
  except AssertionError as error:
   assert str(error)==reason;return
  raise AssertionError('privacy-detector-missing-'+reason)
 screen(b'Harmless public wording')
 detects(screen,next(iter(secret_values)),'known-secret-in-public')
 detects(screen,bytes.fromhex('e28094'),'em-dash')
 try:detects(lambda data:None,next(iter(secret_values)),'known-secret-in-public')
 except AssertionError as error:assert str(error)=='privacy-detector-missing-known-secret-in-public'
 else:raise AssertionError('disabled-privacy-scanner-survived')
 for path in HERE.rglob('*'):
  if path.is_file():screen(path.read_bytes())
 report={'preparedOnly':True,'permittedOldWebContextTestsOnly':True,'operatingStages':0,'oldRootInventoriesExact':True,
  'oldRootEntries':{name:len(items) for name,items in before.items()},'oldInventoryBeforeSHA256':sha(ROOT/'v4-full-inventory-before.json'),
  'oldInventoryAfterSHA256':sha(ROOT/'old-roots-after-final-audit-03.json'),'sealedFiles':len(manifest['files']),
  'manifestSHA256':sha(HERE/'manifest.json'),'checksumListSHA256':manifest['checksumListSHA256'],
  'parentRecipeSHA256':sha(HERE/'parent_recipe.sh'),'observerSHA256':sha(ROOT/'observer.py'),'transportSHA256':sha(ROOT/'observer_transport.py'),
  'publicPrivateAndDiffsMatch':True,'unchangedInheritedFunctionsMatch':True,'APP49Unchanged':True,'appEnvAndCandidateExactV4':True,
  'candidateAbsent':True,'executionEmpty':True,'postJourneyResultAbsent':True,'knownSecretsScreenPass':True,'privacyHarmlessAndInjectionAndDisabledCodeControls':True,
  'blindCategories':['No SQL transport, parsing, normalization or preservation run.','No new helper/app build/runtime/journey evidence.','Filesystem custody and known-value screening do not prove hostile-host security or unknown-secret absence.','User manager and same-user code/tool custody remain trusted.']}
 with (ROOT/'final-audit-03.json').open('x') as f:json.dump(report,f,indent=2);f.write('\n')
 (HERE/'final-audit.json').write_text(json.dumps(report,indent=2)+'\n')
 print(json.dumps({'oldRoots':len(before),'oldRootEntries':sum(len(x) for x in before.values()),'sealedFiles':len(manifest['files']),'manifestSHA256':report['manifestSHA256'],'operatingStages':0}))
if __name__=='__main__':main()
