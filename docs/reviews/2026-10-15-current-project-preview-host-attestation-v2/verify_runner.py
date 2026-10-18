"""Bounded actual shell/systemd composition with owned non-business payloads."""
import hashlib
import json
import os
from pathlib import Path
import shlex
import subprocess

ROOT=Path('/home/nathaniel/.local/state/openplan/current-project-preview-host-attestation-v2-20261015')
V3=ROOT.parent/'current-project-preview-app-binding-20261015-v3'
PUBLIC=Path(__file__).resolve().parent
SOURCE=(PUBLIC/'run_attest_host.sh').read_text()
PINS=json.loads((PUBLIC/'manifest.json').read_bytes())['externalPins']
UNIT='openplan-current-project-preview-app-21510042e-v3-attest-host-v2-01'
ENV={'PATH':'/usr/bin:/bin','HOME':str(ROOT),'XDG_RUNTIME_DIR':'/run/user/1000','PYTHONDONTWRITEBYTECODE':'1'}
os.umask(0o077)


def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def command(argv,**kwargs):return subprocess.run(argv,env=ENV,capture_output=True,text=True,timeout=30,**kwargs)
def absent(unit):return command(['/usr/bin/systemctl','--user','show',unit+'.service','--property=LoadState','--value']).stdout.strip()=='not-found'
def no_dispatch(reached,unit):assert not reached and absent(unit),'dispatch-before-refusal'


def fixture(index):
    root=ROOT/'specimens'/('v2r3-case-%02d'%index);root.mkdir(mode=0o700)
    v3=root/'v3';v3.mkdir();(v3/'execution').mkdir();(root/'npm').mkdir()
    unit='openplan-host-attest-v2-standin-r3-%02d'%index
    # Read a bounded owned peer. No listening socket or business code.
    payload='''import hashlib,json,os,sys
from pathlib import Path
root=Path(__file__).parent.resolve()
pid=(root/'peer.pid').read_text()
p=Path('/proc')/pid
raw=(p/'environ').read_bytes()
assert (p/'cwd').resolve()==root
assert b'ATTEST_V2_PEER=harmless-peer' in raw
assert os.readlink(p/'ns/user')==os.readlink('/proc/self/ns/user')
assert os.readlink(p/'ns/net')==os.readlink('/proc/self/ns/net')
assert sys.dont_write_bytecode and os.environ['PATH']=='/usr/bin:/bin'
assert Path(os.environ['HOME']).resolve()==root
assert set(os.environ)<={'PATH','HOME','PYTHONDONTWRITEBYTECODE','LC_CTYPE'}
group=Path('/sys/fs/cgroup')/Path('/proc/self/cgroup').read_text().strip()[4:]
resources={n:(group/n).read_text().strip() for n in ['memory.max','memory.swap.max','cpu.max','memory.events','memory.peak','memory.swap.current']}
assert resources['memory.max']=='536870912' and resources['memory.swap.max']=='0'
assert resources['cpu.max']=='50000 100000' and resources['memory.swap.current']=='0'
assert os.umask(0o077)==0o077
(root/'payload.json').write_text(json.dumps({'sameUserNamespace':True,'sameNetworkNamespace':True,'peerCwd':True,'peerEnvironmentHash':hashlib.sha256(raw).hexdigest(),'resources':resources,'cleanEnvironment':True,'pythonB':True}))
'''
    mapping={}
    for path in PINS:
        original=Path(path)
        target=(root/'npm'/original.name if path.startswith('/usr/lib/') else root/original.name if original.parent==ROOT else v3/original.name)
        target.write_text(payload if original==ROOT/'attest_start_v2.py' else 'harmless fixture '+original.name+'\n')
        mapping[path]=target
    # Literal pin/path substitutions apply to the owned copy only.
    source=SOURCE
    for i,(path,target) in enumerate(mapping.items()):source=source.replace(path,'@PIN%d@'%i).replace(PINS[path],sha(target))
    source=source.replace(str(V3),'@V3@').replace(str(ROOT),'@ROOT@').replace(UNIT,unit)
    for i,target in enumerate(mapping.values()):source=source.replace('@PIN%d@'%i,str(target))
    source=source.replace('@V3@',str(v3)).replace('@ROOT@',str(root))
    assert 'ROOT='+str(root)+'\n' in source and 'V3='+str(v3)+'\n' in source
    runner=root/'run_attest_host.sh';runner.write_text(source)
    traps=root/'traps';traps.mkdir()
    for name in ['systemd-run','sha256sum','python3']:
        f=traps/name;f.write_text('#!/bin/sh\n/usr/bin/touch '+str(root/'trap-ran')+'\nexit 99\n');f.chmod(0o700)
    (traps/'shell-init').write_text('/usr/bin/touch '+str(root/'trap-ran')+'\n')
    (traps/'sitecustomize.py').write_text('from pathlib import Path\nPath('+repr(str(root/'trap-ran'))+').touch()\n')
    peer=subprocess.Popen(['/usr/bin/env','-i','PATH=/usr/bin:/bin','ATTEST_V2_PEER=harmless-peer','/usr/bin/sleep','120'],cwd=root)
    (root/'peer.pid').write_text(str(peer.pid))
    return root,v3,runner,unit,peer,mapping


rows=[];mutations=[]

def run_case(index,name,*,fault=None,remove=None,reason=None,parent=False):
    root,v3,runner,unit,peer,mapping=fixture(index);saved=runner.read_bytes();restores=[]
    argv=['/bin/sh',str(runner)];entry_input=None
    try:
        assert absent(unit)
        if fault=='comment':runner.write_text(runner.read_text()+'\n# Harmless comment.\n')
        if fault=='args':argv.append('attest')
        if fault=='entry':
            alternate=root/'alternate.sh';alternate.write_bytes(saved);argv[1]=str(alternate)
        if fault=='root':
            alias=root.parent/(root.name+'-alias');alias.symlink_to(root,target_is_directory=True)
            runner.write_text(runner.read_text().replace('ROOT='+str(root)+'\n','ROOT='+str(alias)+'\n'));argv[1]=str(alias/'run_attest_host.sh')
        if fault=='v3':
            alias=root/'v3-alias';alias.symlink_to(v3,target_is_directory=True)
            runner.write_text(runner.read_text().replace('V3='+str(v3)+'\n','V3='+str(alias)+'\n'))
        if fault in ['attestor','npm','old-input']:
            key=str(ROOT/'attest_start_v2.py') if fault=='attestor' else '/usr/lib/node_modules/npm/node_modules/@npmcli/run-script/lib/set-path.js' if fault=='npm' else str(V3/'app-v1.env')
            f=mapping[key];restores.append((f,f.read_bytes()))
            # Harmless source addition still changes the external sealed bytes.
            f.write_bytes(f.read_bytes()+b'\n# private seal fault\n')
        if fault=='new-receipt':(root/'runtime-start-attestation.json').write_text('{}')
        if fault=='old-receipt':(v3/'execution/runtime-start-attestation.json').write_text('{}')
        if fault=='attempt':(root/'attempt-host-v2-01').mkdir()
        if remove:
            source=runner.read_text()
            if remove=='seal':
                source=source.replace("/usr/bin/sha256sum --check --strict --status <<'SEALED' || refuse external-seal","/usr/bin/cat >/dev/null <<'SEALED'")
            else:
                matches=[line for line in source.splitlines(True) if '|| refuse '+remove+'\n' in line]
                assert len(matches)==1,'removal-target'
                source=source.replace(matches[0],'')
            runner.write_text(source)
            if fault=='entry':Path(argv[1]).write_text(source)
        if parent:
            recipe=(PUBLIC/'PARENT_RECIPE.md').read_text().split('```bash\n',1)[1].split('\n```',1)[0]
            entry,body=recipe.split(" <<'PARENT'\n",1)
            body=body.rsplit('\nPARENT',1)[0]+'\n'
            digest=json.loads((PUBLIC/'manifest.json').read_bytes())['runnerSha256']
            body=body.replace(str(ROOT),str(root)).replace(digest,sha(runner))
            argv=[x.replace(str(ROOT),str(root)) for x in shlex.split(entry)]
            if fault=='parent-comment':body='# harmless entry comment\n'+body
            else:
                runner.write_text(runner.read_text()+'\n# changed after parent pin\n')
            if fault=='parent-unseal':
                start=body.index('/usr/bin/sha256sum');end=body.index('\nRUNNER\n',start)+len('\nRUNNER\n')
                body=body[:start]+body[end:]
            entry_input=body;(root/'parent-entry.txt').write_text(body)
        traps=root/'traps'
        env={**ENV,'PATH':str(traps),'PYTHONPATH':str(traps),'ENV':str(traps/'shell-init'),'BASH_ENV':str(traps/'shell-init'),'HTTP_PROXY':'harmless-fixture'}
        result=subprocess.run(argv,input=entry_input,env=env,capture_output=True,text=True,timeout=30)
        (root/'stdout.txt').write_text(result.stdout);(root/'stderr.txt').write_text(result.stderr)
        reached=(root/'payload.json').exists()
        assert not (root/'trap-ran').exists(),'startup-trap-ran'
        if reason:
            no_dispatch(reached,unit)
            assert result.returncode==2 and (reason=='parent-hash' or 'REFUSED host-attest: '+reason in result.stderr),'wrong-refusal'
        else:assert result.returncode==0 and reached,'standin-not-reached:'+name+':'+result.stderr
        row={'case':name,'exit':result.returncode,'reachedPayload':reached,'reason':reason,'unit':unit,'payload':json.loads((root/'payload.json').read_bytes()) if reached else None}
        if remove or fault=='parent-unseal':
            try:no_dispatch(reached,unit)
            except AssertionError as e:assert str(e)=='dispatch-before-refusal';mutations.append({'case':name,'detectedBy':str(e)})
            else:raise AssertionError('guard-removal-missed')
        else:rows.append(row)
    finally:
        runner.write_bytes(saved)
        for path,data in restores:path.write_bytes(data)
        assert runner.read_bytes()==saved and all(path.read_bytes()==data for path,data in restores)
        peer.terminate();peer.wait(timeout=5)


run_case(1,'harmless comment first',fault='comment')
run_case(2,'baseline host composition')
for i,(fault,reason) in enumerate([('args','arguments'),('entry','runner-identity'),('root','runner-root'),('v3','v3-root'),('attestor','external-seal'),('npm','external-seal'),('old-input','external-seal'),('new-receipt','new-receipt-exists'),('old-receipt','receipt-exists'),('attempt','attempt-exists')],3):run_case(i,fault,fault=fault,reason=reason)
for i,(fault,remove) in enumerate([('args','arguments'),('entry','runner-identity'),('root','runner-root'),('v3','v3-root'),('attestor','seal'),('new-receipt','new-receipt-exists'),('old-receipt','receipt-exists'),('attempt','attempt-exists')],20):run_case(i,'removed '+remove,fault=fault,remove=remove)
run_case(30,'parent harmless first',fault='parent-comment',parent=True)
run_case(31,'parent changed runner refuses',fault='parent-pin',reason='parent-hash',parent=True)
run_case(32,'parent removed hash gate',fault='parent-unseal',parent=True)
run_case(33,'exact restored composition')
(ROOT/'runner-controls.json').write_text(json.dumps({'cases':rows,'guardRemovalDetections':mutations,'restored':True,'limits':['Final payload is an owned proc-reading peer stand-in, never business attestation.','Actual POSIX shell/systemd context, fixture paths/hashes and unit names. Controllers retain same-user authority; resource caps do not confine.','Old 24-case runner campaign is prior evidence, not replayed.']},indent=2)+'\n')
print(json.dumps({'cases':len(rows),'guardRemovalDetections':len(mutations),'restored':True}))
