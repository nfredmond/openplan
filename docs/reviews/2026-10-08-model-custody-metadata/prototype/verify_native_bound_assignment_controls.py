"""Baseline, harmless, missing mode-choice fault and restored native assignment."""
import hashlib,json,os,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent
output=Path(os.environ['OPENPLAN_NATIVE_BOUND_CONTROLS_OUTPUT']).absolute()
output.mkdir(mode=0o700,parents=True,exist_ok=False)
records=[]
for case in ('baseline','harmless','disable-mode-choice','restored'):
    env=dict(os.environ,OPENPLAN_BOUND_ASSIGNMENT_OUTPUT=str(output/case),
             OPENPLAN_BOUND_ASSIGNMENT_CONTROL='baseline' if case=='restored' else case)
    result=subprocess.run([sys.executable,'-B',str(ROOT/'verify_native_bound_assignment.py')],env=env,capture_output=True,text=True,timeout=120)
    (output/(case+'.log')).write_text(result.stdout+result.stderr)
    if case=='disable-mode-choice':
        if result.returncode!=1 or 'AssertionError: Expected modeled transit outcome' not in result.stderr:
            raise AssertionError('Missing mode-choice fault did not reach the expected check: '+result.stderr)
        records.append({'control':case,'detected':'Expected modeled transit outcome'})
    else:
        if result.returncode:raise AssertionError(case+': '+result.stderr)
        native=json.loads((output/case/'result.json').read_text())
        records.append({'control':case,'converged':native['convergence']['converged'],
                        'loaded_links':native['loaded_links'],'auto_trips':native['mode_split']['auto_trips'],
                        'transit_trips':native['mode_split']['transit_trips'],'active_trips':native['mode_split']['active_trips'],
                        'artifact_count':len(native['artifacts']),'worker_sha256':native['worker_sha256']})
expected={key:value for key,value in records[0].items() if key!='control'}
for row in (records[1],records[3]):
    assert {key:value for key,value in row.items() if key!='control'}==expected,'Harmless/restored native results changed'
report={'proof_sha256':hashlib.sha256((ROOT/'verify_native_bound_assignment.py').read_bytes()).hexdigest(),
        'controls':records,'evidence_directory':str(output),
        'limits':'Full synthetic native assignment; mocked parent transports and constructed predecessor inputs. Missing mode choice is a configuration fault control. No native interrupted recovery, larger networks, calibration, cordons, scientific acceptance or dispatcher activation.'}
content=json.dumps(report,indent=2)+'\n';(ROOT/'native-bound-assignment-controls.json').write_text(content);(output/'result.json').write_text(content);print(content)
