"""Observe recovered user access without promoting service-role checks."""
from scope import require

def signin(status, value, actor):
    require(status == 200 and value.get('user', {}).get('id') == actor
            and isinstance(value.get('access_token'), str) and len(value['access_token']) > 30,
            'auth-recovered-signin')

def identity(status, value, actor):
    require(status == 200 and value.get('id') == actor, 'auth-recovered-identity')

def rows(role, status, value, column, version, workspace):
    require(role in ('owner', 'viewer', 'outsider', 'anon'), 'auth-read-role')
    if role in ('owner', 'viewer'):
        require(status == 200 and isinstance(value, list) and len(value) == 1
                and value[0].get(column) == version and value[0].get('workspace_id') == workspace,
                'auth-member-retained-row')
    elif role == 'outsider':
        require(status == 200 and value == [], 'auth-outsider-hidden-row')
    else:
        require(status in (401, 403) and isinstance(value, dict) and value.get('code') == '42501',
                'auth-anon-table-refused')

def archive(role, status, exists):
    require(exists is True, 'auth-private-object-positive-control')
    require(role in ('owner', 'viewer', 'outsider', 'anon'), 'auth-private-object-role')
    require(status in (400, 403, 404), 'auth-private-object-refused')

def rpc(role, status, value):
    require(role in ('service', 'owner', 'viewer', 'outsider', 'anon'), 'auth-rpc-role')
    if role == 'service':
        require(status == 200 and value == [], 'auth-service-empty-queue')
    else:
        require(status in (401, 403) and isinstance(value, dict) and value.get('code') == '42501',
                'auth-user-worker-rpc-refused')

def non_auth(before, after, token):
    allowed={'auth.users','auth.sessions','auth.refresh_tokens','auth.mfa_amr_claims','auth.audit_log_entries'}
    require([r['table'] for r in before['tables']] == [r['table'] for r in after['tables']], 'auth-final-table-census')
    require(all(a == b for a,b in zip(before['tables'],after['tables']) if a['table'] not in allowed), 'auth-final-non-auth-records')
    old={r['sequence']:r for r in before['sequences']};new={r['sequence']:r for r in after['sequences']}
    require(set(old) == set(new) and all(row == new[name] for name,row in old.items() if name != 'auth.refresh_tokens_id_seq'), 'auth-final-sequences')
    require(new['auth.refresh_tokens_id_seq']['last_value'] == token and new['auth.refresh_tokens_id_seq']['is_called'], 'auth-final-token-sequence')

def final_auth(expected, actual):
    require(expected == actual, 'auth-final-exact-rows')

def schema(expected, actual):
    require(expected == actual, 'auth-final-schema')

def continuation(producer):
    require(producer['state'] == 'failed' and producer['reason'] == 'auth-service-empty-queue'
            and len(producer['logins']) == 3, 'auth-continuation-failed-producer')
