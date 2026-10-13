"""Capture an explicit known-root metadata profile and reopen its exact digest.

Uses a stopped retained synthetic fixture. Does not discover installed roots,
contact the engine, align database/Storage or establish whole-worker recovery.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / 'openplan/scripts/ops'))
import installation_worker_inventory as installed
import worker_root_set_snapshot as roots
from worker_root_snapshot import inventory, verify


def bytes_json(value):
    return (json.dumps(value, indent=2, sort_keys=True) + '\n').encode()


def matches(error, kind, message):
    return type(error) is kind and str(error) == message


def fixture(source, fault=None):
    binding=json.loads(Path(__file__).with_name('fixture-binding.json').read_bytes())
    if fault=='prior-binding':binding['priorEvidenceSha256']='0'*64
    if fault=='reply-binding':binding['bodySha256']='0'*64
    prior=REPO/binding['priorEvidence']
    if hashlib.sha256(prior.read_bytes()).hexdigest()!=binding['priorEvidenceSha256']:
        raise ValueError('known fixture prior evidence differs')
    result=(source/'results.json').read_bytes()
    if hashlib.sha256(result).hexdigest()!=binding['sourceResultSha256']:
        raise ValueError('known fixture source receipt differs')
    if hashlib.sha256((source/'selected-root-point/snapshot.json').read_bytes()).hexdigest()!=binding['sourceSnapshotSha256']:
        raise ValueError('known fixture source snapshot differs')
    verify(source/'selected-root-point',timeout=30)
    paths={'engine':source/'native-api/effects','metadata':source/'private-records'}
    for name,path in paths.items():
        observed=inventory(path,time.monotonic()+10)
        if hashlib.sha256(bytes_json(observed)).hexdigest()!=binding['rootInventories'][name]:
            raise ValueError('known fixture source root differs')
    previous=json.loads(result)
    if previous['bodySha256']!=binding['bodySha256'] or previous['bodySha256']!=json.loads(prior.read_bytes())['bodySha256']:
        raise ValueError('known fixture original reply digest differs')
    return previous,paths


def invoke(engine, records, digest):
    result = subprocess.run([sys.executable, '-B', str(REPO / 'workers/odm_worker/task_observation_cli.py'),
        '--engine-root', str(engine), '--records-root', str(records), '--read-digest', digest],
        capture_output=True, timeout=10, env={**os.environ, 'PYTHONDONTWRITEBYTECODE':'1'})
    if result.returncode != 0 or result.stderr:
        raise AssertionError('metadata command did not reopen the captured digest')
    return json.loads(result.stdout)


def trial(source, out, fault=None):
    out.mkdir(mode=0o700)
    if fault=='substitute-receipt':
        value=json.loads((source/'results.json').read_bytes());value['reportedState']='completed'
        (source/'results.json').write_bytes(bytes_json(value))
    if fault=='substitute-snapshot':
        with (source/'selected-root-point/snapshot.json').open('ab') as stream:stream.write(b' ')
    if fault=='substitute-root':
        with (source/'private-records/writer.lock').open('ab') as stream:stream.write(b'changed')
    previous,source_roots = fixture(source,fault)
    if fault == 'missing-stopped-record':previous.pop('engineStoppedBeforeCapture',None)
    if previous.get('engineStoppedBeforeCapture') is not True:
        raise ValueError('retained fixture must record stopped engine capture')
    before = {name: inventory(path, time.monotonic()+10) for name, path in source_roots.items()}
    working = out / 'working'; working.mkdir(mode=0o700)
    for name, path in source_roots.items():
        shutil.copytree(path, working/name)
    digest = previous['bodySha256']
    if fault == 'wrong-digest':digest='0'*64
    original_summary = invoke(working/'engine', working/'metadata', digest)
    config = out / 'operator-private.json'
    ids={name:name+('-alias' if fault=='harmless-root-aliases' else '') for name in source_roots}
    settings={'scope':'synthetic-known-root-only', 'digest':digest,
        'engineRootId':ids['engine'], 'metadataRootId':ids['metadata']}
    if fault=='configured-wrong-digest':settings['digest']='0'*64
    if fault=='configured-swapped-roots':settings['engineRootId'],settings['metadataRootId']=settings['metadataRootId'],settings['engineRootId']
    if fault=='configured-external-root':settings['engineRootId']=str(source_roots['engine'])
    if fault=='configured-equal-roots':settings['engineRootId']=settings['metadataRootId']
    if fault=='configured-root-type':settings['engineRootId']=[]
    config.write_bytes(bytes_json(settings)); config.chmod(0o600)
    profile = {'format':installed.PROFILE_FORMAT, 'installationId':'synthetic-metadata-only',
        'roots':[{'id':ids[name],'path':str(working/name)} for name in source_roots],
        'configuration':[{'id':'metadata-command','path':str(config)}],
        'workers':{name:{'state':'unassessed','custody':'unassessed','rootIds':[],
            'configurationIds':[],'notes':'No installation assessment. Known synthetic fixture only.'}
            for name in installed.FAMILIES}}
    profile['workers']['odm'].update(state='configured',custody='local_roots',
        rootIds=list(ids.values()),configurationIds=['metadata-command'])
    if fault == 'harmless':profile['workers']['odm']['notes'] += ' Harmless note.'
    if fault in ('omit-engine','omit-metadata'):
        omitted=fault.removeprefix('omit-')
        profile['roots']=[row for row in profile['roots'] if row['id']!=ids[omitted]]
        profile['workers']['odm']['rootIds'].remove(ids[omitted])
    path=out/'profile-private.json';path.write_bytes(bytes_json(profile));path.chmod(0o600)
    selected=out/'installation-inventory'
    installed.capture(path,selected,writers_quiesced=True,repo=REPO,timeout=30)
    installed.verify(selected,timeout=30)
    chosen=json.loads((selected/'inventory.json').read_bytes())
    if {row['path'] for row in chosen['roots']} != {str(working/name) for name in source_roots}:
        raise AssertionError('known metadata command requires both selected roots')
    if fault == 'corrupt-configuration':
        with (selected/'configuration/metadata-command').open('ab') as stream:stream.write(b'changed')
    installed.verify(selected,timeout=30)
    point=out/'selected-root-point'
    roots.capture(selected/'inventory.json',point,writers_quiesced=True,timeout=30)
    roots.verify(point,timeout=30)
    relocated=out/'relocated';relocated.mkdir(mode=0o700)
    for row in chosen['roots']:
        shutil.copytree(point/'roots'/row['id']/'root',relocated/row['id'])
    if fault == 'corrupt-component':
        with (point/'roots/metadata/root'/f'{digest}.json').open('ab') as stream:stream.write(b'changed')
    roots.verify(point,timeout=30)
    config_id=chosen['workerAssessments']['odm']['configurationIds'][0]
    retained=json.loads((selected/'configuration'/config_id).read_bytes())
    runtime_roots={row['id']:relocated/row['id'] for row in chosen['roots']}
    engine_id=retained.get('engineRootId');metadata_id=retained.get('metadataRootId')
    if not isinstance(engine_id,str) or not isinstance(metadata_id,str) or engine_id not in runtime_roots or metadata_id not in runtime_roots or engine_id==metadata_id:
        raise ValueError('captured metadata root mapping differs')
    recovered=invoke(runtime_roots[engine_id],runtime_roots[metadata_id],retained['digest'])
    if fault == 'changed-summary':recovered['reportedProgressPercent']=-1
    if recovered != original_summary:
        raise AssertionError('captured metadata command summary differs')
    if fault == 'change-source':
        with (source_roots['metadata']/'writer.lock').open('ab') as stream:stream.write(b'changed')
    for name,path in source_roots.items():
        if inventory(path,time.monotonic()+10) != before[name]:
            raise AssertionError('retained original root changed')
    return {'bothRootsCaptured':True,'inventoryVerified':True,'rootSetVerified':True,
        'relocatedExactSummary':True,'originalRootsUnchanged':True,
        'reportedState':recovered['reportedState'],'reportedImageCount':recovered['reportedImageCount'],
        'bodySha256':digest,'installationCoverage':'unassessed',
        'wholeWorkerRecoveryAccepted':False,'liveAuthorityAccepted':False,
        'freshnessAccepted':False,'processingQualityAccepted':False,'defaultActivated':False}


def run(source,out):
    os.umask(0o077);out.mkdir(mode=0o700)
    controls=[]
    for label,fault in [('baseline',None),('harmless','harmless'),('harmless-root-aliases','harmless-root-aliases'),('restored',None)]:
        result=trial(source,out/label,fault);controls.append({'control':label,'outcome':'survived'})
    expected={'omit-engine':(AssertionError,'known metadata command requires both selected roots'),
        'omit-metadata':(AssertionError,'known metadata command requires both selected roots'),
        'corrupt-configuration':(ValueError,'Retained worker inventory bytes or layout differ'),
        'corrupt-component':(ValueError,'Worker-root package content differs from its manifest'),
        'changed-summary':(AssertionError,'captured metadata command summary differs'),
        'change-source':(AssertionError,'retained original root changed'),
        'missing-stopped-record':(ValueError,'retained fixture must record stopped engine capture'),
        'wrong-digest':(AssertionError,'metadata command did not reopen the captured digest'),
        'configured-wrong-digest':(AssertionError,'metadata command did not reopen the captured digest'),
        'configured-swapped-roots':(AssertionError,'metadata command did not reopen the captured digest'),
        'configured-external-root':(ValueError,'captured metadata root mapping differs'),
        'configured-equal-roots':(ValueError,'captured metadata root mapping differs'),
        'configured-root-type':(ValueError,'captured metadata root mapping differs'),
        'substitute-receipt':(ValueError,'known fixture source receipt differs'),
        'substitute-snapshot':(ValueError,'known fixture source snapshot differs'),
        'substitute-root':(ValueError,'known fixture source root differs'),
        'prior-binding':(ValueError,'known fixture prior evidence differs'),
        'reply-binding':(ValueError,'known fixture original reply digest differs')}
    # The source-change control uses its own private copy. The retained fixture
    # remains immutable even when the trial deliberately changes that copy.
    for label,(kind,message) in expected.items():
        copied=out/(label+'-source');shutil.copytree(source,copied)
        try:trial(copied,out/label,label)
        except Exception as error:
            if not matches(error,kind,message):raise
            controls.append({'control':label,'outcome':'intended_refusal','reason':message})
        else:raise AssertionError('targeted integration fault survived: '+label)
    (out/'results.json').write_bytes(bytes_json(result))
    (out/'controls.json').write_bytes(bytes_json(controls))
    oracles=[]
    for label,(kind,message) in expected.items():
        for name,error,wanted in [('exact',kind(message),True),
            ('wrong-diagnostic',kind('unrelated failure'),False),
            ('wrong-type',RuntimeError(message),False)]:
            observed=matches(error,kind,message)
            if observed is not wanted:raise AssertionError('typed integration oracle differs')
            oracles.append({'control':label+'-'+name,'accepted':observed})
    (out/'oracle-controls.json').write_bytes(bytes_json(oracles))
    files=[Path(__file__),Path(__file__).with_name('fixture-binding.json'),REPO/'workers/odm_worker/task_observation_cli.py',
        REPO/'openplan/scripts/ops/installation_worker_inventory.py',
        REPO/'openplan/scripts/ops/worker_root_set_snapshot.py',
        REPO/'openplan/scripts/ops/worker_root_snapshot.py']
    (out/'source-bindings.json').write_bytes(bytes_json({str(p.relative_to(REPO)):
        hashlib.sha256(p.read_bytes()).hexdigest() for p in files}))
    print(json.dumps({'positiveCohorts':4,'targetedFaults':len(expected),'result':result}))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',type=Path,required=True)
    parser.add_argument('--out',type=Path,required=True)
    args=parser.parse_args();run(args.source.resolve(strict=True),args.out.resolve())
