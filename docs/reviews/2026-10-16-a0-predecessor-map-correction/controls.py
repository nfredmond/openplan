"""Focused predecessor-map Popen-only construction campaign, not a PostgreSQL parser."""
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
ROOT=Path('/home/nathaniel/.local/state/openplan/a0-predecessor-map-correction-20261016')
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
        self.c=c;self.where=where;self.mode=mode;self.sent=False;self.calls=[];self.processes=[];self.forbid_body=None;self.body_attempted=False
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


DRIFTS=['ordinary-count','ordinary-digest','last_value','log_cnt','is_called',
        'missing-label','extra-label','field-type','bool-int-type','census','history']


def changed_map(snapshot,scenario):
    value=copy.deepcopy(snapshot)
    ordinary=next(k for k,v in sorted(value.items()) if type(v) is dict and set(v)=={'count','digest'} and k!='supabase_migrations.schema_migrations')
    sequence=next(k for k,v in sorted(value.items()) if type(v) is dict and set(v)=={'last_value','log_cnt','is_called'})
    if scenario=='ordinary-count':value[ordinary]['count']+=1
    elif scenario=='ordinary-digest':value[ordinary]['digest']='0'*32 if value[ordinary]['digest']!='0'*32 else '1'*32
    elif scenario in ['last_value','log_cnt']:value[sequence][scenario]+=1
    elif scenario=='is_called':value[sequence]['is_called']=not value[sequence]['is_called']
    elif scenario=='missing-label':del value[ordinary]
    elif scenario=='extra-label':value['public.unadmitted_extra']=copy.deepcopy(value[ordinary])
    elif scenario=='field-type':value[ordinary]['count']=str(value[ordinary]['count'])
    elif scenario=='bool-int-type':value[sequence]['is_called']=int(value[sequence]['is_called'])
    elif scenario=='census':value['__pg_sequences__']='0'*32
    elif scenario=='history':value['supabase_migrations.schema_migrations']['count']+=1
    else:raise AssertionError('unplanned-drift')
    return value


def run_case(c,folder,scenario='matching'):
    folder.mkdir(mode=0o700)
    savedroot=c.ROOT;saved=c.j.subprocess.Popen
    c.ROOT=folder
    stage=folder/'stages/apply17';stage.mkdir(mode=0o700,parents=True)
    (stage/'controller').mkdir(mode=0o700)
    mode=scenario if scenario in ['off','unknown','corrupt'] else 'normal'
    model=Model(c,folder,mode)
    if scenario in DRIFTS:
        # Current fake observations vary independently from the read-only file.
        model.snapshot=changed_map(model.snapshot,scenario)
        model.forbid_body=scenario
    c.j.subprocess.Popen=model.popen
    try:
        controller=c.Controller('apply17',c.read(OLD/'plan.json'),{'priorFunctionPins':c.read(ROOT/'bindings/prior-function-pins.json')})
        if scenario in DRIFTS:
            refuses(lambda:controller.apply(17),'retained-predecessor-map','predecessor-refusal:'+scenario)
            check(not model.body_attempted,'predecessor-body-absence:'+scenario)
            check(not (stage/'predecessor-map.json').exists(),'mismatch-not-recorded-as-match')
        elif scenario=='off':
            refuses(lambda:controller.apply(17),'migration-ready-scs','inherited-on-refusal')
            check(not model.body_attempted,'off-body-absence')
        elif scenario=='unknown':
            try:controller.apply(17)
            except TimeoutError:pass
            else:raise AssertionError('inherited-unknown-refusal')
            check(model.sent and not (stage/'exact-history.json').exists(),'unknown-no-acceptance')
        elif scenario=='corrupt':
            refuses(lambda:controller.apply(17),'history-source-exact-readback','inherited-exact-readback')
            check(not (stage/'exact-history.json').exists(),'corrupt-no-acceptance')
        else:
            controller.apply(17)
            check(model.sent and (stage/'predecessor-map.json').is_file(),'matching-before-body-evidence')
            check((stage/'exact-history.json').is_file(),'matching-postcommit-evidence')
        fresh=c.j.Transport(stage/'controller')
        try:fresh.run(controller.argv(controller.db),b'')
        except FileExistsError:pass
        else:raise AssertionError('inherited-no-replay')
    finally:
        c.j.subprocess.Popen=saved;c.ROOT=savedroot
        check(all(proc.stdin.closed for proc in model.processes),'owned-input-closure')


def loader_case(c,folder,kind):
    folder.mkdir(mode=0o700)
    external=folder/'external';(external/'stages/restore419').mkdir(mode=0o700,parents=True)
    bindings=folder/'bindings';bindings.mkdir(mode=0o700)
    path=external/'stages/restore419/snapshot.json'
    raw=(OLD/'stages/restore419/snapshot.json').read_bytes()
    path.write_bytes(raw+(b'\n' if kind=='changed-bytes' else b''));path.chmod(0o600)
    files={str(path):c.SNAPSHOT_PIN} if kind!='unadmitted' else {}
    c.j.record(bindings/'external-predecessor.json',{'files':files})
    savedexternal=c.EXTERNAL;savedbindings=c.BINDINGS
    c.EXTERNAL=external;c.BINDINGS=bindings
    try:
        if kind=='unadmitted':refuses(c.retained_snapshot,'retained-snapshot-admitted-pin','unadmitted-snapshot-accepted')
        elif kind=='changed-bytes':refuses(c.retained_snapshot,'retained-snapshot-bytes','changed-snapshot-bytes-accepted')
        else:check(c.typed_equal(json.loads(raw),c.retained_snapshot()),'matching-loader')
    finally:c.EXTERNAL=savedexternal;c.BINDINGS=savedbindings


def main():
    os.umask(0o077)
    campaign=ROOT/'map-controls-01';campaign.mkdir(mode=0o700)
    reader_controls(campaign)
    baseline=(ROOT/'templates/controller.py').read_text()
    guard="p.require(typed_equal(retained_snapshot(),before),'retained-predecessor-map')"
    trials=[('baseline',None,['matching',*DRIFTS,'off','unknown','corrupt']),
        ('harmless',('complete retained JSON map','entire retained JSON map'),['matching']),
        ('guard-removed',(guard,'pass'),DRIFTS),
        ('type-removed',('if type(expected) is not type(actual): return False','if False: return False'),['bool-int-type']),
        ('admission-removed',("p.same(SNAPSHOT_PIN,selected,'retained-snapshot-admitted-pin')",'pass'),['loader:unadmitted']),
        ('bytes-removed',("p.same(SNAPSHOT_PIN,{'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw)},'retained-snapshot-bytes')",'pass'),['loader:changed-bytes']),
        ('restored',None,['matching','loader:matching','loader:unadmitted','loader:changed-bytes'])]
    results=[]
    for label,mutation,scenarios in trials:
        trial=campaign/label;trial.mkdir(mode=0o700)
        subject=trial/'subject';shutil.copytree(ROOT/'templates',subject)
        target=subject/'controller.py';original=target.read_bytes()
        originals={str(p.relative_to(subject)):{'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'mode':p.stat().st_mode&0o777} for p in subject.rglob('*') if p.is_file()}
        try:
            if mutation:
                old,new=mutation;check(baseline.count(old)==1,'mutation-anchor:'+label)
                target.write_text(baseline.replace(old,new))
            c=load(subject)
            for index,scenario in enumerate(scenarios):
                failure=None
                try:
                    if scenario.startswith('loader:'):loader_case(c,trial/str(index),scenario.split(':')[1])
                    else:run_case(c,trial/str(index),scenario)
                except (AssertionError,ValueError,TypeError,IndexError,KeyError) as error:
                    failure=type(error).__name__+':'+str(error)
                expected=None
                if label in ['guard-removed','type-removed']:expected='predecessor-drift-accepted:'+scenario
                elif label=='admission-removed':expected='unadmitted-snapshot-accepted'
                elif label=='bytes-removed':expected='changed-snapshot-bytes-accepted'
                if expected:check(named_failure(failure,expected),'wrong-map-fault:'+label+':'+scenario+':'+str(failure))
                else:check(failure is None,'unexpected-map-result:'+label+':'+scenario+':'+str(failure))
                results.append({'source':label,'scenario':scenario,'outcome':'survived' if label=='harmless' else 'named-failure' if expected else 'pass','failure':failure})
                (campaign/'partial-results.json').write_text(json.dumps(results,indent=2)+'\n')
        finally:
            target.write_bytes(original)
            restored={str(p.relative_to(subject)):{'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'mode':p.stat().st_mode&0o777} for p in subject.rglob('*') if p.is_file()}
            check(restored==originals,'exact-map-source-restoration')
            (trial/'restoration.json').write_text(json.dumps(restored,indent=2,sort_keys=True)+'\n')
    (campaign/'result.json').write_text(json.dumps({'trials':results,'sourceVariants':len(trials),'nativeParserAccepted':False,'oldCampaignRerun':False},indent=2)+'\n')
    print(json.dumps({'cases':len(results),'sourceVariants':len(trials),'native':False}))


if __name__=='__main__':main()

