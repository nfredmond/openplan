"""Owned synthetic files only. In-process HTTP route, no network listener."""
import importlib.util
import json
import shlex
import sys
import tempfile
import types
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
WORKER=ROOT/'workers/activitysim_worker'
sys.path.insert(0,str(WORKER))
spec=importlib.util.spec_from_file_location('runtime_fixture',WORKER/'tests/test_runtime.py')
fixture=importlib.util.module_from_spec(spec); spec.loader.exec_module(fixture)
source=(WORKER/'main.py').read_text()

def module(source):
    result=types.ModuleType('activitysim_review')
    result.__file__=str(WORKER/'main.py')
    exec(compile(source,str(WORKER/'main.py'),'exec'),result.__dict__)
    return result

def exercise(worker):
    worker.WORKER_TOKEN=''
    with tempfile.TemporaryDirectory(prefix='science-asim-http-') as temp:
        root=Path(temp)
        bundle=fixture.build_bundle(root)
        (bundle/'configs/settings.yaml').write_text('models: []\n')
        (bundle/'configs/constants.yaml').write_text('starter: true\n')
        victim=root/'unrelated-data'; victim.mkdir()
        saved=victim/'synthetic-record.txt'; saved.write_text('keep me')
        marker=root/'command-marker.txt'
        code='from pathlib import Path; Path('+repr(str(marker))+').write_text("executed")'
        payload={'bundlePath':str(bundle),'runtimeOutputDir':str(victim),'force':True,'activitysimCliTemplate':shlex.quote(sys.executable)+' -c '+shlex.quote(code)}
        client=worker.app.test_client()
        worker.WORKER_TOKEN='synthetic-test-token'
        refused=client.post('/jobs',json=payload,environ_base={'REMOTE_ADDR':'198.51.100.27'})
        assert refused.status_code==401
        assert saved.exists() and not marker.exists()
        worker.WORKER_TOKEN=''
        response=client.post('/jobs',json=payload,environ_base={'REMOTE_ADDR':'198.51.100.27'})
        assert response.status_code==200, response.get_json()
        assert not saved.exists(), 'unauthenticated deletion evidence changed'
        assert marker.read_text()=='executed', 'unauthenticated executable evidence changed'
        return {'configured_token_refusal':refused.status_code,'tokenless_remote_http_status':response.status_code,'unrelated_record_deleted':not saved.exists(),'request_command_executed':marker.exists(),'runtime_status':response.get_json()['status'],'network_listener_opened':False}

result={'baseline':exercise(module(source)),'harmless_comment':exercise(module(source+'\n# harmless review comment\n'))}
# Broken branch mutation prevents the command from reaching runtime. Exact
# assertion failure demonstrates this check can distinguish a refused request.
mutated=source.replace('if WORKER_TOKEN:\n','if True:\n',1)
assert mutated!=source
try:
    exercise(module(mutated))
except AssertionError as exc:
    result['targeted_auth_branch_control']={'detected':True,'message':str(exc)}
else:
    raise AssertionError('forced refusal was missed')
print(json.dumps(result,indent=2))
