"""Retain agreement outputs after the dispatcher's scientific provenance checks.

This checkpoint does not grant restart ownership or scientific acceptance.
"""
from pathlib import Path
import tempfile
import model_record_files as files
import model_stage_computation as computation
from model_stage_preparation import file_facts

OUTPUTS = {'json_path': 'corridor_agreement.json',
           'markdown_path': 'corridor_agreement.md',
           'geojson_path': 'corridor_agreement.geojson'}
SOURCES = ('first_csv', 'second_csv', 'loaded_links_geojson',
           'first_manifest', 'second_manifest', 'noise_floor_json')


def retain(directory, *, base_url, deployment_id, run_id, stage_id, compare, arguments):
    if arguments.get('force') is not False:
        raise ValueError('Agreement recovery forbids replacement')
    output = Path(arguments['output_dir']).resolve()
    source_paths = {key: Path(arguments[key]).resolve() for key in SOURCES if arguments.get(key) is not None}
    if not {'first_csv', 'second_csv', 'loaded_links_geojson'} <= source_paths.keys():
        raise ValueError('Both assignments and retained geometry are required')
    settings = {key: value for key, value in arguments.items() if key not in SOURCES and key != 'output_dir'}
    facts = {key: {'path': str(path), **file_facts(path)} for key, path in source_paths.items()}
    inputs = {'settings': settings, 'sources': facts, 'output_dir': str(output)}

    def compute():
        # The comparator may write freely only into a new private scratch directory.
        with tempfile.TemporaryDirectory(prefix='openplan-agreement-') as temporary:
            result = compare(**{**arguments, 'output_dir': temporary})
            records = {}
            for key, name in OUTPUTS.items():
                path = Path(result[key])
                if path.resolve() != Path(temporary) / name or path.is_symlink():
                    raise ValueError('Agreement output escaped its private directory')
                records[name] = path.read_bytes().hex()
            after = {key: {'path': str(path), **file_facts(path)} for key, path in source_paths.items()}
            if after != facts:
                raise ValueError('Agreement sources changed during computation')
            result = {**result, 'output_dir': str(output), **{key: str(output / name) for key, name in OUTPUTS.items()}}
            return {'result': result, 'records': records}

    retained = computation.compute_once(directory, base_url=base_url,
        deployment_id=deployment_id, run_id=run_id, stage_id=stage_id,
        name='demand-model-agreement', inputs=inputs, compute=compute)
    if set(retained) != {'result', 'records'} or set(retained['records']) != set(OUTPUTS.values()):
        raise ValueError('Incomplete retained agreement')
    files.materialize(output, {name: bytes.fromhex(content) for name, content in retained['records'].items()})
    return retained['result']
