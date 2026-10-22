"""Retain an original completed task archive under current application access.

Private byte custody grants no callback, publication or processing-quality claim.
Incomplete downloads remain bounded attempts, separate from complete receipts.
"""
import copy
import hashlib
import os
import re
import shutil
import time
import uuid

from admission_journal import private, synchronize
from engine_effects import same
from original_output_http import Transport
from retained_output_archive import clear_unpublished, retain
from retained_source import check_time, digest, finite_limit, json_bytes, publish, read_json, reader, writer
from retained_task_observation import Observations, finite_number
from runtime_observation import Observer
from url_source_custody import CountedWriter

FORMAT = 'openplan.odm-runtime-output-intake.v1'
RECEIPT = 'openplan.odm-original-output-bytes.v1'
OBJECT = r'objects/archive-[0-9a-f]{32}\.bin'


class Intake:
    def __init__(self, observer, *, max_archive_bytes, max_expanded_bytes,
                 max_entries=10000, max_directory_bytes=4*1024*1024,
                 timeout=120, cancelled=lambda: False):
        if not isinstance(observer, Observer) or not callable(cancelled):
            raise ValueError('Original output requires a current observer and cancellation adapter')
        if not finite_number(timeout) or timeout <= 0:
            raise ValueError('Original output timeout must be positive and finite')
        limits = {'max_archive_bytes': max_archive_bytes,
            'max_expanded_bytes': max_expanded_bytes, 'max_entries': max_entries,
            'max_directory_bytes': max_directory_bytes}
        for value in limits.values():
            finite_limit(value)
        if 2*max_archive_bytes > 2**63-1:
            raise ValueError('Original output attempt byte budget exceeds the transport range')
        self._limits = tuple(limits.items())
        self.observer = observer
        self.timeout = timeout
        self.cancelled = cancelled

    @property
    def limits(self):
        """Expose a copy so supplied callbacks cannot alter frozen limits by alias."""
        return dict(self._limits)

    def _check(self, request_id, deadline):
        self.observer.reader.dispatch._check(request_id, deadline)
        decision = self.cancelled()
        if type(decision) is not bool:
            raise ValueError('Original output cancellation must be a boolean')
        if decision:
            raise InterruptedError('Original output intake cancelled')
        check_time(deadline)

    def _access(self, request_id, deadline):
        self._check(request_id, deadline)
        result = self.observer._access(request_id, deadline)
        self._check(request_id, deadline)
        return result

    def _storage(self, pack, request_id, deadline):
        total = count = 0
        for path in (pack/'objects').iterdir():
            self._check(request_id, deadline)
            name = str(path.relative_to(pack))
            if re.fullmatch(OBJECT, name) is None:
                raise ValueError('Original output has an unknown attempt object')
            with reader(pack, name) as (_stream, info):
                total += info.st_size
                count += 1
        if total > 2*self.limits['max_archive_bytes'] or count > 2:
            raise ValueError('Original output attempts exceed the frozen storage limit')
        return total, count

    def _receipt(self, pack, plan_hash):
        path = pack/'completed.json'
        if not path.exists() and not path.is_symlink():
            return None
        value = read_json(pack, path.name)
        if (not isinstance(value, dict)
                or set(value) != {'format', 'planSha256', 'objectRelativePath', 'bytes', 'sha256'}
                or value['format'] != RECEIPT or value['planSha256'] != plan_hash
                or type(value['bytes']) is not int or not 0 < value['bytes'] <= self.limits['max_archive_bytes']
                or not isinstance(value['sha256'], str) or re.fullmatch('[0-9a-f]{64}', value['sha256']) is None
                or not isinstance(value['objectRelativePath'], str) or re.fullmatch(OBJECT, value['objectRelativePath']) is None):
            raise ValueError('Original complete output receipt differs')
        return value

    def _download(self, pack, plan, plan_hash, request_id, remaining, deadline):
        self._access(request_id, deadline)
        runtime = self.observer.reader.dispatch.runtime
        owned = lambda: runtime._owned
        transport = Transport(plan, self.observer.resolve,
            lambda engine, end: self.observer.attest(engine, end, owned=owned),
            cancelled=self.cancelled)
        if shutil.disk_usage(pack).free < 2*remaining:
            raise ValueError('Insufficient free space for original output and retained archive')
        name = 'objects/archive-'+uuid.uuid4().hex+'.bin'
        descriptor = os.open(pack/name, os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_NONBLOCK, 0o600)
        with os.fdopen(descriptor, 'wb') as output:
            counted = CountedWriter(output, remaining, lambda: self._check(request_id, deadline))
            returned = transport(plan, counted, remaining, deadline, owned=owned)
            self._check(request_id, deadline)
            if type(returned) is not int or returned != counted.written:
                raise ValueError('Original output download count differs from written bytes')
            output.flush()
            os.fsync(output.fileno())
        synchronize(pack/'objects')
        actual = digest(pack, name, remaining, deadline)
        if actual['bytes'] != counted.written:
            raise ValueError('Original output stored byte count differs')
        self._access(request_id, deadline)
        result = {'format': RECEIPT, 'planSha256': plan_hash, 'objectRelativePath': name, **actual}
        publish(pack, 'completed.json', json_bytes(result))
        self._check(request_id, deadline)
        return result

    def advance(self, request_id, observation_hash):
        """Download once, then recover original private bytes without another GET."""
        deadline = time.monotonic()+self.timeout
        self._check(request_id, deadline)
        root, plan = self.observer._original(request_id, deadline)
        observations = Observations(root/'engine', plan, records_root=root/'task-observations',
            timeout=max(.001, deadline-time.monotonic()))
        observed = observations.load(observation_hash, deadline=deadline)
        if observed['reportedState'] != 'completed':
            raise ValueError('Original output requires retained reported completion')
        self._access(request_id, deadline)
        pack = root/'output-intake'
        target = root/'output-archive'
        try:
            pack.mkdir(mode=0o700)
        except FileExistsError:
            pass
        else:
            synchronize(root)
        private(pack, True)
        original = {'format': FORMAT, 'enginePlan': copy.deepcopy(plan),
            'observationSha256': observation_hash, 'limits': self.limits,
            'maxAttemptObjects': 2, 'maxAttemptStorageBytes': 2*self.limits['max_archive_bytes']}
        plan_hash = hashlib.sha256(json_bytes(original)).hexdigest()
        with writer(pack, deadline):
            self._check(request_id, deadline)
            path = pack/'plan.json'
            if not path.exists() and not path.is_symlink() and any(
                    p.name != 'writer.lock' and not p.name.startswith('.partial-') for p in pack.iterdir()):
                raise ValueError('Original output records have no frozen plan')
            publish(pack, 'plan.json', json_bytes(original))
            clear_unpublished(pack)
            objects = pack/'objects'
            try:
                objects.mkdir(mode=0o700)
            except FileExistsError:
                pass
            else:
                synchronize(pack)
            private(objects, True)
            used, count = self._storage(pack, request_id, deadline)
            receipt = self._receipt(pack, plan_hash)
            if receipt is None:
                if target.exists() or target.is_symlink():
                    raise ValueError('Prepared output archive has no original byte receipt')
                if count >= 2:
                    raise ValueError('Original output attempt count reached its frozen limit')
                remaining = min(self.limits['max_archive_bytes'], 2*self.limits['max_archive_bytes']-used)
                if remaining <= 0:
                    raise ValueError('Original output has no remaining attempt byte budget')
                receipt = self._download(pack, plan, plan_hash, request_id, remaining, deadline)
            source = pack/receipt['objectRelativePath']
            if source.exists() or source.is_symlink():
                actual = digest(pack, receipt['objectRelativePath'], self.limits['max_archive_bytes'], deadline)
                if actual != {key: receipt[key] for key in ('bytes', 'sha256')}:
                    raise ValueError('Original complete output bytes differ')
            elif not (target/'archive.zip').exists():
                raise ValueError('Original complete output bytes are missing')
            self._access(request_id, deadline)
            check_time(deadline)
            archive = retain(observations, observation_hash, source_root=pack,
                source_name=receipt['objectRelativePath'], destination=target,
                **self.limits, timeout=deadline-time.monotonic())
            if not same({key: archive['archive'][key] for key in ('bytes', 'sha256')},
                        {key: receipt[key] for key in ('bytes', 'sha256')}):
                raise ValueError('Retained output archive differs from its original download')
            final = self._access(request_id, deadline)
            check_time(deadline)
            return {'format': FORMAT, 'scope': 'private_original_output_custody',
                'archive': archive, 'applicationAccessObservedAt': final['authorityObservedAt'],
                'callbackPermission': False, 'publicationPermission': False}
