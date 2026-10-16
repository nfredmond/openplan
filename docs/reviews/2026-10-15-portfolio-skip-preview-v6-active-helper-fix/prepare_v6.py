"""Prepare only a new V6 packet. No transport, operating stage, or old cache scan."""
import ast
import difflib
import hashlib
import json
import os
from pathlib import Path

HERE=Path(__file__).resolve().parent
REPO=HERE.parents[2]
V5=Path('/home/nathaniel/.local/state/openplan/project-portfolio-skip-preview-20261015-v5')
V4=V5.with_name('project-portfolio-skip-preview-20261015-v4')
ROOT=V5.with_name('project-portfolio-skip-preview-20261015-v6')
PUBLIC5=REPO/'docs/reviews/2026-10-15-portfolio-skip-preview-v5-corrections'
PUBLIC4=REPO/'docs/reviews/2026-10-15-portfolio-skip-preview-v4-preparation'
HEAD='49e3fa2004c1336ffa36c134a8f21bcc2d72d327'
SOURCE=Path('/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/project-geography-preview-final-20261015/rest-uri-recovery-01/active-service-receipts-private.json')

def sha(path):
 h=hashlib.sha256()
 with path.open('rb') as f:
  for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
 return h.hexdigest()
def inventory(root):
 out={'.':{'kind':'directory','mode':root.stat().st_mode&0o777}}
 for path in sorted(root.rglob('*')):
  entry={'mode':path.lstat().st_mode&0o777}
  if path.is_symlink():entry.update(kind='symlink',target=os.readlink(path))
  elif path.is_dir():entry.update(kind='directory')
  else:entry.update(kind='file',bytes=path.stat().st_size,sha256=sha(path))
  out[str(path.relative_to(root))]=entry
 return out
def read(name):return json.loads((V5/name).read_text())
def put(name,data):
 path=ROOT/name
 with path.open('xb') as f:f.write(data.encode() if isinstance(data,str) else data)
 path.chmod(0o600)
def js(name,data):put(name,json.dumps(data,indent=2)+'\n')
def replace_function(source,name,text):
 node=next(n for n in ast.parse(source).body if isinstance(n,ast.FunctionDef) and n.name==name)
 lines=source.splitlines(True);return ''.join(lines[:node.lineno-1])+text.rstrip()+'\n'+''.join(lines[node.end_lineno:])

def main():
 os.umask(0o077)
 if ROOT.exists() or ROOT.is_symlink():raise ValueError('v6-root-reserved')
 # Only the four packet directories are scanned, never the 51,233-entry old-root set.
 packet_before={str(p):inventory(p) for p in [V5,PUBLIC5,V4,PUBLIC4]}
 fixed=read('preservation-files.json')
 fixed_before={}
 for name,expected in fixed.items():
  path=Path(name);observed={'sha256':sha(path),'mode':path.stat().st_mode&0o777}
  if observed!=expected or not path.is_file() or path.is_symlink():raise ValueError('old-fixed-input-drift')
  fixed_before[name]=observed
 ROOT.mkdir(mode=0o700)
 for name in ['execution','home','cache','npm-cache','tmp','observer-home','observer-receipts','controls']:(ROOT/name).mkdir(mode=0o700)
 (HERE/'templates').mkdir()
 js('prior-packet-inventories-before.json',packet_before)
 js('v5-packet-inventory-before.json',{name:packet_before[name] for name in [str(V5),str(PUBLIC5)]})
 js('old-fixed-inputs-before.json',fixed_before)
 # Retain old whole-root receipts only as unchanged historical bytes.
 runtime5=json.loads((PUBLIC5/'manifest.json').read_text())
 generated={'helper.py','policy.py','app_binding_v1.py','attest_start_v1.py','observer.py','observer_transport.py','run_stage.sh',
  'plan-private.json','envs-private.json','kong-private.json','binding-private.json','private-bindings.json','template-binding.json'}
 for name in runtime5['files']:
  if name not in generated:put(name,(V5/name).read_bytes())
 receipts=json.loads(SOURCE.read_text());ids={kind:value['id'] for kind,value in receipts.items()}
 js('active-helper-identities.json',{'source':str(SOURCE),'sourceSHA256':sha(SOURCE),'ids':ids})
 (HERE/'active-helper-identities.json').write_bytes((ROOT/'active-helper-identities.json').read_bytes())
 plan=read('plan-private.json');plan['root']=str(ROOT);plan['names']={k:v.replace('-v5-','-v6-') for k,v in plan['names'].items()};js('plan-private.json',plan)
 def names(value):
  if isinstance(value,str):
   for k,old in read('plan-private.json')['names'].items():value=value.replace(old,plan['names'][k])
   return value
  if isinstance(value,list):return [names(v) for v in value]
  if isinstance(value,dict):return {k:names(v) for k,v in value.items()}
  return value
 for name in ['envs-private.json','kong-private.json']:js(name,names(read(name)))
 put('policy.py',(V5/'policy.py').read_text().replace('project-portfolio-skip-preview-20261015-v5','project-portfolio-skip-preview-20261015-v6'))
 observer=(V5/'observer.py').read_text().replace(str(V5),str(ROOT));put('observer.py',observer)
 transport=(V5/'observer_transport.py').read_text().replace(str(V5),str(ROOT)).replace('openplan-portfolio-v5-preserved-web-observer','openplan-portfolio-v6-preserved-web-observer')
 transport=transport.replace(sha(V5/'observer.py'),sha(ROOT/'observer.py'));put('observer_transport.py',transport)
 helper=(V5/'helper.py').read_text().replace('Parent-only v5 operating stages','Parent-only v6 operating stages')
 helper=helper.replace(sha(V5/'observer_transport.py'),sha(ROOT/'observer_transport.py'))
 helper=replace_function(helper,'preserve',(HERE/'preserve.txt').read_text())
 helper=replace_function(helper,'preflight',(HERE/'preflight.txt').read_text())
 loc=helper.index('\ndef preserve():');helper=helper[:loc]+'\n'+(HERE/'active_helpers.txt').read_text()+helper[loc:]
 put('helper.py',helper)
 app=(V5/'app_binding_v1.py').read_text().replace(str(V5),str(ROOT));start=app.index('HELPERS = ');end=app.index('\nGiB',start)
 app=app[:start]+'HELPERS = '+repr({n:sha(ROOT/n) for n in ['helper.py','policy.py']})+app[end:];put('app_binding_v1.py',app)
 att=(V5/'attest_start_v1.py').read_text().replace(str(V5),str(ROOT)).replace('-v5-web.service','-v6-web.service').replace(sha(V5/'app_binding_v1.py'),sha(ROOT/'app_binding_v1.py'));put('attest_start_v1.py',att)
 runner=(V5/'run_stage.sh').read_text().replace(str(V5),str(ROOT)).replace('-v5-','-v6-');put('run_stage.sh',runner);(ROOT/'run_stage.sh').chmod(0o700)
 b=read('binding-private.json');b['files']={n:sha(ROOT/n) for n in b['files']};js('binding-private.json',b)
 b=read('private-bindings.json');b={n:sha(ROOT/n) for n in b}
 b.update({n:sha(ROOT/n) for n in ['active-helper-identities.json','v5-packet-inventory-before.json','prior-packet-inventories-before.json','old-fixed-inputs-before.json']});js('private-bindings.json',b)
 js('template-binding.json',{n:sha(ROOT/n) for n in ['helper.py','policy.py']})
 for name in ['helper.py','policy.py','app_binding_v1.py','attest_start_v1.py','run_stage.sh','observer.py','observer_transport.py']:
  text=(ROOT/name).read_text();(HERE/'templates'/name).write_text(text)
  (HERE/(name+'.patch')).write_text(''.join(difflib.unified_diff((V5/name).read_text().splitlines(True),text.splitlines(True),fromfile=str(V5/name),tofile=name,n=0)))
 files={p.name:sha(p) for p in sorted(ROOT.iterdir()) if p.is_file()}
 put('operation-files.sha256',''.join(h+'  '+str(ROOT/name)+'\n' for name,h in files.items()))
 manifest={'schema':1,'preparedOnly':True,'appHead':HEAD,'root':str(ROOT),'targetProposal':plan['target'],'targetAllocated':False,
  'api':plan['api'],'web':plan['web'],'files':files,'checksumListSHA256':sha(ROOT/'operation-files.sha256'),
  'reviewRequired':'Fresh independent ROUND3 before any operating stage. No actual context observation permitted in N1 preparation.',
  'historicalWholeRootReceiptSHA256':sha(V5/'v4-full-inventory-before.json')}
 (HERE/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');js('preparation.json',manifest)
 recipe=(PUBLIC5/'parent_recipe.sh.in').read_text().replace(str(V5),str(ROOT)).replace('ROUND2','ROUND3').replace('round2','round3')
 (HERE/'parent_recipe.sh.in').write_text(recipe)
 recipe=recipe.replace('__SEAL_SHA__',manifest['checksumListSHA256']).replace('__RUNNER_SHA__',files['run_stage.sh'])
 (HERE/'parent_recipe.sh').write_text(recipe);(HERE/'parent_recipe.sh').chmod(0o755)
 put('parent_recipe.sh',recipe);(ROOT/'parent_recipe.sh').chmod(0o700)
 after={str(p):inventory(p) for p in [V5,PUBLIC5,V4,PUBLIC4]}
 if after!=packet_before:raise ValueError('prior-packet-mutated')
 js('prior-packet-inventories-after-preparation.json',after)
 print(json.dumps({'preparedOnly':True,'sealedFiles':len(files),'priorPacketEntries':sum(len(x) for x in after.values()),'activeIds':len(ids),'operatingStages':0}))
if __name__=='__main__':main()
