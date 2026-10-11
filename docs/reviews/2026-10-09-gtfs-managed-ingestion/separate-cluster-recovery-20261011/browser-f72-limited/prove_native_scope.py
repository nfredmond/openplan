"""Exercise scope refusals without writing or resetting a database."""
import copy,hashlib,importlib.util,json
from pathlib import Path
HERE=Path(__file__).parent
source=HERE/'read_native.py';original=source.read_bytes()
spec=importlib.util.spec_from_file_location('reader',source);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
container={'Id':m.CONTAINER,'Name':'/supabase_db_openplan-restore-target-2026091050','Config':{'Labels':{'com.supabase.cli.project':'openplan-restore-target-2026091050'}},'State':{'Running':True}}
settings=copy.deepcopy(m.SETTINGS);records=[]
try:
    m.verify_native_scope(settings,container);records.append({'case':'baseline','passed':True})
    harmless=copy.deepcopy(container);harmless['extra']='ignored metadata';m.verify_native_scope(settings,harmless);records.append({'case':'harmless metadata','passed':True})
    changes=[('isolated-database-scope',lambda s,c:s.__setitem__('database','foreign')),('isolated-source-scope',lambda s,c:s.__setitem__('sourceDatabase','foreign')),('isolated-container-identity',lambda s,c:c.__setitem__('Id','foreign')),('isolated-container-name',lambda s,c:c.__setitem__('Name','foreign')),('isolated-container-project',lambda s,c:c['Config']['Labels'].__setitem__('com.supabase.cli.project','foreign')),('isolated-container-running',lambda s,c:c['State'].__setitem__('Running',False))]
    for reason,change in changes:
        s,c=copy.deepcopy(settings),copy.deepcopy(container);change(s,c)
        try:m.verify_native_scope(s,c)
        except AssertionError as e:
            if str(e)!=reason:raise RuntimeError('wrong intended refusal')
        else:raise RuntimeError('broken scope survived')
        line=next(line for line in original.decode().splitlines() if line.strip().startswith('assert ') and '"'+reason+'"' in line)
        namespace={'CONTAINER':m.CONTAINER,'__file__':str(source)};exec(original.decode().split('def read_native():')[0].replace(line,'    pass'),namespace)
        namespace['verify_native_scope'](s,c)
        records.append({'case':reason,'targetedRefusal':True,'omittedGuardAdmitsBrokenScope':True})
    m.verify_native_scope(settings,container);records.append({'case':'restored','passed':True})
finally:
    if source.read_bytes()!=original:raise RuntimeError('scope source changed')
(HERE/'native-scope-controls.json').write_text(json.dumps({'cases':records,'sourceSha256':hashlib.sha256(original).hexdigest(),'blindCategory':'Pure identity controls cannot establish native row contents, all database isolation or browser usability.'},indent=2)+'\n')
