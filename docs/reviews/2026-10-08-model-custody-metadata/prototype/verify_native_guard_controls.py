"""Native guard iteration controls; each case uses a new disposable database."""
import hashlib,json,os,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent
output=Path(os.environ['OPENPLAN_NATIVE_GUARD_CONTROLS_OUTPUT']).absolute()
output.mkdir(mode=0o700,parents=True,exist_ok=False)
records=[]
for case,control in [('baseline','parent-loss'),('harmless','parent-loss-harmless'),('omit-parent-loss','omit-parent-loss'),('restored','parent-loss')]:
    result=subprocess.run([sys.executable,'-B',str(ROOT/'verify_native_guard_parent_loss.py')],capture_output=True,text=True,timeout=180,
        env=dict(os.environ,OPENPLAN_NATIVE_PARENT_OUTPUT=str(output/case),OPENPLAN_NATIVE_PARENT_CONTROL=control))
    (output/(case+'.log')).write_text(result.stdout+result.stderr)
    if case=='omit-parent-loss':
        expected='Native supervisor loss was not observed'
        assert result.returncode==1 and 'AssertionError: '+expected in result.stderr,result.stderr
        records.append({'case':case,'detected':expected})
    else:
        assert result.returncode==0,result.stderr
        report=json.loads((output/case/'result.json').read_text())
        live=report['native_http'];proof=live['parent_loss']
        records.append({'case':case,'database':live['database'],'scope_empty':proof['scope_observation']['scope_has_live_processes'] is False,
            'native_failure_record':proof['native_failure'],'records_unchanged':proof['records_unchanged'],
            'database_state_unchanged':proof['database_state_unchanged'],'command_inventory_unchanged':proof['command_inventory_unchanged'],
            'final_outputs_absent':proof['final_outputs_absent'],'stage_remains_running':live['stage_remains_running']})
report={'cases':records,'evidence_directory':str(output),
    'sources':{name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in ('verify_native_guard_parent_loss.py','verify_native_parent_loss.py','verify_native_parent_supervisor.py','verify_native_assignment_http.py')},
    'limits':['Confirmed native iteration boundary only','No graceful-close claim after forced termination','No arbitrary busy-native interruption','No database reconciliation, restart, publication or scientific acceptance']}
content=json.dumps(report,indent=2)+'\n'
(output/'result.json').write_text(content)
(ROOT/'native-guard-controls.json').write_text(content)
print(content)
