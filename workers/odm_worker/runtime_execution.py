"""Run one original recovery or admission stage with the lifetime owner.

The supplied graph is explicit. This scheduler does not select the default
worker, create credentials or bypass a held original start.
"""
from runtime_running_pipeline import Pipeline
from runtime_dispatch_custody import Pipeline as Inputs
from runtime_worker_coordinator import Coordinator
from runtime_terminal_delivery import Delivery as Terminal
from runtime_outcome_recovery import Runtime, Recovery

FORMAT='openplan.odm-original-execution-step.v1'
LIMITS={'applicationAcceptanceVerification':'unassessed','publicationPermission':False}


class Execution:
    def __init__(self,pipeline,recovery):
        if (not isinstance(pipeline,Pipeline) or not isinstance(recovery,Recovery)
                or not isinstance(pipeline.runtime,Runtime)
                or recovery.pipeline is not pipeline or recovery.runtime is not pipeline.runtime):
            raise ValueError('Original execution needs one running pipeline and outcome recovery')
        self.pipeline=pipeline;self.recovery=recovery;self.runtime=pipeline.runtime
        self._validate()
        self.components=self._components()
        self._graph()

    def _validate(self):
        p=self.pipeline;c=p.coordinator
        if c.dispatch is not c.observer.reader.dispatch or c.delivery.reader is not c.observer.reader:
            raise ValueError('Original execution existing reader join differs')
        # These constructors validate joins without I/O or registration.
        Coordinator(c.observer,c.plan,c.access,c.delivery,public_base_url=c.base,
                    lease_seconds=c.lease_seconds,timeout=c.timeout,clock=c.clock)
        Terminal(c.observer,c.delivery.authority,c.delivery.transport,
                 c.delivery.credential_reference,access=c.delivery.access,
                 timeout=c.delivery.timeout,cancelled=c.delivery.cancelled,
                 max_attempts=c.delivery.max_attempts)
        Inputs(p.inputs.pipeline,p.inputs.dispatch,p.inputs.capture,
               capture_with_deadline=p.inputs.capture_with_deadline)
        Pipeline(p.inputs,p.commit,c,p.progress)

    def _components(self):
        p=self.pipeline;c=p.coordinator
        try:
            return (p.inputs,p.inputs.pipeline,p.inputs.pipeline.intake,p.commit,c,p.progress,p.inputs.dispatch,c.dispatch,
                p.commit.draft,p.commit.draft.preparation,c.observer,c.observer.reader,
                c.observer.reader.dispatch,c.plan,c.plan.inspection,c.plan.inspection.products,
                c.plan.inspection.products.intake,c.access,c.access.dispatch,c.delivery,
                c.delivery.authority,c.delivery.authority.dispatch,c.delivery.reader,p.progress.reader)
        except AttributeError:
            raise ValueError('Original execution component graph differs') from None

    def _graph(self):
        if self.runtime.pipeline is not self.pipeline or self.runtime.recovery is not self.recovery:
            raise ValueError('Original execution requires its registered adapter graph')
        if (self.pipeline.runtime is not self.runtime or self.recovery.runtime is not self.runtime
                or self.recovery.pipeline is not self.pipeline
                or self.pipeline.inputs.dispatch.runtime is not self.runtime
                or self.pipeline.coordinator.dispatch.runtime is not self.runtime):
            raise ValueError('Original execution adapter graph changed')
        if any(current is not saved for current,saved in zip(self._components(),self.components)):
            raise ValueError('Original execution pinned components changed')
        self._validate()

    def _check(self):
        if not self.runtime._owned:
            raise ValueError('Original execution requires its lifetime owner')
        self._graph();self.runtime._check()

    def step(self):
        """Try old-outcome repair, original recovery, then one new admission."""
        self._check()
        for state,operation in [('outcome_recovery_attempted',self.recovery.resume_one),
                ('original_recovery_attempted',self.pipeline.resume_one),
                ('admission_started',self.runtime.run_one)]:
            self._check()
            attempted=operation()
            self._check()
            if type(attempted) is not bool:
                raise ValueError('Original execution stage must return a boolean')
            if attempted:return {'format':FORMAT,'state':state,**LIMITS}
        return {'format':FORMAT,'state':'idle',**LIMITS}
