"""Connect original retained inputs and one commit to explicit task delivery.

This supplied adapter does not enable the default worker. Uncertain commits
remain held and cannot obtain another POST or a terminal callback.
"""
import copy
import time

from retained_source import json_bytes,publish
from runtime_admission import OUTCOME
from engine_effects import same
from runtime_commit import Commit
from runtime_dispatch_custody import Pipeline as Inputs
from runtime_worker_coordinator import Coordinator,LIMITS

FORMAT='openplan.odm-original-pipeline.v1'
TERMINAL={30:'failed',40:'succeeded',50:'canceled'}


class Pipeline:
    def __init__(self,inputs,commit,coordinator):
        if (not isinstance(inputs,Inputs) or not isinstance(commit,Commit)
                or not isinstance(coordinator,Coordinator)
                or inputs.dispatch is not coordinator.dispatch
                or commit.draft.preparation.runtime is not inputs.dispatch.runtime):
            raise ValueError('Original pipeline needs one owned adapter graph')
        self.inputs=inputs;self.commit=commit;self.coordinator=coordinator
        self.runtime=inputs.dispatch.runtime

    def _entry(self,request):
        return self.inputs.dispatch._check(request,time.monotonic()+self.inputs.dispatch.timeout)

    def _commit_scope(self,request):
        deadline=time.monotonic()+min(self.commit.timeout,self.coordinator.timeout)
        root,original=self.coordinator.observer._original(request,deadline)
        effects,prepared=self.commit.draft._effects(request,deadline)
        if root!=prepared or not same(original,effects.plan):
            raise ValueError('Original pipeline commit and observation plans differ')
        return effects.snapshot(deadline=deadline)

    def advance(self,request):
        """Advance one draft operation, then one original commit and delivery."""
        self._entry(request)
        stage='inputs';reported=None
        try:
            terminal=self.coordinator.delivery.folder(request)/'command.json'
            if terminal.exists() or terminal.is_symlink():
                stage='terminal_original'
                deadline=time.monotonic()+self.coordinator.timeout
                command=self.coordinator.delivery._load(request,'terminal',terminal.parent,deadline)
                _root,engine,observed=self.coordinator.delivery._observation(request,command['binding']['observationSha256'],deadline)
                reported=self.coordinator.reported(observed,engine)
                stage='commit_replay'
                snapshot=self._commit_scope(request)
                if any(row['state']!='acknowledged' for row in snapshot['commands']):
                    raise ValueError('Original terminal recovery requires its acknowledged commit')
                stage='coordination';result=self.coordinator.advance(request)
                return {'format':FORMAT,'state':result['state'],'coordination':result,**LIMITS}
            prepared=self.inputs.advance(request)
            self._entry(request)
            if prepared['draft']['state'] not in ('draft_complete_commit_held','held_prior_commit'):
                return {'format':FORMAT,'state':'draft_pending','inputs':copy.deepcopy(prepared),**LIMITS}
            stage='commit_scope';self._commit_scope(request)
            stage='commit';committed=self.commit.advance(request)
            self._entry(request)
            if committed['state']!='commit_reply_retained':
                return {'format':FORMAT,'state':'processing_held','commit':committed,**LIMITS}
            stage='coordination';result=self.coordinator.advance(request)
            return {'format':FORMAT,'state':result['state'],'commit':committed,
                'coordination':result,**LIMITS}
        except (PermissionError,ValueError,OSError,TimeoutError,InterruptedError) as error:
            self._entry(request)
            receipt=self.inputs.dispatch.folder(request)/'receipt.json'
            if not receipt.exists() and not receipt.is_symlink():raise
            failure=self.coordinator._failure(request,stage,error,reported)
            return {'format':FORMAT,'state':failure['state'],'localFailure':failure,**LIMITS}

    def __call__(self,job):
        if not isinstance(job,dict) or not isinstance(job.get('request'),dict):
            raise ValueError('Original pipeline needs its original job request')
        request=job['request'].get('requestId');entry=self._entry(request)
        if not same(job['request'],entry.request) or job.get('job_reference')!=entry.job_reference:
            raise ValueError('Original pipeline job identity differs')
        result=self.advance(request)
        self._entry(request)
        job['originalPipeline']=result
        delivered=result.get('coordination')
        if delivered is not None and delivered['state']=='acknowledged':
            original=delivered['reportedEngine'];code=original['reportedStatusCode']
            if code not in TERMINAL:raise ValueError('Original pipeline acknowledged terminal state differs')
            job['state']=TERMINAL[code]
            job['reportedEngineTerminal']={'taskUuid':original['originalTaskUuid'],'statusCode':code}
        else:
            job['state']=result['state']

    def resume_one(self):
        """Resume one held original start under the existing execution lock."""
        if self.runtime.pipeline is not self:
            raise ValueError('Original recovery requires the registered pipeline')
        if not self.runtime._owned:
            raise ValueError('Original recovery requires its lifetime owner')
        if not self.runtime._execution.acquire(blocking=False):return False
        try:
            self.runtime._check()
            pending=next((entry for entry in self.runtime.journal.started()
                if (result:=self.runtime._outcome(entry)) is None or result['reportedEngineTerminal'] is None),None)
            if pending is None:return False
            if self.runtime._outcome(pending) is not None:return False
            binding=self.runtime._binding(pending)
            job={'request':copy.deepcopy(pending.request),'job_reference':pending.job_reference,
                'accepted_callback':copy.deepcopy(pending.admission),'state':'accepted'}
            self(job)
            self._entry(pending.request['requestId'])
            if not same(job['request'],pending.request) or job['job_reference']!=pending.job_reference:
                raise ValueError('Original recovery changed its original job identity')
            if job['state'] in TERMINAL.values():
                reported=self.runtime._terminal(job['state'],job.get('reportedEngineTerminal'))
                if reported is None:raise ValueError('Original recovery requires reported engine terminal facts')
                result={'format':OUTCOME,'binding':binding,'state':job['state'],'reportedEngineTerminal':reported,
                    'callbackDeliveryVerification':'unassessed','sourceCustodyVerification':'unassessed',
                    'engineCustodyVerification':'unassessed'}
                publish(self.runtime.root,self.runtime._name(pending),json_bytes(result))
            return True
        finally:self.runtime._execution.release()
