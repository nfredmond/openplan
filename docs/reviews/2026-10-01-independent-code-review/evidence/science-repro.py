"""Synthetic review evidence only. No model runs, holdouts, database, or network."""
import importlib.util
import json
import sys
import tempfile
import threading
import time
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
for path in (ROOT / 'scripts/modeling', ROOT / 'scripts/modeling/tests', ROOT / 'workers/aequilibrae_worker'):
    sys.path.insert(0, str(path))
import test_validation_instrument_v2 as fixture
import validation_instrument_v2 as matcher
import model_validation_core_v5 as core


def directional_case(core_module=core):
    item = fixture.observation(center=100)
    segment = fixture.link('a', [[-121.01,39],[-120.99,39]], direction=0)
    match = matcher.match_observation(item, [segment], search_distance_meters=200)
    with tempfile.TemporaryDirectory(prefix='science-direction-') as temp:
        root = Path(temp)
        package = {'observations':[item]}
        audit = fixture.audit(item, match)
        basis = fixture.basis(item)
        output = b'link_id,PCE_AB,PCE_BA,PCE_tot\na,100,900,1000\n'
        from hashlib import sha256
        basis['model_output_artifact']['sha256'] = sha256(output).hexdigest()
        (root/'output.csv').write_bytes(output)
        files = {'package.json':package, 'audit.json':audit, 'basis.json':basis}
        for name, content in files.items():
            (root/name).write_text(json.dumps(content))
        bundle={'schema':'openplan.validation-input-bundle.v2','model_output_bytes_read':False,'readiness_inputs':{}}
        for key,name in [('observation_package','package.json'),('pre_volume_match_audit','audit.json')]:
            bundle['readiness_inputs'][key]={'path':name,'sha256':sha256((root/name).read_bytes()).hexdigest()}
        (root/'bundle.json').write_text(json.dumps(bundle))
        assessment = core_module.assess_frozen_instrument_files(observation_package_path=root/'package.json',pre_volume_match_audit_path=root/'audit.json',validation_input_bundle_path=root/'bundle.json',comparison_basis_path=root/'basis.json',model_output_path=root/'output.csv',assessment_id='synthetic',readiness_root=root)
    row=assessment['observation_results'][0]
    assert row['modeled_value']==1000, f"total-volume evidence changed: {row['modeled_value']}"
    assert match['direction_aggregation']=='one_direction'
    direction_finding=next(x for x in row['basis_findings'] if x['key']=='direction_aggregation')
    assert direction_finding['status']=='compatible'
    return {'match':match['status'],'aggregation':match['direction_aggregation'],'actual_eastbound':100,'actual_westbound':900,'reported_modeled_value':row['modeled_value'],'raw_ape':row['raw_absolute_percent_error'],'direction_status':direction_finding['status'],'outcome':assessment['scientific_outcome']}


def cloned_core(source):
    module=types.ModuleType('synthetic_core')
    exec(compile(source, str(ROOT/'workers/aequilibrae_worker/model_validation_core_v5.py'), 'exec'), module.__dict__)
    return module

result={'directional_case':directional_case()}
source=(ROOT/'workers/aequilibrae_worker/model_validation_core_v5.py').read_text()
result['no_op_control']=directional_case(cloned_core(source+'\n# Review-only harmless comment.\n'))
try:
    directional_case(cloned_core(source.replace('total = sum(values)','total = 0.0')))
except AssertionError as exc:
    result['targeted_fault_control']={'detected':True,'message':str(exc)}
else:
    raise AssertionError('targeted sum fault survived')

# Same code, synthetic owned subprocess tree, no real worker service.
spec=importlib.util.spec_from_file_location('county_review',ROOT/'workers/county_onramp_worker/main.py')
worker=importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)
worker.HEARTBEAT_SECONDS=0.025
worker.CANCEL_GRACE_SECONDS=0.10
def exercise_cancellation():
    with tempfile.TemporaryDirectory(prefix='science-cancel-') as temp:
        root=Path(temp)
        child=root/'child.py'; parent=root/'parent.py'
        ready=root/'ready'; marker=root/'child-completed'
        child.write_text("import time\nfrom pathlib import Path\nPath("+repr(str(ready))+").write_text('ready')\ntime.sleep(1.5)\nPath("+repr(str(marker))+").write_text('child continued after cancellation')\n")
        parent.write_text("import subprocess,sys\nsubprocess.run([sys.executable,"+repr(str(child))+"],check=True)\n")
        (root/'unused.json').write_text('{}')
        event=threading.Event(); callbacks=[]
        job={'jobId':'synthetic-owned-review'}
        worker._jobs[job['jobId']]={'cancelEvent':event,'jobId':job['jobId'],'status':'queued'}
        worker._build_bootstrap_command=lambda _:([sys.executable,str(parent)],root/'unused.json')
        worker._post_callback=lambda _, payload: callbacks.append(payload)
        thread=threading.Thread(target=worker._run_job,args=(job,)); thread.start()
        deadline=time.monotonic()+5
        while not ready.exists() and time.monotonic()<deadline:
            time.sleep(.01)
        assert ready.exists(), 'synthetic child did not start'
        started=time.monotonic(); event.set()
        thread.join(timeout=5)
        assert not thread.is_alive(), 'owned synthetic test exceeded bounded wait'
        elapsed=time.monotonic()-started
        assert worker._jobs[job['jobId']]['status']=='cancelled', 'cancellation branch did not produce cancelled'
        assert marker.exists(), 'cancellation no longer allows descendant write'
        assert elapsed>1.0, f'expected inherited-pipe wait, got {elapsed}'
        result_case={'descendant_wrote_after_cancel':marker.exists(),'cancel_elapsed_seconds':round(elapsed,3),'final_status':worker._jobs[job['jobId']]['status'],'callbacks':[x['status'] for x in callbacks]}
    return result_case

result['cancel_case']=exercise_cancellation()
import inspect
run_source=inspect.getsource(worker._run_job)
exec(run_source+'\n# harmless comment\n',worker.__dict__)
result['cancel_no_op']=exercise_cancellation()
exec(run_source.replace('if cancel_event.is_set():','if False:'),worker.__dict__)
try:
    exercise_cancellation()
except AssertionError as exc:
    result['cancel_targeted_control']={'detected':True,'message':str(exc)}
else:
    raise AssertionError('removed cancellation branch was missed')
worker.executor.shutdown(wait=True)
print(json.dumps(result,indent=2))
