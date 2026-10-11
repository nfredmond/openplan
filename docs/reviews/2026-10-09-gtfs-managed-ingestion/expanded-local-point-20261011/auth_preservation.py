"""Permit only the native password sign-in rows bound to its user/session."""
import copy
from scope import require
TABLES=('users','sessions','refresh_tokens','mfa_amr_claims','audit_log_entries')
def verify_auth(before,after,actor):
    require(set(before)==set(after)==set(TABLES),'expanded-auth-table-scope')
    old={table:{str(row['id']):row for row in before[table]} for table in TABLES};new={table:{str(row['id']):row for row in after[table]} for table in TABLES}
    require(all(len(old[t])==len(before[t]) and len(new[t])==len(after[t]) for t in TABLES),'expanded-auth-duplicate-id')
    require(set(old['users'])==set(new['users']) and actor in old['users'],'expanded-auth-user-census')
    for identity,row in old['users'].items():
        candidate=copy.deepcopy(new['users'][identity]);expected=copy.deepcopy(row)
        if identity==actor:
            require(candidate['last_sign_in_at'] is not None and candidate['updated_at'] is not None,'expanded-auth-user-signin-time')
            for key in ('last_sign_in_at','updated_at'):candidate.pop(key,None);expected.pop(key,None)
        require(candidate==expected,'expanded-auth-user-fields')
    additions={}
    for table in TABLES[1:]:
        require(set(old[table])<=set(new[table]) and all(new[table][key]==row for key,row in old[table].items()),'expanded-auth-retained-rows')
        additions[table]=[row for key,row in new[table].items() if key not in old[table]]
        require(len(additions[table])==1,'expanded-auth-new-row-count')
    session=additions['sessions'][0];token=additions['refresh_tokens'][0];method=additions['mfa_amr_claims'][0];audit=additions['audit_log_entries'][0]
    require(session['user_id']==actor and session['aal']=='aal1' and session['factor_id'] is None,'expanded-auth-session-owner')
    require(token['user_id']==actor and token['session_id']==session['id'] and token['revoked'] is False,'expanded-auth-token-owner')
    require(method['session_id']==session['id'] and method['authentication_method']=='password','expanded-auth-method-owner')
    require(audit['payload']['actor_id']==actor and audit['payload']['action']=='login' and audit['payload']['actor_via_sso'] is False,'expanded-auth-audit-owner')
    return {'sessionId':session['id'],'refreshTokenId':int(token['id']),'method':'password','newRows':{table:1 for table in TABLES[1:]},'retainedAuthRowsUnchanged':True,'existingUserOnlySigninFieldsChanged':True}
