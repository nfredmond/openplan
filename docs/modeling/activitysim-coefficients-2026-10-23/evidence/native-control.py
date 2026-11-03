from pathlib import Path
import hashlib,json,subprocess,sys
source=Path('scripts/modeling/activitysim_walk_transfer.py'); original=source.read_bytes()
run=Path('/tmp/openplan-walk-synthetic-native-fault-20261023')
stock='/home/nathaniel/code/openplan/workers/activitysim_worker/.venv-exec/lib/python3.11/site-packages/activitysim/examples/prototype_mtc/configs'
try:
 text=original.decode(); assert text.count("run('candidate', c_overlay, True)")==1
 source.write_text(text.replace("run('candidate', c_overlay, True)","run('candidate', base_overlay, True)"))
 subprocess.run([sys.executable,'scripts/modeling/prepare_activitysim_walk_transfer.py','synthetic','--run',str(run),'--stock',stock],check=True)
 with (run/'runner.stdout').open('w') as log:
  subprocess.run([sys.executable,'-B','scripts/research/sealed_study.py','run',str(run/'lock.json')],stdout=log,check=True)
 result=json.loads((run/'aggregate.json').read_text())
 assert result['inconclusive_error_kind']=='EvaluatorProcessFailed'
 import pandas as pd
 b=pd.read_pickle(run/'scratch/baseline/probabilities.pkl'); c=pd.read_pickle(run/'scratch/candidate/probabilities.pkl')
 assert b.equals(c)
finally: source.write_bytes(original)
sys.path.insert(0,'scripts/modeling')
import activitysim_walk_transfer as w
try: w.compare(b,c,b.copy(),pd.read_pickle(run/'scratch/baseline/strata.pkl'))
except ValueError as exc:
 assert str(exc)=='candidate has no probability effect'
else: raise AssertionError('missing native probability effect was accepted')
print(json.dumps({'outcome':'native missing-overlay fault rejected','assertion':'candidate has no probability effect',
 'receipt_sha256':hashlib.sha256((run/'receipt.json').read_bytes()).hexdigest(),
 'aggregate_sha256':hashlib.sha256((run/'aggregate.json').read_bytes()).hexdigest(),
 'source_restored':source.read_bytes()==original},indent=2))
