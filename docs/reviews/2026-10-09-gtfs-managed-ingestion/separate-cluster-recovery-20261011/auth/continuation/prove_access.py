"""Exact admission and access observation mutation controls."""
import ast,copy,hashlib,json,sys
from pathlib import Path
sys.path.append(str(Path(__file__).parent.parent/'separate-cluster-api-20261011-01'))
import access_guards as g

p=Path(__file__).parent;records=[]
fixtures={'signin':[200,{'user':{'id':'actor'},'access_token':'synthetic'*8},'actor'],
 'identity':[200,{'id':'actor'},'actor'],
 'rows':['owner',200,[{'id':'version','workspace_id':'workspace'}],'id','version','workspace'],
 'archive':['owner',404,True],
 'rpc':['service',200,[]], 'final_auth':[{'user':'retained'},{'user':'retained'}], 'schema':['same','same'],
 'continuation':[{'state':'failed','reason':'auth-service-empty-queue','logins':[{}, {}, {}]}],
 'non_auth':[{'tables':[{'table':'public.keep','hash':'a'}],'sequences':[{'sequence':'auth.refresh_tokens_id_seq','last_value':1,'is_called':True},{'sequence':'public.keep','last_value':1,'is_called':True}]},{'tables':[{'table':'public.keep','hash':'a'}],'sequences':[{'sequence':'auth.refresh_tokens_id_seq','last_value':4,'is_called':True},{'sequence':'public.keep','last_value':1,'is_called':True}]},4]}
for label in ('baseline','harmless','restored'):
 for name,args in copy.deepcopy(fixtures).items():
  if label=='harmless' and name=='signin':args[1]['note']='Unrelated'
  getattr(g,name)(*args)
 for role in ('viewer','outsider','anon'):
  args=copy.deepcopy(fixtures['rows']);args[0]=role
  if role=='outsider':args[2]=[]
  if role=='anon':args[1:3]=[401,{'code':'42501'}]
  g.rows(*args)
  g.archive(role,404,True);g.rpc(role,403,{'code':'42501'})
 records.append({'case':label,'passed':True})
variants=[('signin','auth-recovered-signin',lambda a:a[1]['user'].update(id='foreign')),
 ('signin','auth-recovered-signin',lambda a:a[1].update(access_token='short')),
 ('identity','auth-recovered-identity',lambda a:a[1].update(id='foreign')),
 ('rows','auth-read-role',lambda a:a.__setitem__(0,'foreign')),
 ('rows','auth-member-retained-row',lambda a:a[2].clear()),
 ('rows','auth-member-retained-row',lambda a:a[2][0].update(workspace_id='foreign')),
 ('rows','auth-outsider-hidden-row',lambda a:a.__setitem__(0,'outsider')),
 ('rows','auth-anon-table-refused',lambda a:a.__setitem__(0,'anon')),
 ('archive','auth-private-object-positive-control',lambda a:a.__setitem__(2,False)),
 ('archive','auth-private-object-role',lambda a:a.__setitem__(0,'foreign')),
 ('archive','auth-private-object-refused',lambda a:a.__setitem__(1,200)),
 ('rpc','auth-rpc-role',lambda a:a.__setitem__(0,'foreign')),
 ('rpc','auth-service-empty-queue',lambda a:a[2].append({'id':'unexpected'})),
 ('rpc','auth-user-worker-rpc-refused',lambda a:a.__setitem__(0,'owner')),
 ('non_auth','auth-final-table-census',lambda a:a[1]['tables'].clear()),
 ('non_auth','auth-final-non-auth-records',lambda a:a[1]['tables'][0].update(hash='changed')),
 ('non_auth','auth-final-sequences',lambda a:a[1]['sequences'][1].update(last_value=2)),
 ('non_auth','auth-final-token-sequence',lambda a:a.__setitem__(2,99)),
 ('final_auth','auth-final-exact-rows',lambda a:a[1].update(user='changed')),
 ('schema','auth-final-schema',lambda a:a.__setitem__(1,'changed')),
 ('continuation','auth-continuation-failed-producer',lambda a:a[0].update(state='passed')),
 ('continuation','auth-continuation-failed-producer',lambda a:a[0].update(reason='unrelated')),
 ('continuation','auth-continuation-failed-producer',lambda a:a[0]['logins'].pop())]
for name,reason,change in variants:
 args=copy.deepcopy(fixtures[name]);change(args)
 try:getattr(g,name)(*args)
 except ValueError as e:assert str(e)==reason
 else:raise AssertionError('Broken recovered access survived '+reason)
 node=copy.deepcopy(next(n for n in ast.parse((p/'access_guards.py').read_text()).body if isinstance(n,ast.FunctionDef) and n.name==name))
 class Omit(ast.NodeTransformer):
  def visit_Expr(self,node):
   v=node.value
   if isinstance(v,ast.Call) and len(v.args)==2 and isinstance(v.args[1],ast.Constant) and v.args[1].value==reason:return ast.copy_location(ast.Pass(),node)
   return self.generic_visit(node)
 Omit().visit(node);space=dict(vars(g));exec(compile(ast.Module(body=[node],type_ignores=[]),g.__file__,'exec'),space)
 try:space[name](*args);outcome='broken-observation-admitted'
 except (ValueError,KeyError,TypeError) as e:
  assert str(e)!=reason;outcome=type(e).__name__
 records.append({'case':name,'reason':reason,'refused':True,'omittedGuardFailsIntendedReasonOracle':True,'omittedOutcome':outcome})
(p/'access-controls.json').write_text(json.dumps({'sourceSha256':hashlib.sha256((p/'access_guards.py').read_bytes()).hexdigest(),'records':records,'limits':'Pure synthetic actor, row, private-object, worker-RPC and final-image observation controls. Native Auth, actual RLS and browser behavior remain separate.'},indent=2)+'\n')
print('3 positive and 23 targeted access refusals with omitted-guard oracles pass.')
