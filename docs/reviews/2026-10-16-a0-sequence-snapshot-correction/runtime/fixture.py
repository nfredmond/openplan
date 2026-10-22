"""Build owned synthetic SQL without reading donor rows or credentials."""
import hashlib
import json


def literal(value):
    return "'"+str(value).replace("'", "''")+"'"


def jsql(value):
    return literal(json.dumps(value, sort_keys=True, separators=(',', ':')))+'::pg_catalog.jsonb'


def provider_plan(plan, provider):
    """Select new owned identities whose native connection tuple matches its turn."""
    import copy
    selected=copy.deepcopy(plan)
    for field in ['connection','request','turn','attempt']:
        selected['fixture'][field]=plan['fixture'][provider+field.capitalize()]
    selected['tokenHash']=hashlib.sha256((plan['tokenHash']+provider).encode()).hexdigest()
    selected['model']='claude-owned' if provider=='claude' else 'owned-model'
    selected['authMode']='claude_subscription' if provider=='claude' else 'opencode_api'
    return selected


def provider_seed(plan, provider):
    selected=provider_plan(plan,provider); ids=selected['fixture']
    canonical=json.dumps(packet(ids),sort_keys=True,separators=(',', ':'))
    connection=f"INSERT INTO public.assistant_provider_connections(id,user_id,workspace_id,project_id,device_label,token_hash,expected_auth_mode,provider) VALUES({literal(ids['connection'])},{literal(ids['actor'])},{literal(ids['workspace'])},{literal(ids['project'])},'Owned provider refusal',{literal(selected['tokenHash'])},{literal(selected['authMode'])},{literal(provider)});"
    turn=f"INSERT INTO public.assistant_provider_turns(id,request_id,user_id,workspace_id,project_id,connection_id,provider,model_id,auth_mode,question,packet,packet_canonical,packet_hash,request_hash,state,attempt_id,started_at,lease_expires_at) VALUES({literal(ids['turn'])},{literal(ids['request'])},{literal(ids['actor'])},{literal(ids['workspace'])},{literal(ids['project'])},{literal(ids['connection'])},{literal(provider)},{literal(selected['model'])},{literal(selected['authMode'])},'Owned provider refusal',{literal(canonical)}::pg_catalog.jsonb,{literal(canonical)},{literal(hashlib.sha256(canonical.encode()).hexdigest())},{literal(hashlib.sha256(('owned '+provider+' request').encode()).hexdigest())},'running',{literal(ids['attempt'])},clock_timestamp(),clock_timestamp()+interval '60 minutes');"
    return connection+'\n'+turn


def packet(ids, project='project', workspace='workspace'):
    return {'version': 1, 'workspaceId': ids[workspace],
            'project': {'id': ids[project], 'name': 'Owned native proof'},
            'source': {'id': 'project:'+ids[project], 'href': '/projects/'+ids[project], 'label': 'Owned native proof'}}


def seed(plan):
    ids = plan['fixture']
    q = []
    for key in ['actor', 'otherActor']:
        q.append(f"INSERT INTO auth.users(id,email) VALUES({literal(ids[key])}, {literal(ids[key]+'@example.invalid')});")
    for key in ['workspace', 'otherWorkspace']:
        q.append(f"INSERT INTO public.workspaces(id,name,slug) VALUES({literal(ids[key])},'Owned A0 proof',{literal('a0-'+ids[key])});")
    q.append(f"INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES({literal(ids['workspace'])},{literal(ids['actor'])},'owner'),({literal(ids['otherWorkspace'])},{literal(ids['otherActor'])},'owner');")
    for pr, ws, actor in [('project','workspace','actor'), ('otherProject','otherWorkspace','otherActor')]:
        q.append(f"INSERT INTO public.projects(id,workspace_id,name,created_by) VALUES({literal(ids[pr])},{literal(ids[ws])},'Owned native proof',{literal(ids[actor])});")
    for co, ws, pr, actor in [('connection','workspace','project','actor'),('otherConnection','otherWorkspace','otherProject','otherActor')]:
        token = plan['tokenHash'] if co == 'connection' else hashlib.sha256((plan['tokenHash']+'other').encode()).hexdigest()
        q.append(f"INSERT INTO public.assistant_provider_connections(id,user_id,workspace_id,project_id,device_label,token_hash,expected_auth_mode) VALUES({literal(ids[co])},{literal(ids[actor])},{literal(ids[ws])},{literal(ids[pr])},'Owned proof',{literal(token)},'chatgpt');")
    canonical = json.dumps(packet(ids), sort_keys=True, separators=(',', ':'))
    q.append(f"INSERT INTO public.assistant_provider_turns(id,request_id,user_id,workspace_id,project_id,connection_id,provider,model_id,auth_mode,question,packet,packet_canonical,packet_hash,request_hash,state,attempt_id,started_at,lease_expires_at) VALUES({literal(ids['turn'])},{literal(ids['request'])},{literal(ids['actor'])},{literal(ids['workspace'])},{literal(ids['project'])},{literal(ids['connection'])},'codex','owned-model','chatgpt','Owned fixture question',{literal(canonical)}::pg_catalog.jsonb,{literal(canonical)},{literal(hashlib.sha256(canonical.encode()).hexdigest())},{literal(hashlib.sha256(b'owned request').hexdigest())},'running',{literal(ids['attempt'])},clock_timestamp(),clock_timestamp()+interval '60 minutes');")
    for provider in ['claude','opencode']:
        q.append(provider_seed(plan,provider))
    # A saved no-key API revision has no endpoint service or secret. It is never dispatched.
    config = json.dumps({'label':'Owned inert API fixture','protocol':'openai_chat_completions',
        'endpoint':'http://127.0.0.1:9/','modelIds':['owned-model'],'structuredOutput':True,
        'authMode':'none','timeoutSeconds':1}, sort_keys=True, separators=(',', ':'))
    q.append(f"SELECT public.save_workspace_provider_api_revision({literal(ids['actor'])},{literal(ids['workspace'])},{literal(ids['apiConnection'])},{literal(ids['apiRevision'])},NULL,{literal(config)},NULL) IS NOT NULL;")
    q.append(f"INSERT INTO public.assistant_provider_turns(id,request_id,user_id,workspace_id,project_id,provider,model_id,auth_mode,question,packet,packet_canonical,packet_hash,request_hash,state,attempt_id,started_at,lease_expires_at,api_connection_id,api_revision_id,api_configuration_canonical,api_configuration_hash,api_charge_ack) VALUES({literal(ids['apiTurn'])},{literal(ids['apiRequest'])},{literal(ids['actor'])},{literal(ids['workspace'])},{literal(ids['project'])},'api_connection','owned-model','connection_no_key','Owned inert API fixture',{literal(canonical)}::pg_catalog.jsonb,{literal(canonical)},{literal(hashlib.sha256(canonical.encode()).hexdigest())},{literal(hashlib.sha256(b'owned api request').hexdigest())},'running',{literal(ids['apiAttempt'])},clock_timestamp(),clock_timestamp()+interval '60 minutes',{literal(ids['apiConnection'])},{literal(ids['apiRevision'])},{literal(config)},{literal(hashlib.sha256(config.encode()).hexdigest())},true);")
    return '\n'.join(q)


def receipt(plan):
    i = plan['fixture']
    return {'schemaVersion':2, 'outcome':'limited', 'provider':'codex','model':plan.get('model','owned-model'),'authMode':plan.get('authMode','chatgpt'),
        'userId':i['actor'],'requestId':i['request'],'workspaceId':i['workspace'],'projectId':i['project'],
        'connectionId':i['connection'],'turnId':i['turn'],'attemptId':i['attempt'],
        'packetHash':hashlib.sha256(json.dumps(packet(i), sort_keys=True, separators=(',', ':')).encode()).hexdigest(),
        'nativeThreadId':'owned-thread','nativeTurnId':'owned-turn',
        'signal':{'code':'usageLimitExceeded','resetAtUnixSeconds':None,'resetSource':None}}


def finish(plan, result='NULL', report=None, code="'native_usage_limit'", *, actor='NULL', connection=None, token=None, attempt=None):
    i = plan['fixture']
    return 'public.finish_assistant_provider_turn('+','.join([
        literal(i['turn']), literal(attempt or i['attempt']),actor,
        literal(i['connection']) if connection is None else connection,
        literal(plan['tokenHash']) if token is None else token,
        result, jsql(receipt(plan)) if report is None else report, code])+')'
