"""R3 crash/failure/order controls. Mutators are private file/process stand-ins."""
import ast
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import types
import uuid

HERE=Path(__file__).resolve().parent
PRIVATE=Path('/home/nathaniel/.local/state/openplan/pr330-memory-preview-20261015-r2')
SOURCE=(HERE/'journal.py').read_bytes()


def module(source=SOURCE):
    m=types.ModuleType('journal_specimen');exec(compile(source,'journal-specimen','exec'),m.__dict__)
    root=PRIVATE/'fixtures'/('journal-'+uuid.uuid4().hex);root.mkdir(mode=0o700);m.DURABLE=root
    events=[];real=os.fsync
    def fsync(fd):
        path=os.readlink('/proc/self/fd/'+str(fd));events.append(path);real(fd)
    m.os=types.SimpleNamespace(**vars(os));m.os.fsync=fsync
    return m,root,events


def remove_expression(source, function, needle):
    tree=ast.parse(source);node=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name==function)
    hits=[n for n in ast.walk(node) if isinstance(n,ast.Expr) and needle in ast.unparse(n)]
    assert len(hits)==1, 'journal mutation anchor'
    class Change(ast.NodeTransformer):
        def visit_Expr(self,n):return ast.copy_location(ast.Pass(),n) if n is hits[0] else self.generic_visit(n)
    return ast.unparse(ast.fix_missing_locations(Change().visit(tree))).encode()


def ordered_effect(source=SOURCE):
    m,root,events=module(source)
    def action():
        intent=root/'journal/allocate-working-root/intent.json'
        assert intent.is_file(), 'mutator before durable intent'
        assert str(intent) in events, 'mutator before intent file fsync'
        assert str(intent.parent) in events, 'mutator before intent directory fsync'
        (root/'fake-external-effect').write_text('once')
        return {'oid':12345}
    m.effect('allocate-working-root',{'target':'fixture only'},action)
    assert json.loads((root/'journal/allocate-working-root/result.json').read_text())['value']=={'oid':12345}
    return m,root


def receipt_order(helper_source):
    m,root,events=module();work=root/'volatile-stand-in';work.mkdir(mode=0o700)
    tree=ast.parse(helper_source);node=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='write')
    scope={'OUT':work,'j':m,'json':json,'os':os}
    exec(compile(ast.Module(body=[node],type_ignores=[]),'actual-helper-write-copy','exec'),scope)
    value={'id':'a'*64,'oid':12345}
    scope['write']('target-identity.json',value)
    def next_mutator():
        target=root/'receipts/target-identity.json'
        assert target.is_file() and json.loads(target.read_text())==value,'next mutator before durable returned identity'
        assert str(target) in events and str(target.parent) in events,'returned identity not fsynced before next mutator'
        return {'next':'fixture only'}
    m.effect('next-fake-mutator',{},next_mutator)


def caller_guards(helper,app,transport,runner):
    def names(text):
        out=[]
        for n in ast.walk(ast.parse(text)):
            if isinstance(n,ast.Call):
                for k in n.keywords:
                    if k.arg=='mutation':out.append(ast.unparse(k.value))
                if isinstance(n.func,ast.Attribute) and isinstance(n.func.value,ast.Name) and n.func.value.id=='j' and n.func.attr in {'execute','effect','begin'}:
                    out.append(ast.unparse(n.args[0]))
        return out
    h=names(helper);a=names(app);t=names(transport)
    assert all(x in h for x in ["'db-create'","'db-restore'","'db-acl'","'db-upgrade'","'storage-copy'","'helper-' + kind + '-create'","'helper-' + kind + '-start'"]), 'missing helper durable barrier'
    assert all(x in a for x in ["'source-clone'","'source-checkout'","'webpack-build'","'npm-start-exec'"]), 'missing app durable barrier'
    assert "'observer-' + nonce" in t,'missing observer request barrier'
    assert "'admittedArchive': admitted_archive" in app, 'admitted archive hashes absent from start intent'
    assert 'journal.py" claim "request-$stage"' in runner and runner.count('journal.py" execute "unit-$stage"')==4,'missing unit request durable barrier'


def main():
    os.umask(0o077);records=[]
    ordered_effect(SOURCE+b'\n# harmless R3 comment\n');records.append({'case':'harmless journal comment','result':'survived'})
    for function,needle,expected in [('begin',"json_once(path / 'intent.json'",'mutator before durable intent'),
        ('bytes_once','os.fsync(stream.fileno())','mutator before intent file fsync'),
        ('bytes_once','sync_directory(path.parent)','mutator before intent directory fsync')]:
        mutated=remove_expression(SOURCE,function,needle)
        try:ordered_effect(mutated)
        except AssertionError as e:assert str(e)==expected
        else:raise AssertionError('R3 ordering fault survived')
        records.append({'case':expected,'result':'intended ordering assertion fails when barrier removed'})
    m,root=ordered_effect()
    try:m.effect('allocate-working-root',{},lambda:(_ for _ in ()).throw(AssertionError('retry side effect')))
    except FileExistsError:pass
    else:raise AssertionError('exclusive retry accepted')
    records.append({'case':'allocation retry','result':'durable exclusive directory refuses before effect'})
    m,root,events=module()
    def fail():
        (root/'external-created').write_text('once');raise RuntimeError('fake lost acknowledgement')
    try:m.effect('fake-create',{},fail)
    except RuntimeError:pass
    assert (root/'journal/fake-create/failure.json').is_file()
    try:m.effect('fake-create',{},fail)
    except FileExistsError:pass
    else:raise AssertionError('lost-ack retry accepted')
    records.append({'case':'failed/lost acknowledgement','result':'intent/failure retained; retry refused'})
    crash=PRIVATE/'fixtures'/('crash-'+uuid.uuid4().hex);crash.mkdir(mode=0o700)
    program="import sys,os;from pathlib import Path;sys.path.insert(0,"+repr(str(HERE))+");import journal as j;j.DURABLE=Path("+repr(str(crash))+");j.effect('crash-create',{},lambda:(j.bytes_once(j.DURABLE/'external-created',b'once'),os._exit(23)))"
    completed=subprocess.run([sys.executable,'-B','-c',program],capture_output=True,timeout=10)
    assert completed.returncode==23 and (crash/'journal/crash-create/intent.json').is_file() and (crash/'external-created').read_bytes()==b'once'
    m,_,_=module();m.DURABLE=crash
    try:m.effect('crash-create',{},lambda:None)
    except FileExistsError:pass
    else:raise AssertionError('crash retry accepted')
    records.append({'case':'real stand-in controller os._exit','result':'durable intent survives missing acknowledgement/result and bars retry'})
    m,root,events=module()
    process=m.execute('failed-child',[sys.executable,'-B','-c',"import sys;print('fake stdout');print('fake stderr',file=sys.stderr);sys.exit(9)"],env={'PATH':'/usr/bin:/bin'},timeout=10)
    assert process.returncode==9 and (root/'journal/failed-child/stdout.bin').read_bytes()==b'fake stdout\n' and (root/'journal/failed-child/stderr.bin').read_bytes()==b'fake stderr\n'
    assert json.loads((root/'journal/failed-child/exit.json').read_text())['returncode']==9
    records.append({'case':'failed native stand-in','result':'exact stdout/stderr/exit retained durably'})
    helper=(HERE/'templates/helper.py').read_text();receipt_order(helper)
    mutated=remove_expression(helper.encode(),'write','j.record(name, value)')
    try:receipt_order(mutated)
    except AssertionError as e:assert str(e)=='next mutator before durable returned identity'
    else:raise AssertionError('returned identity barrier mutation survived')
    records.append({'case':'returned OID/helper ID','result':'actual helper writer persists/fyncs receipt before next fake mutator; removed mirror detected'})
    app=(HERE/'templates/app_binding_v1.py').read_text();transport=(HERE/'templates/observer_transport.py').read_text();runner=(HERE/'templates/run_stage.sh').read_text()
    caller_guards(helper,app,transport,runner)
    bad=helper.replace(",mutation='db-create'",'')
    try:caller_guards(bad,app,transport,runner)
    except AssertionError as e:assert str(e)=='missing helper durable barrier'
    else:raise AssertionError('unbarriered DB callsite mutation survived')
    bad=app.replace("'admittedArchive': admitted_archive", "'lostArchive': {}")
    try:caller_guards(helper,bad,transport,runner)
    except AssertionError as e:assert str(e)=='admitted archive hashes absent from start intent'
    else:raise AssertionError('lost archive binding mutation survived')
    records.append({'case':'composed mutator callsites/start archive identity','result':'all fixed DB/helper/git/build/exec/unit/observer barriers present; missing DB barrier/archive binding detected'})
    assert (HERE/'journal.py').read_bytes()==SOURCE
    result={'preparedOnly':True,'controls':records,'exactRestoration':True,'journalSHA256':hashlib.sha256(SOURCE).hexdigest(),
        'blindCategories':['fake file/process mutators only, no DB/helper/build/start','fsync ordering is not power-loss/reboot testing',
            'callsite census protects named current syntax; independent final review must inspect semantics']}
    (PRIVATE/'records/journal-controls.json').write_text(json.dumps(result,indent=2)+'\n')
    (HERE/'journal-controls.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'controls':len(records),'restored':True}))


if __name__=='__main__':main()
