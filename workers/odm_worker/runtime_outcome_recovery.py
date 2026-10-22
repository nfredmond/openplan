"""Recover a factless local outcome through its saved original terminal command.

The old outcome stays immutable. A separate receipt binds its exact bytes to
the original observation, commit and acknowledged terminal delivery. This
explicit adapter is not selected by the default worker.
"""
import hashlib
import time

from admission_journal import private, synchronize
from engine_effects import same
from retained_output_archive import clear_unpublished
from retained_source import json_bytes, publish, reader, writer
from runtime_admission import Runtime as Admissions, OUTCOME
from runtime_original_pipeline import Pipeline
from runtime_progress_delivery import parse

FORMAT='openplan.odm-original-outcome-recovery.v1'
BOUND=1024*1024
STATES={30:'failed',40:'succeeded',50:'canceled'}
LIMITS={'applicationAcceptanceVerification':'unassessed','publicationPermission':False}


def checksum(raw):
    return hashlib.sha256(raw).hexdigest()


class Runtime(Admissions):
    """Read registered recovery while this process holds the lifetime owner.

    Administrative callers use the owner's status endpoint or acquire ownership
    after the worker stops. The base runtime's original-record reader is unchanged.
    """
    recovery=None

    def _outcome(self,entry):
        if not self._owned:raise ValueError('Outcome recovery reads require its lifetime owner')
        original=super()._outcome(entry)
        path=self.root/('outcome-recovery-'+checksum(entry.request['requestId'].encode()))/'record.json'
        if not path.exists() and not path.is_symlink():return original
        if self.recovery is None:
            raise ValueError('Outcome recovery needs its registered original adapter')
        return self.recovery.load(entry,original)

    def status(self):
        if not self._owned:raise ValueError('Outcome recovery status requires its lifetime owner')
        return super().status()


class Recovery:
    def __init__(self,pipeline,*,timeout=120):
        if (not isinstance(pipeline,Pipeline) or not isinstance(pipeline.runtime,Runtime)
                or pipeline.runtime.recovery is not None):
            raise ValueError('Outcome recovery needs one original runtime and pipeline')
        if type(timeout) not in (int,float) or not 0<timeout<float('inf'):
            raise ValueError('Outcome recovery needs a finite positive deadline')
        self.pipeline=pipeline;self.runtime=pipeline.runtime;self.timeout=timeout
        self.runtime.recovery=self

    def folder(self,request):
        return self.runtime.root/('outcome-recovery-'+checksum(request.encode()))

    def _legacy(self,entry,original,deadline):
        self.pipeline.inputs.dispatch._check(entry.request['requestId'],deadline)
        if original is None or original['reportedEngineTerminal'] is not None:
            raise ValueError('Outcome recovery requires its unresolved original local outcome')
        with reader(self.runtime.root,self.runtime._name(entry)) as (stream,info):
            if info.st_size>BOUND:raise ValueError('Original outcome exceeds recovery bound')
            raw=stream.read(BOUND+1)
            if len(raw)!=info.st_size or not same(parse(raw,BOUND),original):
                raise ValueError('Original outcome changes during recovery')
        return checksum(raw)

    def _evidence(self,entry,original,deadline,*,acknowledged):
        request=entry.request['requestId'];old_hash=self._legacy(entry,original,deadline)
        delivery=self.pipeline.coordinator.delivery;root=delivery.folder(request)
        if not (root/'command.json').exists() and not (root/'command.json').is_symlink():
            raise ValueError('Outcome recovery requires its saved original terminal command')
        command=delivery._load(request,'terminal',root,deadline)
        _root,engine,observed=delivery._observation(request,command['binding']['observationSha256'],deadline)
        reported=self.pipeline.coordinator.reported(observed,engine)
        snapshot=self.pipeline._commit_scope(request)
        if any(row['state']!='acknowledged' for row in snapshot['commands']):
            raise ValueError('Outcome recovery requires its acknowledged original commit')
        receipt=delivery.historical_receiver_receipt(request)
        if acknowledged and receipt['historicalReceiverOutcome']!='acknowledged':
            raise ValueError('Outcome recovery requires acknowledged original delivery')
        code=reported['reportedStatusCode'];binding=self.runtime._binding(entry)
        recovered={'format':OUTCOME,'binding':binding,'state':STATES[code],
            'reportedEngineTerminal':{'taskUuid':reported['originalTaskUuid'],'statusCode':code},
            'callbackDeliveryVerification':'unassessed','sourceCustodyVerification':'unassessed',
            'engineCustodyVerification':'unassessed'}
        return {'format':FORMAT,'binding':binding,'originalOutcomeSha256':old_hash,
            'terminalCommandSha256':checksum(json_bytes(command)),
            'terminalReplySha256':checksum(json_bytes(receipt.get('receiverReply'))),
            'historicalReceiverOutcome':receipt['historicalReceiverOutcome'],
            'reportedEngine':reported,'recoveredOutcome':recovered,**LIMITS}

    def load(self,entry,original):
        deadline=time.monotonic()+self.timeout;root=self.folder(entry.request['requestId'])
        private(root,True)
        with reader(root,'record.json') as (stream,info):
            if info.st_size>BOUND:raise ValueError('Outcome recovery receipt exceeds bound')
            raw=stream.read(BOUND+1)
            if len(raw)!=info.st_size:raise ValueError('Outcome recovery receipt length differs')
            saved=parse(raw,BOUND)
        expected=self._evidence(entry,original,deadline,acknowledged=True)
        if not same(saved,expected):raise ValueError('Outcome recovery receipt differs from original evidence')
        return expected['recoveredOutcome']

    def resume_one(self):
        """Retry only a saved terminal command, then retain separate recovery."""
        if self.runtime.pipeline is not self.pipeline or self.runtime.recovery is not self:
            raise ValueError('Outcome recovery requires its registered original pipeline')
        if not self.runtime._owned:raise ValueError('Outcome recovery requires its lifetime owner')
        if not self.runtime._execution.acquire(blocking=False):return False
        try:
            entry=next((entry for entry in self.runtime.journal.started()
                if (result:=self.runtime._outcome(entry)) is None or result['reportedEngineTerminal'] is None),None)
            if entry is None:return False
            original=Admissions._outcome(self.runtime,entry)
            if original is None:return False
            deadline=time.monotonic()+self.timeout
            before=self._evidence(entry,original,deadline,acknowledged=False)
            if before['historicalReceiverOutcome']!='acknowledged':
                try:
                    delivered=self.pipeline.coordinator.delivery.advance(entry.request['requestId'],
                        expected_command_sha256=before['terminalCommandSha256'])
                except (PermissionError,OSError,TimeoutError,InterruptedError) as error:
                    self.pipeline._entry(entry.request['requestId'])
                    self.pipeline.coordinator._failure(entry.request['requestId'],
                        'outcome_recovery',error,before['reportedEngine'])
                    return True
                if delivered['state']!='acknowledged':return True
            expected=self._evidence(entry,original,deadline,acknowledged=True)
            if before['originalOutcomeSha256']!=expected['originalOutcomeSha256']:
                raise ValueError('Original outcome changes before recovery publication')
            if (before['terminalCommandSha256']!=expected['terminalCommandSha256']
                    or not same(before['recoveredOutcome'],expected['recoveredOutcome'])):
                raise ValueError('Original terminal facts change before recovery publication')
            root=self.folder(entry.request['requestId'])
            try:root.mkdir(mode=0o700)
            except FileExistsError:pass
            else:synchronize(root.parent)
            private(root,True)
            with writer(root,deadline):
                clear_unpublished(root)
                if not (root/'record.json').exists() and any(p.name!='writer.lock' for p in root.iterdir()):
                    raise ValueError('Outcome recovery has unknown pre-receipt records')
                if self._legacy(entry,original,deadline)!=expected['originalOutcomeSha256']:
                    raise ValueError('Original outcome changes at recovery publication')
                publish(root,'record.json',json_bytes(expected))
                self.load(entry,original)
            return True
        finally:self.runtime._execution.release()
