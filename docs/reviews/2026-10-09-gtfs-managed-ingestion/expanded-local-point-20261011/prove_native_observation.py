"""Exercise actual installed-CLI result guards before native operations."""
import ast,copy,hashlib,json
from pathlib import Path
import run as r
p=Path(__file__).parent;source=p/'run.py';records=[]
terminal={'resolved':True,'receipt':{'native':'retained'}}
def fixture(lost=False):
    return [2 if lost else 0,2 if lost else 0,'Transit pass: 0 terminal observations; 1 retained jobs unconfirmed' if lost else 'Transit pass: 1 terminal observations; 0 retained jobs unconfirmed',[{'loaderOnly':True}],[{'status':200,'path':'/rest/v1/rpc/scan_gtfs_ingest_candidates','candidateEmpty':True},{'status':200,'path':'/rest/v1/rpc/complete_gtfs_ingest','dropped':lost}],{'settled':not lost},{'resolved':False,'receipt':None} if lost else terminal,terminal]
for label in ('baseline','harmless','restored','lost-reply'):
    args=fixture(label=='lost-reply')
    if label=='harmless':args[3][0]['reviewerNote']='Unrelated'
    r.verify_cli_observation(*args);records.append({'case':label,'passed':True})
variants=[('expanded-cli-exit',lambda a:a.__setitem__(0,1)),('expanded-cli-unexpected-work',lambda a:a[3].append({'computationRefused':True})),('expanded-cli-unexpected-work',lambda a:a[3].append({'directNetworkRefused':True})),('expanded-cli-native-rpc',lambda a:a[4][1].update(status=503)),('expanded-cli-native-empty-queue',lambda a:a[4][0].update(candidateEmpty=False)),('expanded-cli-completion-delivery',lambda a:a[4].pop()),('expanded-cli-completion-delivery',lambda a:a[4][1].update(dropped=True)),('expanded-cli-job-state',lambda a:a[5].update(settled=False)),('expanded-cli-terminal',lambda a:a.__setitem__(6,{'resolved':False,'receipt':None})),('expanded-cli-planner-status',lambda a:a.__setitem__(2,'unconfirmed'))]
node=next(n for n in ast.parse(source.read_text()).body if isinstance(n,ast.FunctionDef) and n.name=='verify_cli_observation')
for reason,change in variants:
    args=copy.deepcopy(fixture());change(args)
    try:r.verify_cli_observation(*args)
    except ValueError as error:assert str(error)==reason
    else:raise AssertionError('Broken native observation survived '+reason)
    mutated=copy.deepcopy(node)
    class Omit(ast.NodeTransformer):
        def visit_Expr(self,node):
            v=node.value
            if isinstance(v,ast.Call) and len(v.args)==2 and isinstance(v.args[1],ast.Constant) and v.args[1].value==reason:return ast.copy_location(ast.Pass(),node)
            return self.generic_visit(node)
    Omit().visit(mutated);space={'s':r.s};exec(compile(ast.Module(body=[mutated],type_ignores=[]),str(source),'exec'),space);space['verify_cli_observation'](*args)
    records.append({'case':reason,'refused':True,'omittedGuardAllowsBroken':True})
(p/'native-observation-controls.json').write_text(json.dumps({'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'records':records,'limits':'Pure synthetic observations against the actual result guard; no services, CLI, files or database changed.'},indent=2)+'\n');print('4 positive, 10 broken CLI observations and 10 omitted-guard oracles pass.')
