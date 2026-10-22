"""Parent-only readback after the reviewed web unit starts. Not browser acceptance."""
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import urllib.request

NEW_ROOT = Path('/home/nathaniel/.local/state/openplan/project-portfolio-skip-preview-20261015-v6')
V3 = Path('/home/nathaniel/.local/state/openplan/project-portfolio-skip-preview-20261015-v6')
BINDING_SHA = '780528a021a5b314d67c1ef2a31060e62798782a322c0e88d9fc217d61a20ccf'
if hashlib.sha256((V3/'app_binding_v1.py').read_bytes()).hexdigest() != BINDING_SHA:
    raise ValueError('attest-binding-sha')
sys.path.insert(0, str(V3))
try:
    import app_binding_v1 as a
finally:
    sys.path.pop(0)
a.require(Path(a.__file__).resolve()==V3/'app_binding_v1.py' and
          a.sha(Path(a.__file__))==BINDING_SHA, 'attest-binding-module')

NPM_SOURCES = {
    "/usr/lib/node_modules/npm/lib/commands/run.js": "86080ad381490dd347b5cde5071a8d2444c1f471e795f4a88957e4726fca20ab",
    "/usr/lib/node_modules/npm/node_modules/@npmcli/run-script/lib/run-script.js": "daceffb5ae860499cc8e0696c8c33ef5d705f62f597974858b6472fcd1215f79",
    "/usr/lib/node_modules/npm/node_modules/@npmcli/run-script/lib/run-script-pkg.js": "94dea9ff50028869f4f88c4ec5e520d56fa7c2f6cc03422a9f06c44d291a0c34",
    "/usr/lib/node_modules/npm/node_modules/@npmcli/run-script/lib/make-spawn-args.js": "d1647624f0ce227e5cff1c4570f3e754e0eaaf08041db354102ec2bdbbd721df",
    "/usr/lib/node_modules/npm/node_modules/@npmcli/run-script/lib/set-path.js": "bc023d0c2d0840074c9e81ac0bda0fed0ef75e64623fa670437a7706d05d3542"
}


# Fixed Linux npm run start case: no caller-supplied binPaths, one trusted PATH.
def npm_child_path(base):
    for name, expected in NPM_SOURCES.items():
        a.require(a.sha(Path(name))==expected, 'attest-npm-source:'+Path(name).name)
    a.require(base=='/usr/bin:/bin', 'attest-base-path')
    entries=[]
    directory=a.APP
    while True:
        entries.append(str(directory/'node_modules/.bin'))
        if directory.parent==directory:
            break
        directory=directory.parent
    entries.extend(['/usr/lib/node_modules/npm/node_modules/@npmcli/run-script/lib/node-gyp-bin',base])
    return ':'.join(entries)


UNIT = 'openplan-portfolio-skip-preview-49e3fa200-v6-web.service'


def attest():
    a.bindings()
    r=a.load_recovery()
    app,values=a.app_check(r)
    active=a.acquire(r)
    report=a.read(a.RUN/'build-result.json')
    intent=a.read(a.RUN/'start-intent.json')
    a.require(report['app']==app and report['active']==active and intent['app']==app and intent['active']==active and
        intent['buildResultSha256']==a.sha(a.RUN/'build-result.json') and
        intent['buildId']==report['buildId'], 'attest-inputs')
    a.budget(report['resourcesBefore'],'build');a.budget(report['resourcesAfter'],'build')
    a.require(report['returncode']==0 and report['buildId']==(a.APP/'.next/BUILD_ID').read_text().strip(), 'attest-build')
    before=a.read(a.RUN/'build-files.json');now=a.inventory(a.APP/'.next')
    # Next may write runtime caches. Every other built byte must still match.
    a.require({k:v for k,v in before.items() if not k.startswith('cache/')}==
              {k:v for k,v in now.items() if not k.startswith('cache/')}, 'attest-built-bytes')
    info=a.command(['/usr/bin/systemctl','--user','show',UNIT,'--property=ActiveState,ControlGroup,MainPID']).decode()
    properties=dict(line.split('=',1) for line in info.splitlines())
    a.require(properties['ActiveState']=='active' and properties['MainPID'].isdigit() and
              int(properties['MainPID'])>0 and properties['ControlGroup'].startswith('/user.slice/') and
              properties['ControlGroup'].endswith('/'+UNIT), 'attest-unit')
    # Require one exact listening socket and its actual process, never a port-only claim.
    rows=a.command(['/usr/bin/ss','-H','-ltnp','sport = :3586']).decode().splitlines()
    a.require(len(rows)==1 and rows[0].split()[3]==a.HOST+':3586', 'attest-listener')
    pids=set(re.findall(r'pid=([0-9]+)',rows[0]))
    a.require(len(pids)==1, 'attest-listener-pid')
    pid=next(iter(pids));proc=Path('/proc')/pid
    a.require(proc.joinpath('cwd').resolve()==a.APP, 'attest-process-cwd')
    a.require(proc.joinpath('cgroup').read_text().strip()=='0::'+properties['ControlGroup'], 'attest-process-cgroup')
    environment=dict(item.split('=',1) for item in proc.joinpath('environ').read_bytes().decode().split('\0') if '=' in item)
    expected=a.environment(values,'start')
    expected['PATH']=npm_child_path(expected['PATH'])
    a.require(all(environment.get(key)==value for key,value in expected.items()), 'attest-process-environment')
    a.require(not any(key in environment for key in ['OPENAI_API_KEY','ANTHROPIC_API_KEY','OPENROUTER_API_KEY',
        'RESEND_API_KEY','SMTP_HOST','DOCKER_HOST','NODE_PATH','HTTP_PROXY','HTTPS_PROXY']), 'attest-ambient-environment')
    group=Path('/sys/fs/cgroup')/properties['ControlGroup'].lstrip('/')
    resources={name:(group/name).read_text().strip() for name in ['memory.max','memory.swap.max','memory.events',
        'cpu.max','memory.peak','memory.swap.current']}
    a.budget(resources,'start')
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self,*args,**kwargs):return None
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
    with opener.open(a.WEB+'/api/health',timeout=5) as response:
        a.require(response.status==200, 'attest-http-status')
        health=json.loads(response.read(65536))
    a.require(health['service']=='openplan' and health['status']=='ok' and
              health['deployment']['commit']==a.APP_HEAD[:12].lower() and
              health['deployment']['migrations']=={'expected':420,'latest':'20261017000017'}, 'attest-http-identity')
    a.require(a.acquire(r)==active and a.app_check(r)[0]==app, 'attest-input-race')
    a.write_once(NEW_ROOT/'runtime-start-attestation.json',{'schema':1,'unit':UNIT,'mainPid':properties['MainPID'],
        'listenerPid':pid,'app':app,'active':active,'resources':resources,'health':health,
        'processEnvironmentDigest':a.digest(environment),'buildInventoryDigest':a.digest(now),
        'buildResultSha256':a.sha(a.RUN/'build-result.json'),'startIntentSha256':a.sha(a.RUN/'start-intent.json'),
        'attestorSha256':a.sha(Path(__file__)),
        'appBindingSha256':BINDING_SHA,'npmSourceHashes':NPM_SOURCES,
        'derivedNpmPathSha256':hashlib.sha256(expected['PATH'].encode()).hexdigest(),
        'boundary':'Identified HTTP/process readback only. Desktop, 390px, console, artifacts and human acceptance remain unproved.'})


def main():
    os.umask(0o077)
    os.environ.clear()
    os.environ.update(PATH='/usr/bin:/bin', HOME=str(a.ROOT/'tmp'), PYTHONDONTWRITEBYTECODE='1')
    a.require(Path(__file__).resolve()==NEW_ROOT/'attest_start_v1.py','attestor-root')
    try:attest()
    except BaseException as error:
        print('REFUSED attest: '+(str(error) if type(error) is ValueError else type(error).__name__),file=sys.stderr)
        raise SystemExit(1)


if __name__=='__main__':
    main()
