"""Small resource, private-file and outer-environment controls only."""
import json
import os
from pathlib import Path
import types
from unittest.mock import patch

PUBLIC=Path(__file__).resolve().parent
PRIVATE=Path('/home/nathaniel/.local/state/openplan/current-project-preview-app-binding-20261015')
BASE=(PUBLIC/'templates/app_binding_v1.py').read_bytes()
SPEC=PRIVATE/'small-guard-specimens-01';SPEC.mkdir(mode=0o700)
rows=[]


def load(source):
    module=types.ModuleType('small_fixture');module.__file__=str(PRIVATE/'app_binding_v1.py')
    exec(compile(source,module.__file__,'exec'),module.__dict__)
    return module


def campaign(source):
    m=load(source);out=[]
    actual=m.cgroup();m.budget(actual,'start')
    original=Path.read_text
    def attempt(label,action,reason=None):
        try:action()
        except BaseException as e:
            if reason is None or reason not in str(e):raise AssertionError(label+':unexpected:'+str(e)) from e
            out.append({'case':label,'outcome':'refused','reason':str(e)})
        else:
            if reason:raise AssertionError(label+':accepted-broken-behavior')
            out.append({'case':label,'outcome':'survived'})
    for label,memory,disk,reason in [
        ('headroom baseline',12*m.GiB,10*m.GiB,None),
        ('insufficient RAM',9*m.GiB,10*m.GiB,'build-headroom'),
        ('insufficient disk',12*m.GiB,7*m.GiB,'build-headroom')]:
        def read_text(path,*args,**kwargs):
            if str(path)=='/proc/meminfo':return 'MemAvailable: '+str(memory//1024)+' kB\n'
            return original(path,*args,**kwargs)
        with patch.object(Path,'read_text',read_text),patch.object(m.shutil,'disk_usage',return_value=types.SimpleNamespace(free=disk)):
            attempt(label,m.headroom,reason)
    specimen=SPEC/'private-file';specimen.write_text('fixture');specimen.chmod(0o600)
    attempt('private file baseline',lambda:m.private_file(specimen))
    try:
        specimen.chmod(0o644);attempt('public file refuses',lambda:m.private_file(specimen),'private-file:private-file')
    finally:specimen.chmod(0o600)
    link=SPEC/'link'
    if not link.exists():link.symlink_to(specimen)
    attempt('symlink refuses',lambda:m.private_file(link),'private-file:link')
    # Invalid CLI cannot dispatch a real operation, but still exercises environment clearing.
    with patch.dict(os.environ,{'DOCKER_HOST':'fixture-only','OPENAI_API_KEY':'fixture-only'},clear=True),\
         patch.object(m.sys,'argv',['fixture','invalid']):
        attempt('invalid CLI refuses',m.main,'operation')
        assert 'DOCKER_HOST' not in os.environ and 'OPENAI_API_KEY' not in os.environ, 'outer ambient environment retained'
        assert os.environ['HOME']==str(PRIVATE/'tmp')
    return out,actual

baseline,actual=campaign(BASE)
mutations=[
    ('harmless comment',BASE+b'\n# No behavior changes.\n',None),
    ('remove headroom guard',BASE.replace(b"require(available >= 10*GiB and free >= 8*GiB, 'build-headroom')",b"require(True, 'build-headroom')"),'insufficient RAM:accepted-broken-behavior'),
    ('remove file privacy guard',BASE.replace(b"require(path.is_file() and not path.is_symlink() and path.stat().st_mode & 0o777 == 0o600,",b"require(True or path.is_file() and not path.is_symlink() and path.stat().st_mode & 0o777 == 0o600,"),'public file refuses:accepted-broken-behavior'),
    ('inherit outer provider',BASE.replace(b'    os.environ.clear()\n',b'    pass\n'),'outer ambient environment retained'),
]
results=[]
for name,source,reason in mutations:
    assert source!=BASE
    try:
        campaign(source)
        if reason:raise AssertionError('fault-survived:'+name)
        results.append({'mutation':name,'outcome':'survived'})
    except AssertionError as e:
        if not reason or reason not in str(e):raise
        results.append({'mutation':name,'outcome':'detected','reason':str(e)})
restored,_=campaign(BASE);assert baseline==restored
with (PRIVATE/'small-guard-controls-01.json').open('x') as f:
    json.dump({'cases':baseline,'mutations':results,'restored':True,'actualPythonCgroup':actual},f,indent=2);f.write('\n')
assert (PUBLIC/'templates/app_binding_v1.py').read_bytes()==BASE
print(json.dumps({'cases':len(baseline),'mutations':len(results),'survivors':1,'restored':True}))
