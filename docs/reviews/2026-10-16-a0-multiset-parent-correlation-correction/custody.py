"""Held independent parent custody checks. No subject imports or native commands."""
import hashlib
import json
import math
import os
from pathlib import Path
import re
import time

HERE=Path(__file__).resolve().parent
ROOT=Path('/home/nathaniel/.local/state/openplan/a0-multiset-parent-correlation-correction-20261016')
SUBJECT=ROOT.with_name('a0-catalogue-dependency-multiset-correction-20261016')
UNIT='openplan-a0-catalogue-dependency-multiset-20261016'
SOURCE='f8a571bb0a18b8b6501870acb5ef1e760d487e1c'
APP='d577a9cd955018b3253f42b3d9af2a96a9a10b53'
CONNECTOR='228ce912b1cf63dba408445422dc6e2b690d91f4'
TARGET='openplan_a0_limit_c730358675ac8bb47ac15fdd'
SYSTEM='7683856985084612646'
SCOPE='450162489323f8e76e68614e7411001098892984e38d265ae6f2ed2e03bc7371'
CONTRACT_SHA='91292e69956500428851f467a2966ee6c65b88a7d2385c41648f73d17fa57bd1'
SOURCE_REPORT_SHA='07c48ac38c866357cc24d2448ada87eaea489a8411906bd6af66ff4630c86a57'
COLLECTOR_OLD_SHA='05bc862604ebc65bf52ae5f58565cf30f765080d8df5bc14b142ba481d8066cc'
ENTRY='exec /usr/bin/env -i PATH=/usr/bin:/bin HOME=/nonexistent LANG=C.UTF-8 PYTHONDONTWRITEBYTECODE=1 INVOCATION_ID="$INVOCATION_ID" /usr/bin/python3 -B '+str(SUBJECT/'runtime/catalogue.py')+' --capture-once'
MANAGER_ARGV=['/usr/bin/systemd-run','--user','--wait','--pipe','--collect','--unit='+UNIT,
    '-p','RuntimeMaxSec=180','-p','MemoryMax=512M','-p','MemorySwapMax=0','-p','CPUQuota=50%',
    '-p','TasksMax=64','-p','UMask=0077','/bin/sh','-c',ENTRY]
AUTHORITY_MAX=1048576
CAPTURE_MAX=8388608
INPUT_MAX=2097152
START=None
MANAGER_FIELDS=('Id','InvocationID','MainPID','ControlGroup','ActiveState','SubState','RuntimeMaxUSec',
    'MemoryMax','MemorySwapMax','CPUQuotaPerSecUSec','TasksMax')
COMPLETE_CLAIM='READ ONLY current catalogue observations only. Root must accept structural/source/permission findings separately.'
COMMON={'map','inventory','history','exact','functions','scope'}


def need(value,reason):
    if not value:raise ValueError(reason)


def equal(a,b):
    if type(a) is not type(b):return False
    if type(a) is dict:return a.keys()==b.keys() and all(equal(a[k],b[k]) for k in a)
    if type(a) is list:return len(a)==len(b) and all(equal(x,y) for x,y in zip(a,b))
    return a==b


def same(a,b,reason):need(equal(a,b),reason)


def fields(row,names,reason):need(type(row) is dict and set(row)==set(names),reason)


def positive(value,reason):need(type(value) is int and value>0,reason)


def oid(value,reason):need(type(value) is int and 0<value<=4294967295,reason)


def finite(value,bound,reason):
    need(type(value) in (int,float) and math.isfinite(value) and 0<=value<bound,reason)


def tick():
    if START is not None:need(time.monotonic()-START<205,'parent-custody-deadline')


def private(path,directory=False):
    s=path.lstat()
    need(not path.is_symlink() and s.st_uid==os.getuid() and s.st_mode&0o777==(0o700 if directory else 0o600)
        and (path.is_dir() if directory else path.is_file()),'parent-private-path')


def raw(path,limit,empty=False,owned=True):
    tick()
    if owned:private(path)
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    with os.fdopen(fd,'rb') as stream:
        size=os.fstat(stream.fileno()).st_size
        need((0 if empty else 1)<=size<=limit,'parent-reader-bound')
        value=stream.read(limit+1)
        need(len(value)==size and os.fstat(stream.fileno()).st_size==size,'parent-reader-size-drift')
    return value


def digest(value):return hashlib.sha256(value).hexdigest()


def sha(path,limit=AUTHORITY_MAX,owned=True):return digest(raw(path,limit,empty=True,owned=owned))


def loads(value):
    def pairs(items):
        result={}
        for key,item in items:
            need(key not in result,'parent-duplicate-json-key');result[key]=item
        return result
    def floating(text):
        result=float(text);need(math.isfinite(result),'parent-nonfinite-json');return result
    return json.loads(value,object_pairs_hook=pairs,parse_float=floating,
        parse_constant=lambda _:(_ for _ in ()).throw(ValueError('parent-nonfinite-json')))


def read(path,limit=AUTHORITY_MAX):return loads(raw(path,limit))


def canonical(value):return (json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=True)+'\n').encode()


def descriptor(path,limit=CAPTURE_MAX,owned=False):
    value=raw(path,limit,empty=True,owned=owned);s=path.lstat()
    need(path.is_file() and not path.is_symlink(),'parent-pin-kind')
    return {'sha256':digest(value),'bytes':len(value),'mode':s.st_mode&0o777,'uid':s.st_uid,'gid':s.st_gid}


def contract():
    value=raw(HERE/'fixed-contract.json',AUTHORITY_MAX,owned=False)
    same(CONTRACT_SHA,digest(value),'parent-fixed-contract-pin')
    return loads(value)


def required_source_files():
    fixed=contract();paths={str(HERE/name) for name in ['outer.py','custody.py','collector.py','fixed-contract.json']}
    paths|={str(SUBJECT/'runtime'/name) for name in fixed['runtime']}
    paths|=set(fixed['bindings'])|set(fixed['acceptedPureManifest'])
    paths|={row['path'] for row in fixed['retainedAuthority'].values()}
    for item in fixed['requests']:
        paths.add(item['inputSource'])
        if 'dependentSource' in item:paths.add(item['dependentSource'])
    repo=HERE.parents[2]
    paths|={str(repo/'docs/reviews/2026-10-16-a0-trigger-catalogue-operation-proposal/outer.py'),
        str(ROOT.with_name('budget-catalog-outer-transport-20261016')/'collector.py'),
        str(ROOT.with_name('a0-dependency-multiset-root-decision-20261016')/'ACCEPTANCE.json')}
    for name in ['PARENT_CORRELATION_DESIGN.md','PARENT_CORRELATION_DISPOSITION.md']:
        paths.add(str(repo/'docs/reviews/2026-10-16-a0-catalogue-dependency-multiset-correction'/name))
    review=Path('/home/nathaniel/.t3/worktrees/openplan/t3-40bfca48/docs/reviews/2026-10-16-a0-dependency-multiset-independent')
    paths|={str(review/name) for name in ['REPORT.md','VALIDATION.md']}
    return paths


def manager_env(uid):
    positive(uid,'parent-manager-uid')
    return {'PATH':'/usr/bin:/bin','HOME':'/home/nathaniel','LANG':'C.UTF-8',
        'XDG_RUNTIME_DIR':'/run/user/'+str(uid),'DBUS_SESSION_BUS_ADDRESS':'unix:path=/run/user/'+str(uid)+'/bus'}


def invocation(value):
    need(type(value) is str and re.fullmatch('[a-f0-9]{32}',value) is not None and value!='0'*32,'parent-ack-invocation')


def wait_grammar(value):
    need(type(value) is bytes and 0<len(value)<=65536,'parent-wait-bound')
    try:text=value.decode('ascii')
    except UnicodeError:raise ValueError('parent-wait-ascii') from None
    need(text.endswith('\n'),'parent-wait-final-lf')
    markers={'runningasunit':[],'finishedwithresult':[],'mainprocessesterminatedwith':[]};resources=[]
    for line in text[:-1].split('\n'):
        normalized=re.sub('[^a-z]','',line.lower())
        found=[key for key in markers if key in normalized]
        need(len(found)<=1,'parent-wait-mixed-marker')
        if found:markers[found[0]].append(line)
        else:
            need(re.fullmatch(r' +(Service runtime|CPU time consumed|Memory peak): [\x20-\x7e]+',line) is not None,'parent-wait-unreviewed-line')
            resources.append(line)
    need(len(markers['runningasunit'])==1,'parent-wait-header-count')
    match=re.fullmatch(r'Running as unit: '+re.escape(UNIT)+r'\.service(?:; invocation ID: ([a-f0-9]{32}))?',markers['runningasunit'][0])
    need(match is not None,'parent-wait-header')
    suffix=match[1]
    need(suffix is None or suffix!='0'*32,'parent-wait-zero-suffix')
    same(['          Finished with result: success'],markers['finishedwithresult'],'parent-wait-result')
    same(['Main processes terminated with: code=exited, status=0/SUCCESS'],markers['mainprocessesterminatedwith'],'parent-wait-main')
    return {'waitInvocationSuffixPresent':suffix is not None,'waitReportedInvocation':suffix,
        'managerResourceLines':'UNBOUND_REPORTING_ONLY','managerResourceLineCount':len(resources)}


def duration_us(value):
    scales={'us':1,'ms':1000,'s':1000000,'min':60000000,'h':3600000000};total=0;seen=set()
    for token in value.split(' '):
        m=re.fullmatch(r'([0-9]+)(?:\.([0-9]{1,6}))?(us|ms|s|min|h)',token)
        need(m is not None and m[3] not in seen,'parent-manager-duration');seen.add(m[3])
        fraction=m[2] or '';n=int(m[1])*10**len(fraction)+(int(fraction) if fraction else 0)
        need(n*scales[m[3]]%10**len(fraction)==0,'parent-manager-duration-precision')
        total+=n*scales[m[3]]//10**len(fraction)
    return total


def properties(value):
    need(0<len(value)<=16384,'parent-manager-raw-bound')
    try:text=value.decode('ascii')
    except UnicodeError:raise ValueError('parent-manager-ascii') from None
    need(text.endswith('\n'),'parent-manager-final-lf');result={}
    for line in text[:-1].split('\n'):
        need('=' in line,'parent-manager-property-line');key,item=line.split('=',1)
        need(key in MANAGER_FIELDS and key not in result,'parent-manager-property-set');result[key]=item
    same(set(MANAGER_FIELDS),set(result),'parent-manager-property-set')
    for key in ['MainPID','MemoryMax','MemorySwapMax','TasksMax']:
        need(re.fullmatch('0|[1-9][0-9]*',result[key]) is not None,'parent-manager-integer');result[key]=int(result[key])
    for key in ['RuntimeMaxUSec','CPUQuotaPerSecUSec']:result[key]=duration_us(result[key])
    return result


def ack_entry(attempt,uid):
    ack=read(attempt/'manager-ack.json')
    fields(ack,{'unitName','entry','runtimeSeconds','properties','request','custody'},'parent-ack-fields')
    same(UNIT,ack['unitName'],'parent-ack-unit');same(180,ack['runtimeSeconds'],'parent-ack-runtime');same('request-001',ack['request'],'parent-ack-request')
    entry=ack['entry'];fields(entry,{'pid','uid','uids','invocation','controlGroup','resources'},'parent-entry-fields')
    positive(entry['pid'],'parent-entry-pid');same(uid,entry['uid'],'parent-entry-uid');same([uid]*4,entry['uids'],'parent-entry-uids')
    invocation(entry['invocation'])
    group=entry['controlGroup']
    need(type(group) is str and group.startswith('/') and group.endswith('/'+UNIT+'.service')
        and all(x not in ('','.','..') for x in group[1:].split('/')),'parent-entry-cgroup')
    same({'memoryMax':536870912,'swapMax':0,'cpuMax':'50000 100000','tasksMax':64},entry['resources'],'parent-entry-resources')
    parsed=properties(raw(attempt/'request-001/stdout.bin',16384))
    expected={'Id':UNIT+'.service','InvocationID':entry['invocation'],'MainPID':entry['pid'],'ControlGroup':group,
        'ActiveState':'active','SubState':'running','RuntimeMaxUSec':180000000,'MemoryMax':536870912,
        'MemorySwapMax':0,'CPUQuotaPerSecUSec':500000,'TasksMax':64}
    same(expected,parsed,'parent-raw-manager-binding');same(parsed,ack['properties'],'parent-ack-properties')
    names=['intent.json','input.bin','returned-process.json','stdout.bin','stderr.bin','terminal.json']
    same({name:sha(attempt/'request-001'/name) for name in names},ack['custody'],'parent-ack-custody')
    return entry


def request_custody(attempt,spec,entry,wrapper,parent):
    folder=attempt/('request-'+str(spec['request']).zfill(3));private(folder,True)
    intent=read(folder/'intent.json');expected={'argv':spec['argv'],
        'environment':manager_env(entry['uid']) if spec['request']==1 else {'PATH':'/usr/bin:/bin','HOME':'/nonexistent','LANG':'C.UTF-8'},
        'purpose':spec['purpose'],'timeout':spec['timeout'],'streamByteLimit':spec['streamByteLimit'],
        'inputSHA256':spec['inputPin']['sha256'],'inputFile':None,'uid':entry['uid'],'controllerPID':entry['pid'],'retry':'FORBIDDEN'}
    same(expected,intent,'parent-request-intent')
    source=Path(spec['inputSource']);same(spec['inputPin'],descriptor(source,INPUT_MAX,True),'parent-source-input-pin')
    data=raw(folder/'input.bin',INPUT_MAX,empty=True);same(raw(source,INPUT_MAX,empty=True),data,'parent-request-input')
    returned=read(folder/'returned-process.json');fields(returned,{'pid','ack'},'parent-request-returned-fields')
    positive(returned['pid'],'parent-request-helper-pid');same('process-returned-only',returned['ack'],'parent-request-helper-ack')
    need(returned['pid'] not in [entry['pid'],wrapper,parent],'parent-request-helper-distinct')
    terminal=read(folder/'terminal.json')
    fields(terminal,{'returncode','errorType','elapsedSeconds','timeoutSeconds','classification','backend','commitACK',
        'observedStdoutBytes','observedStderrBytes','stdoutBytes','stderrBytes','stdoutSHA256','stderrSHA256'},'parent-request-terminal-fields')
    same(0,terminal['returncode'],'parent-request-exit');same(None,terminal['errorType'],'parent-request-error')
    same('terminal',terminal['classification'],'parent-request-classification')
    same('unassessed',terminal['backend'],'parent-request-backend');same('unassessed',terminal['commitACK'],'parent-request-commit')
    same(spec['timeout'],terminal['timeoutSeconds'],'parent-request-timeout');finite(terminal['elapsedSeconds'],spec['timeout'],'parent-request-elapsed')
    outputs={}
    for label,limit in [('stdout',spec['streamByteLimit']),('stderr',min(spec['streamByteLimit'],65536))]:
        value=raw(folder/(label+'.bin'),limit,empty=True);outputs[label]=value
        same(len(value),terminal[label+'Bytes'],'parent-request-stream-length')
        same(len(value),terminal['observed'+label.title()+'Bytes'],'parent-request-observed-length')
        same(digest(value),terminal[label+'SHA256'],'parent-request-stream-hash')
    same(b'',outputs['stderr'],'parent-request-stderr')
    return folder,outputs['stdout'],returned['pid']


def phase(folder,value,spec):
    need(value.endswith(b'\n') and len(value.split(b'\n'))==3,'parent-phase-two-rows')
    ready_raw,body,_=value.split(b'\n');ready_raw+=b'\n'
    same(ready_raw,raw(folder/'ready.stdout',32768),'parent-phase-ready-raw')
    ready=loads(ready_raw);same(ready,read(folder/'ready.json'),'parent-phase-ready-record')
    expected={'database':TARGET,'oid':6227945,'systemIdentifier':SYSTEM,'sessionRole':'supabase_admin','currentRole':'supabase_admin',
        'adminSuperuser':True,'postgresSuperuser':False,'scs':'on','clientEncoding':'UTF8','serverEncoding':'UTF8','readOnly':'on','namespaceReady':True}
    fields(ready,set(expected)|{'pid','sessionOid','currentOid','postgresOid','version'},'parent-phase-identity-fields')
    for key,item in expected.items():same(item,ready[key],'parent-phase-identity-'+key)
    for key in ['pid','sessionOid','currentOid','postgresOid']:positive(ready[key],'parent-phase-positive-'+key)
    same(ready['sessionOid'],ready['currentOid'],'parent-phase-admin-oid')
    need(type(ready['version']) is str and re.fullmatch('17[0-9]{4}',ready['version']) is not None,'parent-phase-version')
    dep=raw(folder/'dependent.sql',INPUT_MAX);source=Path(spec['dependentSource'])
    same(spec['dependentPin'],descriptor(source,INPUT_MAX,True),'parent-source-dependent-pin')
    same(raw(source,INPUT_MAX),dep,'parent-phase-dependent-input')
    same({'sha256':digest(dep),'backendPID':ready['pid'],'retry':'FORBIDDEN','effect':'READ ONLY catalogue; no fixture'},read(folder/'dependent-intent.json'),'parent-phase-dependent-intent')
    return ready,loads(body)


def retained_oracles(fixed):
    values={}
    for name,item in fixed['retainedAuthority'].items():
        path=Path(item['path']);same(item['pin'],descriptor(path,CAPTURE_MAX,True),'parent-retained-pin')
        values[name]=read(path,CAPTURE_MAX)
    derived=values['map'];same(values['rawMap'],derived['snapshot'],'parent-retained-map-provenance')
    same(fixed['retainedAuthority']['rawMap']['pin']['sha256'],derived['sourceStdoutSHA256'],'parent-retained-raw-map-hash')
    same(str(Path(fixed['retainedAuthority']['rawMap']['path']).parent),derived['sourceRequest'],'parent-retained-raw-map-path')
    same(values['definitions'],values['rawDefinitions'],'parent-retained-definition-provenance')
    same('accepted-narrow-native18',values['rootAudit']['status'],'parent-retained-root-acceptance')
    return {'map':derived['snapshot'],'history':values['history'],'exact':values['exact'],'functions':values['definitions'],'scope':SCOPE}


def inventory(rows,reference):
    need(type(rows) is list and len(rows)==382,'parent-inventory-count');labels=[];oids=[]
    for row in rows:
        fields(row,{'oid','schema','name','kind'},'parent-inventory-fields');oid(row['oid'],'parent-inventory-oid')
        need(all(type(row[k]) is str and row[k] and '.' not in row[k] and '\x00' not in row[k] for k in ['schema','name']),'parent-inventory-name')
        label=row['schema']+'.'+row['name'];need(label in reference and label!='__pg_sequences__','parent-inventory-label')
        sequence=set(reference[label])=={'last_value','log_cnt','is_called'}
        need(row['kind']=='S' if sequence else row['kind'] in ['r','p'],'parent-inventory-kind')
        labels.append(label);oids.append(row['oid'])
    need(len(set(oids))==382 and len(set(labels))==382 and set(labels)==set(reference)-{'__pg_sequences__'},'parent-inventory-unique')


def completion(attempt,values):
    catalogue=values[1]['catalogue'];fields(catalogue,contract()['expectedCatalogueSections'],'parent-catalogue-section-fields')
    section=catalogue['functions'];fields(section,{'count','limit','rows'},'parent-function-section-fields')
    same(contract()['functionsLimit'],section['limit'],'parent-function-limit')
    need(type(section['count']) is int and 0<=section['count']<=section['limit'] and type(section['rows']) is list and len(section['rows'])==section['count'],'parent-function-cardinality')
    unknown=[];seen=[]
    names='oid pronamespace proname proowner prolang prokind prosecdef provolatile proisstrict proleakproof proparallel prorettype proretset proacl expanded_acl identity fingerprints reviewed definition_data'.split()
    for row in section['rows']:
        fields(row,names,'parent-function-row-fields');oid(row['oid'],'parent-function-oid')
        need(type(row['reviewed']) is bool,'parent-function-reviewed');seen.append(row['oid'])
        if not row['reviewed']:
            same(None,row['definition_data'],'parent-unknown-definition-no-wire');unknown.append(row['oid'])
    need(len(seen)==len(set(seen)),'parent-function-unique')
    value=read(attempt/'complete.json')
    expected={'stage':'catalogue','status':'capture-complete','source':SOURCE,'app':APP,'sourceClosureComplete':False,'fixtureLaunchable':False,
        'priorPhysicalKindOrOIDEquivalence':'UNPROVED','unresolvedFunctionOIDs':unknown,'claim':COMPLETE_CLAIM}
    same(expected,value,'parent-complete-exact')
    need(type(value['unresolvedFunctionOIDs']) is list and len(value['unresolvedFunctionOIDs'])==len(set(value['unresolvedFunctionOIDs'])),'parent-complete-unresolved-unique')
    for item in value['unresolvedFunctionOIDs']:oid(item,'parent-complete-unresolved-oid')
    return value


def correlate(folder,facts,collector_result):
    same(ROOT/'catalogue-parent-attempt',folder,'parent-attempt-path');private(folder,True);private(SUBJECT,True)
    attempt=SUBJECT/'catalogue-attempt';private(attempt,True)
    fields(collector_result,{'terminal','terminalRecorded','terminalRecordError'},'parent-collection-return-fields')
    need(collector_result['terminalRecorded'] is True and collector_result['terminalRecordError'] is None,'parent-terminal-recorded')
    same(collector_result,read(folder/'collection-return.json'),'parent-collection-return-custody')
    terminal=read(folder/'terminal.json');same(collector_result['terminal'],terminal,'parent-terminal-return-custody')
    fields(terminal,{'parentPID','wrapperPID','returncode','failure','classification','elapsedSeconds','deadlineSeconds','backendDeath','streams','cleanupErrors','evidenceErrors'},'parent-terminal-fields')
    same({'returncode':0,'failure':None,'cleanupErrors':[],'evidenceErrors':[],'classification':'terminal-zero'},
        {k:terminal[k] for k in ['returncode','failure','cleanupErrors','evidenceErrors','classification']},'parent-manager-clean-terminal')
    same(205,terminal['deadlineSeconds'],'parent-manager-deadline')
    same('UNASSESSED',terminal['backendDeath'],'parent-manager-backend');finite(terminal['elapsedSeconds'],205,'parent-manager-elapsed')
    same(os.getpid(),terminal['parentPID'],'parent-collector-pid');positive(terminal['wrapperPID'],'parent-manager-client-pid')
    same({'parentPID':terminal['parentPID'],'wrapperPID':terminal['wrapperPID'],'ack':'process-returned-only'},read(folder/'returned-process.json'),'parent-manager-returned')
    intent=read(folder/'intent.json');same(dict(facts,parentPID=os.getpid(),environment=manager_env(facts['uid']),rootIntentSHA256=sha(ROOT/'root-operation-intent.json'),retry='FORBIDDEN'),intent,'parent-outer-intent')
    fields(terminal['streams'],{'stdout','stderr'},'parent-manager-stream-fields')
    for label,limit in [('stdout',1048576),('stderr',65536)]:
        data=raw(folder/(label+'.bin'),limit,empty=True)
        same({'observedBytes':len(data),'retainedBytes':len(data),'sha256':digest(data),'limit':limit},terminal['streams'][label],'parent-manager-stream-custody')
    wait=wait_grammar(raw(folder/'stderr.bin',65536));fixed=contract();entry=ack_entry(attempt,facts['uid'])
    need(entry['pid'] not in [terminal['parentPID'],terminal['wrapperPID']],'parent-controller-distinct')
    if wait['waitInvocationSuffixPresent']:same(entry['invocation'],wait['waitReportedInvocation'],'parent-wait-ack-invocation')
    same({'stage':'catalogue','admissionSHA256':facts['admissionSHA256'],'retry':'FORBIDDEN'},read(attempt/'intent.json'),'parent-stage-intent')
    names=sorted(x.name for x in attempt.iterdir() if x.name.startswith('request-'))
    same(['request-'+str(i).zfill(3) for i in range(1,8)],names,'parent-seven-request-sequence')
    aggregate=0;values=[];identities=[];request_hashes={};oracles=retained_oracles(fixed)
    for spec in fixed['requests']:
        path,value,pid=request_custody(attempt,spec,entry,terminal['wrapperPID'],terminal['parentPID']);aggregate+=len(value)
        if spec['request']==3:same(b'',value,'parent-credential-absence-empty')
        if spec['request'] in [4,5,6]:
            identity,body=phase(path,value,spec);identities.append(identity)
            fields(body,COMMON|({'catalogue','absence'} if spec['request']==5 else set()),'parent-output-envelope-fields')
            for key,expected in oracles.items():same(expected,body[key],'parent-retained-output-'+key)
            same(383,len(body['map']),'parent-retained-map-count');inventory(body['inventory'],oracles['map'])
            name={4:'before.json',5:'catalogue.json',6:'verification.json'}[spec['request']]
            need(equal(body,read(attempt/name,CAPTURE_MAX)) and canonical(body)==raw(attempt/name,CAPTURE_MAX),'parent-output-record-custody');values.append(body)
        names=['intent.json','input.bin','returned-process.json','stdout.bin','stderr.bin','terminal.json']
        if spec['request'] in [4,5,6]:names+=['ready.stdout','ready.json','dependent.sql','dependent-intent.json']
        request_hashes[path.name]={'returnedPID':pid,'files':{name:{'sha256':sha(path/name,CAPTURE_MAX),'bytes':(path/name).stat().st_size} for name in names}}
    need(aggregate<=8388608,'parent-subject-aggregate-bound')
    same(values[0]['inventory'],values[1]['inventory'],'parent-current-inventory-catalogue');same(values[0]['inventory'],values[2]['inventory'],'parent-current-inventory-after')
    same({k:v for k,v in identities[0].items() if k!='pid'},{k:v for k,v in identities[2].items() if k!='pid'},'parent-backend-identity-stability')
    same(raw(attempt/'request-002/stdout.bin',65536),raw(attempt/'request-007/stdout.bin',65536),'parent-container-raw-stability')
    complete=completion(attempt,values)
    return dict(wait,invocation=entry['invocation'],controllerPID=entry['pid'],controllerUID=entry['uid'],
        completionInvocationJoin='TRANSITIVE_SEVEN_REQUEST_CUSTODY_NOT_DIRECT_FIELD',
        managerAckSHA256=sha(attempt/'manager-ack.json'),controllerCompleteSHA256=sha(attempt/'complete.json'),
        subjectAttempt=str(attempt),outerIntentSHA256=sha(folder/'intent.json'),rootIntentSHA256=intent['rootIntentSHA256'],
        sourcePreflightSHA256=facts['preflightSHA256'],admissionSHA256=facts['admissionSHA256'],bindingsSHA256=facts['bindingsSHA256'],
        operationProposalPinsSHA256=facts['operationProposalPinsSHA256'],
        outputCustody={name:{'sha256':sha(attempt/name,CAPTURE_MAX),'bytes':(attempt/name).stat().st_size} for name in ['before.json','catalogue.json','verification.json','complete.json','manager-ack.json']},
        requestCustody=request_hashes,unresolvedFunctionOIDs=complete['unresolvedFunctionOIDs'],
        nativeAcceptance='UNASSESSED_ROOT_RAW_AUDIT_REQUIRED',sourceClosureComplete=False,fixtureLaunchable=False,
        backendDeath='UNASSESSED',successorGranted=False)
