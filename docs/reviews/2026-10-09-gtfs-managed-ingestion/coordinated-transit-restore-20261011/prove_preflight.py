"""Test the actual pure preflight functions without touching native services."""
import ast, copy, hashlib, json
from pathlib import Path
import preflight as p

source = Path(p.__file__)
plan = json.loads(source.with_name('plan.json').read_text())
container = {'Id':p.CONTAINER,'Name':'/supabase_db_openplan-restore-target-2026091050','State':{'Running':True},'Config':{'Labels':{'com.supabase.cli.project':'openplan-restore-target-2026091050'}}}
scope = [plan,container,p.HEAD,'',[],False]
backend = [{'Id':'owned-id','Name':'/owned-name','Image':'image-id','State':{'Running':True},'Config':{'Labels':{'openplan.proof.owner':'owner'},'Env':['PGRST_DB_URI=postgres://localhost/'+plan['sourceDatabase']]},'HostConfig':{'Memory':134217728,'MemorySwap':134217728,'NanoCpus':500000000,'PortBindings':{'3000/tcp':[{'HostIp':'127.0.0.1','HostPort':''}]}},'NetworkSettings':{'Ports':{'3000/tcp':[{'HostIp':'127.0.0.1','HostPort':'12345'}]}}},'owned-id','owned-name','owner','image-id',plan['sourceDatabase']]
cases = [
 ('verify_scope','coordinated-source',lambda a:a.__setitem__(2,'wrong')),
 ('verify_scope','coordinated-source',lambda a:a.__setitem__(3,' M tracked')),
 ('verify_scope','coordinated-container',lambda a:a[1].update(Id='foreign')),
 ('verify_scope','coordinated-container-project',lambda a:a[1]['State'].update(Running=False)),
 ('verify_scope','coordinated-container-project',lambda a:a[1]['Config']['Labels'].update({'com.supabase.cli.project':'foreign'})),
 ('verify_scope','coordinated-template',lambda a:a[0].update(templateDatabase='postgres')),
 ('verify_scope','coordinated-template',lambda a:a[0].update(logicalTarget='https://hosted.invalid')),
 ('verify_scope','coordinated-database-identities',lambda a:a[0].update(targetDatabase=a[0]['sourceDatabase'])),
 ('verify_scope','coordinated-database-identities',lambda a:a[0].update(targetDatabase='postgres')),
 ('verify_scope','coordinated-existing-database',lambda a:a[4].append(a[0]['sourceDatabase'])),
 ('verify_scope','coordinated-original-worker-active',lambda a:a.__setitem__(5,True)),
 ('verify_backend','coordinated-backend-identity',lambda a:a[0].update(Id='foreign')),
 ('verify_backend','coordinated-backend-identity',lambda a:a[0].update(Name='/foreign')),
 ('verify_backend','coordinated-backend-owner',lambda a:a[0]['Config']['Labels'].update({'openplan.proof.owner':'foreign'})),
 ('verify_backend','coordinated-backend-owner',lambda a:a[0].update(Image='foreign')),
 ('verify_backend','coordinated-backend-database',lambda a:a[0]['Config'].update(Env=['PGRST_DB_URI=postgres://localhost/postgres','PGRST_OPENAPI_MODE=disabled'])),
 ('verify_backend','coordinated-backend-limits',lambda a:a[0]['HostConfig'].update(Memory=0)),
 ('verify_backend','coordinated-backend-limits',lambda a:a[0]['HostConfig'].update(MemorySwap=-1)),
 ('verify_backend','coordinated-backend-limits',lambda a:a[0]['HostConfig'].update(NanoCpus=0)),
 ('verify_backend','coordinated-backend-loopback',lambda a:a[0]['NetworkSettings']['Ports']['3000/tcp'][0].update(HostIp='0.0.0.0')),
]
records = []
backend[0]['Config']['Env'].append('PGRST_OPENAPI_MODE=disabled')
cases.append(('verify_backend','coordinated-backend-openapi',lambda a:a[0]['Config']['Env'].remove('PGRST_OPENAPI_MODE=disabled')))
stopped=copy.deepcopy(backend);stopped[0]['State']['Running']=False;stopped[0]['NetworkSettings']['Ports']={}
p.verify_backend(*stopped);records.append({'case':'owned-stopped-backend','passed':True})
for label in ('baseline','harmless','restored'):
    a,b=copy.deepcopy(scope),copy.deepcopy(backend)
    if label=='harmless':
        a[0]['reviewerNote']='Unrelated';b[0]['Config']['Labels']['reviewerNote']='Unrelated'
    p.verify_scope(*a);p.verify_backend(*b)
    records.append({'case':label,'passed':True})
for function,reason,change in cases:
    args=copy.deepcopy(scope if function=='verify_scope' else backend);change(args)
    try:getattr(p,function)(*args)
    except ValueError as error:assert str(error)==reason
    else:raise AssertionError('Broken scope survived: '+reason)
    tree=ast.parse(source.read_text());fn=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name==function)
    fn.body=[n for n in fn.body if not(isinstance(n,ast.Expr) and isinstance(n.value,ast.Call) and len(n.value.args)==2 and isinstance(n.value.args[1],ast.Constant) and n.value.args[1].value==reason)]
    space={};exec(compile(tree,str(source),'exec'),space)
    try:
        space[function](*args)
        raise AssertionError('Broken scope survived: '+reason)
    except AssertionError as error:assert str(error)=='Broken scope survived: '+reason
    records.append({'function':function,'reason':reason,'refused':True,'omittedGuardFailsOracle':True})
source.with_name('preflight-controls.json').write_text(json.dumps({'records':records,'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'limits':'Copied fixtures and in-memory guard mutations. No native database, container, file root or network access.'},indent=2)+'\n')
print('4 positive, 21 broken scopes and 21 omitted-guard oracles pass.')
