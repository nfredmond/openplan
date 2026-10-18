"""Finite SQL case builders. Every call owns a rollback transaction."""
import copy
import json
from fixture import literal as L, jsql as J, receipt, finish, packet, provider_plan
import policy as p

SCOPE = ['userId','workspaceId','projectId','connectionId','requestId','turnId','attemptId','packetHash','model','authMode']
CASES = ['configuration','shadow','limited','reported-reset','exact-replay','changed-replay',
    'wrong-token','cross-connection','ambiguous-actor','revoked','expired-connection','membership-removed',
    'project-moved','stale-attempt','expired-lease','cancelled','answer-with-failure','arbitrary-failure',
    'invalid-version','extra-private-field','invalid-reset','invalid-reset-source','invalid-native-id',
    'claude-refusal','opencode-refusal','anthropic-refusal','v1-success','v1-proposal','v1-bad-proposal',
    'v1-changed-replay','api-success','api-exact-replay','api-changed-replay','api-v2-refusal','api-failure',
    'api-ambiguous','reader-wrong-actor','rls-owner','rls-other-actor','rls-anon-refusal'] + ['scope-'+x for x in SCOPE]
MUTATIONS = ['harmless','finish-path','validator-path','validator-accept-all','finish-drop-receipt']


def assert_true(expression, label):
    return 'SELECT pg_temp.assert_true('+expression+','+L(label)+');'


def expect(expression, state, label):
    return 'SELECT pg_temp.expect_state('+L('SELECT '+expression)+','+L(state)+','+L(label)+');'


def configuration():
    q = []
    for name, definer, volatility in [(p.FINISH, True, 'v'), (p.VALIDATOR, False, 'i')]:
        q.append(assert_true(f"(SELECT proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp'] AND prosecdef={str(definer).lower()} AND provolatile='{volatility}' AND pg_get_userbyid(proowner)='postgres' FROM pg_proc WHERE oid={L(name)}::pg_catalog.regprocedure)", 'installed-config-'+name))
        q.append(assert_true(f"has_function_privilege('service_role',{L(name)},'EXECUTE') AND NOT has_function_privilege('anon',{L(name)},'EXECUTE') AND NOT has_function_privilege('authenticated',{L(name)},'EXECUTE')", 'installed-grants-'+name))
    for role in ['anon','authenticated']:
        q.append("DO $deny$ BEGIN EXECUTE 'SET LOCAL ROLE "+role+"'; BEGIN PERFORM public.valid_assistant_native_limit_receipt(NULL::pg_catalog.jsonb,NULL::public.assistant_provider_turns); RAISE EXCEPTION 'a0-role-validator-accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; BEGIN PERFORM public.finish_assistant_provider_turn(NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL); RAISE EXCEPTION 'a0-role-finish-accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; EXECUTE 'RESET ROLE'; END $deny$;")
    return '\n'.join(q)


def mutation_sql(name, sql18):
    if name == 'harmless':
        return '-- harmless native comment control\n'
    if name in ['finish-path','validator-path']:
        fn = p.FINISH if name == 'finish-path' else p.VALIDATOR
        return 'ALTER FUNCTION '+fn+' SET search_path=pg_catalog,public;'
    if name == 'validator-accept-all':
        return "CREATE OR REPLACE FUNCTION public.valid_assistant_native_limit_receipt(receipt pg_catalog.jsonb,job public.assistant_provider_turns) RETURNS pg_catalog.bool LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN RETURN true; END $$;"
    if name == 'finish-drop-receipt':
        old = 'provider_receipt=p_provider_receipt,'
        p.require(sql18.count(old) == 2, 'native-mutation-anchor')
        # Only the failure storage assignment changes; success stays untouched.
        return sql18[sql18.index('CREATE OR REPLACE FUNCTION public.finish_assistant_provider_turn'):].replace(old,'provider_receipt=NULL,',1)
    raise ValueError('native-mutation-name')


def body(name, plan):
    p.require(name in CASES, 'case-name')
    i = plan['fixture']; r = receipt(plan); turn = L(i['turn'])
    validator = lambda x: 'public.valid_assistant_native_limit_receipt('+J(x)+f', (SELECT t FROM public.assistant_provider_turns t WHERE id={turn}))'
    limited = finish(plan)
    if name == 'configuration':
        return configuration()
    if name in ['shadow','limited','reported-reset','exact-replay','changed-replay']:
        if name == 'reported-reset':
            r['signal'].update(resetAtUnixSeconds=1800000000,resetSource='account_rate_limits')
            limited = finish(plan,report=J(r))
        q = [assert_true(validator(r),'valid-receipt'),
             'CREATE TEMP TABLE a0_saved(value pg_catalog.jsonb) ON COMMIT DROP;',
             'INSERT INTO a0_saved SELECT '+limited+';',
             assert_true("(SELECT value->>'state'='failed' AND value->'result'='null'::pg_catalog.jsonb AND value->'provider_receipt'="+J(r)+' FROM a0_saved)', 'retained-limited')]
        if name in ['shadow','exact-replay','changed-replay']:
            q.append(assert_true(limited+'=(SELECT value FROM a0_saved)','exact-replay'))
        if name == 'changed-replay':
            r['nativeTurnId']='different-owned-turn'
            q.append(expect(finish(plan,report=J(r)),'PT409','changed-replay'))
        return '\n'.join(q)
    if name.startswith('scope-'):
        key = name[6:]; r[key] = 'mismatched'
        return assert_true('NOT '+validator(r),name)+'\n'+expect(finish(plan,report=J(r)),'22023',name)
    invalid = {'invalid-version':('schemaVersion',1),'extra-private-field':('private','canary'),
        'invalid-native-id':('nativeThreadId','bad/id')}
    if name in invalid or name in ['invalid-reset','invalid-reset-source']:
        if name in invalid:
            key, value = invalid[name]; r[key] = value
        elif name == 'invalid-reset':
            r['signal'].update(resetAtUnixSeconds=253402300800,resetSource='account_rate_limits')
        else:
            r['signal']['resetSource']='account_rate_limits'
        return assert_true('NOT '+validator(r),name)+'\n'+expect(finish(plan,report=J(r)),'22023',name)
    if name == 'wrong-token':
        return expect(finish(plan,token=L('0'*64)),'42501',name)
    if name == 'cross-connection':
        import hashlib
        return expect(finish(plan,connection=L(i['otherConnection']),token=L(hashlib.sha256((plan['tokenHash']+'other').encode()).hexdigest())),'42501',name)
    if name == 'ambiguous-actor':
        return expect(finish(plan,actor=L(i['otherActor'])),'42501',name)
    changes = {
        'revoked': f"UPDATE public.assistant_provider_connections SET revoked_at=clock_timestamp() WHERE id={L(i['connection'])};",
        'expired-connection': f"UPDATE public.assistant_provider_connections SET created_at=clock_timestamp()-interval '2 days',expires_at=clock_timestamp()-interval '1 day' WHERE id={L(i['connection'])};",
        'membership-removed':f"DELETE FROM public.workspace_members WHERE user_id={L(i['actor'])} AND workspace_id={L(i['workspace'])};",
        'project-moved':f"UPDATE public.projects SET workspace_id={L(i['otherWorkspace'])} WHERE id={L(i['project'])};",
        'cancelled':f"SELECT public.cancel_assistant_provider_turn({turn},{L(i['actor'])});"}
    if name in changes:
        return changes[name]+'\n'+expect(limited,'PT409' if name == 'cancelled' else '42501',name)
    if name == 'stale-attempt':
        return expect(finish(plan,attempt=i['apiAttempt']),'42501',name)
    if name == 'expired-lease':
        return f"UPDATE public.assistant_provider_turns SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id={turn};\n"+assert_true("("+limited+")->>'state'='interrupted'",name)+assert_true(f"(SELECT provider_receipt IS NULL FROM public.assistant_provider_turns WHERE id={turn})",'expired-no-receipt')
    if name == 'answer-with-failure':
        return expect(finish(plan,result=J({'answer':'not null'})),'22023',name)
    if name == 'arbitrary-failure':
        return expect(finish(plan,code="'native_other_failure'"),'22023',name)
    if name in ['claude-refusal','opencode-refusal']:
        selected=provider_plan(plan,name.split('-')[0])
        owned_turn=L(selected['fixture']['turn'])
        refusal='public.valid_assistant_native_limit_receipt('+J(receipt(selected))+f', (SELECT t FROM public.assistant_provider_turns t WHERE id={owned_turn}))'
        return assert_true('NOT '+refusal,name)+expect(finish(selected),'22023',name)
    if name=='anthropic-refusal':
        q=f"UPDATE public.assistant_provider_turns SET provider='anthropic',auth_mode='workspace_api_key',connection_id=NULL WHERE id={turn};\n"
        return q+assert_true('NOT '+validator(r),name)+expect(finish(plan,actor=L(i['actor']),connection='NULL',token='NULL'),'22023',name)
    if name == 'reader-wrong-actor':
        return expect(f"public.read_assistant_provider_turn_for_user({turn},{L(i['otherActor'])})",'42501',name)
    if name in ['rls-owner','rls-other-actor']:
        actor=i['actor'] if name=='rls-owner' else i['otherActor']
        return "SELECT set_config('request.jwt.claim.sub',"+L(actor)+",true); SET LOCAL ROLE authenticated;\n"+assert_true('auth.uid()='+L(actor)+'::pg_catalog.uuid','actual-auth-uid')+assert_true(f'(SELECT count(*) FROM public.assistant_provider_turns WHERE id={turn})='+('1' if name=='rls-owner' else '0'),name)
    if name=='rls-anon-refusal':
        return "DO $anon$ BEGIN EXECUTE 'SET LOCAL ROLE anon'; BEGIN PERFORM 1 FROM public.assistant_provider_turns WHERE id="+turn+"; RAISE EXCEPTION 'a0-anon-table-read-accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; EXECUTE 'RESET ROLE'; END $anon$;"
    if name.startswith('v1-'):
        result={'answer':'Owned answer','citations':[packet(i)['source']],'proposal':None}
        if 'proposal' in name:
            result['proposal']={'status':'proposed','kind':'create_project_record','payload':{'kind':'create_project_record','recordType':'submittal','projectId':i['project'] if name=='v1-proposal' else i['otherProject'],'title':'Owned draft','status':'draft'}}
        v1={'schemaVersion':1,'provider':'codex','model':'owned-model','authMode':'chatgpt'}
        call=finish(plan,result=J(result),report=J(v1),code='NULL')
        if name=='v1-bad-proposal':
            return expect(call,'22023',name)
        q='CREATE TEMP TABLE a0_saved(value pg_catalog.jsonb) ON COMMIT DROP; INSERT INTO a0_saved SELECT '+call+';\n'
        q+=assert_true("(SELECT value->>'state'='succeeded' AND value->'result'="+J(result)+" AND value->'provider_receipt'="+J(v1)+' FROM a0_saved)',name)
        q+=assert_true(call+'=(SELECT value FROM a0_saved)','v1-exact-replay')
        if name=='v1-changed-replay':
            result['answer']='Changed answer'
            q+=expect(finish(plan,result=J(result),report=J(v1),code='NULL'),'PT409',name)
        return q
    if name.startswith('api-'):
        # The fixture's immutable API snapshot supplies exact saved identities.
        call="public.finish_assistant_provider_turn(j.id,j.attempt_id,j.user_id,NULL,NULL,res,rep,fail)"
        setup=f"DECLARE j public.assistant_provider_turns; res pg_catalog.jsonb; rep pg_catalog.jsonb; fail pg_catalog.text; saved pg_catalog.jsonb; BEGIN SELECT * INTO STRICT j FROM public.assistant_provider_turns WHERE id={L(i['apiTurn'])}; "
        setup+="res:=jsonb_build_object('answer','Owned API answer','citations',jsonb_build_array(j.packet->'source'),'proposal',NULL); rep:=jsonb_build_object('schemaVersion',1,'provider','api_connection','model',j.model_id,'authMode',j.auth_mode,'turnId',j.id,'attemptId',j.attempt_id,'connectionId',j.api_connection_id,'revisionId',j.api_revision_id,'configurationHash',j.api_configuration_hash,'packetHash',j.packet_hash,'endpoint',j.api_configuration_canonical::pg_catalog.jsonb->>'endpoint','protocol',j.api_configuration_canonical::pg_catalog.jsonb->>'protocol'); "
        if name=='api-v2-refusal':
            setup+='res:=NULL; rep:='+J(r)+"; fail:='native_usage_limit'; BEGIN PERFORM "+call+"; RAISE EXCEPTION 'a0-api-v2-accepted'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;"
        elif name=='api-ambiguous':
            setup+='BEGIN PERFORM '+call.replace('j.user_id,NULL,NULL',f"j.user_id,{L(i['connection'])},{L(plan['tokenHash'])}")+"; RAISE EXCEPTION 'a0-api-ambiguous-accepted'; EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;"
        else:
            if name=='api-failure':
                setup+="res:=NULL; rep:=NULL; fail:='api_owned_failure'; "
            setup+='saved:='+call+"; PERFORM pg_temp.assert_true(saved->>'state'="+L('failed' if name=='api-failure' else 'succeeded')+",'api-terminal'); PERFORM pg_temp.assert_true("+call+"=saved,'api-exact-replay'); "
            if name=='api-changed-replay':
                setup+="res:=jsonb_set(res,'{answer}','\"Changed\"'); BEGIN PERFORM "+call+"; RAISE EXCEPTION 'a0-api-changed-accepted'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;"
        return 'DO $api$ '+setup+' END $api$;'
    raise ValueError('unimplemented-case')
