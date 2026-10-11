"""Refuse foreign resources and incomplete role restoration before observation."""
import hashlib
from pathlib import Path

PROJECT = 'openplan-restore-target-2026101132'
NAME = 'supabase_db_' + PROJECT
IMAGE = 'sha256:ca7871b587ca2c401ac0f325df6249c9aa0d25647ded34631158efc51176767f'
PURPOSE = 'gtfs-separate-cluster-point-20261011-02'
OUT = Path(__file__).parent
KEY = '/etc/postgresql-custom/pgsodium_root.key'
ADMIN = 'supabase_admin'
SNAPSHOT = '08090b60e8c1fa07b71c2181704df5295ade9c9af40f45d7f8f2c09dba400acc'
TOOL_SHA = '20d4142678d0d95ec11a4759def1b73fd9190abc9ca19e4b62d067c0b387e639'


def require(condition, reason):
    if not condition:
        raise ValueError(reason)


def verify_capture(tool_sha, result, controls_sha, source_sha):
    require(tool_sha == TOOL_SHA, 'cluster-backup-tool')
    require(result['state'] == 'passed-native' and result['snapshotId'] == SNAPSHOT
            and result['sourceHead'] == 'bf1f6ffa710b11b7f36747a676943edab667a4ae'
            and result['capturedFiles'] == 1541 and result['capturedBytes'] == 644693866,
            'cluster-captured-point')
    require(controls_sha == source_sha, 'cluster-controls-source')


def verify_unused(container_exists, volume_exists, free_disk, available_memory):
    require(not container_exists, 'cluster-existing-container')
    require(not volume_exists, 'cluster-existing-volume')
    require(free_disk >= 5 * 1024 ** 3 and available_memory >= 3 * 1024 ** 3,
            'cluster-resource-headroom')


def verify_container(info, receipt, volume, key):
    require(info['Id'] == receipt['id'] and info['Name'] == '/' + NAME,
            'cluster-container-identity')
    require(info['Image'] == IMAGE, 'cluster-image')
    require(info['Config']['Entrypoint'] == ['sh']
            and hashlib.sha256('\n'.join(info['Config']['Cmd']).encode()).hexdigest()
            == receipt['commandSha256'], 'cluster-command')
    labels = info['Config']['Labels']
    require(labels.get('com.supabase.cli.project') == PROJECT
            and labels.get('openplan.purpose') == PURPOSE, 'cluster-owner')
    host = info['HostConfig']
    require(host['Memory'] == 1073741824 and host['MemorySwap'] == 1073741824
            and host['NanoCpus'] == 1000000000 and host['PidsLimit'] == 128,
            'cluster-limits')
    require(host['NetworkMode'] == 'none' and not host['PortBindings']
            and list(info['NetworkSettings']['Networks']) == ['none'],
            'cluster-network')
    mounts = info['Mounts']
    require(len(mounts) == 2, 'cluster-mount-count')
    require(any(m['Type'] == 'volume' and m['Name'] == volume
                and m['Destination'] == '/var/lib/postgresql/data' and m['RW']
                for m in mounts), 'cluster-data-volume')
    require(any(m['Type'] == 'bind' and m['Source'] == str(key)
                and m['Destination'] == KEY and not m['RW'] for m in mounts),
            'cluster-key-bind')


def prepare_role_sql(text, expected_hash, existing, source_inventory):
    require(hashlib.sha256(text.encode()).hexdigest() == expected_hash,
            'cluster-role-captured-bytes')
    expected_builtin = {r['rolname'] for r in source_inventory['roles']
                        if r['rolname'].startswith('pg_')}
    require(set(existing) == expected_builtin | {ADMIN},
            'cluster-role-bootstrap')
    statement = 'CREATE ROLE supabase_admin;'
    require(text.splitlines().count(statement) == 1,
            'cluster-role-bootstrap-statement')
    return '\n'.join('-- Existing verified bootstrap administrator.'
                     if line == statement else line for line in text.splitlines()) + '\n'


def normalize_role_sql(text):
    return '\n'.join(line for line in text.splitlines()
                     if line.strip() and not line.startswith(
                         ('--', '\\restrict ', '\\unrestrict ')))


def verify_roles(expected_inventory, actual_inventory, expected_sql, actual_sql):
    require(expected_inventory == actual_inventory, 'cluster-role-catalog')
    require(normalize_role_sql(expected_sql) == normalize_role_sql(actual_sql),
            'cluster-role-password-and-grants')


def verify_properties(expected, actual):
    require(expected == actual, 'cluster-database-properties')


def verify_database_bootstrap(existing):
    require(set(existing) == {'postgres', 'template0', 'template1'},
            'cluster-existing-database')


def verify_property_command(target, statement, binding):
    require(binding['target'] == target, 'cluster-property-command-target')
    require(binding['sha256'] == hashlib.sha256(statement).hexdigest(),
            'cluster-property-command-bytes')
