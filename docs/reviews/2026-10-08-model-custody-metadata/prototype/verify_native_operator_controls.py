"""Native interruption to abandonment controls with a fresh database per case."""
import hashlib,json,os,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent
output=Path(os.environ['OPENPLAN_NATIVE_OPERATOR_CONTROLS_OUTPUT']).absolute();output.mkdir(mode=0o700,parents=True,exist_ok=False)
records=[]
for case,control in [('baseline','baseline'),('harmless','harmless'),('omit-disconnect','omit-disconnect'),('restored','baseline')]:
 result=subprocess.run([sys.executable,'-B',str(ROOT/'verify_native_operator_recovery.py')],capture_output=True,text=True,timeout=240,
   env=dict(os.environ,OPENPLAN_NATIVE_OPERATOR_OUTPUT=str(output/case),OPENPLAN_NATIVE_OPERATOR_CONTROL=control))
 (output/(case+'.log')).write_text(result.stdout+result.stderr)
 if case=='omit-disconnect':
  assert result.returncode!=0 and 'Recovery reply loss was not observed' in result.stderr,result.stderr
  records.append({'case':case,'detected':'Recovery reply loss was not observed'})
 else:
  assert result.returncode==0,result.stderr
  report=json.loads((output/case/'result.json').read_text())
  records.append({'case':case,'database':report['database'],'native_and_guard_stopped':True,
   'reported_inspection_retained_exactly':report['reported_inspection_retained_exactly'],
   'reported_evidence_remains_unverified':report['reported_evidence_remains_unverified'],
   'native_custody_and_journal_unchanged':report['native_custody_and_journal_unchanged'],
   'late_attempt_write_refused':report['late_attempt_write_refused'],
   'retry_request_counts':report['http_recovery']['recovery_request_counts']})
report={'cases':records,'evidence_directory':str(output),
 'sources':{name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in ('verify_native_operator_recovery.py','verify_recovery_decision_http.py','verify_native_guard_parent_loss.py')},
 'limits':['Synthetic operator with service-role gateway','No authenticated browser or practitioner acceptance','No restart, final publication, graceful-close or scientific claim']}
content=json.dumps(report,indent=2)+'\n';(output/'result.json').write_text(content);print(content)
