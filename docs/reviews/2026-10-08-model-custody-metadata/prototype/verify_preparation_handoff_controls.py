"""Mutation evidence for preparation selection, copy and bound registration."""
import hashlib,json,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4];WORKER=ROOT/'workers/aequilibrae_worker'
paths={name:WORKER/name for name in ('model_validation_preparation.py','model_predecessor_inputs.py','main.py')}
original={name:path.read_text() for name,path in paths.items()}
source=original['model_validation_preparation.py'];selector=original['model_predecessor_inputs.py'];main=original['main.py']
start=main.index('def retain_managed_validation_preparation(');end=main.index('def retain_managed_predecessor_package(',start)
section=main[start:end]
variants=[
 ('harmless','model_validation_preparation.py',source.replace("    seen=set()","    entries=list(reversed(entries))\n    seen=set()")),
 ('wrong-scope','model_validation_preparation.py',source.replace("or any(manifest.get('context',{}).get(key)!=value for key,value in expected_context.items())","or False")),
 ('missing-role','model_validation_preparation.py',source.replace('len(entries)!=len(expected)','False')),
 ('method-filter','model_predecessor_inputs.py',selector.replace("or (row.get('metadata_json') or {}).get('demand_method') == method","or True")),
 ('consumer-method','model_predecessor_inputs.py',selector.replace("preparation is None or method != preparation[0]","preparation is None")),
 ('registration','main.py',main[:start]+section.replace('        writer.record_artifact({','        return retained\n        writer.record_artifact({')+main[end:]),
 ('stop','main.py',main[:start]+section.replace('        writer.stopped = True','        writer.stopped = False')+main[end:]),
 ('restored','main.py',main),
]
results=[]
try:
 for name,target,content in variants:
  for key,path in paths.items():path.write_text(original[key])
  assert name=='restored' or content!=original[target]
  paths[target].write_text(content)
  result=subprocess.run([sys.executable,'-B','-m','unittest','test_model_preparation_consumption','test_model_preparation_handoff'],cwd=WORKER,capture_output=True,text=True,timeout=45)
  if name in ('harmless','restored'):assert result.returncode==0,result.stderr
  else:assert result.returncode!=0 and 'AssertionError' in result.stderr,result.stderr
  results.append({'control':name,'returncode':result.returncode,'expected_behavior_observed':True})
finally:
 for key,path in paths.items():path.write_text(original[key])
report={'source_sha256':{key:hashlib.sha256(path.read_bytes()).hexdigest() for key,path in paths.items()},'cases':results,
 'limits':'Actual local files and bound worker adapter with injected database responses. No native handoff, engine launch ordering, complete source coverage or scientific acceptance.'}
Path(__file__).with_name('preparation-handoff-controls.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
