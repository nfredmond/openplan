"""One explicitly granted pure window. No automatic retry or successor."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time

HERE=Path(__file__).resolve().parent
REPO=HERE.parents[2]
ROOT=Path('/home/nathaniel/.local/state/openplan/a0-migration-history-literal-correction-20261016')
LOCK=ROOT.parent/'compiler-repair-checks-20261015.lock'
UNIT='openplan-a0-history-literal-TEST-01-20261016'
READONLY=[REPO,Path('/home/nathaniel/.t3/worktrees/openplan/t3-ac91cc52'),
    Path('/home/nathaniel/.t3/worktrees/openplan/t3-012fdf58/docs/reviews/2026-10-16-a0-r6-apply17-admission-independent'),
    Path('/home/nathaniel/.t3/worktrees/openplan/t3-989ae2bb/docs/reviews/2026-10-16-postgres-history-literal-semantics')]
READONLY += [ROOT.parent/name for name in [
    'a0-usage-limit-native-wrapper-20261016-r6','a0-usage-limit-native-wrapper-20261016-r5',
    'a0-usage-limit-native-wrapper-20261016-r3','pr330-final-source-preview-20261016/templates',
    'a0-r6-observe-root-decision-20261016','a0-r6-allocate-root-decision-20261016',
    'a0-r6-restore419-root-decision-20261016','a0-r6-apply17-admission-proposal-20261016',
    'postgres-history-literal-semantics-20261016']]


def emit(path,value):
    with path.open('x',encoding='utf-8') as out:
        json.dump(value,out,indent=2,sort_keys=True);out.write('\n');out.flush();os.fsync(out.fileno())
    path.chmod(0o600)


def argv():
    args=['/usr/bin/systemd-run','--user','--wait','--pipe','--collect','--unit='+UNIT,
        '-p','MemoryMax=512M','-p','MemorySwapMax=0','-p','CPUQuota=50%',
        '-p','TasksMax=64','-p','RuntimeMaxSec=180','-p','UMask=0077',
        '/usr/bin/bwrap','--ro-bind','/','/']
    for path in READONLY:args+=['--ro-bind',str(path),str(path)]
    args+=['--bind',str(ROOT),str(ROOT),'--bind',str(LOCK),str(LOCK),
        '--unshare-net','--proc','/proc','--dev','/dev',
        '--dev-bind','/dev/null','/dev/null','--','/usr/bin/env','-i',
        'PATH=/usr/bin:/bin','HOME='+str(ROOT/'home'),'LANG=C.UTF-8',
        'PYTHONDONTWRITEBYTECODE=1','TMPDIR='+str(ROOT/'tmp'),
        'npm_config_cache='+str(ROOT/'npm-cache'),'npm_config_logs_dir='+str(ROOT/'npm-logs'),
        'npm_config_update_notifier=false','npm_config_audit=false','npm_config_fund=false',
        '/usr/bin/python3','-B',str(HERE/'window.py'),'--inner']
    return args


def check_resources(resource):
    if resource!={'memory.max':'536870912','memory.swap.max':'0','cpu.max':'50000 100000','pids.max':'64'}:
        raise ValueError('test-resource-refusal')


def inner():
    os.umask(0o077)
    # One nonblocking shared compiler acquisition. A busy lock is terminal.
    with LOCK.open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX | fcntl.LOCK_NB)
        relative=next(line.split(':',2)[2] for line in Path('/proc/self/cgroup').read_text().splitlines() if line.startswith('0::'))
        group=Path('/sys/fs/cgroup')/relative.lstrip('/')
        resource={x:(group/x).read_text().strip() for x in ['memory.max','memory.swap.max','cpu.max','pids.max']}
        emit(ROOT/'test-resources.json',{'cgroup':relative,'actual':resource,
            'networkNamespace':os.readlink('/proc/self/ns/net'),'mountinfo':Path('/proc/self/mountinfo').read_text(),
            'readOnlyRoots':[str(x) for x in READONLY]})
        check_resources(resource)
        probes=[]
        for path in [REPO/'AGENTS.md',READONLY[1]/'AGENTS.md',
                     ROOT.parent/'a0-usage-limit-native-wrapper-20261016-r6/plan.json']:
            try:
                fd=os.open(path,os.O_WRONLY);os.close(fd)
            except OSError as error:probes.append({'path':str(path),'errno':error.errno})
            else:raise ValueError('named-readonly-writeopen-succeeded')
        emit(ROOT/'test-readonly-probes.json',probes)
        for name in ['home','tmp','npm-cache','npm-logs']:(ROOT/name).mkdir(mode=0o700)
        steps=[(['/usr/bin/python3','-B',str(HERE/'prepare.py')],REPO),
               (['/usr/bin/npm','run','product:direction:check'],REPO/'openplan'),
               (['/usr/bin/python3','-B',str(HERE/'controls.py')],REPO),
               (['/usr/bin/python3','-B',str(HERE/'final_checks.py')],REPO)]
        results=[]
        for index,(command,cwd) in enumerate(steps):
            path=ROOT/('step-'+str(index+1));path.mkdir(mode=0o700)
            emit(path/'intent.json',{'argv':command,'cwd':str(cwd),'retry':'forbidden'})
            with (path/'stdout.bin').open('xb') as out,(path/'stderr.bin').open('xb') as err:
                proc=subprocess.Popen(command,cwd=cwd,stdout=out,stderr=err,env=dict(os.environ))
                emit(path/'returned-process.json',{'pid':proc.pid})
                code=proc.wait(timeout=145)
            result={'step':index+1,'returncode':code,'stdoutSHA256':hashlib.sha256((path/'stdout.bin').read_bytes()).hexdigest(),
                    'stderrSHA256':hashlib.sha256((path/'stderr.bin').read_bytes()).hexdigest()}
            emit(path/'exit.json',result);results.append(result)
            emit(ROOT/('steps-through-'+str(index+1)+'.json'),results)
            if code:raise SystemExit(code)
        emit(ROOT/'pure-window-terminal.json',{'steps':results,'status':'complete','nativeDispatches':0})


def outer():
    os.umask(0o077)
    grant=ROOT/'root-pure-window-grant.json'
    if not grant.is_file():raise ValueError('MISSING_EXPLICIT_ROOT_PURE_WINDOW_GRANT')
    path=ROOT/'test-unit-01';path.mkdir(mode=0o700)
    environment={'PATH':'/usr/bin:/bin','HOME':str(ROOT/'home'),'LANG':'C.UTF-8',
        'XDG_RUNTIME_DIR':'/run/user/'+str(os.getuid()),'PYTHONDONTWRITEBYTECODE':'1'}
    emit(path/'intent.json',{'argv':argv(),'environment':environment,'grantSHA256':hashlib.sha256(grant.read_bytes()).hexdigest(),
        'preparedPinsSHA256':hashlib.sha256((ROOT/'prepared-window-pins.json').read_bytes()).hexdigest(),
        'hostNetworkNamespace':os.readlink('/proc/self/ns/net')})
    start=time.monotonic()
    with (path/'stdout.bin').open('xb') as out,(path/'stderr.bin').open('xb') as err:
        proc=subprocess.Popen(argv(),env=environment,stdout=out,stderr=err)
        emit(path/'returned-process.json',{'pid':proc.pid})
        code=proc.wait(timeout=195)
    emit(path/'exit.json',{'returncode':code,'seconds':time.monotonic()-start,
        'stdoutSHA256':hashlib.sha256((path/'stdout.bin').read_bytes()).hexdigest(),
        'stderrSHA256':hashlib.sha256((path/'stderr.bin').read_bytes()).hexdigest(),
        'retry':'forbidden; terminal exit releases this invocation lock if reached; no native claim'})
    print(json.dumps({'pureWindowExit':code,'proof':str(path)}))
    raise SystemExit(code)


if __name__=='__main__':
    if sys.argv[1:]==['--inner']:inner()
    elif sys.argv[1:]==['--outer']:outer()
    else:raise ValueError('explicit-window-mode-required')
