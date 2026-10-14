"""Exact supplied dispatch bytes and project scope before original URL intake.

Private receipts preserve the supplied original record. They do not establish
that the application produced it or that its actor remains authorized.
"""
import copy
import hashlib
import json
import math
import time

from admission_journal import encoded, private, synchronize
import contract
from retained_source import json_bytes, publish, reader, read_json, writer
from runtime_admission import Runtime
from runtime_preparation import JOB_FIELDS, Preparation, application_context
from runtime_url_draft import Pipeline as UrlDraft
from runtime_url_intake import Intake

FORMAT = 'openplan.odm-original-dispatch.v1'
MAX_BYTES = 32 * 1024 * 1024
ROW_FIELDS = JOB_FIELDS | {'project_id'}


def strict_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result: raise ValueError('Original dispatch JSON has duplicate properties')
        result[key] = value
    return result


class Custody:
    def __init__(self, runtime, target_id, *, timeout=120):
        if not isinstance(runtime, Runtime) or not isinstance(target_id, str) or not target_id.strip() or len(target_id) > 256:
            raise ValueError('Original dispatch runtime and target are required')
        if type(timeout) not in (int, float) or not math.isfinite(timeout) or timeout <= 0:
            raise ValueError('Original dispatch deadline must be positive and finite')
        self.runtime = runtime;self.target = target_id;self.timeout = timeout
        self.validation = Preparation(runtime, lambda entry: None, timeout=timeout)

    def _check(self, request_id, deadline):
        if type(deadline) not in (int, float) or not math.isfinite(deadline):
            raise ValueError('Original dispatch deadline must be finite')
        entry = self.validation._entry(request_id)
        if time.monotonic() >= deadline: raise TimeoutError('Original dispatch deadline exceeded')
        return entry

    def folder(self, request_id):
        return self.runtime.root/('original-dispatch-'+hashlib.sha256(request_id.encode()).hexdigest())

    def _record(self, entry, payload, row):
        if type(payload) is not bytes or not 0 < len(payload) <= MAX_BYTES:
            raise ValueError('Original dispatch byte count differs')
        try:
            text = payload.decode('utf-8')
            request = json.loads(text, object_pairs_hook=strict_object,
                parse_constant=lambda value: (_ for _ in ()).throw(ValueError('Nonfinite dispatch JSON')))
        except (UnicodeError, ValueError, RecursionError):
            raise ValueError('Original dispatch JSON differs') from None
        if contract.validate_processing_request(request):
            raise ValueError('Original dispatch contract differs')
        if encoded(request, canonical=True) != encoded(entry.request, canonical=True):
            raise ValueError('Original dispatch differs from admitted request')
        if not isinstance(row, dict) or set(row) != ROW_FIELDS or row['project_id'] is not None and (not isinstance(row['project_id'], str) or not row['project_id'].strip()):
            raise ValueError('Original dispatch project projection is required')
        projection = {key: row[key] for key in JOB_FIELDS}
        context = application_context(entry, self.runtime.installation['installationId'], self.target, projection)
        external = request['externalRef']
        if external['system'] != 'openplan' or row['project_id'] != external.get('projectId'):
            raise ValueError('Original dispatch project scope differs')
        return {'format': FORMAT, 'binding': {'installationId': self.runtime.installation['installationId'],
            'targetId': self.target, 'originalStartContext': entry.started_context,
            'admission': entry.admission, 'jobReference': entry.job_reference},
            'applicationJob': copy.deepcopy(row), 'context': context, 'payloadText': text,
            'payloadBytes': len(payload), 'payloadSha256': hashlib.sha256(payload).hexdigest(),
            'applicationRecordSha256': hashlib.sha256(json_bytes(row)).hexdigest(),
            'requestSha256': hashlib.sha256(json_bytes(request)).hexdigest(),
            'authorityVerification': 'unassessed', 'engineTransportPermission': False}

    def _read(self, root):
        # The JSON receipt can escape each byte of the bounded original text.
        # Bound the open descriptor before allocating or parsing its contents.
        with reader(root, 'receipt.json') as (stream, info):
            if info.st_size > 6*MAX_BYTES+1024*1024:
                raise ValueError('Original dispatch receipt exceeds its bound')
            raw = stream.read(info.st_size+1)
            if len(raw) != info.st_size: raise ValueError('Original dispatch receipt changed during read')
        try: return json.loads(raw, object_pairs_hook=strict_object)
        except (UnicodeError, ValueError, RecursionError):
            raise ValueError('Original dispatch receipt JSON differs') from None

    def load(self, request_id, *, deadline=None):
        deadline = time.monotonic()+self.timeout if deadline is None else deadline
        entry = self._check(request_id, deadline);root = self.folder(request_id)
        value = self._read(root)
        if not isinstance(value, dict) or not isinstance(value.get('payloadText'), str):
            raise ValueError('Original dispatch receipt differs')
        expected = self._record(entry, value['payloadText'].encode('utf-8'), value.get('applicationJob'))
        if encoded(value, canonical=True) != encoded(expected, canonical=True):
            raise ValueError('Original dispatch receipt differs')
        self._check(request_id, deadline)
        return value

    def save(self, request_id, payload, row, *, deadline=None):
        deadline = time.monotonic()+self.timeout if deadline is None else deadline
        entry = self._check(request_id, deadline);value = self._record(entry, payload, row)
        root = self.folder(request_id);name = hashlib.sha256(request_id.encode()).hexdigest()
        path = root/'receipt.json'
        if not path.exists() and not path.is_symlink():
            if any((self.runtime.root/(prefix+name)).exists() or (self.runtime.root/(prefix+name)).is_symlink() for prefix in ('url-intake-', 'preparation-')):
                raise ValueError('Started input work requires its original dispatch receipt')
        try: root.mkdir(mode=0o700)
        except FileExistsError: pass
        else: synchronize(self.runtime.root)
        private(root, True)
        with writer(root, deadline):
            self._check(request_id, deadline)
            publish(root, 'receipt.json', json_bytes(value), json_limit=6*MAX_BYTES+1024*1024)
            self._check(request_id, deadline)
            return self.load(request_id, deadline=deadline)


class Pipeline:
    def __init__(self, pipeline, dispatch, capture, *, capture_with_deadline=False):
        if not isinstance(pipeline, UrlDraft) or not isinstance(dispatch, Custody) or pipeline.intake.runtime is not dispatch.runtime or pipeline.intake.target != dispatch.target or not callable(capture):
            raise ValueError('Original dispatch pipeline adapters differ')
        if type(capture_with_deadline) is not bool:
            raise ValueError('Original dispatch capture deadline selection must be boolean')
        self.pipeline = pipeline;self.dispatch = dispatch;self.capture = capture
        self.capture_with_deadline = capture_with_deadline

    def capture_original(self, request_id, *, deadline=None):
        """Retain dispatch before progress or input work, without an engine effect."""
        if deadline is not None:self.dispatch._check(request_id,deadline)
        end=time.monotonic()+min(self.pipeline.timeout,self.dispatch.timeout)
        deadline=end if deadline is None else min(end,deadline)
        entry = self.pipeline.intake._check(request_id, deadline)
        path = self.dispatch.folder(request_id)/'receipt.json'
        if path.exists() or path.is_symlink(): receipt = self.dispatch.load(request_id, deadline=deadline)
        else:
            name = hashlib.sha256(request_id.encode()).hexdigest()
            if any((self.dispatch.runtime.root/(prefix+name)).exists() or (self.dispatch.runtime.root/(prefix+name)).is_symlink() for prefix in ('url-intake-', 'preparation-')):
                raise ValueError('Started input work requires its original dispatch receipt')
            captured = self.capture(copy.deepcopy(entry), deadline=deadline) if self.capture_with_deadline else self.capture(copy.deepcopy(entry))
            if type(captured) is not tuple or len(captured) != 2:
                raise ValueError('Exact original dispatch capture is required')
            receipt = self.dispatch.save(request_id, *captured, deadline=deadline)
        return receipt

    def _advance(self, request_id, job=None):
        deadline = time.monotonic()+min(self.pipeline.timeout, self.dispatch.timeout)
        entry = self.pipeline.intake._check(request_id, deadline)
        receipt = self.capture_original(request_id, deadline=deadline)
        projection = {key: receipt['applicationJob'][key] for key in JOB_FIELDS}
        def validate(settings):
            if not isinstance(settings, dict) or settings.get('targetId') != self.dispatch.target or settings.get('applicationJob') != projection:
                raise ValueError('Original dispatch and input settings differ')
            return settings
        intake = self.pipeline.intake
        saved = intake.runtime.root/('url-intake-'+hashlib.sha256(request_id.encode()).hexdigest())/'plan.json'
        if saved.exists() or saved.is_symlink():
            validate(read_json(saved.parent, saved.name).get('settings'))
        def supply(original): return validate(intake.supply(original))
        def authorize(plan, operation, command, **options):
            current = self.dispatch.load(request_id, deadline=deadline)
            if current != receipt or plan['binding']['originalRequest'] != entry.request or plan['binding']['originalContext'] != receipt['context']:
                raise ValueError('Original dispatch engine binding differs')
            forwarded = {'deadline': min(deadline, options['deadline'])} if self.pipeline.authorize_with_deadline else {}
            return self.pipeline.authorize(plan, operation, command, **forwarded)
        def transport(engine, command, stream, given_deadline):
            return self.pipeline.transport(engine, command, stream, min(deadline, given_deadline))
        bounded = Intake(intake.runtime, intake.source_root, intake.target, supply, intake.fetch,
            timeout=min(intake.timeout, deadline-time.monotonic()), cancelled=lambda: intake.cancelled())
        result = UrlDraft(bounded, authorize, transport, timeout=deadline-time.monotonic(),
            authorize_with_deadline=self.pipeline.authorize_with_deadline)._advance(request_id, job)
        self.dispatch.load(request_id, deadline=deadline)
        result['originalDispatchSha256'] = receipt['payloadSha256']
        result['originalProjectId'] = receipt['applicationJob']['project_id']
        return result

    def advance(self, request_id): return self._advance(request_id)

    def __call__(self, job):
        result = self._advance(job['request']['requestId'], job)
        job['url_draft'] = result;job['draft'] = result['draft'];job['state'] = 'draft_pending'
