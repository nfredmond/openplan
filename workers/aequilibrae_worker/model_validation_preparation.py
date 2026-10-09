"""Retain explicit v2 bundle inputs before a later execution handoff.

The caller owns the attempt and establishes ordering separately. No engine,
source acquisition, historical-directory discovery or scientific promotion occurs.
"""
import hashlib
import os
from pathlib import Path
import sys

import model_handoff_files
import model_record_files

MODELING = Path(__file__).resolve().parents[2] / 'scripts' / 'modeling'
if str(MODELING) not in sys.path:
    sys.path.insert(0, str(MODELING))
import validation_instrument_v2 as instrument

PATH_FIELDS = ('registry_path','network_path','observation_package_path','match_audit_path','assignment_profile_path')


def retain(*, files, method, bundle_arguments):
    """Copy every declared bundle readiness file and publish its manifest last.

    This retains an input bundle, not a complete scientific preparation. Nested
    measurement coverage, structural inputs and pre-result timing remain unassessed.
    """
    if method not in ('aequilibrae','activitysim') or files.root.name != 'runs':
        raise ValueError('Owned runs workspace and explicit method required')
    files.verify()
    arguments = dict(bundle_arguments)
    root = Path(arguments.get('relative_to') or files.path).resolve(strict=True)
    def owned(value):
        path=Path(value)
        path=(path if path.is_absolute() else root/path).resolve(strict=True)
        if not path.is_relative_to(files.path):
            raise ValueError('Preparation input must belong to the owned attempt')
        return path
    for field in PATH_FIELDS: arguments[field]=owned(arguments[field])
    sources=arguments.get('source_artifacts')
    if not isinstance(sources,(list,tuple)):
        raise ValueError('Explicit source artifact records required')
    for record in sources:
        if not isinstance(record,dict) or 'path' not in record:
            raise ValueError('Explicit source artifact records required')
        owned(record['path'])
    arguments['relative_to']=root
    destination=files.path/('validation_preparation_'+method)
    # Refuse both complete and interrupted preparations; never recompute over them.
    with files.pinned() as descriptor:
        os.mkdir(destination.name,mode=0o700,dir_fd=descriptor)
        os.fsync(descriptor)
    bundle=instrument.build_input_bundle(**arguments)
    objects=destination/'sha256';objects.mkdir(mode=0o700)
    entries=[]
    readiness=bundle['readiness_inputs']
    records=[(key,value) for key,value in readiness.items() if key!='sources']
    records.extend(('sources/'+str(index),value) for index,value in enumerate(readiness['sources']))
    for index,(role,record) in enumerate(records):
        source=owned(record['path'])
        temporary=objects/('copy-'+str(index))
        model_handoff_files.copy_registered(files.root.parent,files.owner['run_id'],source,temporary,
            sha256=record['sha256'],size_bytes=record['bytes'])
        target=objects/record['sha256']
        # Check each declared source even when identical content has another role.
        if target.exists(): temporary.unlink()
        else: temporary.rename(target)
        entries.append({'role':role,'original_reference':record['path'],'sha256':record['sha256'],
                        'bytes':record['bytes'],'object_name':'sha256/'+record['sha256']})
    descriptor=os.open(objects,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:os.fsync(descriptor)
    finally:os.close(descriptor)
    content=instrument.canonical_json_bytes(bundle)
    model_record_files.materialize(destination,{'validation_input_bundle.json':content})
    manifest={'schema':'openplan.validation-preparation-files.v1',
        'context':{**{key:files.owner[key] for key in ('workspace_id','run_id','stage_id','attempt_id','claim_request_id','destination')},'method':method},
        'bundle':{'path':'validation_input_bundle.json','sha256':hashlib.sha256(content).hexdigest(),'bytes':len(content)},
        'entries':entries,'publication_state':'retained_locally','preparation_independence':'unassessed',
        'source_completeness':'unassessed','structural_preparation':'unassessed','execution_authorized':False,
        'scientific_acceptance':'unassessed'}
    files.verify()
    manifest_bytes=instrument.canonical_json_bytes(manifest)
    model_record_files.materialize(destination,{'manifest.json':manifest_bytes})
    files.verify()
    return {'manifest_path':str(destination/'manifest.json'),'manifest_sha256':hashlib.sha256(manifest_bytes).hexdigest(),
            'manifest_size_bytes':len(manifest_bytes)}


def consume(*, root, source, destination, expected_context):
    """Copy a registered producer's manifest, bundle and declared readiness bytes.

    Producer completion and consumer ownership belong to the caller's native
    reads and final artifact command. Original document bytes are never rewritten.
    """
    from model_validation_source_publication import _read
    from model_validation_source_catalog import _artifact, _unique_object, _invalid_number
    import json
    manifest_path=Path(source['manifest_path'])
    if not manifest_path.is_absolute() or manifest_path.name!='manifest.json':
        raise ValueError('Explicit preparation manifest required')
    content=_read(manifest_path,source['manifest_sha256'],source['manifest_size_bytes'])
    manifest=json.loads(content,object_pairs_hook=_unique_object,parse_constant=_invalid_number)
    if (manifest.get('schema')!='openplan.validation-preparation-files.v1'
            or any(manifest.get('context',{}).get(key)!=value for key,value in expected_context.items())
            or manifest.get('publication_state')!='retained_locally'
            or manifest.get('execution_authorized') is not False):
        raise ValueError('Preparation manifest scope or state differs')
    bundle_record=manifest.get('bundle')
    if not _artifact(bundle_record) or bundle_record['path']!='validation_input_bundle.json':
        raise ValueError('Preparation bundle identity invalid')
    bundle_bytes=_read(manifest_path.parent/bundle_record['path'],bundle_record['sha256'],bundle_record['bytes'])
    bundle=json.loads(bundle_bytes,object_pairs_hook=_unique_object,parse_constant=_invalid_number)
    if bundle.get('schema')!=instrument.INPUT_BUNDLE_SCHEMA or bundle.get('model_output_bytes_read') is not False:
        raise ValueError('Unsupported retained preparation bundle')
    readiness=bundle.get('readiness_inputs')
    if not isinstance(readiness,dict) or set(readiness)!={'registry','network','observation_package','pre_volume_match_audit','assignment_profile','sources'} or not isinstance(readiness['sources'],list):
        raise ValueError('Preparation readiness inventory invalid')
    expected={key:value for key,value in readiness.items() if key!='sources'}
    expected.update({'sources/'+str(index):value for index,value in enumerate(readiness['sources'])})
    entries=manifest.get('entries')
    if not isinstance(entries,list) or len(entries)!=len(expected):
        raise ValueError('Preparation role inventory differs')
    seen=set()
    for entry in entries:
        if not isinstance(entry,dict):raise ValueError('Preparation role invalid')
        role=entry.get('role');record=expected.get(role)
        if (role in seen or not _artifact(record) or entry.get('original_reference')!=record['path']
                or entry.get('sha256')!=record['sha256'] or entry.get('bytes')!=record['bytes']
                or entry.get('object_name')!='sha256/'+record['sha256']):
            raise ValueError('Preparation role binding differs')
        seen.add(role)
    destination=Path(destination)
    destination.mkdir(mode=0o700,exist_ok=False)
    objects=destination/'sha256';objects.mkdir(mode=0o700)
    for entry in entries:
        target=objects/entry['sha256']
        if target.exists():continue
        model_handoff_files.copy_registered(root,expected_context['run_id'],manifest_path.parent/entry['object_name'],target,
            sha256=entry['sha256'],size_bytes=entry['bytes'])
    model_record_files.materialize(destination,{'validation_input_bundle.json':bundle_bytes,'producer_manifest.json':content})
    result={'schema':'openplan.validation-preparation-consumption.v1','producer_context':manifest['context'],
        'producer_manifest_sha256':source['manifest_sha256'],'producer_manifest_size_bytes':source['manifest_size_bytes'],
        'entries':entries,'bundle':bundle_record,'execution_authorized':False,'scientific_acceptance':'unassessed'}
    retained=instrument.canonical_json_bytes(result)
    model_record_files.materialize(destination,{'manifest.json':retained})
    return {'manifest_path':str(destination/'manifest.json'),'manifest_sha256':hashlib.sha256(retained).hexdigest(),
            'manifest_size_bytes':len(retained),'bundle_path':str(destination/'validation_input_bundle.json'),
            'source_paths':{entry['role']:str(destination/entry['object_name']) for entry in entries},
            'execution_authorized':False}
