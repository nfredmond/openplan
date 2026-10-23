"""Copy an exact prior MTC expansion to separate skim and population memory use."""
import copy
import json
import shutil
from pathlib import Path

import activitysim_mtc_inputs as mtc
from build_activitysim_input_bundle import sha256_for_file


def expansion_inputs(*, source_omx, internal_zone_rows, centroid_map,
                     stock_configs_dir, stock_skims_omx, transit_config):
    return {'source_omx_sha256': sha256_for_file(source_omx),
            'zone_rows': internal_zone_rows, 'centroid_map': centroid_map,
            'stock_configs_sha256': mtc.stock_configs_digest(stock_configs_dir),
            'stock_skims_sha256': sha256_for_file(stock_skims_omx),
            'transit_config': transit_config,
            'implementations': {str(p.relative_to(Path.cwd())): sha256_for_file(p)
                                for p in [Path.cwd() / 'scripts/modeling/activitysim_mtc_inputs.py',
                                          Path.cwd() / 'scripts/modeling/activitysim_transit_skims.py']}}


def copy_expansion(directory: Path, *, output_omx: Path, **kwargs):
    """Verify the complete request and both artifacts before copying any bytes.

    This establishes retained-byte custody, not producer authentication or
    scientific validity. It does not select a different adapter or fallback.
    """
    record = json.loads((directory / 'record.json').read_text())
    requested = json.loads(json.dumps(expansion_inputs(**kwargs), sort_keys=True))
    if requested != record['inputs']:
        raise ValueError('Retained expansion inputs differ')
    if set(record['artifacts']) != {'mtc_skims.omx', 'transit_skims.npz'}:
        raise ValueError('Retained expansion artifact inventory differs')
    for name, expected in record['artifacts'].items():
        source = directory / name
        if source.stat().st_size != expected['bytes'] or sha256_for_file(source) != expected['sha256']:
            raise ValueError('Retained expansion artifact hash or size differs')
    output_omx.parent.mkdir(parents=True, exist_ok=True)
    for name in record['artifacts']:
        destination = output_omx if name == 'mtc_skims.omx' else output_omx.with_name(name)
        if destination.exists():
            raise ValueError('Retained expansion destination must be new')
    shutil.copyfile(directory / 'mtc_skims.omx', output_omx)
    shutil.copyfile(directory / 'transit_skims.npz', output_omx.with_name('transit_skims.npz'))
    return copy.deepcopy(record['accounting'])
