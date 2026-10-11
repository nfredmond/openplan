"""Pure transport guard controls, before a native backend is created."""
import ast,copy,hashlib,json
from pathlib import Path
import transport as t
source=Path(t.__file__)
fixture={
 'verify_source':[{'Id':t.REST_ID,'Name':'/supabase_rest_openplan-restore-target-2026091050','Image':t.REST_IMAGE,'Config':{'Labels':{'com.supabase.cli.project':'openplan-restore-target-2026091050'}},'State':{'Running':True},'NetworkSettings':{'Networks':{t.NETWORK:{}}}}],
 'verify_request':['POST',t.PATHS[0],100,True],
 'verify_database':['openplan_attempt_cli_'+'a'*32],
 'verify_network':[{'NetworkSettings':{'Networks':{t.NETWORK:{}}}}],
 'verify_body':[100,100], 'verify_response':[100]
}
cases=[
 ('verify_database','coordinated-backend-database-name',lambda a:a.__setitem__(0,'postgres')),
 ('verify_source','coordinated-rest-identity',lambda a:a[0].update(Id='foreign')),
 ('verify_source','coordinated-rest-owner',lambda a:a[0].update(Image='foreign')),
 ('verify_source','coordinated-rest-network',lambda a:a[0]['State'].update(Running=False)),
 ('verify_source','coordinated-rest-network',lambda a:a[0]['NetworkSettings']['Networks'].update(foreign={})),
 ('verify_request','coordinated-request-path',lambda a:a.__setitem__(0,'GET')),
 ('verify_request','coordinated-request-path',lambda a:a.__setitem__(1,'/rest/v1/rpc/delete_anything')),
 ('verify_request','coordinated-request-size',lambda a:a.__setitem__(2,4194305)),
 ('verify_request','coordinated-request-size',lambda a:a.__setitem__(2,0)),
 ('verify_request','coordinated-request-authorization',lambda a:a.__setitem__(3,False)),
 ('verify_network','coordinated-created-network',lambda a:a[0]['NetworkSettings']['Networks'].update(foreign={})),
 ('verify_body','coordinated-request-body',lambda a:a.__setitem__(0,99)),
 ('verify_response','coordinated-response-size',lambda a:a.__setitem__(0,1048577)),
]
records=[]
for label in ('baseline','harmless','restored'):
    values=copy.deepcopy(fixture)
    if label=='harmless':values['verify_source'][0]['Config']['Labels']['reviewerNote']='Unrelated'
    for name,args in values.items():getattr(t,name)(*args)
    records.append({'case':label,'passed':True})
tree=ast.parse(source.read_text())
base=[n for n in tree.body if isinstance(n,(ast.Assign,ast.FunctionDef)) and (isinstance(n,ast.Assign) or n.name in fixture)]
for function,reason,change in cases:
    args=copy.deepcopy(fixture[function]);change(args)
    try:getattr(t,function)(*args)
    except ValueError as error:assert str(error)==reason
    else:raise AssertionError('Broken transport survived: '+reason)
    nodes=copy.deepcopy(base);fn=next(n for n in nodes if isinstance(n,ast.FunctionDef) and n.name==function)
    fn.body=[n for n in fn.body if not(isinstance(n,ast.Expr) and isinstance(n.value,ast.Call) and len(n.value.args)==2 and isinstance(n.value.args[1],ast.Constant) and n.value.args[1].value==reason)] or [ast.Pass()]
    space={'require':t.require,'re':__import__('re')};exec(compile(ast.fix_missing_locations(ast.Module(body=nodes,type_ignores=[])),str(source),'exec'),space)
    try:
        space[function](*args);raise AssertionError('Broken transport survived: '+reason)
    except AssertionError as error:assert str(error)=='Broken transport survived: '+reason
    records.append({'function':function,'reason':reason,'refused':True,'omittedGuardFailsOracle':True})
source.with_name('transport-controls.json').write_text(json.dumps({'records':records,'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'limits':'Copied input and in-memory guard mutations. No native Docker, database, bridge or network mutation.'},indent=2)+'\n')
print('3 positive, 13 broken transport cases and 13 omitted-guard oracles pass.')
