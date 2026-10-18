"""Final preparation readback. No operating admission, DB transport or app stage."""
import ast
import copy
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import types
from urllib.parse import urlsplit

HERE=Path(__file__).resolve().parent
REPO=HERE.parents[2]
PRIVATE=Path('/home/nathaniel/.local/state/openplan/pr330-memory-preview-20261015-r2')
V6=Path('/home/nathaniel/.local/state/openplan/project-portfolio-skip-preview-20261015-v6')


def sha(path):
    h=hashlib.sha256()
    with path.open('rb') as stream:
        for b in iter(lambda:stream.read(1048576),b''):h.update(b)
    return h.hexdigest()


def compare(expected,actual):
    assert expected==actual,'binding mismatch'


def functions(source):
    return {n.name:ast.dump(n,include_attributes=False) for n in ast.parse(source).body if isinstance(n,ast.FunctionDef)}


def main():
    os.umask(0o077)
    packet=json.loads((PRIVATE/'packet.json').read_text());base=PRIVATE/'templates'
    sealed=packet['sealed'];observed={n:{'sha256':sha(base/n),'mode':(base/n).stat().st_mode&511} for n in sealed}
    compare(sealed,copy.deepcopy(observed))
    bad=copy.deepcopy(observed);bad['memory_storage.py']['sha256']='0'*64
    try:compare(sealed,bad)
    except AssertionError:pass
    else:raise AssertionError('bad binding accepted')
    def require_refusal(comparator):
        try:comparator(sealed,bad)
        except AssertionError as error:
            assert str(error)=='binding mismatch'
            return
        raise AssertionError('missing binding refusal')
    require_refusal(compare)
    try:require_refusal(lambda expected,actual:None)
    except AssertionError as error:assert str(error)=='missing binding refusal'
    else:raise AssertionError('disabled comparator survived')
    compare(sealed,observed)
    edges=0
    for name in ['private-bindings.json','template-binding.json']:
        for target,value in json.loads((base/name).read_text()).items():
            compare(value,sha(base/target));edges+=1
    binding=json.loads((base/'binding-private.json').read_text())
    for target,value in binding['files'].items():compare(value,sha(base/target));edges+=1
    app_ast=ast.parse((base/'app_binding_v1.py').read_text())
    fn=next(n for n in app_ast.body if isinstance(n,ast.FunctionDef) and n.name=='bindings')
    required=next(ast.literal_eval(n.value) for n in fn.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='expected' for t in n.targets))
    compare(required,set(binding['files']))
    compare(binding['appHead'],packet['head']);compare(binding['producer'],packet['head']);compare(binding['helperHead'],packet['head'])
    oldplan=json.loads((V6/'plan-private.json').read_text());newplan=json.loads((base/'plan-private.json').read_text())
    oldenv=json.loads((V6/'envs-private.json').read_text());newenv=json.loads((base/'envs-private.json').read_text())
    replacements=[(oldplan['target'],newplan['target']),('127.74.19.11','127.74.19.13'),('29949','29952'),('3586','3587')]
    replacements.extend((oldplan['names'][k],newplan['names'][k]) for k in oldplan['names'])
    def rebound(value):
        for old,new in replacements:value=value.replace(old,new)
        return value
    compare({k:{n:rebound(v) for n,v in values.items()} for k,values in oldenv.items()},newenv)
    for kind,key,role in [('rest','PGRST_DB_URI','authenticator'),('auth','GOTRUE_DB_DATABASE_URL','supabase_auth_admin'),('storage','DATABASE_URL','supabase_storage_admin')]:
        old=urlsplit(oldenv[kind][key]);new=urlsplit(newenv[kind][key])
        compare(new.username,role);compare(new.password,old.password);compare(new.path,'/'+newplan['target']);compare(new.query,old.query)
    for kind,values in oldenv.items():
        for key,value in values.items():
            if any(s in key for s in ['KEY','SECRET','PASSWORD']):compare(value,newenv[kind][key])
    oldapp=json.loads((V6/'app-env-private.json').read_text());newapp=json.loads((base/'app-env-private.json').read_text())
    for key,value in oldapp.items():
        expected=rebound(value).replace('49e3fa2004c1336ffa36c134a8f21bcc2d72d327',packet['head'])
        compare(expected,newapp[key])
    compare(json.loads((base/'acl-private.json').read_text())['sql'],json.loads((V6/'acl-private.json').read_text())['sql'].replace(oldplan['target'],newplan['target']))
    migrations=json.loads((base/'migrations.json').read_text());compare(len(migrations),420)
    for name,value in migrations.items():compare(sha(REPO/name),value)
    source=json.loads((base/'source-files.json').read_text())
    compare(source['head'],packet['head']);compare(source['appTree'],packet['appTree'])
    links={'candidate/'+n:v['target'] for n,v in source['files'].items() if v['gitMode']=='120000'}
    storage=types.ModuleType('storage_readback');exec(compile((HERE/'memory_storage.py').read_text(),'storage-readback','exec'),storage.__dict__)
    compare(storage.TRACKED_LINKS,links)
    compare(storage.SOURCE_BYTES,source['trackedBytes'])
    tree=ast.parse((base/'helper.py').read_text());nodes=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in {'sha','packet_inventory'}]
    scope={'Path':Path,'os':os,'stat':stat,'hashlib':hashlib};exec(compile(ast.Module(body=nodes,type_ignores=[]),'final-inventory-reader','exec'),scope)
    preserved=[]
    for index in [0,1,2]:
        before=json.loads((PRIVATE/'records'/('protected-before-'+str(index)+'.json')).read_text())
        after=scope['packet_inventory'](Path(before['root']));compare(before['entries'],after)
        path=PRIVATE/'records'/('protected-after-'+str(index)+'.json');path.write_text(json.dumps({'root':before['root'],'entries':after},indent=2)+'\n')
        preserved.append({'root':before['root'],'entries':len(after),'matched':True})
    active=json.loads((base/'active-helper-identities.json').read_text());ids=[]
    for group,item in active['groups'].items():
        compare(item['sourceSHA256'],sha(Path(item['source'])))
        compare(item['ids'],{k:v['id'] for k,v in json.loads(Path(item['source']).read_text()).items()});ids.extend(item['ids'].values())
    compare(len(set(ids)),8)
    for name,value in json.loads((V6/'preservation-files.json').read_text()).items():
        compare(value,{'sha256':sha(Path(name)),'mode':Path(name).stat().st_mode&511})
    # Reuse old accepted controls only where their actual function subjects match.
    initial=(PRIVATE/'templates-before-storage-review/helper.py').read_text();final=(base/'helper.py').read_text()
    oldfuncs=functions(initial);newfuncs=functions(final)
    reused=[n for n in ['active_helper_identities','require_active_helper','preserve','packet_inventory'] if oldfuncs[n]==newfuncs[n]]
    journal_old=functions((PRIVATE/'templates-after-R1R2R3-first/journal.py').read_text());journal_new=functions((base/'journal.py').read_text())
    reused_journal=[n for n in ['begin','bytes_once','record','effect','execute'] if journal_old[n]==journal_new[n]]
    compare(len(reused),4);compare(len(reused_journal),5)
    resources={};group=Path('/sys/fs/cgroup')/Path('/proc/self/cgroup').read_text().split('0::',1)[1].strip().lstrip('/')
    for name in ['memory.max','memory.swap.max','memory.swap.current','memory.peak','memory.events','cpu.max']:resources[name]=(group/name).read_text().strip()
    try:storage.observe_capacity();capacity='admitted'
    except ValueError as e:capacity=str(e)
    free=__import__('shutil').disk_usage(PRIVATE).free
    compare(Path(packet['root']).exists(),False);compare(list((PRIVATE/'execution').iterdir()),[])
    compare((PRIVATE/'admission.json').exists(),False);compare((PRIVATE/'journal').exists(),False)
    known={v for values in [*oldenv.values(),oldapp] for k,v in values.items() if len(v)>12 and any(s in k for s in ['KEY','SECRET','PASSWORD','DATABASE_URL','DB_URI'])}
    leaks=[str(p.relative_to(HERE)) for p in HERE.rglob('*') if p.is_file() and any(v in p.read_text() for v in known)]
    compare(leaks,[])
    result={'preparedOnly':True,'executionBlocked':True,'head':packet['head'],'appTree':packet['appTree'],
        'sealedInputs':len(sealed),'internalEdges':edges,'migrations':len(migrations),'sourceFiles':len(source['files']),
        'sourceBytes':source['trackedBytes'],'sourceInventorySHA256':sha(base/'source-files.json'),
        'trackedLinks':links,'typedProtectedIds':8,'privateEnvironmentAndACLMechanicalOnly':True,
        'preserved':preserved,'fixedProtectedFiles':len(json.loads((V6/'preservation-files.json').read_text())),
        'reusedAffectedHelperFunctions':reused,'reusedJournalSubjects':reused_journal,
        'capacityRefusal':capacity,'durableFreeBytes':free,'runtimeRootAbsent':True,'operatingExecutionEmpty':True,
        'realAdmissionAbsent':True,'resources':resources,'knownSecretLeaks':leaks,
        'controls':['harmless exact copied bindings survive','wrong digest refuses','removed comparator is the missing-refusal specimen','bindings restored'],
        'boundary':'Preparation custody only. No current DB, service health, build, startup, browser or independent final review acceptance.'}
    (PRIVATE/'records/final-readback.json').write_text(json.dumps(result,indent=2)+'\n')
    (HERE/'final-readback.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({k:result[k] for k in ['sealedInputs','internalEdges','migrations','sourceFiles','typedProtectedIds','capacityRefusal','durableFreeBytes']}))


def comparator_only():
    wanted={'private-input':'a'*64};bad={'private-input':'b'*64}
    compare(wanted,copy.deepcopy(wanted))
    def requires(comparator):
        try:comparator(wanted,bad)
        except AssertionError as error:
            assert str(error)=='binding mismatch';return
        raise AssertionError('missing binding refusal')
    requires(compare)
    try:requires(lambda a,b:None)
    except AssertionError as error:assert str(error)=='missing binding refusal'
    else:raise AssertionError('disabled comparator accepted')
    result={'harmless':'survived','badDigest':'binding mismatch','removedComparator':'missing binding refusal',
        'restored':True,'boundary':'Supplemental tiny comparator control; no repeated packet/file campaign.'}
    (PRIVATE/'records/readback-comparator.json').write_text(json.dumps(result,indent=2)+'\n')
    (HERE/'readback-comparator.json').write_text(json.dumps(result,indent=2)+'\n')


if __name__=='__main__':
    comparator_only() if sys.argv[1:]==['comparator-only'] else main()
