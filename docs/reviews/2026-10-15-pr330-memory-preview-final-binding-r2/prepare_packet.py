"""Preparation only. Copies sealed inputs, never invokes an operating stage."""
import ast
import difflib
import hashlib
import json
import os
from pathlib import Path
import secrets
import subprocess

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
DURABLE = Path('/home/nathaniel/.local/state/openplan/pr330-memory-preview-20261015-r2')
ROOT = '/dev/shm/openplan-pr330-preview-20261015'
V6 = Path('/home/nathaniel/.local/state/openplan/project-portfolio-skip-preview-20261015-v6')
OLDPUBLIC = REPO/'docs/reviews/2026-10-15-portfolio-skip-preview-v6-active-helper-fix'
HEAD = 'f0cbeddff5ae3fc37e0dd8b91c02601429d977a6'
OLDHEAD = '49e3fa2004c1336ffa36c134a8f21bcc2d72d327'
TREE = 'a13c491da3ad3ba5b237ca5fa8802b236c4ef27b'


def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for b in iter(lambda:stream.read(1048576),b''):
            h.update(b)
    return h.hexdigest()


def put(name, value):
    p = DURABLE/'templates'/name
    with p.open('xb') as stream:
        stream.write(value.encode() if isinstance(value,str) else value)
    p.chmod(0o600)


def js(name, value):
    put(name,json.dumps(value,indent=2)+'\n')


def replace_function(text, name, body):
    node = next(x for x in ast.parse(text).body if isinstance(x,ast.FunctionDef) and x.name==name)
    lines = text.splitlines(True)
    return ''.join(lines[:node.lineno-1])+body.rstrip()+'\n'+''.join(lines[node.end_lineno:])


def main():
    os.umask(0o077)
    assert subprocess.check_output(['git','rev-parse','HEAD:openplan'],cwd=REPO).decode().strip()==TREE
    manifest = json.loads((OLDPUBLIC/'manifest.json').read_text())
    originals = {name:(V6/name).read_bytes() for name in manifest['files']}
    assert all(hashlib.sha256(data).hexdigest()==manifest['files'][name] for name,data in originals.items())
    target = json.loads((REPO/'docs/reviews/2026-10-15-pr330-memory-preview-preparation/packet.json').read_text())['targetProposal']
    oldtarget = json.loads(originals['plan-private.json'])['target']
    plan = json.loads(originals['plan-private.json'])
    oldnames = plan['names'].copy()
    names = {k:'openplan-pr330-memory-r2-20261015-'+k for k in oldnames}
    def rebound(text):
        for old,new in [(str(V6),ROOT),(OLDHEAD,HEAD),(oldtarget,target),
                        ('127.74.19.11','127.74.19.13'),('29949','29952'),('3586','3587'),
                        ('openplan_project_portfolio_preview_','openplan_pr330_preview_'),
                        ('project-portfolio-skip-preview-20261015-v6','pr330-memory-preview-20261015-r2'),
                        ('openplan-portfolio-v6-preserved-web-observer','openplan-pr330-memory-r2-preserved-web-observer'),
                        ('openplan-portfolio-skip-preview-49e3fa200-v6-','openplan-pr330-memory-f0cbeddff-r2-')]:
            text = text.replace(old,new)
        for kind,old in oldnames.items():
            text = text.replace(old,names[kind])
        return text
    generated = {'helper.py','policy.py','app_binding_v1.py','attest_start_v1.py','observer.py',
                 'observer_transport.py','run_stage.sh','plan-private.json','envs-private.json',
                 'kong-private.json','binding-private.json','private-bindings.json','template-binding.json',
                 'app-env-private.json','app-v1.env','acl-private.json'}
    # Historical inventories and frozen source/expectations are copied unchanged.
    for name,data in originals.items():
        if name not in generated:
            put(name,data)
    # The old active map is replaced only in this fresh private copy.
    active=json.loads((DURABLE/'records/protected-active-bindings.json').read_text())
    (DURABLE/'templates/active-helper-identities.json').write_text(json.dumps(active,indent=2)+'\n')
    put('v6-packet-inventory-before.json',json.dumps(json.loads((DURABLE/'records/protected-before-2.json').read_text())['entries'],indent=2)+'\n')
    additional={}
    for index in [0,1]:
        value=json.loads((DURABLE/'records'/('protected-before-'+str(index)+'.json')).read_text())
        additional[value['root']]=value['entries']
    js('additional-packet-inventories.json',additional)
    put('source-files.json',(DURABLE/'records/source-files-final.json').read_bytes())
    for name in ['plan-private.json','envs-private.json','kong-private.json','app-env-private.json','app-v1.env','acl-private.json']:
        put(name,rebound(originals[name].decode()))
    dbs=json.loads(originals['protected-databases.json'])
    dbs += [oldtarget,'openplan_pr330_native_32e91518d541497fbe62e201',
            'openplan_jurisdiction_native_3d281df106064b8cbb9e0c82_up']
    # Replace only our fresh copy, not the original sealed bytes.
    p=DURABLE/'templates/protected-databases.json'
    p.write_text(json.dumps(sorted(set(dbs)),indent=2)+'\n')
    policy=rebound(originals['policy.py'].decode())
    # p.ROOT remains the memory working root, not DURABLE/PURPOSE.
    policy=policy.replace("ROOT = '/home/nathaniel/.local/state/openplan/' + PURPOSE",'ROOT = '+repr(ROOT))
    put('policy.py',policy)
    put('observer.py',rebound(originals['observer.py'].decode()))
    transport=rebound(originals['observer_transport.py'].decode()).replace(
        sha(V6/'observer.py'),sha(DURABLE/'templates/observer.py'))
    transport=transport.replace('import sys\n','import sys\nimport journal as j\n')
    transport=transport.replace('def write_once(path,value):\n',"def write_once(path,value):\n    j.record(str(path.relative_to(ROOT)),value)\n")
    transport=transport.replace("result=subprocess.run(argv(nonce),env=ENV,capture_output=True,timeout=45)","result=j.execute('observer-'+nonce,argv(nonce),env=ENV,timeout=45)")
    put('observer_transport.py',transport)
    helper=rebound(originals['helper.py'].decode()).replace(sha(V6/'observer_transport.py'),sha(DURABLE/'templates/observer_transport.py'))
    # CAPTURE_INPUTS is retained metadata, and must not migrate into /dev/shm.
    helper=helper.replace("OUT.parent/'project-map-integration-20261015/", "Path('/home/nathaniel/.local/state/openplan')/'project-map-integration-20261015/")
    loc="    web=protected_web()"
    helper=helper.replace(loc,"    p.files(read('v6-packet-inventory-before.json'),packet_inventory(Path("+repr(str(V6))+")))\n"+loc)
    helper=helper.replace(loc,"    for name,expected in read('additional-packet-inventories.json').items():\n        p.files(expected,packet_inventory(Path(name)))\n"+loc)
    helper=replace_function(helper,'active_helper_identities',(HERE/'active_helpers.txt').read_text())
    helper=helper.replace("        actual=p.digest(current)","        actual=p.digest(current)\n        p.exact({'sha256':read('active-helper-identities.json')['configurationDigests'][identity]},\n            {'sha256':actual},'protected-active-config')")
    helper=helper.replace('import socket\n','import socket\nimport stat\n')
    helper=helper.replace('import policy as p','import policy as p\nimport journal as j')
    helper=helper.replace("    path=OUT/name\n", "    j.record(name,value)\n    path=OUT/name\n",1)
    helper=helper.replace('def run(args, *, data=None, log=None, timeout=120):\n    result=subprocess.run(args,input=data,capture_output=True,timeout=timeout)',
        "def run(args, *, data=None, log=None, timeout=120, mutation=None):\n    result=j.execute(mutation,args,data=data,timeout=timeout) if mutation else subprocess.run(args,input=data,capture_output=True,timeout=timeout)")
    helper=helper.replace("run(args,log='create-private.log')","run(args,log='create-private.log',mutation='db-create')")
    helper=helper.replace("result=subprocess.run(args,stdin=stream,capture_output=True,timeout=300)",
        "result=j.execute('db-restore',args,stdin=stream,timeout=300,input_file={'path':str(dump),'sha256':DUMP_SHA,'bytes':16232305})")
    helper=helper.replace("log='target-acl-private.log')","log='target-acl-private.log',mutation='db-acl')")
    helper=helper.replace("shutil.copytree(OLD_STORAGE,OUT/'storage-objects')", "j.effect('storage-copy',{'source':str(OLD_STORAGE),'target':str(OUT/'storage-objects')},lambda:(shutil.copytree(OLD_STORAGE,OUT/'storage-objects') and {'copied':True}))")
    helper=helper.replace("run(args,log=kind+'-create-private.log')", "run(args,log=kind+'-create-private.log',mutation='helper-'+kind+'-create')")
    helper=helper.replace("run(['docker','start',identity],log=kind+'-start-private.log')", "run(['docker','start',identity],log=kind+'-start-private.log',mutation='helper-'+kind+'-start')")
    helper=helper.replace("log='upgrade-private.log')", "log='upgrade-private.log',mutation='db-upgrade')")
    helper=helper.replace("        else:record.update(kind='file',bytes=path.stat().st_size,sha256=sha(path))",
        "        elif path.is_file():record.update(kind='file',bytes=path.stat().st_size,sha256=sha(path))\n        else:record.update(kind='special',fileType=stat.S_IFMT(path.lstat().st_mode),bytes=path.lstat().st_size)")
    helper=helper.replace("    pinned_files();retained_dump();source_check();unchanged_inputs();free_ports();fresh_target()",
        "    import memory_storage\n    memory_storage.observe_capacity()\n    pinned_files();retained_dump();source_check();unchanged_inputs();free_ports();fresh_target()")
    put('helper.py',helper)
    put('memory_storage.py',(HERE/'memory_storage.py').read_bytes())
    put('source_binding.py',(HERE/'source_binding.py').read_bytes())
    put('journal.py',(HERE/'journal.py').read_bytes())
    put('storage_stage.py',(HERE/'storage_stage.py').read_bytes())
    app=rebound(originals['app_binding_v1.py'].decode())
    app=app.replace("SOURCE_REPO = Path('/home/nathaniel/.t3/worktrees/openplan/t3-9eeec4ad')",'SOURCE_REPO = Path('+repr(str(REPO))+')')
    start=app.index('HELPERS = ');end=app.index('\nGiB',start)
    app=app[:start]+'HELPERS = '+repr({n:sha(DURABLE/'templates'/n) for n in ['helper.py','policy.py']})+app[end:]
    app=app.replace("'upgrade-expectations.json', 'attest_start_v1.py'", "'upgrade-expectations.json', 'attest_start_v1.py', 'memory_storage.py'")
    app=app.replace("'attest_start_v1.py', 'memory_storage.py'", "'attest_start_v1.py', 'memory_storage.py', 'source_binding.py', 'source-files.json'")
    app=app.replace("            'dependencyBindingSha256': dependencies()}, values",
        "            'dependencyBindingSha256': dependencies(),\n            'sourceInventoryDigest': source_binding.check(CANDIDATE, read(ROOT/'source-files.json'))}, values")
    app=app.replace('import socket\n','import socket\nimport source_binding\n')
    app=app.replace('import source_binding\n','import source_binding\nimport journal as j\n')
    app=app.replace("'source_binding.py', 'source-files.json'", "'source_binding.py', 'source-files.json', 'journal.py'")
    app=app.replace('    # Persist intent before invoking a mutator. A lost acknowledgement blocks retries.',
        "    j.record(str(path.relative_to(ROOT)),value)\n    # Persist working copy only after durable receipt publication.")
    app=app.replace('def command(argv, *, cwd=None, timeout=120):\n    result = subprocess.run(argv, cwd=cwd, env=',
        'def command(argv, *, cwd=None, timeout=120, mutation=None):\n    environment = ')
    app=app.replace("'XDG_RUNTIME_DIR': '/run/user/'+str(os.getuid())},\n        capture_output=True, timeout=timeout)",
        "'XDG_RUNTIME_DIR': '/run/user/'+str(os.getuid())}\n    result = j.execute(mutation,argv,cwd=cwd,env=environment,timeout=timeout) if mutation else subprocess.run(argv,cwd=cwd,env=environment,capture_output=True,timeout=timeout)")
    app=app.replace("str(SOURCE_REPO), str(CANDIDATE)], timeout=300)","str(SOURCE_REPO), str(CANDIDATE)], timeout=300, mutation='source-clone')")
    app=app.replace("'checkout', '--detach', APP_HEAD], timeout=300)","'checkout', '--detach', APP_HEAD], timeout=300, mutation='source-checkout')")
    old="    with (RUN/'build-private.log').open('xb') as log:\n        result = subprocess.run(confined_argv('build'), cwd=APP, env=environment(values, 'build'),\n                                stdout=log, stderr=subprocess.STDOUT, timeout=1800)"
    new="    result = j.execute('webpack-build',confined_argv('build'),cwd=APP,env=environment(values,'build'),timeout=1800,combined=True,return_output=False)\n    with (j.DURABLE/'journal/webpack-build/stdout.bin').open('rb') as source, (RUN/'build-private.log').open('xb') as log:\n        shutil.copyfileobj(source,log)"
    app=app.replace(old,new)
    app=app.replace("    return {'availableMemory': available, 'freeDisk': free}",
        "    import memory_storage\n    total = memory_storage.observe_capacity()\n    return {'availableMemory': available, 'freeDisk': free, 'memoryStorage': total}")
    app=app.replace("'--tmpfs', '/run', '--bind', str(CANDIDATE)",
        "'--tmpfs', '/run', '--dir', '/dev/shm', '--ro-bind', str(ROOT), str(ROOT), '--bind', str(CANDIDATE)")
    app=app.replace('0 < quota <= 2*period','0 < quota <= period//2')
    app=app.replace("    # The API is already occupied", "    import memory_storage\n    admitted_archive = memory_storage.startup_archive()\n    # The API is already occupied")
    app=app.replace("'environmentSha256': sha(APP/'.env.local'), 'argv': confined_argv('start')", "'environmentSha256': sha(APP/'.env.local'), 'argv': confined_argv('start'), 'admittedArchive': admitted_archive")
    app=app.replace("    os.execve('/usr/bin/bwrap', confined_argv('start'), environment(values, 'start'))",
        "    ticket=j.begin('npm-start-exec',{'argv':confined_argv('start'),'admittedArchive':admitted_archive,'buildResultSha256':sha(RUN/'build-result.json')})\n    try:\n        os.execve('/usr/bin/bwrap', confined_argv('start'), environment(values, 'start'))\n    except BaseException as error:\n        j.failure(ticket,error)\n        raise")
    # Fail closed on the actual app tree as well as the root commit.
    app=app.replace("    require(head == APP_HEAD, 'app-head')", "    require(head == APP_HEAD, 'app-head')\n    require(command(['/usr/bin/git','-C',str(CANDIDATE),'rev-parse','HEAD:openplan']).decode().strip() == "+repr(TREE)+", 'app-tree')")
    put('app_binding_v1.py',app)
    att=rebound(originals['attest_start_v1.py'].decode()).replace(sha(V6/'app_binding_v1.py'),sha(DURABLE/'templates/app_binding_v1.py'))
    put('attest_start_v1.py',att)
    runner=rebound(originals['run_stage.sh'].decode())
    runner=runner.replace('active-check|checkout) controller=app_binding_v1.py; memory=512M ;;',
        'active-check) controller=app_binding_v1.py; memory=512M ;;\n  checkout) controller=app_binding_v1.py; memory=1G ;;')
    runner=runner.replace('  build) controller=', '  archive) controller=storage_stage.py; memory=512M ;;\n  build) controller=')
    runner=runner.replace('--dev /dev --proc /proc \\', '--dev /dev --proc /proc --dir /dev/shm \\')
    runner=runner.replace('ROOT=/dev/shm/openplan-pr330-preview-20261015',
        'ROOT=/dev/shm/openplan-pr330-preview-20261015\nDURABLE=/home/nathaniel/.local/state/openplan/pr330-memory-preview-20261015-r2')
    runner=runner.replace('--bind "$ROOT" "$ROOT" --bind "$ROOT/tmp" /tmp',
        '--bind "$ROOT" "$ROOT" --bind "$DURABLE/journal" "$DURABLE/journal" \\\n    --bind "$DURABLE/receipts" "$DURABLE/receipts" --bind "$ROOT/tmp" /tmp')
    runner=runner.replace('/bin/mkdir -m 700 "$ROOT/execution/request-$stage"',
        '/usr/bin/python3 -B "$ROOT/journal.py" claim "request-$stage"\n/bin/mkdir -m 700 "$ROOT/execution/request-$stage"')
    runner=runner.replace('exec /usr/bin/systemd-run', 'exec /usr/bin/python3 -B "$ROOT/journal.py" execute "unit-$stage" -- /usr/bin/systemd-run')
    marker='    /usr/bin/env -i PATH=/usr/bin:/bin HOME="$ROOT/home" PYTHONDONTWRITEBYTECODE=1 \\\n'
    start_extra='    -p StandardOutput=append:/home/nathaniel/.local/state/openplan/pr330-memory-preview-20261015-r2/journal/unit-start/web-stdout.bin \\\n    -p StandardError=append:/home/nathaniel/.local/state/openplan/pr330-memory-preview-20261015-r2/journal/unit-start/web-stderr.bin \\\n    -p "ExecStopPost=/usr/bin/python3 -B /home/nathaniel/.local/state/openplan/pr330-memory-preview-20261015-r2/templates/journal.py stopped-web" \\\n'
    runner=runner.replace(marker,start_extra+marker,1)
    put('run_stage.sh',runner);(DURABLE/'templates/run_stage.sh').chmod(0o700)
    binding=json.loads(originals['binding-private.json'])
    for key in ['appHead','helperHead','producer']:
        binding[key]=HEAD
    binding['files']['memory_storage.py']=''
    binding['files']['source_binding.py']='';binding['files']['source-files.json']=''
    binding['files']['journal.py']=''
    binding['files']={n:sha(DURABLE/'templates'/n) for n in binding['files']}
    js('binding-private.json',binding)
    binding=json.loads(originals['private-bindings.json'])
    binding['v6-packet-inventory-before.json']='';binding['memory_storage.py']=''
    binding['additional-packet-inventories.json']='';binding['source-files.json']='';binding['source_binding.py']=''
    binding['journal.py']=''
    binding['storage_stage.py']=''
    js('private-bindings.json',{n:sha(DURABLE/'templates'/n) for n in binding})
    js('template-binding.json',{n:sha(DURABLE/'templates'/n) for n in ['helper.py','policy.py']})
    sealed={p.name:{'sha256':sha(p),'mode':p.stat().st_mode&511} for p in sorted((DURABLE/'templates').iterdir())}
    put('operation-files.sha256',''.join(v['sha256']+'  '+ROOT+'/'+n+'\n' for n,v in sealed.items()))
    sealed['operation-files.sha256']={'sha256':sha(DURABLE/'templates/operation-files.sha256'),'mode':0o600}
    for n in ['helper.py','policy.py','observer.py','observer_transport.py','app_binding_v1.py','attest_start_v1.py','run_stage.sh']:
        text=(DURABLE/'templates'/n).read_text()
        (HERE/'templates').mkdir(exist_ok=True)
        (HERE/'templates'/n).write_text(text)
        (HERE/(n+'.patch')).write_text(''.join(difflib.unified_diff(originals[n].decode().splitlines(True),text.splitlines(True),fromfile='retained-v6/'+n,tofile='memory/'+n,n=0)))
    migrations=json.loads(originals['migrations.json'])
    assert len(migrations)==420
    assert all(sha(REPO/n)==value for n,value in migrations.items())
    source={'head':HEAD,'appTree':TREE,'targetProposal':target,'targetAllocated':False,'root':ROOT,
            'durable':str(DURABLE),'api':'http://127.74.19.13:29952','web':'http://127.74.19.13:3587',
            'names':names,'sealed':sealed,'migrationFiles':migrations,
            'baselineFiles':manifest['files'],'operatingStages':0,'candidateCreated':False,
            'executionBlocked':True,'bindingState':'final source bound; final independent review and capacity admission required'}
    (DURABLE/'records/packet.json').write_text(json.dumps(source,indent=2)+'\n')
    # Public fields contain hashes and identifiers, never the copied environments.
    (HERE/'packet.json').write_text(json.dumps(source,indent=2)+'\n')
    print(json.dumps({'preparedOnly':True,'sealedFiles':len(sealed),'migrations':420,'operatingStages':0}))


if __name__=='__main__':
    main()
