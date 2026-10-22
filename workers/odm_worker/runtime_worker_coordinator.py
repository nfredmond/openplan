"""Advance one retained original task through explicit delivery adapters.

This post-commit coordinator does not enable admission, engine dispatch or the
default worker. Local failures retain their original reported engine facts.
"""
import copy
import hashlib
import re
import time

from admission_journal import private,synchronize
from retained_source import json_bytes,publish,read_json,writer
from retained_task_observation import finite_number
from runtime_artifact_access import ArtifactAccess,base_url
from runtime_artifact_plan import ArtifactPlan
from runtime_observation import Observer
from runtime_terminal_delivery import Delivery,STATES
from runtime_output_intake import FORMAT as INTAKE_FORMAT
from retained_output_archive import FORMAT as ARCHIVE_FORMAT
from runtime_products import FORMAT as PRODUCTS_FORMAT
from runtime_artifact_plan import FORMAT as PLAN_FORMAT
from runtime_artifact_access import FORMAT as ACCESS_FORMAT

FORMAT='openplan.odm-original-worker-coordination.v1'
FAILURE='openplan.odm-private-local-stage-failure.v1'
LIMITS={'publicationPermission':False,'applicationAcceptanceVerification':'unassessed',
        'processingQualityVerification':'unassessed','mapPlacementVerification':'unassessed'}


class Coordinator:
    def __init__(self,observer,plan,access,delivery,*,public_base_url,lease_seconds,
                 timeout=120,clock=time.time):
        if (not isinstance(observer,Observer) or not isinstance(plan,ArtifactPlan)
                or not isinstance(access,ArtifactAccess) or not isinstance(delivery,Delivery)
                or plan.inspection.products.intake.observer is not observer
                or access.plan is not plan or delivery.observer is not observer
                or delivery.access is not access):
            raise ValueError('Worker coordination needs one original adapter graph')
        if (not finite_number(timeout) or timeout<=0 or not finite_number(lease_seconds)
                or lease_seconds<=0 or not callable(clock)):
            raise ValueError('Worker coordination needs finite positive bounds')
        self.observer=observer;self.plan=plan;self.access=access;self.delivery=delivery
        self.dispatch=observer.reader.dispatch;self.timeout=timeout;self.clock=clock
        self.base=base_url(public_base_url);self.lease_seconds=lease_seconds

    @staticmethod
    def reported(observed,engine):
        if observed is None:return None
        return {'originalTaskUuid':engine['taskUuid'],'observationSha256':observed['bodySha256'],
            'reportedStatusCode':observed['reportedStatusCode'],'reportedState':observed['reportedState']}

    def _selection(self,request,deadline):
        """Recover a saved selection before another original task GET is possible."""
        root,engine=self.observer._original(request,deadline)
        original=self.dispatch.load(request,deadline=deadline)
        selections=[]
        output_selected=False;terminal_selected=False
        def select(value):
            if not isinstance(value,str) or not re.fullmatch('[0-9a-f]{64}',value):
                raise ValueError('Worker coordination saved observation hash differs')
            selections.append(value)
        terminal=self.delivery.folder(request)
        for pack,name in [(terminal,'context.json'),*( (root/folder,name) for folder,name in
                [('output-intake','plan.json'),('output-archive','plan.json'),('private-products','plan.json'),
                 ('private-raster-inspection','plan.json'),('private-artifact-plan','manifest.json'),('private-artifact-access','lease.json')])]:
            if pack.exists() or pack.is_symlink():
                private(pack,True)
                selector=pack/name
                if not selector.exists() and not selector.is_symlink() and any(
                        p.name!='writer.lock' and not re.fullmatch(r'\.partial-[0-9a-f]{32}',p.name) for p in pack.iterdir()):
                    raise ValueError('Worker coordination stage records require their original selection')
        if (terminal/'context.json').exists() or (terminal/'context.json').is_symlink():
            terminal_selected=True
            context=read_json(terminal,'context.json')
            if not isinstance(context,dict) or set(context)!={'observationSha256'}:
                raise ValueError('Worker coordination terminal selection differs')
            select(context['observationSha256'])
        for folder,format in [('output-intake',INTAKE_FORMAT),('output-archive',ARCHIVE_FORMAT),('private-products',PRODUCTS_FORMAT)]:
            path=root/folder/'plan.json'
            if path.exists() or path.is_symlink():
                output_selected=True
                saved=read_json(path.parent,path.name)
                if (not isinstance(saved,dict) or saved.get('format')!=format
                        or json_bytes(saved.get('enginePlan'))!=json_bytes(engine)):
                    raise ValueError('Worker coordination saved output selection identity differs')
                if folder=='output-intake':
                    limits=self.plan.inspection.products.intake.limits
                    expected={'format':INTAKE_FORMAT,'enginePlan':engine,
                        'observationSha256':saved.get('observationSha256'),'limits':limits,
                        'maxAttemptObjects':2,'maxAttemptStorageBytes':2*limits['max_archive_bytes']}
                    if json_bytes(saved)!=json_bytes(expected):
                        raise ValueError('Worker coordination original intake selection limits differ')
                select(saved.get('observationSha256'))
        binding={'installationId':self.dispatch.runtime.installation['installationId'],
            'targetId':self.dispatch.target,'requestId':request,'jobReference':original['binding']['jobReference'],
            'originalApplicationJob':original['applicationJob'],'originalDispatchSha256':original['payloadSha256'],
            'originalTaskUuid':engine['taskUuid']}
        for folder,name,format in [('private-artifact-plan','manifest.json',PLAN_FORMAT),('private-artifact-access','lease.json',ACCESS_FORMAT)]:
            path=root/folder/name
            if path.exists() or path.is_symlink():
                output_selected=True
                saved=read_json(path.parent,path.name)
                given=saved.get('binding') if isinstance(saved,dict) else None
                if (not isinstance(saved,dict) or saved.get('format')!=format or not isinstance(given,dict)
                        or set(given)!={*binding,'observationSha256'}
                        or json_bytes({k:given[k] for k in binding})!=json_bytes(binding)):
                    raise ValueError('Worker coordination saved artifact selection identity differs')
                select(given['observationSha256'])
        if len(set(selections))>1:raise ValueError('Worker coordination saved observation selections conflict')
        inspection=root/'private-raster-inspection/plan.json'
        if not selections and (inspection.exists() or inspection.is_symlink()):
            raise ValueError('Worker coordination derived records require original observation selection')
        if selections:
            _root,_engine,observed=self.delivery._observation(request,selections[0],deadline)
            pair=(observed['reportedStatusCode'],observed['reportedState'])
            if output_selected and pair!=(40,'completed'):
                raise ValueError('Worker coordination output selection requires reported completion')
            if terminal_selected and pair not in STATES.values():
                raise ValueError('Worker coordination terminal selection requires reported terminal state')
        return selections[0] if selections else None

    def _failure(self,request,stage,error,reported):
        deadline=time.monotonic()+self.timeout
        entry=self.dispatch._check(request,deadline)
        original=self.dispatch.load(request,deadline=deadline)
        if reported is not None:
            _root,engine,observed=self.delivery._observation(request,reported['observationSha256'],deadline)
            if json_bytes(reported)!=json_bytes(self.reported(observed,engine)):
                raise ValueError('Worker coordination local failure must retain original reported facts')
        value={'format':FAILURE,'scope':'private_original_local_stage_failure',
            'binding':{'installationId':self.dispatch.runtime.installation['installationId'],
                'targetId':self.dispatch.target,'requestId':request,'jobReference':entry.job_reference,
                'originalStartContext':entry.started_context,'originalApplicationJob':original['applicationJob'],
                'originalDispatchSha256':original['payloadSha256']},
            'stage':stage,'errorType':type(error).__name__,'reportedEngine':copy.deepcopy(reported),**LIMITS}
        raw=json_bytes(value);name=hashlib.sha256(raw).hexdigest()+'.json'
        root=self.dispatch.runtime.root/('local-stage-failures-'+hashlib.sha256(request.encode()).hexdigest())
        try:root.mkdir(mode=0o700)
        except FileExistsError:pass
        else:synchronize(self.dispatch.runtime.root)
        private(root,True)
        with writer(root,deadline):
            self.dispatch._check(request,deadline);publish(root,name,raw)
            if json_bytes(read_json(root,name))!=raw:raise ValueError('Worker coordination original failure differs')
        return {'format':FORMAT,'state':'local_stage_failed','stage':stage,'failureSha256':name[:-5],
            'reportedEngine':copy.deepcopy(reported),**LIMITS}

    def advance(self,request,observation_hash=None):
        """Resume the exact terminal command before considering a new observation."""
        deadline=time.monotonic()+self.timeout
        self.dispatch._check(request,deadline)
        stage='terminal_resume';reported=None
        try:
            terminal=self.delivery.folder(request)
            if (terminal/'command.json').exists() or (terminal/'command.json').is_symlink():
                command=self.delivery._load(request,'terminal',terminal,deadline)
                original_hash=command['binding']['observationSha256']
                _root,engine,observed=self.delivery._observation(request,original_hash,deadline)
                reported=self.reported(observed,engine)
                if observation_hash is not None and observation_hash!=original_hash:
                    raise ValueError('Worker coordination cannot replace terminal observation')
            else:
                stage='observation_selection'
                selected=self._selection(request,deadline)
                if selected is not None:
                    _root,engine,observed=self.delivery._observation(request,selected,deadline)
                    reported=self.reported(observed,engine)
                    if observation_hash is not None and observation_hash!=selected:
                        raise ValueError('Worker coordination cannot replace saved observation')
                    observation_hash=selected
                stage='observation'
                if observation_hash is None:observation_hash=self.observer.observe(request)['task']['bodySha256']
                root,engine,observed=self.delivery._observation(request,observation_hash,deadline)
                reported=self.reported(observed,engine)
                status=next((name for name,pair in STATES.items()
                    if (observed['reportedStatusCode'],observed['reportedState'])==pair),None)
                if status is None:return {'format':FORMAT,'state':'processing_pending','reportedEngine':reported,**LIMITS}
                if status=='succeeded':
                    stage='products';self.plan.advance(request,observation_hash)
                    stage='artifact_access'
                    pack=root/'private-artifact-access'
                    if (pack/'lease.json').exists() or (pack/'lease.json').is_symlink():
                        self.access.resume(request,observation_hash)
                    else:
                        now=self.clock()
                        if not finite_number(now):raise ValueError('Worker coordination clock must be finite')
                        self.access.prepare(request,observation_hash,public_base_url=self.base,
                            expires_at=now+self.lease_seconds)
                stage='terminal_prepare';self.delivery.prepare_original(request,observation_hash)
            stage='terminal_delivery';delivered=self.delivery.advance(request)
            return {'format':FORMAT,'state':delivered['state'],'reportedEngine':reported,
                'delivery':copy.deepcopy(delivered),**LIMITS}
        except (PermissionError,ValueError,OSError,TimeoutError,InterruptedError) as error:
            return self._failure(request,stage,error,reported)
