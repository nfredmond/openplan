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
