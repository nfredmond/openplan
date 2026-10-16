"""Finite INERT controls of the new controller and its journal. Never invoke directly ungranted."""
from contextlib import contextmanager
from copy import deepcopy
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import sys
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path('/home/nathaniel/.local/state/openplan/project-budget-native-target-controller-20261016')
REPO = Path('/home/nathaniel/.t3/worktrees/openplan/t3-fab3cf74')
PACKET = REPO/'docs/reviews/2026-10-16-project-budget-native-target-controller'
WORK = ROOT/'working'
NATIVE = {'database':'openplan_budget_native_9c47bd610f2a49e8a35c706d','oid':900001,'pid':101,
 'sessionOid':10,'currentOid':10,'postgresOid':20,'systemIdentifier':'7683856985084612646',
 'sessionRole':'supabase_admin','currentRole':'supabase_admin','adminSuperuser':True,
 'postgresSuperuser':False,'applicationName':'budget-target-history','version':'170006'}


def check(value, name):
    if not value:
        raise AssertionError(name)


def load():
    for name in ('policy','journal','sql','controller'):
        spec = importlib.util.spec_from_file_location(name,WORK/(name+'.py'))
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module
        spec.loader.exec_module(module)
    return tuple(sys.modules[name] for name in ('policy','journal','sql','controller'))


def refused(call, reason):
    try:
        call()
    except ValueError as error:
        check(str(error)==reason,'wrong-refusal:'+reason+':'+str(error))
        return True
    return False


def fresh_physical_lines(text, body_marker):
    setting='SET standard_conforming_strings=on;'
    setting_end=text.find(setting)+len(setting)
    begin=text.find('BEGIN;')
    guard=text.find('DO $identity$')
    guard_end=text.find('END $identity$;')+len('END $identity$;')
    body=text.find(body_marker)
    check(text.count(setting)==1 and text[setting_end:].startswith('\nBEGIN;\n') and
          0<setting_end<begin<guard<guard_end<body and
          text[guard-1:guard]=='\n' and text[guard_end:guard_end+1]=='\n' and
          text[body-1:body]=='\n', 'migration-fresh-physical-lines')


class Pipe:
    def __init__(self, proc, label, fd):
        self.proc=proc; self.label=label; self.fd=fd; self.closed=False
    def fileno(self):
        return self.fd
    def close(self):
        self.closed=True


class InertIO:
    """Popen and FD readiness/read/write are inert. File journal operations are real.

    This finite responder does not implement PostgreSQL. It only recognizes the
    new entry's exact query labels and returns explicitly synthetic fixtures.
    """
    def __init__(self, responder, late=False, output=None):
        self.responder=responder; self.late=late; self.output=output
        self.clock=0.0; self.calls=[]; self.pipes={}; self.sequence=100000

    def popen(self, argv, **kw):
        check(kw['env']==sys.modules['policy'].ENV,'exact-real-transport-environment')
        process=SimpleNamespace(pid=7000+len(self.calls), argv=argv, data=b'', generated=False,
                                stdout_data=b'', stderr_data=b'', code=0)
        for label in ('stdin','stdout','stderr'):
            self.sequence+=1
            pipe=Pipe(process,label,self.sequence)
            self.pipes[self.sequence]=pipe
            setattr(process,label,pipe)
        def wait(timeout):
            if self.late:
                self.clock=99.0
            return process.code
        process.wait=wait
        self.calls.append(process)
        return process

    def write(self,fd,data):
        if fd not in self.pipes:
            return self.original_write(fd,data)
        process=self.pipes[fd].proc
        process.data+=bytes(data)
        return len(data)

    def read(self,fd,size):
        if fd not in self.pipes:
            return self.original_read(fd,size)
        pipe=self.pipes[fd]; process=pipe.proc
        if not process.generated:
            process.generated=True
            result=self.output if self.output is not None else self.responder(process.argv,process.data)
            process.stdout_data=result
        key=pipe.label+'_data'
        result=getattr(process,key)[:size]
        setattr(process,key,getattr(process,key)[size:])
        return result

    def selector(self):
        parent=self
        class Selector:
            def __init__(self): self.keys={}
            def __enter__(self): return self
            def __exit__(self,*args): return False
            def register(self,pipe,event,data):
                self.keys[pipe.fd]=SimpleNamespace(fd=pipe.fd,fileobj=pipe,data=data)
            def unregister(self,pipe): del self.keys[pipe.fd]
            def get_map(self): return self.keys
            def select(self,timeout):
                inputs=[key for key in self.keys.values() if key.data=='input']
                values=inputs or list(self.keys.values())
                return [(key,0) for key in values]
        return Selector()

    @contextmanager
    def active(self,j):
        self.original_write=os.write; self.original_read=os.read
        original_blocking=os.set_blocking
        with patch.object(j.subprocess,'Popen',self.popen), \
             patch.object(j.selectors,'DefaultSelector',self.selector), \
             patch.object(j.os,'write',self.write), patch.object(j.os,'read',self.read), \
             patch.object(j.os,'set_blocking',lambda fd,v:None if fd in self.pipes else original_blocking(fd,v)), \
             patch.object(j.time,'monotonic',lambda:self.clock):
            yield self


def fixture(p,s,c,area):
    versions=json.loads((ROOT/'plan.json').read_bytes())['versions']
    history=[{'version':v,'name':'SYNTHETIC-'+v,'statements':['SYNTHETIC SQL']} for v in versions[:421]]
    definition_base={'owner':'postgres','ownerOid':20,'language':'plpgsql','result':'jsonb',
        'definer':False,'volatility':'s','config':['search_path=pg_catalog, public, pg_temp'],
        'rawACL':None,'effectiveACL':[]}
    definitions={'public.synthetic_predecessor()':dict(definition_base,
        definition='SYNTHETIC prior definition',sha256=p.digest(b'SYNTHETIC prior definition'))}
    wanted=[]
    for role in ('anon','authenticated','service_role','postgres'):
        for table,cols in s.WANTED.items():
            for col in cols:
                wanted.append({'role':role,'relation':table,'column':col,'roleMissing':False,
                    'relationMissing':False,'attributeMissing':False,'tableSelect':role!='anon',
                    'columnSelect':role!='anon','rawTableACL':None,'rawColumnACL':None,
                    'effectiveTableACL':[],'effectiveColumnACL':[]})
    props={'database':p.TARGET,'oid':900001,'owner':'postgres','encoding':'UTF8','collate':'en_US.UTF-8',
           'ctype':'en_US.UTF-8','localeProvider':'i','icuLocale':'en-US'}
    identity={k:v for k,v in NATIVE.items() if k!='pid'}
    before={'identity':identity,'history':history,'historyDigest':'a'*32,
        'snapshot':{'public.synthetic':{'count':2,'digest':'b'*32},
                    'public.synthetic_seq':{'last_value':17,'log_cnt':3,'is_called':True},
                    '__pg_sequences__':'c'*32,
                    'supabase_migrations.schema_migrations':{'count':421,'digest':'d'*32}},
        'definitions':definitions,'wanted':wanted,'properties':props,
        'statementProof':[{'version':v,'cardinality':1,'dimensions':'[1:1]',
                           'sha256':[p.digest(b'SYNTHETIC SQL')]} for v in versions[:421]]}
    plan=deepcopy(json.loads((ROOT/'plan.json').read_bytes()))
    after=deepcopy(before)
    entry=plan['migrations']['19']
    raw=(c.MIGRATIONS/entry['filename']).read_bytes()
    after['history'].append({'version':'20261017000019','name':entry['name'],'statements':[raw.decode()]})
    definition='SYNTHETIC installed project_budget_inputs_v1 definition'
    after['definitions']['public.project_budget_inputs_v1(uuid)']=dict(definition_base,definition=definition,sha256=p.digest(definition.encode()))
    after['historyDigest']='e'*32
    after['statementProof'].append({'version':'20261017000019','cardinality':1,
                                    'dimensions':'[1:1]','sha256':[p.digest(raw)]})
    after['snapshot']['supabase_migrations.schema_migrations']={'count':422,'digest':'f'*32}
    admission={'catalogIdentity':dict(NATIVE,database='postgres',oid=5),'targetIdentity':NATIVE,
        'originalScope':{'databases':'SYNTHETIC complete protected set','roles':'SYNTHETIC digest'},
        'expectedProperties':props,'priorDefinitionPins':before['definitions'],
        'postDefinitionPins':after['definitions'],'invocation':'1'*32}
    admission['inputSHA256']=p.digest(s.migration(raw,19,entry['name'],NATIVE,'a'*32))
    previous=area/'stages/apply18'
    previous.mkdir(parents=True,mode=0o700)
    j=sys.modules['journal']
    j.record(previous/'state.json',before)
    (area/'admissions').mkdir(mode=0o700)
    j.record(area/'admissions/apply19.json',admission)
    path=area/'run'
    path.mkdir(mode=0o700)
    return plan,admission,before,after,path


def journey(modules,area,*,sequence_fault=False,proof_fault=None):
    p,j,s,c=modules
    area.mkdir(mode=0o700)
    plan,admission,before,after,path=fixture(p,s,c,area)
    controller=c.Controller('apply19',plan,admission,None,path)
    written=False
    calls=[]
    native_pids=[]
    def responder(argv,data):
        nonlocal written
        calls.append((argv,data))
        if argv[:1]==['/usr/bin/git']:
            return (p.APP+'\n').encode() if 'HEAD:openplan' in argv else b''
        if argv[:2]==['/usr/bin/docker','inspect']:
            return p.canonical({'Id':p.CONTAINER,'Image':p.IMAGE,'Name':'/supabase_db_'+p.PROJECT,
                'Project':p.PROJECT,'NetworkID':p.NETWORK_ID,'Running':True,'Paused':False,'Restarting':False})
        check(argv==p.argv('sql','postgres') or argv==p.argv('sql'),'real-entry-fixed-argv')
        text=data.decode()
        pid=8000+len(calls)
        if "'transactionID'" in text:
            spans=s.statements(text)
            tokens=[t for _,_,t in spans]
            boundary=[t.upper() for t in tokens if t.upper() in ('BEGIN;','COMMIT;')]
            check(boundary==['BEGIN;','COMMIT;'],'atomic-top-level-boundary')
            lock=text.find('LOCK TABLE supabase_migrations.schema_migrations IN EXCLUSIVE MODE;')
            history_guard=text.find('migration-history-race')
            body=text.find('CREATE FUNCTION public.project_budget_inputs_v1')
            insert=text.find('INSERT INTO supabase_migrations.schema_migrations')
            commit=text.rfind('COMMIT;')
            check(0<lock<history_guard<body<insert<commit,'locked-real-body-history-order')
            original=(c.MIGRATIONS/plan['migrations']['19']['filename']).read_text()
            check("ARRAY[pg_catalog.convert_from(pg_catalog.decode('"+original.encode().hex()+"','hex'),'UTF8')]::text[]" in text,
                  'history-retains-full-original-statements')
            check(0<=text.find('SET standard_conforming_strings=on;')<text.find('BEGIN;') and
                  "current_setting('standard_conforming_strings')<>'on'" in text,
                  'same-backend-before-parse-string-semantics')
            fresh_physical_lines(text,'CREATE FUNCTION public.project_budget_inputs_v1')
            written=True
            return p.canonical({'transactionID':'12345','pid':pid,'role':'postgres'})+p.canonical({'commitACK':True,'pid':pid,'inTransaction':False})
        if 'CREATE TEMP TABLE budget_snapshot' in text:
            check("'statementProof'" in text and "'cardinality',cardinality(h.statements)" in text and
                  "pg_catalog.sha256(pg_catalog.convert_to(u.statement,'UTF8'))" in text,
                  'actual-history-cardinality-sha-projection')
            check("''last_value'',s.last_value,''log_cnt'',s.log_cnt,''is_called'',s.is_called" in text,
                  'sequence-explicit-fields')
            check('FROM ONLY %I.%I t' in text and "'__pg_sequences__'" in text,'complete-table-sequence-census')
            row=deepcopy(after if written else before)
            if written and proof_fault=='sha':
                row['statementProof'][-1]['sha256']=['0'*64]
            if written and proof_fault=='cardinality':
                row['statementProof'][-1]['cardinality']=2
            if written and sequence_fault:
                row['snapshot']['public.synthetic_seq']['is_called']=False
            row['identity']['pid']=pid
            return p.canonical(row)
        if "'globalSettings'" in text:
            return p.canonical(admission['originalScope'])
        if "'localeProvider'" in text:
            return p.canonical(before['properties'])
        if "'sessionOid'" in text:
            row=dict(NATIVE,pid=pid)
            if argv==p.argv('sql','postgres'):
                row.update(database='postgres',oid=5)
            native_pids.append(pid)
            return p.canonical(row)
        raise AssertionError('unrecognized-fake-request')
    # Source and runtime bytes remain real and sealed. Only private ROOT and the
    # process/pipe boundary are rebound for this explicitly inert journey.
    saved=c.ROOT
    saved_packet=c.PACKET
    c.ROOT=area
    # A mutant is intentionally sealed as a NEW INERT-only subject, so the
    # selected behavioral oracle is reached rather than a generic pin failure.
    # Protected/public source pins never change and these case seals admit no DB.
    case_packet=area/'packet'; (case_packet/'runtime').mkdir(parents=True,mode=0o700)
    pins=json.loads((PACKET/'source-pins.json').read_bytes())
    for source in WORK.glob('*.py'):
        raw=source.read_bytes()
        (case_packet/'runtime'/source.name).write_bytes(raw)
        pins['runtime']['runtime/'+source.name]['sha256']=p.digest(raw)
        pins['runtime']['runtime/'+source.name]['bytes']=len(raw)
    (case_packet/'plan.json').write_bytes((ROOT/'plan.json').read_bytes())
    (area/'plan.json').write_bytes((ROOT/'plan.json').read_bytes())
    (case_packet/'source-pins.json').write_text(json.dumps(pins))
    c.PACKET=case_packet
    try:
        with InertIO(responder).active(j):
            if sequence_fault:
                check(refused(controller.run,'upgrade-existing-data-sequences'),
                      'upgrade-preserves-explicit-sequence-state')
                return
            if proof_fault:
                check(refused(controller.run,'independent-history-statement-cardinality-sha'),
                      'actual-statement-'+proof_fault+'-rejected')
                return
            controller.run()
    finally:
        c.ROOT=saved
        c.PACKET=saved_packet
    state=j.read(path/'state.json')
    check(state['history']==after['history'],'complete-native-shaped-history-readback')
    check(state['snapshot']==after['snapshot'],'complete-native-shaped-snapshot-readback')
    check((path/'commit-ack.json').exists(),'separate-commit-ack-custody')
    check(len(list(path.glob('request-*/terminal.json')))==len(calls),'all-fake-requests-terminal-custody')
    return {'requests':len(calls),'nativePIDs':native_pids,'commitACK':True}


def checks(modules,area,selected=None):
    p,j,s,c=modules
    area.mkdir(mode=0o700)
    result={}
    def run(name,fn):
        if selected is None or selected==name:
            fn(); result[name]='pass'
    def wrong_oid():
        check(refused(lambda:p.native(dict(NATIVE,oid=900002),NATIVE,p.TARGET),'native-pin-oid'),'wrong-oid-rejected')
    run('wrong-oid',wrong_oid)
    def bool_oid():
        expected={k:v for k,v in NATIVE.items() if k!='oid'}
        check(refused(lambda:p.native(dict(NATIVE,oid=True),expected,p.TARGET),'native-positive-oid'),'boolean-oid-rejected')
    run('boolean-oid',bool_oid)
    def missing_history():
        check(refused(lambda:p.history([{'version':'v','name':'n'}],['v']),'history-complete-fields'),'missing-history-fields-rejected')
    run('missing-history',missing_history)
    def no_replay():
        target=j.begin(area,'once',{'x':1})
        try:
            j.begin(area,'once',{'x':1})
        except FileExistsError:
            return
        raise AssertionError('stage-replay-rejected')
    run('no-replay',no_replay)
    def clobber():
        target=area/'clobber.bin'; j.write(target,b'original')
        try:
            j.write(target,b'changed')
        except FileExistsError:
            check(target.read_bytes()==b'original','existing-bytes-preserved'); return
        raise AssertionError('exclusive-clobber-rejected')
    run('clobber',clobber)
    def custody():
        calls=[]; real=os.fsync
        def fsync(fd):
            calls.append('directory' if stat.S_ISDIR(os.fstat(fd).st_mode) else 'file')
            return real(fd)
        with patch.object(j.os,'fsync',fsync): j.write(area/'durable.bin',b'input')
        check(calls==['file','directory'],'durable-file-and-directory')
    run('custody',custody)
    def late():
        transport=j.Transport(area)
        with InertIO(lambda a,d:b'{}',late=True).active(j):
            check(refused(lambda:transport.run(p.argv('sql'),b'SYNTHETIC',timeout=1),'transport-late-terminal'),'late-ack-rejected')
    run('late-ack',late)
    def output_bound():
        target=area/'bound'; target.mkdir(mode=0o700)
        with InertIO(lambda a,d:b'x'*33).active(j):
            check(refused(lambda:j.Transport(target).run(p.argv('sql'),limit=32),'transport-output-bound'),'overbound-output-rejected')
        check((target/'request-001/stdout.bin').stat().st_size==32,'retained-output-bounded')
    run('output-bound',output_bound)
    def missing_definition():
        value={'definition':'SYNTHETIC','sha256':'b'*64,'owner':'postgres','ownerOid':20,
               'language':'plpgsql','result':'jsonb','definer':False,'volatility':'s',
               'config':[],'rawACL':None,'effectiveACL':[]}
        obj=c.Controller('apply19',{}, {'postDefinitionPins':{'required':value}},None,area)
        check(refused(lambda:obj.definitions({'other':value},'postDefinitionPins'),'definition-complete-set'),'missing-definition-rejected')
    run('missing-definition',missing_definition)
    def wanted_missing():
        obj=c.Controller('apply19',{}, {},None,area)
        check(refused(lambda:obj.validate_wanted([]),'wanted-count'),'missing-wanted-attribute-rejected')
    run('wanted-missing',wanted_missing)
    def restore():
        raw=b'-- SYNTHETIC pg_restore output\n\\restrict ABC123\nBEGIN;\nSET statement_timeout = 0;\nCOPY public.synthetic (id) FROM stdin;\n1\n\\.\nCOMMIT;\n\\unrestrict ABC123\n'
        value=s.restore(raw,NATIVE).decode()
        check('native-same-backend-identity' in value and 'restore-empty-guard' in value,'restore-same-backend-empty-guard')
        check("SET LOCAL statement_timeout='60s';" in value and 'SET statement_timeout = 0;' not in value,'restore-retains-timeout-bound')
        check(value.count('BEGIN;')==1 and value.count('COMMIT;')==1,'restore-one-real-transaction')
        check('COPY public.synthetic (id) FROM stdin;\n1\n\\.' in value,'restore-preserves-copy-data')
        check(refused(lambda:s.restore(raw.replace(b'COMMIT;',b'COMMIT;\nCOMMIT;'),NATIVE),'sql-outer-atomicity'),'restore-extra-commit-rejected')
    run('restore-composition',restore)
    def migration():
        raw=(c.MIGRATIONS/'20261017000019_project_budget_complete_inputs.sql').read_bytes()
        value=s.migration(raw,19,'project_budget_complete_inputs',NATIVE,'a'*32).decode()
        tokens=[t.upper() for _,_,t in s.statements(value)]
        boundary=[t for t in tokens if t in ('BEGIN;','COMMIT;')]
        check(boundary==['BEGIN;','COMMIT;'],'atomic-top-level-boundary')
        check("ARRAY[pg_catalog.convert_from(pg_catalog.decode('"+raw.hex()+"','hex'),'UTF8')]::text[]" in value,
              'history-retains-full-original-statements')
    run('migration-atomicity',migration)
    def history_hex():
        raw=(c.MIGRATIONS/'20261017000017_portfolio_skip_invalid_classifications.sql').read_bytes()
        check(b'\\s+' in raw and b'\\.' in raw,'sql17-real-backslash-input')
        value=s.migration(raw,17,'portfolio_skip_invalid_classifications',NATIVE,'a'*32).decode()
        match=re.search(r"ARRAY\[pg_catalog.convert_from\(pg_catalog.decode\('([0-9a-f]+)','hex'\),'UTF8'\)\]::text\[\]",value)
        check(match is not None,'history-setting-independent-hex')
        encoded=match.group(1)
        # Deliberately finite supplied string-setting model, not PG parsing.
        # ASCII hex has neither backslash nor quote in either supplied mode.
        for setting in ('on','off'):
            check(all(c in '0123456789abcdef' for c in encoded),'history-hex-alphabet-'+setting)
            check(bytes.fromhex(encoded)==raw,'history-hex-exact-source-'+setting)
        check(0<=value.find('SET standard_conforming_strings=on;')<value.find('BEGIN;') and
              "current_setting('standard_conforming_strings')<>'on'" in value,
              'same-backend-before-parse-string-semantics')
        fresh_physical_lines(value,'ALTER TABLE public.project_portfolio_import_rows')
    run('history-hex',history_hex)
    if selected is None or selected in ('journey','sequence-change'):
        result['journey' if selected!='sequence-change' else selected]=journey(modules,area/'journey',sequence_fault=selected=='sequence-change')
    for kind in ('sha','cardinality'):
        if selected is None or selected=='statement-'+kind:
            journey(modules,area/('statement-'+kind),proof_fault=kind)
            result['statement-'+kind]='pass'
    return result


MUTATIONS = [
 ('policy.py','if key in expected:', 'if False:', 'wrong-oid','wrong-oid-rejected'),
 ('policy.py','type(value) is int and value > 0','isinstance(value,int) and value > 0','boolean-oid','boolean-oid-rejected'),
 ('policy.py',"same(['name', 'statements', 'version'], sorted(row), 'history-complete-fields')","pass # selected missing-field fault",'missing-history','missing-history-fields-rejected'),
 ('journal.py','path = parent/name',"path = parent/(name+str(time.time_ns()))",'no-replay','stage-replay-rejected'),
 ('journal.py','os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW','os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW','clobber','exclusive-clobber-rejected'),
 ('journal.py','os.fsync(stream.fileno())','pass # selected file sync omission','custody','durable-file-and-directory'),
 ('journal.py','sync(path.parent)','pass # selected directory sync omission','custody','durable-file-and-directory'),
 ('journal.py',"p.require(time.monotonic()-start < timeout, 'transport-late-terminal')","pass # selected late acknowledgement fault",'late-ack','late-ack-rejected'),
 ('journal.py',"p.require(counts[key.data] <= bound, 'transport-output-bound')","pass # selected output overflow fault",'output-bound','overbound-output-rejected'),
 ('controller.py',"pins = self.a.get(field)","pins = row",'missing-definition','missing-definition-rejected'),
 ('controller.py',"p.same(len(expected), len(actual), 'wanted-count')","return # selected wanted-set omission",'wanted-missing','missing-wanted-attribute-rejected'),
 ('sql.py',"payload = body(raw, outer=number == 19)","payload = raw",'migration-atomicity','atomic-top-level-boundary'),
 ('sql.py',"''last_value'',s.last_value,''log_cnt'',s.log_cnt,''is_called'',s.is_called","''last_value'',s.last_value",'journey','sequence-explicit-fields'),
 ('sql.py','LOCK TABLE supabase_migrations.schema_migrations IN EXCLUSIVE MODE;', '-- omitted history lock','journey','locked-real-body-history-order'),
 ('controller.py',"for field in ('snapshot',):","for field in ():",'sequence-change','upgrade-preserves-explicit-sequence-state'),
 ('sql.py',"+guard(identity)+EMPTY_GUARD+", "+guard(identity)+' '+",'restore-composition','restore-same-backend-empty-guard'),
 ('sql.py',"encoded = \"pg_catalog.convert_from(pg_catalog.decode('\"+raw.hex()+\"','hex'),'UTF8')\"",
             "encoded = literal(raw.decode('utf8'))",'history-hex','history-setting-independent-hex'),
 ('sql.py',"        \"current_setting('standard_conforming_strings')<>'on'\",\n",'',
             'history-hex','same-backend-before-parse-string-semantics'),
 ('controller.py',"p.same(proof,after['statementProof'],'independent-history-statement-cardinality-sha')",
             'pass # selected actual statement SHA omission','statement-sha','actual-statement-sha-rejected'),
 ('controller.py',"p.same(proof,after['statementProof'],'independent-history-statement-cardinality-sha')",
             'pass # selected actual statement cardinality omission','statement-cardinality','actual-statement-cardinality-rejected'),
 ('sql.py',"return (\"SET application_name='budget-target-history'; SET standard_conforming_strings=on;\\n\"+text).encode()",
             "return (\"SET application_name='budget-target-history';\\n\"+text).encode()",
             'history-hex','same-backend-before-parse-string-semantics'),
 ('sql.py','cardinality(h.statements)','1','journey','actual-history-cardinality-sha-projection'),
 ('sql.py',"pg_catalog.sha256(pg_catalog.convert_to(u.statement,'UTF8'))",
             "pg_catalog.sha256(pg_catalog.convert_to('SYNTHETIC','UTF8'))",'journey','actual-history-cardinality-sha-projection'),
 ('sql.py',"return (\"SET application_name='budget-target-history'; SET standard_conforming_strings=on;\\n\"+text).encode()",
             "return (\"SET application_name='budget-target-history'; SET standard_conforming_strings=on; \"+text).encode()",
             'history-hex','migration-fresh-physical-lines'),
]


def main():
    os.umask(0o077)
    working_before={x.name:x.read_bytes() for x in WORK.glob('*.py')}
    source_before={str(x):x.read_bytes() for x in (PACKET/'runtime').glob('*.py')}
    result={'scope':'INERT process and FD responder; no shell/native/SQL/manager/helper dispatch',
            'baseline':None,'trials':[],'restored':False,'sourceUnchanged':False}
    trials=ROOT/'trials'; trials.mkdir(mode=0o700)
    try:
        result['baseline']=checks(load(),trials/'baseline')
        # The harmless mutation must survive before any named broken behavior.
        path=WORK/'controller.py'
        path.write_bytes(working_before[path.name]+b'\n# harmless source comment\n')
        checks(load(),trials/'harmless')
        result['trials'].append({'mutation':'harmless-comment','outcome':'SURVIVED'})
        path.write_bytes(working_before[path.name])
        for index,(filename,old,new,selected,expected) in enumerate(MUTATIONS):
            target=WORK/filename; original=working_before[filename]
            check(original.count(old.encode())==1,'mutation-unique-anchor:'+str(index))
            target.write_bytes(original.replace(old.encode(),new.encode(),1))
            try:
                checks(load(),trials/('fault-'+str(index)),selected)
            except AssertionError as error:
                check(str(error)==expected,'mutation-wrong-assertion:'+str(index)+':'+str(error))
                result['trials'].append({'mutation':index,'file':filename,'outcome':'KILLED','assertion':str(error)})
            else:
                raise AssertionError('mutation-survived:'+str(index))
            finally:
                target.write_bytes(original)
                check(target.read_bytes()==original,'mutation-finally-restoration:'+str(index))
        checks(load(),trials/'restored')
    finally:
        for filename,raw in working_before.items():
            (WORK/filename).write_bytes(raw)
        result['restored']=all((WORK/k).read_bytes()==v for k,v in working_before.items())
        result['sourceUnchanged']=all(Path(k).read_bytes()==v for k,v in source_before.items())
        (ROOT/'controls.json').write_text(json.dumps(result,indent=2)+'\n')
    check(result['restored'] and result['sourceUnchanged'],'outer-finally-source-restoration')
    # Sourcecompare the actual real-entry composition, not a mock of Controller.
    import ast
    tree=ast.parse((PACKET/'runtime/controller.py').read_text())
    check(any(isinstance(node,ast.Call) and isinstance(node.func,ast.Attribute) and node.func.attr=='run'
              and isinstance(node.func.value,ast.Call) and isinstance(node.func.value.func,ast.Name)
              and node.func.value.func.id=='Controller' for node in ast.walk(tree)), 'real-entry-controller-call')


if __name__=='__main__':
    main()
