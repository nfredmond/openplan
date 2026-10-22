"""Retain original download leases for an explicitly authorized delivery adapter.

Current access is supplied by the caller for this separate operation. Processing
observations and private artifact metadata do not grant that access. This module
is not connected to the HTTP entry point.
"""
import copy
import hashlib
import hmac
import re
import secrets
import time
from urllib.parse import quote, urlsplit

import contract
from admission_journal import private, synchronize
from retained_output_archive import clear_unpublished
from retained_source import CHUNK, check_time, json_bytes, publish, read_json, reader, writer
from retained_task_observation import finite_number
from runtime_artifact_plan import ArtifactPlan, FORMAT as PLAN_FORMAT, CONTENT_TYPES, LIMITS

FORMAT = 'openplan.odm-original-artifact-access.v1'
SCOPE = 'original_application_artifact_download'


def checksum(value):
    return hashlib.sha256(json_bytes(value)).hexdigest()


def base_url(value):
    if not isinstance(value, str) or len(value) > 4096 or any(ord(c) <= 32 or ord(c) == 127 for c in value):
        raise ValueError('Artifact access needs an explicit base URL')
    parsed = urlsplit(value)
    if (parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username
            or parsed.password or '?' in value or '#' in value or '\\' in value
            or '%' in parsed.netloc or parsed.path not in ('', '/')):
        raise ValueError('Artifact access base URL differs')
    try:
        parsed.port
    except ValueError:
        raise ValueError('Artifact access base URL port differs') from None
    return value.rstrip('/')


class ArtifactAccess:
    def __init__(self, plan, authorize, *, timeout=120, clock=time.time):
        if not isinstance(plan, ArtifactPlan) or not callable(authorize) or not callable(clock):
            raise ValueError('Artifact access needs original descriptors and scoped authority')
        if not finite_number(timeout) or timeout <= 0:
            raise ValueError('Artifact access needs a finite positive deadline')
        self.plan = plan
        self.dispatch = plan.inspection.products.intake.observer.reader.dispatch
        self.authorize = authorize
        self.timeout = timeout
        self.clock = clock

    def _check(self, request_id, deadline):
        self.dispatch._check(request_id, deadline)
        check_time(deadline)

    def _authority(self, binding, deadline):
        self._check(binding['requestId'], deadline)
        allowed = self.authorize(copy.deepcopy(binding), SCOPE, deadline,
            owned=lambda: self.dispatch.runtime._owned)
        if type(allowed) is not bool:
            raise ValueError('Artifact access authority must return a boolean')
        if not allowed:
            raise PermissionError('Artifact access current original actor refused')
        self._check(binding['requestId'], deadline)

    def _plan(self, request_id, observation_hash, deadline):
        root, engine = self.plan.inspection.products.intake.observer._original(request_id, deadline)
        original = self.dispatch.load(request_id, deadline=deadline)
        manifest = read_json(root/'private-artifact-plan', 'manifest.json')
        receipt = read_json(root/'private-artifact-plan', 'receipt.json')
        if not isinstance(manifest, dict):
            raise ValueError('Artifact access original manifest must be an object')
        binding = {'installationId': self.dispatch.runtime.installation['installationId'],
            'targetId': self.dispatch.target, 'requestId': request_id,
            'jobReference': original['binding']['jobReference'],
            'originalApplicationJob': original['applicationJob'],
            'originalDispatchSha256': original['payloadSha256'],
            'originalTaskUuid': engine['taskUuid'], 'observationSha256': observation_hash}
        if (manifest.get('format') != PLAN_FORMAT or manifest.get('scope') != 'private_original_artifact_preparation'
                or manifest.get('binding') != binding or json_bytes(receipt) != json_bytes({'format': PLAN_FORMAT,
                    'scope': 'private_original_artifact_preparation', 'manifestSha256': checksum(manifest), **LIMITS})
                or any(manifest.get(key) != value or type(manifest.get(key)) is not type(value)
                    for key, value in LIMITS.items())):
            raise ValueError('Artifact access original descriptor binding differs')
        rows = manifest.get('artifacts')
        if not isinstance(rows, list) or not rows or len(rows) > len(CONTENT_TYPES):
            raise ValueError('Artifact access original roster differs')
        seen, filenames = set(), set()
        for row in rows:
            if (not isinstance(row, dict) or row.get('kind') not in CONTENT_TYPES
                    or row.get('kind') in seen or row.get('filename') in filenames or not isinstance(row.get('filename'), str)
                    or not re.fullmatch('[A-Za-z0-9][A-Za-z0-9._-]{0,179}', row['filename'])
                    or row.get('contentType') != CONTENT_TYPES[row['kind']]):
                raise ValueError('Artifact access original roster differs')
            seen.add(row['kind']); filenames.add(row['filename'])
            if row.get('availability') == 'retained':
                if (type(row.get('sizeBytes')) is not int or row['sizeBytes'] <= 0
                        or not isinstance(row.get('checksumSha256'), str)
                        or not re.fullmatch('[0-9a-f]{64}', row['checksumSha256'])
                        or row.get('localRelativePath') != 'private-products/objects/'+row['filename']):
                    raise ValueError('Artifact access original file descriptor differs')
            elif (row.get('availability') != 'unavailable' or any(row.get(key) is not None
                    for key in ('sizeBytes', 'checksumSha256', 'localRelativePath'))):
                raise ValueError('Artifact access absent file descriptor differs')
        if manifest.get('unselectedContractKinds') != [kind for kind in contract.ARTIFACT_KINDS if kind not in seen]:
            raise ValueError('Artifact access original contract coverage differs')
        sources = read_json(root/'private-products', 'receipt.json')
        inspection = read_json(root/'private-raster-inspection', 'receipt.json')
        report = read_json(root/'private-raster-inspection', 'report.json')
        if (manifest.get('productReceiptSha256') != checksum(sources)
                or manifest.get('inspectionReceiptSha256') != checksum(inspection)
                or manifest.get('inspectionReportSha256') != checksum(report)
                or inspection.get('sourceReceiptSha256') != checksum(sources)
                or inspection.get('reportSha256') != checksum(report)
                or len(sources.get('products', [])) != len(rows)
                or len(report.get('products', [])) != len(rows)):
            raise ValueError('Artifact access original upstream receipts differ')
        expected = []
        for source, tags in zip(sources['products'], report['products']):
            expected.append({'kind': source['kind'], 'filename': source['filename'],
                'availability': source['availability'], 'reason': source['reason'],
                'sizeBytes': source['bytes'], 'checksumSha256': source['sha256'],
                'contentType': CONTENT_TYPES[source['kind']],
                'localRelativePath': 'private-products/objects/'+source['filename']
                    if source['availability'] == 'retained' else None,
                'nativeInspectionStatus': tags['status']})
        if rows != expected:
            raise ValueError('Artifact access original upstream descriptors differ')
        self._check(request_id, deadline)
        return root, manifest

    def _lease(self, manifest, public_base_url, expires_at, token):
        if not finite_number(expires_at) or expires_at <= 0:
            raise ValueError('Artifact access expiry must be finite and positive')
        if not isinstance(token, str) or not re.fullmatch('[A-Za-z0-9_-]{43}', token):
            raise ValueError('Artifact access original token differs')
        base = base_url(public_base_url)
        rows = copy.deepcopy(manifest['artifacts'])
        reference = quote(manifest['binding']['jobReference'], safe='')
        for row in rows:
            row['downloadUrl'] = (base+'/artifacts/'+reference+'/'+token+'/'+row['filename']
                if row['availability'] == 'retained' else None)
        return {'format': FORMAT, 'scope': SCOPE, 'binding': copy.deepcopy(manifest['binding']),
            'artifactPlanSha256': checksum(manifest), 'publicBaseUrl': base,
            'expiresAt': expires_at, 'token': token, 'artifacts': rows,
            'unselectedContractKinds': copy.deepcopy(manifest['unselectedContractKinds']),
            'processingQualityVerification': 'unassessed',
            'requestedDeliverableCompletenessVerification': 'unassessed',
            'mapPlacementVerification': 'unassessed', 'terminalCallbackPermission': False}

    def _live(self, lease):
        now = self.clock()
        if not finite_number(now) or now >= lease['expiresAt']:
            raise PermissionError('Artifact access original lease expired')

    def _load(self, root, manifest):
        pack = root/'private-artifact-access'
        lease = read_json(pack, 'lease.json')
        if (not isinstance(lease, dict) or json_bytes(lease) != json_bytes(self._lease(manifest,
                lease.get('publicBaseUrl'), lease.get('expiresAt'), lease.get('token')))):
            raise ValueError('Artifact access saved original lease differs')
        return lease

    def prepare(self, request_id, observation_hash, *, public_base_url=None, expires_at=None):
        """Freeze one original token and expiry before any terminal callback."""
        deadline = time.monotonic()+self.timeout
        root, manifest = self._plan(request_id, observation_hash, deadline)
        self._authority(manifest['binding'], deadline)
        pack = root/'private-artifact-access'
        try:
            pack.mkdir(mode=0o700)
        except FileExistsError:
            pass
        else:
            synchronize(root)
        private(pack, True)
        with writer(pack, deadline):
            clear_unpublished(pack)
            path = pack/'lease.json'
            if path.exists() or path.is_symlink():
                lease = self._load(root, manifest)
                if ((public_base_url is not None and lease['publicBaseUrl'] != base_url(public_base_url))
                        or (expires_at is not None and lease['expiresAt'] != expires_at)):
                    raise ValueError('Artifact access cannot renew or redirect an original lease')
            else:
                if any(p.name != 'writer.lock' for p in pack.iterdir()):
                    raise ValueError('Artifact access completion has no original lease')
                lease = self._lease(manifest, public_base_url, expires_at, secrets.token_urlsafe(32))
            self._live(lease)
            self._authority(lease['binding'], deadline)
            publish(pack, 'lease.json', json_bytes(lease))
            self._authority(lease['binding'], deadline)
            self._live(lease)
            publish(pack, 'receipt.json', json_bytes({'format': FORMAT, 'scope': SCOPE,
                'leaseSha256': checksum(lease), 'terminalCallbackPermission': False}))
            self._check(request_id, deadline)
            return copy.deepcopy(lease)

    def resume(self, request_id, observation_hash):
        """Finish the saved original lease without new settings or expiry."""
        pack = self.dispatch.runtime.root/('preparation-'+hashlib.sha256(request_id.encode()).hexdigest())/'private-artifact-access'
        if not (pack/'lease.json').exists():
            raise ValueError('Artifact access resume requires its original lease')
        return self.prepare(request_id, observation_hash)

    def serve(self, request_id, observation_hash, job_reference, token, filename, output, *, deadline=None,
              expected_lease_sha256=None):
        """Withhold the final chunk until original bytes and current access agree."""
        if deadline is not None and not finite_number(deadline):
            raise ValueError('Artifact access deadline must be finite')
        deadline = min(time.monotonic()+self.timeout, deadline) if deadline is not None else time.monotonic()+self.timeout
        root, manifest = self._plan(request_id, observation_hash, deadline)
        lease = self._load(root, manifest)
        if expected_lease_sha256 is not None and (not isinstance(expected_lease_sha256, str)
                or not re.fullmatch('[0-9a-f]{64}', expected_lease_sha256)
                or checksum(lease) != expected_lease_sha256):
            raise ValueError('Artifact access selected HTTP lease differs')
        receipt = read_json(root/'private-artifact-access', 'receipt.json')
        if json_bytes(receipt) != json_bytes({'format': FORMAT, 'scope': SCOPE, 'leaseSha256': checksum(lease), 'terminalCallbackPermission': False}):
            raise ValueError('Artifact access original completion differs')
        if (job_reference != lease['binding']['jobReference'] or not isinstance(token, str)
                or not hmac.compare_digest(token, lease['token'])):
            raise PermissionError('Artifact access original URL identity differs')
        row = next((r for r in lease['artifacts'] if r['filename'] == filename), None)
        if row is None or row['availability'] != 'retained':
            raise FileNotFoundError('Artifact access has no retained original file')
        self._live(lease)
        self._authority(lease['binding'], deadline)
        remaining, digest, final = row['sizeBytes'], hashlib.sha256(), b''
        with reader(root, row['localRelativePath']) as (stream, info):
            if info.st_size != row['sizeBytes']:
                raise ValueError('Artifact access original file size differs')
            while remaining:
                self._check(request_id, deadline)
                self._live(lease)
                chunk = stream.read(min(CHUNK, remaining))
                if not chunk:
                    raise ValueError('Artifact access original file ended early')
                digest.update(chunk)
                remaining -= len(chunk)
                if remaining:
                    self._write(output, chunk, lambda: (self._check(request_id, deadline), self._live(lease)))
                else:
                    final = chunk
            if stream.read(1) or digest.hexdigest() != row['checksumSha256']:
                raise ValueError('Artifact access original file checksum differs')
        self._check(request_id, deadline)
        self._authority(lease['binding'], deadline)
        self._live(lease)
        if self._load(root, manifest) != lease or json_bytes(read_json(root/'private-artifact-access', 'receipt.json')) != json_bytes(receipt):
            raise ValueError('Artifact access lease changed during download')
        self._write(output, final, lambda: (self._check(request_id, deadline), self._live(lease)))
        return {'kind': row['kind'], 'sizeBytes': row['sizeBytes'],
            'checksumSha256': row['checksumSha256'], 'contentType': row['contentType']}

    @staticmethod
    def _write(output, chunk, check):
        view = memoryview(chunk)
        while view:
            check()
            count = output.write(view)
            if type(count) is not int or not 0 < count <= len(view):
                raise OSError('Artifact access output made no progress')
            view = view[count:]
        check()
