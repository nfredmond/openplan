"""Native ephemeral port controls and exact all-service readiness controls."""
import ast,hashlib,json,socket
from pathlib import Path
import services as s
p=Path(__file__).parent;source=p/'services.py';records=[]
for case in ('baseline','harmless','restored'):
    with socket.socket() as allocate:allocate.bind(('127.0.0.1',0));port=allocate.getsockname()[1]
    s.port_free('127.0.0.1',port);assert s.ready_status(200,200,200);records.append({'case':case,'passed':True})
with socket.socket() as listener:
    listener.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1);listener.bind(('127.0.0.1',0));listener.listen(1);port=listener.getsockname()[1]
    try:s.port_free('127.0.0.1',port)
    except OSError as error:assert error.errno==98
    else:raise AssertionError('Active listener survived')
    def omitted(host,port):pass
    omitted('127.0.0.1',port);records.append({'case':'active-loopback-listener','refused':True,'omittedPortCheckAllowsBroken':True})
node=next(n for n in ast.parse(source.read_text()).body if isinstance(n,ast.FunctionDef) and n.name=='ready_status')
for index,label in enumerate(('auth','rest','storage')):
    args=[200,200,200];args[index]=503;assert not s.ready_status(*args)
    mutant=ast.parse(ast.unparse(node)).body[0];mutant.body[0].value.values.pop(index);space={};exec(compile(ast.Module(body=[mutant],type_ignores=[]),str(source),'exec'),space);assert space['ready_status'](*args)
    records.append({'case':label+'-not-ready','refused':True,'omittedStatusCheckAllowsBroken':True})
(p/'startup-controls.json').write_text(json.dumps({'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'records':records,'limits':'Ephemeral loopback listener and pure readiness. No fixture service, database or API change.'},indent=2)+'\n');print('3 positive, occupied-loopback refusal and all 3 omitted-readiness controls pass.')
