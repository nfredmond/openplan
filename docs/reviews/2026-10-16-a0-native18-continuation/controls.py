"""Focused18 continuation Popen-only construction campaign, not a PostgreSQL parser."""
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
ROOT=Path('/home/nathaniel/.local/state/openplan/a0-native18-continuation-20261016')
OLD=ROOT.with_name('a0-usage-limit-native-wrapper-20261016-r6')
MODULES=['continuation','controller','literal_history','journal','policy','fixture','cases']


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
        self.c=c;self.where=where;self.mode=mode;self.sent=False;self.calls=[];self.processes=[];self.forbid_body=None;self.body_attempted=False
        self.target=c.read(OLD/'stages/allocate/target.json')
        self.observation=c.read(OLD/'stages/observe/observed.json')
        self.history=c.co.retained_history(ROOT/'bindings')
        self.definitions=c.read(c.co.MAPROOT/'stages/apply17/definitions.json')
        self.snapshot=c.read(c.co.DECISION/'actual-post-map.json')['snapshot']
        self.raw=(c.REPO/c.SQL18).read_bytes()

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
                    check(all(line.strip().startswith('SET ') and line.count(';')==1 for line in text.splitlines() if 'SET ' in line),'fresh-physical-line')
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
                    model.body_attempted=True
                    if model.forbid_body is not None:raise AssertionError('predecessor-drift-accepted:'+model.forbid_body)
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
                        "'statements',statements", "'utf8hex'", "WHERE version<>'20261017000018'",
                        "WHERE version='20261017000018'"]:
                        check(projection in text,'postcommit-projection')
                    value={'priorDigest':model.history['digest'],'rows':[dict(version='20261017000018',name='assistant_usage_limit_receipts',
                        cardinality=1,dimensions=1,lowerBound=1,upperBound=1,byteLength=len(model.raw),statements=[model.raw.decode()],utf8hex=model.raw.hex(),
                        sha256=hashlib.sha256(model.raw).hexdigest())]}
                    if model.mode=='corrupt':value['rows'][0]['statements']=[model.raw.decode()+' ']
                elif "'versions',json_agg" in text:
                    value=copy.deepcopy(model.history)
                    if model.sent:
                        value['versions'].append('20261017000018');value['count']+=1;value['latest']='20261017000018'
                        value['digest']='a'*32
                elif 'json_object_agg(oid::' in text:
                    if "'body',prosrc" in text:
                        for projection in ["'body',prosrc", "'config',proconfig", 'aclexplode(', "'language'", "'result'", 'pg_get_functiondef(oid)']:
                            check(projection in text,'post18-function-projection')
                        expected=model.c.read(ROOT/'bindings/expected-post-functions.json')['functions']
                        value={}
                        for name,pin in expected.items():
                            row={k:v for k,v in pin.items() if k!='bodySHA256'}
                            row['definition']='INERT CAPTURE ONLY\n'+row['body']
                            row['sha256']=hashlib.sha256(row['definition'].encode()).hexdigest()
                            value[name]=row
                        if model.mode=='postbody':next(iter(value.values()))['body']+=' '
                        if model.mode=='postconfig':next(iter(value.values()))['config']+=['work_mem=1MB']
                        if model.mode=='postacl':next(iter(value.values()))['acl'][0]['grantee']='77777'
                    else:value=model.definitions
                elif 'CREATE TEMP TABLE a0_snapshot' in text:value=model.snapshot
                elif "'databases'" in text:value=model.observation['originalScope']
                elif "'adminSuperuser'" in text:value=model.target
                else:raise AssertionError('unknown-inert-command')
                self.stdout.write(json.dumps(value).encode()+b'\n');self.returncode=0;return 0
            def poll(self):return self.returncode
        proc=Process();self.calls.append(argv);self.processes.append(proc);return proc


def run_case(c,folder,scenario='matching'):
    folder.mkdir(mode=0o700)
    savedroot=c.ROOT;saved=c.j.subprocess.Popen;c.ROOT=folder
    stage=folder/'stages/apply18';stage.mkdir(mode=0o700,parents=True);(stage/'controller').mkdir(mode=0o700)
    mode=scenario if scenario in ['off','unknown','corrupt','postbody','postconfig','postacl'] else 'normal'
    model=Model(c,folder,mode)
    if scenario in ['map-history','map-ordinary','map-type']:
        if scenario=='map-history':model.snapshot['supabase_migrations.schema_migrations']['digest']='0'*32
        elif scenario=='map-ordinary':
            name=next(k for k,v in model.snapshot.items() if type(v) is dict and set(v)=={'count','digest'} and k!='supabase_migrations.schema_migrations')
            model.snapshot[name]['count']+=1
        else:
            name=next(k for k,v in model.snapshot.items() if type(v) is dict and 'is_called' in v)
            model.snapshot[name]['is_called']=int(model.snapshot[name]['is_called'])
        model.forbid_body=scenario
    if scenario=='history-digest':model.history['digest']='0'*32;model.forbid_body=scenario
    c.j.subprocess.Popen=model.popen
    try:
        admission={'priorFunctionPins':c.read(ROOT/'bindings/prior-function-pins.json'),
                   'expectedPostFunctions':c.read(ROOT/'bindings/expected-post-functions.json')}
        controller=c.Controller('apply18',c.read(OLD/'plan.json'),admission)
        if scenario.startswith('map-'):
            refuses(lambda:controller.apply(18),'retained-post17-map','new-map-refusal:'+scenario)
            check(not model.body_attempted,'map-refusal-before-body')
        elif scenario=='history-digest':
            refuses(lambda:controller.apply(18),'migration-prior-history','new-history-refusal')
            check(not model.body_attempted,'history-refusal-before-body')
        elif scenario=='off':
            refuses(lambda:controller.apply(18),'migration-ready-scs','inherited-on-refusal')
            check(not model.body_attempted,'off-body-absence')
        elif scenario=='unknown':
            try:controller.apply(18)
            except TimeoutError:pass
            else:raise AssertionError('inherited-unknown-refusal')
            check(model.sent and not (stage/'exact-history.json').exists(),'unknown-no-acceptance')
        elif scenario=='corrupt':
            refuses(lambda:controller.apply(18),'history-source-exact-readback','inherited-exact-readback')
            check(not (stage/'exact-history.json').exists(),'corrupt-no-acceptance')
        elif scenario in ['postbody','postconfig','postacl']:
            reasons={'postbody':'post18-body','postconfig':'post18-config','postacl':'post18-acl'}
            refuses(lambda:controller.apply(18),reasons[scenario],'new-post-refusal:'+scenario)
            check(not (stage/'definitions.json').exists(),'postbody-no-acceptance')
        else:
            controller.apply(18)
            check(model.sent and (stage/'predecessor-map.json').is_file(),'matching-map-body-evidence')
            check((stage/'exact-history.json').is_file() and (stage/'definitions.json').is_file(),'matching-postcommit-evidence')
        fresh=c.j.Transport(stage/'controller')
        try:fresh.run(controller.argv(controller.db),b'')
        except FileExistsError:pass
        else:raise AssertionError('inherited-no-replay')
    finally:
        c.j.subprocess.Popen=saved;c.ROOT=savedroot
        check(all(proc.stdin.closed for proc in model.processes),'owned-input-closure')


def receipt_case(c,folder,scenario):
    folder.mkdir(mode=0o700)
    bindings=folder/'bindings';bindings.mkdir(mode=0o700)
    binding=c.read(ROOT/'bindings/continued-predecessor.json')
    if scenario=='root':binding['root']+='/unadmitted'
    if scenario=='manager':binding['managerTerminalSHA256']='0'*64
    if scenario=='custody':binding['files'][str(c.co.MAPROOT/'stages/apply17/manager-terminal.json')]['bytes']+=1
    c.j.record(bindings/'continued-predecessor.json',binding)
    (bindings/'external-predecessor.json').write_bytes((ROOT/'bindings/external-predecessor.json').read_bytes())
    reasons={'root':'map17-root-binding','manager':'map17-manager-binding','custody':'map17-selected-custody'}
    if scenario=='matching':c.co.verify_predecessor(bindings,c.private,c.typed_equal)
    else:refuses(lambda:c.co.verify_predecessor(bindings,c.private,c.typed_equal),reasons[scenario],'new-receipt-refusal:'+scenario)


def main():
    os.umask(0o077)
    campaign=ROOT/'continuation-controls-01';campaign.mkdir(mode=0o700)
    reader_controls(campaign)
    mapguard="p.require(typed_equal(co.retained_snapshot(BINDINGS,private,typed_equal),before),'retained-post17-map')"
    trials=[('baseline',None,['matching','map-history','map-ordinary','map-type','history-digest','receipt:matching','receipt:root','receipt:manager','receipt:custody','off','unknown','corrupt','postbody','postconfig','postacl']),
        ('harmless',('controller.py','complete retained JSON map','entire retained JSON map'),['matching']),
        ('map-removed',('controller.py',mapguard,'pass'),['map-history','map-ordinary','map-type']),
        ('root-removed',('continuation.py',"p.same(str(MAPROOT),binding['root'],'map17-root-binding')",'pass'),['receipt:root']),
        ('manager-removed',('continuation.py',"p.same(MANAGER_SHA,binding['managerTerminalSHA256'],'map17-manager-binding')",'pass'),['receipt:manager']),
        ('custody-removed',('continuation.py',"p.same(descriptor,actual,'map17-selected-custody')",'pass'),['receipt:custody']),
        ('send-altered',('controller.py',"lh.execute(self,raw,h['digest'],BOUNDS)","lh.execute(self,raw+b' ',h['digest'],BOUNDS)"),['matching']),
        ('line-collapsed',('literal_history.py',"prelude += 'BEGIN;\\n'+bounds.replace(';', ';\\n')","prelude += 'BEGIN; '+bounds"),['matching']),
        ('postbody-removed',('controller.py',"co.post_functions(definitions,self.admission['expectedPostFunctions'],typed_equal)",'pass'),['postbody','postconfig','postacl']),
        ('restored',None,['matching','receipt:matching'])]
    results=[]
    for label,mutation,scenarios in trials:
        trial=campaign/label;trial.mkdir(mode=0o700);subject=trial/'subject';shutil.copytree(ROOT/'templates',subject)
        originals={str(p.relative_to(subject)):{'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'mode':p.stat().st_mode&0o777} for p in subject.rglob('*') if p.is_file()}
        target=None;original=None
        try:
            if mutation:
                name,old,new=mutation;target=subject/name;original=target.read_bytes();text=original.decode()
                check(text.count(old)==1,'mutation-anchor:'+label);target.write_text(text.replace(old,new))
            c=load(subject)
            for index,scenario in enumerate(scenarios):
                failure=None
                try:
                    if scenario.startswith('receipt:'):receipt_case(c,trial/str(index),scenario.split(':')[1])
                    else:run_case(c,trial/str(index),scenario)
                except Exception as error:failure=type(error).__name__+':'+str(error)
                expected=None
                if label=='map-removed':expected='predecessor-drift-accepted:'+scenario
                elif label in ['root-removed','manager-removed','custody-removed']:expected='new-receipt-refusal:'+scenario.split(':')[1]
                elif label=='postbody-removed':expected='new-post-refusal:'+scenario
                elif label=='send-altered':expected='history-encoding-bytes'
                elif label=='line-collapsed':expected='fresh-physical-line'
                if expected:check(named_failure(failure,expected),'wrong-continuation-fault:'+label+':'+scenario+':'+str(failure))
                else:check(failure is None,'unexpected-continuation-result:'+label+':'+scenario+':'+str(failure))
                results.append({'source':label,'scenario':scenario,'outcome':'survived' if label=='harmless' else 'named-failure' if expected else 'pass','failure':failure})
                (campaign/'partial-results.json').write_text(json.dumps(results,indent=2)+'\n')
        finally:
            if target is not None:target.write_bytes(original)
            restored={str(p.relative_to(subject)):{'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'mode':p.stat().st_mode&0o777} for p in subject.rglob('*') if p.is_file()}
            check(restored==originals,'exact-continuation-source-restoration')
            (trial/'restoration.json').write_text(json.dumps(restored,indent=2,sort_keys=True)+'\n')
    (campaign/'result.json').write_text(json.dumps({'trials':results,'sourceVariants':len(trials),'nativeParserAccepted':False,'oldCampaignRerun':False},indent=2)+'\n')
    print(json.dumps({'cases':len(results),'sourceVariants':len(trials),'native':False}))


if __name__=='__main__':main()
