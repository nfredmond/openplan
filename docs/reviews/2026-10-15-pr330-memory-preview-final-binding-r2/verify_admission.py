"""Small admission and durable stop-status controls. No operating stage runs."""
import ast
import hashlib
import json
import os
from pathlib import Path
import types
import uuid
import sys

HERE=Path(__file__).resolve().parent
PRIVATE=Path('/home/nathaniel/.local/state/openplan/pr330-memory-preview-20261015-r2')


def specimen():
    root=PRIVATE/'fixtures'/('admission-'+uuid.uuid4().hex);root.mkdir(mode=0o700)
    j=types.ModuleType('journal_copy');exec(compile((HERE/'journal.py').read_bytes(),'journal-copy','exec'),j.__dict__);j.DURABLE=root
    m=types.SimpleNamespace(sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest())
    source=ast.parse((HERE/'storage_stage.py').read_text())
    node=next(n for n in source.body if isinstance(n,ast.FunctionDef) and n.name=='admission')
    import re
    scope={'j':j,'m':m,'json':json,'re':re};exec(compile(ast.Module(body=[node],type_ignores=[]),'admission-copy','exec'),scope)
    packet={'head':j.HEAD,'appTree':j.TREE,'executionBlocked':True}
    (root/'packet.json').write_text(json.dumps(packet))
    accepted={'head':j.HEAD,'appTree':j.TREE,'acceptedByParent':True,'capacityAdmitted':True,
        'packetSealSHA256':m.sha(root/'packet.json'),'reviewCommit':'1'*40}
    return root,j,m,scope,packet,accepted


def main():
    os.umask(0o077);records=[]
    root,j,m,scope,packet,accepted=specimen()
    try:scope['admission']()
    except FileNotFoundError:pass
    else:raise AssertionError('absent admission accepted')
    records.append({'case':'absent final admission','result':'refused without operation'})
    for key,value in [('head','0'*40),('appTree','0'*40),('acceptedByParent',False),
        ('capacityAdmitted',False),('packetSealSHA256','0'*64),('reviewCommit','not-reviewed')]:
        root,j,m,scope,packet,accepted=specimen();accepted[key]=value
        (root/'admission.json').write_text(json.dumps(accepted))
        try:scope['admission']()
        except ValueError as e:assert str(e)=='final-parent-review-admission'
        else:raise AssertionError('wrong admission accepted:'+key)
        records.append({'case':'admission '+key,'result':'named refusal'})
    root,j,m,scope,packet,accepted=specimen();(root/'admission.json').write_text(json.dumps(accepted))
    scope['admission']();records.append({'case':'harmless exact copied admission','result':'survived in private fixture only'})
    packet['head']='0'*40;(root/'packet.json').write_text(json.dumps(packet));accepted['packetSealSHA256']=m.sha(root/'packet.json')
    (root/'admission.json').write_text(json.dumps(accepted))
    try:scope['admission']()
    except ValueError as e:assert str(e)=='final-packet-source'
    else:raise AssertionError('wrong packet source accepted')
    records.append({'case':'packet source independently differs','result':'final-packet-source refusal'})
    root,j,m,scope,packet,accepted=specimen();ticket=j.begin('unit-start',{'fake':True})
    j.bytes_once(ticket/'web-stdout.bin',b'fake startup output\n');j.bytes_once(ticket/'web-stderr.bin',b'fake startup failure\n')
    j.os=types.SimpleNamespace(**vars(os));j.os.environ={'EXIT_CODE':'exited','EXIT_STATUS':'12'}
    j.stopped_web();value=json.loads((ticket/'web-exit.json').read_text())
    assert value['exitCode']=='exited' and value['exitStatus']=='12' and len(value['streams'])==2
    records.append({'case':'fake user-manager stop','result':'actual supplied status and stream hashes retained, without service launch'})
    result={'preparedOnly':True,'controls':records,'realAdmissionCreated':False,
        'exactRestoration':True,'blindCategories':['fixture admission values are not independent review acceptance',
            'stop environment is supplied by a stand-in, not an actual web unit']}
    (PRIVATE/'records/admission-controls.json').write_text(json.dumps(result,indent=2)+'\n')
    (HERE/'admission-controls.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'controls':len(records),'realAdmissionCreated':False}))


def mutations_only():
    from verify_delta import remove_guard
    source=(HERE/'storage_stage.py').read_bytes();records=[]
    import re
    for reason in ['final-parent-review-admission','final-packet-source']:
        root,j,m,scope,packet,accepted=specimen()
        mutated=remove_guard(source,reason)
        tree=ast.parse(mutated);node=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='admission')
        if reason=='final-parent-review-admission':accepted['acceptedByParent']=False
        else:
            packet['head']='0'*40;(root/'packet.json').write_text(json.dumps(packet));accepted['packetSealSHA256']=m.sha(root/'packet.json')
        (root/'admission.json').write_text(json.dumps(accepted))
        exec(compile(ast.Module(body=[node],type_ignores=[]),'mutated-admission','exec'),scope)
        scope['admission']()
        records.append({'case':reason,'result':'removed guard accepts intended bad input; refusal assertion detects fault'})
    result={'preparedOnly':True,'controls':records,'exactRestoration':(HERE/'storage_stage.py').read_bytes()==source,
        'blindCategories':['private in-memory admission specimens only; no real admission or operation']}
    (PRIVATE/'records/admission-mutations.json').write_text(json.dumps(result,indent=2)+'\n')
    (HERE/'admission-mutations.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'mutations':len(records),'restored':result['exactRestoration']}))


if __name__=='__main__':
    mutations_only() if sys.argv[1:]==['mutations-only'] else main()
