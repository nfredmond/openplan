"""Exercise the retained streaming Storage observer with exact fake transport."""
import ast, copy, hashlib, json, types
from pathlib import Path
import run as r

p=Path(__file__).parent;records=[]
objects=[{'bucket':'private','name':str(i)} for i in range(10)]
data={str(i):bytes([i]) for i in range(10)}
physical={str(i):{'bytes':1,'sha256':hashlib.sha256(data[str(i)]).hexdigest()} for i in range(10)}
expected=[{**row,**physical[row['name']]} for row in objects]
query="SELECT coalesce(json_agg(json_build_object('bucket',bucket_id,'name',name) ORDER BY bucket_id,name),'[]') FROM storage.objects"

def invoke(function, scenario):
 namespace=dict(vars(r));seen=[]
 class Response:
  status_code=scenario.get('status',200)
  def __init__(self,name):self.name=name
  def __enter__(self):return self
  def __exit__(self,*args):pass
  def iter_content(self,size):yield scenario.get('bytes',data.get(self.name,b'x'))
 class Session:
  def get(self,url,**kwargs):return Response(url.rsplit('/',1)[-1])
 def sql(database,projection):
  assert database=='proof' and projection==query
  return json.dumps(scenario.get('objects',objects))
 namespace.update(props=types.SimpleNamespace(sql=sql),files=types.SimpleNamespace(inventory=lambda path:scenario.get('physical',physical)),requests=types.SimpleNamespace(Session=Session),save=lambda:None,private_json=lambda *args:None,record={},OUT=p)
 node=copy.deepcopy(function)
 if scenario.get('omit'):
  class Omit(ast.NodeTransformer):
   def visit_Expr(self,node):
    value=node.value
    if isinstance(value,ast.Call) and len(value.args)==2 and isinstance(value.args[1],ast.Constant) and value.args[1].value==scenario['omit']:return ast.copy_location(ast.Pass(),node)
    return self.generic_visit(node)
  Omit().visit(node)
 exec(compile(ast.Module(body=[node],type_ignores=[]),str(p/'run.py'),'exec'),namespace)
 return namespace['storage_readback']('proof',Path('/private/storage'),'synthetic','controls',scenario.get('expected',expected))

node=next(n for n in ast.parse((p/'run.py').read_text()).body if isinstance(n,ast.FunctionDef) and n.name=='storage_readback')
for label in ('baseline','harmless','restored'):
 value={'expected':[dict(reversed(list(row.items()))) for row in expected]} if label=='harmless' else {}
 assert invoke(node,value)==expected;records.append({'case':label,'passed':True})
bad_expected=copy.deepcopy(expected);bad_expected[0]['sha256']='0'*64
bad_physical=copy.deepcopy(physical);bad_physical.pop('9')
variants=[('expanded-storage-name',{'objects':[{'bucket':'private','name':'../1'}]+objects[1:],'expected':None}),
 ('expanded-storage-download',{'status':503}),
 ('expanded-storage-bound',{'bytes':b'xx'}),
 ('expanded-storage-bytes',{'physical':{k:{**v,'sha256':'0'*64} for k,v in physical.items()}}),
 ('expanded-storage-object-census',{'objects':objects[:-1],'physical':bad_physical,'expected':None}),
 ('expanded-storage-physical-census',{'objects':objects[1:]+[objects[1]],'expected':None}),
 ('expanded-storage-restored-readback',{'expected':bad_expected})]
for reason,scenario in variants:
 try:invoke(node,scenario)
 except ValueError as error:assert str(error)==reason,(reason,str(error))
 else:raise AssertionError('Broken Storage observation survived '+reason)
 # The oracle requires the intended first failure. Removing this exact guard
 # either admits the broken observation or changes its failure boundary.
 outcome='broken-observation-admitted'
 try:invoke(node,{**scenario,'omit':reason})
 except ValueError as error:
  assert str(error)!=reason
  outcome=str(error)
 records.append({'case':reason,'refused':True,'omittedGuardFailsIntendedReasonOracle':True,'omittedOutcome':outcome})
(p/'storage-controls.json').write_text(json.dumps({'sourceSha256':hashlib.sha256((p/'run.py').read_bytes()).hexdigest(),'records':records,'limits':'Fake streaming transport and exact SQL projection. Exact guard omissions change the required first failure or admit the observation. Native download is a separate check.'},indent=2)+'\n')
print('3 positive and 7 targeted broken Storage observations pass; exact guard omissions fail the intended-reason oracle.')
