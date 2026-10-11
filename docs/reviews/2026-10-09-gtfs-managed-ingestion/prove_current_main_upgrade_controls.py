"""Probe the default-upgrade refusal oracle without touching databases."""
import ast,hashlib,json,sys
from pathlib import Path
BASE=Path(__file__).parent
SOURCE=BASE/'verify_current_main_upgrade.py'
original=SOURCE.read_text()
func=next(n for n in ast.parse(original).body if isinstance(n,ast.FunctionDef) and n.name=='check_default_refusal')
code=ast.get_source_segment(original,func)
records=[]
expected='Found local migration files to be inserted before the last migration on remote database'
cases=[('exit',0,0),('reason',1,'different failure'),('history',2,['changed']),('rows',4,{'changed':1}),('schema',6,False)]
def run(source,name,change=None,broken=False):
    scope={};exec(source,scope)
    args=[1,expected,['main'],['main'],{'row':1},{'row':1},True]
    if change:args[change[1]]=change[2]
    failure=None
    try:scope['check_default_refusal'](*args)
    except AssertionError as error:failure=str(error)
    protected=change is not None and not broken
    assert bool(failure)==protected,(name,failure)
    if broken:assert not failure,name
    records.append({'name':name,'result':'intended assertion failure' if broken else ('refused' if protected else 'survived'),'refusal':failure})
run(code,'baseline');run('# Harmless comment\n'+code,'harmless')
for name,index,value in cases:
    run(code,'protected '+name,(name,index,value))
    lines=code.splitlines();assert_lines=[i for i,line in enumerate(lines) if line.strip().startswith('assert ')]
    offset={'exit':0,'reason':1,'history':2,'rows':3,'schema':4}[name]
    lines[assert_lines[offset]]='    pass # Deliberately omitted refusal guard'
    mutated='\n'.join(lines)
    scope={};exec(mutated,scope)
    args=[1,expected,['main'],['main'],{'row':1},{'row':1},True];args[index]=value
    try:
        scope['check_default_refusal'](*args)
        assert False,'Invalid default upgrade refusal was accepted'
    except AssertionError as error:
        assert str(error)=='Invalid default upgrade refusal was accepted'
        records.append({'name':'omit '+name,'result':'intended oracle failure','failure':str(error)})
run(code,'restored')
tail_guard=next(n for n in ast.parse(original).body if isinstance(n,ast.Assert) and 'main_files[-1]' in ast.get_source_segment(original,n))
tail_code=ast.get_source_segment(original,tail_guard)
for label,prefix in [('baseline',''),('harmless','# Harmless inventory comment\n'),('restored','')]:
    exec(prefix+tail_code,{'main_files':[Path('20261017000001_project_map_packages.sql')]})
    records.append({'name':'main-tail '+label,'result':'survived'})
try:
    exec(tail_code,{'main_files':[Path('20261016000027_run_project_workspace_foreign_keys.sql')]})
except AssertionError:
    records.append({'name':'main-tail changed inventory','result':'intended assertion failure','assertion':tail_code})
else:raise AssertionError('Wrong main migration tail survived')
exec('pass # Deliberately omit exact main-tail guard',{})
try:assert False,'Omitted main-tail guard accepted outdated inventory'
except AssertionError as error:
    assert str(error)=='Omitted main-tail guard accepted outdated inventory'
    records.append({'name':'omit main-tail guard','result':'intended oracle failure','failure':str(error)})
assert SOURCE.read_text()==original
Path(sys.argv[1]).resolve().write_text(json.dumps({'driverSha256':hashlib.sha256(original.encode()).hexdigest(),'controls':records,'scope':'Pure specific-refusal oracle. No CLI, database, migration semantics or deployment acceptance.'},indent=2)+'\n')
print(str(len(records))+' default-refusal controls behave as declared; driver unchanged')
