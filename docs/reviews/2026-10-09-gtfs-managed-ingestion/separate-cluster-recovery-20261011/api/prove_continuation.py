"""Mutation controls for the new continuation's exact observation boundaries."""
import ast,copy,hashlib,json
from pathlib import Path
import continuation_guards as g

p=Path(__file__).parent
fixtures={'binding':[{'database':g.DATABASE},{'id':g.DB_ID},'192.168.224.6','192.168.224.0/20'],
 'replies':[[{'requestSha256':'a','responseSha256':'b'}],[{'requestSha256':'a','responseSha256':'b'}]],
 'file_changes':[{'job':{'sha':'a'},'terminal':{'sha':'b'},'stable':{'sha':'c'}},{'job':{'sha':'d'},'terminal':{'sha':'e'},'stable':{'sha':'c'}},['job','terminal']]}
records=[]
for label in ('baseline','harmless','restored'):
 for name,args in copy.deepcopy(fixtures).items():
  if label=='harmless' and name=='binding':args[0]['note']='Unrelated'
  getattr(g,name)(*args)
 records.append({'case':label,'passed':True})
variants=[('binding','api-continuation-database',lambda a:a[0].update(database='foreign')),
 ('binding','api-continuation-database',lambda a:a[1].update(id='foreign')),
 ('binding','api-continuation-address',lambda a:a.__setitem__(2,'8.8.8.8')),
 ('binding','api-continuation-address',lambda a:a.__setitem__(2,'192.168.1.2')),
 ('replies','api-continuation-exact-reply',lambda a:a[1].clear()),
 ('replies','api-continuation-exact-reply',lambda a:a[1][0].update(responseSha256='changed')),
 ('file_changes','api-continuation-file-census',lambda a:a[1].update(extra={'sha':'f'})),
 ('file_changes','api-continuation-file-changes',lambda a:a[1]['stable'].update(sha='changed'))]
for name,reason,change in variants:
 args=copy.deepcopy(fixtures[name]);change(args)
 try:getattr(g,name)(*args)
 except ValueError as error:assert str(error)==reason
 else:raise AssertionError('Broken continuation survived '+reason)
 node=copy.deepcopy(next(n for n in ast.parse((p/'continuation_guards.py').read_text()).body if isinstance(n,ast.FunctionDef) and n.name==name))
 class Omit(ast.NodeTransformer):
  def visit_Expr(self,node):
   if isinstance(node.value,ast.Call) and len(node.value.args)==2 and isinstance(node.value.args[1],ast.Constant) and node.value.args[1].value==reason:return ast.copy_location(ast.Pass(),node)
   return self.generic_visit(node)
 Omit().visit(node);namespace=dict(vars(g));exec(compile(ast.Module(body=[node],type_ignores=[]),g.__file__,'exec'),namespace);namespace[name](*args)
 records.append({'case':name,'reason':reason,'refused':True,'omittedGuardAllowsBroken':True})
(p/'continuation-controls.json').write_text(json.dumps({'records':records,'sourceSha256':hashlib.sha256((p/'continuation_guards.py').read_bytes()).hexdigest(),'limits':'Synthetic exact-binding, reply and file-census observations. No credentials, API, journal or database writes.'},indent=2)+'\n')
print('3 positive, 8 broken continuation cases and 8 omitted-guard controls pass.')
