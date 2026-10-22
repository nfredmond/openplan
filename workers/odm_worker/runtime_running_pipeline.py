"""Report one retained original running event before long input work.

Historical acknowledgement skips another event POST. It grants no authority to
start the next source or engine step. The original pipeline checks that step.
"""
import base64
import time

import contract
from retained_source import json_bytes
from runtime_original_pipeline import Pipeline as Original,LIMITS
from runtime_progress_delivery import Delivery,parse,BODY_LIMIT,FIELDS,REPLY_LIMIT
from runtime_terminal_delivery import Delivery as Terminal

FORMAT='openplan.odm-original-running-pipeline.v1'
EVENT='original-worker-running'
MESSAGE='Preparing imagery and recovering saved work.'


class RunningDelivery(Delivery):
    @staticmethod
    def _result(reply,command=None):
        if 400<=reply['status']<500:return 'refused'
        if 200<=reply['status']<300:
            try:body=parse(base64.b64decode(reply['bodyBase64'],validate=True),REPLY_LIMIT)
            except ValueError:return 'retry_pending'
            if isinstance(body,dict) and body.get('ok') is True:
                if body.get('ignored') in ('terminal','superseded'):return 'ignored'
                if 'ignored' not in body and body.get('status')=='running':return 'acknowledged'
        return 'retry_pending'


class Pipeline(Original):
    def __init__(self,inputs,commit,coordinator,progress):
        super().__init__(inputs,commit,coordinator)
        if (not isinstance(progress,RunningDelivery) or isinstance(progress,Terminal)
                or progress.reader is not coordinator.observer.reader):
            raise ValueError('Running pipeline needs its original progress reader')
        self.progress=progress

    def advance(self,request):
        """Recover original terminal first, otherwise acknowledge one running event."""
        self._entry(request)
        terminal=self.coordinator.delivery.folder(request)/'command.json'
        if terminal.exists() or terminal.is_symlink():return super().advance(request)
        try:
            self.inputs.capture_original(request)
            root=self.progress.folder(request,EVENT)
            if (root/'command.json').exists() or (root/'command.json').is_symlink():
                command=self.progress._load(request,EVENT,root,time.monotonic()+self.progress.timeout)
                body=parse(command['bodyText'].encode(),BODY_LIMIT)
                if set(body)!=FIELDS|{'message'} or body['status']!='running' or body['message']!=MESSAGE:
                    raise ValueError('Original running event projection differs')
                historical=self.progress.historical_receiver_receipt(request,EVENT)
                state=historical['historicalReceiverOutcome']
                if state=='acknowledged':
                    self.progress._access(request,time.monotonic()+self.progress.timeout)
                    return super().advance(request)
                if state in ('refused','ignored'):return {'format':FORMAT,'state':'progress_'+state,'historicalProgress':historical,**LIMITS}
            else:
                entry=self._entry(request)
                body=contract.build_callback(entry.request['schemaVersion'],request,entry.job_reference,
                    'running',message=MESSAGE)
                self.progress.prepare(request,EVENT,json_bytes(body))
            delivered=self.progress.advance(request,EVENT)
            if delivered['state']!='acknowledged':
                return {'format':FORMAT,'state':'progress_'+delivered['state'] if delivered['state'] in ('refused','ignored') else 'progress_pending',
                    'progressDelivery':delivered,**LIMITS}
            return super().advance(request)
        except (PermissionError,ValueError,OSError,TimeoutError,InterruptedError) as error:
            self._entry(request)
            receipt=self.inputs.dispatch.folder(request)/'receipt.json'
            if not receipt.exists() and not receipt.is_symlink():raise
            reported=None
            try:
                deadline=time.monotonic()+self.coordinator.timeout
                selected=self.coordinator._selection(request,deadline)
                if selected is not None:
                    _root,engine,observed=self.coordinator.delivery._observation(request,selected,deadline)
                    reported=self.coordinator.reported(observed,engine)
            except (PermissionError,ValueError,OSError,TimeoutError,InterruptedError):pass
            failure=self.coordinator._failure(request,'running_progress',error,reported)
            return {'format':FORMAT,'state':failure['state'],'localFailure':failure,**LIMITS}
