"""Run the exact mount constructor with child-owned stand-ins and a Python probe."""
import errno
import json
import os
from pathlib import Path
import subprocess
import types

os.umask(0o077)
PUBLIC=Path(__file__).resolve().parent
PRIVATE=Path('/home/nathaniel/.local/state/openplan/current-project-preview-app-binding-20261015-v2')
SPEC=PRIVATE/'boundary-specimens-03'
SPEC.mkdir(mode=0o700)
BASE=(PUBLIC/'templates/app_binding_v1.py').read_bytes()
PROBE=r'''
import errno,json,os,pathlib
base=pathlib.Path(os.environ['SPEC'])
for path in [base/'borrowed-deps/original',base/'whole-host-ro-specimen',base/'candidate/openplan/.env.local']:
    assert path.read_text()=='readable specimen', 'harmless-read'
    try:path.write_text('attempted write')
    except OSError as e:assert e.errno==errno.EROFS, 'expected-read-only-filesystem'
    else:raise AssertionError('read-only-write-allowed:'+path.name)
cache=pathlib.Path(os.environ['npm_config_cache'])
assert str(cache)==str(base/'execution/npm-cache'), 'private-cache-env'
logs=cache/'_logs';logs.mkdir(exist_ok=True)
(logs/'fixture.log').write_text('private npm log stand-in')
(base/'candidate/openplan/generated-fixture').write_text('owned output')
pathlib.Path('/tmp/tmp-fixture').write_text('private tmp')
assert not pathlib.Path('/run/docker.sock').exists(), 'docker-socket-hidden'
assert not pathlib.Path('/var/run/docker.sock').exists(), 'docker-socket-alias-hidden'
assert 'OPENAI_API_KEY' not in os.environ and 'HTTP_PROXY' not in os.environ, 'ambient-env'
print(json.dumps({'readonlyReads':3,'readonlyRefusals':3,'ownedWrites':3,'cache':str(cache),'dockerSocketHidden':True}))
'''
results=[]
for name,source,fault in [
    ('baseline',BASE,None),
    ('harmless comment',BASE+b'\n# No behavior changes.\n',None),
    ('writable dependencies',BASE.replace(b"'--ro-bind', str(DEPS)",b"'--bind', str(DEPS)"),'read-only-write-allowed:original'),
    ('writable environment',BASE.replace(b"'--ro-bind', str(APP/'.env.local')",b"'--bind', str(APP/'.env.local')"),'read-only-write-allowed:.env.local'),
    ('restored',BASE,None)]:
    module=types.ModuleType('boundary_fixture');module.__file__=str(PRIVATE/'app_binding_v1.py')
    exec(compile(source,module.__file__,'exec'),module.__dict__)
    module.CANDIDATE=SPEC/'candidate';module.APP=module.CANDIDATE/'openplan';module.RUN=SPEC/'execution';module.DEPS=SPEC/'borrowed-deps'
    for path in [module.APP,module.RUN,module.DEPS,*[module.RUN/x for x in ['home','npm-cache','cache','tmp']]]:
        path.mkdir(parents=True,exist_ok=True,mode=0o700)
    for path in [module.DEPS/'original',SPEC/'whole-host-ro-specimen',module.APP/'.env.local']:
        path.write_text('readable specimen')
    link=module.APP/'node_modules'
    if not link.exists():link.symlink_to(module.DEPS)
    args=module.confined_argv('build')
    assert args[-3:]==['/usr/bin/npm','run','build']
    args=args[:-3]+['/usr/bin/python3','-B','-c',PROBE]
    env=module.environment({'SPEC':str(SPEC)},'build')
    result=subprocess.run(args,env=env,capture_output=True,timeout=15)
    if fault:
        assert result.returncode!=0 and fault in result.stderr.decode(), (name,result.stderr)
        results.append({'case':name,'outcome':'detected','reason':fault})
    else:
        assert result.returncode==0,(name,result.stderr)
        results.append({'case':name,'outcome':'survived','observed':json.loads(result.stdout)})
    for path in [module.DEPS/'original',SPEC/'whole-host-ro-specimen',module.APP/'.env.local']:
        path.write_text('readable specimen')
with (PRIVATE/'boundary-controls-02.json').open('x') as f:json.dump(results,f,indent=2);f.write('\n')
print(json.dumps({'observations':len(results),'faults':2,'restored':True}))
