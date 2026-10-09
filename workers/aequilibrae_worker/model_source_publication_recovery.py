"""Reconcile a saved source publication without reentering model execution."""
import argparse
from contextlib import closing
from dataclasses import asdict
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import uuid

import model_command_client as client
import model_command_journal as journal
import model_command_recovery as commands
from model_attempt_invocation import AttemptContext
from model_engine_recovery import read_record
import model_validation_source_publication as publication

FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW


def _request_id(context, name):
    identity = journal.canonical({'destination':context.destination, 'operation':'write_model_attempt_artifact', 'name':name})
    return str(uuid.uuid5(uuid.UUID(context.attempt_id), identity))


def artifact_payload(context, published):
    return {'run_id':context.run_id, 'stage_id':context.stage_id,
            'artifact_type':'model_validation_source_publication', 'file_url':published['manifest_uri'],
            'file_size_bytes':published['manifest_size_bytes'], 'content_hash':published['manifest_sha256'],
            'metadata_json':{'schema':'openplan.validation-source-catalog.v1', 'context':published['context'],
                             'publication_state':'remote_verified', 'object_count':published['object_count'],
                             'role_count':published['role_count'], 'scientific_acceptance':'unassessed'}}


def prepare(files, context, method, retained):
    """Save this admitted invocation's publication scope before the first upload."""
    if method not in ('aequilibrae','activitysim'): raise ValueError('Unsupported source method')
    value = {'schema':'openplan.source-publication-recovery.v1', 'context':asdict(context),
             'method':method, 'retained':retained}
    with files.pinned() as parent:
        name = 'source_publication_' + method
        try: os.mkdir(name, mode=0o700, dir_fd=parent); os.fsync(parent)
        except FileExistsError: pass
        directory = os.open(name, FLAGS, dir_fd=parent)
        try:
            existing, _ = read_record(directory, 'recovery.json', optional=True)
            if existing is not None:
                if existing != value: raise ValueError('Source recovery intent differs')
                return
            temporary = '.recovery-' + uuid.uuid4().hex
            fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=directory)
            try:
                with os.fdopen(fd, 'w') as writer:
                    writer.write(journal.canonical(value)+'\n'); writer.flush(); os.fsync(writer.fileno())
                os.link(temporary, 'recovery.json', src_dir_fd=directory, dst_dir_fd=directory)
            finally: os.unlink(temporary, dir_fd=directory)
            os.fsync(directory)
        finally: os.close(directory)


def reconcile(root, journal_directory, *, base_url, deployment_id, claim_request_id, method, service_key,
              post=None, get=None, request=None):
    """Finish only an acknowledged source set and its fixed artifact registration.

    Ownership reads are point-in-time checks. The native artifact transaction is
    the final attempt fence; no stage state, admission or engine callback changes.
    """
    if method not in ('aequilibrae','activitysim'): raise ValueError('Unsupported source method')
    journal_directory = Path(journal_directory)
    saved = commands._checked_records(journal_directory,base_url,deployment_id,claim_request_id,include_resolved=True)
    if len(saved)!=1 or not saved[0]['resolved']: raise ValueError('Retained claim receipt required')
    claim = saved[0]['command']; receipt = client.checked_receipt(claim,saved[0]['response'])
    if claim['operation']!='claim_model_stage_attempt' or receipt['outcome']!='claimed': raise ValueError('Original claimed attempt required')
    uri=(journal_directory/'model-commands.sqlite3').resolve().as_uri()+'?mode=ro'
    with closing(sqlite3.connect(uri,uri=True)) as connection:
        admitted=connection.execute('SELECT workspace_id,entered FROM execution_admissions WHERE request_id=?',(claim_request_id,)).fetchone()
    if admitted is None or admitted[1]!=1: raise ValueError('Consumed original admission required')
    client._uuid(admitted[0])
    context=AttemptContext(claim['destination'],admitted[0],claim['arguments']['run_id'],claim['arguments']['stage_id'],receipt['attempt_id'],claim_request_id)
    parts=(context.run_id,'attempts',hashlib.sha256(context.destination.encode()).hexdigest(),context.stage_id,context.attempt_id)
    root=Path(root).absolute()
    workspace=root.joinpath(*parts)
    directory=os.open(root,FLAGS)
    try:
        for part in parts:
            child=os.open(part,FLAGS,dir_fd=directory);os.close(directory);directory=child
        owner,_=read_record(directory,'attempt_owner.json')
        if owner!={'schema':'openplan.attempt-workspace.v1',**asdict(context)}: raise ValueError('Attempt owner differs from claim')
        child=os.open('source_publication_'+method,FLAGS,dir_fd=directory);os.close(directory);directory=child
        recovery,_=read_record(directory,'recovery.json')
    finally:os.close(directory)
    if recovery.get('schema')!='openplan.source-publication-recovery.v1' or recovery.get('context')!=asdict(context) or recovery.get('method')!=method:
        raise ValueError('Saved source publication scope differs')
    local_id=_request_id(context,'validation-sources-'+method)
    local=commands._checked_records(journal_directory,base_url,deployment_id,local_id,include_resolved=True)
    if len(local)!=1 or not local[0]['resolved']: raise ValueError('Acknowledged local source artifact required')
    local_command=local[0]['command']
    scope={'run_id':context.run_id,'stage_id':context.stage_id,'attempt_id':context.attempt_id}
    if local_command['operation']!='write_model_attempt_artifact' or any(local_command['arguments'].get(key)!=value for key,value in scope.items()):
        raise ValueError('Local artifact command scope differs')
    local_receipt=client.checked_receipt(local[0]['command'],local[0]['response'])
    expected_context={'workspace_id':context.workspace_id,'model_run_id':context.run_id,'stage_id':context.stage_id,'attempt_id':context.attempt_id,'method':method}
    manifest=workspace/('validation_sources_'+method)/'manifest.json'
    retained={'manifest_path':str(manifest),'manifest_sha256':local_receipt['content_hash'],'manifest_size_bytes':local_receipt['file_size_bytes']}
    if (local_receipt['artifact_type']!='model_validation_sources' or local_receipt['file_url']!='local://'+str(manifest)
            or local_receipt['metadata_json'].get('context')!=expected_context or recovery.get('retained')!=retained):
        raise ValueError('Local source receipt differs from saved publication')
    remote_id=_request_id(context,'validation-source-publication-'+method)
    pending=commands._checked_records(journal_directory,base_url,deployment_id)
    if any(row['command']['request_id']!=remote_id for row in pending): raise ValueError('Unrelated pending command requires reconciliation')
    def owns():
        state=client.inspect_ownership(claim,receipt,workspace_id=context.workspace_id,base_url=base_url,
                                       deployment_id=deployment_id,service_key=service_key,get=get)
        if not state['owns_stage']: raise client.OwnershipUnconfirmed('Original attempt no longer owns publication')
    owns()
    published=publication.publish(retained=retained,expected_context=expected_context,
                                  state_dir=workspace/('source_publication_'+method),base_url=base_url,
                                  service_key=service_key,request=request)
    owns()
    payload=artifact_payload(context,published);payload.pop('run_id');payload.pop('stage_id')
    command={'request_id':remote_id,'destination':context.destination,'operation':'write_model_attempt_artifact',
             'arguments':{'run_id':context.run_id,'stage_id':context.stage_id,'attempt_id':context.attempt_id,'payload':payload}}
    result=client.deliver(journal_directory,command,base_url=base_url,deployment_id=deployment_id,service_key=service_key,post=post)
    return {'outcome':'source_publication_reconciled','request_id':remote_id,'artifact_id':result['id'],
            'model_resumed':False,'stage_status_changed':False,'execution_admission_created':False}


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root',type=Path,required=True);parser.add_argument('--journal',type=Path,required=True)
    parser.add_argument('--base-url',required=True);parser.add_argument('--deployment-id',required=True)
    parser.add_argument('--claim-request-id',required=True);parser.add_argument('--method',choices=('aequilibrae','activitysim'),required=True)
    args=parser.parse_args(argv)
    try:
        result=reconcile(args.root,args.journal,base_url=args.base_url,deployment_id=args.deployment_id,
                         claim_request_id=args.claim_request_id,method=args.method,service_key=os.environ.get('SUPABASE_SERVICE_ROLE_KEY',''))
    except (client.OwnershipUnconfirmed,client.DeliveryUnconfirmed,RuntimeError):
        print(json.dumps({'outcome':'source_publication_unconfirmed','model_resumed':False}));return 2
    except (ValueError,TypeError,KeyError,OSError,sqlite3.Error):
        print(json.dumps({'outcome':'source_publication_refused','model_resumed':False}));return 3
    print(json.dumps(result));return 0


if __name__=='__main__':raise SystemExit(main())
