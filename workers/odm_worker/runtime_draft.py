"""Owned original draft sequencing with explicit caller-supplied permission.

Adapters remain responsible for live authority, engine custody and actual request
cancellation. This bridge issues no processing commit or terminal callback.
"""
import copy
import hashlib
import math
import time

from admission_journal import private, synchronize
from engine_effects import Effects
from retained_source import json_bytes, publish, reader, read_json, writer
from runtime_preparation import Preparation

FORMAT = 'openplan.odm-runtime-draft.v1'


class Draft:
    def __init__(self, preparation, authorize, transport, *, timeout=120, authorize_with_deadline=False):
        if not isinstance(preparation, Preparation) or not callable(authorize) or not callable(transport):
            raise ValueError('Original preparation and explicit draft adapters are required')
        if not isinstance(timeout, (int, float)) or isinstance(timeout, bool) or not math.isfinite(timeout) or timeout <= 0:
            raise ValueError('Runtime draft timeout must be positive and finite')
        if type(authorize_with_deadline) is not bool:
            raise ValueError('Draft authorization deadline selection must be boolean')
        self.authorize_with_deadline=authorize_with_deadline
        self.preparation=preparation;self.authorize=authorize;self.transport=transport;self.timeout=timeout

    def _effects(self, request_id, deadline):
        entry=self.preparation._entry(request_id)
        self.preparation.resume(request_id, deadline=deadline)
        spec,context=self.preparation._spec(entry)
        root=self.preparation.runtime.root/('preparation-'+hashlib.sha256(request_id.encode()).hexdigest())
        plan=read_json(root,'plan.json')
        remaining=deadline-time.monotonic()
        if remaining <= 0:raise TimeoutError('Runtime draft deadline exceeded')
        arguments={'journal':self.preparation.runtime.journal,'request_id':request_id,
            'reference':entry.job_reference,'context':context,'source_root':spec['sourceRoot'],
            'sources':spec['sources'],'destination':root/'retained','max_bytes':spec['maxBytes'],'timeout':remaining}
        derivation={'destination':root/'derived',**spec['zipLimits']} if spec['zipLimits'] is not None else None
        original_engine=read_json(root/'engine','plan.json')
        effects=Effects(root/'engine',source_arguments=arguments,engine=spec['engine'],task_uuid=plan['taskUuid'],
            name=entry.request['missionTitle'][:200],options=spec['options'],
            filenames=[row['filename'] for row in original_engine['uploads']],derived_arguments=derivation,timeout=remaining,
            deadline=deadline)
        return effects,root

    @staticmethod
    def _result(effects,state,operation=None):
        return {'format':FORMAT,'state':state,'operation':operation,'taskUuid':effects.plan['taskUuid'],
                'enginePlanSha256':effects.plan_hash,'engineCustodyVerification':'unassessed',
                'callbackDeliveryVerification':'unassessed','commitPermission':False}

    def advance(self, request_id):
        """Issue at most one original init/upload; unresolved prefixes hold."""
        deadline=time.monotonic()+self.timeout
        effects,root=self._effects(request_id,deadline)
        dispatch=root/'draft-dispatch'
        try:dispatch.mkdir(mode=0o700)
        except FileExistsError:pass
        else:synchronize(root)
        private(dispatch,True)
        with writer(dispatch,deadline):
            self.preparation._entry(request_id)
            publish(dispatch,'original-plan.json',json_bytes({'format':FORMAT,'enginePlanSha256':effects.plan_hash,
                    'originalContext':effects.plan['binding']['originalContext'],'commitPermission':False}))
            snapshot=effects.snapshot()
            if snapshot['commands'][-1]['state']!='unissued':
                return self._result(effects,'held_prior_commit')
            pending_seen=False
            for row in snapshot['commands']:
                if row['state']!='acknowledged':pending_seen=True
                elif pending_seen:raise ValueError('Original draft command order differs')
            if any(row['state']=='unresolved' for row in snapshot['commands']):
                return self._result(effects,'held_uncertain')
            pending=next((row['operation'] for row in snapshot['commands'] if row['state']=='unissued'),None)
            if pending is None or pending=='commit':return self._result(effects,'draft_complete_commit_held')
            command=effects.command_map[pending]
            options = {'deadline': deadline} if self.authorize_with_deadline else {}
            if self.authorize(copy.deepcopy(effects.plan),pending,copy.deepcopy(command),**options) is not True:
                raise PermissionError('Explicit draft permission was not confirmed')
            if time.monotonic() >= deadline:raise TimeoutError('Runtime draft deadline exceeded')
            intent,first=effects.issue(pending)
            if first is not True:return self._result(effects,'held_uncertain',pending)
            # Opening a retained file never relies on the caller's source location.
            # Hash the same open descriptor that transport receives, then rewind it.
            if pending.startswith('upload:'):
                descriptor=intent['command']['multipart']
                pack=root/('derived' if effects.plan.get('sourceCustody') is not None else 'retained')
                with reader(pack,descriptor['objectRelativePath']) as (stream,info):
                    if info.st_size!=descriptor['bytes']:
                        raise ValueError('Original draft upload size differs')
                    checksum=hashlib.sha256();size=0
                    while chunk:=stream.read(1024*1024):
                        if time.monotonic()>=deadline:raise TimeoutError('Runtime draft deadline exceeded')
                        checksum.update(chunk);size+=len(chunk)
                    if size!=descriptor['bytes'] or checksum.hexdigest()!=descriptor['sha256']:
                        raise ValueError('Original draft upload hash differs')
                    stream.seek(0)
                    response=self.transport(copy.deepcopy(effects.plan['engine']),copy.deepcopy(intent['command']),stream,deadline)
                    if stream.tell()!=descriptor['bytes']:
                        raise ValueError('Draft transport did not consume the original image')
            else:
                response=self.transport(copy.deepcopy(effects.plan['engine']),copy.deepcopy(intent['command']),None,deadline)
            if time.monotonic()>=deadline:raise TimeoutError('Runtime draft deadline exceeded')
            if type(response) is not tuple or len(response)!=2:
                raise ValueError('Exact draft transport status and body are required')
            effects.save_reply(pending,*response)
            return self._result(effects,'acknowledged',pending)

    def __call__(self, job):
        self.preparation(job)
        result=self.advance(job['request']['requestId'])
        job['draft']=result;job['state']='draft_pending'
