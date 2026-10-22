"""Small Popen-only construction campaign, not a PostgreSQL parser."""
import copy
import hashlib
import importlib
import inspect
import json
import os
from pathlib import Path
import re
import shutil
import sys

HERE=Path(__file__).resolve().parent
ROOT=Path('/home/nathaniel/.local/state/openplan/a0-migration-history-literal-correction-20261016')
OLD=ROOT.with_name('a0-usage-limit-native-wrapper-20261016-r6')
MODULES=['controller','literal_history','journal','policy','fixture','cases']


def check(value, label):
    if not value:raise AssertionError(label)


def named_failure(failure, expected):
    """Accept exactly the named AssertionError, including its complete message."""
    return failure == 'AssertionError:'+expected


def reader_controls(campaign):
    source=inspect.getsource(named_failure)
    records=[]
    for label,subject in [('baseline',source),
        ('harmless',source.replace('complete message','full message')),
        ('substring-fault',source.replace("failure == 'AssertionError:'+expected",'failure is not None and expected in failure')),
        ('restored',source)]:
        namespace={};exec(compile(subject,'inert-reader-control','exec'),namespace)
        accept=namespace['named_failure'];failure=None
        try:
            check(accept('AssertionError:chosen-oracle','chosen-oracle'),'reader-exact-named-accepted')
            check(not accept('AssertionError:chosen-oracle:wrong-refusal:different','chosen-oracle'),'reader-wrong-refusal-rejected')
            for wrong in ['ValueError:chosen-oracle','IndexError:chosen-oracle',
                          'JSONDecodeError:chosen-oracle','AssertionError:prefix:chosen-oracle',None]:
                check(not accept(wrong,'chosen-oracle'),'reader-generic-failure-rejected')
        except AssertionError as error:failure='AssertionError:'+str(error)
        expected='AssertionError:reader-wrong-refusal-rejected' if label=='substring-fault' else None
        check(failure==expected,'reader-control-exact-outcome')
        records.append({'trial':label,'outcome':'survived' if label=='harmless' else 'named-failure' if expected else 'pass','failure':failure})
    check(inspect.getsource(named_failure)==source,'reader-exact-restoration')
    (campaign/'reader-controls.json').write_text(json.dumps(records,indent=2)+'\n')


def refuses(call, reason, label):
    try:call()
    except ValueError as error:
        check(str(error)==reason,label+':wrong-refusal:'+str(error));return
    raise AssertionError(label)


def load(subject):
    for name in MODULES:sys.modules.pop(name,None)
    sys.path.insert(0,str(subject))
    try:return importlib.import_module('controller')
    finally:sys.path.pop(0)


class Pipe:
    def __init__(self, proc):self.proc=proc;self.closed=False;self.chunks=[]
    def write(self, raw):
        check(not self.closed,'closed-input')
        self.chunks.append(raw);self.proc.consume(raw);return len(raw)
    def flush(self):pass
    def close(self):self.closed=True


class Model:
    def __init__(self,c,where,mode='normal'):
        self.c=c;self.where=where;self.mode=mode;self.sent=False;self.calls=[];self.processes=[]
        self.target=c.read(OLD/'stages/allocate/target.json')
        self.observation=c.read(OLD/'stages/observe/observed.json')
        self.history=c.read(OLD/'stages/restore419/history.json')
        self.definitions=c.read(OLD/'stages/restore419/definitions.json')
        self.snapshot=c.read(OLD/'stages/restore419/snapshot.json')
        self.raw=(c.REPO/c.SQL17).read_bytes()

    def popen(self, argv, **kwargs):
        model=self
        check(kwargs['env']=={'PATH':'/usr/bin:/bin','HOME':'/home/nathaniel','LANG':'C.UTF-8'},'transport-sanitized-env')
        class Process:
            pid=9001
            def __init__(self):
                self.stdin=Pipe(self);self.stdout=kwargs['stdout'];self.stderr=kwargs['stderr'];self.returncode=None
                self.phase=False;self.all=b''
                if argv[:2]==['/usr/bin/docker','inspect']:
                    self.stdout.write(json.dumps(model.observation['container']).encode()+b'\n')
            def consume(self, raw):
                self.all+=raw
                text=raw.decode('utf-8')
                if "'phase','migration-ready'" in text:
                    self.phase=True
                    check(model.raw not in raw,'migration-bytes-before-ready')
                    check('\nSET LOCAL ROLE postgres;\n' in text,'role-physical-line')
                    check(all(';' not in line.strip()[:-1] for line in text.splitlines() if line.startswith('SET ')),'fresh-physical-line')
                    value={key:model.target[key] for key in ['database','oid']}
                    value.update(phase='migration-ready',sessionRole='supabase_admin',currentRole='postgres',
                        postgresSuperuser=False,pid=7777,applicationName='a0-limit-wrapper',
                        scs='off' if model.mode=='off' else 'on',clientEncoding='UTF8',serverEncoding='UTF8')
                    if model.mode=='boolpid':value['pid']=True
                    if model.mode=='wrongdb':value['database']='unowned'
                    lines=(json.dumps(value)+'\n').encode()
                    if model.mode=='ambiguous':lines*=2
                    self.stdout.write(lines);return
                if self.phase:
                    check(model.raw in raw,'raw-source-preserved')
                    history=re.search(rb"ARRAY\[pg_catalog.convert_from\(pg_catalog.decode\('([0-9a-f]*)','hex'\),'UTF8'\)\]",raw)
                    check(history is not None,'history-hex-construction')
                    check(bytes.fromhex(history[1].decode())==model.raw,'history-encoding-bytes')
                    check((Path(self.stdout.name).parent/'ready.json').is_file(),'ready-durable-before-body')
                    check((Path(self.stdout.name).parent/'send-body-intent.json').is_file(),'send-durable-before-body')
                    model.sent=True;return
            def wait(self,timeout):
                if self.phase:
                    if model.mode=='unknown':raise TimeoutError('inert-unknown-commit')
                    self.returncode=0;return 0
                if argv[:2]==['/usr/bin/docker','inspect']:
                    self.returncode=0;return 0
                text=self.all.decode()
                if "'rows',coalesce" in text:
                    for projection in ["'version',version", "'name',name",'pg_catalog.cardinality(statements)',
                        'pg_catalog.array_ndims(statements)','pg_catalog.array_lower(statements,1)',
                        'pg_catalog.array_upper(statements,1)','pg_catalog.octet_length(',
                        'pg_catalog.sha256(pg_catalog.convert_to(statements[1]',
                        "'statements',statements", "'utf8hex'", "WHERE version<>'20261017000017'",
                        "WHERE version='20261017000017'"]:
                        check(projection in text,'postcommit-projection')
                    value={'priorDigest':model.history['digest'],'rows':[dict(version='20261017000017',name='portfolio_skip_invalid_classifications',
                        cardinality=1,dimensions=1,lowerBound=1,upperBound=1,byteLength=len(model.raw),statements=[model.raw.decode()],utf8hex=model.raw.hex(),
                        sha256=hashlib.sha256(model.raw).hexdigest())]}
                    if model.mode=='corrupt':value['rows'][0]['statements']=[model.raw.decode().replace('\\','')]
                elif "'versions',json_agg" in text:
                    value=copy.deepcopy(model.history)
                    if model.sent:
                        value['versions'].append('20261017000017');value['count']+=1;value['latest']='20261017000017'
                        value['digest']='a'*32
                elif 'json_object_agg(oid::' in text:value=model.definitions
                elif 'CREATE TEMP TABLE a0_snapshot' in text:value=model.snapshot
                elif "'databases'" in text:value=model.observation['originalScope']
                elif "'adminSuperuser'" in text:value=model.target
                else:raise AssertionError('unknown-inert-command')
                self.stdout.write(json.dumps(value).encode()+b'\n');self.returncode=0;return 0
            def poll(self):return self.returncode
        proc=Process();self.calls.append(argv);self.processes.append(proc);return proc


def exercise(c,folder):
    lh=c.lh;p=c.p
    corpus=b"'single' \"double\" \\s+ \\. \\n \\x41\t\r\n"+'日本語 café 🚌\n'.encode()
    corpus+=bytes(range(1,32))+b'\x7f'
    encoded=lh.text_value(corpus)
    match=re.fullmatch(r"pg_catalog.convert_from\(pg_catalog.decode\('([0-9a-f]*)','hex'\),'UTF8'\)",encoded)
    check(match is not None and bytes.fromhex(match[1])==corpus,'corpus-hex-preservation')
    refuses(lambda:lh.text_value(b'a\x00b'),'history-nul-unrepresentable','nul-refusal')
    source=folder/'source.sql';source.write_bytes((c.REPO/c.SQL17).read_bytes()+b'\n')
    refuses(lambda:lh.source_bytes(source),'migration-source-bytehash','source-hash-refusal')
    raw=(c.REPO/c.SQL17).read_bytes()
    good={'priorDigest':'b'*32,'rows':[dict(version=lh.VERSION,name=lh.NAME,cardinality=1,dimensions=1,lowerBound=1,upperBound=1,byteLength=len(raw),statements=[raw.decode()],
        utf8hex=raw.hex(),sha256=hashlib.sha256(raw).hexdigest())]}
    lh.exact_history(good,raw,'b'*32)
    for label,value,reason in [('duplicate',{'rows':good['rows']*2,'priorDigest':'b'*32},'history-row-cardinality'),
                               ('absent',{'rows':[],'priorDigest':'b'*32},'history-row-cardinality')]:
        refuses(lambda:lh.exact_history(value,raw,'b'*32),reason,'readback-'+label)
    for key,value in [('version','wrong'),('name','wrong'),('cardinality',2),('cardinality',True),
                      ('statements',[raw.decode().replace('\\','')]),('statements',[]),
                      ('dimensions',2),('lowerBound',0),('upperBound',0),('byteLength',0),('sha256','0'*64),('utf8hex','00')]:
        bad=copy.deepcopy(good);bad['rows'][0][key]=value
        refuses(lambda:lh.exact_history(bad,raw,'b'*32),'history-source-exact-readback','readback-'+key)
    bad=copy.deepcopy(good);bad['priorDigest']='0'*32
    refuses(lambda:lh.exact_history(bad,raw,'b'*32),'history-predecessor-unchanged','predecessor-history-change')
    realroot=c.ROOT;realhere=c.HERE
    try:
        # Exercise the actual source/package/external/predecessor ready path.
        proposal=c.read(ROOT/'proposed-admission.json')
        proposal['independentReviewSHA256']='f'*64
        admissionroot=folder/'preflight';admissionroot.mkdir(mode=0o700)
        (admissionroot/'admissions').mkdir(mode=0o700)
        (admissionroot/'plan.json').write_bytes((ROOT/'plan.json').read_bytes())
        (admissionroot/'plan.json').chmod(0o600)
        c.ROOT=admissionroot
        # Seal the immutable baseline package, while exercising this private
        # guard mutant. This is a marked inert admission, never dispatchable.
        c.HERE=ROOT/'templates'
        adm=admissionroot/'admissions/apply17.json'
        c.j.record(adm,proposal)
        c.ready('apply17')
        changed=copy.deepcopy(proposal);changed['continuedPredecessor']['target']['oid']=6212363
        adm.write_text(json.dumps(changed));adm.chmod(0o600)
        refuses(lambda:c.ready('apply17'),'admission-external-predecessor','predecessor-rebinding')
        adm.write_text(json.dumps(proposal));adm.chmod(0o600)
        refuses(lambda:c.ready('apply18'),'stage-name','stage18-refusal')
    finally:c.ROOT=realroot;c.HERE=realhere
    for mode in ['normal','off','ambiguous','boolpid','wrongdb','corrupt','unknown']:
        trial=folder/mode;trial.mkdir(mode=0o700)
        c.ROOT=trial
        stage=trial/'stages/apply17';stage.mkdir(mode=0o700,parents=True)
        (stage/'controller').mkdir(mode=0o700)
        model=Model(c,trial,mode)
        saved=c.j.subprocess.Popen;c.j.subprocess.Popen=model.popen
        controller=c.Controller('apply17',c.read(OLD/'plan.json'),{'priorFunctionPins':c.read(ROOT/'bindings/prior-function-pins.json')})
        reason={'off':'migration-ready-scs','ambiguous':'migration-ready-ambiguous',
                'boolpid':'migration-ready-pid','wrongdb':'migration-ready-database'}
        try:
            if mode in reason:
                refuses(lambda:controller.apply(17),reason[mode],'phase-refusal-'+mode)
                check(not model.sent,'dependent-send-after-'+mode)
            elif mode=='unknown':
                try:controller.apply(17)
                except TimeoutError:pass
                else:raise AssertionError('unknown-commit-refusal')
                check(model.sent,'unknown-input-reached')
                check(not (stage/'exact-history.json').exists(),'unknown-commit-no-readback')
            elif mode=='corrupt':
                refuses(lambda:controller.apply(17),'history-source-exact-readback','postcommit-corrupt-refusal')
                check(model.sent and not (stage/'exact-history.json').exists(),'postcommit-corrupt-no-acceptance')
            else:
                controller.apply(17)
                check((stage/'exact-history.json').is_file(),'postcommit-independent-readback')
                check(model.sent,'migration-body-reached')
            # Actual journal namespace refuses replay, including unknown dispatch.
            fresh=c.j.Transport(stage/'controller')
            try:fresh.run(controller.argv(controller.db),b'')
            except FileExistsError:pass
            else:raise AssertionError('partial-intent-no-replay')
            check(all(x.stdin.closed for x in model.processes),'owned-input-closure')
        finally:
            c.j.subprocess.Popen=saved;c.ROOT=realroot


MUTATIONS=[
 ('harmless','literal_history.py','Exact UTF-8 history','Exact original UTF-8 history',None),
 ('hex','literal_history.py','raw.hex() +','raw.hex()[2:] +','corpus-hex-preservation'),
 ('nul','literal_history.py',"p.require(b'\\x00' not in raw, 'history-nul-unrepresentable')",'pass','nul-refusal'),
 ('sourcehash','literal_history.py',"p.same(SOURCE_SHA, hashlib.sha256(raw).hexdigest(), 'migration-source-bytehash')",'pass','source-hash-refusal'),
 ('rowcount','literal_history.py',"p.require(type(rows) is list and len(rows) == 1, 'history-row-cardinality')","p.require(type(rows) is list, 'history-row-cardinality')",'readback-duplicate'),
 ('exactread','literal_history.py',"p.same(wanted, rows[0].get(key), 'history-source-exact-readback')",'pass','readback-version'),
 ('priorhistory','literal_history.py',"p.same(prior_digest,value.get('priorDigest'),'history-predecessor-unchanged')",'pass','predecessor-history-change'),
 ('readbackcall','controller.py',"lh.exact_history(exact,raw,h['digest'])",'pass','postcommit-corrupt-refusal'),
 ('projection','literal_history.py','pg_catalog.array_ndims(statements)','1','postcommit-projection'),
 ('scs','literal_history.py',"'scs':'on'","'scs':value.get('scs')",'phase-refusal-off'),
 ('pid','literal_history.py',"p.require(type(value.get('pid')) is int and value['pid'] > 0, 'migration-ready-pid')",'pass','phase-refusal-boolpid'),
 ('identity','literal_history.py',"'database':target['database']","'database':value.get('database')",'phase-refusal-wrongdb'),
 ('ambiguous','literal_history.py',"p.same(1, len(raw.splitlines()), 'migration-ready-ambiguous')\n            value = json.loads(raw)","value = json.loads(raw.splitlines()[0])",'phase-refusal-ambiguous'),
 ('predecessor','controller.py',"p.same(binding,admission.get('continuedPredecessor'),'admission-external-predecessor')",'pass','predecessor-rebinding'),
 ('newline','literal_history.py',"bounds.replace(';', ';\\n')",'bounds','fresh-physical-line'),
 ('earlysend','literal_history.py','before = wait_ready(handle, controller.target)',"handle[0].stdin.write(body(raw, prior_digest))\n        before = wait_ready(handle, controller.target)",'ready-durable-before-body'),
]


def main():
    os.umask(0o077)
    campaign=ROOT/'controls-01';campaign.mkdir(mode=0o700)
    reader_controls(campaign)
    results=[]
    trials=[('baseline',None)]+[(m[0],m) for m in MUTATIONS]+[('restored',None)]
    for label,mutation in trials:
        trial=campaign/label;trial.mkdir(mode=0o700)
        subject=trial/'subject';shutil.copytree(ROOT/'templates',subject)
        originals={str(x.relative_to(subject)):x.read_bytes() for x in subject.rglob('*') if x.is_file()}
        target=None;failure=None
        try:
            if mutation:
                _,name,old,new,_=mutation;target=subject/name
                text=target.read_text();check(text.count(old)==1,'mutation-anchor:'+label)
                target.write_text(text.replace(old,new))
            try:exercise(load(subject),trial)
            except (AssertionError,ValueError,IndexError,json.JSONDecodeError) as error:
                failure=type(error).__name__+':'+str(error)
            expected=mutation[4] if mutation else None
            if expected is None:check(failure is None,'unexpected:'+label+':'+str(failure))
            else:check(named_failure(failure,expected),'wrong-mutation-outcome:'+label+':'+str(failure))
            results.append({'trial':label,'outcome':'survived' if label=='harmless' else 'named-failure' if expected else 'pass',
                            'failure':failure})
        finally:
            for name,raw in originals.items():
                path=subject/name;path.write_bytes(raw);path.chmod(0o700 if path.suffix=='.sh' else 0o600)
            check(all((subject/name).read_bytes()==raw for name,raw in originals.items()),'exact-finally-restoration')
            (trial/'restoration.json').write_text(json.dumps({name:hashlib.sha256(raw).hexdigest() for name,raw in originals.items()},indent=2)+'\n')
            (campaign/'partial-results.json').write_text(json.dumps(results,indent=2)+'\n')
    (campaign/'result.json').write_text(json.dumps({'trials':results,'nativeParserProof':False,'onlyPopenInert':True},indent=2)+'\n')
    print(json.dumps({'trials':len(results),'native':False}))


if __name__=='__main__':main()
