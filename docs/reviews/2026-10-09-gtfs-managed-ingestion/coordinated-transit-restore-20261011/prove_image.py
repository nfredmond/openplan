"""Test exact table, sequence and schema comparison before native capture."""
import ast,copy,hashlib,json
from pathlib import Path
source=Path(__file__).with_name('run.py');tree=ast.parse(source.read_text())
nodes=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='equal_image']
def require(value,reason):
    if not value:raise ValueError(reason)
def load(nodes):
    space={'require':require};exec(compile(ast.Module(body=nodes,type_ignores=[]),str(source),'exec'),space);return space['equal_image']
check=load(nodes);fixture={'tables':[{'table':'public.synthetic','count':1,'sha256':'a'*64}],'sequences':[{'sequence':'public.synthetic_id','last_value':10,'is_called':True}],'schemaSha256':'b'*64}
records=[]
for label in ('baseline','harmless','restored'):
    actual=copy.deepcopy(fixture)
    if label=='harmless':actual=json.loads(json.dumps(actual,sort_keys=True))
    check(fixture,actual);records.append({'case':label,'passed':True})
variants=[('coordinated-table-image-differs',lambda a:a['tables'].clear()),('coordinated-table-image-differs',lambda a:a['tables'][0].update(count=2)),('coordinated-table-image-differs',lambda a:a['tables'][0].update(sha256='c'*64)),('coordinated-sequence-image-differs',lambda a:a['sequences'][0].update(last_value=11)),('coordinated-schema-image-differs',lambda a:a.update(schemaSha256='d'*64))]
for reason,change in variants:
    actual=copy.deepcopy(fixture);change(actual)
    try:check(fixture,actual)
    except ValueError as error:assert str(error)==reason
    else:raise AssertionError('Broken image survived: '+reason)
    omitted=copy.deepcopy(nodes);omitted[0].body=[n for n in omitted[0].body if n.value.args[1].value!=reason]
    try:load(omitted)(fixture,actual);raise AssertionError('Broken image survived: '+reason)
    except AssertionError as error:assert str(error)=='Broken image survived: '+reason
    records.append({'reason':reason,'refused':True,'omittedGuardFailsOracle':True})
source.with_name('image-controls.json').write_text(json.dumps({'records':records,'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'limits':'Actual extracted comparison and copied images only. No native database or file changes.'},indent=2)+'\n')
print('3 positive, 5 broken images and 5 omitted-guard oracles pass.')
