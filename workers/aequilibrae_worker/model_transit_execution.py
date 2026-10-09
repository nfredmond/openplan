"""Child computation from parent-confirmed feed, geometry and deadline."""
from pathlib import Path
import numpy as np
import gtfs_skim
import model_geometry_inputs
import model_transit_inputs
from model_transit_skim import skim_prepared_transit


def consume_and_skim(prepared, destination):
    """Consume exact retained files without source discovery or database access."""
    status = prepared['status']
    if status not in ('retained', 'unavailable'):
        raise ValueError('Unknown transit preparation outcome')
    destination = Path(destination)
    destination.mkdir(mode=0o700, exist_ok=False)
    geometry = model_geometry_inputs.consume(prepared['geometry_record'], destination / 'geometry')
    if status == 'unavailable':
        return {'geometry': geometry, 'transit_status': prepared['transit_status'],
                'metadata': prepared['metadata'], 'skim': None, 'log': ''}
    deadline = prepared['deadline']
    gtfs_skim.check_deadline(deadline, 'consuming retained transit inputs')
    _, raw, metadata, settings = model_transit_inputs.consume(prepared['record'], destination / 'transit')
    los = gtfs_skim.load_feed(raw=raw, source_url=metadata['source_url'], source_name=metadata['source_name'])
    result = skim_prepared_transit(los, metadata, np.asarray(geometry['lons'], dtype=float),
                                   np.asarray(geometry['lats'], dtype=float), settings=settings, deadline=deadline)
    return {**result, 'geometry': geometry}
