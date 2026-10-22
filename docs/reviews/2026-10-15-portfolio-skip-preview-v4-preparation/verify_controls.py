"""Bounded file/fixture controls. All operational transports are replaced."""
import ast
from contextlib import ExitStack
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
ROOT=Path('/home/nathaniel/.local/state/openplan/project-portfolio-skip-preview-20261015-v4')
REPO=HERE.parents[2]
rows=[]
def load(name,path):
 spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);sys.modules[name]=m;spec.loader.exec_module(m);return m
def ok(name,call):
 call();rows.append({'case':name,'outcome':'SURVIVED'})
def no(name,call,reason):
 try:call()
 except (ValueError,AssertionError,OSError) as e:
  assert reason in str(e),(name,type(e).__name__,str(e),reason)
  rows.append({'case':name,'outcome':'REFUSED','reason':reason});return
 raise AssertionError('vacuous:'+name)
def denied(*a,**kw):raise AssertionError('REAL-TRANSPORT-FORBIDDEN')
def main():
 sys.path.insert(0,str(ROOT))
 try:
  h=load('helper',ROOT/'helper.py');a=load('app_binding_v1',ROOT/'app_binding_v1.py');t=load('attest_v4',ROOT/'attest_start_v1.py')
 finally:sys.path.pop(0)
 p=h.p;original_sha=h.sha
 original={str(f):hashlib.sha256(f.read_bytes()).hexdigest() for f in ROOT.iterdir() if f.is_file()}
 try:
  with ExitStack() as stack:
   stack.enter_context(patch.object(h.subprocess,'run',denied))
   stack.enter_context(patch.object(h,'run',denied));stack.enter_context(patch.object(h,'sql',denied))
   stack.enter_context(patch.object(a,'command',denied))
   # Baselines and harmless notes reach the actual pure consumers.
   ok('sealed-inputs',h.pinned_files);ok('old-packet-files-harmless',lambda:preservation(h));
   with patch.object(h,'sha',lambda f:'0'*64):
    no('old-packet-byte-drift',lambda:preservation(h),'old-packet:sha256')
   ok('app-binding',a.bindings);ok('new-helper-import',a.load_recovery)
   ok('new-app-env',lambda:a.app_values(h));ok('retained-dump',h.retained_dump)
   plan=h.read('plan-private.json');envs=h.read('envs-private.json');app=h.read('app-env-private.json');kong=h.read('kong-private.json')
   optional={k:app[k] for k in p.OPTIONAL_KEYS if k in app}
   config=lambda e=envs,k=kong,v=app,pl=plan:p.configuration(pl,e,k,v,optional)
   ok('configuration-harmless-note',lambda:config(pl={**plan,'operatorNote':'no behavior change'}))
   no('old-target-prefix',lambda:p.target_name('openplan_project_combined_preview_'+'a'*24),'target:valid')
   no('proof-target-prefix',lambda:p.target_name('openplan_portfolio_skip_'+'a'*24),'target:valid')
   ok('new-target-name',lambda:p.target_name(h.TARGET))
   for kind,key in p.URI_KEYS.items():
    wrong=copy.deepcopy(envs);wrong[kind][key]=wrong[kind][key].replace(h.TARGET,plan['source'])
    no(kind+'-wrong-database',lambda e=wrong:config(e=e),'configuration:endpoints')
   wrong=copy.deepcopy(envs);wrong['rest']['PGRST_DB_URI']=wrong['rest']['PGRST_DB_URI'].replace('%20','+')
   no('native-rest-plus',lambda:p.native_rest_uri(wrong['rest']['PGRST_DB_URI']),'native-rest-uri:value')
   for key,value in [('NEXT_PUBLIC_APP_URL','http://127.74.19.10:3585'),('NEXT_PUBLIC_SUPABASE_URL','http://127.74.19.10:29948'),('OPENPLAN_COMMIT_SHA','21510042e94bcaf80f262205ad156a7bb639e35c')]:
    wrong={**app,key:value};no('app-'+key,lambda v=wrong:config(v=v),'configuration:')
   wrong=copy.deepcopy(kong)
   for plugin in wrong['plugins']:
    if plugin['name']=='cors':plugin['config']['origins']=['http://127.74.19.10:3585']
   no('old-cors',lambda:config(k=wrong),'configuration:cors')
   wrong=copy.deepcopy(kong);wrong['services'][0]['url']='http://old-helper:3000/'
   no('old-upstream',lambda:config(k=wrong),'configuration:upstreams')
   with patch.object(h,'sha',lambda f:'0'*64 if Path(f).name=='source-private.dump' else original_sha(f)):
    no('retained-dump-hash',h.retained_dump,'retained-dump:sha256')
   # Current helpers must follow a successful upgrade receipt, never merely 419 readiness.
   e=h.read('upgrade-expectations.json')
   independent_old=(REPO/'openplan/supabase/migrations/20260905000001_portfolio_unknown_price_year.sql').read_text().split('CREATE OR REPLACE FUNCTION public.commit_project_portfolio_import_v2(',1)[1].split('AS $$',1)[1].split('$$;',1)[0]
   assert e['oldBody']==independent_old,'original-v2-body-selection'
   no('original-v1-body-selection',lambda:assert_equal(e['oldBody'],(REPO/'openplan/supabase/migrations/20260905000001_portfolio_unknown_price_year.sql').read_text().split('AS $$',1)[1].split('$$;',1)[0]),'different-v2-body')
   state={'database':h.TARGET,'historyCount':420,'latest':'20261017000017','versions':sorted(e['versions']+['20261017000017']),'body':e['newBody'],'priorHistoryDigest':e['history']['digest'],'historySQL':[(ROOT/'candidate17.sql').read_text()],
    'statusConstraint':"CHECK ((decision <> 'create'::text) OR ...)",'phaseConstraint':"CHECK ((decision <> 'create'::text) OR ...)"}
   ok('upgrade-state-harmless-note',lambda:h.upgraded({**state,'operatorNote':'unchanged'}))
   for key,bad in [('database',plan['source']),('historyCount',419),('latest','20261017000016'),('versions',e['versions']),('body',e['oldBody']),('priorHistoryDigest','0'*32),('historySQL',['wrong SQL']),('statusConstraint','CHECK (true)'),('phaseConstraint','CHECK (true)')]:
    no('upgrade-'+key,lambda k=key,v=bad:h.upgraded({**state,k:v}),'upgrade-'+key if 'Constraint' in key else 'upgrade-state:'+key)
   emitted=h.upgrade_sql();assert emitted.count((ROOT/'candidate17.sql').read_text())==1
   assert emitted.startswith('BEGIN;') and emitted.endswith('COMMIT;')
   ok('upgrade-SQL-harmless-comment',lambda:mechanical_sql('-- note\n'+emitted,h,e))
   for token,reason in [('upgrade-history419-target','history419'),('upgrade-history-bytes','history-bytes'),('upgrade-original-body','original-body'),('upgrade-target-connections','connections'),('upgrade-history420','history420'),('LOCK TABLE supabase_migrations.schema_migrations IN EXCLUSIVE MODE;','history-lock'),('COMMIT;','transaction')]:
    no('SQL-'+reason,lambda x=emitted.replace(token,''):mechanical_sql(x,h,e),'SQL:'+reason)
   # Distinct reservation/port errors are exercised with actual consumers and fake observations.
   original_read=h.read
   def fake_sql(database,query):return json.dumps([h.TARGET] if fresh['reserved'] else [])
   fresh={'reserved':False,'helper':False}
   with patch.object(h,'sql',fake_sql),patch.object(h,'run',lambda *x,**kw: (json.dumps(plan['names']['rest'])+'\n').encode() if fresh['helper'] else b''):
    ok('fresh-name-harmless',h.fresh_target)
    fresh['reserved']=True;no('database-reserved',h.fresh_target,'target-reserved:fresh');fresh['reserved']=False
    fresh['helper']=True;no('helper-reserved',h.fresh_target,'helper-reserved:fresh')
   class Socket:
    def __enter__(self):return self
    def __exit__(self,*x):return False
    def bind(self,address):
     assert address in [(p.HOST,29949),(p.HOST,3586)]
     if address[1]==occupied['port']:raise OSError('occupied-port')
   occupied={'port':None}
   with patch.object(h.socket,'socket',Socket):
    ok('bindable-fixture',h.free_ports)
    for port in [29949,3586]:occupied['port']=port;no('occupied-'+str(port),h.free_ports,'occupied-port')
   # Fixed-path migration census uses fixtures, no checkout or generated declaration copy.
   observed={str(f.relative_to(REPO)):a.sha(f) for f in (REPO/'openplan/supabase/migrations').glob('*.sql')}
   assert len(observed)==420 and observed==a.read(ROOT/'migrations.json')
   with patch.object(a,'CANDIDATE',REPO),patch.object(a,'APP',REPO/'openplan'):
    ok('420-migration-census',a.migrations)
    saved=a.read
    with patch.object(a,'read',lambda path: {k:v for k,v in saved(path).items() if '20261017000017' not in k} if Path(path)==ROOT/'migrations.json' else saved(path)):
     no('419-manifest',a.migrations,'migration-baseline')
   # Exact npm path is derived from this new app path; no npm executes.
   ok('npm-path-harmless',lambda:assert_path(t.npm_child_path('/usr/bin:/bin'),a))
   no('npm-wrong-base',lambda:t.npm_child_path('/usr/local/bin:/usr/bin:/bin'),'attest-base-path')
   assert t.UNIT=='openplan-portfolio-skip-preview-49e3fa200-v4-web.service'
   # Freeze all unchanged functions against the proven recipes, and inspect changed call order.
   ok('mechanical-runtime-baseline',lambda:mechanical_runtime(h,a,t))
   s=(ROOT/'helper.py').read_text()
   for old,new,reason in [('target_check();upgrade_ready()','target_check()','service-upgrade'),('target_check();upgrade_ready()','target_check()','service-upgrade')][:1]:
    no('helper-gate-removal',lambda:mechanical_runtime(h,a,t,helper=s.replace(old,new)),'mechanical:'+reason)
   ts=(ROOT/'attest_start_v1.py').read_text()
   for old,new,reason in [("'expected':420","'expected':419",'health420'),(':3586',':3585','attest-port'),("a.APP_HEAD[:12].lower()","a.APP_HEAD",'health-commit'),("expected['PATH']=npm_child_path(expected['PATH'])","pass",'npm-path')]:
    no('attestor-'+reason,lambda x=ts.replace(old,new):mechanical_runtime(h,a,t,attestor=x),'mechanical:'+reason)
   runner=(ROOT/'run_stage.sh').read_text()
   ok('runner-harmless-comment',lambda:mechanical_runner('# harmless\n'+runner))
   for old,new,reason in [('controller=attest_start_v1.py','controller=attest_start_v2.py','host-attestor'),('MemoryMax="$memory"','MemoryMax=32G','memory'),('sha256sum --check --strict','true #','seal'),('request-$stage','request-constant','reservation')]:
    no('runner-'+reason,lambda x=runner.replace(old,new):mechanical_runner(x),'runner:'+reason)
   # Test the mechanical checker itself can distinguish a harmless survivor and a broken check.
   ok('mechanical-harmless-survivor',lambda:mechanical_runtime(h,a,t,helper='# harmless\n'+s))
   with patch.object(t,'UNIT','wrong-unit'):
    no('mechanical-unit-detector',lambda:mechanical_runtime(h,a,t),'mechanical:unit')
   # Public tree scan against known private credential values, without printing values.
   values=set()
   for item in [app,*envs.values(),h.read('configured-source-private.json')['values']]:
    for k,v in item.items():
     if any(word in k for word in ['KEY','SECRET','DATABASE_URL','DB_URI']):values.add(v)
   blobs=[f.read_bytes() for f in HERE.rglob('*') if f.is_file() and f.name!='evidence.json']
   assert all(v.encode() not in b for v in values if len(v)>15 for b in blobs),'public-known-secret'
   rows.append({'case':'public-known-secret-screen','outcome':'SURVIVED'})
 finally:
  now={str(f):hashlib.sha256(f.read_bytes()).hexdigest() for f in ROOT.iterdir() if f.is_file() and str(f) in original}
  assert now==original,'sealed-files-not-restored'
  assert not (ROOT/'candidate').exists() and not list((ROOT/'execution').iterdir()),'operating-stage-dispatched'
 result={'scope':'Files, pure consumers, SQL assembly and mechanical binding only. No DB/HTTP/Docker/npm/browser operation.','cases':rows,'count':len(rows),'restoredInFinally':True,'sealedFilesUnchanged':True,'candidateAbsent':True,'executionEmpty':True,'applicationSource':'49e3fa2004c1336ffa36c134a8f21bcc2d72d327','blindCategories':['No PostgreSQL parsing or execution of the new upgrade transaction.','No helper/API/CORS transport or storage-byte test.','No new compiler/build/start/process attestation or browser journey.','Mechanical source checks cannot establish behavioral equivalence of modified statements.','Known-value privacy scan does not detect unknown secrets.']}
 (ROOT/'controls-01.json').write_text(json.dumps(result,indent=2)+'\n');(HERE/'evidence.json').write_text(json.dumps(result,indent=2)+'\n')
 print(json.dumps({'cases':len(rows),'survived':sum(x['outcome']=='SURVIVED' for x in rows),'refused':sum(x['outcome']=='REFUSED' for x in rows),'operationalExecution':False}))

def preservation(h):
 with patch.object(h,'protected_web',lambda:None):h.preserve()

def assert_equal(a,b):
 assert a==b,'different-v2-body'

def assert_path(path,a):
 entries=[];p=a.APP
 while True:
  entries.append(str(p/'node_modules/.bin'))
  if p.parent==p:break
  p=p.parent
 entries+=['/usr/lib/node_modules/npm/node_modules/@npmcli/run-script/lib/node-gyp-bin','/usr/bin:/bin']
 assert path==':'.join(entries),'npm-parity'
def mechanical_sql(text,h,e):
 for token,name in [('upgrade-history419-target','history419'),('upgrade-history-bytes','history-bytes'),('upgrade-original-body','original-body'),('upgrade-target-connections','connections'),('upgrade-history420','history420'),('LOCK TABLE supabase_migrations.schema_migrations IN EXCLUSIVE MODE;','history-lock'),('COMMIT;','transaction')]:
  assert token in text,'SQL:'+name
 assert text.index('upgrade-history419-target')<text.index((ROOT/'candidate17.sql').read_text())<text.index("INSERT INTO supabase_migrations.schema_migrations"),'SQL:order'
 assert h.literal(h.TARGET) in text and h.literal(e['oldBody']) in text,'SQL:fixed-inputs'
def mechanical_runtime(h,a,t,helper=None,attestor=None):
 helper=(ROOT/'helper.py').read_text() if helper is None else helper
 attestor=(ROOT/'attest_start_v1.py').read_text() if attestor is None else attestor
 assert 'target_check();upgrade_ready()' in helper,'mechanical:service-upgrade'
 assert "'expected':420,'latest':'20261017000017'" in attestor,'mechanical:health420'
 assert "a.HOST+':3586'" in attestor and 'sport = :3586' in attestor,'mechanical:attest-port'
 assert 'a.APP_HEAD[:12].lower()' in attestor,'mechanical:health-commit'
 assert "expected['PATH']=npm_child_path(expected['PATH'])" in attestor,'mechanical:npm-path'
 assert t.UNIT=='openplan-portfolio-skip-preview-49e3fa200-v4-web.service','mechanical:unit'
 # Parse unchanged functions, not comments, to keep their proven strict behavior intact.
 def funcs(text):return {n.name:ast.dump(n,include_attributes=False) for n in ast.parse(text).body if isinstance(n,ast.FunctionDef)}
 old=funcs(Path('/home/nathaniel/.local/state/openplan/current-project-preview-app-binding-20261015-v3/app_binding_v1.py').read_text());new=funcs((ROOT/'app_binding_v1.py').read_text())
 for name in old.keys()-{'load_recovery','app_values','acquire','migrations','confined_argv','start','bindings'}:assert old[name]==new[name],'mechanical:unchanged-'+name
 assert old['bindings'].replace('recovery-active-binding.json','upgrade-expectations.json')==new['bindings'],'mechanical:binding-file-delta'
 # Only the literal web port changes in these two original functions.
 for name in ['confined_argv','start']:
  assert old[name].replace("'3585'","'3586'").replace('value=3585','value=3586')==new[name],'mechanical:unchanged-'+name
 assert 'pg_dump' not in funcs(helper)['restore'],'mechanical:no-fresh-dump'
 assert "retained_dump()" in helper and "dump=FROZEN/'source-private.dump'" in helper,'mechanical:retained-dump'
def mechanical_runner(text):
 for token,name in [('controller=attest_start_v1.py','host-attestor'),('MemoryMax="$memory"','memory'),('sha256sum --check --strict','seal'),('request-$stage','reservation')]:assert token in text,'runner:'+name
 # Attest branch has no enclosing user-namespace wrapper; active/checkout retain theirs.
 branch=text.split('if [ "$stage" = attest ]; then',1)[1].split('\nfi',1)[0]
 assert '/usr/bin/bwrap' not in branch,'runner:host-context'
 assert '--ro-bind / /' in text,'runner:checkout-ro'

if __name__=='__main__':main()
