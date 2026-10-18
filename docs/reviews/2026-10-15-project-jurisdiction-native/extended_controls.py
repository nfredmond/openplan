"""Targeted SQL failure controls, confined to generated proof databases."""
import contextlib
import copy
import json
import os
from pathlib import Path
import uuid

from psycopg2.extras import Json
from native_proof import BASE, Proof, write


def run(run_name):
    os.umask(0o077)
    p=Proof(BASE/run_name);f=p.plan['fixtures']
    out=p.out/('extended-'+uuid.uuid4().hex[:10]);out.mkdir(mode=0o700);p.observation_path=out/'observations.json'
    good,unresolved,invalid=p.valid_cases()
    with contextlib.closing(p.up()) as c:
        original=p.query(c,"select pg_get_functiondef('public.valid_project_jurisdiction_context(jsonb)'::regprocedure) d")[0]['d']
        # Every malformed input reaches both the native helper and actual CHECK.
        # A constant-true SQL function must defeat each particular intended assertion.
        for label,value in invalid:
            def probe(c,helper=False,value=value,label=label):
                p.query(c,'SET LOCAL ROLE postgres')
                if helper:
                    result=p.query(c,'select public.valid_project_jurisdiction_context(%s::jsonb) ok',(Json(value),))[0]['ok']
                    assert result is False,'helper rejects '+label
                else:p.error(c,'update public.projects set jurisdiction_context=%s where id=%s',(Json(value),f['race']),'23514','constraint rejects '+label)
            def harmless(c,s):p.query(c,original.replace('BEGIN','BEGIN\n-- harmless validity comment',1))
            def broken(c,s):p.query(c,"CREATE OR REPLACE FUNCTION public.valid_project_jurisdiction_context(value jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS 'SELECT true'")
            for helper in (True,False):
                mode='helper' if helper else 'constraint'
                p.control('valid-'+mode+'-'+label,harmless,lambda c:probe(c,helper),'',True)
                p.control('broken-'+mode+'-'+label,broken,lambda c:probe(c,helper),('helper rejects ' if helper else 'constraint rejects ')+label)
        assert p.query(c,"select pg_get_functiondef('public.valid_project_jurisdiction_context(jsonb)'::regprocedure) d")[0]['d']==original,'validity exact installed restoration'
    def read(c):
        p.query(c,'SET LOCAL ROLE authenticated');p.query(c,"select set_config('request.jwt.claims',%s,true)",(json.dumps({'sub':f['outsider'],'role':'authenticated'}),))
        assert p.query(c,'select id from public.projects where id=%s',(f['race'],))==[],'nonmember RLS read must be empty'
    p.control('rls-harmless',lambda c,s:p.query(c,'comment on table public.projects is %s',('harmless proof comment',)),read,'',True)
    p.control('rls-disabled',lambda c,s:p.query(c,'alter table public.projects disable row level security'),read,'nonmember RLS read must be empty')
    # Challenge the INSERT restore seam with the guard already installed.
    def trusted(c):
        p.query(c,'SET LOCAL ROLE postgres')
        original=p.row(c,'searched');row=copy.deepcopy(original);row['id']=str(uuid.uuid4())
        p.query(c,'insert into public.projects select (jsonb_populate_record(null::public.projects,%s::jsonb)).*',(Json(row),))
        got=p.query(c,'select to_jsonb(p) row from public.projects p where id=%s',(row['id'],))[0]['row']
        assert got==row,'trusted INSERT must preserve all provenance revision geometry'
    p.control('trusted-insert-harmless',lambda c,s:p.query(c,s.replace('BEGIN','BEGIN\n-- harmless trusted INSERT comment',1)),trusted,'',True)
    for label,sql in [('actor',"NEW.jurisdiction_context := jsonb_set(NEW.jurisdiction_context,'{recordedBy}',to_jsonb('"+f['member']+"'::text));"),
                      ('time',"NEW.jurisdiction_context := jsonb_set(NEW.jurisdiction_context,'{recordedAt}',to_jsonb(clock_timestamp()));"),
                      ('revision',"NEW.updated_at := clock_timestamp();"),
                      ('geometry',"NEW.place_geometry_geojson := '{\"type\":\"Polygon\",\"coordinates\":[[[0,0],[1,0],[1,1],[0,0]]]}'::jsonb;")]:
        def install(c,s,sql=sql):
            assert s.count('RETURN NEW;')==1
            p.query(c,s.replace('RETURN NEW;',"IF TG_OP='INSERT' THEN "+sql+' END IF; RETURN NEW;'))
        p.control('trusted-insert-'+label+'-corrupted',install,trusted,'trusted INSERT must preserve all provenance revision geometry')
    # Harmless and broken role-custody controls use only session identity changes.
    # No cluster-wide grant or global role changes are permitted.
    for role in ('anon','authenticated'):
        for privileged in ('postgres','service_role','supabase_admin'):
            with contextlib.closing(p.up(role)) as c,p.transaction(c):
                p.error(c,'SET LOCAL ROLE '+privileged,(),'42501','role custody refusal')
            with contextlib.closing(p.up()) as c,p.transaction(c):
                caught=None
                try:p.error(c,'SET LOCAL ROLE '+privileged,(),'42501','role custody refusal')
                except AssertionError as e:caught=str(e)
                assert caught=='role custody refusal: expected SQLSTATE 42501, observed None','wrong session custody intended failure'
            p.record('role-custody-control-'+role+'-'+privileged,{'harmless':'survived','brokenPrivilegedSession':'killed','assertion':caught,'globalRoleChange':False})
    # Ordinary null creation/geometry updates must survive the narrow context guard.
    for actor in ('owner','admin','member'):
        def ordinary(c,actor=actor):
            p.query(c,'SET LOCAL ROLE authenticated');p.query(c,"select set_config('request.jwt.claims',%s,true)",(json.dumps({'sub':f[actor],'role':'authenticated'}),))
            try:
                rows=p.query(c,"insert into public.projects(workspace_id,name) values(%s,'ordinary mutation control') returning jurisdiction_context",(f['workspace'],))
                assert rows==[{'jurisdiction_context':None}],'ordinary null creation must work'
                before=p.row(c,'uploaded')
                rows=p.query(c,"update public.projects set place_label='ordinary geometry control' where id=%s returning jurisdiction_context",(f['uploaded'],))
                assert len(rows)==1 and rows[0]['jurisdiction_context']==before['jurisdiction_context'],'ordinary geometry must preserve context'
            except Exception as e:
                if getattr(e,'pgcode',None)=='42501':raise AssertionError('ordinary null and geometry must remain writable') from e
                raise
        def broken(c,s):
            start="IF (TG_OP = 'INSERT' AND NEW.jurisdiction_context IS NOT NULL)\n    OR (TG_OP = 'UPDATE' AND NEW.jurisdiction_context IS DISTINCT FROM OLD.jurisdiction_context) THEN"
            assert s.count(start)==1
            p.query(c,s.replace(start,'IF true THEN'))
        p.control('ordinary-harmless-'+actor,lambda c,s:p.query(c,s.replace('BEGIN','BEGIN\n-- harmless ordinary guard comment',1)),ordinary,'',True)
        p.control('ordinary-overbroad-'+actor,broken,ordinary,'ordinary null and geometry must remain writable')
    # Service INSERT gets the same current-writer attribution and database clock as UPDATE.
    with contextlib.closing(p.up('service_role')) as c,p.transaction(c):
        lower=p.query(c,'select clock_timestamp() t')[0]['t']
        rows=p.query(c,"insert into public.projects(workspace_id,name,jurisdiction_context) values(%s,'service insert',%s) returning jurisdiction_context",(f['workspace'],Json(p.context(f['member']))))
        import datetime as dt
        assert dt.datetime.fromisoformat(rows[0]['jurisdiction_context']['recordedAt'])>=lower,'service INSERT stamps database time'
        p.record('service-insert',rows)
    # Broader direct guard control repeats each real actor and each operation.
    for actor in ('owner','admin','member'):
        for operation in ('INSERT','UPDATE'):
            def direct(c,actor=actor,operation=operation):
                p.query(c,'SET LOCAL ROLE authenticated');p.query(c,"select set_config('request.jwt.claims',%s,true)",(json.dumps({'sub':f[actor],'role':'authenticated'}),))
                if operation=='INSERT':sql="insert into public.projects(workspace_id,name,jurisdiction_context) values(%s,'forged',%s)";params=(f['workspace'],Json(p.context(f['foreignActor'])))
                else:sql='update public.projects set jurisdiction_context=%s where id=%s';params=(Json(p.context(f['foreignActor'])),f['race'])
                p.error(c,sql,params,'42501','direct '+actor+' '+operation+' refuses')
            p.control('direct-harmless-'+actor+'-'+operation,lambda c,s:p.query(c,s.replace('BEGIN','BEGIN\n-- harmless direct guard comment',1)),direct,'',True)
            p.control('direct-removed-'+actor+'-'+operation,lambda c,s:p.query(c,s.replace("IF current_user NOT IN ('service_role', 'postgres') THEN",'IF false THEN')),direct,'direct '+actor+' '+operation+' refuses')
    # Final real invariants after all rollback and finally restoration.
    p.reads();p.ordinary();p.record('final-membership-race',p.membership_race('downgrade',True));p.record('final-cas',p.cas())
    with contextlib.closing(p.up()) as c:write(out/'final-inventory.json',p.inventory(c))
    write(out/'result.json',{'status':'passed','observations':len(p.events),'noGlobalRoleMutations':True,'runnerSqlOnlyInGeneratedDatabase':True})
    print('EVIDENCE '+str(out))

if __name__=='__main__':
    import sys
    run(sys.argv[1])
