#!/usr/bin/python3
"""One finite root-granted TEST window. Never dispatch a subject/native stage."""
import errno
import fcntl
import json
import os
from pathlib import Path
import subprocess
import sys
import time

import prepare

LOCK=Path('/home/nathaniel/.local/state/openplan/compiler-repair-checks-20261015.lock')


def require_limits(values):
    if values!={'memory.max':'1073741824','memory.swap.max':'0','cpu.max':'50000 100000'}:
        raise ValueError('R6_BOUNDED_TEST_PARENT_REQUIRED')
    return values



def named_readonly():
    return [prepare.REPO,prepare.OLD,prepare.OLD.with_name('a0-usage-limit-native-wrapper-20261016-r3'),
        prepare.OLD.with_name('a0-usage-limit-native-wrapper-20261016-r4'),
        prepare.ROOT.parent/'pr330-final-source-preview-20261016/templates',prepare.REVIEW,prepare.DECISION,prepare.PARENT,
        *[prepare.REPORTS/('2026-10-16-a0-r5-native-'+name) for name in ['observe','allocate']]]


def planned_steps():
    return [('prepare',['/usr/bin/python3','-B',str(prepare.HERE/'prepare.py')]),
        ('diagnostic-proposal',['/usr/bin/python3','-B',str(prepare.HERE/'diagnostic_proposal.py')]),
        ('sequence',['/usr/bin/python3','-B',str(prepare.HERE/'sequence_controls.py')]),
        ('continuity',['/usr/bin/python3','-B',str(prepare.HERE/'case_continuity.py')]),
        ('direction',['/usr/bin/npm','run','product:direction:check']),
        ('final',['/usr/bin/python3','-B',str(prepare.HERE/'final_checks.py')])]

def inner():
    relative=Path('/proc/self/cgroup').read_text().strip().split('::',1)[1]
    cgroup=Path('/sys/fs/cgroup')/relative.lstrip('/')
    values=require_limits({name:(cgroup/name).read_text().strip() for name in ['memory.max','memory.swap.max','cpu.max']})
    intent=json.loads((prepare.EVIDENCE/'test-unit-01/intent.json').read_text())
    assert os.readlink('/proc/self/ns/net')!=intent['hostNetworkNamespace'],'R6_NETWORK_NOT_UNSHARED'
    probes=[]
    for path in [prepare.REPO/'AGENTS.md',prepare.PRIOR/'STATUS.md',prepare.OLD/'plan.json',prepare.OLD/'stages/restore419/intent.json',
        prepare.OLD.with_name('a0-usage-limit-native-wrapper-20261016-r3')/'plan.json',
        prepare.OLD.with_name('a0-usage-limit-native-wrapper-20261016-r4')/'plan.json',
        prepare.ROOT.parent/'pr330-final-source-preview-20261016/templates/helper.py',
        prepare.REVIEW/'REVIEW.md',prepare.DECISION/'failed-restore-summary.json',prepare.PARENT/'exit.json',
        *[prepare.REPORTS/('2026-10-16-a0-r5-native-'+name)/'STATUS.md' for name in ['observe','allocate']]]:
        try:fd=os.open(path,os.O_WRONLY)
        except OSError as error:
            assert error.errno==errno.EROFS,'R6_OLD_PROOF_NOT_READ_ONLY';probes.append({'path':str(path),'writeOpen':'EROFS'})
        else:os.close(fd);raise AssertionError('R6_OLD_PROOF_WRITABLE')
    prepare.write(prepare.EVIDENCE/'test-parent.json',{'limits':values,'cgroup':relative,
        'invocationID':os.environ.get('INVOCATION_ID'),'networkNamespace':os.readlink('/proc/self/ns/net'),
        'readOnlyProbes':probes,'namedMounts':[line for line in Path('/proc/self/mountinfo').read_text().splitlines() if any(' '+str(path)+' ' in line for path in named_readonly())],
        'mountClaim':'Named mounts/probes only; inherited nested writable mounts are not claimed absent. Explicit writable rebinds are new packet/evidence and shared lock.',
        'lockMode':'nonblocking exclusive once; no waiter/retry'})
    with LOCK.open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        environment={'PATH':'/usr/bin:/bin','HOME':str(prepare.EVIDENCE/'home'),'LANG':'C.UTF-8','PYTHONDONTWRITEBYTECODE':'1',
            'npm_config_update_notifier':'false','npm_config_audit':'false','npm_config_fund':'false',
            'npm_config_cache':str(prepare.EVIDENCE/'npm-cache'),'npm_config_logs_dir':str(prepare.EVIDENCE/'npm-logs')}
        steps=planned_steps()
        rows=[]
        for name,argv in steps:
            prepare.write(prepare.EVIDENCE/(name+'-intent.json'),{'argv':argv,'environment':environment,'retry':False})
            started=time.monotonic()
            with (prepare.EVIDENCE/(name+'.stdout.log')).open('xb') as out,(prepare.EVIDENCE/(name+'.stderr.log')).open('xb') as err:
                child=subprocess.Popen(argv,stdout=out,stderr=err,env=environment,cwd=prepare.REPO/'openplan')
                prepare.write(prepare.EVIDENCE/(name+'-returned-process.json'),{'pid':child.pid})
                code=child.wait(timeout=110)
                out.flush();err.flush();os.fsync(out.fileno());os.fsync(err.fileno())
            row={'step':name,'exitCode':code,'seconds':time.monotonic()-started,
                'stdoutSHA256':prepare.sha(prepare.EVIDENCE/(name+'.stdout.log')),'stderrSHA256':prepare.sha(prepare.EVIDENCE/(name+'.stderr.log'))}
            prepare.write(prepare.EVIDENCE/(name+'-exit.json'),row);rows.append(row)
            if code:raise SystemExit(code)
        prepare.write(prepare.EVIDENCE/'test-steps-terminal.json',{'rows':rows,'resources':{
            name:(cgroup/name).read_text().strip() if (cgroup/name).exists() else 'UNAVAILABLE' for name in ['memory.peak','memory.events','memory.swap.peak']},
            'nativeDispatches':0,'flock':'released when this terminal parent exits; no waiting or repeated acquisition'})
    print('R6 finite TEST steps terminal zero; compiler flock released; no native dispatch')


def main():
    os.umask(0o077)
    if len(sys.argv)==2 and sys.argv[1]=='--inner':inner();return
    grant=prepare.EVIDENCE/'root-test-window-grant.json'
    assert grant.is_file(),'HOLD_R6_ROOT_FINITE_WINDOW_NOT_GRANTED'
    root=prepare.EVIDENCE/'test-unit-01';root.mkdir(mode=0o700)
    environment={'PATH':'/usr/bin:/bin','HOME':str(prepare.EVIDENCE/'home'),'LANG':'C.UTF-8',
        'XDG_RUNTIME_DIR':'/run/user/'+str(os.getuid()),'PYTHONDONTWRITEBYTECODE':'1'}
    readonly=[]
    for path in named_readonly():readonly.extend(['--ro-bind',str(path),str(path)])
    argv=['/usr/bin/systemd-run','--user','--wait','--pipe','--collect','--unit=openplan-a0-r6-sequence-TEST-01-20261016',
        '-p','MemoryMax=1G','-p','MemorySwapMax=0','-p','CPUQuota=50%','-p','RuntimeMaxSec=180','-p','UMask=0077',
        '/usr/bin/bwrap','--ro-bind','/','/',*readonly,'--bind',str(prepare.ROOT),str(prepare.ROOT),
        '--bind',str(prepare.EVIDENCE),str(prepare.EVIDENCE),'--bind',str(LOCK),str(LOCK),'--unshare-net','--proc','/proc','--dev','/dev',
        '/usr/bin/python3','-B',str(Path(__file__).resolve()),'--inner']
    prepare.write(prepare.EVIDENCE/'prepared-code-pins.json',{
        'runtimeFiles':{name:prepare.pin(prepare.SOURCE/name) for name in prepare.RUNTIME},
        'preparationCode':{path.name:prepare.pin(path) for path in sorted(prepare.HERE.glob('*.py'))},
        'plannedSteps':planned_steps(),'outerArgv':argv,'rootGrantSHA256':prepare.sha(grant)})
    prepare.write(root/'intent.json',{'argv':argv,'environment':environment,'hostNetworkNamespace':os.readlink('/proc/self/ns/net'),
        'grantSHA256':prepare.sha(grant),'preparedCodeSHA256':prepare.sha(prepare.EVIDENCE/'prepared-code-pins.json'),'scope':'R6 pure TEST only; subject Popen inert; no native/manager-stage/admission dispatch'})
    with (root/'stdout.log').open('xb') as out,(root/'stderr.log').open('xb') as err:
        child=subprocess.Popen(argv,stdout=out,stderr=err,env=environment)
        prepare.write(root/'returned-process.json',{'pid':child.pid})
        code=child.wait(timeout=210)
        out.flush();err.flush();os.fsync(out.fileno());os.fsync(err.fileno())
    prepare.write(root/'exit.json',{'exitCode':code,'stdoutSHA256':prepare.sha(root/'stdout.log'),'stderrSHA256':prepare.sha(root/'stderr.log')})
    print(json.dumps({'testUnit':'R6-01','exitCode':code,'receipts':str(root)}))
    raise SystemExit(code)


if __name__=='__main__':main()
