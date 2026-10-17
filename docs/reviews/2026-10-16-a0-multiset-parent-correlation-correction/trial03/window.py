"""Prepared single pure window. No grant is present and no native subject starts."""
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import selectors
import signal
import stat
import struct
import subprocess
import sys
import time
import traceback

HERE=Path(__file__).resolve().parent
PACKET=HERE.parent
PRIVATE=Path('/home/nathaniel/.local/state/openplan/a0-multiset-parent-correlation-correction-20261016')
ROOT=PRIVATE/'trial03'
ATTEMPT=ROOT/'attempt-03'
MODEL=ROOT/'model-parent-03'
LOCK=PRIVATE.parent/'compiler-repair-checks-20261015.lock'
UNIT='openplan-a0-multiset-parent-correlation-TEST-03-20261016'
CAPS={'memory.max':'536870912','memory.swap.max':'0','cpu.max':'50000 100000','pids.max':'64'}
HOST_ENV={'PATH':'/usr/bin:/bin','LANG':'C','HOME':'/nonexistent','XDG_RUNTIME_DIR':'/run/user/1000',
    'DBUS_SESSION_BUS_ADDRESS':'unix:path=/run/user/1000/bus'}
PARENT_SECONDS=195
STREAMS={'stdout':1048576,'stderr':65536}
ARTIFACT_MAX=268435456
FILES_MAX=8192
FILE_MAX=8388608


def need(value,reason):
    if not value:raise RuntimeError(reason)


def same(a,b):
    if type(a) is not type(b):return False
    if type(a) is dict:return a.keys()==b.keys() and all(same(a[k],b[k]) for k in a)
    if type(a) is list:return len(a)==len(b) and all(same(x,y) for x,y in zip(a,b))
    return a==b


def loads(data):
    def pairs(items):
        result={}
        for key,value in items:
            need(key not in result,'wrapper-duplicate-json-key');result[key]=value
        return result
    return json.loads(data,object_pairs_hook=pairs,parse_constant=lambda _:(_ for _ in ()).throw(RuntimeError('wrapper-nonfinite-json')))


def raw(path,limit=1048576):
    info=path.lstat();need(stat.S_ISREG(info.st_mode) and not path.is_symlink() and info.st_size<=limit,'wrapper-reader-kind-bound')
    with path.open('rb') as stream:data=stream.read(limit+1)
    need(len(data)==info.st_size and path.stat().st_size==info.st_size,'wrapper-reader-size-drift');return data


def digest(path,limit=FILE_MAX):return hashlib.sha256(raw(path,limit)).hexdigest()


def descriptor(path):
    info=path.lstat();value=raw(path)
    return {'sha256':hashlib.sha256(value).hexdigest(),'bytes':len(value),'mode':info.st_mode&0o777,'uid':info.st_uid,'gid':info.st_gid}


def filepin(path):
    info=path.lstat();value=raw(path,134217728)
    return {'sha256':hashlib.sha256(value).hexdigest(),'bytes':len(value),'mode':info.st_mode&0o777,'uid':info.st_uid,'gid':info.st_gid}


def record(path,value,limit=1048576):
    data=(json.dumps(value,sort_keys=True,indent=2)+'\n').encode();need(len(data)<=limit,'wrapper-record-bound')
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb') as stream:stream.write(data);stream.flush();os.fsync(stream.fileno())
    fd=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:os.fsync(fd)
    finally:os.close(fd)


def pins(config,namespace=False):
    expected={**config['inputs'],**({} if namespace else config['hostTools'])}
    observed={name:filepin(Path(name)) for name in expected}
    for name,value in observed.items():
        wanted=expected[name]
        keys=['sha256','bytes','mode'] if namespace else list(wanted)
        need(same({k:value[k] for k in keys},{k:wanted[k] for k in keys}),'wrapper-input-pin:'+name)
    return observed


def load(expected,namespace=False):
    need(type(expected) is str and len(expected)==64 and all(c in '0123456789abcdef' for c in expected),'wrapper-config-sha-shape')
    need(digest(ROOT/'CONFIG.json')==expected,'wrapper-config-sha')
    config=loads(raw(ROOT/'CONFIG.json'));request=loads(raw(ROOT/'REQUEST.json'));prepared=loads(raw(ROOT/'prepared-window-pins.json'))
    grant_path=ROOT/'root-pure-window-grant.json';info=grant_path.lstat()
    need(info.st_mode&0o777==0o600 and info.st_uid==1000,'wrapper-grant-private')
    grant=loads(raw(grant_path));start=grant.get('notBefore');end=grant.get('notAfter');now=int(time.time())
    need(type(start) is int and type(end) is int and start<=now<end and 0<end-start<=300,'wrapper-grant-fresh')
    wanted={'schema':1,'status':'GRANTED_ONE_A0_PARENT_CORRELATION_PURE_WINDOW','unit':UNIT,
        'configSHA256':expected,'requestSHA256':digest(ROOT/'REQUEST.json'),'preparedPinsSHA256':digest(ROOT/'prepared-window-pins.json'),
        'outerArgv':['/usr/bin/python3','-I','-B','-S',str(HERE/'window.py'),'--outer',expected],
        'innerArgv':['/usr/bin/python3','-I','-B','-S',str(HERE/'window.py'),'--inner',expected],
        'limits':{'runtimeSeconds':180,'memoryBytes':536870912,'swapBytes':0,'cpuPercent':50,'tasksMax':64},
        'notBefore':start,'notAfter':end,'native':False,'retry':False,'subjectChecks':90,'wrapperControls':4}
    need(same(wanted,grant),'wrapper-exact-root-grant')
    need(request['configSHA256']==expected and request['preparedPinsSHA256']==wanted['preparedPinsSHA256']
        and same(request['outerArgv'],wanted['outerArgv']),'wrapper-request-join')
    need(same(prepared['inputs'],config['inputs']) and same(prepared['config'],filepin(ROOT/'CONFIG.json')),'wrapper-prepared-join')
    need(config['unit']==UNIT and config['scratch']==str(PRIVATE/'pure-controls') and config['artifactMax']==ARTIFACT_MAX,'wrapper-fixed-config')
    pins(config,namespace);return config


def environment():
    entry=loads(raw(ATTEMPT/'sandbox-entry.json'))
    return {'PATH':'/usr/bin:/bin','LANG':'C','LC_ALL':'C','TZ':'UTC','HOME':str(ATTEMPT/'home'),
        'TMPDIR':'/tmp','PYTHONDONTWRITEBYTECODE':'1','PYTHONHASHSEED':'0','INVOCATION_ID':entry['invocation']}


def sandbox(config,expected):
    inv=os.environ.get('INVOCATION_ID')
    need(type(inv) is str and len(inv)==32 and all(c in '0123456789abcdef' for c in inv) and inv!='0'*32
        and inv!='31415926535897932384626433832795','wrapper-entry-invocation')
    need(os.getpid() not in range(710000,710108),'wrapper-entry-pid-model-collision')
    record(ATTEMPT/'sandbox-entry.json',{'pid':os.getpid(),'uid':os.getuid(),'invocation':inv,'configSHA256':expected,
        'NSpid':next((x for x in Path('/proc/self/status').read_text().splitlines() if x.startswith('NSpid:')),None)})
    code=[(0x20,0,0,4),(0x15,1,0,0xc000003e),(0x06,0,0,0x80000000),
        (0x20,0,0,0),(0x35,0,1,0x40000000),(0x06,0,0,0x80000000)]
    for number in [41,42,43,44,45,46,47,49,50,51,52,53,54,55,288,299,307,425,426,427]:
        code.extend([(0x15,0,1,number),(0x06,0,0,0x00050001)])
    code.append((0x06,0,0,0x7fff0000))
    fd=os.memfd_create('a0-parent-pure-no-sockets',0)
    os.write(fd,b''.join(struct.pack('<HBBI',*row) for row in code));os.lseek(fd,0,0);os.set_inheritable(fd,True)
    argv=['/usr/bin/bwrap','--die-with-parent','--unshare-net','--unshare-pid','--cap-drop','ALL','--tmpfs','/','--dir','/usr','--tmpfs','/usr']
    for name in config['skeletonDirs']:argv+=['--dir',name]
    # Only this new host model-parent is writable at the fixed logical PRIVATE path.
    argv+=['--bind',str(MODEL),str(PRIVATE)]
    for name in config['privateDirs']:argv+=['--dir',name]
    for name,target in config['symlinks'].items():argv+=['--symlink',target,name]
    for name in config['mountInputs']+[str(ROOT/x) for x in ['CONFIG.json','REQUEST.json','prepared-window-pins.json','root-pure-window-grant.json']]:
        argv+=['--ro-bind',name,name]
    for name in config['barrierNames']:argv+=['--ro-bind',str(ATTEMPT/'barrier'),str(PRIVATE/name)]
    argv+=['--proc','/proc','--remount-ro','/proc','--ro-bind','/sys/fs/cgroup','/sys/fs/cgroup',
        '--bind',str(ATTEMPT),str(ATTEMPT),'--bind',str(ATTEMPT/'tmp'),'/tmp','--ro-bind','/dev/null','/dev/null','--remount-ro','/usr',
        '--remount-ro','/','--seccomp',str(fd),'--chdir',str(PRIVATE),
        '--dev-bind','/dev/null','/dev/null','--clearenv']
    for key,value in environment().items():argv+=['--setenv',key,value]
    argv+=['--','/usr/bin/python3','-I','-B','-S',str(HERE/'window.py'),'--inner',expected]
    record(ATTEMPT/'bwrap-intent.json',{'argv':argv,'seccompArchitecture':'AUDIT_ARCH_X86_64_ONLY','seccompSHA256':hashlib.sha256(b''.join(struct.pack('<HBBI',*row) for row in code)).hexdigest()})
    os.execve(argv[0],argv,HOST_ENV)


def resource_policy(values):
    need(values==CAPS,'wrapper-actual-resource-limits')


def artifact_policy(total,files,largest):
    need(all(type(x) is int and x>=0 for x in [total,files,largest]),'wrapper-artifact-types')
    need(total<=ARTIFACT_MAX and files<=FILES_MAX and largest<=FILE_MAX,'wrapper-artifact-bound')


def artifact_inventory(paths):
    rows=[];total=0;largest=0;entries=0;stack=[p for p in paths if p.exists()]
    while stack:
        root=stack.pop()
        with os.scandir(root) as children:
            for entry in children:
                entries+=1
                if entries>16384:return {'files':rows,'total':total,'count':len(rows),'largest':largest,'complete':False}
                path=Path(entry.path);info=entry.stat(follow_symlinks=False)
                need(not entry.is_symlink(),'wrapper-artifact-symlink')
                if stat.S_ISDIR(info.st_mode):stack.append(path);continue
                need(stat.S_ISREG(info.st_mode),'wrapper-artifact-kind')
                total+=info.st_size;largest=max(largest,info.st_size)
                rows.append({'path':str(path),'bytes':info.st_size,'sha256':digest(path) if info.st_size<=FILE_MAX else None,
                    'mode':info.st_mode&0o777,'uid':info.st_uid,'gid':info.st_gid})
                if len(rows)>FILES_MAX or total>ARTIFACT_MAX or largest>FILE_MAX:
                    return {'files':rows,'total':total,'count':len(rows),'largest':largest,'complete':False}
    return {'files':sorted(rows,key=lambda x:x['path']),'total':total,'count':len(rows),'largest':largest,'complete':True}


def observe(config):
    mountinfo=Path('/proc/self/mountinfo').read_text();mounts=[]
    for line in mountinfo.splitlines():
        left,right=line.split(' - ',1);parts=left.split();mounts.append({'path':parts[4],'options':parts[5].split(','),'filesystem':right.split()[0]})
    def cover(path):return max((r for r in mounts if path==r['path'] or path.startswith(r['path'].rstrip('/')+'/')),key=lambda r:len(r['path']))
    readonly=['/','/usr','/proc','/sys/fs/cgroup']+config['mountInputs']+[str(ROOT/x) for x in ['CONFIG.json','REQUEST.json','prepared-window-pins.json','root-pure-window-grant.json']]+[str(PRIVATE/x) for x in config['barrierNames']]
    need(all('ro' in cover(x)['options'] for x in readonly),'wrapper-named-readonly')
    need(all('ro' in r['options'] for r in mounts if r['path'].startswith('/usr/')),'wrapper-usr-submount-ro')
    need(all('rw' in cover(x)['options'] for x in [str(PRIVATE),str(ATTEMPT),'/tmp']),'wrapper-named-writable')
    probes=[]
    for name in config['writeProbes']:
        try:fd=os.open(name,os.O_WRONLY|os.O_APPEND)
        except OSError as error:
            if error.errno!=30:raise
            probes.append({'path':name,'errno':error.errno})
        else:os.close(fd);raise RuntimeError('wrapper-readonly-probe-opened')
    need(sorted(x.name for x in Path('/dev').iterdir())==['null'],'wrapper-devnull-only')
    null=Path('/dev/null').stat();need(stat.S_ISCHR(null.st_mode) and (os.major(null.st_rdev),os.minor(null.st_rdev))==(1,3),'wrapper-null-device')
    need(not any(Path('/run').iterdir()) and not any(Path('/var').iterdir()),'wrapper-empty-run-var')
    need(not any(Path(x).exists() for x in config['excludedPaths']),'wrapper-excluded-path-visible')
    need(not any((ATTEMPT/'home').iterdir()),'wrapper-empty-home');need(same(dict(os.environ),environment()),'wrapper-private-environment')
    status=dict(line.split(':',1) for line in Path('/proc/self/status').read_text().splitlines() if ':' in line)
    need(status['NoNewPrivs'].strip()=='1' and status['Seccomp'].strip()=='2','wrapper-nnp-seccomp')
    need(all(int(status[x].strip(),16)==0 for x in ['CapEff','CapPrm','CapInh','CapAmb']),'wrapper-zero-caps')
    group=next(x.split(':',2)[2] for x in Path('/proc/self/cgroup').read_text().splitlines() if x.startswith('0::'))
    need(group.startswith('/') and '..' not in group.split('/') and group.endswith('/'+UNIT+'.service'),'wrapper-unit-cgroup')
    cg=Path('/sys/fs/cgroup')/group.lstrip('/');resources={x:(cg/x).read_text().strip() for x in CAPS};resource_policy(resources)
    namespaces={x:os.readlink('/proc/self/ns/'+x) for x in ['net','pid','mnt']};host=loads(raw(ATTEMPT/'intent.json'))['namespaces']
    need(all(namespaces[x]!=host[x] for x in namespaces),'wrapper-fresh-namespaces')
    need(0<os.getpid()<=8 and os.getpid() not in range(710000,710108),'wrapper-inner-pid')
    entry=loads(raw(ATTEMPT/'sandbox-entry.json'));need(entry['invocation']==os.environ['INVOCATION_ID'],'wrapper-entry-invocation-join')
    return {'mountinfo':mountinfo,'mounts':mounts,'resources':resources,'probes':probes,'namespaces':namespaces,'status':status,
        'pid':os.getpid(),'pidMeaning':'ACTUAL_INNER_PID_IN_PRIVATE_NAMESPACE_NOT_INVENTED_HOST_PID','uid':os.getuid(),
        'entry':entry,'uidMap':Path('/proc/self/uid_map').read_text(),'gidMap':Path('/proc/self/gid_map').read_text(),
        'namespaceOwnerEqualityClaimed':False,'hostwideConfinementClaimed':False,
        'resourceSamples':{x:(cg/x).read_text() if (cg/x).is_file() else None for x in ['memory.peak','memory.events','pids.current','pids.peak','pids.events']}}


class RootFinalizationError(RuntimeError):
    """Failed root receipt finalization, never an accepted subject result."""
    def __init__(self, terminal):
        super().__init__('root-finalization-failed-stop-no-retry')
        self.terminal = terminal


def error_detail(error):
    return {'class': type(error).__name__,
            'fullClass': type(error).__module__ + '.' + type(error).__qualname__,
            'message': str(error),
            'traceback': ''.join(traceback.format_exception(type(error), error, error.__traceback__))}


def attempt_finalization(issues, operation, action):
    try:
        return action()
    except BaseException as error:
        issues.append(dict(operation=operation, **error_detail(error)))
        return None


def propagate(primary, primary_traceback, terminal):
    issues = terminal['cleanupIssues']
    if primary is not None:
        if issues:
            secondary = RootFinalizationError(terminal)
            secondary.original_primary_cause = primary.__cause__
            secondary.original_primary_context = primary.__context__
            raise BaseException.with_traceback(primary, primary_traceback) from secondary
        raise BaseException.with_traceback(primary, primary_traceback)
    if issues:
        raise RootFinalizationError(terminal)


def module(path,name):
    spec=importlib.util.spec_from_file_location(name,path);result=importlib.util.module_from_spec(spec);spec.loader.exec_module(result);return result


def inner(config):
    record(ATTEMPT/'inner-entry.json',{'pid':os.getpid(),'uid':os.getuid(),'invocation':os.environ['INVOCATION_ID'],'phase':'BEFORE_PREPARE_OR_CONTROL_IMPORT'})
    primary=None;trace=None;issues=[];steps=[]
    try:
        record(ATTEMPT/'before.json',observe(config),FILE_MAX)
        record(ATTEMPT/'namespace-inputs.json',pins(config,True))
        need(not (PRIVATE/'pure-controls').exists(),'wrapper-fixed-scratch-not-absent')
        record(ATTEMPT/'wrapper-control-entry.json',{'pid':os.getpid(),'steps':['prepare','frozen90','final_checks'],'subjectChecks':90,'wrapperControls':4})
        prepare=module(HERE/'prepare.py','a0_pure_prepare');prepare.run(config,sys.modules[__name__]);steps.append('prepare')
        record(ATTEMPT/'control-entry-load-intent.json',{'path':str(PACKET/'control_entry.py'),'sha256':digest(PACKET/'control_entry.py'),'pid':os.getpid()})
        entry=module(PACKET/'control_entry.py','a0_held_control_entry');entry.run(PRIVATE/'pure-controls');steps.append('frozen90')
        final=module(HERE/'final_checks.py','a0_pure_final');final.run(config,sys.modules[__name__]);steps.append('final_checks')
    except BaseException as error:primary=error;trace=error.__traceback__
    finally:
        attempt_finalization(issues,'after-observation',lambda:record(ATTEMPT/'after.json',observe(config),FILE_MAX))
        attempt_finalization(issues,'final-namespace-inputs',lambda:record(ATTEMPT/'final-inputs.json',pins(config,True)))
        def audit():
            value=artifact_inventory([PRIVATE/'pure-controls',ATTEMPT]);record(ATTEMPT/'artifact-inventory.json',value,FILE_MAX)
            need(value['complete'],'wrapper-artifact-inventory-partial');artifact_policy(value['total'],value['count'],value['largest'])
        attempt_finalization(issues,'artifact-final-audit',audit)
    terminal={'failure':error_detail(primary) if primary is not None else None,'cleanupIssues':issues,'stepsCompleted':steps,'retry':False}
    attempt_finalization(issues,'inner-terminal-record',lambda:record(ATTEMPT/'inner-terminal.json',terminal,FILE_MAX))
    propagate(primary,trace,terminal)


def identity_join(expected):
    returned=loads(raw(ATTEMPT/'returned.json'));entry=loads(raw(ATTEMPT/'sandbox-entry.json'))
    inner=loads(raw(ATTEMPT/'inner-entry.json'));before=loads(raw(ATTEMPT/'before.json',FILE_MAX))
    values=[os.getpid(),returned['pid'],entry['pid'],inner['pid']]
    need(all(type(x) is int and x>0 and x not in range(710000,710108) for x in values),'wrapper-actual-pid-shape')
    need(len(set(values))==4,'wrapper-actual-pids-distinct')
    need(entry['configSHA256']==expected and entry['invocation']==inner['invocation']
        and same(entry,before['entry']) and inner['pid']==before['pid'],'wrapper-entry-inner-custody')
    need(same(before['resources'],CAPS),'wrapper-final-resource-custody')
    return {'outerPID':values[0],'managerClientPID':values[1],'entryHostPID':values[2],'innerNamespacePID':values[3],
        'innerHostPID':'UNASSESSED_NOT_FABRICATED','invocation':entry['invocation'],'resources':before['resources'],
        'sources':{name:digest(ATTEMPT/name) for name in ['returned.json','sandbox-entry.json','inner-entry.json']},
        'native':False,'postshowUsed':False}


def outer(config,expected):
    with os.fdopen(os.open(LOCK,os.O_RDWR|os.O_NOFOLLOW),'a') as lock:
        info=os.fstat(lock.fileno());need(same({'device':info.st_dev,'inode':info.st_ino,'mode':info.st_mode&0o777,'uid':info.st_uid,'gid':info.st_gid},
            {'device':66308,'inode':133604183,'mode':0o664,'uid':1000,'gid':1000}),'wrapper-compiler-file-identity')
        need(stat.S_ISREG(info.st_mode),'wrapper-lock-file');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        pins(config);need(not ATTEMPT.exists() and not MODEL.exists() and not (PRIVATE/'pure-controls').exists(),'wrapper-no-retry')
        ATTEMPT.mkdir(mode=0o700);MODEL.mkdir(mode=0o700)
        for name in ['home','tmp','barrier']:(ATTEMPT/name).mkdir(mode=0o700)
        record(ATTEMPT/'barrier/sentinel',{'scope':'READONLY_BARRIER_NOT_AUTHORITY'})
        argv=['/usr/bin/systemd-run','--user','--wait','--pipe','--collect','--unit='+UNIT,'-p','RuntimeMaxSec=180',
            '-p','MemoryMax=512M','-p','MemorySwapMax=0','-p','CPUQuota=50%','-p','TasksMax=64','-p','UMask=0077','-p','TimeoutStopSec=1',
            '/usr/bin/python3','-I','-B','-S',str(HERE/'window.py'),'--sandbox',expected]
        primary=None;trace=None;issues=[];process=None;selected=None;streams={};sizes={x:0 for x in STREAMS};retained=dict(sizes);start=time.monotonic()
        try:
            record(ATTEMPT/'intent.json',{'argv':argv,'environment':HOST_ENV,'configSHA256':expected,'requestSHA256':digest(ROOT/'REQUEST.json'),
                'grantSHA256':digest(ROOT/'root-pure-window-grant.json'),'pid':os.getpid(),'retry':False,
                'namespaces':{x:os.readlink('/proc/self/ns/'+x) for x in ['net','pid','mnt']}})
            for name in STREAMS:streams[name]=(ATTEMPT/(name+'.bin')).open('xb',buffering=0)
            selected=selectors.DefaultSelector()
            process=subprocess.Popen(argv,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=HOST_ENV,start_new_session=True,close_fds=True)
            need(type(process.pid) is int and process.pid>0 and process.pid not in range(710000,710108),'wrapper-manager-client-pid')
            record(ATTEMPT/'returned.json',{'pid':process.pid,'meaning':'ACTUAL_MANAGER_CLIENT_RETURNED_ONLY'})
            for name,pipe in [('stdout',process.stdout),('stderr',process.stderr)]:
                os.set_blocking(pipe.fileno(),False);selected.register(pipe,selectors.EVENT_READ,name)
            while selected.get_map():
                need(time.monotonic()-start<PARENT_SECONDS,'wrapper-parent-deadline')
                for key,_ in selected.select(.05):
                    room=STREAMS[key.data]-retained[key.data];data=os.read(key.fd,min(65536,room+1))
                    if not data:selected.unregister(key.fileobj);continue
                    sizes[key.data]+=len(data);pending=memoryview(data[:room])
                    while pending:
                        need(time.monotonic()-start<PARENT_SECONDS,'wrapper-parent-write-deadline')
                        written=streams[key.data].write(pending)
                        need(type(written) is int and 0<written<=len(pending),'wrapper-short-stream-write')
                        retained[key.data]+=written;pending=pending[written:]
                    if len(data)>room:
                        record(ATTEMPT/(key.data+'-overflow-sentinel.json'),{'byteHex':data[room:].hex(),'unobservedRemainder':'UNASSESSED'})
                        raise RuntimeError('wrapper-parent-stream-cap')
            process.wait(timeout=max(.1,PARENT_SECONDS-(time.monotonic()-start)))
            if process.returncode==0:record(ATTEMPT/'identity-join.json',identity_join(expected))
        except BaseException as error:primary=error;trace=error.__traceback__
        finally:
            if primary is not None and process is not None:
                def kill_client():
                    if process.poll() is None:
                        try:os.killpg(process.pid,signal.SIGKILL)
                        except ProcessLookupError:pass
                attempt_finalization(issues,'owned-manager-client-kill',kill_client)
                attempt_finalization(issues,'owned-manager-client-wait',lambda:process.wait(timeout=2))
            if selected is not None:attempt_finalization(issues,'selector-close',selected.close)
            for name,stream in streams.items():
                attempt_finalization(issues,name+'-fsync',lambda stream=stream:os.fsync(stream.fileno()))
                attempt_finalization(issues,name+'-close',stream.close)
            if process is not None:
                for name,pipe in [('stdout',process.stdout),('stderr',process.stderr)]:
                    if pipe is not None:attempt_finalization(issues,name+'-pipe-close',pipe.close)
            stream_files={}
            for name in STREAMS:
                stream_files[name]=attempt_finalization(issues,name+'-actual-stream-pin',lambda name=name:filepin(ATTEMPT/(name+'.bin')))
                if stream_files[name] is not None:
                    attempt_finalization(issues,name+'-retained-length-check',lambda name=name:need(stream_files[name]['bytes']==retained[name],
                        'wrapper-retained-length-disagreement'))
            attempt_finalization(issues,'host-final-inputs',lambda:record(ATTEMPT/'host-final-inputs.json',pins(config)))
            def host_artifacts():
                value=artifact_inventory([MODEL,ATTEMPT]);record(ATTEMPT/'host-artifact-inventory.json',value,FILE_MAX)
                need(value['complete'],'wrapper-host-artifact-partial');artifact_policy(value['total'],value['count'],value['largest'])
            attempt_finalization(issues,'host-artifact-audit',host_artifacts)
            terminal={'returncode':process.returncode if process is not None else None,'failure':error_detail(primary) if primary is not None else None,
                'cleanupIssues':issues,'seconds':time.monotonic()-start,'observedBytes':sizes,'retainedBytes':retained,
                'streamFiles':stream_files,'serviceCancellationOrBackendDeathClaimed':False,'retry':False,'lockHeldThroughWaitAndCustody':True}
            attempt_finalization(issues,'host-terminal-record',lambda:record(ATTEMPT/'terminal.json',terminal,FILE_MAX))
        propagate(primary,trace,terminal)
        need(process is not None and process.returncode==0,'wrapper-pure-failed-stop-no-retry')


if __name__=='__main__':
    os.umask(0o077);need(len(sys.argv)==3 and sys.argv[1] in ['--outer','--sandbox','--inner'],'wrapper-fixed-entry')
    mode,expected=sys.argv[1:];config=load(expected,mode=='--inner')
    if mode=='--outer':outer(config,expected)
    elif mode=='--sandbox':sandbox(config,expected)
    else:inner(config)
