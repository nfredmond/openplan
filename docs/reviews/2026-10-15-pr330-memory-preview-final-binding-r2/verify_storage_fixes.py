"""R1/R2 private link/archive and actual namespace write probes only."""
import ast
import hashlib
import json
import os
from pathlib import Path
import subprocess
import types
import uuid

HERE=Path(__file__).resolve().parent
PRIVATE=Path('/home/nathaniel/.local/state/openplan/pr330-memory-preview-20261015-r2')
STORAGE=(HERE/'memory_storage.py').read_bytes()
APP=(HERE/'templates/app_binding_v1.py').read_bytes()


def storage(source=STORAGE):
    m=types.ModuleType('storage_copy');exec(compile(source,'storage-copy','exec'),m.__dict__)
    return m


def links(source=STORAGE, fault=None):
    m=storage(source);root=PRIVATE/'fixtures'/('links-'+uuid.uuid4().hex);root.mkdir(mode=0o700)
    (root/'candidate/.agents').mkdir(parents=True,mode=0o700)
    (root/'candidate/openplan').mkdir(mode=0o700)
    (root/'candidate/.agents/skills').symlink_to('../.claude/skills')
    (root/'candidate/openplan/node_modules').symlink_to(m.DEPS)
    if fault=='tracked-target':
        (root/'candidate/.agents/skills').unlink();(root/'candidate/.agents/skills').symlink_to('/etc/passwd')
    elif fault=='donor-target':
        (root/'candidate/openplan/node_modules').unlink();(root/'candidate/openplan/node_modules').symlink_to('/etc')
    elif fault=='unowned':
        (root/'unowned').symlink_to('/etc/passwd')
    dest=root.parent/(root.name+'-archive');dest.mkdir(mode=0o700)
    m.capture(root,dest,{'head':m.HEAD,'appTree':m.TREE},'successful')
    receipt=json.loads((dest/'archive-ready.json').read_text())
    assert receipt['entries']['candidate/.agents/skills']['target']=='../.claude/skills', 'tracked link literal lost'
    assert receipt['entries']['candidate/openplan/node_modules']['target']==m.DEPS, 'donor literal lost'


def wrapper(phase, source=APP):
    # Compile the actual builder only. No app module or operating main runs.
    tree=ast.parse(source);node=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='confined_argv')
    root=PRIVATE/'fixtures'/('wrapper-'+uuid.uuid4().hex);root.mkdir(mode=0o700)
    app=root/'candidate/openplan';app.mkdir(parents=True,mode=0o700)
    run=root/'execution';run.mkdir(mode=0o700);(run/'tmp').mkdir(mode=0o700)
    for n in ['memory_storage.py','policy.py','operation-files.sha256','app-env-private.json']:(root/n).write_text('fixture controller\n')
    (app/'.env.local').write_text('FIXTURE=true\n')
    virtual=Path('/dev/shm/openplan-pr330-preview-20261015')
    m=storage();scope={'ROOT':virtual,'CANDIDATE':virtual/'candidate','APP':virtual/'candidate/openplan',
        'RUN':virtual/'execution','DEPS':Path(m.DEPS),'HOST':'127.74.19.13'}
    exec(compile(ast.Module(body=[node],type_ignores=[]),'actual-builder-copy','exec'),scope)
    argv=scope['confined_argv'](phase);end=argv.index('/usr/bin/npm');argv=argv[:end]
    i=0
    while i<len(argv):
        if argv[i] in {'--bind','--ro-bind'}:
            if argv[i+1].startswith(str(virtual)):
                argv[i+1]=str(root)+argv[i+1][len(str(virtual)):]
            i+=3
        else:i+=1
    probe="""import errno,json,os
from pathlib import Path
r=Path('/dev/shm/openplan-pr330-preview-20261015');out={}
for name in ['memory_storage.py','policy.py','operation-files.sha256','app-env-private.json']:
 try:
  fd=os.open(r/name,os.O_WRONLY);os.close(fd);out[name]='writable'
 except OSError as e:out[name]=e.errno
for name in ['candidate/openplan/write-probe','execution/write-probe']:
 (r/name).write_text('owned fixture');out[name]='written'
Path('/tmp/tmp-write-probe').write_text('owned fixture');out['tmp']='written'
print(json.dumps(out,sort_keys=True))
"""
    result=subprocess.run(argv+['/usr/bin/python3','-B','-c',probe],env={'PATH':'/usr/bin:/bin'},capture_output=True,timeout=15)
    (root/'stdout.json').write_bytes(result.stdout);(root/'stderr.txt').write_bytes(result.stderr)
    assert result.returncode==0, 'namespace probe did not run'
    value=json.loads(result.stdout)
    assert all(value[n]==30 for n in ['memory_storage.py','policy.py','operation-files.sha256','app-env-private.json']), 'controller write must refuse EROFS'
    assert value['candidate/openplan/write-probe']=='written' and value['execution/write-probe']=='written' and value['tmp']=='written'
    assert all((root/n).read_text()=='fixture controller\n' for n in ['memory_storage.py','policy.py','operation-files.sha256','app-env-private.json'])


def special_inventory():
    text=(HERE/'templates/helper.py').read_text();tree=ast.parse(text)
    node=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='packet_inventory')
    import stat
    root=PRIVATE/'fixtures'/('special-'+uuid.uuid4().hex);root.mkdir(mode=0o700);os.mkfifo(root/'pipe')
    scope={'Path':Path,'os':os,'stat':stat,'sha':lambda p:'stand-in-hash'}
    exec(compile(ast.Module(body=[node],type_ignores=[]),'special-copy','exec'),scope)
    assert scope['packet_inventory'](root)['pipe']['kind']=='special'
    broken=ast.unparse(node).replace("elif path.is_file():",'else:')
    # Remove only the newly added special branch in the private specimen.
    lines=broken.splitlines();start=next(i for i,x in enumerate(lines) if 'fileType=stat.S_IFMT' in x)
    del lines[start-1:start+1]
    scope2={'Path':Path,'os':os,'stat':stat,'sha':lambda p:'stand-in-hash'}
    exec('\n'.join(lines),scope2)
    assert scope2['packet_inventory'](root)['pipe']['kind']!='special'


def main():
    os.umask(0o077);records=[]
    links(STORAGE+b'\n# harmless R1 comment\n')
    records.append({'case':'R1 exact tracked link plus donor','result':'archive/readback accepts literal targets without dereference; harmless survives'})
    for fault in ['tracked-target','donor-target','unowned']:
        try:links(fault=fault)
        except ValueError as e:assert str(e)=='archive-link'
        else:raise AssertionError('R1 fault accepted:'+fault)
        records.append({'case':'R1 '+fault,'result':'archive-link refusal'})
    old=STORAGE.replace(b"{**TRACKED_LINKS, 'candidate/openplan/node_modules':DEPS}",b"{'candidate/openplan/node_modules':DEPS}")
    try:links(old)
    except ValueError as e:assert str(e)=='archive-link'
    else:raise AssertionError('R1 old guard fault not reproduced')
    records.append({'case':'R1 removed tracked map','result':'positive acceptance assertion fails at archive-link'})
    for phase in ['build','start']:
        wrapper(phase,APP+b'\n# harmless R2 comment\n')
        bad=APP.replace(b"'--ro-bind', str(ROOT), str(ROOT)",b"'--bind', str(ROOT), str(ROOT)")
        assert bad!=APP
        try:wrapper(phase,bad)
        except AssertionError as e:assert str(e)=='controller write must refuse EROFS'
        else:raise AssertionError('R2 root-write fault survived')
        records.append({'case':'R2 '+phase,'result':'four controller/seal writes EROFS; candidate/execution/tmp writes succeed; writable-root fault detected'})
    special_inventory();records.append({'case':'old FIFO custody','result':'metadata capture completes; removed special branch misclassifies'})
    assert (HERE/'memory_storage.py').read_bytes()==STORAGE and (HERE/'templates/app_binding_v1.py').read_bytes()==APP
    result={'preparedOnly':True,'controls':records,'exactRestoration':True,
        'storageSHA256':hashlib.sha256(STORAGE).hexdigest(),'appBindingSHA256':hashlib.sha256(APP).hexdigest(),
        'blindCategories':['namespace probes bind disk fixtures; no real tmpfs candidate or application/native addon',
            'archive readback is not extraction/recovery','no DB/helper/start/build/browser operation']}
    (PRIVATE/'records/storage-fixes.json').write_text(json.dumps(result,indent=2)+'\n')
    (HERE/'storage-fixes.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'controls':len(records),'restored':True}))


if __name__=='__main__':main()
