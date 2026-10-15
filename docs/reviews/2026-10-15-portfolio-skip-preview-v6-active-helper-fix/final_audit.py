"""V6 file-only custody, N1 delta and binding audit. No operating stage or live I/O."""
import ast
import difflib
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
HERE=Path(__file__).resolve().parent
ROOT=Path('/home/nathaniel/.local/state/openplan/project-portfolio-skip-preview-20261015-v6')
V5=ROOT.with_name('project-portfolio-skip-preview-20261015-v5')
PUBLIC5=HERE.with_name('2026-10-15-portfolio-skip-preview-v5-corrections')
SCRIPTS=['helper.py','policy.py','app_binding_v1.py','attest_start_v1.py','run_stage.sh','observer.py','observer_transport.py']
def sha(path):
 h=hashlib.sha256()
 with path.open('rb') as f:
  for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
 return h.hexdigest()
def load(path):return json.loads(path.read_text())
def require(value,reason):
 if not value:raise AssertionError(reason)
def normalized(text):
 text=text.replace(str(V5),str(ROOT)).replace(V5.name,ROOT.name).replace('-v5-','-v6-').replace('Parent-only v5 operating stages','Parent-only v6 operating stages')
 for name in SCRIPTS:text=text.replace(sha(V5/name),sha(ROOT/name))
 return text
def module(text,omit=()):
 tree=ast.parse(text);tree.body=[n for n in tree.body if not isinstance(n,ast.FunctionDef) or n.name not in omit]
 return ast.dump(tree,include_attributes=False)
def main():
 run=sys.argv[1];require(run in ['01','02','03'],'audit-id')
 spec=importlib.util.spec_from_file_location('v6prep',HERE/'prepare_v6.py');prep=importlib.util.module_from_spec(spec);spec.loader.exec_module(prep)
 before=load(ROOT/'prior-packet-inventories-before.json')
 after={name:prep.inventory(Path(name)) for name in before}
 require(before==after,'V4-V5-packet-bytes-modes-drift')
 with (ROOT/('prior-packet-inventories-after-audit-'+run+'.json')).open('x') as f:json.dump(after,f,indent=2);f.write('\n')
 fixed=load(ROOT/'old-fixed-inputs-before.json');current={}
 for name,expected in fixed.items():
  p=Path(name);require(p.is_file() and not p.is_symlink(),'old-fixed-input-kind')
  current[name]={'sha256':sha(p),'mode':p.stat().st_mode&0o777}
 require(current==fixed,'old-fixed-input-drift')
 with (ROOT/('old-fixed-inputs-after-audit-'+run+'.json')).open('x') as f:json.dump(current,f,indent=2);f.write('\n')
 manifest=load(HERE/'manifest.json')
 require(all(sha(ROOT/name)==expected for name,expected in manifest['files'].items()),'sealed-input-mismatch')
 require(sha(ROOT/'operation-files.sha256')==manifest['checksumListSHA256'],'checksum-list-mismatch')
 expected=''.join(value+'  '+str(ROOT/name)+'\n' for name,value in manifest['files'].items())
 require((ROOT/'operation-files.sha256').read_text()==expected,'checksum-file-set')
 for name in SCRIPTS:
  require((ROOT/name).read_bytes()==(HERE/'templates'/name).read_bytes(),'template:'+name)
  diff=''.join(difflib.unified_diff((V5/name).read_text().splitlines(True),(ROOT/name).read_text().splitlines(True),fromfile=str(V5/name),tofile=name,n=0))
  require(diff==(HERE/(name+'.patch')).read_text(),'diff:'+name)
  if name=='run_stage.sh':require(normalized((V5/name).read_text())==(ROOT/name).read_text(),'runner-mechanical-delta');continue
  omit=['preserve','preflight','active_helper_identities','require_active_helper'] if name=='helper.py' else []
  require(module(normalized((V5/name).read_text()),omit)==module((ROOT/name).read_text(),omit),'AST-unrelated-change:'+name)
 recipe_in=(PUBLIC5/'parent_recipe.sh.in').read_text().replace(str(V5),str(ROOT)).replace('ROUND2','ROUND3').replace('round2','round3')
 require(recipe_in==(HERE/'parent_recipe.sh.in').read_text(),'one-stage-gate-changed')
 recipe=recipe_in.replace('__SEAL_SHA__',manifest['checksumListSHA256']).replace('__RUNNER_SHA__',manifest['files']['run_stage.sh'])
 require(recipe==(HERE/'parent_recipe.sh').read_text()==(ROOT/'parent_recipe.sh').read_text(),'external-parent-pins')
 for name in ['template-binding.json','private-bindings.json']:
  for file,digest in load(ROOT/name).items():require(sha(ROOT/file)==digest,'hashgraph:'+name+':'+file)
 for file,digest in load(ROOT/'binding-private.json')['files'].items():require(sha(ROOT/file)==digest,'app-hashgraph:'+file)
 require(load(ROOT/'v5-packet-inventory-before.json')=={name:value for name,value in before.items() if 'v5' in name},'V5-inventory-binding')
 # All other V5 sealed inputs remain byte-identical except roots, names and derived hashes.
 generated={'helper.py','policy.py','app_binding_v1.py','attest_start_v1.py','observer.py','observer_transport.py','run_stage.sh','plan-private.json','envs-private.json','kong-private.json','binding-private.json','private-bindings.json','template-binding.json'}
 immutable=[]
 for name in load(PUBLIC5/'manifest.json')['files']:
  if name not in generated:require((ROOT/name).read_bytes()==(V5/name).read_bytes(),'immutable-input:'+name);immutable.append(name)
 plan5=load(V5/'plan-private.json');plan=load(ROOT/'plan-private.json');expected_plan=dict(plan5)
 expected_plan['root']=str(ROOT);expected_plan['names']={k:v.replace('-v5-','-v6-') for k,v in plan5['names'].items()}
 require(plan==expected_plan,'plan-binding-delta')
 def names(value):
  if isinstance(value,str):
   for key,old in plan5['names'].items():value=value.replace(old,plan['names'][key])
   return value
  if isinstance(value,list):return [names(v) for v in value]
  if isinstance(value,dict):return {k:names(v) for k,v in value.items()}
  return value
 for name in ['envs-private.json','kong-private.json']:require(load(ROOT/name)==names(load(V5/name)),'service-name-only:'+name)
 require(manifest['appHead']=='49e3fa2004c1336ffa36c134a8f21bcc2d72d327','APP49')
 require(subprocess.check_output(['/usr/bin/git','diff','--name-only',manifest['appHead'],'HEAD','--','openplan'],cwd=HERE.parents[2])==b'','app-source-diff')
 require(sha(ROOT/'candidate17.sql')=='b129f80e37aa9be71069683acd42df3fb6fdb94078ed0458f20b6e9c5155a41b','candidate-bytes')
 require(not list((ROOT/'execution').iterdir()) and not (ROOT/'candidate').exists(),'operating-stage-dispatched')
 for name in ['clone-intent.json','preflight-ready.json','protected-runtime-before.json','target-identity.json','upgrade-ready.json','service-receipts-private.json','runtime-start-attestation.json','post-journey-result.json','storage-objects','source-private.dump']:
  require(not (ROOT/name).exists(),'unexpected-operating-artifact:'+name)
 require(ROOT.stat().st_mode&0o777==0o700,'private-root-mode')
 for name in manifest['files']:require((ROOT/name).stat().st_mode&0o777==(0o700 if name=='run_stage.sh' else 0o600),'private-mode:'+name)
 for path in HERE.glob('*.py'):compile(path.read_text(),str(path),'exec')
 for path in [HERE/'parent_recipe.sh',ROOT/'run_stage.sh']:
  good=subprocess.run(['/bin/sh','-n'],input=('# harmless\n'+path.read_text()).encode(),capture_output=True);require(good.returncode==0,'shell-harmless')
  bad=subprocess.run(['/bin/sh','-n'],input=(path.read_text()+'\nif\n').encode(),capture_output=True);require(bad.returncode!=0 and b'Syntax error' in bad.stderr,'shell-fault-not-killed')
 envs=load(ROOT/'envs-private.json');secrets=set()
 for obj in [load(ROOT/'app-env-private.json'),*envs.values()]:
  for key,value in obj.items():
   if any(word in key for word in ['KEY','SECRET','DATABASE_URL','DB_URI']) and len(value)>15:secrets.add(value.encode())
 require(bool(secrets),'empty-known-secret-screen')
 def screen(data):
  require(not any(value in data for value in secrets),'known-secret-in-public')
  require(bytes.fromhex('e28094') not in data,'em-dash')
 def detects(fn,data,reason):
  try:fn(data)
  except AssertionError as error:require(str(error)==reason,'wrong-screen-failure');return
  raise AssertionError('privacy-detector-missing-'+reason)
 screen(b'Harmless public wording')
 detects(screen,next(iter(secrets)),'known-secret-in-public');detects(screen,bytes.fromhex('e28094'),'em-dash')
 try:detects(lambda data:None,next(iter(secrets)),'known-secret-in-public')
 except AssertionError as error:require(str(error)=='privacy-detector-missing-known-secret-in-public','wrong-disabled-detector-failure')
 else:raise AssertionError('disabled-scanner-survived')
 for path in HERE.rglob('*'):
  if path.is_file():screen(path.read_bytes())
 result={'preparedOnly':True,'operatingStages':0,'noLiveTransport':True,'oldPacketBytesAndModesExact':True,
  'packetEntries':{name:len(value) for name,value in after.items()},'fixedOldInputCount':len(fixed),
  'priorPacketsBeforeSHA256':sha(ROOT/'prior-packet-inventories-before.json'),'priorPacketsAfterSHA256':sha(ROOT/('prior-packet-inventories-after-audit-'+run+'.json')),
  'fixedOldInputsBeforeSHA256':sha(ROOT/'old-fixed-inputs-before.json'),'fixedOldInputsAfterSHA256':sha(ROOT/('old-fixed-inputs-after-audit-'+run+'.json')),
  'sealedFiles':len(manifest['files']),'manifestSHA256':sha(HERE/'manifest.json'),'checksumListSHA256':manifest['checksumListSHA256'],
  'parentRecipeSHA256':sha(HERE/'parent_recipe.sh'),'mechanicalASTComparison':'All V5 module ASTs unchanged except preserve/preflight and two N1 functions. Fixed root/unit/name/digest literal deltas normalized.',
  'externalPinsAndHashGraphExact':True,'oneStageGateMechanicalMatch':True,'publicPrivateTemplatesAndDiffsExact':True,
  'immutableV5Files':immutable,'APP49Unchanged':True,'executionEmpty':True,'knownSecretScreenAndHarmlessInjectionCodeFaultControlsPass':True,
  'historicalWholeRootReceipt':'Retained byte-identical. The five older roots were not scanned in V6; no current whole-root custody claim.',
  'blindCategories':['No actual helper state, DB, HTTP, old-web observer, clone, compiler, build or journey.',
   'Filesystem and known-value screening do not prove unknown-secret absence or hostile-host security.',
   'Typed checkpoints establish point-in-time active states only, not continuous availability or process identity.']}
 with (ROOT/('final-audit-'+run+'.json')).open('x') as f:json.dump(result,f,indent=2);f.write('\n')
 (HERE/'final-audit.json').write_text(json.dumps(result,indent=2)+'\n')
 print(json.dumps({'oldPacketEntries':sum(len(value) for value in after.values()),'fixedOldInputs':len(fixed),'sealedFiles':len(manifest['files']),'operatingStages':0}))
if __name__=='__main__':main()
