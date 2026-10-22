"""Materialize private original member bytes without authorizing delivery."""
import copy
import hashlib
import os
import shutil
import stat
import time
import zipfile

from admission_journal import private, synchronize
from retained_output_archive import clear_unpublished
from retained_source import CHUNK, digest, json_bytes, publish, reader, writer
from retained_task_observation import finite_number
from runtime_output_intake import Intake

FORMAT = 'openplan.odm-private-products.v1'
PRODUCTS = (
    ('orthomosaic', 'orthophoto.tif', 'odm_orthophoto/odm_orthophoto.tif', True),
    ('dsm', 'dsm.tif', 'odm_dem/dsm.tif', False),
    ('dtm', 'dtm.tif', 'odm_dem/dtm.tif', False),
    ('point_cloud', 'georeferenced_model.laz',
        'odm_georeferencing/odm_georeferenced_model.laz', False),
)


class Products:
    def __init__(self, intake, *, timeout=120):
        if not isinstance(intake, Intake) or not finite_number(timeout) or timeout <= 0:
            raise ValueError('Private products require original intake and a finite timeout')
        self.intake = intake
        self.timeout = timeout

    def _check(self, request_id, deadline):
        self.intake._check(request_id, deadline)

    def _partial(self, objects, filename):
        """Reconcile only the known interrupted copy or publication alias."""
        temporary = objects/('.'+filename+'.partial')
        target = objects/filename
        if not temporary.exists() and not temporary.is_symlink():
            return
        if target.exists() or target.is_symlink():
            left, right = temporary.lstat(), target.lstat()
            if ((left.st_dev, left.st_ino, left.st_nlink)
                    != (right.st_dev, right.st_ino, 2)
                    or not stat.S_ISREG(left.st_mode) or left.st_uid != os.getuid()
                    or stat.S_IMODE(left.st_mode) & 0o077):
                raise ValueError('Interrupted product publication alias differs')
        else:
            with reader(objects, temporary.name):
                pass
        temporary.unlink()
        synchronize(objects)

    def _copy(self, source, objects, row, request_id, deadline):
        filename = row['filename']
        self._partial(objects, filename)
        target = objects/filename
        expected = {key: row[key] for key in ('bytes', 'sha256')}
        if not target.exists() and not target.is_symlink():
            temporary = objects/('.'+filename+'.partial')
            with reader(source, 'archive.zip') as (stream, _info):
                with zipfile.ZipFile(stream) as archive, archive.open(row['member']) as member:
                    size, checksum = 0, hashlib.sha256()
                    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
                    with os.fdopen(descriptor, 'wb') as output:
                        while chunk := member.read(min(CHUNK, row['bytes']-size+1)):
                            self._check(request_id, deadline)
                            size += len(chunk)
                            if size > row['bytes']:
                                raise ValueError('Original product exceeds its retained member size')
                            checksum.update(chunk)
                            output.write(chunk)
                        output.flush()
                        os.fsync(output.fileno())
                    if {'bytes': size, 'sha256': checksum.hexdigest()} != expected:
                        raise ValueError('Original product differs from its retained member')
            self._check(request_id, deadline)
            os.link(temporary, target, follow_symlinks=False)
            temporary.unlink()
            synchronize(objects)
        actual = digest(objects, filename, row['bytes'], deadline)
        if actual != expected:
            raise ValueError('Saved original product bytes differ')
        self._check(request_id, deadline)

    def advance(self, request_id, observation_hash):
        """Recover member files only after exact original archive verification."""
        custody = self.intake.advance(request_id, observation_hash)
        deadline = time.monotonic()+self.timeout
        self._check(request_id, deadline)
        root, engine_plan = self.intake.observer._original(request_id, deadline)
        archive = custody['archive']['archive']
        rows = []
        for kind, filename, member, required in PRODUCTS:
            entry = next((row for row in archive['members'] if row['name'] == member), None)
            if entry is None:
                if required:
                    raise ValueError('Original archive has no required orthomosaic member')
                rows.append({'kind': kind, 'filename': filename, 'member': member,
                    'availability': 'unavailable', 'reason': 'absent_from_original_archive',
                    'bytes': None, 'sha256': None})
                continue
            if entry['kind'] != 'file' or entry['bytes'] <= 0:
                raise ValueError('Original product member must be a nonempty regular file')
            rows.append({'kind': kind, 'filename': filename, 'member': member,
                'availability': 'retained', 'reason': None,
                'bytes': entry['bytes'], 'sha256': entry['sha256']})
        plan = {'format': FORMAT, 'enginePlan': copy.deepcopy(engine_plan),
            'observationSha256': observation_hash,
            'archive': {key: archive[key] for key in ('bytes', 'sha256')}, 'products': rows}
        self.intake._access(request_id, deadline)
        pack = root/'private-products'
        try:
            pack.mkdir(mode=0o700)
        except FileExistsError:
            pass
        else:
            synchronize(root)
        private(pack, True)
        with writer(pack, deadline):
            clear_unpublished(pack)
            if not (pack/'plan.json').exists() and any(
                    path.name != 'writer.lock' for path in pack.iterdir()):
                raise ValueError('Private products have no original plan')
            publish(pack, 'plan.json', json_bytes(plan))
            objects = pack/'objects'
            try:
                objects.mkdir(mode=0o700)
            except FileExistsError:
                pass
            else:
                synchronize(pack)
            private(objects, True)
            # Budget all remaining expanded files before writing the first member.
            remaining = sum(row['bytes'] for row in rows
                if row['availability'] == 'retained'
                    and not (objects/row['filename']).exists())
            if shutil.disk_usage(pack).free < 2*remaining:
                raise ValueError('Insufficient free space for remaining original products')
            for row in rows:
                if row['availability'] == 'retained':
                    self._copy(root/'output-archive', objects, row, request_id, deadline)
            expected = {row['filename'] for row in rows if row['availability'] == 'retained'}
            if {path.name for path in objects.iterdir()} != expected:
                raise ValueError('Private product object inventory differs')
            self.intake._access(request_id, deadline)
            receipt = {**plan, 'scope': 'private_original_member_bytes',
                'processingQualityVerification': 'unassessed',
                'requestedDeliverableCompletenessVerification': 'unassessed',
                'archiveTaskProvenanceVerification': 'unassessed',
                'callbackPermission': False, 'publicationPermission': False}
            self._check(request_id, deadline)
            publish(pack, 'receipt.json', json_bytes(receipt))
            self._check(request_id, deadline)
            return receipt
