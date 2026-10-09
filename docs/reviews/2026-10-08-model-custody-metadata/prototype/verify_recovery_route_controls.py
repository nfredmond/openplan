"""Temporarily mutate only the owned, unserved route and restore its exact bytes."""
import hashlib,json,os,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parent;REPO=ROOT.parents[3];APP=REPO/'openplan'
route=APP/'src/app/api/models/[modelId]/runs/[modelRunId]/recovery/route.ts'
output=Path(os.environ['OPENPLAN_RECOVERY_ROUTE_CONTROLS_OUTPUT']).absolute();output.mkdir(mode=0o700,parents=True,exist_ok=False)
original=route.read_text()
controls=[('baseline',original,None),('harmless',original+'\n// Harmless route comment.\n',None),
 ('omit-role',original.replace('!["owner", "admin"].includes(access.membership.role)','false'),'refuses member recovery'),
 ('omit-agent-refusal',original.replace('if (request.headers.has(name))','if (false)'),'refuses agent header'),
 ('omit-model-scope',original.replace('decision.expectedState.model_id !== access.modelId','false'),'refuses reviewed state with different model_id'),
 ('omit-receipt',original.replace('!matchesRecoveryReceipt(data, args)','false'),'keeps changed receipt'),
 ('restored',original,None)]
records=[]
try:
 for name,source,error in controls:
  if error:assert source!=original,name+' mutation was not applied'
  route.write_text(source)
  result=subprocess.run(['npm','test','--','--maxWorkers=1','src/test/model-recovery-decision-route.test.ts'],cwd=APP,capture_output=True,text=True,timeout=60)
  (output/(name+'.log')).write_text(result.stdout+result.stderr)
  if error:assert result.returncode!=0 and error in result.stdout+result.stderr,name+': '+result.stdout+result.stderr
  else:assert result.returncode==0,result.stdout+result.stderr
  records.append({'control':name,'returncode':result.returncode,'detected':error})
finally:route.write_text(original)
assert route.read_text()==original
report={'controls':records,'route_sha256':hashlib.sha256(route.read_bytes()).hexdigest(),'test_sha256':hashlib.sha256((APP/'src/test/model-recovery-decision-route.test.ts').read_bytes()).hexdigest(),'evidence_directory':str(output),'limits':'Mocked route/session/RPC tests, with exact read projection assertions. SQL and HTTP command behavior have separate proofs. This does not establish real session cookies, browser controls, deployed configuration, physical termination or agent approval.'}
content=json.dumps(report,indent=2)+'\n';(output/'result.json').write_text(content);(ROOT/'recovery-route-controls.json').write_text(content);print(content)
