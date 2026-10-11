"""Pure exact-user/session Auth controls with omitted-guard oracles."""
import ast,copy,hashlib,json
from pathlib import Path
import auth_preservation as a
p=Path(__file__).parent;source=p/'auth_preservation.py';actor='actor';before={t:[] for t in a.TABLES};before['users']=[{'id':actor,'encrypted_password':'synthetic-hash','last_sign_in_at':'old','updated_at':'old'}];after=copy.deepcopy(before);after['users'][0].update(last_sign_in_at='new',updated_at='new');after['sessions']=[{'id':'new-session','user_id':actor,'aal':'aal1','factor_id':None}];after['refresh_tokens']=[{'id':'1','user_id':actor,'session_id':'new-session','revoked':False}];after['mfa_amr_claims']=[{'id':'method','session_id':'new-session','authentication_method':'password'}];after['audit_log_entries']=[{'id':'audit','payload':{'actor_id':actor,'action':'login','actor_via_sso':False}}];fixture=[before,after,actor];records=[]
for label in ('baseline','harmless','restored'):
 args=copy.deepcopy(fixture)
 if label=='harmless':
  for rows in (args[0]['users'],args[1]['users']):rows[0]['reviewerNote']='Retained unrelated note'
 a.verify_auth(*args);records.append({'case':label,'passed':True})
variants=[('expanded-auth-table-scope',lambda x:x[1].update(foreign=[])),('expanded-auth-duplicate-id',lambda x:x[1]['users'].append(copy.deepcopy(x[1]['users'][0]))),('expanded-auth-user-census',lambda x:x[1]['users'].append({'id':'foreign','last_sign_in_at':None,'updated_at':None})),('expanded-auth-user-signin-time',lambda x:x[1]['users'][0].update(last_sign_in_at=None)),('expanded-auth-user-fields',lambda x:x[1]['users'][0].update(encrypted_password='changed')),('expanded-auth-retained-rows',lambda x:(x[0]['sessions'].append({'id':'old','user_id':actor}),x[1]['sessions'].append({'id':'old','user_id':'foreign'}))),('expanded-auth-new-row-count',lambda x:x[1]['sessions'].append({**x[1]['sessions'][0],'id':'extra'})),('expanded-auth-session-owner',lambda x:x[1]['sessions'][0].update(user_id='foreign')),('expanded-auth-session-owner',lambda x:x[1]['sessions'][0].update(aal='aal2')),('expanded-auth-token-owner',lambda x:x[1]['refresh_tokens'][0].update(user_id='foreign')),('expanded-auth-token-owner',lambda x:x[1]['refresh_tokens'][0].update(session_id='foreign')),('expanded-auth-method-owner',lambda x:x[1]['mfa_amr_claims'][0].update(session_id='foreign')),('expanded-auth-method-owner',lambda x:x[1]['mfa_amr_claims'][0].update(authentication_method='totp')),('expanded-auth-audit-owner',lambda x:x[1]['audit_log_entries'][0]['payload'].update(actor_id='foreign')),('expanded-auth-audit-owner',lambda x:x[1]['audit_log_entries'][0]['payload'].update(action='signup'))]
node=next(n for n in ast.parse(source.read_text()).body if isinstance(n,ast.FunctionDef) and n.name=='verify_auth')
for reason,change in variants:
 args=copy.deepcopy(fixture);change(args)
 try:a.verify_auth(*args)
 except ValueError as error:assert str(error)==reason
 else:raise AssertionError('Broken Auth preservation survived '+reason)
 mutant=copy.deepcopy(node)
 class Omit(ast.NodeTransformer):
  def visit_Expr(self,node):
   value=node.value
   if isinstance(value,ast.Call) and len(value.args)==2 and isinstance(value.args[1],ast.Constant) and value.args[1].value==reason:return ast.copy_location(ast.Pass(),node)
   return self.generic_visit(node)
 Omit().visit(mutant);space={'require':a.require,'TABLES':a.TABLES,'copy':copy};exec(compile(ast.Module(body=[mutant],type_ignores=[]),str(source),'exec'),space);space['verify_auth'](*args);records.append({'case':reason,'refused':True,'omittedGuardAllowsBroken':True})
(p/'auth-controls.json').write_text(json.dumps({'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'records':records,'limits':'Pure synthetic exact Auth row controls. No native session, user, credential or database change.'},indent=2)+'\n');print('3 positive and 15 targeted Auth row/link refusals with omitted-guard controls pass.')
