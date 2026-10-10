"""Mutation checks in copied worker modules, without editing the active checkout."""
import hashlib,json,os,shutil,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent;WORKER=ROOT.parents[3]/'workers/aequilibrae_worker'
output=Path(os.environ['OPENPLAN_RECOVERY_COMMAND_CONTROLS_OUTPUT']).absolute();output.mkdir(mode=0o700,parents=True,exist_ok=False)
module='model_recovery_decision_command.py';source=(WORKER/module).read_text()
reason="if not isinstance(args['reason'],str) or not args['reason'].strip() or len(args['reason'])>2000:"
receipt="if not isinstance(receipt,dict) or journal.canonical(receipt)!=journal.canonical(expected):"
cases=[('baseline',source,None),('harmless',source+'\n# Harmless validator comment.\n',None),
 ('omit-reason',source.replace(reason,'if False:'),"Expected 'mock' to not have been called."),
 ('omit-receipt',source.replace(receipt,'if False:'),'DeliveryUnconfirmed not raised'),('restored',source,None)]
records=[]
for name,candidate,error in cases:
    directory=output/name;directory.mkdir()
    for p in WORKER.glob('*.py'):shutil.copyfile(p,directory/p.name)
    (directory/module).write_text(candidate)
    result=subprocess.run([sys.executable,'-B','-m','unittest','test_model_recovery_decision_command','-v'],cwd=directory,capture_output=True,text=True,timeout=30)
    (output/(name+'.log')).write_text(result.stdout+result.stderr)
    if error:assert result.returncode!=0 and error in result.stderr,name+': '+result.stderr
    else:assert result.returncode==0,result.stderr
    records.append({'control':name,'returncode':result.returncode,'detected':error})
report={'controls':records,'source_sha256':{p:hashlib.sha256((WORKER/p).read_bytes()).hexdigest() for p in (module,'model_command_client.py','test_model_recovery_decision_command.py')},'evidence_directory':str(output),'limits':'Copied-module unit controls establish local validation and journal behavior. Actual SQL and HTTP are covered separately; no route authentication or physical process behavior is established.'}
content=json.dumps(report,indent=2)+'\n';(ROOT/'recovery-command-controls.json').write_text(content);(output/'result.json').write_text(content);print(content)
