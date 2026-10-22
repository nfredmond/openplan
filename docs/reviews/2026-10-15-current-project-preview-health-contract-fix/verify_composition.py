"""Execute the fixed POSIX stage recipe through real systemd and inner bubblewrap.

Only the controller business operation and final npm payload use stand-ins.
Every specimen, result, derived recipe and log stays in the new private root.
"""
import ast
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time

os.umask(0o077)
PUBLIC=Path(__file__).resolve().parent
ROOT=Path('/home/nathaniel/.local/state/openplan/current-project-preview-app-binding-20261015-v2')
SPEC=ROOT/'composed-recipe-07';SPEC.mkdir(mode=0o700)
BASE=(PUBLIC/'templates/app_binding_v1.py').read_bytes()
RECIPE=(PUBLIC/'run_stage_v2.sh').read_bytes()
HEAD='67828c17c4c270529468eef1edd144e4a52b693a'
health=json.loads((ROOT/'actual-health-producer.json').read_bytes())['baseline']['payload']

PROBE=r'''
import ast,json,os,pathlib,sys
p=pathlib.Path;spec=p(os.environ['SPEC'])
# An exclusive marker detects a second child, even if the controller replays it.
with (spec/'execution/child-once').open('x') as f:f.write('one child')
assert os.environ['OPENPLAN_COMMIT_SHA']=='67828c17c4c270529468eef1edd144e4a52b693a', 'full-process-commit'
for key,rel in [('HOME','home'),('npm_config_cache','npm-cache'),('npm_config_logs_dir','npm-cache/_logs'),('XDG_CACHE_HOME','cache')]:
    assert os.environ[key]==str(spec/'execution'/rel), 'private-env:'+key
assert os.environ['TMPDIR']=='/tmp', 'private-env:TMPDIR'
assert not any(k in os.environ for k in ['OPENAI_API_KEY','HTTP_PROXY','NODE_PATH']), 'ambient-environment'
assert os.environ['NODE_OPTIONS']=='--max-old-space-size='+('6144' if os.environ['PHASE']=='build' else '320'), 'phase-heap'
net=os.readlink('/proc/self/ns/net')
assert (net!=os.environ['PARENT_NET'])==(os.environ['PHASE']=='build'), 'phase-network-namespace'
assert not p('/run/docker.sock').exists() and not p('/var/run/docker.sock').exists(), 'docker-socket-visible'
link=spec/'candidate/openplan/node_modules';assert link.is_symlink(), 'donor-symlink'
protected=[link/'original',spec/'whole-host-specimen',spec/'candidate/openplan/.env.local']
for path in protected:
    assert path.read_text()=='readable specimen', 'protected-read'
    try:path.write_text('attempted write')
    except OSError as error:assert error.errno==30, 'protected-write-errno'
    else:raise AssertionError('protected-write-permitted:'+path.name)
for key in ['HOME','npm_config_cache','npm_config_logs_dir','XDG_CACHE_HOME']:
    directory=p(os.environ[key]);directory.mkdir(parents=True,exist_ok=True)
    staging=directory/'staging';staging.write_text('owned write');staging.rename(directory/'renamed')
p('/tmp/composed-tmp').write_text('private tmp')
cache=spec/'candidate/openplan/.next/cache';cache.mkdir(parents=True);(cache/'fixture').write_text('owned output')
with open('/dev/null','wb') as f:f.write(b'private device')
# Execute the actual v2 consumer statement, never a copied comparison. The
# separate 31-case campaign proves that full attest() calls this same guard.
sys.path.insert(0,'/home/nathaniel/.local/state/openplan/current-project-preview-app-binding-20261015-v2')
import app_binding_v1 as a
source=p('/home/nathaniel/.local/state/openplan/current-project-preview-app-binding-20261015-v2/attest_start_v1.py').read_text()
statements=[node for node in ast.walk(ast.parse(source)) if isinstance(node,ast.Expr) and isinstance(node.value,ast.Call)
    and any(isinstance(arg,ast.Constant) and arg.value=='attest-http-identity' for arg in node.value.args)]
assert len(statements)==1, 'actual-health-guard-selection'
payload=json.loads((spec/'health.json').read_bytes())
exec(compile(ast.fix_missing_locations(ast.Module(body=statements,type_ignores=[])),'actual-attestor-health-guard','exec'),{'a':a,'health':payload})
print(json.dumps({'childCount':1,'protectedReads':3,'EROFS':3,'privateDirectoryWrites':4,'tmpWrite':True,'ownedBuildCache':True,
    'networkPolicy':os.environ['PHASE'],'healthCommit':payload['deployment']['commit']}))
'''
CONTROLLER=r'''
import json,os,pathlib,subprocess,sys,types
p=pathlib.Path;spec=p(__file__).parent
m=types.ModuleType('composed_subject');m.__file__=str(spec/'subject.py')
exec(compile((spec/'subject.py').read_bytes(),m.__file__,'exec'),vars(m))
phase=sys.argv[1];assert phase in ['build','start']
m.CANDIDATE=spec/'candidate';m.APP=m.CANDIDATE/'openplan';m.RUN=spec/'execution';m.DEPS=spec/'donor'
args=m.confined_argv(phase);cut=args.index('/usr/bin/npm')
assert args[cut:]==(['/usr/bin/npm','run','build'] if phase=='build' else ['/usr/bin/npm','run','start','--','--hostname',m.HOST,'--port','3585'])
values={'OPENPLAN_COMMIT_SHA':m.APP_HEAD,'SPEC':str(spec),'PHASE':phase,'PARENT_NET':os.readlink('/proc/self/ns/net')}
env=m.environment(values,phase)
resources=m.cgroup();m.budget(resources,'start') # Fixture cap is 512 MiB for BOTH phases, never 10 GiB.
args=args[:cut]+['/usr/bin/python3','-B',str(spec/'probe.py')]
result=subprocess.run(args,cwd=m.APP,env=env,capture_output=True,timeout=15)
with (spec/'result.json').open('x') as f:
    json.dump({'returncode':result.returncode,'stdout':result.stdout.decode(),'stderr':result.stderr.decode(),
        'controllerResources':resources,'actualArgv':args,'environmentKeys':sorted(env)},f);f.flush();os.fsync(f.fileno())
sys.exit(result.returncode)
'''

def write(path,data):
    path.write_bytes(data);path.chmod(0o600)

def sha(data):return hashlib.sha256(data).hexdigest()

rows=[]
cases=[('baseline',BASE,RECIPE,None,None),('harmless comment',BASE+b'\n# Harmless composed fixture comment.\n',RECIPE,None,None),
    ('broken outer-inner composition',BASE,RECIPE,'nested', 'No permissions to create a new namespace'),
    ('writable donor',BASE.replace(b"'--ro-bind', str(DEPS)",b"'--bind', str(DEPS)"),RECIPE,None,'protected-write-permitted:original'),
    ('writable env',BASE.replace(b"'--ro-bind', str(APP/'.env.local')",b"'--bind', str(APP/'.env.local')"),RECIPE,None,'protected-write-permitted:.env.local'),
    ('wrong private HOME',BASE.replace(b"'HOME': str(RUN/'home')",b"'HOME': '/tmp'"),RECIPE,None,'private-env:HOME'),
    ('wrong cache path',BASE.replace(b"'npm_config_cache': str(RUN/'npm-cache')",b"'npm_config_cache': '/tmp/unowned-cache'"),RECIPE,None,'private-env:npm_config_cache'),
    ('wrong log path',BASE.replace(b"'npm_config_logs_dir': str(RUN/'npm-cache/_logs')",b"'npm_config_logs_dir': '/tmp/unowned-logs'"),RECIPE,None,'private-env:npm_config_logs_dir'),
    ('wrong health payload',BASE,RECIPE,'health','attest-http-identity'),
    ('wrong sealed subject',BASE,RECIPE,'seal','sealed-input-refused'),
    ('remove seal check',BASE,RECIPE.replace(b'/usr/bin/sha256sum --check --strict \"$ROOT/operation-files.sha256\" >/dev/null',b': # Removed seal check'),'seal-bypass','sealed-input-accepted'),
    ('inherit interpreter environment',BASE,RECIPE.replace(b'/usr/bin/env -i PATH=/usr/bin:/bin HOME=\"$ROOT/home\" PYTHONDONTWRITEBYTECODE=1 ',b''),'interpreter','ambient-interpreter-code-loaded'),
    ('restored',BASE,RECIPE,None,None)]
for phase in ['build','start']:
    for label,source,recipe,fault,reason in cases:
        index=len(rows)+1;spec=SPEC/f'{index:02}-{phase}';spec.mkdir(mode=0o700)
        for path in [spec/'candidate/openplan',spec/'donor',spec/'execution',*[spec/'execution'/x for x in ['home','npm-cache','cache','tmp']]]:
            path.mkdir(parents=True,exist_ok=True,mode=0o700)
        for path in [spec/'donor/original',spec/'whole-host-specimen',spec/'candidate/openplan/.env.local']:
            write(path,b'readable specimen')
        (spec/'candidate/openplan/node_modules').symlink_to(spec/'donor')
        payload=json.loads(json.dumps(health))
        if fault=='health':payload['deployment']['commit']='0'*12
        write(spec/'health.json',json.dumps(payload).encode())
        write(spec/'subject.py',source);write(spec/'probe.py',PROBE.encode());write(spec/'controller.py',CONTROLLER.encode())
        trap=spec/'trap';trap.mkdir(mode=0o700)
        write(trap/'sitecustomize.py',('from pathlib import Path\nPath('+repr(str(spec/'interpreter-trap'))+').write_text(\"loaded\")\n').encode())
        # Explicit fixture adapters: owned controller path/root, unique TEST unit,
        # and the build test's 512 MiB cap. Startup remains asynchronous as written.
        derived=recipe.replace(str(ROOT).encode(),str(spec).encode()).replace(b'app_binding_v1.py',b'controller.py')
        derived=derived.replace(b'openplan-current-project-preview-app-678-v1-',f'openplan-health-v2-composed07-{index:02}-'.encode())
        derived=derived.replace(b'MemoryMax=10G',b'MemoryMax=512M')
        derived=derived.replace(b'-p UMask=0077',b'-p UMask=0077 --setenv=PYTHONPATH='+str(trap).encode())
        if fault=='nested':
            prefix=f'/usr/bin/bwrap --die-with-parent --ro-bind / / --dev /dev --proc /proc --bind {spec} {spec} --bind {spec}/execution/tmp /tmp '.encode()
            derived=derived.replace(b'/usr/bin/python3 -B "$ROOT/controller.py"',prefix+b'/usr/bin/python3 -B "$ROOT/controller.py"')
        write(spec/'stage.sh',derived)
        seal=''.join(sha((spec/name).read_bytes())+'  '+str(spec/name)+'\n' for name in ['stage.sh','controller.py','subject.py','health.json'])
        write(spec/'operation-files.sha256',seal.encode())
        if fault in ['seal','seal-bypass']:write(spec/'subject.py',source+b'\n# Harmless but unsealed change.\n')
        try:
            result=subprocess.run(['/bin/sh',str(spec/'stage.sh'),phase],capture_output=True,timeout=25)
            write(spec/'runner-output-private.log',result.stdout+result.stderr)
            deadline=time.monotonic()+20
            while fault!='seal' and not (spec/'result.json').exists() and time.monotonic()<deadline:time.sleep(0.05)
            if fault=='seal':
                assert result.returncode!=0 and not (spec/'result.json').exists() and b'checksum' in result.stderr, 'sealed-input-not-refused'
                observed={'case':label,'phase':phase,'outcome':'detected','reason':reason,'childCount':0}
            elif fault=='seal-bypass':
                data=json.loads((spec/'result.json').read_bytes())
                try:assert result.returncode!=0 and not (spec/'execution/child-once').exists(), reason
                except AssertionError as error:
                    assert str(error)==reason and data['returncode']==0
                    observed={'case':label,'phase':phase,'outcome':'detected','reason':str(error),'childCount':1}
                else:raise AssertionError('missing-seal-guard-mutation-not-detected')
            elif fault=='interpreter':
                data=json.loads((spec/'result.json').read_bytes())
                try:assert not (spec/'interpreter-trap').exists(), reason
                except AssertionError as error:
                    assert str(error)==reason and data['returncode']==0
                    observed={'case':label,'phase':phase,'outcome':'detected','reason':str(error),'childCount':1}
                else:raise AssertionError('interpreter-env-mutation-not-detected')
            elif fault=='nested':
                unit=f'openplan-health-v2-composed07-{index:02}-'+('build' if phase=='build' else 'web')+'.service'
                journal=subprocess.check_output(['/usr/bin/journalctl','--user','-u',unit,'--no-pager','-o','cat'])
                write(spec/'journal-private.log',journal)
                data=json.loads((spec/'result.json').read_bytes())
                assert data['returncode']!=0 and reason in data['stderr'], 'nested-composition-not-detected'
                assert not (spec/'execution/child-once').exists()
                observed={'case':label,'phase':phase,'outcome':'detected','reason':reason,'childCount':0}
            else:
                data=json.loads((spec/'result.json').read_bytes())
                if reason:
                    assert data['returncode']!=0 and reason in data['stderr'],(label,data)
                    observed={'case':label,'phase':phase,'outcome':'detected','reason':reason,'childCount':1}
                else:
                    assert result.returncode==0 and data['returncode']==0,(label,data)
                    assert not (spec/'interpreter-trap').exists(), 'ambient-interpreter-code-loaded'
                    observed={'case':label,'phase':phase,'outcome':'survived','observed':json.loads(data['stdout']),'resources':data['controllerResources']}
            observed.update(recipeSha256=sha(derived),subjectSha256=sha(source))
            rows.append(observed)
        finally:
            write(spec/'subject.py',BASE)
            restored_recipe=(RECIPE.replace(str(ROOT).encode(),str(spec).encode()).replace(b'app_binding_v1.py',b'controller.py')
                .replace(b'openplan-current-project-preview-app-678-v1-',f'openplan-health-v2-composed07-{index:02}-'.encode()).replace(b'MemoryMax=10G',b'MemoryMax=512M'))
            restored_recipe=restored_recipe.replace(b'-p UMask=0077',b'-p UMask=0077 --setenv=PYTHONPATH='+str(trap).encode())
            write(spec/'stage.sh',restored_recipe)
            write(spec/'health.json',json.dumps(health).encode())
            for path in [spec/'donor/original',spec/'whole-host-specimen',spec/'candidate/openplan/.env.local']:write(path,b'readable specimen')
            assert (spec/'stage.sh').read_bytes()==restored_recipe
            assert (spec/'subject.py').read_bytes()==BASE
            seal=''.join(sha((spec/name).read_bytes())+'  '+str(spec/name)+'\n' for name in ['stage.sh','controller.py','subject.py','health.json'])
            write(spec/'operation-files.sha256',seal.encode())
            assert subprocess.run(['/usr/bin/sha256sum','--check','--strict',str(spec/'operation-files.sha256')],capture_output=True).returncode==0
assert (PUBLIC/'templates/app_binding_v1.py').read_bytes()==BASE
assert (PUBLIC/'run_stage_v2.sh').read_bytes()==RECIPE
write(ROOT/'composed-controls-07.json',json.dumps({'cases':rows,'restored':True,'recipeSha256':sha(RECIPE),
    'probeSha256':sha(PROBE.encode()),'controllerStandinSha256':sha(CONTROLLER.encode()),
    'adapters':['owned specimen root and unit names','512 MiB fixture build budget','trusted controller business operation and npm payload replaced','fixture unit injects harmless PYTHONPATH sitecustomize trap'],
    'limits':'No npm, app build/start, listener, real checkout, services, SQL or readiness acquisition; actual POSIX/systemd/inner bwrap construction and writes only.'},indent=2).encode())
print(json.dumps({'observations':len(rows),'phases':2,'harmlessSurvivors':2,'detected':sum(x['outcome']=='detected' for x in rows),'restored':True}))
