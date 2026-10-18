"""Native candidate proof. Only generated databases in the explicitly retained cluster are writable.

Run under systemd MemoryMax=1G MemorySwapMax=0. Server is retained and unbounded.
No global roles, existing database settings, source fixtures or services are changed.
"""
import argparse
import concurrent.futures
import contextlib
import copy
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time
import uuid

import psycopg2
from psycopg2.extras import Json, RealDictCursor

CLUSTER = 'a4181e334bb0da63e213aaea5966d163e24faab58ddb3e6122665b3c41042cce'
SOURCE = 'openplan_attempt_cli_5b3c1368c1c644b99444cd6194af1142'
NAME = 'supabase_db_openplan-restore-target-2026091050'
HEAD = 'f18ea8cd51d12168ec2766e1fc5cc34eeb775df2'
M16 = '1384e6a2767827c2b756d978bd6e76f6fea364e4e1263e953c0358364341267f'
MAIN = 'b259d73e56d22d4935ef2789874cf69901786b33'
BASE = Path('/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/project-jurisdiction-native-20261015')
REPO = Path(__file__).resolve().parents[3]

def digest(data):
    if not isinstance(data, bytes): data = json.dumps(data, sort_keys=True, default=str).encode()
    return hashlib.sha256(data).hexdigest()

def write(path, data):
    path.write_text(json.dumps(data, indent=2, default=str)+'\n'); path.chmod(0o600)

def command(args, **kw):
    p = subprocess.run(args, capture_output=True, timeout=180, **kw)
    if p.returncode: raise RuntimeError('command failed: '+args[0]+' '+p.stderr.decode()[:2000])
    return p.stdout

class Proof:
    def __init__(self, out):
        self.out = out
        self.events = []
        info = json.loads(command(['docker','inspect',CLUSTER]))[0]
        assert info['Id'] == CLUSTER and info['Name'] == '/'+NAME and info['State']['Running'], 'cluster identity'
        assert info['Config']['Labels']['com.supabase.cli.project']=='openplan-restore-target-2026091050', 'cluster custody'
        self.info = info
        env = dict(v.split('=',1) for v in info['Config']['Env'] if '=' in v)
        self.connect_args = dict(host=info['NetworkSettings']['Networks']['supabase_network_openplan-restore-target-2026091050']['IPAddress'],
            port=5432, user='supabase_admin', password=env['POSTGRES_PASSWORD'], connect_timeout=5)
        self.plan_path = out/'plan.json'
        self.plan = json.loads(self.plan_path.read_text()) if self.plan_path.exists() else {}
        self.targets = set(self.plan.get('databases',{}).values())
        if self.plan:
            assert self.plan['cluster']==CLUSTER and self.plan['source']==SOURCE and self.plan['candidate']==HEAD,'retained plan binding'
            assert len(self.targets)==2 and all(re.fullmatch(r'openplan_jurisdiction_native_[0-9a-f]{24}_(up|restore)',name) for name in self.targets),'generated targets only'
        cg=Path('/sys/fs/cgroup'+Path('/proc/self/cgroup').read_text().strip().split('::')[1])
        assert (cg/'memory.max').read_text().strip()=='1073741824' and (cg/'memory.swap.max').read_text().strip()=='0','runner cap every phase'
        write(out/('snapshot-bindings-'+uuid.uuid4().hex[:10]+'.json'),{
            'at':dt.datetime.now(dt.timezone.utc).isoformat(),'candidate':HEAD,
            'runnerFiles':{path.name:digest(path.read_bytes()) for path in Path(__file__).parent.glob('*.py')},
            'migration16Sha256':digest((REPO/'openplan/supabase/migrations/20261017000016_project_jurisdiction_context.sql').read_bytes()),
            'cluster':CLUSTER,'targets':sorted(self.targets),'memoryMax':1073741824,'swapMax':0})

    def record(self, name, value):
        self.events.append({'case':name,'observed':value})
        write(getattr(self,'observation_path',self.out/'observations.json'), self.events)
        print(name, flush=True)

    def connection(self, database, role=None, actor=None, readonly=False):
        assert (database==SOURCE and readonly) or (database!=SOURCE and database in self.targets), 'database allowlist'
        if database != SOURCE: assert re.fullmatch(r'openplan_jurisdiction_native_[0-9a-f]{24}_(up|restore)',database), 'new target format'
        c=psycopg2.connect(dbname=database, **self.connect_args)
        c.autocommit=True
        with c.cursor() as cur:
            cur.execute("SET work_mem='16MB'; SET statement_timeout='10s'; SET lock_timeout='3s'; SET idle_in_transaction_session_timeout='30s'; SET application_name='openplan-jurisdiction-native-proof'")
            if readonly: cur.execute('SET default_transaction_read_only=on')
            if role:
                assert role in ('postgres','authenticated','anon','service_role','authenticator')
                cur.execute('SET SESSION AUTHORIZATION '+role)
            if actor: cur.execute("SELECT set_config('request.jwt.claims',%s,false)", (json.dumps({'sub':actor,'role':role}),))
        return c

    def query(self, c, q, params=()):
        with c.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(q,params)
            return [dict(r) for r in cur.fetchall()] if cur.description else []

    def source(self): return self.connection(SOURCE, readonly=True)
    def up(self, *args, **kw): return self.connection(self.plan['databases']['up'],*args,**kw)

    def inventory(self,c):
        queries={
          'identity':"select current_database(),current_user,version(),current_setting('server_version_num') server_version_num, current_setting('work_mem') work_mem,current_setting('statement_timeout') statement_timeout,current_setting('lock_timeout') lock_timeout",
          'history':"select version,name,md5(statements::text) statements_md5 from supabase_migrations.schema_migrations order by version",
          'roles':"select rolname,rolsuper,rolbypassrls,rolcreaterole,rolcreatedb,rolcanlogin from pg_roles where rolname in ('postgres','supabase_admin','authenticated','anon','service_role','authenticator') order by rolname",
          'roleMemberships':"select a.rolname member,b.rolname granted_role from pg_auth_members m join pg_roles a on a.oid=m.member join pg_roles b on b.oid=m.roleid order by 1,2",
          'triggers':"select tgname,tgenabled,pg_get_triggerdef(oid) definition from pg_trigger where tgrelid='public.projects'::regclass and not tgisinternal order by tgname",
          'functions':"select p.oid::regprocedure::text signature,p.prosecdef,p.proconfig,p.proacl,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('valid_project_jurisdiction_context','guard_project_jurisdiction_context','set_projects_updated_at','workspace_role_rank','workspace_member_can_write') order by 1",
          'constraints':"select conname,convalidated,pg_get_constraintdef(oid) definition from pg_constraint where conrelid='public.projects'::regclass order by conname",
          'rls':"select relrowsecurity,relforcerowsecurity,relowner::regrole::text from pg_class where oid='public.projects'::regclass",
          'policies':"select tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies where schemaname='public' and tablename in ('projects','workspace_members') order by 1,2",
          'grants':"select grantee,table_name,privilege_type from information_schema.table_privileges where table_schema='public' and table_name in ('projects','workspace_members') order by 1,2,3",
          'resources':"select pg_database_size(current_database()) bytes,(select count(*) from pg_foreign_table) foreign_tables,(select count(*) from pg_subscription) subscriptions"
        }
        return {name:self.query(c,q) for name,q in queries.items()}

    def snapshot(self,c):
        return {'projects':self.query(c,"select to_jsonb(p) row,case when place_geometry_geojson is not null then encode(public.st_asbinary(public.st_geomfromgeojson(place_geometry_geojson::text)),'hex') end wkb from public.projects p order by id"),
                'corridors':self.query(c,"select to_jsonb(p) row,encode(public.st_asbinary(public.st_geomfromgeojson(geometry_geojson::text)),'hex') wkb from public.project_corridors p order by id")}

    def clone(self,source,target,label):
        assert source==SOURCE or source in self.targets
        assert target in self.targets and target!=source
        # Existence read precedes CREATE DATABASE. Never use a populated template.
        with contextlib.closing(self.source()) as c:
            assert not self.query(c,'select 1 from pg_database where datname=%s',(target,)), 'target already exists'
        self.record(label+'-before-create',{'target':target,'exists':False,'source':source})
        command(['docker','exec',CLUSTER,'createdb','-U','supabase_admin','-T','template0','-O','postgres',target])
        archive=self.out/(label+'-private.dump')
        with archive.open('xb') as f:
            p=subprocess.run(['docker','exec','-e','PGOPTIONS=-c work_mem=16MB -c statement_timeout=120000 -c lock_timeout=3000',CLUSTER,
                'pg_dump','-U','supabase_admin','-d',source,'-Fc','--no-publications','--no-subscriptions'],stdout=f,stderr=subprocess.PIPE,timeout=180)
        (self.out/(label+'-dump.log')).write_bytes(p.stderr)
        assert p.returncode==0,'consistent serial dump'
        with archive.open('rb') as f:
            p=subprocess.run(['docker','exec','-i','-e','PGOPTIONS=-c work_mem=16MB -c statement_timeout=120000 -c lock_timeout=3000',CLUSTER,
                'pg_restore','-U','supabase_admin','-d',target,'--exit-on-error','--single-transaction'],stdin=f,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=180)
        (self.out/(label+'-restore.log')).write_bytes(p.stdout+p.stderr)
        assert p.returncode==0,'serial restore exact new target'
        self.record(label+'-clone',{'archiveSha256':digest(archive.read_bytes()),'bytes':archive.stat().st_size,'target':target})

    def migration(self,c,path,version,name):
        text=path.read_text()
        assert version in ('20261017000015','20261017000016')
        if version.endswith('16'): assert digest(text.encode())==M16,'reviewed16 bytes'
        # M15 already has BEGIN/COMMIT. Wrap its body and history in one target transaction.
        if text.rstrip().endswith('COMMIT;'):
            text=re.sub(r'^BEGIN;\s*','',text, count=1,flags=re.M); text=re.sub(r'COMMIT;\s*$','',text)
        self.query(c,'BEGIN')
        try:
            self.query(c,'SET LOCAL ROLE postgres')
            self.query(c,text)
            self.query(c,'insert into supabase_migrations.schema_migrations(version,name,statements) values (%s,%s,%s)',(version,name,[path.read_text()]))
            self.query(c,'COMMIT')
        except BaseException:
            self.query(c,'ROLLBACK'); raise
        self.record('applied-'+version,{'sha256':digest(path.read_bytes()),'history':self.query(c,'select count(*) n,max(version) latest from supabase_migrations.schema_migrations')})

    def setup(self):
        assert not self.plan,'setup already retained'
        assert command(['git','rev-parse','HEAD'],cwd=REPO).decode().strip()==HEAD,'candidate head'
        cg=Path('/sys/fs/cgroup'+Path('/proc/self/cgroup').read_text().strip().split('::')[1])
        resources={'memoryMax':(cg/'memory.max').read_text().strip(),'swapMax':(cg/'memory.swap.max').read_text().strip(),
          'serverMemoryLimit':self.info['HostConfig']['Memory'],'serverSwapLimit':self.info['HostConfig']['MemorySwap'],'serverImage':self.info['Config']['Image'],'cluster':CLUSTER}
        assert resources['memoryMax']=='1073741824' and resources['swapMax']=='0','runner cap'
        write(self.out/'resources.json',resources)
        with contextlib.closing(self.source()) as c:
            inv=self.inventory(c); snap=self.snapshot(c)
            write(self.out/'source-inventory.json',inv); write(self.out/'source-snapshot.json',snap)
            hist=inv['history']
            assert len(hist)==417 and hist[-1]['version']=='20261017000014','predecessor417'
            assert inv['resources'][0]['foreign_tables']==0 and inv['resources'][0]['subscriptions']==0,'no foreign subscriptions'
            source_versions=[r['version'] for r in hist]
            baseline='1b2fefe0f0e98f99700fc77e99146fe697b43ee7'
            files=command(['git','ls-tree','-r','--name-only',baseline,'openplan/supabase/migrations'],cwd=REPO).decode().splitlines()
            assert source_versions==sorted(Path(f).name.split('_')[0] for f in files if f.endswith('.sql')),'full predecessor history versions'
        token=uuid.uuid4().hex[:24]
        self.plan={'candidate':HEAD,'migration16Sha256':M16,'migration15FromMain':MAIN,'source':SOURCE,'cluster':CLUSTER,
           'createdAt':dt.datetime.now(dt.timezone.utc).isoformat(),'databases':{'up':f'openplan_jurisdiction_native_{token}_up','restore':f'openplan_jurisdiction_native_{token}_restore'}}
        self.targets=set(self.plan['databases'].values()); write(self.plan_path,self.plan)
        self.clone(SOURCE,self.plan['databases']['up'],'predecessor417')
        with contextlib.closing(self.up()) as c:
            assert self.snapshot(c)==snap,'clone exact source project and corridor rows'
            self.migration(c,BASE/'migration15.sql','20261017000015','node_queue_process_observations')
            self.fixtures(c)
            before=self.snapshot(c); write(self.out/'before16.json',before)
            self.migration(c,REPO/'openplan/supabase/migrations/20261017000016_project_jurisdiction_context.sql','20261017000016','project_jurisdiction_context')
            after=self.snapshot(c); write(self.out/'after16.json',after)
            stripped=copy.deepcopy(after)
            for row in stripped['projects']:
                assert row['row'].pop('jurisdiction_context') is None,'legacy null stays null'
            assert stripped==before,'upgrade all legacy fields and WKB exact'
            write(self.out/'target419-inventory.json',self.inventory(c))
            self.record('upgrade-preserved',{'projectRows':len(after['projects']),'corridorRows':len(after['corridors']),'allOriginalFieldsExact':True,'exactWkb':True})

    def fixtures(self,c):
        f={k:str(uuid.uuid4()) for k in ('workspace','foreignWorkspace','owner','admin','member','viewer','outsider','foreignActor','legacy','searched','uploaded','site','race','foreignProject','corridor')}
        self.plan['fixtures']=f; write(self.plan_path,self.plan)
        self.query(c,'BEGIN')
        try:
            self.query(c,'SET LOCAL ROLE postgres')
            for k in ('owner','admin','member','viewer','outsider','foreignActor'):
                self.query(c,"insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values (%s,'authenticated','authenticated',%s,'{}','{}',now(),now())",(f[k],k+'-'+f[k]+'@native.invalid'))
            for k in ('workspace','foreignWorkspace'):
                self.query(c,'insert into public.workspaces(id,name,slug) values (%s,%s,%s)',(f[k],'Owned native '+k,'native-'+f[k]))
            for k in ('owner','admin','member','viewer'):
                self.query(c,'insert into public.workspace_members(workspace_id,user_id,role) values (%s,%s,%s)',(f['workspace'],f[k],k))
            self.query(c,"insert into public.workspace_members(workspace_id,user_id,role) values (%s,%s,'owner')",(f['foreignWorkspace'],f['foreignActor']))
            for k in ('legacy','searched','uploaded','site','race','foreignProject'):
                self.query(c,'insert into public.projects(id,workspace_id,name,created_by) values (%s,%s,%s,%s)',(f[k],f['foreignWorkspace' if k=='foreignProject' else 'workspace'],'native-'+k,f['owner']))
            geom={'type':'Polygon','coordinates':[[[-123.1,39.1],[-123,39.1],[-123,39.2],[-123.1,39.1]]]}
            for k,src in [('searched','tigerweb'),('uploaded','drawn')]:
                self.query(c,"update public.projects set place_source=%s,place_kind=%s,place_ref=%s,place_label=%s,place_country_code=%s,place_subdivision_code=%s,place_min_lon=-123.1,place_min_lat=39.1,place_max_lon=-123,place_max_lat=39.2,place_geometry_geojson=%s,place_set_at='2026-10-01T01:02:03Z' where id=%s",(src,'county' if k=='searched' else None,'06045' if k=='searched' else None,'Synthetic boundary', 'US' if k=='searched' else None,'CA' if k=='searched' else None,Json(geom),f[k]))
            self.query(c,'update public.projects set latitude=39.123456,longitude=-123.123456 where id=%s',(f['site'],))
            self.query(c,"insert into public.project_corridors(id,workspace_id,project_id,name,geometry_geojson,created_by) values(%s,%s,%s,'native corridor',%s,%s)",(f['corridor'],f['workspace'],f['uploaded'],Json({'type':'LineString','coordinates':[[-123.1,39.1],[-123,39.2]]}),f['owner']))
            self.query(c,'COMMIT')
        except BaseException:
            self.query(c,'ROLLBACK'); raise
        self.record('owned-synthetic-fixtures',f)


    def context(self,actor=None,label='Synthetic declaration'):
        return {'version':1,'state':'declared','entries':[{'label':label,'countryCode':'US','subdivisionCode':'CA','kind':'county','reference':'tigerweb:06045','scope':'administrative','identity':'server_resolved'}],
          'recordedBy':actor or self.plan['fixtures']['owner'],'recordedAt':'2001-01-01T01:02:03Z'}

    @contextlib.contextmanager
    def transaction(self,c):
        self.query(c,'BEGIN')
        try: yield
        finally: self.query(c,'ROLLBACK')

    def error(self,c,sql,params,code,label):
        self.query(c,'SAVEPOINT expected_error')
        actual=None; diagnostic=None
        try: self.query(c,sql,params)
        except psycopg2.Error as e: actual=e.pgcode; diagnostic=e.diag.message_primary
        finally: self.query(c,'ROLLBACK TO SAVEPOINT expected_error'); self.query(c,'RELEASE SAVEPOINT expected_error')
        assert actual==code, label+': expected SQLSTATE '+code+', observed '+str(actual)
        return {'sqlstate':actual,'message':diagnostic}

    def row(self,c,key='race'):
        return self.query(c,'select to_jsonb(p) row from public.projects p where id=%s',(self.plan['fixtures'][key],))[0]['row']

    def save(self,c,context,revision=None,workspace=None,project=None,omit_revision=False,omit_workspace=False):
        f=self.plan['fixtures']; params=[Json(context),project or f['race']]
        sql='update public.projects set jurisdiction_context=%s where id=%s'
        if not omit_workspace: sql+=' and workspace_id=%s'; params.append(workspace or f['workspace'])
        if revision is not None and not omit_revision: sql+=' and updated_at=%s'; params.append(revision)
        return self.query(c,sql+' returning id,workspace_id,updated_at,jurisdiction_context',params)

    def guard_definition(self,c):
        return self.query(c,"select pg_get_functiondef('public.guard_project_jurisdiction_context()'::regprocedure) definition")[0]['definition']

    def direct(self,role,operation='update'):
        f=self.plan['fixtures']; actor=f.get(role)
        with contextlib.closing(self.up('authenticated',actor)) as c, self.transaction(c):
            before=self.row(c,'uploaded')
            context=self.context(f['foreignActor'])
            if operation=='update':
                sql='update public.projects set jurisdiction_context=%s where id=%s returning id'; params=(Json(context),f['uploaded'])
            else:
                sql="insert into public.projects(id,workspace_id,name,created_by,jurisdiction_context) values (%s,%s,'forged native',%s,%s) returning id"
                params=(str(uuid.uuid4()),f['workspace'],actor,Json(context))
            result=self.error(c,sql,params,'42501','ordinary '+role+' '+operation+' must refuse forged context')
            assert self.row(c,'uploaded')==before,'direct refusal row unchanged'
            return result

    def valid_cases(self):
        good=self.context(); unresolved={**good,'state':'unresolved','entries':[]}
        invalid=[]
        def bad(label,mutate):
            x=copy.deepcopy(good); mutate(x); invalid.append((label,x))
        invalid += [('array',[]),('json-null',None),('scalar',42)]
        bad('missing-key',lambda x:x.pop('state')); bad('extra-key',lambda x:x.update(extra=True))
        bad('version-string',lambda x:x.update(version='1')); bad('version-two',lambda x:x.update(version=2))
        bad('state-null',lambda x:x.update(state=None)); bad('entries-object',lambda x:x.update(entries={}))
        bad('actor-type',lambda x:x.update(recordedBy=42)); bad('actor-invalid',lambda x:x.update(recordedBy='not-a-uuid'))
        bad('time-type',lambda x:x.update(recordedAt=42)); bad('time-date-only',lambda x:x.update(recordedAt='2026-10-15'))
        bad('time-impossible',lambda x:x.update(recordedAt='2026-02-30T01:02:03Z'))
        bad('unresolved-with-entry',lambda x:x.update(state='unresolved')); bad('declared-empty',lambda x:x.update(entries=[]))
        bad('thirteen',lambda x:x.update(entries=x['entries']*13)); bad('oversize',lambda x:x['entries'][0].update(label='x'*21000))
        for field,value in [('label',42),('label',' '),('kind',None),('scope','legal'),('identity','trusted'),('countryCode','usa'),('countryCode',2),('subdivisionCode','California space'),('reference','06045'),('reference','tigerweb:has space'),('reference',4)]:
            bad(field+'-'+str(value),lambda x,field=field,value=value:x['entries'][0].update({field:value}))
        bad('entry-missing',lambda x:x['entries'][0].pop('reference')); bad('entry-extra',lambda x:x['entries'][0].update(extra=1))
        bad('entry-scalar',lambda x:x.update(entries=[1]))
        return good,unresolved,invalid

    def validity(self):
        good,unresolved,invalid=self.valid_cases(); f=self.plan['fixtures']; results=[]
        with contextlib.closing(self.up('postgres')) as c, self.transaction(c):
            for label,x in [('sql-null','SQL_NULL'),('declared',good),('unresolved',unresolved)]+invalid:
                val=None if x=='SQL_NULL' else Json(x)
                accepted=self.query(c,'select public.valid_project_jurisdiction_context(%s::jsonb) ok',(val,))[0]['ok']
                assert accepted==(label in ('sql-null','declared','unresolved')), 'validity helper '+label
                if label not in ('sql-null','declared','unresolved'):
                    result=self.error(c,'update public.projects set jurisdiction_context=%s where id=%s',(val,f['race']),'23514','constraint '+label)
                    results.append({'case':label,'accepted':accepted,**result})
                else:
                    if label=='sql-null':
                        self.query(c,"insert into public.projects(workspace_id,name) values(%s,'valid null context')",(f['workspace'],))
                    else:
                        self.query(c,'update public.projects set jurisdiction_context=%s where id=%s',(val,f['race']))
                    results.append({'case':label,'accepted':accepted})
            # SQL validates namespaced form, not the route's supported resolver reference semantics.
            loose=copy.deepcopy(good); loose['entries'][0]['reference']='unknown:abc'
            assert self.query(c,'select public.valid_project_jurisdiction_context(%s) ok',(Json(loose),))[0]['ok'],'syntactic references only'
        self.record('validity',{'cases':results,'sqlDoesNotResolveReferences':True})

    def service(self,actor_key='member'):
        f=self.plan['fixtures']; actor=f.get(actor_key,actor_key) if actor_key is not None else None
        with contextlib.closing(self.up('service_role')) as c, self.transaction(c):
            before=self.row(c)
            context=self.context(actor)
            if actor_key is None: context['recordedBy']=None
            if actor_key in ('owner','admin','member'):
                lower=self.query(c,'select clock_timestamp() t')[0]['t']
                saved=self.save(c,context,before['updated_at'])
                upper=self.query(c,'select clock_timestamp() t')[0]['t']
                assert len(saved)==1,'service writer one row'
                returned=saved[0]['jurisdiction_context']; stamp=dt.datetime.fromisoformat(returned['recordedAt'])
                assert lower<=stamp<=upper,'service recordedAt must be database time'
                assert returned['recordedBy']==actor,'service attributed actor preserved'
                assert saved[0]['updated_at']>dt.datetime.fromisoformat(before['updated_at']),'revision advances'
                return {'actor':actor_key,'before':before,'after':self.row(c),'databaseBounds':[lower,upper]}
            result=self.error(c,'update public.projects set jurisdiction_context=%s where id=%s',(Json(context),f['race']),'42501','nonwriter service attribution refused')
            assert self.row(c)==before,'service refusal row unchanged'
            return {'actor':actor_key,**result}

    def reads(self):
        f=self.plan['fixtures']; results=[]
        for actor in ('owner','admin','member','viewer','outsider','foreignActor',None):
            with contextlib.closing(self.up('authenticated',f.get(actor))) as c:
                rows=self.query(c,'select id from public.projects where id=any(%s::uuid[]) order by id',([f[k] for k in ('legacy','searched','uploaded','site','race','foreignProject')],))
                ids={r['id'] for r in rows}
                expected={f['foreignProject']} if actor=='foreignActor' else set() if actor in ('outsider',None) else {f[k] for k in ('legacy','searched','uploaded','site','race')}
                assert ids==expected,'RLS read set '+str(actor)
                results.append({'actor':actor,'ids':sorted(ids)})
        self.record('rls-read-isolation',results)

    def ordinary(self):
        f=self.plan['fixtures']; result=[]
        for role in ('owner','admin','member'):
            with contextlib.closing(self.up('authenticated',f[role])) as c, self.transaction(c):
                rows=self.query(c,"insert into public.projects(workspace_id,name,created_by) values (%s,'ordinary null',%s) returning jurisdiction_context",(f['workspace'],f[role]))
                assert rows==[{'jurisdiction_context':None}],'ordinary null creation works'
                before=self.row(c,'uploaded')
                changed={'type':'Polygon','coordinates':[[[-123.1,39.1],[-122.9,39.1],[-122.9,39.3],[-123.1,39.1]]]}
                rows=self.query(c,'update public.projects set latitude=39.5,place_label=%s,place_geometry_geojson=%s where id=%s returning jurisdiction_context,latitude,place_geometry_geojson',('Changed geometry label',Json(changed),f['uploaded']))
                assert len(rows)==1,'ordinary geometry update works'
                assert float(rows[0]['latitude'])==39.5 and rows[0]['jurisdiction_context']==before['jurisdiction_context'] and rows[0]['place_geometry_geojson']==changed and rows[0]['place_geometry_geojson']!=before['place_geometry_geojson'],'geometry update preserves context'
                result.append({'role':role,'nullInsert':True,'geometryUpdate':True})
        for actor in ('viewer','outsider','foreignActor',None):
            with contextlib.closing(self.up('authenticated',f.get(actor))) as c, self.transaction(c):
                before=self.query(c,'select id from public.projects where id=%s',(f['uploaded'],))
                rows=self.query(c,"update public.projects set name='unauthorized' where id=%s returning id",(f['uploaded'],))
                assert rows==[],'viewer/foreign/noactor ordinary write returns zero'
                self.error(c,"insert into public.projects(workspace_id,name) values (%s,'unauthorized')",(f['workspace'],),'42501','viewer/foreign/noactor insert refuses')
                result.append({'actor':actor,'visibleRows':len(before),'ordinaryUpdateRows':0,'insertSqlstate':'42501'})
        self.record('ordinary-null-and-geometry',result)

    def wait_block(self,observer,blocked,holder,label):
        until=time.monotonic()+2
        last=[]
        while time.monotonic()<until:
            last=self.query(observer,"select wait_event_type,wait_event,pg_blocking_pids(pid) blockers from pg_stat_activity where pid=%s",(blocked,))
            if last and holder in last[0]['blockers'] and last[0]['wait_event_type']=='Lock':
                return last[0]
            time.sleep(.025)
        raise AssertionError(label+' must block on held membership/project row')

    def membership_race(self,change='downgrade',save_first=True):
        f=self.plan['fixtures']
        admin=self.up(); service=self.up('service_role'); observer=self.up()
        alter="update public.workspace_members set role='viewer' where workspace_id=%s and user_id=%s" if change=='downgrade' else 'delete from public.workspace_members where workspace_id=%s and user_id=%s'
        params=(f['workspace'],f['member']); before=self.row(admin); context=self.context(f['member'],change+str(save_first))
        pool=concurrent.futures.ThreadPoolExecutor(max_workers=1)
        future=None
        try:
            self.query(admin,'BEGIN'); self.query(service,'BEGIN')
            if save_first:
                assert len(self.save(service,context,before['updated_at']))==1,'save-first winner'
                def later():
                    rows=self.query(admin,alter+' returning role',params); self.query(admin,'COMMIT'); return rows
                future=pool.submit(later)
                wait=self.wait_block(observer,admin.get_backend_pid(),service.get_backend_pid(),'save-first '+change)
                self.query(service,'COMMIT'); assert len(future.result(timeout=5))==1,'membership transition completes'
                assert self.row(observer)['jurisdiction_context']['recordedBy']==f['member'],'save-first retains authorized attribution'
            else:
                self.query(admin,alter,params)
                def later():
                    try:
                        rows=self.save(service,context,before['updated_at']); self.query(service,'COMMIT'); return {'rows':len(rows),'sqlstate':None}
                    except psycopg2.Error as e:
                        self.query(service,'ROLLBACK'); return {'sqlstate':e.pgcode,'message':e.diag.message_primary}
                future=pool.submit(later)
                wait=self.wait_block(observer,service.get_backend_pid(),admin.get_backend_pid(),'change-first '+change)
                self.query(admin,'COMMIT'); result=future.result(timeout=5)
                assert result['sqlstate']=='42501','change-first membership must refuse 42501'
                assert self.row(observer)==before,'change-first refused row unchanged'
            return {'change':change,'saveFirst':save_first,'lockWait':wait,'before':before,'after':self.row(observer)}
        finally:
            # Release only our own transactions, never kill a session.
            if future and not future.done():
                if save_first: self.query(service,'ROLLBACK')
                else: self.query(admin,'ROLLBACK')
                try: future.result(timeout=5)
                except Exception: pass
            pool.shutdown(wait=True)
            for c in (admin,service):
                try:self.query(c,'ROLLBACK')
                except psycopg2.Error:pass
            self.query(observer,"insert into public.workspace_members(workspace_id,user_id,role) values(%s,%s,'member') on conflict(workspace_id,user_id) do update set role='member'",params)
            for c in (admin,service,observer): c.close()

    def cas(self,omit_revision=False):
        f=self.plan['fixtures']; a=self.up('service_role'); b=self.up('service_role'); obs=self.up()
        before=self.row(obs); pool=concurrent.futures.ThreadPoolExecutor(max_workers=1); future=None
        try:
            self.query(a,'BEGIN'); self.query(b,'BEGIN')
            first=self.save(a,self.context(f['owner'],'CAS first'),before['updated_at'],omit_revision=omit_revision)
            future=pool.submit(self.save,b,self.context(f['admin'],'CAS second'),before['updated_at'],None,None,omit_revision)
            wait=self.wait_block(obs,b.get_backend_pid(),a.get_backend_pid(),'CAS second')
            self.query(a,'COMMIT'); second=future.result(timeout=5); self.query(b,'COMMIT')
            assert len(first)==1 and len(second)==0,'CAS must have exactly one winner'
            after=self.row(obs)
            assert after['jurisdiction_context']['entries'][0]['label']=='CAS first','CAS winning payload retained'
            return {'firstRows':len(first),'secondRows':len(second),'lockWait':wait,'before':before,'after':after}
        finally:
            self.query(a,'ROLLBACK')
            if future and not future.done():
                try:future.result(timeout=5)
                except Exception:pass
            self.query(b,'ROLLBACK'); pool.shutdown(wait=True)
            for c in (a,b,obs):c.close()

    def scopes(self,omit_workspace=False):
        f=self.plan['fixtures']
        with contextlib.closing(self.up('service_role')) as c, self.transaction(c):
            foreign=self.row(c,'foreignProject'); before=self.row(c)
            rows=self.save(c,self.context(f['foreignActor']),foreign['updated_at'],f['workspace'],f['foreignProject'],omit_workspace=omit_workspace)
            assert rows==[],'foreign project old-workspace predicate must return zero'
            assert self.row(c,'foreignProject')==foreign,'foreign row unchanged'
            rows=self.save(c,self.context(f['owner']),before['updated_at'],project=str(uuid.uuid4()))
            assert rows==[],'unknown project returns zero'
        # A project moving while a save waits changes both workspace and revision.
        a=self.up(); b=self.up('service_role'); obs=self.up(); future=None
        pool=concurrent.futures.ThreadPoolExecutor(max_workers=1)
        before=self.row(obs)
        try:
            self.query(a,'BEGIN'); self.query(b,'BEGIN')
            self.query(a,'update public.projects set workspace_id=%s where id=%s',(f['foreignWorkspace'],f['race']))
            future=pool.submit(self.save,b,self.context(f['owner']),before['updated_at'])
            wait=self.wait_block(obs,b.get_backend_pid(),a.get_backend_pid(),'workspace move')
            self.query(a,'COMMIT'); rows=future.result(timeout=5); self.query(b,'COMMIT')
            assert rows==[],'stale workspace in-flight must return zero'
            return {'foreignPredicateRows':0,'unknownProjectRows':0,'inFlightRows':0,'lockWait':wait}
        finally:
            self.query(a,'ROLLBACK')
            if future and not future.done():
                try:future.result(timeout=5)
                except Exception:pass
            self.query(b,'ROLLBACK'); pool.shutdown(wait=True)
            self.query(obs,'update public.projects set workspace_id=%s where id=%s',(f['workspace'],f['race']))
            for c in (a,b,obs): c.close()

    def restoration(self):
        f=self.plan['fixtures']
        with contextlib.closing(self.up('service_role')) as c:
            for key,state in [('searched','declared'),('uploaded','unresolved')]:
                context=self.context(f['admin'])
                if state=='unresolved':context.update(state=state,entries=[])
                assert len(self.save(c,context,workspace=f['workspace'],project=f[key]))==1,'restore source nonnull fixture'
        with contextlib.closing(self.up()) as c:
            before=self.snapshot(c); write(self.out/'restore-before.json',before)
        target=self.plan['databases']['restore']
        self.clone(self.plan['databases']['up'],target,'candidate419')
        with contextlib.closing(self.connection(target,'postgres')) as c:
            after=self.snapshot(c); write(self.out/'restore-after.json',after)
            assert after==before,'archive restore context revision and WKB exact'
            with self.transaction(c):
                original=self.row(c,'searched'); inserted=copy.deepcopy(original); inserted['id']=str(uuid.uuid4()); inserted['name']='trusted INSERT seam'
                self.query(c,'insert into public.projects select (jsonb_populate_record(null::public.projects,%s::jsonb)).*',(Json(inserted),))
                observed=self.query(c,'select to_jsonb(p) row from public.projects p where id=%s',(inserted['id'],))[0]['row']
                assert observed==inserted,'trusted live-trigger INSERT preserves actor time revision geometry'
                self.query(c,'update public.projects set summary=%s where id=%s',('trusted update limitation',inserted['id']))
                updated=self.query(c,'select to_jsonb(p) row from public.projects p where id=%s',(inserted['id'],))[0]['row']
                assert updated['updated_at']>inserted['updated_at'],'trusted UPDATE advances revision limitation'
                self.record('trusted-live-trigger-insert-update',{'insertExact':True,'insert':inserted,'afterUpdate':updated})
        self.record('archive-restore',{'target':target,'allRowsExact':True,'exactActorTimeRevisionWkb':True,'projectRows':len(before['projects'])})

    def privilege(self):
        results=[]
        for role in ('anon','authenticated'):
            with contextlib.closing(self.up(role,self.plan['fixtures']['owner'] if role=='authenticated' else None)) as c, self.transaction(c):
                for target in ('postgres','service_role','supabase_admin'):
                    results.append({'role':role,'target':target,**self.error(c,'SET LOCAL ROLE '+target,(),'42501','ordinary role cannot assume '+target)})
                self.error(c,'select public.guard_project_jurisdiction_context()',(),'42501','ordinary cannot invoke guard')
        with contextlib.closing(self.up()) as c:
            grants=self.query(c,"select r,has_function_privilege(r,'public.valid_project_jurisdiction_context(jsonb)','execute') may_validate,has_function_privilege(r,'public.guard_project_jurisdiction_context()','execute') may_guard,pg_has_role(r,'postgres','member') postgres_member,pg_has_role(r,'service_role','member') service_member from unnest(array['anon','authenticated']) r")
            assert all(not r['may_guard'] and not r['postgres_member'] and not r['service_member'] for r in grants),'ordinary privilege inventory'
        self.record('ordinary-privileged-role-refusals',{'attempts':results,'inventory':grants})

    def control(self,label,install,assertion,diagnostic,survivor=False):
        with contextlib.closing(self.up()) as c:
            original=self.guard_definition(c)
            self.query(c,'BEGIN')
            try:
                install(c,original)
                caught=None
                try: assertion(c)
                except AssertionError as e:caught=str(e)
                if survivor:
                    assert caught is None,'harmless control unexpectedly failed: '+str(caught)
                    result='survived'
                else:
                    assert caught and diagnostic in caught,label+' did not fail intended assertion: '+str(caught)
                    result='killed'
                self.record('control-'+label,{'outcome':result,'assertion':caught,'blindCategory':'This mutation tests the named database assertion, not route/browser behavior.'})
            finally:self.query(c,'ROLLBACK')
            assert self.guard_definition(c)==original,'installed function restored after '+label

    def local_direct_assertion(self,c):
        f=self.plan['fixtures']
        self.query(c,'SET LOCAL ROLE authenticated')
        self.query(c,"select set_config('request.jwt.claims',%s,true)",(json.dumps({'sub':f['owner'],'role':'authenticated'}),))
        self.error(c,'update public.projects set jurisdiction_context=%s where id=%s',(Json(self.context()),f['race']),'42501','ordinary owner update must refuse forged context')

    def mutations(self):
        f=self.plan['fixtures']
        def replacement(before,after):
            def install(c,original):
                assert original.count(before)==1,'unique SQL source binding'
                self.query(c,original.replace(before,after))
            return install
        self.control('harmless-comment',lambda c,s:self.query(c,s.replace('BEGIN','BEGIN\n-- harmless native proof comment',1)),self.local_direct_assertion,'',True)
        self.control('ordinary-guard-removed',replacement("IF current_user NOT IN ('service_role', 'postgres') THEN",'IF false THEN'),self.local_direct_assertion,'ordinary owner update must refuse forged context')
        def invalid(c):
            self.query(c,'SET LOCAL ROLE postgres')
            self.error(c,'update public.projects set jurisdiction_context=%s where id=%s',(Json({'malformed':True}),f['race']),'23514','actual validity constraint must refuse malformed')
        self.control('constraint-removed',lambda c,s:self.query(c,'alter table public.projects drop constraint projects_jurisdiction_context_valid'),invalid,'actual validity constraint must refuse malformed')
        def stamp(c):
            self.query(c,'SET LOCAL ROLE service_role')
            low=self.query(c,'select clock_timestamp() t')[0]['t']; saved=self.save(c,self.context())
            assert dt.datetime.fromisoformat(saved[0]['jurisdiction_context']['recordedAt'])>=low,'service recordedAt must be database time'
        self.control('time-stamp-omitted',replacement("NEW.jurisdiction_context := jsonb_set(NEW.jurisdiction_context, '{recordedAt}', to_jsonb(clock_timestamp()));",'NULL;'),stamp,'service recordedAt must be database time')
        def nonwriter(c):
            self.query(c,'SET LOCAL ROLE service_role')
            self.error(c,'update public.projects set jurisdiction_context=%s where id=%s',(Json(self.context(f['foreignActor'])),f['race']),'42501','attributed foreign writer must refuse')
        self.control('actor-membership-redirected',replacement("member.user_id = (NEW.jurisdiction_context->>'recordedBy')::uuid", "member.user_id = '"+f['owner']+"'::uuid"),nonwriter,'attributed foreign writer must refuse')
        def rank(c):
            self.query(c,'SET LOCAL ROLE service_role')
            self.error(c,'update public.projects set jurisdiction_context=%s where id=%s',(Json(self.context(f['viewer'])),f['race']),'42501','viewer attributed context must refuse')
        self.control('writer-rank-weakened',replacement('public.workspace_role_rank(member.role) >= 2','public.workspace_role_rank(member.role) >= 0'),rank,'viewer attributed context must refuse')
        # Lock mutations require committed replacement so the other connection sees it.
        with contextlib.closing(self.up()) as c:
            original=self.guard_definition(c)
            try:
                assert original.count('FOR SHARE')==1
                self.query(c,original.replace('FOR SHARE','FOR KEY SHARE'))
                failure=None
                try:self.membership_race('downgrade',True)
                except AssertionError as e:failure=str(e)
                assert failure=='save-first downgrade must block on held membership/project row','weakened-lock intended failure'
                self.record('control-membership-lock-weakened',{'outcome':'killed','assertion':failure})
            finally:self.query(c,original)
            assert self.guard_definition(c)==original,'lock mutation exact restore'
        failure=None
        try:self.cas(omit_revision=True)
        except AssertionError as e:failure=str(e)
        assert failure=='CAS must have exactly one winner','omitted revision intended failure'
        self.record('control-cas-predicate-omitted',{'outcome':'killed','assertion':failure})
        failure=None
        try:self.scopes(omit_workspace=True)
        except AssertionError as e:failure=str(e)
        assert failure=='foreign project old-workspace predicate must return zero','omitted workspace intended failure'
        self.record('control-workspace-predicate-omitted',{'outcome':'killed','assertion':failure})
        # Snapshot oracle controls change only in-memory readbacks, never retained archives.
        before=json.loads((self.out/'before16.json').read_text()); after=json.loads((self.out/'after16.json').read_text())
        for row in after['projects']:row['row'].pop('jurisdiction_context')
        assert before==after,'upgrade oracle restored baseline'
        harmless=copy.deepcopy(after)
        assert harmless==before,'upgrade oracle harmless survivor'
        for kind in ('geometry','site','corridor'):
            broken=copy.deepcopy(after)
            if kind=='corridor':broken['corridors'][0]['wkb']='00'
            elif kind=='site':broken['projects'][0]['row']['latitude']=0
            else:broken['projects'][0]['wkb']='00'
            assert broken!=before,'upgrade oracle detects '+kind
        restored=json.loads((self.out/'restore-after.json').read_text()); original=json.loads((self.out/'restore-before.json').read_text())
        assert restored==original,'archive oracle baseline'
        altered=copy.deepcopy(restored)
        row=next(r['row'] for r in altered['projects'] if r['row']['jurisdiction_context'])
        row['jurisdiction_context']['recordedAt']='2001-01-01T01:02:03Z'
        assert altered!=original,'restore oracle detects altered provenance'
        self.record('snapshot-oracle-controls',{'harmless':'survived','upgradeGeometry':'killed','upgradeSite':'killed','upgradeCorridor':'killed','restoreProvenance':'killed','category':'In-memory corrupted readback controls; not corrupted archive restore executions.'})

    def proof(self):
        attempt=self.out/('attempt-'+uuid.uuid4().hex[:10]); attempt.mkdir(mode=0o700)
        self.events=[]; self.observation_path=attempt/'observations.json'
        self.validity()
        for role in ('owner','admin','member'):
            for operation in ('insert','update'):self.record('direct-'+role+'-'+operation,self.direct(role,operation))
        self.ordinary(); self.reads()
        for actor in ('owner','admin','member','viewer','outsider','foreignActor',None):
            self.record('service-'+str(actor),self.service(actor))
        # Missing recordedBy is invalid and must still refuse at the membership seam.
        with contextlib.closing(self.up('service_role')) as c,self.transaction(c):
            x=self.context();x.pop('recordedBy')
            self.record('service-noactor',self.error(c,'update public.projects set jurisdiction_context=%s where id=%s',(Json(x),self.plan['fixtures']['race']),'42501','missing actor refuses'))
        for change in ('downgrade','revoke'):
            for first in (True,False):self.record('membership-'+change+'-'+str(first),self.membership_race(change,first))
        self.record('cas-exact-revision',self.cas())
        self.record('stale-workspace',self.scopes())
        self.privilege()
        if not (self.out/'restore-after.json').exists():self.restoration()
        self.mutations()
        # Re-run the boundaries after restoring installed SQL.
        self.record('restored-direct',self.direct('owner'))
        self.record('restored-service',self.service('member'))
        self.record('restored-membership',self.membership_race('downgrade',True))
        self.record('restored-cas',self.cas())
        self.reads()
        with contextlib.closing(self.up()) as c:write(attempt/'final-inventory.json',self.inventory(c))
        with contextlib.closing(self.source()) as c:
            source=self.inventory(c)
            assert source['history']==json.loads((self.out/'source-inventory.json').read_text())['history'],'source417 history unchanged'
            assert not self.query(c,"select 1 from information_schema.columns where table_schema='public' and table_name='projects' and column_name='jurisdiction_context'"),'source16 never applied'
            write(attempt/'source-final-inventory.json',source)
        write(attempt/'result.json',{'status':'passed-native-boundaries','candidate':HEAD,'sourceReadOnly':True,'databases':self.plan['databases'],'observations':len(self.events)})


def main():
    os.umask(0o077)
    ap=argparse.ArgumentParser(); ap.add_argument('phase',choices=['setup','proof']); ap.add_argument('--run'); args=ap.parse_args()
    out=BASE/(args.run or ('run-'+uuid.uuid4().hex[:12]))
    if args.phase=='setup': out.mkdir(mode=0o700)
    else: assert out.is_dir()
    p=Proof(out)
    try:
        if args.phase=='setup': p.setup()
        else: p.proof()
    except BaseException as e:
        write(out/('failure-'+uuid.uuid4().hex[:10]+'.json'),{'type':type(e).__name__,'message':str(e)})
        raise
    print('EVIDENCE '+str(out),flush=True)

if __name__=='__main__': main()
