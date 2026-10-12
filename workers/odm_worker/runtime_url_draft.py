"""Frozen URL inputs and one original draft command, with supplied authorization."""
import hashlib
import math
import time

from admission_journal import encoded
from retained_source import json_bytes, read_json
from runtime_draft import Draft
from runtime_preparation import Preparation
from runtime_url_intake import FORMAT as INTAKE, Intake

FORMAT='openplan.odm-runtime-url-draft.v1'


class Pipeline:
    def __init__(self, intake, authorize, transport, *, timeout=120, authorize_with_deadline=False):
        if not isinstance(intake,Intake) or not callable(authorize) or not callable(transport):
            raise ValueError('Original URL intake and explicit draft adapters are required')
        if type(timeout) not in (int,float) or not math.isfinite(timeout) or timeout<=0:
            raise ValueError('URL draft deadline must be positive and finite')
        if type(authorize_with_deadline) is not bool:
            raise ValueError('URL draft authorization deadline selection must be boolean')
        self.authorize_with_deadline=authorize_with_deadline
        self.intake=intake;self.authorize=authorize;self.transport=transport;self.timeout=timeout

    def _inputs(self, entry, deadline):
        """Read frozen settings and paths, without a new supplier or URL request."""
        original=self.intake._check(entry.request['requestId'],deadline)
        if encoded(entry.request,canonical=True)!=encoded(original.request,canonical=True) or entry.job_reference!=original.job_reference or encoded(entry.admission,canonical=True)!=encoded(original.admission,canonical=True):
            raise ValueError('Original URL draft preparation admission differs')
        name=hashlib.sha256(original.request['requestId'].encode()).hexdigest()
        root=self.intake.runtime.root/('url-intake-'+name)
        saved=read_json(root,'plan.json')
        if not isinstance(saved,dict) or set(saved)!={'format','binding','settings'} or saved['format']!=INTAKE:
            raise ValueError('Original URL draft settings plan differs')
        settings,context=self.intake._settings(original,saved['settings'])
        binding={'request':original.request,'admission':original.admission,
            'jobReference':original.job_reference,'originalContext':context}
        if encoded(saved['binding'],canonical=True)!=encoded(binding,canonical=True):
            raise ValueError('Original URL draft settings binding differs')
        manifest=self.intake._mapping(read_json(root,'sources.json'),hashlib.sha256(json_bytes(saved)).hexdigest(),original,settings,context)
        self.intake._check(original.request['requestId'],deadline)
        return {**settings,'sourceRoot':self.intake.source_root/('request-'+name),
            'sources':[row['objectRelativePath'] for row in manifest['sources']]}

    def _advance(self, request_id, job=None):
        deadline=time.monotonic()+self.timeout;self.intake._check(request_id,deadline)
        # Fresh bounded adapters avoid mutating a shared stage's timeout.
        intake=Intake(self.intake.runtime,self.intake.source_root,self.intake.target,
            self.intake.supply,self.intake.fetch,timeout=min(self.intake.timeout,deadline-time.monotonic()),
            cancelled=lambda:self.intake.cancelled())
        if job is None:prepared=intake.resume(request_id)
        else:intake(job);prepared=job['url_intake']
        self.intake._check(request_id,deadline)
        def authorize(plan,operation,command,**options):
            self.intake._check(request_id,deadline)
            forwarded = {'deadline': min(deadline,options['deadline'])} if self.authorize_with_deadline else {}
            result=self.authorize(plan,operation,command,**forwarded)
            self.intake._check(request_id,deadline);return result
        def transport(engine,command,stream,given_deadline):
            self.intake._check(request_id,deadline)
            result=self.transport(engine,command,stream,min(deadline,given_deadline))
            self.intake._check(request_id,deadline);return result
        preparation=Preparation(self.intake.runtime,lambda entry:self._inputs(entry,deadline),timeout=deadline-time.monotonic())
        draft=Draft(preparation,authorize,transport,timeout=deadline-time.monotonic(),authorize_with_deadline=self.authorize_with_deadline)
        result=draft.advance(request_id);self.intake._check(request_id,deadline)
        return {'format':FORMAT,'preparation':prepared,'draft':result,
            'authorityVerification':'unassessed','commitPermission':False}

    def advance(self, request_id):
        """Verify original intake and advance one command; uncertain work holds."""
        return self._advance(request_id)

    def __call__(self, job):
        result=self._advance(job['request']['requestId'],job)
        job['url_draft']=result;job['draft']=result['draft'];job['state']='draft_pending'
