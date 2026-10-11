"""Retain explicit worker assessments and exact private configuration offline.

This does not discover installed services, capture selected roots, stop writers,
contact a provider or establish complete installation coverage.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re

import worker_root_snapshot as root
import worker_root_set_snapshot as root_set

REPO = Path(__file__).resolve().parents[3]
FORMAT = 'openplan-installation-worker-inventory-v1'
PROFILE_FORMAT = 'openplan-installation-worker-profile-v1'
CATALOGUE_FORMAT = 'openplan-worker-entrypoint-catalogue-v1'
FAMILIES = {
    'aequilibrae': ('workers/aequilibrae_worker/main.py', 'worker:aequilibrae'),
    'activitysim': ('workers/activitysim_worker/main.py', 'worker:activitysim'),
    'county-onramp': ('workers/county_onramp_worker/main.py', None),
    'ocr': ('workers/ocr_worker/main.py', None),
    'odm': ('workers/odm_worker/main.py', None),
    **{name: (f'openplan/scripts/workers/{name}.ts', f'worker:{name}') for name in (
        'engagement-email', 'document-exports', 'provider-api', 'translation-generation',
        'synthesis-preparation', 'gtfs-ingestion', 'synthesis-generation',
        'contract-calculations', 'synthesis-execution')},
    'planner-agent-connector': ('workers/planner_agent_connector/connector.mjs', None),
}
LAUNCHERS = {name: f'workers/{name}_worker/run.sh' for name in ('aequilibrae', 'activitysim')}
KNOWN_NPM_COMMANDS = {
    **{f'worker:{name}': f'bash ../workers/{name}_worker/run.sh' for name in LAUNCHERS},
    **{f'worker:{name}': f'node --env-file{suffix}=.env.local --conditions=react-server --import tsx scripts/workers/{name}.ts'
       for name, suffix in {
           'engagement-email': '', 'document-exports': '', 'provider-api': '',
           'translation-generation': '', 'synthesis-generation': '', 'contract-calculations': '',
           'synthesis-preparation': '-if-exists', 'gtfs-ingestion': '-if-exists',
           'synthesis-execution': '-if-exists',
       }.items()},
}


def json_bytes(value):
    return (json.dumps(value, indent=2, sort_keys=True) + '\n').encode()


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Worker inventory JSON has duplicate keys')
        result[key] = value
    return result


def read_json(payload):
    return json.loads(payload, object_pairs_hook=unique_object)


def source_sha(path, deadline):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        while chunk := stream.read(1024 * 1024):
            root.check_deadline(deadline)
            digest.update(chunk)
    return digest.hexdigest()


def catalogue(repo, deadline):
    """Bind known source entrypoints; never execute npm commands or dotenv files."""
    package_payload = (repo / 'openplan/package.json').read_bytes()
    package = read_json(package_payload)
    if not isinstance(package, dict) or not isinstance(package.get('scripts'), dict) or any(not isinstance(value, str) for value in package['scripts'].values()):
        raise ValueError('Worker software package scripts are invalid')
    scripts = {key: value for key, value in package['scripts'].items() if key.startswith('worker:')}
    expected_scripts = {script for _, script in FAMILIES.values() if script is not None}
    python_files = {path.relative_to(repo).as_posix() for path in (repo / 'workers').glob('*/main.py')}
    expected_python = {path for path, _ in FAMILIES.values() if path.endswith('/main.py')}
    if set(scripts) != expected_scripts or scripts != KNOWN_NPM_COMMANDS or python_files != expected_python:
        raise ValueError('Worker entrypoint catalogue needs review')
    families = {}
    for name, (relative, script) in FAMILIES.items():
        root.check_deadline(deadline)
        launcher = LAUNCHERS.get(name)
        families[name] = {'entrypoint': relative, 'sha256': source_sha(repo / relative, deadline),
                          'npmScript': script, 'npmCommand': scripts.get(script),
                          'launcher': launcher, 'launcherSha256': source_sha(repo / launcher, deadline) if launcher else None}
    return {'format': CATALOGUE_FORMAT, 'scope': 'known_entrypoint_sources',
            'packageSha256': hashlib.sha256(package_payload).hexdigest(), 'families': families}


def safe_id(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,63}', value):
        raise ValueError('Worker inventory ID is unsafe')


def validate_profile(payload, recorded_catalogue):
    """Keep unavailable, absent and unassessed declarations distinct from zero."""
    profile = read_json(payload)
    if not isinstance(profile, dict) or set(profile) != {'format', 'installationId', 'roots', 'configuration', 'workers'} or profile.get('format') != PROFILE_FORMAT:
        raise ValueError('Worker installation profile format differs')
    safe_id(profile['installationId'])
    root_set.read_inventory(json_bytes({'format': root_set.INVENTORY_FORMAT, 'roots': profile['roots']}))
    root_ids = {item['id'] for item in profile['roots']}
    configuration = profile['configuration']
    if not isinstance(configuration, list):
        raise ValueError('Worker configuration selection is not a list')
    config_ids = set()
    for item in configuration:
        if not isinstance(item, dict) or set(item) != {'id', 'path'}:
            raise ValueError('Worker configuration selection shape differs')
        safe_id(item['id'])
        if item['id'] in config_ids:
            raise ValueError('Worker configuration IDs are duplicated')
        config_ids.add(item['id'])
        if not isinstance(item['path'], str) or not Path(item['path']).is_absolute():
            raise ValueError('Worker configuration path is not absolute')
    if not isinstance(recorded_catalogue, dict) or recorded_catalogue.get('format') != CATALOGUE_FORMAT or recorded_catalogue.get('scope') != 'known_entrypoint_sources' or not isinstance(recorded_catalogue.get('families'), dict):
        raise ValueError('Retained worker catalogue format differs')
    workers = profile['workers']
    if not isinstance(workers, dict) or set(workers) != set(recorded_catalogue['families']):
        raise ValueError('Every known worker family requires an assessment')
    used_roots, used_configs = set(), set()
    for assessment in workers.values():
        if not isinstance(assessment, dict) or set(assessment) != {'state', 'custody', 'rootIds', 'configurationIds', 'notes'}:
            raise ValueError('Worker assessment shape differs')
        if assessment['state'] not in ('configured', 'not_deployed', 'unassessed'):
            raise ValueError('Worker assessment state differs')
        if assessment['custody'] not in ('local_roots', 'database_and_storage', 'external', 'unassessed'):
            raise ValueError('Worker custody assessment differs')
        if not isinstance(assessment['notes'], str) or not assessment['notes'].strip():
            raise ValueError('Worker assessment needs an explanation')
        for key, available, used in (('rootIds', root_ids, used_roots), ('configurationIds', config_ids, used_configs)):
            values = assessment[key]
            if not isinstance(values, list) or any(not isinstance(value, str) for value in values) or len(values) != len(set(values)) or not set(values) <= available:
                raise ValueError('Worker assessment references differ')
            used.update(values)
        if assessment['state'] == 'configured' and not assessment['configurationIds']:
            raise ValueError('Configured worker needs retained configuration')
        if assessment['state'] == 'configured' and assessment['custody'] == 'local_roots' and not assessment['rootIds']:
            raise ValueError('Local worker custody needs a selected root')
        if assessment['state'] != 'configured' and assessment['custody'] != 'unassessed':
            raise ValueError('Unconfigured worker custody must remain unassessed')
    if used_roots != root_ids or used_configs != config_ids:
        raise ValueError('Selected worker state has no assessment reference')
    return profile


def write_private(path, payload, deadline):
    root.check_deadline(deadline)
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb') as stream:
        stream.write(payload)
        stream.flush()
        os.fsync(stream.fileno())


def selection(profile, profile_entry, catalogue_entry, configuration_entries):
    return {'format': root_set.INVENTORY_FORMAT, 'roots': profile['roots'],
            'installationId': profile['installationId'], 'coverage': 'operator_declared',
            'installationCoverage': 'unassessed', 'workerAssessments': profile['workers'],
            'profileEntry': profile_entry, 'catalogueEntry': catalogue_entry,
            'configurationEntries': configuration_entries}


def capture(profile_path, destination, *, writers_quiesced, timeout=120, repo=REPO):
    """Retain declarations/configuration before publishing a root selection."""
    if writers_quiesced is not True:
        raise ValueError('Quiesce configuration writers before inventory capture')
    deadline = root_set.deadline_for(timeout)
    profile_path, destination = Path(profile_path).absolute(), Path(destination).absolute()
    original_profile = root.entry(profile_path, deadline)
    if original_profile['kind'] != 'file' or original_profile['sizeBytes'] > 1024 * 1024:
        raise ValueError('Worker profile must be a private file below one MiB')
    payload = profile_path.read_bytes()
    recorded_catalogue = catalogue(Path(repo), deadline)
    profile = validate_profile(payload, recorded_catalogue)
    root.journal.private_path(destination.parent, directory=True)
    destination = destination.parent.resolve(strict=True) / destination.name
    sources = {}
    for item in profile['roots']:
        path = Path(item['path'])
        root.journal.private_path(path, directory=True)
        path = path.resolve(strict=True)
        if destination == path or path in destination.parents or destination in path.parents:
            raise ValueError('Worker inventory destination overlaps a selected root')
        if any(path == other or path in other.parents or other in path.parents for other in sources.values()):
            raise ValueError('Selected worker roots overlap')
        sources[item['id']] = path
    before = {item['id']: root.entry(Path(item['path']), deadline) for item in profile['configuration']}
    if any(row['kind'] != 'file' for row in before.values()):
        raise ValueError('Worker configuration must be a private file')
    destination.mkdir(mode=0o700)
    root.journal.private_path(destination, directory=True)
    write_private(destination / 'profile.json', payload, deadline)
    (destination / 'profile.json').chmod(original_profile['mode'])
    root.journal.sync_file(destination / 'profile.json')
    if root.entry(destination / 'profile.json', deadline) != original_profile:
        raise ValueError('Retained worker profile bytes differ')
    write_private(destination / 'catalogue.json', json_bytes(recorded_catalogue), deadline)
    folder = destination / 'configuration'
    folder.mkdir(mode=0o700)
    copied = {}
    for item in profile['configuration']:
        target = folder / item['id']
        with Path(item['path']).open('rb') as original:
            with os.fdopen(os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb') as output:
                while chunk := original.read(1024 * 1024):
                    root.check_deadline(deadline)
                    output.write(chunk)
                output.flush()
                os.fsync(output.fileno())
        target.chmod(before[item['id']]['mode'])
        root.journal.sync_file(target)
        copied[item['id']] = root.entry(target, deadline)
        if copied[item['id']] != before[item['id']]:
            raise ValueError('Retained worker configuration bytes differ')
    root.sync_directory(folder)
    catalogue_entry = root.entry(destination / 'catalogue.json', deadline)
    chosen = selection(profile, original_profile, catalogue_entry, copied)
    write_private(destination / 'inventory.json', json_bytes(chosen), deadline)
    for item in profile['configuration']:
        if root.entry(Path(item['path']), deadline) != before[item['id']]:
            raise ValueError('Worker configuration changed during capture')
    if root.entry(profile_path, deadline) != original_profile:
        raise ValueError('Worker profile changed during capture')
    if catalogue(Path(repo), deadline) != recorded_catalogue:
        raise ValueError('Worker software catalogue changed during capture')
    root.sync_directory(destination)
    record = {'format': FORMAT, 'coverage': 'operator_declared',
              'installationCoverage': 'unassessed', 'quiescence': 'operator_declared',
              'entries': root.inventory(destination, deadline)}
    root_set.publish(destination, record, deadline)
    return record


def verify(destination, *, timeout=120):
    """Check retained declarations/configuration without requiring original roots."""
    deadline = root_set.deadline_for(timeout)
    destination = Path(destination).absolute()
    entries = root.inventory(destination, deadline)
    record = read_json((destination / 'snapshot.json').read_bytes())
    if not isinstance(record, dict) or record.get('format') != FORMAT or record.get('coverage') != 'operator_declared' or record.get('installationCoverage') != 'unassessed' or record.get('quiescence') != 'operator_declared':
        raise ValueError('Worker inventory manifest format differs')
    entries.pop('snapshot.json')
    if entries != record.get('entries'):
        raise ValueError('Retained worker inventory bytes or layout differ')
    if {path.name for path in destination.iterdir()} != {'profile.json', 'catalogue.json', 'configuration', 'inventory.json', 'snapshot.json'}:
        raise ValueError('Worker inventory package layout differs')
    profile = validate_profile((destination / 'profile.json').read_bytes(), read_json((destination / 'catalogue.json').read_bytes()))
    expected_configs = {item['id'] for item in profile['configuration']}
    if {path.name for path in (destination / 'configuration').iterdir()} != expected_configs:
        raise ValueError('Worker inventory configuration layout differs')
    copied = {name: entries['configuration/' + name] for name in expected_configs}
    expected = selection(profile, entries['profile.json'], entries['catalogue.json'], copied)
    if (destination / 'inventory.json').read_bytes() != json_bytes(expected):
        raise ValueError('Worker root selection binding differs')
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--profile', type=Path)
    parser.add_argument('--destination', type=Path)
    parser.add_argument('--verify', type=Path)
    parser.add_argument('--writers-quiesced', action='store_true')
    parser.add_argument('--timeout', type=float, default=120)
    args = parser.parse_args()
    if args.verify:
        if args.profile or args.destination or args.writers_quiesced:
            parser.error('Verification cannot select capture arguments')
    elif not args.profile or not args.destination:
        parser.error('Capture requires profile and destination')
    try:
        result = verify(args.verify, timeout=args.timeout) if args.verify else capture(
            args.profile, args.destination, writers_quiesced=args.writers_quiesced, timeout=args.timeout)
    except (OSError, ValueError, TimeoutError, KeyError, RecursionError) as error:
        print('Worker inventory unavailable: ' + type(error).__name__)
        return 1
    print(json.dumps({'format': result['format'], 'installationCoverage': result['installationCoverage'],
                      'entries': len(result['entries'])}))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
