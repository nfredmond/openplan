"""Independent copied-code controls. Never dispatch an operating stage or transport."""
import ast
import copy
import difflib
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import patch

PROOF=Path(__file__).resolve().parent
REPO=Path('/home/nathaniel/.t3/worktrees/openplan/t3-1eb9f303')
PUB=REPO/'docs/reviews/2026-10-15-portfolio-skip-preview-v4-preparation'
ROOT=Path('/home/nathaniel/.local/state/openplan/project-portfolio-skip-preview-20261015-v4')
rows=[]
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def record(name,fn,expected=None):
    try:fn()
    except (ValueError,AssertionError,SystemExit) as e:
        assert expected is not None and expected in str(e),(name,type(e).__name__,str(e))
        rows.append({'case':name,'outcome':'REFUSED','reason':expected})
    else:
        assert expected is None, 'missing expected refusal: '+name
        rows.append({'case':name,'outcome':'SURVIVED'})
def check(value,reason):
    if not value:raise ValueError(reason)
def forbidden(*args,**kwargs):raise AssertionError('REAL-TRANSPORT-FORBIDDEN')
def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path)
    module=importlib.util.module_from_spec(spec);sys.modules[name]=module
    spec.loader.exec_module(module);return module
def copied_function(module,name):
    tree=ast.parse(Path(module.__file__).read_text())
    fn=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name==name)
    ns=module.__dict__.copy()
    exec(compile(ast.Module(body=[fn],type_ignores=[]),'<independent-copy:'+name+'>','exec'),ns)
    return ns[name],ns

def main():
    original_env=dict(os.environ)
    before=json.loads((PROOF/'before.json').read_text())
    sys.path.insert(0,str(ROOT))
    try:
        h=load('helper',ROOT/'helper.py')
        a=load('app_binding_v1',ROOT/'app_binding_v1.py')
        t=load('independent_attestor',ROOT/'attest_start_v1.py')
    finally:sys.path.pop(0)
    with ExitStack() as stack:
        # Block process/network/socket writes globally. Only spy objects replace them below.
        stack.enter_context(patch.object(subprocess,'run',forbidden))
        stack.enter_context(patch.object(h.socket,'socket',forbidden))
        stack.enter_context(patch.object(h.urllib.request.OpenerDirector,'open',forbidden))
        stack.enter_context(patch.object(os,'execve',forbidden))
        stack.enter_context(patch.object(h,'sql',forbidden))
        manifest=json.loads((PUB/'manifest.json').read_text())
        def seals(m=manifest):
            check(all(sha(ROOT/n)==v for n,v in m['files'].items()),'seal-byte-mismatch')
        record('seal-harmless-note-survives',lambda:seals({**manifest,'note':'harmless'}))
        bad=copy.deepcopy(manifest);bad['files']['helper.py']='0'*64
        record('seal-changed-helper-refuses',lambda:seals(bad),'seal-byte-mismatch')
        check(sha(PUB/'manifest.json')=='4392388032ad99ffe9fe83adfaa5571c9e23692151b6d6d12f294cc29dfca71a','external-manifest')
        check(sha(ROOT/'operation-files.sha256')=='87f96cec8f07cb737c82ff93907619cc3e8aa9306efb0a578eed29f2ebbb7856','external-seal')
        check(sha(ROOT/'candidate17.sql')==h.MIG_SHA,'candidate17')
        check((ROOT/'candidate17.sql').read_bytes()==(REPO/'openplan/supabase/migrations/20261017000017_portfolio_skip_invalid_classifications.sql').read_bytes(),'candidate17-repo')
        for n in ['helper.py','policy.py','app_binding_v1.py','attest_start_v1.py','run_stage.sh']:
            check((PUB/'templates'/n).read_bytes()==(ROOT/n).read_bytes(),'public-private-template:'+n)
            diff=(PUB/(n+'.patch')).read_text()
            old=Path(diff.splitlines()[0][4:])
            generated=''.join(difflib.unified_diff(old.read_text().splitlines(True),(ROOT/n).read_text().splitlines(True),fromfile=str(old),tofile=n,n=0))
            check(generated==diff,'five-diff-binding:'+n)
        record('private-config-actual-pure-consumer',h.pinned_files)
        record('application-binding-actual-pure-consumer',a.bindings)
        record('new-helper-import-actual-pure-consumer',a.load_recovery)
        record('fixed-dump-actual-pure-consumer',h.retained_dump)
        actualread=h.read
        # R1: Copy the full preservation call chain, with filesystem inventory stand-ins.
        # The actual run function reaches only this no-op subprocess spy.
        seen=[]
        def bus_spy(args,**kw):
            check(args[:3]==['/usr/bin/systemctl','--user','show'],'unexpected-spy-command')
            env=kw.get('env',dict(os.environ))
            seen.append({'hasXDG':bool(env.get('XDG_RUNTIME_DIR')),'hasDBus':bool(env.get('DBUS_SESSION_BUS_ADDRESS'))})
            code=0 if env.get('XDG_RUNTIME_DIR') or env.get('DBUS_SESSION_BUS_ADDRESS') else 1
            return SimpleNamespace(returncode=code,stdout=b'',stderr=b'missing user-bus environment' if code else b'')
        protect,pns=copied_function(h,'protected_web')
        # Successful command acquisition ends before any /proc or receipt access.
        class BusAcquired(Exception):pass
        realrun=h.run
        def only_bus(args,**kw):
            realrun(args,**kw)
            raise BusAcquired()
        pns['run']=only_bus
        preserve,prns=copied_function(h,'preserve');prns['protected_web']=protect
        prns['read']=lambda n:{}
        unchanged,uns=copied_function(h,'unchanged_inputs')
        uns.update(read=lambda n:{},inventory=lambda _: {},preserve=preserve)
        acquire,acns=copied_function(a,'acquire')
        fake=SimpleNamespace(pinned_files=lambda:None,target_check=lambda:None,upgrade_ready=lambda:None,
            verify_services=lambda:{},source_check=lambda:None,unchanged_inputs=unchanged)
        def env_boundary(withxdg):
            fn,ns=copied_function(a,'main')
            ns.update(bindings=lambda:None,load_recovery=lambda:fake,app_values=lambda _:None,acquire=acquire)
            if withxdg:
                # An in-memory candidate repair, not a packet edit.
                text=ast.unparse(ast.parse(Path(a.__file__).read_text()))
                text=text.replace("PYTHONDONTWRITEBYTECODE='1')", "PYTHONDONTWRITEBYTECODE='1', XDG_RUNTIME_DIR='/run/user/'+str(os.getuid()))")
                node=next(x for x in ast.parse(text).body if isinstance(x,ast.FunctionDef) and x.name=='main')
                exec(compile(ast.Module(body=[node],type_ignores=[]),'<memory-repair>','exec'),ns);fn=ns['main']
            with patch.object(sys,'argv',['copied-app','active-check']),patch.object(subprocess,'run',bus_spy):
                try:fn()
                except SystemExit as e:
                    check(e.code==1,'copied-main-exit')
                    check(seen[-1]=={'hasXDG':withxdg,'hasDBus':False},'missing-bus-refusal')
                    return
                except BusAcquired:
                    check(withxdg and seen[-1]['hasXDG'],'bus-restored')
                    return
                raise AssertionError('missing chain')
        # Harmless survivor establishes the spy accepts a bus environment.
        try:
            os.environ['XDG_RUNTIME_DIR']='/run/user/'+str(os.getuid())
            with patch.object(subprocess,'run',bus_spy):protect()
        except BusAcquired:rows.append({'case':'bus-spy-harmless-existing-XDG','outcome':'SURVIVED'})
        record('R1-copied-app-main-missing-bus-confirmed',lambda:env_boundary(False))
        record('R1-copied-app-main-memory-repair-reaches-bus',lambda:env_boundary(True))
        # Attestor main invokes its own copied attest, then real copied acquire chain.
        tf,tns=copied_function(t,'main');tns['attest']=lambda:acquire(fake)
        with patch.object(subprocess,'run',bus_spy):
            try:tf()
            except SystemExit as e:check(e.code==1 and not seen[-1]['hasXDG'],'attestor-bus-refusal')
            else:raise AssertionError('attestor unexpectedly passed')
        rows.append({'case':'R1-copied-attestor-main-missing-bus-confirmed','outcome':'SURVIVED'})
        os.environ.clear();os.environ.update(original_env)
        # R2: actual copied final verifier never invokes preservation or writes a receipt.
        verify,vns=copied_function(h,'verify_services')
        plan=actualread('plan-private.json');trace=[]
        receipts={k:{'id':'spy-'+k,'name':plan['names'][k],'database':h.TARGET} for k in h.p.IMAGES}
        vns.update(pinned_files=lambda:plan,db_check=lambda:trace.append('db_check'),target_check=lambda:trace.append('target_check'),
            upgrade_ready=lambda:trace.append('upgrade_ready'),
            read=lambda n:receipts if n=='service-receipts-private.json' else {k:{} for k in h.p.IMAGES},
            expected_service=lambda *x:{},observed_service=lambda *x:{},health=lambda:trace.append('health'),
            source_check=lambda:(_ for _ in ()).throw(ValueError('source-drift')),
            unchanged_inputs=lambda:(_ for _ in ()).throw(ValueError('protected-drift')),
            write=lambda *x:trace.append('write'))
        record('R2-protected-and-source-drift-not-consumed',verify)
        check(trace==['db_check','target_check','upgrade_ready','health'],'verify-trace')
        # A copied proposed composition must exercise the omitted dependencies.
        record('R2-source-drift-direct-oracle',vns['source_check'],'source-drift')
        record('R2-protected-drift-direct-oracle',vns['unchanged_inputs'],'protected-drift')
        record('R2-candidate-compose-detects-drift',lambda:(verify(),vns['unchanged_inputs']()),'protected-drift')
        # R3: realistic expected checks, note survivor, missing-check refusal,
        # and logically unconditional CHECK constraints retaining the required token.
        e=actualread('upgrade-expectations.json')
        state={'database':h.TARGET,'historyCount':420,'latest':'20261017000017',
            'versions':sorted(e['versions']+['20261017000017']),'body':e['newBody'],
            'priorHistoryDigest':e['history']['digest'],'historySQL':[(ROOT/'candidate17.sql').read_text()],
            'statusConstraint':"CHECK (((decision <> 'create'::text) OR (resolved_status = ANY (ARRAY['draft'::text, 'active'::text, 'on_hold'::text, 'complete'::text])))))",
            'phaseConstraint':"CHECK (((decision <> 'create'::text) OR (resolved_delivery_phase = ANY (ARRAY['scoping'::text, 'analysis'::text, 'engagement'::text, 'programming'::text, 'delivery'::text, 'complete'::text])))))"}
        record('R3-upgrade-state-harmless-note',lambda:h.upgraded({**state,'note':'unchanged'}))
        record('R3-missing-token-refuses',lambda:h.upgraded({**state,'statusConstraint':'CHECK (true)'}),'upgrade-statusConstraint')
        weak={**state,'statusConstraint':"CHECK ((decision <> 'create'::text) OR true)",'phaseConstraint':"CHECK ((decision <> 'create'::text) OR true)"}
        record('R3-unconditional-constraints-accepted',lambda:h.upgraded(weak))
        # Copy the receipt consumer to prove equality to a newly captured bad state
        # does not repair the initial weak check.
        ready,rns=copied_function(h,'upgrade_ready')
        rns.update(read=lambda n:{'target':h.TARGET,'migrationSHA256':h.MIG_SHA,'state':weak},upgrade_state=lambda:weak)
        record('R3-weak-first-readback-and-receipt-accepted',ready)
        # The desired exact comparator can report both a survivor and this fault.
        exact=lambda actual:h.p.exact({k:state[k] for k in ['statusConstraint','phaseConstraint']},actual,'exact-check')
        record('R3-proposed-exact-comparator-harmless',lambda:exact({**state,'note':'ignored'}))
        record('R3-proposed-exact-comparator-rejects-weak',lambda:exact(weak),'exact-check:statusConstraint')
        # Fixed SQL assembly is inspected in memory, never sent to a transport.
        statement=h.upgrade_sql()
        check(statement.startswith('BEGIN;') and statement.endswith('COMMIT;'),'transaction-boundary')
        check(statement.index('upgrade-history419-target')<statement.index((ROOT/'candidate17.sql').read_text())<statement.index('INSERT INTO supabase_migrations.schema_migrations'),'upgrade-order')
        check('upgrade-target-connections' in statement and 'LOCK TABLE supabase_migrations.schema_migrations IN EXCLUSIVE MODE;' in statement,'upgrade-concurrency')
        rows.append({'case':'fixed-upgrade-SQL-assembly-only','outcome':'SURVIVED'})
        # No actual allocation. The engine commands provide atomic collision refusal.
        targetargs=['docker','exec',h.p.DB_ID,'createdb','-T','template0',h.TARGET]
        record('fresh-target-command-shape-harmless',lambda:h.p.safe_parent_command(targetargs,h.TARGET))
        record('old-target-command-shape-refuses',lambda:h.p.safe_parent_command(targetargs,h.p.SOURCE),'target:valid')
    now={p:sha(p) for p in before}
    check(now==before,'sealed-files-changed')
    check(not (ROOT/'candidate').exists() and not list((ROOT/'execution').iterdir()),'operating-stage-evidence')
    result={'subjectCommit':'df968613b36ea221c7ae510e5a0bb7bba046720a','cases':rows,'busSpyObservations':seen,
        'finalVerifierTrace':trace,'sealedImmediateFilesUnchanged':len(before),'all25ManifestFilesMatch':True,
        'fivePublicPrivateTemplatesAndDiffsMatch':True,'candidateAbsent':True,'executionEmpty':True,
        'realTransportsBlocked':True,'environmentRestored':True,
        'blindCategories':['No actual PostgreSQL parsing, restore, transaction, data or ACL verification.',
        'No host user-bus, /proc, namespace, Docker, readiness or port-race runtime test.',
        'No compiler, build, generated declarations, browser or corrected-import journey.',
        'Spies prove Python propagation and call composition, not the real bus error.',
        'Constraint observations are controlled readbacks, not evidence a real target currently has weak checks.']}
    (PROOF/'controls.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'cases':len(rows),'sealedFilesUnchanged':len(before),'findingsConfirmed':['R1','R2','R3'],'realTransportCalls':0}))

if __name__=='__main__':
    saved_environment=dict(os.environ)
    try:main()
    finally:
        os.environ.clear();os.environ.update(saved_environment)
