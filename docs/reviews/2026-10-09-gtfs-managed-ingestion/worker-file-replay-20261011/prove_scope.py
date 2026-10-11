"""Exercise actual extracted replay guards before any native service access."""
import ast,copy,hashlib,json
from pathlib import Path

source=Path(__file__).with_name('run.py');tree=ast.parse(source.read_text())
names={'HEAD','CONTAINER','DATABASE','API'}
constants=[n for n in tree.body if isinstance(n,ast.Assign) and isinstance(n.targets[0],ast.Name) and n.targets[0].id in names]
functions=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in {'require','scope'}]
def load(nodes):
    space={};exec(compile(ast.Module(body=[*constants,*nodes],type_ignores=[]),str(source),'exec'),space);return space
space=load(functions);scope=space['scope']
fixture=[space['HEAD'],'',{'database':space['DATABASE'],'api_url':space['API']},{'Id':space['CONTAINER'],'Name':'/supabase_db_openplan-restore-target-2026091050','Config':{'Labels':{'com.supabase.cli.project':'openplan-restore-target-2026091050'}},'State':{'Running':True}},False,0]
records=[]
for label in ['baseline','harmless','restored']:
    args=copy.deepcopy(fixture)
    if label=='harmless':args[3]['Config']['Labels']['reviewerNote']='Unrelated label'
    scope(*args);records.append({'case':label,'passed':True})
variants=[('replay-source-scope',lambda x:x.__setitem__(0,'different')),('replay-target-scope',lambda x:x[2].update(database='postgres')),('replay-container-scope',lambda x:x[3].update(Id='different')),('replay-container-project',lambda x:x[3]['State'].update(Running=False)),('replay-original-writer-active',lambda x:x.__setitem__(4,True)),('replay-other-work-pending',lambda x:x.__setitem__(5,1))]
for reason,change in variants:
    args=copy.deepcopy(fixture);change(args)
    try:scope(*args)
    except ValueError as error:assert str(error)==reason
    else:raise AssertionError('Broken scope survived: '+reason)
    omitted=copy.deepcopy(functions)
    fn=next(n for n in omitted if n.name=='scope');fn.body=[n for n in fn.body if not(isinstance(n,ast.Expr) and isinstance(n.value,ast.Call) and len(n.value.args)==2 and isinstance(n.value.args[1],ast.Constant) and n.value.args[1].value==reason)]
    changed=load(omitted)
    try:
        changed['scope'](*args)
        raise AssertionError('Broken scope survived: '+reason)
    except AssertionError as error:assert str(error)=='Broken scope survived: '+reason
    records.append({'case':reason,'refused':True,'omittedGuardFailsOracle':True});scope(*fixture)
Path(__file__).with_name('scope-controls.json').write_text(json.dumps({'records':records,'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'limits':'Extracted guards and copied fixture only. No Docker, database, files, worker or network mutation.'},indent=2)+'\n')
print('3 positive, 6 broken scopes and 6 omitted-guard oracles pass.')
