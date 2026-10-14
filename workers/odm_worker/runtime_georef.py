"""Retain native raster tag declarations without approving placement or quality."""
import copy
import hashlib
import json
import re
import time
from pathlib import Path

import georef
from admission_journal import private, synchronize
from retained_output_archive import clear_unpublished
from retained_source import digest, json_bytes, publish, read_json, reader, writer
from retained_task_observation import finite_number
from runtime_products import Products

FORMAT = 'openplan.odm-private-raster-inspection.v1'
FLAGS = {
    'processingQualityVerification': 'unassessed',
    'mapPlacementVerification': 'unassessed',
    'callbackPermission': False,
    'publicationPermission': False,
}


def native_tags(parsed):
    """Require finite fields, positive dimensions/spacing and nonempty bounds."""
    for key in ('width', 'height', 'epsg'):
        if type(parsed[key]) is not int or parsed[key] <= 0:
            raise ValueError('Native raster dimensions and CRS code must be positive integers')
    bounds, spacing = parsed['native_bounds'], parsed['pixel_size']
    if (len(bounds) != 4 or len(spacing) != 2
            or any(not finite_number(value) for value in [*bounds, *spacing])
            or not bounds[0] < bounds[2] or not bounds[1] < bounds[3]
            or any(value <= 0 for value in spacing)):
        raise ValueError('Native raster declarations must be finite and nondegenerate')
    return {'width': parsed['width'], 'height': parsed['height'],
        'declaredCrs': 'EPSG:'+str(parsed['epsg']),
        'nativeBounds': list(bounds), 'nativeCellSpacing': list(spacing),
        'unitInterpretation': 'declared_native_coordinates'}


def verify_report(report, source_hash, products):
    """Validate the frozen report's input census, declared fields and claim limits."""
    if (not isinstance(report, dict)
            or set(report) != {'format', 'sourceReceiptSha256', 'readerSha256', 'inspectionSha256', 'products', 'scope', *FLAGS}
            or report['format'] != FORMAT or report['sourceReceiptSha256'] != source_hash
            or report['scope'] != 'private_declared_native_raster_metadata'
            or not isinstance(report['readerSha256'], str)
            or re.fullmatch('[0-9a-f]{64}', report['readerSha256']) is None
            or not isinstance(report['inspectionSha256'], str)
            or re.fullmatch('[0-9a-f]{64}', report['inspectionSha256']) is None
            or any(type(report[key]) is not type(value) or report[key] != value for key, value in FLAGS.items())):
        raise ValueError('Frozen raster inspection identity or claim limits differ')
    if not isinstance(report['products'], list) or len(report['products']) != len(products):
        raise ValueError('Frozen raster inspection product census differs')
    for observed, original in zip(report['products'], products):
        if (not isinstance(observed, dict)
                or set(observed) != {'kind', 'filename', 'bytes', 'sha256', 'status', 'reason', 'nativeTags'}
                or any(observed[key] != original[key] for key in ('kind', 'filename', 'bytes', 'sha256'))):
            raise ValueError('Frozen raster inspection original product differs')
        if original['availability'] != 'retained':
            if observed['status'] != 'unavailable' or observed['reason'] != original['reason'] or observed['nativeTags'] is not None:
                raise ValueError('Frozen absent raster declaration differs')
        elif original['kind'] == 'point_cloud':
            if (observed['status'] != 'unassessed' or observed['reason'] != 'point_cloud_reader_not_configured'
                    or observed['nativeTags'] is not None):
                raise ValueError('Frozen point cloud assessment differs')
        elif observed['status'] == 'read':
            tags = observed['nativeTags']
            if (not isinstance(tags, dict)
                    or set(tags) != {'width', 'height', 'declaredCrs', 'nativeBounds', 'nativeCellSpacing', 'unitInterpretation'}
                    or not isinstance(tags['declaredCrs'], str)
                    or re.fullmatch('EPSG:[1-9][0-9]*', tags['declaredCrs']) is None
                    or tags['unitInterpretation'] != 'declared_native_coordinates' or observed['reason'] is not None):
                raise ValueError('Frozen native tag declaration differs')
            expected = native_tags({'width': tags['width'], 'height': tags['height'],
                'epsg': int(tags['declaredCrs'].split(':')[1]),
                'native_bounds': tags['nativeBounds'], 'pixel_size': tags['nativeCellSpacing']})
            if tags != expected:
                raise ValueError('Frozen native tag values differ')
        elif (observed['status'] not in ('unsupported', 'failed') or observed['nativeTags'] is not None
                or not isinstance(observed['reason'], dict)
                or set(observed['reason']) != {'class', 'message'}
                or any(not isinstance(observed['reason'][key], str) for key in ('class', 'message'))
                or len(observed['reason']['message']) > 2000):
            raise ValueError('Frozen unsuccessful raster reading differs')


class Inspection:
    def __init__(self, products, *, timeout=120):
        if not isinstance(products, Products) or not finite_number(timeout) or timeout <= 0:
            raise ValueError('Raster inspection requires private products and a finite positive timeout')
        self.products = products
        self.timeout = timeout

    def _check(self, request_id, deadline):
        self.products._check(request_id, deadline)

    def _inspect(self, objects, row, request_id, deadline):
        result = {'kind': row['kind'], 'filename': row['filename'],
            'bytes': row['bytes'], 'sha256': row['sha256'],
            'status': 'unavailable', 'reason': row['reason'], 'nativeTags': None}
        if row['availability'] != 'retained':
            return result
        if row['kind'] == 'point_cloud':
            return {**result, 'status': 'unassessed', 'reason': 'point_cloud_reader_not_configured'}
        self._check(request_id, deadline)
        with reader(objects, row['filename']) as (stream, _info):
            try:
                # The descriptor keeps parsing bound to the inspected original inode.
                parsed = georef.parse_geotiff('/proc/self/fd/'+str(stream.fileno()))
                result.update(status='read', reason=None, nativeTags=native_tags(parsed))
            except (georef.GeorefError, ValueError, TypeError, KeyError, OSError) as exc:
                unsupported = isinstance(exc, georef.GeorefError) and str(exc).startswith('BigTIFF is not supported')
                result.update(status='unsupported' if unsupported else 'failed',
                    reason={'class': type(exc).__name__, 'message': str(exc)[:2000]}, nativeTags=None)
            actual = digest(objects, row['filename'], row['bytes'], deadline)
            if actual != {key: row[key] for key in ('bytes', 'sha256')}:
                raise ValueError('Inspected original raster bytes differ')
        self._check(request_id, deadline)
        return result

    def advance(self, request_id, observation_hash):
        """Freeze one original interpretation before publishing its private receipt."""
        products = self.products.advance(request_id, observation_hash)
        deadline = time.monotonic()+self.timeout
        self._check(request_id, deadline)
        intake = self.products.intake
        root, _original = intake.observer._original(request_id, deadline)
        source_hash = hashlib.sha256(json_bytes(products)).hexdigest()
        intake._access(request_id, deadline)
        pack = root/'private-raster-inspection'
        try:
            pack.mkdir(mode=0o700)
        except FileExistsError:
            pass
        else:
            synchronize(root)
        private(pack, True)
        with writer(pack, deadline):
            clear_unpublished(pack)
            if (pack/'plan.json').exists() or (pack/'plan.json').is_symlink():
                plan = read_json(pack, 'plan.json')
            else:
                if any(path.name != 'writer.lock' for path in pack.iterdir()):
                    raise ValueError('Raster inspection has no original plan')
                rows = [self._inspect(root/'private-products/objects', row, request_id, deadline)
                    for row in products['products']]
                report = {'format': FORMAT, 'sourceReceiptSha256': source_hash,
                    'readerSha256': hashlib.sha256(Path(georef.__file__).read_bytes()).hexdigest(),
                    'inspectionSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                    'products': rows, 'scope': 'private_declared_native_raster_metadata', **FLAGS}
                self._check(request_id, deadline)
                intake._access(request_id, deadline)
                plan = {'format': FORMAT, 'sourceReceiptSha256': source_hash,
                    'reportText': json_bytes(report).decode()}
                publish(pack, 'plan.json', json_bytes(plan))
            if (not isinstance(plan, dict) or set(plan) != {'format', 'sourceReceiptSha256', 'reportText'}
                    or plan['format'] != FORMAT or plan['sourceReceiptSha256'] != source_hash
                    or not isinstance(plan['reportText'], str)):
                raise ValueError('Raster inspection original plan differs')
            report = json.loads(plan['reportText'])
            if plan['reportText'].encode() != json_bytes(report):
                raise ValueError('Frozen raster inspection report differs')
            verify_report(report, source_hash, products['products'])
            self._check(request_id, deadline)
            publish(pack, 'report.json', plan['reportText'].encode())
            receipt = {'format': FORMAT, 'sourceReceiptSha256': source_hash,
                'planSha256': hashlib.sha256(json_bytes(plan)).hexdigest(),
                'reportSha256': hashlib.sha256(plan['reportText'].encode()).hexdigest(),
                'scope': 'private_declared_native_raster_metadata', **copy.deepcopy(FLAGS)}
            intake._access(request_id, deadline)
            self._check(request_id, deadline)
            publish(pack, 'receipt.json', json_bytes(receipt))
            self._check(request_id, deadline)
            return {'receipt': receipt, 'report': report}
