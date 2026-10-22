"""Exercise only the new shell entry with owned final-payload stand-ins."""
import hashlib
import json
import os
from pathlib import Path
import subprocess

ROOT=Path('/home/nathaniel/.local/state/openplan/current-project-preview-host-attestation-fix-20261015')
V3=ROOT.parent/'current-project-preview-app-binding-20261015-v3'
PUBLIC=Path(__file__).resolve().parent
SOURCE=(PUBLIC/'run_attest_host.sh').read_text()
UNIT='openplan-current-project-preview-app-21510042e-v3-attest-host-01'
ENV={'PATH':'/usr/bin:/bin','HOME':str(ROOT),'XDG_RUNTIME_DIR':'/run/user/1000','PYTHONDONTWRITEBYTECODE':'1'}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def command(argv,env=ENV):
    return subprocess.run(argv,env=env,capture_output=True,text=True,timeout=40)


def absent(unit):
    r=command(['/usr/bin/systemctl','--user','show',unit+'.service','--property=LoadState','--value'])
    return r.stdout.strip()=='not-found'


def fixture(index):
    root=ROOT/'specimens'/('round04-case-%02d'%index)
    root.mkdir(mode=0o700)
    v3=root/'v3';v3.mkdir(mode=0o700);(v3/'execution').mkdir(mode=0o700)
    unit='openplan-host-attest-fix-test04-%02d'%index
    # Read a peer process without listening, connecting or running the real attestor.
    payload='''import hashlib,json,os,sys
from pathlib import Path
root=Path(__file__).parents[1]
pid=int((root/'peer.pid').read_text())
p=Path('/proc')/str(pid)
raw=(p/'environ').read_bytes()
group=Path('/sys/fs/cgroup')/Path('/proc/self/cgroup').read_text().strip()[4:]
resources={n:(group/n).read_text().strip() for n in ['memory.max','memory.swap.max','cpu.max','memory.peak','memory.swap.current','memory.events']}
env=dict(x.split('=',1) for x in raw.decode().split('\\0') if '=' in x)
assert env['HOST_ATTEST_FIX_PEER']=='harmless-peer'
assert (p/'cwd').resolve()==root
assert os.readlink(p/'ns/user')==os.readlink('/proc/self/ns/user')
assert os.readlink(p/'ns/net')==os.readlink('/proc/self/ns/net')
assert sys.dont_write_bytecode and 'PYTHONPATH' not in os.environ
assert os.environ['PATH']=='/usr/bin:/bin' and Path(os.environ['HOME']).resolve()==root
assert set(os.environ)<={'PATH','HOME','PYTHONDONTWRITEBYTECODE','LC_CTYPE'}
assert resources['memory.max']=='536870912' and resources['memory.swap.max']=='0'
assert resources['cpu.max']=='50000 100000' and resources['memory.swap.current']=='0'
assert os.umask(0o077)==0o077
(root/'payload.json').write_text(json.dumps({'resources':resources,'sameUserNamespace':True,'sameNetworkNamespace':True,'cwdExact':True,'peerEnvironmentSha256':hashlib.sha256(raw).hexdigest(),'cleanEnvironment':True,'pythonB':True}))
'''
    pins=json.loads((ROOT/'external-pins.json').read_bytes())
    adapted={}
    for path in pins:
        p=Path(path)
        target=root/'reviewed-v3-manifest.json' if p.name=='reviewed-v3-manifest.json' else v3/p.name
        target.write_text(payload if p.name=='attest_start_v1.py' else 'harmless specimen '+p.name+'\n')
        adapted[path]=target
    # Preserve the actual nine-row list format with private fixture paths and hashes.
    original=(V3/'operation-files.sha256').read_text().splitlines()
    (v3/'operation-files.sha256').write_text(''.join(sha(v3/row.split('  ')[1].split('/')[-1])+'  '+str(v3/row.split('  ')[1].split('/')[-1])+'\n' for row in original))
    source=SOURCE.replace(str(V3),'@V3@').replace(str(ROOT),'@ROOT@')
    for path,target in adapted.items():source=source.replace(pins[path],sha(target))
    source=source.replace('@V3@',str(v3)).replace('@ROOT@',str(root)).replace(UNIT,unit)
    assert 'V3='+str(v3)+'\n' in source and str(root/'specimens') not in source
    runner=root/'run_attest_host.sh';runner.write_text(source)
    # Both caller PATH and interpreter search/startup traps must remain unused.
    traps=root/'traps';traps.mkdir(mode=0o700)
    for name in ['systemd-run','python3','sha256sum']:
        p=traps/name;p.write_text('#!/bin/sh\n/usr/bin/touch "'+str(root/'path-trap')+'"\nexit 99\n');p.chmod(0o700)
    (traps/'shell-init').write_text('/usr/bin/touch '+str(root/'shell-trap')+'\n')
    (traps/'sitecustomize.py').write_text('from pathlib import Path\nPath('+repr(str(root/'python-trap'))+').touch()\n')
    peer=subprocess.Popen(['/usr/bin/env','-i','PATH=/usr/bin:/bin','HOST_ATTEST_FIX_PEER=harmless-peer','/usr/bin/sleep','120'],cwd=root)
    (root/'peer.pid').write_text(str(peer.pid))
    return root,v3,runner,unit,peer


def no_dispatch(reached,unit_absent):
    assert not reached and unit_absent,'dispatch-before-refusal'


def detected_dispatch(row):
    try:no_dispatch(row['reachedPayload'],False)
    except AssertionError as error:
        assert str(error)=='dispatch-before-refusal'
        return str(error)
    raise AssertionError('accepted-broken-behavior')


def run_case(index,name,change=None,args=(),identity=None,expected=None):
    root,v3,runner,unit,peer=fixture(index)
    original=runner.read_bytes()
    changed=[]
    try:
        assert absent(unit),'unit-already-exists'
        if change:change(root,v3,runner,changed)
        path=runner
        if identity=='alternate':
            path=root/'alternate.sh';path.write_bytes(runner.read_bytes())
        elif identity=='symlink':
            path=root/'link.sh';path.symlink_to(runner)
        elif identity=='root-alias':
            alias=root.parent/(root.name+'-alias');alias.symlink_to(root,target_is_directory=True)
            runner.write_text(runner.read_text().replace('ROOT='+str(root)+'\n','ROOT='+str(alias)+'\n'))
            path=alias/'run_attest_host.sh'
        elif identity=='v3-alias':
            alias=root/'v3-alias';alias.symlink_to(v3,target_is_directory=True)
            runner.write_text(runner.read_text().replace('V3='+str(v3)+'\n','V3='+str(alias)+'\n'))
        traps=root/'traps'
        env={**ENV,'PATH':str(traps),'PYTHONPATH':str(traps),'ENV':str(traps/'shell-init'),'BASH_ENV':str(traps/'shell-init'),'DOCKER_HOST':'harmless-trap','HTTP_PROXY':'harmless-trap'}
        r=command(['/bin/sh',str(path),*args],env)
        (root/'stdout.txt').write_text(r.stdout);(root/'stderr.txt').write_text(r.stderr)
        reached=(root/'payload.json').exists()
        assert not (root/'path-trap').exists() and not (root/'python-trap').exists() and not (root/'shell-trap').exists(),'entry-trap-ran'
        if expected:
            no_dispatch(reached,absent(unit))
            assert r.returncode==2 and 'REFUSED host-attest: '+expected in r.stderr,'wrong-refusal:'+name
            assert not (root/'attempt-host-01').exists() or expected=='attempt-exists','intent-before-seal:'+name
        else:
            assert r.returncode==0 and reached,'standin-not-reached:'+name
            assert (root/'attempt-host-01').is_dir(),'attempt-not-reserved'
        return {'case':name,'exit':r.returncode,'reachedPayload':reached,'refusal':expected,'unit':unit,'unitAbsentAfterRefusal':absent(unit) if expected else None,'payload':json.loads((root/'payload.json').read_bytes()) if reached else None}
    finally:
        runner.write_bytes(original)
        for p,data in reversed(changed):p.write_bytes(data)
        assert runner.read_bytes()==original
        # This is our bounded sleep peer only. Never signal an application process.
        peer.terminate();peer.wait(timeout=5)


def alter(path,changed):
    changed.append((path,path.read_bytes()));path.write_bytes(path.read_bytes()+b'fault\n')


def main():
    rows=[]
    rows.append(run_case(1,'harmless-comment-survives',lambda r,v,s,c:s.write_text(s.read_text().replace('# Trusted host observer.','# Harmless wording.'))))
    rows.append(run_case(2,'baseline-host-composition'))
    rows.append(run_case(3,'extra-argument',args=('attest',),expected='arguments'))
    rows.append(run_case(4,'old-root-argument',args=(str(V3.parent/'current-project-preview-app-binding-20261015-v2'),),expected='arguments'))
    rows.append(run_case(5,'old-unit-argument',args=('openplan-current-project-preview-app-678-v1-web.service',),expected='arguments'))
    rows.append(run_case(6,'alternate-entry-identity',identity='alternate',expected='runner-identity'))
    rows.append(run_case(7,'symlink-entry-identity',identity='symlink',expected='runner-identity'))
    for i,name in enumerate(['reviewed-v3-manifest.json','operation-files.sha256',*[x.split('  ')[1].split('/')[-1] for x in (V3/'operation-files.sha256').read_text().splitlines()]],8):
        rows.append(run_case(i,'seal-'+name,lambda r,v,s,c,n=name:alter(r/n if n=='reviewed-v3-manifest.json' else v/n,c),expected='external-seal'))
    def coherent(r,v,s,c):
        alter(v/'app-v1.env',c);p=v/'operation-files.sha256';c.append((p,p.read_bytes()));p.write_text(p.read_text().replace(hashlib.sha256(c[0][1]).hexdigest(),sha(v/'app-v1.env')))
    rows.append(run_case(19,'coherent-private-reseal',coherent,expected='external-seal'))
    rows.append(run_case(20,'existing-runtime-receipt',lambda r,v,s,c:(v/'execution/runtime-start-attestation.json').write_text('{}'),expected='receipt-exists'))
    rows.append(run_case(21,'reserved-attempt',lambda r,v,s,c:(r/'attempt-host-01').mkdir(mode=0o700),expected='attempt-exists'))
    # Remove new guards in owned copies. The same cases must expose dispatch.
    mutations=[]
    for idx,name,remove,args,identity in [
        (22,'removed-argument-guard','[ "$#" -eq 0 ] || refuse arguments\n',('attest',),None),
        (23,'removed-identity-guard','[ "$0" = "$ROOT/run_attest_host.sh" ] && [ ! -L "$0" ] || refuse runner-identity\n',(),'alternate')]:
        row=run_case(idx,name,lambda r,v,s,c,t=remove:s.write_text(s.read_text().replace(t,'')),args=args,identity=identity)
        assert row['reachedPayload'],'mutation-did-not-expose-dispatch';mutations.append({'mutation':name,'detectedBy':detected_dispatch(row),'reachedPayload':True})
    def unseal(r,v,s,c):
        coherent(r,v,s,c);s.write_text(s.read_text().replace('/usr/bin/sha256sum --check --strict --status <<\'SEALED\' || refuse external-seal',"/usr/bin/cat >/dev/null <<'SEALED'"))
    row=run_case(24,'removed-external-seal',unseal);assert row['reachedPayload'];mutations.append({'mutation':'removed-external-seal','detectedBy':detected_dispatch(row),'reachedPayload':True})
    rows.append(run_case(26,'root-alias',identity='root-alias',expected='runner-root'))
    rows.append(run_case(27,'v3-alias',identity='v3-alias',expected='v3-root'))
    for idx,name,line,identity,setup in [
        (28,'removed-root-guard','[ "$(CDPATH= cd -P -- "$ROOT" && /bin/pwd -P)" = "$ROOT" ] || refuse runner-root\n','root-alias',None),
        (29,'removed-v3-root-guard','[ "$(CDPATH= cd -P -- "$V3" && /bin/pwd -P)" = "$V3" ] || refuse v3-root\n','v3-alias',None),
        (30,'removed-receipt-guard','[ ! -e "$V3/execution/runtime-start-attestation.json" ] && [ ! -L "$V3/execution/runtime-start-attestation.json" ] || refuse receipt-exists\n',None,'receipt'),
        (31,'removed-attempt-guard','/bin/mkdir -m 700 "$ROOT/attempt-host-01" || refuse attempt-exists\n',None,'attempt')]:
        def change(r,v,s,c,line=line,setup=setup):
            if setup=='receipt':(v/'execution/runtime-start-attestation.json').write_text('{}')
            if setup=='attempt':(r/'attempt-host-01').mkdir(mode=0o700)
            assert line in s.read_text(),'mutation-target-missing'
            s.write_text(s.read_text().replace(line,''))
        row=run_case(idx,name,change,identity=identity)
        assert row['reachedPayload'];mutations.append({'mutation':name,'detectedBy':detected_dispatch(row),'reachedPayload':True})
    rows.append(run_case(32,'restored-host-composition'))
    out={'cases':rows,'guardRemovalDetections':mutations,'limits':['Final payload is an owned stand-in, not the original attestor. No application operation runs.','Fixture substitutions replace fixed roots/unit and pinned fixture hashes only.','Source-reviewed controller has ordinary same-user permissions. Caps do not confine it.']}
    (ROOT/'runner-controls.json').write_text(json.dumps(out,indent=2)+'\n')
    print(json.dumps({'cases':len(rows),'guardRemovalDetections':len(mutations),'restored':True}))


if __name__=='__main__':main()
