"""Independent copied-function N1 controls. All runtime observations are fixtures."""
import ast
import copy
import hashlib
import json
import os
from pathlib import Path
from types import SimpleNamespace

HERE = Path(__file__).resolve().parent
SUBJECT = HERE.with_name('2026-10-15-portfolio-skip-preview-v6-active-helper-fix')
SEALED = Path('/home/nathaniel/.local/state/openplan/project-portfolio-skip-preview-20261015-v6')
PROOF = Path('/home/nathaniel/.local/state/openplan/portfolio-skip-preview-v6-independent-round3-20261015-4cefaf52')
SOURCE = (SUBJECT/'templates/helper.py').read_text()
ROWS = []


def require(value, reason):
    if not value:
        raise AssertionError(reason)


def extract(text, name, ns):
    node = next(n for n in ast.parse(text).body if isinstance(n, ast.FunctionDef) and n.name == name)
    exec(compile(ast.Module(body=[node], type_ignores=[]), '<copied:'+name+'>', 'exec'), ns)


def forbidden(*args, **kwargs):
    raise AssertionError('live-transport-forbidden')


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    os.umask(0o077)
    policy = {}
    exec(compile((SEALED/'policy.py').read_text(), '<pure-policy>', 'exec'), policy)
    p = SimpleNamespace(**policy)
    before = {name:sha(SEALED/name) for name in json.loads((SUBJECT/'manifest.json').read_text())['files']}
    fixture = PROOF/'fixture'
    fixture.mkdir(mode=0o700)
    baseline_file = fixture/'protected-runtime-before.json'
    baseline_file.write_text('{}\n')
    baseline_file.chmod(0o600)
    binding = json.loads((SEALED/'active-helper-identities.json').read_text())
    identities = binding['ids']
    keys = ['Id','Name','Image','Config','HostConfig','Mounts']
    tree = ast.parse(SOURCE)
    retired = ast.literal_eval(next(n.value for n in tree.body if isinstance(n, ast.Assign) and
        any(isinstance(t, ast.Name) and t.id == 'OLD_IDS' for t in n.targets)))
    descriptors = {value:{'Id':value,'Name':'/fixture-'+role,'Image':'fixture-image',
        'Config':{},'HostConfig':{},'Mounts':[],
        'State':{'Running':True,'Paused':False,'Restarting':False,'Pid':11}}
        for role,value in identities.items()}
    for role,value in retired.items():
        descriptors[value] = {'Id':value,'Name':'/retired-'+role,'Image':'retired-image',
            'Config':{},'HostConfig':{},'Mounts':[],
            'State':{'Running':False,'Paused':True,'Restarting':True}}
    protected = json.loads((SEALED/'protected-databases.json').read_text())
    snapshots = {name:[{'database':name,'fixture':'original'}] for name in protected}
    baseline = {'activeHelperIds':copy.deepcopy(identities),
        'helpers':{value:p.digest({key:descriptors[value][key] for key in keys}) for value in identities.values()},
        'databases':copy.deepcopy(snapshots)}
    legacy = {role:p.digest({key:descriptors[value][key] for key in keys}) for role,value in retired.items()}
    v4 = {name:{} for name in [str(SEALED.with_name(SEALED.name[:-1]+'4')),
        str(Path('/home/nathaniel/.t3/worktrees/openplan/t3-9eeec4ad/docs/reviews/2026-10-15-portfolio-skip-preview-v4-preparation'))]}
    v5 = {name:{} for name in [str(SEALED.with_name(SEALED.name[:-1]+'5')),
        str(Path('/home/nathaniel/.t3/worktrees/openplan/t3-9eeec4ad/docs/reviews/2026-10-15-portfolio-skip-preview-v5-corrections'))]}
    plan = json.loads((SEALED/'plan-private.json').read_text())
    receipts = {kind:{'id':'new-fixture-'+kind,'name':plan['names'][kind],'database':plan['target']} for kind in p.IMAGES}
    (fixture/'service-receipts-private.json').write_text(json.dumps(receipts))
    values = {'active-helper-identities.json':binding,'protected-runtime-before.json':baseline,
        'old-helper-bindings-private.json':legacy,'input-bindings-private.json':{},
        'storage-binding-private.json':{},'preservation-files.json':{},
        'v4-full-inventory-before.json':v4,'v5-packet-inventory-before.json':v5,
        'protected-databases.json':protected,'target-identity.json':{'database':plan['target']},
        'service-receipts-private.json':receipts,'envs-private.json':{kind:{} for kind in p.IMAGES}}
    trace, writes = [], []
    knobs = {'late':None,'unknown':None,'badId':None,'source':False,'database':False,'packet':False}
    counts = {}

    def inspect(identity):
        trace.append('inspect:'+identity)
        counts[identity] = counts.get(identity,0)+1
        if knobs['unknown'] == identity:
            raise RuntimeError('fixture-inspect-unreadable')
        value = copy.deepcopy(descriptors[identity])
        if knobs['badId'] == identity:
            value['Id'] = 'f'*64
        if knobs['late'] and counts[identity] >= 2 and identity == knobs['late'][0]:
            value['State'][knobs['late'][1]] = knobs['late'][2]
        return value

    def source_check():
        trace.append('source')
        if knobs['source']:
            raise ValueError('fixture-source-drift')
        return []

    def snapshot(name):
        if knobs['database']:
            return [{'database':name,'fixture':'drift'}]
        return copy.deepcopy(snapshots[name])

    ns = {'p':p,'Path':Path,'json':json,'os':os,'OUT':fixture,'FROZEN':Path(binding['source']).parents[1],
        'read':lambda name:copy.deepcopy(values[name]),'sha':sha,'inspect':inspect,'snapshot':snapshot,
        'OLD_IDS':retired,'OLD_STORAGE':fixture,'inventory':lambda root:{},
        'packet_inventory':lambda root:({'unexpected':{}} if knobs['packet'] and str(root) in v5 else {}),
        'protected_web':lambda:{'fixture':'old-web'},'pinned_files':lambda:plan,
        'db_check':lambda:None,'target_check':lambda:None,'upgrade_ready':lambda:None,
        'expected_service':lambda *args:{},'observed_service':lambda *args:{},'health':lambda:None,
        'source_check':source_check,'write':lambda name,result:writes.append((name,copy.deepcopy(result))),
        'TARGET':plan['target'],'__file__':str(SEALED/'helper.py'),'print':lambda *args:None,
        'run':forbidden,'sql':forbidden,'retained_dump':lambda:None,'free_ports':lambda:None,
        'fresh_target':lambda:None,'shutil':SimpleNamespace(disk_usage=lambda path:SimpleNamespace(free=16*1024**3)),
        'DUMP_SHA':'fixture-only'}
    for name in ['active_helper_identities','require_active_helper','preserve','unchanged_inputs',
                 'verify_services','post_journey','preflight']:
        extract(SOURCE,name,ns)

    def observe(name, function, reason=None):
        start = len(writes)
        try:
            result = function()
        except (ValueError,RuntimeError) as error:
            require(reason is not None and str(error).startswith(reason), 'wrong-refusal:'+name+':'+str(error))
            require(len(writes) == start, 'failed-observation-reached-writer:'+name)
            ROWS.append({'case':name,'outcome':'REFUSED','reason':str(error)})
            return None
        require(reason is None, 'missing-refusal:'+name)
        ROWS.append({'case':name,'outcome':'SURVIVED'})
        return result

    post = lambda:ns['post_journey']()
    # A harmless code mutation is run before any fault control.
    extract('# independent harmless comment\n'+SOURCE,'require_active_helper',ns)
    observe('harmless-comment-full-final-retired-inactive',post)
    require(writes[-1][0] == 'post-journey-result.json','missing-final-writer')
    require(set(writes[-1][1]['preservation']['helperStates']) == set(identities.values()),'missing-observed-states')
    extract(SOURCE,'require_active_helper',ns)
    for role,identity in identities.items():
        original = copy.deepcopy(descriptors[identity])
        try:
            for key,bad in [('Running',False),('Paused',True),('Restarting',True)]:
                descriptors[identity] = copy.deepcopy(original)
                descriptors[identity]['State'][key] = bad
                observe(role+'-'+key,post,'protected-active-state:'+key)
        finally:
            descriptors[identity] = original
    first = next(iter(identities.values()))
    original = copy.deepcopy(descriptors[first])
    try:
        for key in ['Running','Paused','Restarting']:
            for label,bad in [('number',1 if key=='Running' else 0),('text','true'),('null',None),('absent',None)]:
                descriptors[first] = copy.deepcopy(original)
                if label == 'absent':
                    del descriptors[first]['State'][key]
                else:
                    descriptors[first]['State'][key] = bad
                observe(key+'-'+label,post,'protected-active-state:'+key)
    finally:
        descriptors[first] = original
    for key,reason in [('unknown','fixture-inspect-unreadable'),('badId','protected-active-identity:Id'),
                       ('source','fixture-source-drift'),('database','protected-database:snapshot'),
                       ('packet','file-set:keys')]:
        try:
            knobs[key] = first if key in ['unknown','badId'] else True
            observe(key,post,reason)
        finally:
            knobs[key] = None if key in ['unknown','badId'] else False
    saved = copy.deepcopy(baseline)
    try:
        baseline['helpers']['f'*64] = 'fixture-extra'
        observe('baseline-extra-id',post,'protected-active-set:ids')
        baseline.clear(); baseline.update(copy.deepcopy(saved))
        roles = list(identities)
        baseline['activeHelperIds'][roles[0]],baseline['activeHelperIds'][roles[1]] = baseline['activeHelperIds'][roles[1]],baseline['activeHelperIds'][roles[0]]
        observe('baseline-role-swap',post,'files:')
    finally:
        baseline.clear(); baseline.update(saved)
    saved_image = descriptors[first]['Image']
    try:
        descriptors[first]['Image'] = 'changed-image'
        observe('configuration-drift',post,'protected-helper:sha256')
    finally:
        descriptors[first]['Image'] = saved_image
    # Exercise preflight with no baseline and with a later second inspect changing state.
    baseline_file.unlink()
    try:
        counts.clear()
        observe('preflight-healthy',ns['preflight'])
        require(writes[-2][0]=='protected-runtime-before.json' and writes[-2][1]['activeHelperIds']==identities,'wrong-baseline')
        for key,bad in [('Running',False),('Paused',True),('Restarting',True)]:
            try:
                counts.clear(); knobs['late'] = (first,key,bad)
                observe('preflight-late-'+key,ns['preflight'],'protected-active-state:'+key)
            finally:
                knobs['late'] = None
    finally:
        baseline_file.write_text('{}\n'); baseline_file.chmod(0o600)

    def mutation(name, function, old, new, configure, detector):
        original_function = ns[function]
        require(SOURCE.count(old)==1,'ambiguous-mutation:'+name)
        try:
            configure(True)
            # Detector first works on the unchanged function.
            detector()
            extract(SOURCE.replace(old,new),function,ns)
            try:
                detector()
            except AssertionError as error:
                require(str(error).startswith('missing-refusal:'),'wrong-mutation-failure:'+str(error))
                ROWS.append({'case':name,'outcome':'KILLED','reason':str(error)})
            else:
                raise AssertionError('fault-survived:'+name)
        finally:
            ns[function] = original_function
            configure(False)

    for key,bad in [('Running',False),('Paused',True),('Restarting',True)]:
        wanted = {'Running':True,'Paused':False,'Restarting':False}
        new = dict(wanted); del new[key]
        mutation('remove-'+key,'require_active_helper',
            "{'Running':True,'Paused':False,'Restarting':False},state",repr(new)+',state',
            lambda active,k=key,b=bad:descriptors[first]['State'].__setitem__(k,b if active else wanted[k]),
            lambda k=key:observe('detector-'+k,post,'protected-active-state:'+k))
    mutation('remove-acquisition-call','preserve','state=require_active_helper(identity,i)',
        "state={'Running':True,'Paused':False,'Restarting':False}",
        lambda active:descriptors[first]['State'].__setitem__('Paused',active),
        lambda:observe('detector-acquisition',post,'protected-active-state:Paused'))
    baseline_file.unlink()
    try:
        def late(active):
            counts.clear(); knobs['late'] = (first,'Paused',True) if active else None
        def late_detector():
            counts.clear()
            observe('detector-preflight',ns['preflight'],'protected-active-state:Paused')
        mutation('remove-preflight-call','preflight','states[identity]=require_active_helper(identity,i)',
            "states[identity]={'Running':True,'Paused':False,'Restarting':False}",late,late_detector)
    finally:
        baseline_file.write_text('{}\n'); baseline_file.chmod(0o600)
    observe('restored-full-final',post)
    require({name:sha(SEALED/name) for name in before}==before,'sealed-subject-changed')
    require(not list((SEALED/'execution').iterdir()) and not (SEALED/'candidate').exists(),'operating-stage-present')
    result = {'scope':'Independent pure copied full final chain plus preflight. No runtime transport.',
        'cases':ROWS,'counts':{outcome:sum(row['outcome']==outcome for row in ROWS) for outcome in ['SURVIVED','REFUSED','KILLED']},
        'sealedInputsUnchanged':True,'inMemoryFunctionsAndSpecimensRestored':True,
        'blindCategories':['Synthetic inspect, source, database, health and old-web observations do not prove current service state.',
            'Point-in-time state cannot establish uninterrupted availability or stable PID/start identity.',
            'This does not execute an operating entrypoint, restore, build, attestation or browser journey.']}
    for path in [PROOF/'controls-01.json',HERE/'controls.json']:
        with path.open('x') as stream:
            json.dump(result,stream,indent=2); stream.write('\n')
    print(json.dumps({'counts':result['counts'],'operatingStages':0}))


if __name__ == '__main__':
    main()
