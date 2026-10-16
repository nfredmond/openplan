"""NEW author pure text checks. Run only in the separately granted finite window.

Literal expectations do not call the builder's membership/UUID helpers.
This is not a SQL parser, native row reader, role or transport acceptance suite.
"""
from copy import deepcopy
import ast
import hashlib
import json
from pathlib import Path
import re
import build
import readback

ROOT = Path(__file__).parent
UIDS = ('f174c91a-36e5-4477-90a5-5017b188f314', 'fc66d23b-981a-49cc-9cb9-a7822d405fa3',
        'dec579c4-fc71-44cc-b377-953309df0446', 'cf41d6a7-dc13-4c6b-a330-d7debe344d94',
        'a786239d-a557-4145-ab6e-30a93c155ba2', '465906f8-7d27-4794-8db2-1cb517652a32',
        'a86c371d-d014-4c43-a09b-f91823b8ad4c', '91c0f81f-46d0-48de-9652-59229cc7da91',
        'd3194ec6-df7c-4917-b747-2e090a2c78fb')
A = '5dcfd625-1d54-483b-b918-8490deab63f1'
B = 'b207943e-6853-49de-9b9d-205481a69c0c'
TARGET = 'openplan_budget_native_9c47bd610f2a49e8a35c706d'
ALLOCATION = {'database': TARGET, 'databaseOid': 900001, 'systemIdentifier': '7000000000000000011',
              'adminSessionOid': 900002, 'adminEffectiveOid': 900003,
              'authenticatedOid': 900004, 'ordinarySessionOid': 900005,
              'lease': '55961ce3-27ae-45ca-b52d-e20262b393d5', 'exclusive': True,
              'rootRecordSha256': 'a' * 64, 'orderedHistorySha256': 'b' * 64,
              'catalogSha256': 'c' * 64, 'source': 'd0d12c406df8b8fd29bd2611a9cb29d8c3168ab8',
              'app': '44e638d6d79378042343bf5b18408f09ee991d57', 'status': 'SUPPLIED_FOR_TEXT_ONLY'}


def insist(value, label):
    if not value:
        raise AssertionError(label)


def check(out, builder_source=None):
    sql = out['provision.sql']
    user_block = sql.split('FROM (VALUES\n', 1)[1].split('\n) AS v(id,email,meta)', 1)[0]
    rows = re.findall(r"^\('([^']+)','([^']+)','([^']+)'\)[,]?$", user_block, re.M)
    insist(tuple(r[0] for r in rows) == UIDS and len(rows) == 9, 'literal-user-uuid-set')
    names = ('a_owner','a_owner2','a_admin','a_member','a_viewer','b_only','dual','outsider','revocable')
    for actor, row in zip(names, rows):
        insist(row[1] == actor + '-' + row[0] + '@budget-native.invalid' and
               json.loads(row[2]) == {'org_name': 'SYNTHETIC budget caller ' + actor}, 'synthetic-user-shape')
    block = sql.split('INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES\n', 1)[1].split('\nRETURNING *;', 1)[0]
    actual = sorted(re.findall(r"\('([^']+)','([^']+)','([^']+)'\)", block))
    expected = sorted([(A,UIDS[0],'owner'),(A,UIDS[1],'owner'),(A,UIDS[2],'admin'),
                       (A,UIDS[3],'member'),(A,UIDS[4],'viewer'),(A,UIDS[6],'admin'),
                       (A,UIDS[8],'member'),(B,UIDS[5],'owner'),(B,UIDS[6],'admin')])
    insist(actual == expected, 'literal-membership-roleset')
    for name in ('identity.sql','provision.sql'):
        text = out[name]
        insist("current_database() IS DISTINCT FROM '" + TARGET + "'" in text and
               'IS DISTINCT FROM 900001::oid' in text, 'target-name-positive-oid-guard')
        insist("system_identifier::text FROM pg_control_system()) IS DISTINCT FROM '7000000000000000011'" in text,
               'exact-system-guard')
        insist('IS DISTINCT FROM 900002::oid' in text and 'IS DISTINCT FROM 900003::oid' in text,
               'exact-admin-actor-guard')
        insist(all("current_setting('openplan.budget_" + key + "',true) IS DISTINCT FROM '" + val + "'" in text
                    for key,val in [('lease','55961ce3-27ae-45ca-b52d-e20262b393d5'),
                                    ('root_sha','a'*64),('history_sha','b'*64),('catalog_sha','c'*64)]),
               'external-record-binding-guard')
    insist("tgname='on_auth_user_created' AND tgenabled='O'" in sql and
           "current_setting('session_replication_role') <> 'origin'" in sql and
           "tgfoid='public.handle_new_user()'::regprocedure" in sql, 'active-signup-trigger-guard')
    insist("'automatic_workspaces' AS receipt,m.user_id,to_jsonb(w) AS workspace,to_jsonb(m) AS membership" in sql
           and 'w.slug IS DISTINCT FROM' in sql and "m.role<>'owner'" in sql, 'automatic-sideeffect-row-receipt')
    insist(all("'" + label + "' AS receipt" in sql for label in
               ('before_workspaces','before_members','before_users','after_workspaces','after_members','after_users',
                'before_cutoff_changes','before_cutoff_deletions','after_cutoff_changes','after_cutoff_deletions',
                'before_baselines','after_baselines')),
           'complete-before-after-selected-rows')
    caller = out['ordinary.sql']
    insist('auth.uid() IS NULL OR NOT auth.uid()=ANY(' in caller and "current_user <> 'authenticated'" in caller
           and 'rolsuper OR rolbypassrls' in caller and 'NOT relrowsecurity OR relowner=900004::oid' in caller,
           'ordinary-effective-rls-context')
    aliases = json.loads(out['r2-prerequisites.json'])
    insist(aliases['owner'] == UIDS[6] and aliases['assignee'] == UIDS[3] and
           aliases['actualCreatorRoleA'] == aliases['actualCreatorRoleB'] == 'admin', 'honest-creator-assignee-aliases')
    combined = '\n'.join(out.values())
    insist('@@' not in combined and not re.search(r'\b(GRANT|REVOKE|CREATE ROLE|ALTER ROLE|DISABLE TRIGGER|CREATE POLICY)\b', combined),
           'no-schema-role-policy-grant-text')
    source = (ROOT/'build.py').read_text() if builder_source is None else builder_source
    tree = ast.parse(source)
    imports = {alias.name for n in ast.walk(tree) if isinstance(n,ast.Import) for alias in n.names}
    imports |= {n.module for n in ast.walk(tree) if isinstance(n,ast.ImportFrom)}
    insist(imports == {'json','pathlib','re','uuid'} and not re.search(r'\b(exec|eval|compile|__import__)\s*\(', source),
           'text-only-builder-imports')


def main():
    originals = {p.name:p.read_bytes() for p in ROOT.iterdir() if p.is_file()}
    m = json.loads((ROOT/'manifest.json').read_text())
    base = build.render(m, ALLOCATION)
    check(base)
    work = ROOT.parent/'working.json'
    baseline_bytes = (json.dumps(base, sort_keys=True)+'\n').encode()
    work.write_bytes(baseline_bytes)
    result = {'claim':'NEW_AUTHOR_PURE_TEXT_ONLY', 'mutations':[], 'allocationFaults':[]}
    try:
        harmless = deepcopy(base)
        harmless['provision.sql'] = '-- Harmless review comment.\n'+harmless['provision.sql']
        check(harmless)
        result['mutations'].append({'name':'harmless-comment','outcome':'SURVIVED'})
        faults = [
          ('wrong-uuid','literal-user-uuid-set','provision.sql',"('"+UIDS[0]+"','a_owner-","('"+UIDS[1]+"','a_owner-"),
          ('viewer-promoted','literal-membership-roleset','provision.sql',"'"+UIDS[4]+"','viewer'","'"+UIDS[4]+"','member'"),
          ('wrong-target-oid','target-name-positive-oid-guard','provision.sql','IS DISTINCT FROM 900001::oid','IS DISTINCT FROM 0::oid'),
          ('wrong-system','exact-system-guard','provision.sql','7000000000000000011','7000000000000000012'),
          ('wrong-admin','exact-admin-actor-guard','provision.sql','IS DISTINCT FROM 900003::oid','IS DISTINCT FROM 900004::oid'),
          ('missing-record-binding','external-record-binding-guard','provision.sql','budget_catalog_sha','budget_wrong_sha'),
          ('disabled-trigger-accepted','active-signup-trigger-guard','provision.sql',"tgenabled='O'","tgenabled='D'"),
          ('lost-auto-rows','automatic-sideeffect-row-receipt','provision.sql',"'automatic_workspaces' AS receipt","'quantity_only' AS receipt"),
          ('lost-before','complete-before-after-selected-rows','provision.sql',"'before_members' AS receipt","'quantity_only' AS receipt"),
          ('bypass-caller','ordinary-effective-rls-context','ordinary.sql','rolsuper OR rolbypassrls','rolsuper'),
          ('false-owner-alias','honest-creator-assignee-aliases','r2-prerequisites.json','"actualCreatorRoleA": "admin"','"actualCreatorRoleA": "owner"'),
          ('grant-fix','no-schema-role-policy-grant-text','provision.sql','-- No follow-on operation.','GRANT SELECT ON public.projects TO authenticated; --')]
        for name,label,key,old,new in faults:
            altered=deepcopy(base)
            insist(old in altered[key], 'mutation-input-'+name)
            altered[key]=altered[key].replace(old,new,1)
            failure=None
            try:
                work.write_text(json.dumps(altered))
                check(json.loads(work.read_text()))
            except AssertionError as error:
                failure=str(error)
            finally:
                work.write_bytes(baseline_bytes)
            insist(failure==label,'wrong-or-missing-reason-'+name)
            result['mutations'].append({'name':name,'outcome':'KILLED','reason':failure})
        inputs = [('oid-bool','databaseOid',True,'positive-typed-oid-databaseOid'),
                  ('oid-zero','databaseOid',0,'positive-typed-oid-databaseOid'),
                  ('system-zero','systemIdentifier','0','positive-system-identifier'),
                  ('foreign-target','database','openplan_a0_limit_c2e1f4598374c1bf439baa3b','allocation-target-exclusive'),
                  ('not-exclusive','exclusive',False,'allocation-target-exclusive'),
                  ('source-rebind','app','0'*40,'source-binding'),
                  ('admin-as-ordinary','authenticatedOid',900003,'ordinary-admin-separation')]
        for name,key,value,label in inputs:
            altered=deepcopy(ALLOCATION); altered[key]=value
            failure=None
            try:
                build.render(m,altered)
            except ValueError as error:
                failure=str(error)
            insist(failure==label,'wrong-allocation-reason-'+name)
            result['allocationFaults'].append({'name':name,'reason':failure})
        failure=None
        try: check(base,(ROOT/'build.py').read_text()+'\nimport socket\n')
        except AssertionError as error: failure=str(error)
        insist(failure=='text-only-builder-imports','wrong-transport-source-reason')
        result['mutations'].append({'name':'transport-import-text','outcome':'KILLED','reason':failure})
        for name,key,value,label in [
            ('admitted-manifest','status','ADMITTED','proposal-status'),
            ('wrong-member-role','memberships',m['memberships'][:-1]+[['B','dual','viewer']],'membership-exact-set'),
            ('false-creator-role','generatorAliases',{'owner':'a_owner','assignee':'a_member'},'actor-aliases'),
            ('native-claim','nativeAdmission',{},'no-native-claim')]:
            altered=deepcopy(m); altered[key]=value
            failure=None
            try: build.render(altered,ALLOCATION)
            except ValueError as error: failure=str(error)
            insist(failure==label,'wrong-manifest-reason-'+name)
            result['allocationFaults'].append({'name':name,'reason':failure})
        names = ('a_owner','a_owner2','a_admin','a_member','a_viewer','b_only','dual','outsider','revocable')
        before={'users':[], 'workspaces':[], 'members':[], 'cutoffChanges':[], 'cutoffDeletions':[], 'baselines':[]}
        after=deepcopy(before)
        for i,(name,ident) in enumerate(zip(names,UIDS)):
            wid='00000000-0000-4000-8000-'+str(i+1).zfill(12)
            after['users'].append({'id':ident,'aud':'authenticated','role':'authenticated',
                'email':name+'-'+ident+'@budget-native.invalid','raw_app_meta_data':{},
                'raw_user_meta_data':{'org_name':'SYNTHETIC budget caller '+name},
                'created_at':'SYNTHETIC_TIMESTAMP','updated_at':'SYNTHETIC_TIMESTAMP'})
            after['workspaces'].append({'id':wid,'name':'SYNTHETIC budget caller '+name,
                'slug':'synthetic-budget-caller-'+name.replace('_','-')+'-'+ident[:8]})
            after['members'].append({'workspace_id':wid,'user_id':ident,'role':'owner','joined_at':'SYNTHETIC_TIMESTAMP'})
        for name,wid in [('a',A),('b',B)]:
            after['workspaces'].append({'id':wid,'name':'SYNTHETIC budget '+name.upper(),
                'slug':'synthetic-budget-'+name+'-9c47bd610f2a49e8a35c706d'})
        for wid,ident,role in [(A,UIDS[0],'owner'),(A,UIDS[1],'owner'),(A,UIDS[2],'admin'),
            (A,UIDS[3],'member'),(A,UIDS[4],'viewer'),(A,UIDS[6],'admin'),(A,UIDS[8],'member'),
            (B,UIDS[5],'owner'),(B,UIDS[6],'admin')]:
            after['members'].append({'workspace_id':wid,'user_id':ident,'role':role,'joined_at':'SYNTHETIC_TIMESTAMP'})
        automatic=readback.prerequisite_rows(before,after)
        for ident in UIDS:
            own=[r for r in after['members'] if r['user_id']==ident]
            visible={r['workspace_id'] for r in own}
            supplied={'members':deepcopy(own),
                'workspaces':[r for r in after['workspaces'] if r['id'] in visible],
                'writerEligibility':{r['workspace_id']:r['role'] in ('owner','admin','member')
                                      for r in own if r['workspace_id'] in (A,B)}}
            readback.ordinary_rows(ident,automatic,supplied,after)
        for name,label in [('outsider-extra-membership','readback-ordinary-own-memberships'),
                           ('viewer-write-eligibility','readback-ordinary-writer-roleset')]:
            ident=UIDS[7] if name=='outsider-extra-membership' else UIDS[4]
            own=[r for r in after['members'] if r['user_id']==ident]
            visible={r['workspace_id'] for r in own}
            altered={'members':deepcopy(own),
                'workspaces':[r for r in after['workspaces'] if r['id'] in visible],
                'writerEligibility':{} if ident==UIDS[7] else {A:False}}
            if name=='outsider-extra-membership': altered['members'].append(deepcopy(after['members'][-1]))
            else: altered['writerEligibility'][A]=True
            failure=None
            try: readback.ordinary_rows(ident,automatic,altered,after)
            except AssertionError as error: failure=str(error)
            insist(failure==label,'wrong-caller-reason-'+name)
            result['mutations'].append({'name':name,'outcome':'KILLED','reason':failure})
        result['suppliedCallerCases']=9
        for name,label in [('lost-auto','readback-one-automatic-owner-per-user'),
                           ('wrong-auto-slug','readback-auto-name-slug'),
                           ('cutoff-sideeffect','readback-cutoff-rows-preserved'),
                           ('unexpected-baseline','readback-new-workspace-baseline-absence')]:
            altered=deepcopy(after)
            if name=='lost-auto': altered['members'].pop(0)
            elif name=='wrong-auto-slug': altered['workspaces'][0]['slug']='wrong-slug'
            elif name=='cutoff-sideeffect': altered['cutoffChanges'].append({'id':'SYNTHETIC_UNEXPECTED_CUTOFF'})
            else: altered['baselines'].append({'id':'SYNTHETIC_UNEXPECTED_BASELINE'})
            failure=None
            try: readback.prerequisite_rows(before,altered)
            except AssertionError as error: failure=str(error)
            insist(failure==label,'wrong-sideeffect-reason-'+name)
            result['mutations'].append({'name':name,'outcome':'KILLED','reason':failure})
        check(build.render(m,ALLOCATION))
        for name,data in base.items():
            (ROOT.parent/('emitted-'+name)).write_text(data)
    finally:
        work.write_bytes(baseline_bytes)
        result['workingRestoredExact']=work.read_bytes()==baseline_bytes
        result['subjectRestoredExact']=originals=={p.name:p.read_bytes() for p in ROOT.iterdir() if p.is_file()}
        (ROOT.parent/'results.json').write_text(json.dumps(result,indent=2)+'\n')
    insist(result['workingRestoredExact'] and result['subjectRestoredExact'],'restoration')
    print(json.dumps(result))


if __name__ == '__main__':
    main()
