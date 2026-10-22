"""Exercise lifecycle predicates and omitted guards without starting services."""
import ast
import copy
import json
from pathlib import Path
import sys
SOURCE=Path(__file__).with_name('recovery_lifecycle.py')
original=SOURCE.read_text()
def loaded(text):
    namespace={}
    exec(compile(text,str(SOURCE),'exec'),namespace)
    return namespace
stopped={'State':{'Running':False}}
running={'State':{'Running':True}}
cases=[('database-active','require_stopped',(running,stopped),'package-owned-target-begins-stopped'),('api-active','require_stopped',(stopped,running),'package-owned-target-begins-stopped'),('final-active','require_final_stopped',(running,),'package-owned-target-finally-stopped')]
records=[]
for label,text in [('baseline',original),('harmless-comment','# Harmless lifecycle comment\n'+original)]:
    namespace=loaded(text)
    namespace['require_stopped'](stopped,stopped)
    namespace['require_final_stopped'](stopped)
    for case,function,args,reason in cases:
        try:namespace[function](*copy.deepcopy(args))
        except ValueError as error:
            if str(error)!=reason:raise AssertionError('Wrong lifecycle refusal')
        else:raise AssertionError('Lifecycle mutation survived: '+case)
    records.append({'case':label,'result':'survived; three active-state cases refused'})
for case,function,args,reason in cases:
    tree=ast.parse(original)
    subject=next(node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name==function)
    subject.body[0].test=ast.Constant(False)
    namespace=loaded(ast.unparse(ast.fix_missing_locations(tree)))
    try:namespace[function](*copy.deepcopy(args))
    except ValueError:raise AssertionError('Omitted lifecycle guard still refused')
    records.append({'case':case,'result':'omission accepts active state; intended refusal oracle fails','reason':reason})
Path(sys.argv[1]).write_text(json.dumps({'cases':records,'scope':'Lifecycle guard fixtures only; exact native resource identity/configuration remain independently checked by existing container/service guards.'},indent=2)+'\n')
print('Five lifecycle controls pass; no services started')
