"""Exercise actual constructor/env with only new child-owned writable specimens."""
import json
import os
from pathlib import Path
import subprocess
import sys
import types

PUBLIC=Path(__file__).resolve().parent.parent/'2026-10-15-current-project-preview-app-binding'
ROOT=Path('/home/nathaniel/.local/state/openplan/current-project-preview-app-binding-independent-20261015')
SPEC=ROOT/('independent-boundary-'+(sys.argv[1] if len(sys.argv)>1 else '01'))
PROBE=r'''
import errno,json,os,pathlib
base=pathlib.Path(os.environ['PROBE_ROOT'])
app=base/'candidate/openplan';link=app/'node_modules'
assert link.is_symlink() and link.resolve()==base/'donor', 'dependency-link-lost'
for path in [link/'package.json',app/'.env.local',base/'whole-host-readonly']:
    assert path.read_text()=='specimen', 'harmless-read'
    try:path.write_text('write attempt')
    except OSError as e:assert e.errno==errno.EROFS,'readonly-error'
    else:raise AssertionError('write-permitted:'+path.name)
for name in ['HOME','npm_config_cache','npm_config_logs_dir','XDG_CACHE_HOME']:
    path=pathlib.Path(os.environ[name]);path.mkdir(parents=True,exist_ok=True)
    temporary=path/'atomic-temp';temporary.write_text('private output')
    temporary.replace(path/'atomic-result')
pathlib.Path('/tmp/probe').write_text('private temp')
with open('/dev/null','w') as f:f.write('device works')
(app/'.next/cache').mkdir(parents=True)
(app/'.next/cache/file').write_text('mutable cache')
assert not pathlib.Path('/run/docker.sock').exists() and not pathlib.Path('/var/run/docker.sock').exists()
assert 'OPENAI_API_KEY' not in os.environ
print(json.dumps({'symlinkPreserved':True,'reads':3,'EROFS':3,'privateWrites':6,'privateDevNull':True}))
'''

def main():
    os.umask(0o077);SPEC.mkdir(mode=0o700)
    base=(PUBLIC/'templates/app_binding_v1.py').read_bytes()
    rows=[]
    for label,source,reason in [
        ('baseline',base,None),
        ('harmless source comment',base+b'\n# Comment only.\n',None),
        ('writable resolved donor',base.replace(b"'--ro-bind', str(DEPS)",b"'--bind', str(DEPS)"),'write-permitted:package.json'),
        ('writable env',base.replace(b"'--ro-bind', str(APP/'.env.local')",b"'--bind', str(APP/'.env.local')"),'write-permitted:.env.local'),
        ('restored',base,None)]:
        case=SPEC/str(len(rows));case.mkdir(mode=0o700)
        m=types.ModuleType('boundary');m.__file__=str(case/'app_binding_v1.py')
        exec(compile(source,m.__file__,'exec'),vars(m))
        m.CANDIDATE=case/'candidate';m.APP=m.CANDIDATE/'openplan';m.RUN=case/'execution';m.DEPS=case/'donor'
        for p in [m.APP,m.RUN,m.DEPS,m.RUN/'tmp']:p.mkdir(parents=True,mode=0o700,exist_ok=True)
        for p in [m.DEPS/'package.json',m.APP/'.env.local',case/'whole-host-readonly']:p.write_text('specimen')
        (m.APP/'node_modules').symlink_to(m.DEPS)
        args=m.confined_argv('build');assert args[-3:]==['/usr/bin/npm','run','build']
        env=m.environment({'PROBE_ROOT':str(case)},'build')
        try:
            result=subprocess.run(args[:-3]+['/usr/bin/python3','-B','-c',PROBE],env=env,capture_output=True,timeout=15)
            if reason:
                assert result.returncode!=0 and reason in result.stderr.decode(),label
                rows.append({'case':label,'outcome':'detected','reason':reason})
            else:
                assert result.returncode==0,result.stderr.decode()
                rows.append({'case':label,'outcome':'survived','observed':json.loads(result.stdout)})
        finally:
            for p in [m.DEPS/'package.json',m.APP/'.env.local',case/'whole-host-readonly']:p.write_text('specimen')
    with (ROOT/(SPEC.name+'.json')).open('x') as f:json.dump(rows,f,indent=2);f.write('\n')
    assert (PUBLIC/'templates/app_binding_v1.py').read_bytes()==base
    print(json.dumps({'observations':len(rows),'faults':2,'restored':True}))

if __name__=='__main__':main()
