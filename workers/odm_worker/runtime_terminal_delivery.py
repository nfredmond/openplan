"""Retain one original reported terminal callback before supervised delivery.

Reported engine completion, transport acknowledgement and human acceptance stay
separate. This adapter does not enable the worker entry point or approve quality.
"""
import base64
import copy
from datetime import datetime, timezone
import hashlib
import re
import secrets
import time

from admission_journal import private, synchronize
from application_delivery_authority import Authority, TERMINAL
from retained_output_archive import clear_unpublished
from retained_source import json_bytes, publish, read_json, writer
from retained_task_observation import Observations
from runtime_artifact_access import ArtifactAccess
from runtime_observation import Observer
from runtime_progress_delivery import Delivery as Journal, parse, checksum, FIELDS, REPLY_LIMIT

FORMAT='openplan.odm-terminal-delivery.v1'
BODY_LIMIT=64*1024
EVENT='terminal'
STATES={'succeeded':(40,'completed'),'failed':(30,'failed'),'canceled':(50,'canceled')}


class Delivery(Journal):
    record_format=FORMAT

    def __init__(self,observer,authority,transport,credential_reference,*,access=None,
                 timeout=120,cancelled=lambda:False,max_attempts=10000):
        if (not isinstance(observer,Observer) or not isinstance(authority,Authority)
                or authority.dispatch is not observer.reader.dispatch
                or access is not None and (not isinstance(access,ArtifactAccess)
                    or access.dispatch is not observer.reader.dispatch)):
            raise ValueError('Terminal delivery needs one original observation and scoped authority')
        super().__init__(observer.reader,transport,credential_reference,timeout=timeout,
            cancelled=cancelled,max_attempts=max_attempts)
        self.observer=observer;self.authority=authority;self.access=access

    def folder(self,request_id,event_key=EVENT):
        if event_key!=EVENT:
            raise ValueError('Terminal delivery has one original event key')
        return self.reader.dispatch.runtime.root/('terminal-delivery-'+checksum(request_id.encode()))

    def _observation(self,request_id,observation_hash,deadline):
        root,engine=self.observer._original(request_id,deadline)
        store=Observations(root/'engine',engine,records_root=root/'task-observations',
            timeout=max(.001,deadline-time.monotonic()))
        observed=store.load(observation_hash,deadline=deadline)
        self._check(request_id,deadline)
        return root,engine,observed

    def _lease(self,request_id,observation_hash,deadline,*,live=False):
        if self.access is None:
            raise ValueError('Successful terminal delivery needs original artifact access')
        root,manifest=self.access._plan(request_id,observation_hash,deadline)
        lease=self.access._load(root,manifest)
        receipt=read_json(root/'private-artifact-access','receipt.json')
        from runtime_artifact_access import FORMAT as ACCESS_FORMAT, SCOPE as ACCESS_SCOPE
        expected={'format':ACCESS_FORMAT,'scope':ACCESS_SCOPE,'leaseSha256':checksum(json_bytes(lease)),
            'terminalCallbackPermission':False}
        if json_bytes(receipt)!=json_bytes(expected):
            raise ValueError('Terminal delivery original artifact lease receipt differs')
        if live:self.access._live(lease)
        if not any(row['kind']=='orthomosaic' and row['availability']=='retained' for row in lease['artifacts']):
            raise ValueError('Successful terminal delivery has no retained original orthomosaic')
        expires=datetime.fromtimestamp(lease['expiresAt'],timezone.utc).isoformat()
        artifacts=[{'kind':row['kind'],'downloadUrl':row['downloadUrl'],'expiresAt':expires,
            'sizeBytes':row['sizeBytes'],'contentType':row['contentType']}
            for row in lease['artifacts'] if row['availability']=='retained']
        return lease,receipt,artifacts

    def _command(self,request_id,event_key,raw,deadline,*,observation_hash=None):
        self.folder(request_id,event_key)
        entry=self._check(request_id,deadline)
        original=self.reader.dispatch.load(request_id,deadline=deadline)
        value=parse(raw,BODY_LIMIT)
        if (not isinstance(value,dict) or not FIELDS<=value.keys()
                or value.keys()-FIELDS-{'progress','message','artifacts'}):
            raise ValueError('Terminal delivery callback projection differs')
        if (value['schemaVersion']!=entry.request['schemaVersion'] or value['requestId']!=request_id
                or value['jobReference']!=entry.job_reference or not isinstance(value['status'],str) or value['status'] not in STATES):
            raise ValueError('Terminal delivery original callback scope differs')
        if not isinstance(value['callbackId'],str) or len(value['callbackId'].encode('utf-16-le'))//2<8:
            raise ValueError('Terminal delivery callback identity differs')
        occurred=value['occurredAt']
        if not isinstance(occurred,str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})',occurred):
            raise ValueError('Terminal delivery original occurrence time differs')
        try:datetime.fromisoformat(occurred.replace('Z','+00:00'))
        except ValueError:raise ValueError('Terminal delivery original occurrence time differs') from None
        if 'message' in value and (not isinstance(value['message'],str) or len(value['message'].encode('utf-16-le'))//2>2048):
            raise ValueError('Terminal delivery original message differs')
        if 'progress' in value and (type(value['progress']) not in (int,float) or not 0<=value['progress']<=100):
            raise ValueError('Terminal delivery original progress differs')
        # The observation hash is retained beside the command, not supplied anew on replay.
        root=self.folder(request_id,event_key)
        if observation_hash is None:
            context=read_json(root,'context.json')
            if not isinstance(context,dict) or set(context)!={'observationSha256'}:
                raise ValueError('Terminal delivery original observation context differs')
            observation_hash=context['observationSha256']
        _root,engine,observed=self._observation(request_id,observation_hash,deadline)
        if (observed['reportedStatusCode'],observed['reportedState'])!=STATES[value['status']]:
            raise ValueError('Terminal delivery differs from original reported engine state')
        lease_hash=receipt_hash=None
        if value['status']=='succeeded':
            lease,receipt,artifacts=self._lease(request_id,observation_hash,deadline)
            if 'artifacts' not in value or json_bytes(value['artifacts'])!=json_bytes(artifacts):
                raise ValueError('Terminal delivery artifact projection differs from original lease')
            lease_hash=checksum(json_bytes(lease));receipt_hash=checksum(json_bytes(receipt))
        elif 'artifacts' in value:
            raise ValueError('Failed or canceled terminal delivery cannot invent artifacts')
        return {'format':FORMAT,'binding':{'installationId':self.reader.dispatch.runtime.installation['installationId'],
            'targetId':self.reader.dispatch.target,'requestId':request_id,'eventKey':EVENT,
            'jobReference':entry.job_reference,'originalStartContext':entry.started_context,
            'originalApplicationJob':original['applicationJob'],'originalDispatchSha256':original['payloadSha256'],
            'observationSha256':observation_hash,'originalTaskUuid':engine['taskUuid'],
            'leaseSha256':lease_hash,'leaseReceiptSha256':receipt_hash},
            'callbackUrl':entry.request['callbackUrl'],'credentialReference':self.credential_reference,
            'bodyText':raw.decode(),'bodyBytes':len(raw),'bodySha256':checksum(raw),
            'callbackId':value['callbackId'],'status':value['status'],
            'publicationPermission':False,'applicationAcceptanceVerification':'unassessed'}

    def _authorize(self,command,deadline):
        self._check(command['binding']['requestId'],deadline)
        allowed=self.authority(command['binding'],TERMINAL,deadline,
            owned=lambda:self.reader.dispatch.runtime._owned,callback=parse(command['bodyText'].encode(),BODY_LIMIT))
        if allowed is not True:
            raise PermissionError('Terminal delivery current original actor refused')
        self._check(command['binding']['requestId'],deadline)


    def _transport_bound(self,raw):
        allowance=getattr(self.transport,'max_body',BODY_LIMIT)
        if type(allowance) is not int or allowance<=0 or type(raw) is not bytes or len(raw)>allowance:
            raise ValueError('Terminal delivery body exceeds its actual transport allowance')

    def _before_transport(self,command,deadline):
        self._check(command['binding']['requestId'],deadline)
        self._transport_bound(command['bodyText'].encode())

    def _access(self,request_id,deadline):
        root=self.folder(request_id,EVENT)
        command=self._load(request_id,EVENT,root,deadline)
        self._authorize(command,deadline)

    def prepare(self,request_id,observation_hash,raw):
        """Save the original complete body after observation and scoped access."""
        deadline=time.monotonic()+self.timeout
        root=self.folder(request_id,EVENT)
        command=self._command(request_id,EVENT,raw,deadline,observation_hash=observation_hash)
        self._authorize(command,deadline)
        try:root.mkdir(mode=0o700)
        except FileExistsError:pass
        else:synchronize(root.parent)
        private(root,True)
        with writer(root,deadline):
            clear_unpublished(root)
            exists=(root/'command.json').exists() or (root/'command.json').is_symlink()
            if not exists and any(path.name not in ('writer.lock','context.json') for path in root.iterdir()):
                raise ValueError('Terminal delivery records require their original command')
            if not exists:self._transport_bound(raw)
            if not exists and command['status']=='succeeded':
                self._lease(request_id,observation_hash,deadline,live=True)
            self._authorize(command,deadline)
            publish(root,'context.json',json_bytes({'observationSha256':observation_hash}))
            publish(root,'command.json',json_bytes(command))
            self._authorize(command,deadline)
            return self._load(request_id,EVENT,root,deadline)

    def advance(self,request_id,event_key=EVENT,*,expected_command_sha256=None):
        result=super().advance(request_id,event_key,expected_command_sha256=expected_command_sha256)
        return {**result,'applicationAcceptanceVerification':'unassessed'}

    def historical_receiver_receipt(self,request_id):
        """Read retained receiver facts without authorizing another callback."""
        deadline=time.monotonic()+self.timeout
        self._check(request_id,deadline)
        root=self.folder(request_id,EVENT)
        private(root,True)
        with writer(root,deadline):
            command=self._load(request_id,EVENT,root,deadline)
            command_hash=checksum(json_bytes(command))
            attempts=sorted(path.name for path in root.iterdir() if path.name.startswith('attempt-'))
            if attempts!=[f'attempt-{index:06d}.json' for index in range(len(attempts))]:
                raise ValueError('Terminal historical attempt sequence differs')
            replies={path.name for path in root.iterdir() if path.name.startswith('reply-')}
            if not replies<={f'reply-{index:06d}.json' for index in range(len(attempts))}:
                raise ValueError('Terminal historical reply requires its original attempt')
            selected=None
            for index,name in enumerate(attempts):
                intent=read_json(root,name)
                if json_bytes(intent)!=json_bytes({'format':self.record_format,
                        'commandSha256':command_hash,'attempt':index}):
                    raise ValueError('Terminal historical attempt binding differs')
                reply_name=f'reply-{index:06d}.json'
                if reply_name in replies:
                    reply=read_json(root,reply_name)
                    self._validate_reply(reply,command_hash,index)
                    state=self._result(reply,command)
                    if selected is None or selected['historicalReceiverOutcome']=='retry_pending':
                        selected={'historicalReceiverOutcome':state,'attempt':index,'receiverReply':reply}
            self._check(request_id,deadline)
            return {**(selected or {'historicalReceiverOutcome':'no_retained_reply'}),
                'commandSha256':command_hash,'currentAccess':'unassessed',
                'transportPermission':False,'publicationPermission':False,
                'applicationAcceptanceVerification':'unassessed'}

    @staticmethod
    def _result(reply,command=None):
        if 400<=reply['status']<500:return 'refused'
        if 200<=reply['status']<300:
            try:body=parse(base64.b64decode(reply['bodyBase64'],validate=True),REPLY_LIMIT)
            except ValueError:return 'retry_pending'
            if isinstance(body,dict) and body.get('ok') is True:
                if 'ignored' in body:
                    return 'receiver_ignored' if body['ignored'] in ('terminal','superseded') else 'retry_pending'
                if command is not None and body.get('status')==command['status']:return 'acknowledged'
        return 'retry_pending'

    def prepare_original(self,request_id,observation_hash,*,message=None):
        """Recover the saved body, or freeze one identity for reported completion."""
        deadline=time.monotonic()+self.timeout
        root=self.folder(request_id,EVENT)
        if (root/'command.json').exists() or (root/'command.json').is_symlink():
            command=self._load(request_id,EVENT,root,deadline)
            if command['binding']['observationSha256']!=observation_hash:
                raise ValueError('Terminal delivery cannot substitute another observation')
            self._authorize(command,deadline)
            return command
        entry=self._check(request_id,deadline)
        _root,_engine,observed=self._observation(request_id,observation_hash,deadline)
        status=next((name for name,pair in STATES.items()
            if (observed['reportedStatusCode'],observed['reportedState'])==pair),None)
        if status is None:raise ValueError('Terminal delivery has no reported terminal observation')
        value={'schemaVersion':entry.request['schemaVersion'],'requestId':request_id,
            'jobReference':entry.job_reference,'callbackId':secrets.token_urlsafe(24),
            'status':status,'occurredAt':datetime.now(timezone.utc).isoformat()}
        if message is not None:value['message']=message
        if status=='succeeded':
            _lease,_receipt,value['artifacts']=self._lease(request_id,observation_hash,deadline,live=True)
        return self.prepare(request_id,observation_hash,json_bytes(value))
