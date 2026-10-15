"""Real-session race controls and ordinary geometry updates in generated database only."""
import contextlib
import copy
import json
import os
import uuid
from psycopg2.extras import Json
from native_proof import BASE, Proof, write


def run(run_name):
    os.umask(0o077);p=Proof(BASE/run_name);f=p.plan['fixtures']
    out=p.out/('race-controls-'+uuid.uuid4().hex[:10]);out.mkdir(mode=0o700);p.observation_path=out/'observations.json'
    # Each ordering has a harmless SQL-function survivor. No-op mutation is
    # installed/committed only on this generated target, restored in finally.
    with contextlib.closing(p.up()) as c:
        original=p.guard_definition(c)
        try:
            p.query(c,original.replace('BEGIN','BEGIN\n-- harmless concurrency comment',1))
            for change in ('downgrade','revoke'):
                for first in (True,False):p.record('harmless-'+change+'-'+str(first),p.membership_race(change,first))
        finally:p.query(c,original)
        # Dropping FOR SHARE defeats both save-first transition blocks.
        for change in ('downgrade','revoke'):
            try:
                p.query(c,original.replace('FOR SHARE',''))
                failure=None
                try:p.membership_race(change,True)
                except AssertionError as e:failure=str(e)
                assert failure=='save-first '+change+' must block on held membership/project row','missing lock intended '+change
                p.record('lock-omitted-'+change,{'outcome':'killed','assertion':failure})
            finally:p.query(c,original)
        # A second still-authorized owner redirected into the actor predicate
        # defeats the change-first wait itself and allows the unauthorized save.
        for change in ('downgrade','revoke'):
            try:
                p.query(c,original.replace("member.user_id = (NEW.jurisdiction_context->>'recordedBy')::uuid", "member.user_id = '"+f['owner']+"'::uuid"))
                failure=None
                try:p.membership_race(change,False)
                except AssertionError as e:failure=str(e)
                assert failure=='change-first '+change+' must block on held membership/project row','redirected membership intended '+change
                p.record('change-first-wrong-member-'+change,{'outcome':'killed','assertion':failure})
            finally:p.query(c,original)
        assert p.guard_definition(c)==original,'concurrency exact source restoration'
    # Test actual geometry JSON replacement independently of null creation.
    for actor in ('owner','admin','member'):
        def geometry(c,actor=actor):
            p.query(c,'SET LOCAL ROLE authenticated');p.query(c,"select set_config('request.jwt.claims',%s,true)",(json.dumps({'sub':f[actor],'role':'authenticated'}),))
            before=p.row(c,'uploaded');changed=copy.deepcopy(before['place_geometry_geojson']);changed['coordinates'][0][1][0]=0.12345
            try:rows=p.query(c,'update public.projects set place_geometry_geojson=%s where id=%s returning place_geometry_geojson,jurisdiction_context',(Json(changed),f['uploaded']))
            except Exception as e:
                if getattr(e,'pgcode',None)=='42501':raise AssertionError('ordinary geometry replacement must succeed') from e
                raise
            assert len(rows)==1 and rows[0]['place_geometry_geojson']==changed and rows[0]['jurisdiction_context']==before['jurisdiction_context'],'ordinary geometry replacement must succeed'
        def blocked(c,s):
            start="IF (TG_OP = 'INSERT' AND NEW.jurisdiction_context IS NOT NULL)\n    OR (TG_OP = 'UPDATE' AND NEW.jurisdiction_context IS DISTINCT FROM OLD.jurisdiction_context) THEN"
            assert s.count(start)==1;p.query(c,s.replace(start,'IF true THEN'))
        p.control('geometry-harmless-'+actor,lambda c,s:p.query(c,s.replace('BEGIN','BEGIN\n-- harmless geometry comment',1)),geometry,'',True)
        p.control('geometry-overbroad-'+actor,blocked,geometry,'ordinary geometry replacement must succeed')
    # Positive exact-revision and workspace assertions after fault restoration.
    p.record('cas-harmless-query',p.cas());p.record('scope-harmless-query',p.scopes())
    p.ordinary()
    for change in ('downgrade','revoke'):
        for first in (True,False):p.record('restored-'+change+'-'+str(first),p.membership_race(change,first))
    with contextlib.closing(p.up()) as c:write(out/'final-inventory.json',p.inventory(c))
    write(out/'result.json',{'status':'passed','observations':len(p.events),'changesOnlyNewDatabase':True})
    print('EVIDENCE '+str(out))

if __name__=='__main__':
    import sys
    run(sys.argv[1])
