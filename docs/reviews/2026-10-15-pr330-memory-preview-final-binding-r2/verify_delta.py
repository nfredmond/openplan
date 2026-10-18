"""Affected preparation guards only, using private stand-ins and exact copies."""
import ast
import copy
import hashlib
import json
import os
from pathlib import Path
import stat
import types
import uuid

HERE=Path(__file__).resolve().parent
PRIVATE=Path('/home/nathaniel/.local/state/openplan/pr330-memory-preview-20261015-r2')
HELPER=(HERE/'templates/helper.py').read_bytes()
SOURCE=(HERE/'source_binding.py').read_bytes()


def remove_guard(source, reason):
    tree=ast.parse(source);hits=[]
    for n in ast.walk(tree):
        if isinstance(n,ast.Expr) and isinstance(n.value,ast.Call):
            c=n.value
            if c.args and isinstance(c.args[-1],ast.Constant) and c.args[-1].value==reason:
                hits.append(n)
    assert len(hits)==1, 'guard-anchor:'+reason
    class Change(ast.NodeTransformer):
        def visit_Expr(self,n):
            return ast.copy_location(ast.Pass(),n) if n is hits[0] else self.generic_visit(n)
    return ast.unparse(ast.fix_missing_locations(Change().visit(tree))).encode()


def source_module(source):
    m=types.ModuleType('source_fixture');exec(compile(source,'source-specimen','exec'),m.__dict__)
    return m


def source_case(source, fault=None):
    m=source_module(source);root=PRIVATE/'fixtures'/('source-'+uuid.uuid4().hex);root.mkdir(mode=0o700)
    p=root/'data.txt';p.write_text('fixture source\n')
    link=root/'link';link.symlink_to('data.txt')
    expected={'files':{'data.txt':{'gitMode':'100644','bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()},
        'link':{'gitMode':'120000','bytes':8,'sha256':hashlib.sha256(b'data.txt').hexdigest()}}}
    if fault=='source-root':
        alias=root.parent/(root.name+'-alias');alias.symlink_to(root);root=alias
    elif fault=='source-relative-path':
        expected['files']['../outside']=expected['files'].pop('data.txt')
        (root.parent/'outside').write_text('fixture source\n')
    elif fault=='source-link-kind':
        link.unlink();link.write_text('data.txt')
        # Removed link guard reaches readlink. Isolate its downstream observer.
        m.os=types.SimpleNamespace(readlink=lambda p:'data.txt')
    elif fault=='source-file-kind':
        p.unlink();p.symlink_to(root.parent/'outside-target')
        (root.parent/'outside-target').write_text('fixture source\n')
    elif fault=='source-file-bytes':
        p.write_text('wrong bytes\n')
    return m.check(root,expected)


def helper_module(source):
    root=PRIVATE/'fixtures'/('helpers-'+uuid.uuid4().hex);root.mkdir(mode=0o700)
    v6=root/'v6-receipts.json';frozen=root/'frozen';(frozen/'rest-uri-recovery-01').mkdir(parents=True,mode=0o700)
    original=frozen/'rest-uri-recovery-01/active-service-receipts-private.json'
    active=copy.deepcopy(json.loads((PRIVATE/'templates/active-helper-identities.json').read_bytes()))
    states={};ids={}
    for group,path in [('original',original),('v6',v6)]:
        values=active['groups'][group]['ids'];path.write_text(json.dumps({k:{'id':v} for k,v in values.items()}))
        active['groups'][group]['source']=str(path);active['groups'][group]['sourceSHA256']=hashlib.sha256(path.read_bytes()).hexdigest()
        ids.update({group+':'+k:v for k,v in values.items()})
        for identity in values.values():
            states[identity]={'Id':identity,'Name':'fixture','Image':'fixed','Config':{'fixture':True},
                'HostConfig':{},'Mounts':[],'State':{'Running':True,'Paused':False,'Restarting':False}}
    policy=types.ModuleType('policy_fixture');exec(compile((HERE/'templates/policy.py').read_bytes(),'policy-fixture','exec'),policy.__dict__)
    active['configurationDigests']={identity:policy.digest({k:v[k] for k in ['Id','Name','Image','Config','HostConfig','Mounts']}) for identity,v in states.items()}
    tree=ast.parse(source.decode().replace('/home/nathaniel/.local/state/openplan/project-portfolio-skip-preview-20261015-v6/service-receipts-private.json',str(v6)))
    names={'active_helper_identities','require_active_helper','preserve','packet_inventory','sha'}
    nodes=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in names]
    m=types.SimpleNamespace();scope=m.__dict__;scope.update(Path=Path,os=os,stat=stat,hashlib=hashlib,json=json,p=policy,OUT=root,FROZEN=frozen)
    exec(compile(ast.Module(body=nodes,type_ignores=[]),'helper-specimen','exec'),scope)
    packets={'preservation-files.json':{},'v4-full-inventory-before.json':{
        '/home/nathaniel/.local/state/openplan/project-portfolio-skip-preview-20261015-v4':{},
        '/home/nathaniel/.t3/worktrees/openplan/t3-9eeec4ad/docs/reviews/2026-10-15-portfolio-skip-preview-v4-preparation':{}},
        'v5-packet-inventory-before.json':{},'v6-packet-inventory-before.json':{},'additional-packet-inventories.json':{},
        'active-helper-identities.json':active}
    scope.update(read=lambda n:packets[n],inspect=lambda i:states[i],packet_inventory=lambda p:{},
        protected_web=lambda:{'standIn':True},snapshot=lambda d:[])
    return m,root,packets,states,ids,active,v6


def helper_case(source, fault=None):
    m,root,packets,states,ids,active,v6=helper_module(source)
    if fault=='protected-active-groups':
        active['groups']['extra']={};return m.active_helper_identities()
    if fault=='protected-active-eight':
        old=active['groups']['v6']['ids']['auth'];new=active['groups']['original']['ids']['auth']
        active['groups']['v6']['ids']['auth']=new
        v6.write_text(json.dumps({k:{'id':v} for k,v in active['groups']['v6']['ids'].items()}))
        active['groups']['v6']['sourceSHA256']=hashlib.sha256(v6.read_bytes()).hexdigest()
        del active['configurationDigests'][old]
        return m.active_helper_identities()
    if fault=='protected-active-config-set':
        active['configurationDigests'][next(iter(states))]='bad';return m.active_helper_identities()
    baseline={'activeHelperIds':ids.copy(),'helpers':active['configurationDigests'].copy(),'databases':{}}
    packets['protected-runtime-before.json']=baseline
    (root/'protected-runtime-before.json').write_text('{}')
    if fault=='protected-active-config':
        identity=ids['v6:auth'];states[identity]['Config']['drift']=True
        baseline['helpers'][identity]=m.p.digest({k:states[identity][k] for k in ['Id','Name','Image','Config','HostConfig','Mounts']})
    elif fault and fault.startswith('state:'):
        _,kind,key=fault.split(':');states[ids['v6:'+kind]]['State'][key]=key!='Running'
    observed=m.preserve()
    assert len(observed['helpers'])==8 and len(observed['helperStates'])==8, 'eight helpers must reach composed preserve'
    return observed


def refusal(call, reason):
    try:
        call()
    except ValueError as e:
        assert str(e)==reason or str(e).startswith(reason+':'), 'wrong-refusal:'+reason+':'+str(e)
        return
    raise AssertionError('missing-refusal:'+reason)


def resources():
    path=Path('/sys/fs/cgroup')/Path('/proc/self/cgroup').read_text().split('0::',1)[1].strip().lstrip('/')
    return {k:(path/k).read_text().strip() for k in ['memory.max','memory.swap.max','memory.swap.current','memory.events','memory.peak','cpu.max']}


def main():
    os.umask(0o077);before=resources()
    assert before['memory.max']==str(512*1024**2) and before['memory.swap.max']=='0'
    q,p=map(int,before['cpu.max'].split());assert 0<q<=p//2
    records=[]
    source_case(SOURCE+b'\n# harmless source receipt comment\n')
    helper_case(HELPER+b'\n# harmless active identity comment\n')
    records.append({'case':'harmless source/helper comments','result':'survived'})
    for reason in ['source-root','source-relative-path','source-link-kind','source-file-kind','source-file-bytes']:
        refusal(lambda:source_case(SOURCE,reason),reason)
        mutated=remove_guard(SOURCE,reason)
        try:refusal(lambda:source_case(mutated,reason),reason)
        except AssertionError as e:assert str(e)=='missing-refusal:'+reason
        else:raise AssertionError('source mutation survived:'+reason)
        records.append({'case':reason,'result':'named refusal; removed guard detected'})
    for reason in ['protected-active-groups','protected-active-eight','protected-active-config-set','protected-active-config']:
        refusal(lambda:helper_case(HELPER,reason),reason)
        mutated=remove_guard(HELPER,reason)
        try:refusal(lambda:helper_case(mutated,reason),reason)
        except AssertionError as e:assert str(e)=='missing-refusal:'+reason
        else:raise AssertionError('helper mutation survived:'+reason)
        records.append({'case':reason,'result':'named refusal; removed guard detected'})
    for kind in ['auth','rest','storage','gateway']:
        for key in ['Running','Paused','Restarting']:
            refusal(lambda:helper_case(HELPER,'state:'+kind+':'+key),'protected-active-state')
            records.append({'case':'v6:'+kind+':'+key,'result':'typed refusal through composed preserve'})
    source_case(SOURCE);helper_case(HELPER)
    assert (HERE/'source_binding.py').read_bytes()==SOURCE and (HERE/'templates/helper.py').read_bytes()==HELPER
    result={'preparedOnly':True,'sourceHead':'f0cbeddff5ae3fc37e0dd8b91c02601429d977a6','controls':records,
        'exactRestoration':True,'sourceSHA256':hashlib.sha256(SOURCE).hexdigest(),'helperSHA256':hashlib.sha256(HELPER).hexdigest(),
        'resourcesBefore':before,'resourcesAfter':resources(),
        'blindCategories':['helper receipts, inspection, old packet/DB/web observations are private stand-ins',
            'source receipts use tiny fixture files, not a real candidate checkout','no application, DB, service or browser acceptance']}
    path=PRIVATE/'records'/('delta-controls-'+uuid.uuid4().hex+'.json');path.write_text(json.dumps(result,indent=2)+'\n')
    (HERE/'controls.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'controls':len(records),'restored':True,'privateReceipt':path.name}))


if __name__=='__main__':
    main()
