"""Pure exact request/size guard controls before any native forwarding."""
import ast,copy,hashlib,json
from pathlib import Path
import bridge as b
p=Path(__file__).parent;source=p/'bridge.py';key='synthetic-key';records=[]
fixtures={'request_scope':['POST',b.PATHS[0],32,'Bearer '+key,key],'exact_body':[32,32],'bounded_response':[32]}
for label in ('baseline','harmless','restored'):
    for name,args in fixtures.items():getattr(b,name)(*args)
    records.append({'case':label,'passed':True})
variants=[('request_scope',0,'GET','expanded-bridge-path'),('request_scope',1,'/rest/v1/rpc/delete_everything','expanded-bridge-path'),('request_scope',2,4194305,'expanded-bridge-request-size'),('request_scope',2,0,'expanded-bridge-request-size'),('request_scope',3,'Bearer foreign','expanded-bridge-auth'),('exact_body',0,31,'expanded-bridge-body'),('bounded_response',0,1048577,'expanded-bridge-response-size')]
tree=ast.parse(source.read_text())
for name,index,value,reason in variants:
    args=copy.deepcopy(fixtures[name]);args[index]=value
    try:getattr(b,name)(*args)
    except ValueError as error:assert str(error)==reason
    else:raise AssertionError('Broken bridge survived '+reason)
    node=copy.deepcopy(next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name==name))
    class Omit(ast.NodeTransformer):
        def visit_Expr(self,node):
            v=node.value
            if isinstance(v,ast.Call) and len(v.args)==2 and isinstance(v.args[1],ast.Constant) and v.args[1].value==reason:return ast.copy_location(ast.Pass(),node)
            return self.generic_visit(node)
    Omit().visit(node);space={'require':b.require,'hmac':b.hmac,'PATHS':b.PATHS};exec(compile(ast.Module(body=[node],type_ignores=[]),str(source),'exec'),space);space[name](*args)
    records.append({'case':name,'reason':reason,'refused':True,'omittedGuardAllowsBroken':True})
(p/'bridge-controls.json').write_text(json.dumps({'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'records':records,'limits':'Pure guard controls, no network or database traffic.'},indent=2)+'\n')
print('3 positive, 7 broken bridge cases and 7 omitted-guard oracles pass.')
