"""Read an original task under current application access and runtime ownership.

This bridge retains private reported metadata. It issues no engine effect or
callback, changes no job state and grants no processing or publication permission.
"""
import copy
import hashlib
import time

from admission_journal import private, synchronize
from application_dispatch_reader import Reader
from draft_custody import original_plan
from engine_effects import same
from original_task_http import Transport
from retained_source import check_time, json_bytes, read_json
from retained_task_observation import Observations, finite_number
from task_observation_cli import SUMMARY_FIELDS
from task_observation import observe
from runtime_preparation import FORMAT as PREPARATION_FORMAT

FORMAT = 'openplan.odm-runtime-observation.v1'


class Observer:
    def __init__(self, reader, resolve, attest, *, timeout=10, cancelled=lambda:False):
        if not isinstance(reader, Reader) or not callable(resolve) or not callable(attest):
            raise ValueError('Private application reader and explicit task adapters are required')
        if not finite_number(timeout) or timeout <= 0:
            raise ValueError('Runtime observation timeout must be positive and finite')
        self.reader = reader
        self.resolve = resolve
        self.attest = attest
        if not callable(cancelled):raise ValueError('Runtime observation needs a cancellation adapter')
        self.cancelled=cancelled
        self.timeout = timeout

    def _original(self, request_id, deadline):
        dispatch = self.reader.dispatch
        entry = dispatch._check(request_id, deadline)
        saved = dispatch.load(request_id, deadline=deadline)
        root = dispatch.runtime.root / ('preparation-' + hashlib.sha256(request_id.encode()).hexdigest())
        private(root, True)
        plan = original_plan(read_json(root / 'engine', 'plan.json'))
        expected = {'requestId': request_id, 'jobReference': entry.job_reference,
            'originalRequest': entry.request, 'originalAdmission': entry.admission,
            'originalContext': saved['context']}
        if not same(plan['binding'], expected):
            raise ValueError('Runtime observation original application binding differs')
        prepared = read_json(root, 'prepared.json')
        preparation = read_json(root, 'plan.json')
        original_scope = {'request': entry.request, 'admission': entry.admission,
                          'jobReference': entry.job_reference, 'context': saved['context']}
        if (not isinstance(prepared, dict) or not isinstance(preparation, dict)
                or prepared.get('format') != PREPARATION_FORMAT
                or prepared.get('state') != 'prepared_locally'
                or preparation.get('format') != PREPARATION_FORMAT
                or not same({key: preparation.get(key) for key in original_scope}, original_scope)
                or prepared.get('planSha256') != hashlib.sha256(json_bytes(preparation)).hexdigest()
                or prepared.get('enginePlanSha256') != hashlib.sha256(json_bytes(plan)).hexdigest()
                or prepared.get('sourceManifestSha256') != plan['sourceManifestSha256']
                or prepared.get('taskUuid') != plan['taskUuid']
                or preparation.get('taskUuid') != plan['taskUuid']
                or not same(preparation.get('engine'), plan['engine'])
                or not same(preparation.get('options'), plan['options'])):
            raise ValueError('Runtime observation prepared runtime record differs')
        dispatch._check(request_id, deadline)
        return root, plan

    def _access(self, request_id, deadline):
        observed = self.reader.observe(request_id, deadline=deadline)
        if observed['authorizedNow'] is not True:
            raise PermissionError('Runtime observation current application access refused')
        self.reader.dispatch._check(request_id, deadline)
        return observed

    def observe(self, request_id):
        """Read at most one exact original reply and leave processing held."""
        deadline = self.reader._deadline(time.monotonic() + self.timeout)
        root, plan = self._original(request_id, deadline)
        self._access(request_id, deadline)
        dispatch = self.reader.dispatch
        owned = lambda: dispatch.runtime._owned
        transport = Transport(plan, self.resolve,
            lambda engine, end: self.attest(engine, end, owned=owned),cancelled=self.cancelled)
        status, body = transport(plan, deadline, owned=owned)
        self._access(request_id, deadline)
        observe(plan, status, body)
        dispatch._check(request_id, deadline)
        records = root / 'task-observations'
        try:
            records.mkdir(mode=0o700)
        except FileExistsError:
            pass
        else:
            synchronize(root)
        private(records, True)
        store = Observations(root / 'engine', plan, records_root=records,
            timeout=max(.001, deadline - time.monotonic()))
        check_time(deadline)
        result = store.record(status, body, deadline=deadline)
        # A later refusal retains any already published private record for recovery.
        final = self._access(request_id, deadline)
        dispatch._check(request_id, deadline)
        check_time(deadline)
        return {'format': FORMAT, 'scope': 'private_original_task_metadata',
            'task': {field: copy.deepcopy(result[field]) for field in SUMMARY_FIELDS},
            'applicationAccessObservedAt': final['authorityObservedAt'],
            'commitPermission': False, 'callbackPermission': False,
            'publicationPermission': False}

    def __call__(self, job):
        if not isinstance(job, dict) or not isinstance(job.get('request'), dict):
            raise ValueError('Runtime observation needs its original job request')
        request_id = job['request'].get('requestId')
        deadline = self.reader._deadline(time.monotonic() + self.timeout)
        entry = self.reader.dispatch._check(request_id, deadline)
        if not same(job['request'], entry.request):
            raise ValueError('Runtime observation job request differs from its original')
        job['taskObservation'] = self.observe(request_id)
