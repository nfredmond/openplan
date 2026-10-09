"""Read ordered assignment geometry from the package's actual zone bytes."""
import hashlib
import io
import os
import operator
import re
from pathlib import Path
import stat

import numpy as np
import pandas as pd
import model_package_inputs as packages


def _identifier(value):
    """Preserve integer identifiers without rounding decimal or boolean values."""
    if isinstance(value, bool):
        raise ValueError("Boolean zone identifiers are invalid")
    if isinstance(value, str):
        if not re.fullmatch(r"[+-]?[0-9]+", value):
            raise ValueError("Zone identifiers must be integers")
        return int(value)
    try:
        return operator.index(value)
    except TypeError as error:
        raise ValueError("Zone identifiers must be integers") from error


def assignment_zone_order(centroid_map):
    """Match the assignment's sorted internal centroid-node order."""
    converted = {_identifier(zone): _identifier(node) for zone, node in centroid_map.items()}
    if not converted or len(converted) != len(centroid_map) or len(set(converted.values())) != len(converted):
        raise ValueError('Assignment zone/centroid mapping must be nonempty and unique')
    return [zone for zone, node in sorted(converted.items(), key=lambda item: item[1])]


def read_assignment_geometry(package_directory, ordered_zone_ids):
    """Read one stable private CSV and preserve the exact requested row order.

    The caller establishes package ownership. The returned hash identifies the
    bytes read; it does not itself register or authorize a geometry handoff.
    """
    path = Path(package_directory) / 'zone_attributes.csv'
    descriptor = os.open(path, packages.FILE_FLAGS)
    try:
        before = os.fstat(descriptor)
        if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1:
            raise ValueError('Zone attributes require a private regular file')
        with os.fdopen(os.dup(descriptor), 'rb') as stream:
            raw = stream.read(before.st_size + 1)
        if len(raw) != before.st_size or packages.identity(before) != packages.identity(os.fstat(descriptor)) or packages.identity(before) != packages.identity(os.stat(path, follow_symlinks=False)):
            raise ValueError('Zone attributes changed during read')
    finally:
        os.close(descriptor)
    frame = pd.read_csv(io.BytesIO(raw), dtype={'zone_id': str})
    frame['zone_id'] = frame['zone_id'].map(_identifier)
    order = [_identifier(zone) for zone in ordered_zone_ids]
    if not order or len(set(order)) != len(order) or frame['zone_id'].duplicated().any():
        raise ValueError('Assignment geometry requires unique zone identifiers')
    selected = frame.set_index('zone_id').loc[order, ['centroid_lon', 'centroid_lat', 'area_sq_mi']]
    values = selected.to_numpy(dtype=float)
    if not np.isfinite(values).all() or (np.abs(values[:, 0]) > 180).any() or (np.abs(values[:, 1]) > 90).any() or (values[:, 2] < 0).any():
        raise ValueError('Assignment geometry requires finite longitude, latitude and nonnegative area')
    return {'schema': 'openplan.assignment-zone-geometry.v1', 'zone_ids': order,
            'lons': values[:, 0].tolist(), 'lats': values[:, 1].tolist(), 'areas_sq_mi': values[:, 2].tolist(),
            'source_sha256': hashlib.sha256(raw).hexdigest(), 'source_size_bytes': len(raw)}
