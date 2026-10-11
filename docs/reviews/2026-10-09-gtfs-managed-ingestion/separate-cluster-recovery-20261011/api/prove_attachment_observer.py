"""Exercise the attachment driver's direct refusals on copied inputs."""
import ast, copy, hashlib, json
from pathlib import Path

OUT = Path(__file__).parent
SOURCE = (OUT/'attach_network.py').read_text()
tree = ast.parse(SOURCE)
nodes = [node for node in ast.walk(tree) if isinstance(node,ast.If) and any(isinstance(child,ast.Raise) for child in node.body)]
records=[]
for node in nodes:
    message = node.body[0].exc.args[0].value
    for label,broken,omitted in [('baseline',False,False),('harmless',False,False),('broken',True,False),('omitted',True,True),('restored',False,False)]:
        actual=copy.deepcopy(node)
        if omitted:actual.test=ast.Constant(False)
        namespace={'exists':False,'before':b'original rules\n','rule':b'host all all 192.168.224.0/20 scram-sha-256\n'}
        namespace['after']=namespace['before']+b'\n'+namespace['rule']
        if label=='harmless':namespace['unrelated']='retained'
        if broken:
            if isinstance(node.test,ast.Name):namespace['exists']=True
            else:namespace['after']=namespace['before']
        failure=None
        try:exec(compile(ast.fix_missing_locations(ast.Module(body=[actual],type_ignores=[])),'<extracted attachment refusal>','exec'),namespace)
        except ValueError as error:failure=str(error)
        if broken and not omitted:assert failure==message
        else:assert failure is None
        records.append({'case':label,'guard':message,'result':'intended omitted-guard oracle failure' if omitted else 'refused' if failure else 'survived'})
assert (OUT/'attach_network.py').read_text()==SOURCE
(OUT/'attachment-observer-controls.json').write_text(json.dumps({'sourceSha256':hashlib.sha256(SOURCE.encode()).hexdigest(),'cases':records,'acceptanceOrdering':'Native attachment observation occurs before these extracted observer controls. Accept it only after the controls pass.','scope':'Two direct driver refusals, not Docker/SCRAM/API or HBA parser behavior.'},indent=2)+'\n')
print(len(records),'attachment observer cases pass')
