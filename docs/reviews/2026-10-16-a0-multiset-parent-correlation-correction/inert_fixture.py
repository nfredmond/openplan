"""Independent supplied journal model. No database or old runtime imports."""
import copy
import hashlib
import json
import os
from pathlib import Path
import time
from inert_adapter import PUBLIC,LOGICAL_ROOT,LOGICAL_SUBJECT,LOGICAL_LOCK,UNIT,WRAPPER_PID,FIXED_MANAGER_ARGV,manager_environment

SOURCE='f8a571bb0a18b8b6501870acb5ef1e760d487e1c'
APP='d577a9cd955018b3253f42b3d9af2a96a9a10b53'
CONNECTOR='228ce912b1cf63dba408445422dc6e2b690d91f4'
SYSTEM='7683856985084612646'
TARGET='openplan_a0_limit_c730358675ac8bb47ac15fdd'
SCOPE='450162489323f8e76e68614e7411001098892984e38d265ae6f2ed2e03bc7371'
INV='31415926535897932384626433832795'
ENTRY_PID=710001
UNKNOWN_OID=730001
CLAIM='READ ONLY current catalogue observations only. Root must accept structural/source/permission findings separately.'
NAMES=['intent.json','input.bin','returned-process.json','stdout.bin','stderr.bin','terminal.json']
PREFLIGHT=['sourceExact','runtimeExact','externalAuthorityExact','priorScopeAndActual18Exact','singleUsePathsAbsent',
    'capacityAccepted','containerExact','unitAvailable','compilerWindowExclusive','canonicalFencesUnchanged',
    'readOnlyFootprintAccepted','nativeReadOnlyLimitsAccepted']


def encoded(value):return (json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=True)+'\n').encode()
def sha(value):return hashlib.sha256(value).hexdigest()
def clone(value):return copy.deepcopy(value)


def put(path,value,mode=0o600):
    path=Path(path);path.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
    data=value if type(value) is bytes else encoded(value)
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_TRUNC|os.O_NOFOLLOW,mode)
    with os.fdopen(fd,'wb') as stream:
        stream.write(data);stream.flush();os.fsync(stream.fileno())
    os.chmod(path,mode)


def descriptor(path):
    data=path.read_bytes();s=path.lstat()
    return {'sha256':sha(data),'bytes':len(data),'mode':s.st_mode&0o777,'uid':s.st_uid,'gid':s.st_gid}


def wait_bytes(suffix=None):
    header='Running as unit: '+UNIT+'.service'
    if suffix is not None:header+='; invocation ID: '+suffix
    return (header+'\n          Finished with result: success\nMain processes terminated with: code=exited, status=0/SUCCESS\n'
        '    Service runtime: 1.000s\n CPU time consumed: 2ms\n Memory peak: 1M (swap: 0B)\n').encode()


class Fixture:
    def __init__(self,bundle,case=None,suffix=None):
        self.b=bundle;self.s=bundle.surface;self.case=case;self.uid=os.getuid()
        self.fixed=json.loads((PUBLIC/'fixed-contract.json').read_bytes())
        self.r=self.s.scratch/'root';self.subject=self.s.scratch/'subject'
        self.r.mkdir(mode=0o700);self.subject.mkdir(mode=0o700)
        self.s.wait_bytes=wait_bytes(suffix);self.s.stage=self.stage
        if os.getpid() in [ENTRY_PID,WRAPPER_PID]:raise ValueError('inert-actor-pid-collision')
        self.group='/user.slice/user-'+str(self.uid)+'.slice/user@'+str(self.uid)+'.service/app.slice/'+UNIT+'.service'

    def path(self,logical):return self.s.physical(self.s.Path(logical))
    def write(self,logical,value):put(self.path(logical),value)
    def data(self,logical):return self.path(logical).read_bytes()

    def authority(self):
        # This fake authority exists only behind the logical-path facade in TEST scratch.
        source_files=json.loads((PUBLIC/'control-input-allowlist.json').read_bytes())['files']
        ledger={'schema':1,'files':{name:descriptor(self.path(name)) for name in sorted(source_files)}}
        self.write(LOGICAL_ROOT+'/operation-source-pins.json',ledger)
        report='/home/nathaniel/.t3/worktrees/openplan/t3-40bfca48/docs/reviews/2026-10-16-a0-dependency-multiset-independent/REPORT.md'
        self.write(LOGICAL_SUBJECT+'/source-review.md',self.data(report))
        self.write(LOGICAL_SUBJECT+'/operation-review.md',b'INERT_REVIEW_NOT_OPERATION_AUTHORITY\n')
        attempts=[{'attempt':'/home/nathaniel/.local/state/openplan/'+name+'/catalogue-attempt',
            'fence':'FENCED_NO_REPLAY','parent':'UNKNOWN_STOP_ROOT_DECISION','missingRequests':['request-006','request-007'],
            'completeAbsent':True,'finalAfter':'UNASSESSED','backendDeath':'UNASSESSED'} for name in [
            'a0-post18-catalogue-namespace-correction-20261016','a0-catalogue-trigger-completeness-correction-20261016']]
        decision={'stage':'catalogue','target':TARGET,'oid':6227945,'systemIdentifier':SYSTEM,'source':SOURCE,
            'subjectRoot':LOGICAL_SUBJECT,'unit':UNIT,'oldAttempts':attempts,'readOnlyContinuationAccepted':True}
        self.write(LOGICAL_ROOT+'/root-risk-decision.json',decision)
        self.write(LOGICAL_ROOT+'/root-risk-evidence.json',{'inertOnly':'NOT_A_ROOT_RISK_DISPOSITION'})
        risk={'freshRiskDecisionSHA256':sha(self.data(LOGICAL_ROOT+'/root-risk-decision.json')),
            'freshRiskEvidenceSHA256':sha(self.data(LOGICAL_ROOT+'/root-risk-evidence.json'))}
        now=int(time.time());preflight=dict.fromkeys(PREFLIGHT,True)
        preflight.update(at=now,postFailureDisposition=dict(risk,oldAttempts=attempts,readOnlyContinuationAccepted=True))
        self.write(LOGICAL_ROOT+'/root-preflight.json',preflight)
        base={'schema':1,'stage':'catalogue','target':TARGET,'oid':6227945,'systemIdentifier':SYSTEM,'source':SOURCE,'app':APP,
            'connector':CONNECTOR,'unit':UNIT,'uid':self.uid,'nativeOperationGranted':True,'exclusive':True,
            'memoryBytes':536870912,'swapBytes':0,'cpuPercent':50,'tasksMax':64,'runtimeSeconds':180,
            'operationProposalPinsSHA256':sha(self.data(LOGICAL_ROOT+'/operation-source-pins.json')),
            'notBefore':now-1,'notAfter':now+120,
            'sourceReviewSHA256':sha(self.data(LOGICAL_SUBJECT+'/source-review.md')),
            'operationReviewSHA256':sha(self.data(LOGICAL_SUBJECT+'/operation-review.md')),
            'bindingsSHA256':sha(self.data(LOGICAL_SUBJECT+'/catalogue-bindings.json')),
            'preflightSHA256':sha(self.data(LOGICAL_ROOT+'/root-preflight.json'))}
        self.write(LOGICAL_SUBJECT+'/catalogue-admission.json',base)
        facts={key:base[key] for key in ['sourceReviewSHA256','operationReviewSHA256','bindingsSHA256','preflightSHA256',
            'operationProposalPinsSHA256','unit','uid','nativeOperationGranted','exclusive','notBefore','notAfter']}
        facts.update(admissionSHA256=sha(self.data(LOGICAL_SUBJECT+'/catalogue-admission.json')),
            parentSourceSHA256=sha(self.data(str(PUBLIC/'outer.py'))),collectorSHA256=sha(self.data(str(PUBLIC/'collector.py'))),
            correlationSourceSHA256=sha(self.data(str(PUBLIC/'custody.py'))),fixedContractSHA256='91292e69956500428851f467a2966ee6c65b88a7d2385c41648f73d17fa57bd1',
            argv=FIXED_MANAGER_ARGV,deadlineSeconds=205,stdoutLimit=1048576,stderrLimit=65536,retry='FORBIDDEN',**risk)
        self.write(LOGICAL_ROOT+'/root-operation-intent.json',facts)
        self.write(LOGICAL_LOCK,b'INERT_COMPILER_FILE_MODEL\n')
        if self.case=='authority-source-ledger':
            ledger['files'][str(PUBLIC/'outer.py')]['sha256']='0'*64
            self.write(LOGICAL_ROOT+'/operation-source-pins.json',ledger)
        if self.case=='authority-preflight':
            preflight['sourceExact']=1
            # Earlier admission/intent hashes must agree so the selected boolean guard is reached.
            self.write(LOGICAL_ROOT+'/root-preflight.json',preflight)
            base['preflightSHA256']=sha(self.data(LOGICAL_ROOT+'/root-preflight.json'))
            self.write(LOGICAL_SUBJECT+'/catalogue-admission.json',base)
            facts.update(preflightSHA256=base['preflightSHA256'],admissionSHA256=sha(self.data(LOGICAL_SUBJECT+'/catalogue-admission.json')))
            self.write(LOGICAL_ROOT+'/root-operation-intent.json',facts)
        if self.case=='authority-admission-type':
            base['uid']=True;self.write(LOGICAL_SUBJECT+'/catalogue-admission.json',base)
        if self.case=='authority-risk':
            decision['oldAttempts'][0]['backendDeath']='PROVED'
            self.write(LOGICAL_ROOT+'/root-risk-decision.json',decision)
        if self.case=='authority-replay':(self.subject/'catalogue-attempt').mkdir(mode=0o700)
        if self.case=='authority-bindings':
            base['bindingsSHA256']='0'*64;self.write(LOGICAL_SUBJECT+'/catalogue-admission.json',base)

    def stage(self):
        attempt=self.subject/'catalogue-attempt';attempt.mkdir(mode=0o700)
        self.attempt=attempt;self.journals={};self.outputs={}
        read=lambda key:json.loads(self.data(self.fixed['retainedAuthority'][key]['path']))
        retained={'map':read('rawMap'),'history':read('history'),'exact':read('exact'),'functions':read('definitions'),'scope':SCOPE}
        inventory=[]
        for i,label in enumerate(sorted(retained['map'])):
            if label=='__pg_sequences__':continue
            schema,name=label.split('.')
            seq=set(retained['map'][label])=={'last_value','log_cnt','is_called'}
            inventory.append({'oid':800000+i,'schema':schema,'name':name,'kind':'S' if seq else 'r'})
        properties={'Id':UNIT+'.service','InvocationID':INV,'MainPID':ENTRY_PID,'ControlGroup':self.group,'ActiveState':'active',
            'SubState':'running','RuntimeMaxUSec':180000000,'MemoryMax':536870912,'MemorySwapMax':0,'CPUQuotaPerSecUSec':500000,'TasksMax':64}
        rendered=dict(properties,RuntimeMaxUSec='3min',CPUQuotaPerSecUSec='500ms')
        raw_properties=('\n'.join(key+'='+str(value) for key,value in rendered.items())+'\n').encode()
        catalogue={key:{'INERT_PARENT_ONLY_UNVALIDATED':True} for key in self.fixed['expectedCatalogueSections']}
        function={'oid':UNKNOWN_OID,'pronamespace':2200,'proname':'INERT_UNKNOWN','proowner':16384,'prolang':14,'prokind':'f',
            'prosecdef':False,'provolatile':'v','proisstrict':False,'proleakproof':False,'proparallel':'u','prorettype':23,'proretset':False,
            'proacl':None,'expanded_acl':[],'identity':'INERT_UNKNOWN()','fingerprints':{'inert':True},'reviewed':False,'definition_data':None}
        catalogue['functions']={'count':1,'limit':64,'rows':[function]}
        for spec in self.fixed['requests']:
            n=spec['request'];files={};data=self.data(spec['inputSource']);files['input.bin']=data
            files['intent.json']={'argv':spec['argv'],'environment':manager_environment(self.uid) if n==1 else {
                'PATH':'/usr/bin:/bin','HOME':'/nonexistent','LANG':'C.UTF-8'},'purpose':spec['purpose'],'timeout':spec['timeout'],
                'streamByteLimit':spec['streamByteLimit'],'inputSHA256':sha(data),'inputFile':None,'uid':self.uid,'controllerPID':ENTRY_PID,'retry':'FORBIDDEN'}
            files['returned-process.json']={'pid':710100+n,'ack':'process-returned-only'}
            stdout=raw_properties if n==1 else b'INERT_INSPECT\n' if n in [2,7] else b''
            if n in [4,5,6]:
                ready={'database':TARGET,'oid':6227945,'systemIdentifier':SYSTEM,'sessionRole':'supabase_admin','currentRole':'supabase_admin',
                    'adminSuperuser':True,'postgresSuperuser':False,'scs':'on','clientEncoding':'UTF8','serverEncoding':'UTF8','readOnly':'on',
                    'namespaceReady':True,'pid':720000+n,'sessionOid':16384,'currentOid':16384,'postgresOid':16445,'version':'170006'}
                body=dict(clone(retained),inventory=clone(inventory))
                if n==5:body.update(catalogue=clone(catalogue),absence={'INERT_ONLY':True})
                self.outputs[n]=body;files['ready.json']=ready;files['ready.stdout']=encoded(ready)
                files['dependent.sql']=self.data(spec['dependentSource'])
                files['dependent-intent.json']={'sha256':sha(files['dependent.sql']),'backendPID':ready['pid'],'retry':'FORBIDDEN','effect':'READ ONLY catalogue; no fixture'}
                stdout=encoded(ready)+encoded(body)
            files['stdout.bin']=stdout;files['stderr.bin']=b''
            self.journals[n]=files
        self.entry={'pid':ENTRY_PID,'uid':self.uid,'uids':[self.uid]*4,'invocation':INV,'controlGroup':self.group,
            'resources':{'memoryMax':536870912,'swapMax':0,'cpuMax':'50000 100000','tasksMax':64}}
        self.ack={'unitName':UNIT,'entry':self.entry,'runtimeSeconds':180,'properties':properties,'request':'request-001','custody':{}}
        self.complete={'stage':'catalogue','status':'capture-complete','source':SOURCE,'app':APP,'sourceClosureComplete':False,
            'fixtureLaunchable':False,'priorPhysicalKindOrOIDEquivalence':'UNPROVED','unresolvedFunctionOIDs':[UNKNOWN_OID],'claim':CLAIM}
        self.change()
        for n,files in self.journals.items():
            # Co-seal all changed raw bytes. Tests isolate semantic guards from incidental hash failures.
            if n in [4,5,6]:files['stdout.bin']=encoded(files['ready.json'])+encoded(self.outputs[n])
            value=files['stdout.bin'];stderr=files['stderr.bin'];spec=self.fixed['requests'][n-1]
            files['terminal.json']={'returncode':0,'errorType':None,'elapsedSeconds':0.01,'timeoutSeconds':spec['timeout'],
                'classification':'terminal','backend':'unassessed','commitACK':'unassessed','observedStdoutBytes':len(value),
                'observedStderrBytes':len(stderr),'stdoutBytes':len(value),'stderrBytes':len(stderr),'stdoutSHA256':sha(value),'stderrSHA256':sha(stderr)}
            if self.case=='request-unknown-terminal' and n==4:
                files['terminal.json'].update(returncode=None,errorType='INERT_UNKNOWN',classification='UNKNOWN_NO_REPLAY')
            for name,value in files.items():put(attempt/('request-'+str(n).zfill(3))/name,value)
        self.ack['custody']={name:sha((attempt/'request-001'/name).read_bytes()) for name in NAMES}
        if self.case=='ack-custody':self.ack['custody']['stdout.bin']='0'*64
        for n,name in [(4,'before.json'),(5,'catalogue.json'),(6,'verification.json')]:
            body=clone(self.outputs[n])
            if self.case=='output-custody' and n==5:body['catalogue']['functions']['rows'][0]['identity']='INERT_CHANGED_STORED'
            put(attempt/name,body)
        put(attempt/'manager-ack.json',self.ack);put(attempt/'complete.json',self.complete)
        facts=json.loads(self.data(LOGICAL_ROOT+'/root-operation-intent.json'))
        put(attempt/'intent.json',{'stage':'catalogue','admissionSHA256':facts['admissionSHA256'],'retry':'FORBIDDEN'})
        if self.case=='stage-intent':put(attempt/'intent.json',{'stage':'catalogue','admissionSHA256':'0'*64,'retry':'FORBIDDEN'})
        if self.case=='request-sequence':(attempt/'request-008').mkdir(mode=0o700)

    def change(self):
        case=self.case;j=self.journals
        if case=='ack-recorded-properties':self.ack['properties']['MemoryMax']=536870911
        if case=='ack-raw-entry':
            j[1]['stdout.bin']=j[1]['stdout.bin'].replace(b'MainPID=710001',b'MainPID=710009');self.ack['properties']['MainPID']=710009
        if case=='entry-resources':self.entry['resources']['tasksMax']=63
        if case=='entry-uid-type':self.entry['uids'][1]=True
        if case=='entry-zero-inv':self.entry['invocation']='0'*32
        if case=='entry-cgroup':self.entry['controlGroup']='/wrong/unit.service'
        if case=='request-intent':j[4]['intent.json']['timeout']=44
        if case=='request-input':j[4]['input.bin']+=b'INERT_INPUT_DRIFT'
        if case=='request-helper-pid':j[2]['returned-process.json']['pid']=0
        if case=='ready-prefix':j[4]['ready.stdout']+=b'INERT_PREFIX_DRIFT'
        if case=='ready-type':j[4]['ready.json']['namespaceReady']=1
        if case=='ready-off':j[4]['ready.json']['scs']='off'
        if case in ['ready-type','ready-off']:j[4]['ready.stdout']=encoded(j[4]['ready.json'])
        if case=='dependent-source':
            j[4]['dependent.sql']+=b'\n-- INERT_BODY_DRIFT\n';j[4]['dependent-intent.json']['sha256']=sha(j[4]['dependent.sql'])
        if case=='dependent-backend':j[4]['dependent-intent.json']['backendPID']=720099
        if case=='retained-map':
            for body in self.outputs.values():body['map']['__pg_sequences__']='INERT_REPLACED_CENSUS'
        if case=='current-inventory':self.outputs[6]['inventory'][0]['oid']=900000
        if case=='complete-exact':self.complete['fixtureLaunchable']=True
        if case=='complete-unresolved-bool':self.complete['unresolvedFunctionOIDs']=[True]
        if case=='complete-unresolved-wrong':self.complete['unresolvedFunctionOIDs']=[730002]
        if case=='unknown-definition':self.outputs[5]['catalogue']['functions']['rows'][0]['definition_data']='INERT_UNKNOWN_LABEL'

    def correlate(self):
        facts=self.b.outer.ready();folder=self.s.Path(LOGICAL_ROOT)/'catalogue-parent-attempt';folder.mkdir(mode=0o700)
        self.b.collector.record(folder/'intent.json',dict(facts,parentPID=os.getpid(),environment=manager_environment(self.uid),
            rootIntentSHA256=sha(self.data(LOGICAL_ROOT+'/root-operation-intent.json')),retry='FORBIDDEN'))
        result=self.b.collector.collect(folder)
        if self.case=='manager-clean-terminal':
            result['terminal'].update(cleanupErrors=[{'INERT_ONLY':True}],classification='UNKNOWN_NO_REPLAY')
            put(self.path(str(folder/'terminal.json')),result['terminal'])
        if self.case=='terminal-record-durability':result.update(terminalRecorded=False,terminalRecordError={'INERT_ONLY':True})
        if self.case=='parent-stream-hash':
            result['terminal']['streams']['stdout']['sha256']='0'*64
            put(self.path(str(folder/'terminal.json')),result['terminal'])
        self.b.collector.record(folder/'collection-return.json',result)
        return self.b.c.correlate(folder,facts,result)
