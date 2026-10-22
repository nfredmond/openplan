"""Assemble an explicit original worker graph from sealed operator settings.

Resolvers supply credentials at transport time. This factory starts no server,
worker loop or engine and does not choose the default entry point.
"""
import copy
import time
from pathlib import PurePosixPath
from contextlib import contextmanager

from application_dispatch_http import Transport as ApplicationHttp, DELIVERY_RPC
from application_dispatch_reader import Reader
from application_draft_authority import Authority as DraftAuthority
from application_processing_authority import Authority as CommitAuthority
from application_delivery_authority import Authority as DeliveryAuthority
from draft_http import Transport as DraftHttp
from original_commit_http import Transport as CommitHttp
from progress_http import Transport as CallbackHttp, MAX_BODY_LIMIT
from url_transport import Transport as SourceHttp
from native_engine_attestation import Attestor
from runtime_configuration import Binding, configuration
from retained_source import json_bytes
from runtime_outcome_recovery import Runtime, Recovery
from runtime_dispatch_custody import Custody, Pipeline as Inputs
from runtime_preparation import Preparation, JOB_FIELDS
from runtime_url_intake import Intake as SourceIntake
from runtime_url_draft import Pipeline as SourceDraft
from runtime_draft import Draft
from runtime_commit import Commit
from runtime_observation import Observer
from runtime_output_intake import Intake as OutputIntake
from runtime_products import Products
from runtime_georef import Inspection
from runtime_artifact_plan import ArtifactPlan
from runtime_artifact_access import ArtifactAccess
from runtime_terminal_delivery import Delivery as Terminal
from runtime_running_pipeline import Pipeline, RunningDelivery
from runtime_worker_coordinator import Coordinator
from runtime_execution import Execution
from runtime_artifact_http import Download


class CheckedApplicationHttp(ApplicationHttp):
    def __init__(self,bundle,*args,**kwargs):
        self.bundle=bundle;super().__init__(*args,**kwargs)
    def _check(self,deadline,owned):
        self.bundle._check();super()._check(deadline,owned)


class CheckedSourceHttp(SourceHttp):
    def __init__(self,bundle,*args,**kwargs):
        self.bundle=bundle;super().__init__(*args,**kwargs)
    def _check(self,deadline):
        self.bundle._check();super()._check(deadline)


class CheckedAccess(ArtifactAccess):
    def __init__(self,bundle,*args,**kwargs):
        self.bundle=bundle;super().__init__(*args,**kwargs)

    def _check(self,request_id,deadline):
        self.bundle._check();super()._check(request_id,deadline)


class CheckedDownload(Download):
    def __init__(self,bundle,*args,**kwargs):
        self.bundle=bundle;super().__init__(*args,**kwargs)

    def __call__(self,handler):
        try:
            self.bundle._check()
            if self.access is not self.bundle.access or self.runtime is not self.bundle.runtime:
                raise ValueError('Original assembly download joins changed')
        except (ValueError,OSError,InterruptedError):
            handler.close_connection=True;previous=handler.connection.gettimeout()
            try:
                handler.connection.settimeout(.25)
                handler._send_json(503,{'error':'original_artifact_unavailable'})
            except OSError:pass
            finally:
                try:handler.connection.settimeout(previous)
                except OSError:pass
            return
        return super().__call__(handler)


class Bundle:
    def __init__(self,root,value,*,max_queued,application_credentials,engine_credentials,
                 callback_credentials,options,cancelled=lambda:False):
        callbacks=(application_credentials,engine_credentials,callback_credentials,options,cancelled)
        if not all(callable(item) for item in callbacks):
            raise ValueError('Explicit worker assembly needs credential and option adapters')
        value=configuration(value)
        self.runtime=Runtime(root,value['installationId'],max_queued=max_queued,pipeline=lambda _:None)
        self.binding=Binding(self.runtime,value)
        # Validate the supported native profile before creating an operator seal.
        self.native_attest=Attestor(value['engine'],value['daemonSocket'],value['daemonUid'])
        self.attest=self._attest
        self.cancelled=cancelled;self.options=options
        self._transport_cancel=self._cancelled
        self.application_credentials=application_credentials;self.engine_credentials=engine_credentials
        self.callback_credentials=callback_credentials
        timeout=value['bounds']['timeoutSeconds'];bounds=value['bounds']
        self.dispatch=Custody(self.runtime,value['targetId'],timeout=timeout)
        def application(rpc):
            return CheckedApplicationHttp(self,value['applicationEndpoint'],value['applicationCredentialReference'],
                application_credentials,cancelled=self._transport_cancel,allow_http=value['allowApplicationHttp'],rpc=rpc)
        self.application_http=application('read_aerial_original_dispatch')
        self.delivery_http=application(DELIVERY_RPC)
        self.reader=Reader(self.dispatch,self.application_http,timeout=timeout)
        authority=DeliveryAuthority(self.dispatch,self.delivery_http,timeout=timeout)
        policy=value['sourcePolicy']
        source=CheckedSourceHttp(self,cancelled=self._transport_cancel,allowed_networks=policy['allowedNetworks'],
            allowed_ports=policy['allowedPorts'],max_redirects=policy['maxRedirects'])
        self.source_http=source
        draft_http=DraftHttp(value['engine'],engine_credentials,self._transport_cancel)
        self.draft_http=draft_http
        def draft_transport(engine,command,stream,deadline):
            self._check();return draft_http(engine,command,stream,deadline)
        intake=SourceIntake(self.runtime,value['sourceRoot'],value['targetId'],self._settings,
            source,timeout=timeout,cancelled=self._transport_cancel)
        self.draft_authority=DraftAuthority(self.reader,value['engine'],self.attest)
        original=SourceDraft(intake,self.draft_authority,
            draft_transport,timeout=timeout,authorize_with_deadline=True)
        inputs=Inputs(original,self.dispatch,self.reader.capture,capture_with_deadline=True)
        preparation=Preparation(self.runtime,lambda entry:original._inputs(entry,time.monotonic()+timeout),timeout=timeout)
        draft=Draft(preparation,original.authorize,draft_transport,timeout=timeout,authorize_with_deadline=True)
        def commit_transport(plan,deadline,*,owned):
            self._check()
            transport=CommitHttp(plan,engine_credentials,
                lambda engine,end:self.attest(engine,end,owned=owned),cancelled=self._transport_cancel)
            return transport(plan,deadline,owned=owned)
        self.commit_authority=CommitAuthority(self.reader,value['engine'],self.attest)
        commit=Commit(draft,self.commit_authority,commit_transport,timeout=timeout)
        observer=Observer(self.reader,engine_credentials,self.attest,timeout=timeout,cancelled=self._transport_cancel)
        output=OutputIntake(observer,max_archive_bytes=bounds['archiveMaxBytes'],
            max_expanded_bytes=bounds['expandedMaxBytes'],max_entries=bounds['archiveMaxEntries'],
            max_directory_bytes=bounds['archiveMaxDirectoryBytes'],timeout=timeout,cancelled=self._transport_cancel)
        plan=ArtifactPlan(Inspection(Products(output,timeout=timeout),timeout=timeout),timeout=timeout)
        self.access=CheckedAccess(self,plan,authority,timeout=timeout)
        def callback(url,reference,body,deadline,*,owned):
            self._check()
            if reference!=value['callbackCredentialReference']:
                raise ValueError('Original assembly callback credential reference differs')
            policy=value['callbackPolicy']
            transport=CallbackHttp(url,reference,callback_credentials,cancelled=self._transport_cancel,max_body_bytes=MAX_BODY_LIMIT,
                allowed_networks=policy['allowedNetworks'],allowed_ports=policy['allowedPorts'])
            return transport(url,reference,body,deadline,owned=owned)
        callback.max_body=MAX_BODY_LIMIT
        terminal=Terminal(observer,authority,callback,value['callbackCredentialReference'],access=self.access,
            timeout=timeout,cancelled=self._transport_cancel)
        coordinator=Coordinator(observer,plan,self.access,terminal,public_base_url=value['publicBaseUrl'],
            lease_seconds=bounds['leaseSeconds'],timeout=timeout)
        progress=RunningDelivery(self.reader,callback,value['callbackCredentialReference'],timeout=timeout,cancelled=self._transport_cancel)
        self.pipeline=Pipeline(inputs,commit,coordinator,progress)
        self.runtime.pipeline=self.pipeline
        self.recovery=Recovery(self.pipeline,timeout=timeout)
        self.execution=Execution(self.pipeline,self.recovery)
        self.download=CheckedDownload(self,self.access,timeout=timeout)
        self._original=self._components()
        self._original_settings=json_bytes(self._settings_state())
        self.binding.establish()

    def _components(self):
        return (self.runtime,self.binding,self.execution,self.download,self.dispatch,self.reader,
                self.access,self.access.authorize,self.pipeline,self.recovery,self.attest,self.native_attest,self.options,self.cancelled,
                self.application_credentials,self.engine_credentials,self.callback_credentials,
                self.application_http,self.delivery_http,self.reader.transport,self.source_http,self.draft_http,self._transport_cancel,
                self.pipeline.inputs.pipeline.intake.fetch,self.pipeline.inputs.pipeline.intake.supply,
                self.pipeline.inputs.pipeline.transport,self.pipeline.commit.transport,
                self.pipeline.coordinator.delivery.authority.transport,self.pipeline.coordinator.delivery.transport,
                self.pipeline.progress.transport,self.pipeline.coordinator.observer.resolve,self.pipeline.coordinator.observer.attest,
                self.draft_authority,self.commit_authority,self.pipeline.inputs.pipeline.authorize,
                self.pipeline.commit.authorize,self.pipeline.commit.draft.authorize,
                self.draft_authority.reader,self.draft_authority.attest,self.commit_authority.reader,self.commit_authority.attest)

    def _settings_state(self):
        inputs=self.pipeline.inputs;commit=self.pipeline.commit;c=self.pipeline.coordinator
        output=c.plan.inspection.products.intake
        stages=(self.dispatch,self.dispatch.validation,self.reader,inputs.pipeline,inputs.pipeline.intake,
                inputs.pipeline.intake.validation,commit,commit.draft,commit.draft.preparation,c,c.observer,
                output,c.plan.inspection.products,c.plan.inspection,c.plan,c.access,c.delivery,
                c.delivery.authority,self.pipeline.progress,self.recovery,self.download)
        return {'sourceRoot':str(inputs.pipeline.intake.source_root),'targetId':inputs.pipeline.intake.target,
                'outputLimits':output.limits,'publicBaseUrl':c.base,'leaseSeconds':c.lease_seconds,
                'timeouts':[stage.timeout for stage in stages],
                'maxQueued':self.runtime.max_queued,'writeTimeout':self.download.write_timeout,
                'callbackAttempts':[c.delivery.max_attempts,self.pipeline.progress.max_attempts],
                'applicationResponseBounds':[self.application_http.max_response,self.delivery_http.max_response],
                'authorityEngines':[self.draft_authority.engine,self.commit_authority.engine]}

    def _check(self):
        if any(current is not original for current,original in zip(self._components(),self._original)):
            raise ValueError('Original assembly components changed')
        self.binding.check();self.execution._check()
        if json_bytes(self._settings_state())!=self._original_settings:
            raise ValueError('Original assembly persistent settings changed')
        value=self.binding.value
        for transport,rpc in ((self.application_http,'read_aerial_original_dispatch'),(self.delivery_http,DELIVERY_RPC)):
            if (transport.url!=value['applicationEndpoint'] or transport.reference!=value['applicationCredentialReference']
                    or transport.resolve is not self.application_credentials or transport.rpc!=rpc
                    or transport.allow_http is not value['allowApplicationHttp'] or transport.cancelled is not self._transport_cancel):
                raise ValueError('Original assembly application transport settings changed')
        policy=value['sourcePolicy']
        if ([str(net) for net in self.source_http.networks]!=policy['allowedNetworks']
                or list(self.source_http.ports)!=policy['allowedPorts']
                or self.source_http.max_redirects!=policy['maxRedirects'] or self.source_http.ca_file is not None
                or self.source_http.cancelled is not self._transport_cancel):
            raise ValueError('Original assembly source transport settings changed')
        if (self.draft_http.credentials is not self.engine_credentials or json_bytes(self.draft_http.engine)!=json_bytes(value['engine'])
                or self.draft_http.cancelled is not self._transport_cancel):
            raise ValueError('Original assembly draft transport settings changed')
        if (json_bytes(self.native_attest.engine)!=json_bytes(value['engine'])
                or self.native_attest.socket_path!=value['daemonSocket'] or self.native_attest.daemon_uid!=value['daemonUid']):
            raise ValueError('Original assembly native attestation settings changed')

    def _attest(self,engine,deadline,*,owned):
        self._check()
        def active():
            decision=owned()
            if type(decision) is not bool:raise ValueError('Original assembly attestation ownership must be boolean')
            return decision and not self._cancelled()
        return self.native_attest(engine,deadline,owned=active)

    def _cancelled(self):
        self._check();decision=self.cancelled()
        if type(decision) is not bool:raise ValueError('Original assembly cancellation must be boolean')
        return decision

    def _settings(self,entry):
        self._check();value=self.binding.value;bounds=value['bounds']
        receipt=self.dispatch.load(entry.request['requestId'])
        names=None
        if entry.request['imagery']['type']=='photo_manifest':
            names=[]
            for index,photo in enumerate(entry.request['imagery']['photos']):
                extension=PurePosixPath(photo['filename']).suffix.lower()
                if extension not in ('.jpg','.jpeg','.png','.tif','.tiff'):
                    raise ValueError('Original assembly photo extension is unsupported')
                names.append('image-'+str(index).zfill(5)+extension)
        return {'applicationJob':{key:receipt['applicationJob'][key] for key in JOB_FIELDS},
            'targetId':value['targetId'],'maxBytes':bounds['sourceMaxBytes'],'engine':copy.deepcopy(value['engine']),
            'options':copy.deepcopy(self.options(copy.deepcopy(entry.request))), 'filenames':names,
            'zipLimits':{'max_expanded_bytes':bounds['expandedMaxBytes'],'max_entries':bounds['archiveMaxEntries'],
                         'max_directory_bytes':bounds['archiveMaxDirectoryBytes']} if names is None else None}

    @contextmanager
    def owner(self):
        with self.runtime.owner():
            self._check();yield self;self._check()

    def submit(self,request):
        self._check();result=self.runtime.submit(request);self._check();return result

    def step(self):
        self._check();result=self.execution.step();self._check();return result
