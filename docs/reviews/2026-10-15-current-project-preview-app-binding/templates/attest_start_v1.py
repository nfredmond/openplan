"""Parent-only readback after the reviewed web unit starts. Not browser acceptance."""
import json
import os
from pathlib import Path
import re
import sys
import urllib.request

import app_binding_v1 as a

UNIT = 'openplan-current-project-preview-app-678-v1-web.service'


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
    rows=a.command(['/usr/bin/ss','-H','-ltnp','sport = :3585']).decode().splitlines()
    a.require(len(rows)==1 and rows[0].split()[3]==a.HOST+':3585', 'attest-listener')
    pids=set(re.findall(r'pid=([0-9]+)',rows[0]))
    a.require(len(pids)==1, 'attest-listener-pid')
    pid=next(iter(pids));proc=Path('/proc')/pid
    a.require(proc.joinpath('cwd').resolve()==a.APP, 'attest-process-cwd')
    a.require(proc.joinpath('cgroup').read_text().strip()=='0::'+properties['ControlGroup'], 'attest-process-cgroup')
    environment=dict(item.split('=',1) for item in proc.joinpath('environ').read_bytes().decode().split('\0') if '=' in item)
    expected=a.environment(values,'start')
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
              health['deployment']['commit']==a.APP_HEAD and
              health['deployment']['migrations']=={'expected':419,'latest':'20261017000016'}, 'attest-http-identity')
    a.require(a.acquire(r)==active and a.app_check(r)[0]==app, 'attest-input-race')
    a.write_once(a.RUN/'runtime-start-attestation.json',{'schema':1,'unit':UNIT,'mainPid':properties['MainPID'],
        'listenerPid':pid,'app':app,'active':active,'resources':resources,'health':health,
        'processEnvironmentDigest':a.digest(environment),'buildInventoryDigest':a.digest(now),
        'buildResultSha256':a.sha(a.RUN/'build-result.json'),'startIntentSha256':a.sha(a.RUN/'start-intent.json'),
        'attestorSha256':a.sha(Path(__file__)),
        'boundary':'Identified HTTP/process readback only. Desktop, 390px, console, artifacts and human acceptance remain unproved.'})


if __name__=='__main__':
    os.umask(0o077)
    os.environ.clear()
    os.environ.update(PATH='/usr/bin:/bin', HOME=str(a.ROOT/'tmp'), PYTHONDONTWRITEBYTECODE='1')
    a.require(Path(__file__).resolve()==a.ROOT/'attest_start_v1.py','attestor-root')
    try:attest()
    except BaseException as error:
        print('REFUSED attest: '+(str(error) if type(error) is ValueError else type(error).__name__),file=sys.stderr)
        raise SystemExit(1)
