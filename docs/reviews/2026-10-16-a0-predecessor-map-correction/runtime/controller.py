#!/usr/bin/python3
"""Parent-admitted, single-stage native proof controller. Preparation imports safely.

No admission files ship. Every external request is exclusive and durable. Unknown
dispatch outcomes are fences, not prompts to retry. There is no cleanup stage.
"""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import time

import cases
import fixture as f
import journal as j
import policy as p
import literal_history as lh

HERE = Path(__file__).resolve().parent
ROOT = Path('/home/nathaniel/.local/state/openplan/a0-predecessor-map-correction-20261016')
EXTERNAL = Path('/home/nathaniel/.local/state/openplan/a0-usage-limit-native-wrapper-20261016-r6')
BINDINGS = ROOT/'bindings'
REPO = Path('/home/nathaniel/.t3/worktrees/openplan/t3-ac91cc52')
LOCK = Path('/home/nathaniel/.local/state/openplan/compiler-repair-checks-20261015.lock')
DUMP = Path('/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/project-geography-preview-final-20261015/source-private.dump')
DUMP_SHA = '181caa01d5ebe66b50da9dcba1242b225e75cfdc8bd0fe03e3c4a9ae86e4d398'
PREFIX = ['/usr/bin/docker','exec','-i',p.CONTAINER]
BASE_STAGES = ['observe','allocate','restore419','apply17','apply18','fixture']
RACES = [kind+'-'+order for kind in ['cancel','revoke','membership','project'] for order in ['finish-first','change-first']]
STAGES = ['apply17']  # No new observe, allocation, restore, SQL18 or fixture admission.
SQL18 = 'openplan/supabase/migrations/20261017000018_assistant_usage_limit_receipts.sql'
SQL17 = 'openplan/supabase/migrations/20261017000017_portfolio_skip_invalid_classifications.sql'
BOUNDS = "SET LOCAL statement_timeout='15s'; SET LOCAL lock_timeout='3s'; SET LOCAL idle_in_transaction_session_timeout='20s'; SET LOCAL work_mem='16MB';"


def read(path):
    return json.loads(Path(path).read_text())


def private(path, directory=False):
    info = path.lstat()
    p.private({'symlink':path.is_symlink(),'mode':info.st_mode&0o777,'owned':info.st_uid==os.getuid()},directory)
    p.require(path.is_dir() if directory else path.is_file(), 'private-kind')


def sources():
    pins = read(BINDINGS/'source-pins.json')
    for name, expected in pins['files'].items():
        path = REPO/name
        p.require(not path.is_symlink(), 'source-symlink')
        p.same(expected, j.sha(path), 'source-pin:'+name)
    for name, expected in read(BINDINGS/'preceding-helper-pins.json').items():
        path=Path(name)
        p.require(path.is_file() and not path.is_symlink(),'preceding-helper-regular')
        p.same(expected['bytes'],path.stat().st_size,'preceding-helper-bytes')
        p.same(expected['sha256'],j.sha(path),'preceding-helper-sha')
    package = read(BINDINGS/'package-pins.json')
    for name, expected in package['files'].items():
        path = HERE/name
        p.require(not path.is_symlink(), 'package-symlink')
        p.same(expected, j.sha(path), 'package-pin:'+name)
    for name, expected in package['bindings'].items():
        path=BINDINGS/name
        p.require(not path.is_symlink(), 'binding-symlink')
        p.same(expected,j.sha(path),'binding-pin:'+name)
    for name, expected in read(BINDINGS/'review-pins.json').items():
        path=Path(name)
        p.require(path.is_file() and not path.is_symlink(),'review-regular')
        p.same(expected['sha256'],j.sha(path),'review-pin')
    return j.sha(BINDINGS/'package-pins.json')



SNAPSHOT_PIN = {'sha256':'936054d47550fa7003177ddbf877fb1fd1b3c529e10536637bfbb1d85118d3db','bytes':41476}


def typed_equal(expected, actual):
    """Compare the complete retained JSON map without bool/int coercion."""
    if type(expected) is not type(actual): return False
    if type(expected) is dict:
        return expected.keys() == actual.keys() and all(typed_equal(expected[key],actual[key]) for key in expected)
    if type(expected) is list:
        return len(expected) == len(actual) and all(typed_equal(a,b) for a,b in zip(expected,actual))
    return expected == actual


def retained_snapshot():
    """Read only the allowlisted, original external R6 restore snapshot bytes."""
    path=EXTERNAL/'stages/restore419/snapshot.json'
    descriptor=read(BINDINGS/'external-predecessor.json')['files'].get(str(path))
    selected={key:descriptor.get(key) for key in SNAPSHOT_PIN} if type(descriptor) is dict else None
    p.same(SNAPSHOT_PIN,selected,'retained-snapshot-admitted-pin')
    private(path)
    raw=path.read_bytes()
    p.same(SNAPSHOT_PIN,{'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw)},'retained-snapshot-bytes')
    return json.loads(raw)


def predecessor(stage):
    if stage == 'observe':
        return None
    if stage in BASE_STAGES:
        return BASE_STAGES[BASE_STAGES.index(stage)-1]
    return 'fixture'


def ready(stage):
    p.require(stage in STAGES, 'stage-name')
    private(ROOT,True)
    private(ROOT/'plan.json')
    plan = read(ROOT/'plan.json')
    p.target(plan['database'],plan['protected'])
    seal = sources()
    binding = read(BINDINGS/'external-predecessor.json')
    p.same(str(EXTERNAL),binding['root'],'external-root')
    p.same('actual-r6-restore419',binding['kind'],'external-kind')
    p.same('restore419',binding['stage'],'external-stage')
    p.same('fc590a9ed0285dbfcb3de75137ffc627efbe4398446995eddfa58407475cca0f',binding['completeSHA256'],'external-complete-pin')
    p.same('openplan_a0_limit_c730358675ac8bb47ac15fdd',plan['database'],'continued-target-name')
    p.same(6227945,binding['target']['oid'],'continued-target-oid')
    p.same('7683856985084612646',binding['target']['systemIdentifier'],'continued-target-system')
    for name, expected in binding['files'].items():
        path = Path(name)
        p.require(path.is_file() and not path.is_symlink(),'external-regular')
        p.same(expected['sha256'],j.sha(path),'external-file-pin:'+name)
        info=path.lstat()
        p.same(expected['bytes'],info.st_size,'external-bytes')
        p.same(expected['mode'],info.st_mode & 0o777,'external-mode')
        p.same(expected['uid'],info.st_uid,'external-uid')
        p.same(expected['gid'],info.st_gid,'external-gid')
    p.same('fc590a9ed0285dbfcb3de75137ffc627efbe4398446995eddfa58407475cca0f',j.sha(EXTERNAL/'stages/restore419/complete.json'),'external-complete')
    p.predecessor(read(EXTERNAL/'stages/restore419/complete.json'),'restore419')
    p.same({'stage':'restore419','status':'terminal'},read(EXTERNAL/'stages/restore419/manager-terminal.json'),'external-manager')
    p.same(binding['target'],read(EXTERNAL/'stages/allocate/target.json'),'external-target')
    p.same(j.sha(ROOT/'plan.json'),j.sha(EXTERNAL/'plan.json'),'external-plan-equality')
    for name in ['stages/apply17','admissions/apply17.json']:
        p.require(not os.path.lexists(EXTERNAL/name),'external-already-continued')
    predecessor_sha = binding['completeSHA256']
    admission_path = ROOT/'admissions'/(stage+'.json')
    p.require(admission_path.is_file(), 'MISSING_ROOT_ADMISSION:'+stage)
    private(ROOT/'admissions', True)
    private(admission_path)
    admission = read(admission_path)
    p.admission(admission,stage,seal,j.sha(ROOT/'plan.json'),predecessor_sha)
    p.same(binding,admission.get('continuedPredecessor'),'admission-external-predecessor')
    p.same(read(BINDINGS/'prior-function-pins.json'),admission.get('priorFunctionPins'),'admission-prior-function-pins')
    return plan, admission


def cgroup():
    relative = next(line.split(':',2)[2] for line in Path('/proc/self/cgroup').read_text().splitlines() if line.startswith('0::'))
    root = Path('/sys/fs/cgroup')/relative.lstrip('/')
    def number(name):
        raw=(root/name).read_text().strip()
        return int(raw) if raw.isdigit() else raw
    p.resource({'memoryMax':number('memory.max'),'swapMax':number('memory.swap.max'),
                'cpuMax':(root/'cpu.max').read_text().strip()})


def launch(stage):
    # Missing admission refuses before any manager, Docker or SQL request.
    plan, admission = ready(stage)
    stages = ROOT/'stages'
    if not stages.exists():
        stages.mkdir(mode=0o700); j.sync(ROOT)
    private(stages, True)
    path = j.begin(stages,stage,{'stage':stage,'admissionSHA256':j.sha(ROOT/'admissions'/(stage+'.json')),
        'packageSHA256':j.sha(BINDINGS/'package-pins.json'),'planSHA256':j.sha(ROOT/'plan.json')})
    manager=j.begin(path,'manager',{'stage':stage,'kind':'manager request namespace; no child completion implied'})
    transport = j.Transport(manager)
    argv = ['/usr/bin/systemd-run','--user','--wait','--pipe','--unit=openplan-a0-map-'+stage.lower(),
        '-p','MemoryMax=1G','-p','MemorySwapMax=0','-p','CPUQuota=50%','-p','UMask=0077','-p','RuntimeMaxSec=450','-p','TasksMax=64',
        '/usr/bin/python3','-B',str(HERE/'controller.py'),'--run',stage]
    transport.run(argv,timeout=480,manager=True)
    p.predecessor(read(path/'complete.json'),stage)
    j.record(path/'manager-terminal.json',{'status':'terminal','stage':stage})
    print('Owned stage terminal receipt retained. No next stage starts.')


class Controller:
    def __init__(self, stage, plan, admission):
        self.stage=stage; self.plan=plan; self.admission=admission
        self.path=ROOT/'stages'/stage
        self.t=j.Transport(self.path/'controller')
        self.db=plan['database']; self.observation=None
        if stage != 'observe':
            self.observation=read(EXTERNAL/'stages/observe/observed.json')
        self.target=None
        if stage not in ['observe','allocate']:
            self.target=read(EXTERNAL/'stages/allocate/target.json')

    def inspect(self):
        # Go template projects whitelisted fields only, never Config.Env.
        template='{"Id":{{json .Id}},"Image":{{json .Image}},"Name":{{json .Name}},"Project":{{json (index .Config.Labels "com.supabase.cli.project")}},"NetworkID":{{json (index .NetworkSettings.Networks "'+p.NETWORK+'" ).NetworkID}},"Running":{{json .State.Running}},"Paused":{{json .State.Paused}},"Restarting":{{json .State.Restarting}},"Ports":{{json .NetworkSettings.Ports}}}'
        value=json.loads(self.t.run(['/usr/bin/docker','inspect','--format',template,p.CONTAINER]))
        p.container(value)
        if self.observation:
            p.same(self.observation['container'],value,'container-original-custody')
        return value

    def argv(self,database):
        argv=PREFIX+['psql','-XqAt','-h','/var/run/postgresql','-p','5432','-w','-U','supabase_admin','-d',database,'-v','ON_ERROR_STOP=1']
        if database != 'postgres':
            p.command(argv,database)
        else:
            p.same(PREFIX+['psql','-XqAt','-h','/var/run/postgresql','-p','5432','-w','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1'],argv,'catalog-command')
        return argv

    def identity_guard(self, database):
        system = self.observation['native']['systemIdentifier'] if self.observation else None
        checks=["current_database()<>"+f.literal(database),"session_user<>'supabase_admin'", "current_user<>'supabase_admin'"]
        if system:
            checks.append('(SELECT system_identifier::pg_catalog.text FROM pg_control_system())<>'+f.literal(system))
        if self.target and database==self.db:
            checks.append('(SELECT oid FROM pg_database WHERE datname=current_database())<>'+str(self.target['oid']))
        return "SET application_name='a0-limit-wrapper'; SET statement_timeout='15s'; SET lock_timeout='3s'; SET idle_in_transaction_session_timeout='20s'; DO $identity$ BEGIN IF "+' OR '.join(checks)+" THEN RAISE EXCEPTION 'native-same-backend-identity'; END IF; END $identity$;\n"

    def sql(self, text, *, catalog=False):
        self.inspect()
        database='postgres' if catalog else self.db
        return self.t.run(self.argv(database),(self.identity_guard(database)+text).encode(),timeout=90).decode().strip()

    def native(self, catalog=False):
        value=json.loads(self.sql("SELECT json_build_object('database',current_database(),'oid',(SELECT oid::pg_catalog.int8 FROM pg_database WHERE datname=current_database()),'systemIdentifier',(SELECT system_identifier::pg_catalog.text FROM pg_control_system()),'sessionRole',session_user,'currentRole',current_user,'adminSuperuser',(SELECT rolsuper FROM pg_roles WHERE rolname=session_user),'postgresSuperuser',(SELECT rolsuper FROM pg_roles WHERE rolname='postgres'),'serviceBypassRLS',(SELECT rolbypassrls FROM pg_roles WHERE rolname='service_role'),'pid',pg_backend_pid(),'applicationName',current_setting('application_name'));",catalog=catalog))
        p.native(value,'postgres' if catalog else self.db,
                 self.observation['native']['systemIdentifier'] if self.observation else None,
                 self.target['oid'] if self.target and not catalog else None)
        return value

    def original_scope(self):
        value=json.loads(self.sql("SELECT json_build_object('databases',(SELECT json_agg(json_build_object('name',datname,'oid',oid,'owner',datdba,'acl',datacl,'config',(SELECT json_agg(to_jsonb(s)) FROM pg_db_role_setting s WHERE s.setdatabase=d.oid)) ORDER BY datname) FROM pg_database d WHERE datname<>"+f.literal(self.db)+"),'roles',(SELECT md5(string_agg(md5(to_jsonb(r)::pg_catalog.text),'' ORDER BY oid)) FROM pg_authid r),'memberships',(SELECT md5(coalesce(string_agg(md5(to_jsonb(m)::pg_catalog.text),'' ORDER BY roleid,member,grantor),'')) FROM pg_auth_members m),'globalSettings',(SELECT md5(coalesce(string_agg(md5(to_jsonb(s)::pg_catalog.text),'' ORDER BY setrole),'')) FROM pg_db_role_setting s WHERE setdatabase=0));",catalog=True))
        if self.observation:
            p.unchanged(self.observation['originalScope'],value)
        return value

    def history(self):
        value=json.loads(self.sql("SELECT json_build_object('versions',json_agg(version ORDER BY version),'count',count(*),'latest',max(version),'digest',md5(coalesce(string_agg(md5(to_jsonb(h)::pg_catalog.text),'' ORDER BY md5(to_jsonb(h)::pg_catalog.text)),''))) FROM supabase_migrations.schema_migrations h;"))
        return value

    def definitions(self):
        names=[p.FINISH,p.VALIDATOR]
        # Include actual definitions, owners, full proconfig and expanded ACL.
        text="SELECT json_object_agg(oid::pg_catalog.regprocedure::pg_catalog.text,json_build_object('sha256',encode(extensions.digest(convert_to(pg_get_functiondef(oid),'UTF8'),'sha256'),'hex'),'definition',pg_get_functiondef(oid),'owner',pg_get_userbyid(proowner),'definer',prosecdef,'volatility',provolatile,'config',proconfig,'acl',(SELECT json_agg(json_build_object('grantor',grantor,'grantee',grantee,'privilege',privilege_type,'grantable',is_grantable) ORDER BY grantor,grantee,privilege_type) FROM aclexplode(coalesce(proacl,acldefault('f',proowner)))))) FROM pg_proc WHERE oid IN ("+','.join('to_regprocedure('+f.literal(x)+')' for x in names)+");"
        return json.loads(self.sql(text))

    def snapshot(self):
        # Hash all restored ordinary tables and sequences. No row bodies leave PG.
        text="""BEGIN ISOLATION LEVEL REPEATABLE READ;
CREATE TEMP TABLE a0_snapshot(label pg_catalog.text, value pg_catalog.jsonb) ON COMMIT DROP;
DO $snapshot$ DECLARE t pg_catalog.record; value pg_catalog.jsonb; BEGIN
 FOR t IN SELECT n.nspname,c.relname,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p','S') AND n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' LOOP
  IF t.relkind='S' THEN EXECUTE format('SELECT pg_catalog.jsonb_build_object(''last_value'',s.last_value,''log_cnt'',s.log_cnt,''is_called'',s.is_called) FROM %I.%I s',t.nspname,t.relname) INTO value;
  ELSE EXECUTE format('SELECT jsonb_build_object(''count'',count(*),''digest'',md5(coalesce(string_agg(md5(to_jsonb(t)::pg_catalog.text),'''' ORDER BY md5(to_jsonb(t)::pg_catalog.text)),''''))) FROM ONLY %I.%I t',t.nspname,t.relname) INTO value; END IF;
  INSERT INTO pg_temp.a0_snapshot VALUES(t.nspname||'.'||t.relname,value);
 END LOOP; END $snapshot$;
INSERT INTO pg_temp.a0_snapshot SELECT '__pg_sequences__',to_jsonb(md5(coalesce(string_agg(md5(to_jsonb(t)::pg_catalog.text),'' ORDER BY md5(to_jsonb(t)::pg_catalog.text)),''))) FROM pg_sequences t;
SELECT json_object_agg(label,value ORDER BY label) FROM pg_temp.a0_snapshot;
ROLLBACK;"""
        return json.loads(self.sql(text))

    def observed(self):
        value={'container':self.inspect(),'native':self.native(catalog=True),'originalScope':self.original_scope()}
        # Native role identity, not an env file or caller claim. Initial system ID
        # is returned for root to review and bind before allocation admission.
        j.record(self.path/'observed.json',value)
        return value

    def allocate(self):
        self.native(catalog=True); self.original_scope()
        names=json.loads(self.sql('SELECT json_agg(datname) FROM pg_database;',catalog=True))
        p.require(self.db not in names,'allocation-existing-database')
        p.same(self.observation['native']['systemIdentifier'],self.admission.get('systemIdentifier'),'allocation-admitted-system')
        p.same(j.sha(ROOT/'stages/observe/observed.json'),self.admission.get('observedSHA256'),'allocation-admitted-observation')
        argv=PREFIX+['createdb','-h','/var/run/postgresql','-p','5432','-w','-U','supabase_admin','-T','template0','--owner','postgres','--encoding','UTF8','--lc-collate','en_US.UTF-8','--lc-ctype','en_US.UTF-8','--locale-provider','icu','--icu-locale','en-US',self.db]
        p.command(argv,self.db,allocating=True)
        self.inspect(); self.t.run(argv)
        identity=self.native()
        j.record(self.path/'target.json',identity)
        self.original_scope()

    def restore(self):
        self.native(); self.original_scope()
        p.require(DUMP.is_file() and not DUMP.is_symlink(),'dump-regular')
        p.same(16232305,DUMP.stat().st_size,'dump-bytes'); p.same(DUMP_SHA,j.sha(DUMP),'dump-sha')
        p.same([],json.loads(self.sql("SELECT coalesce(json_agg(nspname),'[]') FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname NOT IN ('public','information_schema');")),'restore-empty-schema')
        p.same(0,json.loads(self.sql("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema';")),'restore-empty-objects')
        argv=PREFIX+['pg_restore','-h','/var/run/postgresql','-p','5432','-w','-U','supabase_admin','-d',self.db,'--jobs=1','--exit-on-error','--single-transaction']
        p.command(argv,self.db); self.inspect()
        j.record(self.path/'dump-binding.json',{'path':str(DUMP),'sha256':DUMP_SHA,'bytes':16232305})
        self.t.run(argv,input_file=DUMP,timeout=300)
        p.same(DUMP_SHA,j.sha(DUMP),'dump-sha-after')
        h=self.history(); p.history(h,self.plan['sourceVersions'])
        p.same(self.plan['sourceHistory']['digest'],h['digest'],'restore419-history-bytes')
        snapshot=self.snapshot()
        expected={x['table']:{'count':x['count'],'digest':x['digest']} for x in self.plan['sourceTableDigests'] if 'table' in x}
        p.same(expected,{k:v for k,v in snapshot.items() if isinstance(v,dict) and set(v)=={'count','digest'}},'restore419-table-custody')
        sequence_pin=next(x['sequences'] for x in self.plan['sourceTableDigests'] if 'sequences' in x)
        p.same(sequence_pin,snapshot['__pg_sequences__'],'restore419-sequence-custody')
        j.record(self.path/'history.json',h); j.record(self.path/'snapshot.json',snapshot)
        j.record(self.path/'definitions.json',self.definitions())
        self.original_scope()

    def apply(self, number):
        p.same(17,number,'continuation-only17')
        self.native(); self.original_scope()
        expected=self.plan['sourceVersions']
        h=self.history(); p.history(h,expected)
        p.installed(self.definitions(),self.admission['priorFunctionPins'])
        p.same(read(EXTERNAL/'stages/restore419/history.json')['digest'],h['digest'],'migration-prior-history')
        raw=lh.source_bytes(REPO/SQL17)
        before=self.snapshot()
        p.require(typed_equal(retained_snapshot(),before),'retained-predecessor-map')
        j.record(self.path/'predecessor-map.json',{'retainedSnapshotSHA256':SNAPSHOT_PIN['sha256'],'snapshot':before})
        lh.execute(self,raw,h['digest'],BOUNDS)
        # A fresh connection reads the committed row, independently of the send.
        exact=json.loads(self.sql(lh.readback_sql()))
        lh.exact_history(exact,raw,h['digest'])
        j.record(self.path/'exact-history.json',exact)
        after_h=self.history(); p.history(after_h,expected+[lh.VERSION])
        after=self.snapshot()
        p.unchanged({k:v for k,v in before.items() if k!='supabase_migrations.schema_migrations'}, {k:v for k,v in after.items() if k!='supabase_migrations.schema_migrations'})
        j.record(self.path/'history.json',after_h)
        definitions=self.definitions()
        p.installed(definitions,self.admission['priorFunctionPins'])
        j.record(self.path/'definitions.json',definitions)
        self.original_scope()

    def installed(self):
        actual=self.definitions()
        expected=self.admission.get('functionPins')
        p.require(type(expected) is dict and len(expected)==2,'MISSING_REVIEWED_INSTALLED_FUNCTION_PINS')
        p.installed(actual,expected)
        return actual

    def seed(self):
        self.native(); self.original_scope(); self.installed()
        before=self.snapshot()
        self.sql('BEGIN; '+BOUNDS+' SET LOCAL ROLE postgres;\n'+f.seed(self.plan)+'\nCOMMIT;')
        j.record(self.path/'before.json',before)
        j.record(self.path/'snapshot.json',self.snapshot())
        j.record(self.path/'fixture-custody.json',{'fixture':self.plan['fixture'],'tokenHashSHA256':hashlib.sha256(self.plan['tokenHash'].encode()).hexdigest()})
        self.original_scope()

    def case(self, name, mutation=None):
        self.native(); self.original_scope()
        definitions=self.installed(); before=self.snapshot()
        mutation_sql=cases.mutation_sql(mutation,(REPO/SQL18).read_text()) if mutation else ''
        text='BEGIN; '+BOUNDS+" SELECT txid_current() IS NOT NULL; SELECT json_build_object('caseBackend',pg_backend_pid());\n"
        if mutation_sql:
            text+='SET LOCAL ROLE postgres;\n'+mutation_sql+'\nRESET ROLE;\n'
        if name=='shadow':
            text+=(HERE/'sql/shadows.sql').read_text()+'\n'
        text+='SET LOCAL ROLE service_role;\n'+(HERE/'sql/assertions.sql').read_text()+'\n'
        text+="SELECT json_build_object('caseTempSchema',pg_my_temp_schema()::pg_catalog.int8);\n"
        text+=cases.body(name,self.plan)+'\nROLLBACK;\n'+(HERE/'sql/post_rollback.sql').read_text()
        # Expected failing native controls are separately admitted stages. Their
        # exception closes this owned backend, rolling back definitions and rows.
        expected_failure=mutation in ['finish-path','validator-path','validator-accept-all','finish-drop-receipt']
        failed=False
        try:
            output=self.sql(text)
            p.require('"rollback" : true' in output or '"rollback":true' in output,'same-backend-temp-absence')
        except ValueError:
            failed=True
            if not expected_failure:
                raise
            # Count only the named assertion, never an arbitrary PG error.
            log=(self.t.root/f'request-{self.t.index:03}'/'stderr.bin').read_text()
            labels={'finish-path':'a0-assert:installed-config-', 'validator-path':'a0-assert:installed-config-',
                    'validator-accept-all':'a0-assert:scope-userId','finish-drop-receipt':'a0-assert:retained-limited'}
            p.require(labels[mutation] in log,'native-control-wrong-failure')
        finally:
            stream=(self.t.root/f'request-{self.t.index:03}'/'stdout.bin').read_text()
            fields={k:v for line in stream.splitlines() if line.startswith('{') for k,v in json.loads(line).items()}
            p.require(type(fields.get('caseBackend')) is int and fields['caseBackend'] > 0 and type(fields.get('caseTempSchema')) is int and fields['caseTempSchema'] >= 0,'case-native-session-custody')
            p.require(name != 'shadow' or fields['caseTempSchema'] > 0,'case-shadow-temp-schema')
            gone=json.loads(self.sql("SELECT json_build_object('backendGone',NOT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid="+str(fields['caseBackend'])+"),'relationsGone',NOT EXISTS(SELECT 1 FROM pg_class WHERE relnamespace="+str(fields['caseTempSchema'])+"),'typesGone',NOT EXISTS(SELECT 1 FROM pg_type WHERE typnamespace="+str(fields['caseTempSchema'])+"));"))
            p.same({'backendGone':True,'relationsGone':True,'typesGone':True},gone,'post-case-native-session-absence')
            p.unchanged(before,self.snapshot())
            p.installed(self.definitions(),definitions)
            self.original_scope()
        p.same(expected_failure,failed,'native-control-outcome')
        j.record(self.path/'case.json',{'case':name,'mutation':mutation,'expectedFailure':expected_failure,'observedExpectedFailure':failed,
            'blind':'Direct SQL only. No route, UI, provider or power-loss acceptance.'})

    def change(self, kind):
        i=self.plan['fixture']
        return {'cancel':f"SELECT public.cancel_assistant_provider_turn({f.literal(i['turn'])},{f.literal(i['actor'])});",
            'revoke':f"SELECT public.revoke_assistant_provider_connection({f.literal(i['connection'])},{f.literal(i['actor'])});",
            'membership':f"DELETE FROM public.workspace_members WHERE user_id={f.literal(i['actor'])} AND workspace_id={f.literal(i['workspace'])};",
            'project':f"UPDATE public.projects SET workspace_id={f.literal(i['otherWorkspace'])} WHERE id={f.literal(i['project'])};"}[kind]

    def race(self, name):
        self.native(); self.original_scope(); definitions=self.installed(); before=self.snapshot()
        kind,order=name.split('-',1)
        self.inspect()
        handles=[]
        def start():
            header=(self.identity_guard(self.db)+'BEGIN; '+BOUNDS+" SET LOCAL lock_timeout='8s'; SET LOCAL ROLE service_role; SELECT json_build_object('backend',pg_backend_pid());\n").encode()
            h=self.t.start(self.argv(self.db),data=header); handles.append(h)
            h[0].stdin.write(header);h[0].stdin.flush()
            wait(h,'backend')
            return h
        def contents(h):
            return (h[1]/'stdout.bin').read_text()
        def wait(h, marker):
            until=time.monotonic()+6
            while time.monotonic()<until:
                if marker in contents(h):
                    # Preserve the exact returned prefix before a dependent send
                    # or observer request. Live stream files may still append.
                    os.fsync(h[2].fileno());os.fsync(h[3].fileno())
                    index=len(list(h[1].glob('marker-*.json')))
                    stdout=(h[1]/'stdout.bin').read_bytes()
                    stderr=(h[1]/'stderr.bin').read_bytes()
                    j.write(h[1]/f'marker-{index}.stdout',stdout)
                    j.write(h[1]/f'marker-{index}.stderr',stderr)
                    j.record(h[1]/f'marker-{index}.json',{'marker':marker,
                        'stdoutPrefixSHA256':hashlib.sha256(stdout).hexdigest(),
                        'stderrPrefixSHA256':hashlib.sha256(stderr).hexdigest()})
                    return
                if h[0].poll() is not None: raise ValueError('race-backend-exited')
                time.sleep(0.05)
            raise ValueError('race-finite-marker-timeout')
        def send(h,text):
            j.write(h[1]/('send-'+str(len(list(h[1].glob('send-*'))))+'.sql'),text.encode())
            h[0].stdin.write(text.encode());h[0].stdin.flush()
        try:
            a=start(); b=start()
            def pid(h):
                return json.loads(next(x for x in contents(h).splitlines() if 'backend' in x))['backend']
            first='SELECT '+f.finish(self.plan)+" IS NOT NULL;" if order=='finish-first' else self.change(kind)
            second=self.change(kind) if order=='finish-first' else 'SELECT '+f.finish(self.plan)+' IS NOT NULL;'
            # Neither session prelocks an application row. The production RPC or
            # actual access change acquires every lock observed by this protocol.
            send(a,first+"\n\\echo A_HELD\n"); wait(a,'A_HELD')
            send(b,second+"\n\\echo B_DONE\n")
            until=time.monotonic()+4; blockers=[]
            while time.monotonic()<until:
                blockers=json.loads(self.sql('SELECT to_json(pg_blocking_pids('+str(pid(b))+'));'))
                if pid(a) in blockers: break
                time.sleep(0.05)
            p.blocking(pid(a),pid(b),blockers)
            j.record(self.path/'blocking.json',{'firstPID':pid(a),'secondPID':pid(b),'blockers':blockers,'operation':kind,'order':order,'productionCallsOnly':True})
            send(a,'ROLLBACK;\n\\q\n'); a[0].stdin.close()
            code,_=self.t.finish(a); p.same(0,code,'race-first-exit'); handles.remove(a)
            wait(b,'B_DONE'); send(b,'ROLLBACK;\n\\q\n'); b[0].stdin.close()
            code,_=self.t.finish(b); p.same(0,code,'race-second-exit'); handles.remove(b)
            p.same(True,json.loads(self.sql('SELECT NOT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid IN ('+str(pid(a))+','+str(pid(b))+'));')),'race-backends-gone')
        finally:
            # Close our sessions, never terminate an existing process or target.
            for h in handles:
                if not h[0].stdin.closed: h[0].stdin.close()
                self.t.finish(h,timeout=25)
            p.unchanged(before,self.snapshot()); p.installed(self.definitions(),definitions); self.original_scope()
        j.record(self.path/'race.json',{'case':name,'status':'observed-blocking-and-rollback','blind':'Finite transaction ordering only; not every interleaving or committed-race acceptance.'})

    def run(self):
        # Verify real Git identities through fixed, journalled local reads.
        self.t.run(['/usr/bin/git','-C',str(REPO),'merge-base','--is-ancestor',p.SOURCE,'HEAD'])
        actual_tree=self.t.run(['/usr/bin/git','-C',str(REPO),'rev-parse','HEAD:openplan']).decode().strip()
        p.same(p.TREE,actual_tree,'actual-application-tree')
        actual_worker=self.t.run(['/usr/bin/git','-C',str(REPO),'rev-parse','HEAD:workers/planner_agent_connector']).decode().strip()
        reviewed_worker=self.t.run(['/usr/bin/git','-C',str(REPO),'rev-parse',p.SOURCE+':workers/planner_agent_connector']).decode().strip()
        p.same(reviewed_worker,actual_worker,'actual-worker-tree')
        self.t.run(['/usr/bin/git','-C',str(REPO),'diff','--quiet','HEAD','--','openplan','workers/planner_agent_connector'])
        self.native(catalog=True)
        if self.stage=='observe': self.observed()
        elif self.stage=='allocate': self.allocate()
        elif self.stage=='restore419': self.restore()
        elif self.stage=='apply17': self.apply(17)
        elif self.stage=='apply18': self.apply(18)
        elif self.stage=='fixture': self.seed()
        elif self.stage.startswith('case-'): self.case(self.stage[5:])
        elif self.stage.startswith('mutation-'):
            mutation=self.stage[9:]
            name={'harmless':'limited','finish-path':'configuration','validator-path':'configuration',
                'validator-accept-all':'scope-userId','finish-drop-receipt':'limited'}[mutation]
            self.case(name,mutation)
        elif self.stage.startswith('race-'): self.race(self.stage[5:])
        elif self.stage=='post':
            self.native(); self.original_scope(); self.installed()
            required=['case-'+x for x in cases.CASES]+['mutation-'+x for x in cases.MUTATIONS]+['race-'+x for x in RACES]
            for name in required:
                p.predecessor(read(ROOT/'stages'/name/'complete.json'),name)
                p.same('terminal',read(ROOT/'stages'/name/'manager-terminal.json')['status'],'post-manager-terminal')
            p.unchanged(read(ROOT/'stages/fixture/snapshot.json'),self.snapshot())
        j.record(self.path/'complete.json',{'stage':self.stage,'status':'complete','sourceCommit':p.SOURCE,'appTree':p.TREE,
            'claim':'Only this admitted native stage. No milestone or release acceptance.'})


def main():
    os.umask(0o077)
    p.require(len(sys.argv)==3 and sys.argv[1] in ['--launch','--run'],'usage: controller.py --launch STAGE')
    stage=sys.argv[2]
    if sys.argv[1]=='--launch':
        launch(stage); return
    plan,admission=ready(stage); cgroup()
    path=ROOT/'stages'/stage
    private(path,True)
    intent=read(path/'intent.json')
    p.same(j.sha(ROOT/'admissions'/(stage+'.json')),intent['admissionSHA256'],'stage-admission-pin')
    # Reserve the controller invocation too, including direct --run attempts.
    j.begin(path,'controller',{'stage':stage,'retry':'forbidden'})
    with LOCK.open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX | fcntl.LOCK_NB)
        Controller(stage,plan,admission).run()


if __name__=='__main__':
    try:
        main()
    except BaseException as error:
        # Do not print exception text: PG, transport and filesystem errors can
        # contain secrets. Stable refusal codes remain in private stage logs.
        if isinstance(error,ValueError) and str(error).startswith('MISSING_ROOT_ADMISSION:'):
            print(str(error),file=sys.stderr)
        else:
            print('REFUSED: private stage receipt requires review; no retry',file=sys.stderr)
        raise SystemExit(1)
