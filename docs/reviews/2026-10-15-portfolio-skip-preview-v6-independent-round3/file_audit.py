"""Independent bounded file/hash graph audit. No live observation or packet writes."""
import ast
import copy
import difflib
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
SUBJECT = HERE.with_name('2026-10-15-portfolio-skip-preview-v6-active-helper-fix')
SEALED = Path('/home/nathaniel/.local/state/openplan/project-portfolio-skip-preview-20261015-v6')
V5 = SEALED.with_name(SEALED.name[:-1]+'5')
PROOF = Path('/home/nathaniel/.local/state/openplan/portfolio-skip-preview-v6-independent-round3-20261015-4cefaf52')
PIN = '02ec7bcbd391088477390a738eb21d5aad34d3b3'
SCRIPTS = ['helper.py','policy.py','app_binding_v1.py','attest_start_v1.py','observer.py','observer_transport.py','run_stage.sh']


def sha(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda:stream.read(1024*1024),b''):
            digest.update(block)
    return digest.hexdigest()


def read(path):
    return json.loads(Path(path).read_text())


def require(value, reason):
    if not value:
        raise AssertionError(reason)


def inventory(root):
    root = Path(root)
    entries = {'.':{'kind':'directory','mode':root.stat().st_mode&0o777}}
    for path in sorted(root.rglob('*')):
        entry = {'mode':path.lstat().st_mode&0o777}
        if path.is_symlink():
            entry.update(kind='symlink',target=os.readlink(path))
        elif path.is_dir():
            entry.update(kind='directory')
        else:
            entry.update(kind='file',bytes=path.stat().st_size,sha256=sha(path))
        entries[str(path.relative_to(root))] = entry
    return entries


def match(bindings, root):
    return all(sha(Path(root)/name)==value for name,value in bindings.items())


def normalized(text):
    text = text.replace(str(V5),str(SEALED)).replace(V5.name,SEALED.name).replace('-v5-','-v6-')
    text = text.replace('Parent-only v5 operating stages','Parent-only v6 operating stages')
    for name in SCRIPTS:
        text = text.replace(sha(V5/name),sha(SEALED/name))
    return text


def module(text, exclude=()):
    tree = ast.parse(text)
    tree.body = [node for node in tree.body if not isinstance(node, ast.FunctionDef) or node.name not in exclude]
    return ast.dump(tree,include_attributes=False)


def main():
    os.umask(0o077)
    phase = sys.argv[1]
    require(phase in ['before','after'],'phase')
    manifest = read(SUBJECT/'manifest.json')
    require(sha(SUBJECT/'manifest.json')=='bd8ff7c66be0e7869ed6553bb9fce51b2a313ebf5d2452d41a69fc768bdb830d','external-manifest')
    require(sha(SEALED/'operation-files.sha256')=='1bd2e70cc13cc1d9af8944ef96d4856da162db6b5dbc42d423a62340aaa73e3c','external-list')
    require(match(manifest['files'],SEALED),'manifest-files')
    require((SEALED/'operation-files.sha256').read_text()==''.join(value+'  '+str(SEALED/name)+'\n' for name,value in manifest['files'].items()),'exact-operation-list')
    public = {str(path.relative_to(SUBJECT)):sha(path) for path in sorted(SUBJECT.rglob('*')) if path.is_file()}
    for name in public:
        require(subprocess.check_output(['/usr/bin/git','show',PIN+':'+str(SUBJECT.relative_to(REPO)/name)],cwd=REPO)==(SUBJECT/name).read_bytes(),'public-commit:'+name)
    require(subprocess.check_output(['/usr/bin/git','diff','--name-only','49e3fa2004c1336ffa36c134a8f21bcc2d72d327',PIN,'--','openplan'],cwd=REPO)==b'','APP49-source')
    for name in manifest['files']:
        path = SEALED/name
        require(path.is_file() and not path.is_symlink(),'sealed-file-kind')
        require(path.stat().st_mode&0o777==(0o700 if name=='run_stage.sh' else 0o600),'sealed-file-mode')
    require(SEALED.stat().st_mode&0o777==0o700,'sealed-root-mode')
    mechanical = {}
    for name in SCRIPTS:
        old,new = (V5/name).read_text(),(SEALED/name).read_text()
        require((SUBJECT/'templates'/name).read_text()==new,'template:'+name)
        require(''.join(difflib.unified_diff(old.splitlines(True),new.splitlines(True),fromfile=str(V5/name),tofile=name,n=0))==(SUBJECT/(name+'.patch')).read_text(),'patch:'+name)
        excludes = ['preserve','preflight','active_helper_identities','require_active_helper'] if name=='helper.py' else []
        require(normalized(old)==new if name.endswith('.sh') else module(normalized(old),excludes)==module(new,excludes),'unrelated-behavior:'+name)
        mechanical[name] = excludes
    for name in ['template-binding.json','private-bindings.json']:
        require(match(read(SEALED/name),SEALED),'hash-edge:'+name)
    require(match(read(SEALED/'binding-private.json')['files'],SEALED),'app-hash-edges')
    helper = (SEALED/'helper.py').read_text()
    app = (SEALED/'app_binding_v1.py').read_text()
    attestor = (SEALED/'attest_start_v1.py').read_text()
    transport = (SEALED/'observer_transport.py').read_text()
    require(sha(SEALED/'observer_transport.py') in helper and sha(SEALED/'observer.py') in transport,'observer-hash-edges')
    require(all(sha(SEALED/name) in app for name in ['helper.py','policy.py']),'import-hash-edges')
    require(sha(SEALED/'app_binding_v1.py') in attestor,'attestor-hash-edge')
    p5 = SUBJECT.with_name('2026-10-15-portfolio-skip-preview-v5-corrections')
    recipe_in = (p5/'parent_recipe.sh.in').read_text().replace(str(V5),str(SEALED)).replace('ROUND2','ROUND3').replace('round2','round3')
    require(recipe_in==(SUBJECT/'parent_recipe.sh.in').read_text(),'mechanical-parent-gate')
    recipe = recipe_in.replace('__SEAL_SHA__',manifest['checksumListSHA256']).replace('__RUNNER_SHA__',manifest['files']['run_stage.sh'])
    require(recipe==(SUBJECT/'parent_recipe.sh').read_text()==(SEALED/'parent_recipe.sh').read_text(),'external-parent-graph')
    generated = set(SCRIPTS)|{'plan-private.json','envs-private.json','kong-private.json','binding-private.json','private-bindings.json','template-binding.json'}
    unchanged = []
    for name in read(p5/'manifest.json')['files']:
        if name not in generated:
            require((SEALED/name).read_bytes()==(V5/name).read_bytes(),'inherited-input:'+name)
            unchanged.append(name)
    plan5,plan6 = read(V5/'plan-private.json'),read(SEALED/'plan-private.json')
    expected_plan = copy.deepcopy(plan5)
    expected_plan['root'] = str(SEALED)
    expected_plan['names'] = {role:name.replace('-v5-','-v6-') for role,name in plan5['names'].items()}
    require(plan6==expected_plan,'plan-delta')
    def replace_names(value):
        if isinstance(value,str):
            for role,name in plan5['names'].items():
                value = value.replace(name,plan6['names'][role])
            return value
        if isinstance(value,list):
            return [replace_names(item) for item in value]
        if isinstance(value,dict):
            return {key:replace_names(item) for key,item in value.items()}
        return value
    for name in ['envs-private.json','kong-private.json']:
        require(read(SEALED/name)==replace_names(read(V5/name)),'private-config-delta:'+name)
    ids = read(SEALED/'active-helper-identities.json')
    require(sha(ids['source'])==ids['sourceSHA256'],'independent-active-source-pin')
    require(ids['ids']=={role:receipt['id'] for role,receipt in read(ids['source']).items()},'independent-active-source-map')
    packets = read(SEALED/'prior-packet-inventories-before.json')
    require(packets=={root:inventory(root) for root in packets},'four-frozen-packets')
    require(read(SEALED/'v5-packet-inventory-before.json')=={root:entries for root,entries in packets.items() if 'v5' in root},'V5-runtime-inventory')
    fixed = read(SEALED/'old-fixed-inputs-before.json')
    require(fixed=={name:{'sha256':sha(name),'mode':Path(name).stat().st_mode&0o777} for name in fixed},'280-fixed-inputs')
    review = read(SUBJECT/'review-bindings.json')
    require(match(review['files'],review['reviewRoot']),'prior-review-bindings')
    prior = read(Path(review['reviewRoot'])/'source-bindings.json')
    require(match(prior['subjectPublicFiles'],p5) and match(prior['subjectSealedPrivateFiles'],V5),'independent-V5-bindings')
    for case_file,count in [('controls.json',70),('supplement.json',15)]:
        record = read(SUBJECT/case_file)
        require(len(record['cases'])==count,'record-count')
        require(record['counts']=={kind:sum(row['outcome']==kind for row in record['cases']) for kind in ['SURVIVED','REFUSED','KILLED']},'record-outcomes')
    require(not list((SEALED/'execution').iterdir()),'execution-not-empty')
    for name in ['candidate','preflight-ready.json','protected-runtime-before.json','target-identity.json','post-journey-result.json']:
        require(not (SEALED/name).exists(),'operating-artifact:'+name)
    dump = Path(ids['source']).parents[1]/'source-private.dump'
    require(dump.stat().st_size==16232305 and sha(dump)=='181caa01d5ebe66b50da9dcba1242b225e75cfdc8bd0fe03e3c4a9ae86e4d398','dump-pin')
    for path in [SUBJECT/'parent_recipe.sh',SEALED/'run_stage.sh']:
        harmless = subprocess.run(['/bin/sh','-n'],input=('# harmless comment\n'+path.read_text()).encode(),capture_output=True)
        fault = subprocess.run(['/bin/sh','-n'],input=(path.read_text()+'\nif\n').encode(),capture_output=True)
        require(harmless.returncode==0 and fault.returncode!=0 and b'Syntax error' in fault.stderr,'shell-parse-controls')
    # Prove the byte comparator itself can report both agreement and disagreement.
    require(match(dict(manifest['files']),SEALED),'harmless-binding-copy')
    bad = dict(manifest['files']); bad['helper.py']='0'*64
    require(not match(bad,SEALED),'wrong-binding-survived')
    def detector(comparator):
        require(not comparator(bad,SEALED),'missing-binding-refusal')
    detector(match)
    try:
        detector(lambda bindings,root:True)
    except AssertionError as error:
        require(str(error)=='missing-binding-refusal','wrong-disabled-comparator-failure')
    else:
        raise AssertionError('disabled-comparator-survived')
    result = {'subjectCommit':PIN,'subjectPublicFiles':public,'subjectSealedPrivateFiles':manifest['files'],
        'manifestSHA256':sha(SUBJECT/'manifest.json'),'operationFilesSHA256':sha(SEALED/'operation-files.sha256'),
        'parentRecipeSHA256':sha(SUBJECT/'parent_recipe.sh'),'mechanicalModuleExclusions':mechanical,
        'inheritedByteIdenticalInputs':unchanged,'priorPacketEntries':{name:len(entries) for name,entries in packets.items()},
        'fixedInputs':len(fixed),'sealedCompleteInventory':inventory(SEALED),'APP49Unchanged':True,
        'dumpPinExact':True,'operatingStages':0,'phase':phase,
        'blindCategories':['File custody does not prove runtime state, command success, continuous preservation or hostile-host security.',
            'AST comparisons exclude the explicitly reviewed N1 functions and normalize fixed root/name/hash strings.',
            'The historical five-root inventory is not reacquired.']}
    if phase=='after':
        previous = read(PROOF/'audit-before.json')
        require(previous['sealedCompleteInventory']==result['sealedCompleteInventory'],'review-mutated-private-subject')
        require(previous['subjectPublicFiles']==public,'review-mutated-public-subject')
        result['completeSubjectBeforeAfterExact'] = True
    with (PROOF/('audit-'+phase+'.json')).open('x') as stream:
        json.dump(result,stream,indent=2);stream.write('\n')
    if phase=='after':
        with (HERE/'source-bindings.json').open('x') as stream:
            json.dump(result,stream,indent=2);stream.write('\n')
    print(json.dumps({'phase':phase,'sealedFiles':len(manifest['files']),'publicFiles':len(public),
        'priorPacketEntries':sum(len(value) for value in packets.values()),'fixedInputs':len(fixed),'operatingStages':0}))


if __name__=='__main__':
    main()
