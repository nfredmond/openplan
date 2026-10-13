"""Owned local input preparation, with explicit unassessed application context.

The caller supplies complete local bytes and an original application projection.
No external transport, live permission check or engine processing occurs here.
"""
import copy
import hashlib
import math
from pathlib import Path
import re
import time
import uuid

from admission_journal import encoded, private, synchronize
import derived_zip
from engine_effects import Effects, engine_identity
from retained_source import absolute, check_time, finite_limit, json_bytes, prepare, publish, read_json, writer
from runtime_admission import Runtime

FORMAT = 'openplan.odm-runtime-preparation.v1'
FIELDS = {'applicationJob', 'targetId', 'sourceRoot', 'sources', 'maxBytes',
          'engine', 'options', 'filenames', 'zipLimits'}
JOB_FIELDS = {'id', 'request_id', 'workspace_id', 'mission_id', 'created_by',
              'preset_id', 'imagery_type'}


def application_context(entry, installation, target, row):
    """Bind a supplied original record without claiming live authority."""
    if not isinstance(target, str) or not target.strip() or not isinstance(row, dict) or set(row) != JOB_FIELDS or any(not isinstance(row[key], str) or not row[key].strip() for key in JOB_FIELDS):
        raise ValueError('Original application job and actor are required')
    request = entry.request;external = request['externalRef']
    if row['request_id'] != request['requestId'] or row['workspace_id'] != external['workspaceId'] or row['mission_id'] != external['missionId'] or row['preset_id'] != request.get('presetId', 'balanced') or row['imagery_type'] != request['imagery']['type']:
        raise ValueError('Original application job scope differs')
    return {'installationId': installation, 'targetId': target, 'originalActorId': row['created_by'],
            'workspaceId': row['workspace_id'], 'missionId': row['mission_id'],
            'applicationJobId': row['id'],
            'applicationRecordSha256': hashlib.sha256(json_bytes(row)).hexdigest(),
            'originalStartContext': copy.deepcopy(entry.started_context),
            'authorityVerification': 'unassessed'}


class Preparation:
    def __init__(self, runtime, supply, *, timeout=120):
        if not isinstance(runtime, Runtime) or not callable(supply):
            raise ValueError('Original admission runtime and input supplier are required')
        if not isinstance(timeout, (int, float)) or isinstance(timeout, bool) or not math.isfinite(timeout) or timeout <= 0:
            raise ValueError('Runtime preparation timeout must be positive and finite')
        self.runtime = runtime;self.supply = supply;self.timeout = timeout

    def _entry(self, request_id):
        if not self.runtime._owned:
            raise ValueError('Runtime preparation requires its lifetime owner')
        self.runtime._check()
        entry = self.runtime.journal.get(request_id)
        if entry is None or entry.phase != 'started' or not isinstance(entry.started_context, dict) or entry.started_context.get('installationId') != self.runtime.installation['installationId']:
            raise ValueError('Original owned start is required before preparation')
        return entry

    def _spec(self, entry):
        supplied = self.supply(copy.deepcopy(entry))
        if not isinstance(supplied, dict) or set(supplied) != FIELDS:
            raise ValueError('Exact original runtime preparation inputs are required')
        spec = copy.deepcopy(supplied)
        context = application_context(entry, self.runtime.installation['installationId'], spec['targetId'], spec['applicationJob'])
        spec['engine'] = engine_identity(spec['engine'])
        finite_limit(spec['maxBytes'])
        names = spec['sources']
        if not isinstance(names, list) or not names or any(not isinstance(name, str) or not name or Path(name).is_absolute() or str(Path(name)) != name or any(part in ('.', '..') for part in name.split('/')) for name in names) or len(names) != len(set(names)):
            raise ValueError('Original runtime source mapping differs')
        expected_count = 1 if entry.request['imagery']['type'] == 'zip_url' else len(entry.request['imagery']['photos'])
        if len(names) != expected_count:
            raise ValueError('Original runtime source count differs')
        options = spec['options']
        if not isinstance(options, list) or any(not isinstance(row, dict) or set(row) != {'name', 'value'} or not isinstance(row['name'], str) or not row['name'].strip() or type(row['value']) not in (str, int, float, bool) or type(row['value']) is float and not math.isfinite(row['value']) for row in options) or len({row['name'] for row in options}) != len(options):
            raise ValueError('Original runtime engine options differ')
        if entry.request['imagery']['type'] == 'zip_url':
            limits = spec['zipLimits']
            if spec['filenames'] is not None or not isinstance(limits, dict) or set(limits) != {'max_expanded_bytes', 'max_entries', 'max_directory_bytes'}:
                raise ValueError('Original runtime ZIP derivation limits are required')
            for limit in limits.values(): finite_limit(limit)
        elif spec['zipLimits'] is not None or not isinstance(spec['filenames'], list) or len(spec['filenames']) != expected_count or any(not isinstance(name, str) or not re.fullmatch('[A-Za-z0-9][A-Za-z0-9._-]{0,179}\\.(jpg|jpeg|png|tif|tiff)', name) for name in spec['filenames']) or len(set(spec['filenames'])) != expected_count:
            raise ValueError('Original runtime photo filenames differ')
        spec['sourceRoot'] = absolute(spec['sourceRoot'])
        if spec['sourceRoot'] == self.runtime.root or spec['sourceRoot'] in self.runtime.root.parents or self.runtime.root in spec['sourceRoot'].parents:
            raise ValueError('Runtime input and retained roots must not overlap')
        return spec, context

    def resume(self, request_id, *, deadline=None):
        """Verify or finish the same original local preparation; never issue effects."""
        if deadline is not None and (type(deadline) not in (int, float) or not math.isfinite(deadline)):
            raise ValueError('Runtime preparation shared deadline must be finite')
        deadline = min(time.monotonic()+self.timeout, deadline) if deadline is not None else time.monotonic()+self.timeout
        check_time(deadline)
        entry = self._entry(request_id);spec, context = self._spec(entry)
        check_time(deadline)
        root = self.runtime.root/('preparation-'+hashlib.sha256(request_id.encode()).hexdigest())
        try: root.mkdir(mode=0o700)
        except FileExistsError: pass
        else: synchronize(self.runtime.root)
        private(root, True)
        with writer(root, deadline):
            self._entry(request_id)
            saved = root/'plan.json'
            if saved.exists() or saved.is_symlink():
                original = read_json(root, saved.name)
                task = original.get('taskUuid') if isinstance(original, dict) else None
            else:
                if any(path.name != 'writer.lock' and not path.name.startswith('.partial-') for path in root.iterdir()):
                    raise ValueError('Runtime preparation records require their original plan')
                task = str(uuid.uuid4())
            if not isinstance(task, str) or not re.fullmatch('[0-9a-f]{8}-[0-9a-f]{4}-[1-7][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}', task):
                raise ValueError('Original runtime preparation task identity differs')
            plan = {'format': FORMAT, 'request': entry.request, 'admission': entry.admission,
                    'jobReference': entry.job_reference, 'context': context,
                    'applicationJob': spec['applicationJob'], 'sources': spec['sources'],
                    'maxBytes': spec['maxBytes'], 'engine': spec['engine'], 'options': spec['options'],
                    'filenames': spec['filenames'], 'zipLimits': spec['zipLimits'], 'taskUuid': task,
                    'engineTransportPermission': False}
            publish(root, saved.name, json_bytes(plan))
            remaining = deadline-time.monotonic()
            if remaining <= 0: raise TimeoutError('Runtime preparation deadline exceeded')
            arguments = {'journal': self.runtime.journal, 'request_id': request_id,
                         'reference': entry.job_reference, 'context': context,
                         'source_root': spec['sourceRoot'], 'sources': spec['sources'],
                         'destination': root/'retained', 'max_bytes': spec['maxBytes'], 'timeout': remaining}
            receipt = prepare(**arguments)
            derivation = None
            if spec['zipLimits'] is not None:
                arguments = {**arguments, 'timeout': max(0, deadline-time.monotonic())}
                derivation = {'destination': root/'derived', **spec['zipLimits']}
                receipt = derived_zip.prepare(arguments, **derivation, timeout=max(0, deadline-time.monotonic()))
            filenames = spec['filenames'] if derivation is None else [row['filename'] for row in receipt['manifest']['sources']]
            effects = Effects(root/'engine', source_arguments=arguments, engine=spec['engine'], task_uuid=task,
                              name=entry.request['missionTitle'][:200], options=spec['options'],
                              filenames=filenames, derived_arguments=derivation,
                              timeout=max(0, deadline-time.monotonic()), deadline=deadline)
            result = {'format': FORMAT, 'state': 'prepared_locally', 'taskUuid': task,
                      'planSha256': hashlib.sha256(json_bytes(plan)).hexdigest(),
                      'enginePlanSha256': effects.plan_hash, 'sourceManifestSha256': receipt['manifestSha256'],
                      'authorityVerification': 'unassessed', 'engineCustodyVerification': 'unassessed',
                      'callbackDeliveryVerification': 'unassessed', 'engineTransportPermission': False}
            if time.monotonic() >= deadline: raise TimeoutError('Runtime preparation deadline exceeded')
            publish(root, 'prepared.json', json_bytes(result))
            if time.monotonic() >= deadline: raise TimeoutError('Runtime preparation deadline exceeded')
            return result

    def __call__(self, job):
        entry = self._entry(job['request']['requestId'])
        if job['job_reference'] != entry.job_reference or encoded(job['request'], canonical=True) != encoded(entry.request, canonical=True) or encoded(job['accepted_callback'], canonical=True) != encoded(entry.admission, canonical=True):
            raise ValueError('Pipeline preparation identity differs from original admission')
        result = self.resume(entry.request['requestId'])
        job['preparation'] = result;job['state'] = 'prepared'
