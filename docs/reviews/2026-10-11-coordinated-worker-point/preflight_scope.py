"""Bind future fixture resources before any native launch. No launch functions."""
from pathlib import Path

HEAD = '9446f76af65106897eb8a693c5aff9817de5de7f'
BASE = Path('/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009')
POINT = BASE / 'transit-expanded-local-point-20261011-03'
OUT = BASE / 'coordinated-worker-point-20261011-01'
TOOL_SHA = '20d4142678d0d95ec11a4759def1b73fd9190abc9ca19e4b62d067c0b387e639'
IMAGE = 'sha256:ca7871b587ca2c401ac0f325df6249c9aa0d25647ded34631158efc51176767f'
SNAPSHOT = '08090b60e8c1fa07b71c2181704df5295ade9c9af40f45d7f8f2c09dba400acc'
SOURCE_PROJECT = 'openplan-modelpoint-source-2026101133'
TARGET_PROJECT = 'openplan-modelpoint-target-2026101134'
SOURCE_VOLUME = 'openplan_modelpoint_source_20261011_01'
TARGET_VOLUME = 'openplan_modelpoint_target_20261011_01'
HELPERS = (
    'openplan/scripts/ops/worker_journal_snapshot.py',
    'workers/aequilibrae_worker/model_command_journal.py',
    'workers/aequilibrae_worker/model_command_client.py',
    'workers/aequilibrae_worker/model_legacy_kpi_command.py',
    'workers/aequilibrae_worker/model_command_recovery.py',
    'workers/aequilibrae_worker/model_stage_computation.py',
    'workers/aequilibrae_worker/model_package_inputs.py',
)


def verify(observed: dict, expected_helpers: dict) -> None:
    """Refuse a foreign source, reused resource, changed helper or resource cap."""
    if observed['head'] != HEAD or observed['sourceEdits']:
        raise ValueError('model-point-source-build')
    if observed['pointPath'] != str(POINT) or observed['outputPath'] != str(OUT):
        raise ValueError('model-point-private-roots')
    if observed['sourceProject'] != SOURCE_PROJECT or observed['targetProject'] != TARGET_PROJECT:
        raise ValueError('model-point-projects')
    if observed['sourceVolume'] != SOURCE_VOLUME or observed['targetVolume'] != TARGET_VOLUME:
        raise ValueError('model-point-volumes')
    if observed['existingContainers'] or observed['existingVolumes']:
        raise ValueError('model-point-existing-resources')
    if observed['toolSha256'] != TOOL_SHA:
        raise ValueError('model-point-backup-tool')
    if observed['imageId'] != IMAGE:
        raise ValueError('model-point-cached-image')
    point = observed['retainedPoint']
    if (point['state'] != 'passed-native' or point['snapshotId'] != SNAPSHOT
            or point['sourceHead'] != 'bf1f6ffa710b11b7f36747a676943edab667a4ae'
            or point['capturedFiles'] != 1541 or point['capturedBytes'] != 644693866):
        raise ValueError('model-point-retained-input')
    if set(expected_helpers) != set(HELPERS) or observed['helperHashes'] != expected_helpers:
        raise ValueError('model-point-helper-identity')
    if observed['controlsScopeSha256'] != observed['scopeSha256']:
        raise ValueError('model-point-control-source')
    if (observed['databaseMemoryBytes'] != 1024 ** 3
            or observed['databaseSwapBytes'] != 1024 ** 3
            or observed['driverMemoryBytes'] != 1024 ** 3
            or observed['driverSwapBytes'] != 0
            or observed['restMemoryBytes'] != 128 * 1024 ** 2
            or observed['cpuQuotaPercent'] != 100):
        raise ValueError('model-point-resource-caps')
    if observed['freeDiskBytes'] < 10 * 1024 ** 3 or observed['availableMemoryBytes'] < 4 * 1024 ** 3:
        raise ValueError('model-point-resource-headroom')
