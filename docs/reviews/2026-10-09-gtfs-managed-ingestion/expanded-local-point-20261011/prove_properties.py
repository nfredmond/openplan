"""Pure fresh-target and ICU creation checks before native property effects."""
import ast,copy,hashlib,json,re
from pathlib import Path
from scope import require,verify_properties,DB_ID
source=Path(__file__).with_name('properties.py');tree=ast.parse(source.read_text())
nodes=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in ('fresh','creation_args','verify_command')]
def load(nodes):
    space={'require':require,'verify_properties':verify_properties,'DB_ID':DB_ID,'re':re,'hashlib':hashlib};exec(compile(ast.Module(body=nodes,type_ignores=[]),str(source),'exec'),space);return space
space=load(nodes);fixture=['openplan_attempt_cli_'+'a'*32,{'owner':'postgres','encoding':'UTF8','collate':'C.UTF-8','ctype':'C.UTF-8','localeProvider':'i','locale':'und','connectionLimit':-1},[]];records=[]
for label in ('baseline','harmless','restored'):
    args=copy.deepcopy(fixture)
    if label=='harmless':args[1]['reviewerNote']='Unrelated'
    result=space['creation_args'](*args)
    assert result[-1]==fixture[0] and result[result.index('--owner')+1]=='postgres' and result[result.index('--icu-locale')+1]=='und'
    records.append({'case':label,'passed':True})
variants=[('expanded-property-target',lambda a:a.__setitem__(0,'postgres'),'fresh'),('expanded-property-existing',lambda a:a[2].append(a[0]),'creation_args')]
for reason,change,function in variants:
    args=copy.deepcopy(fixture);change(args)
    try:space['creation_args'](*args)
    except ValueError as error:assert str(error)==reason
    else:raise AssertionError('Broken property target survived: '+reason)
    omitted=copy.deepcopy(nodes);fn=next(n for n in omitted if n.name==function)
    fn.body=[n for n in fn.body if not(isinstance(n,ast.Expr) and isinstance(n.value,ast.Call) and len(n.value.args)==2 and isinstance(n.value.args[1],ast.Constant) and n.value.args[1].value==reason)] or [ast.Pass()]
    mutant=load(ast.fix_missing_locations(ast.Module(body=omitted,type_ignores=[])).body)
    try:mutant['creation_args'](*args);raise AssertionError('Broken property target survived: '+reason)
    except AssertionError as error:assert str(error)=='Broken property target survived: '+reason
    records.append({'reason':reason,'refused':True,'omittedGuardFailsOracle':True})
# A targeted creation fault drops ICU arguments while all other source fields stay.
actual=space['creation_args'](*copy.deepcopy(fixture));broken=actual[:actual.index('--locale-provider')]+[fixture[0]]
try:assert '--icu-locale' in broken,'ICU locale silently dropped'
except AssertionError as error:assert str(error)=='ICU locale silently dropped'
records.append({'reason':'ICU locale silently dropped','targetedCreationFaultFails':True})
command='SELECT 1;';binding={'target':fixture[0],'sha256':hashlib.sha256(command.encode()).hexdigest()}
space['verify_command'](fixture[0],command,binding)
for reason,changes in [('expanded-property-command-target',{'target':'foreign'}),('expanded-property-command-bytes',{'sha256':'0'*64})]:
    expected={**binding,**changes}
    try:space['verify_command'](fixture[0],command,expected)
    except ValueError as error:assert str(error)==reason
    else:raise AssertionError('Broken property command survived: '+reason)
    omitted=copy.deepcopy(nodes);fn=next(n for n in omitted if n.name=='verify_command');fn.body=[n for n in fn.body if not(isinstance(n,ast.Expr) and isinstance(n.value,ast.Call) and len(n.value.args)==2 and isinstance(n.value.args[1],ast.Constant) and n.value.args[1].value==reason)]
    try:load(omitted)['verify_command'](fixture[0],command,expected);raise AssertionError('Broken property command survived: '+reason)
    except AssertionError as error:assert str(error)=='Broken property command survived: '+reason
    records.append({'reason':reason,'refused':True,'omittedGuardFailsOracle':True})
source.with_name('property-controls.json').write_text(json.dumps({'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'records':records,'limits':'Actual extracted creation functions and copied source properties. No SQL, service, database or configuration mutation.'},indent=2)+'\n');print('3 positive, 4 broken target/command cases and ICU creation fault controls pass.')
