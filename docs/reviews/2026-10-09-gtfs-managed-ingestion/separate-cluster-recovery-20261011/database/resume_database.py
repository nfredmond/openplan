"""Validate catalog semantics separately while retaining the failed producer."""
import hashlib, json, subprocess, time
from pathlib import Path
import run_database as r
import schema_semantics as s
import resume_guards as guard

OUT = Path(__file__).parent


def main():
    started = time.monotonic()
    r.os.umask(0o077)
    failed = json.loads((OUT / 'progress-private.json').read_text())
    controls = json.loads((OUT / 'schema-controls.json').read_text())
    actual_source = {name: r.files.digest(OUT / name) for name in failed['executionSourceSha256']}
    guard.preflight(failed['state'], failed['executionSourceSha256'], actual_source,
                    controls['sourceSha256'], r.files.digest(OUT / 'schema_semantics.py'))
    r.receipt = json.loads((OUT / 'container-receipt.json').read_text())
    r.g.verify_container(r.inspect(), r.receipt, r.VOLUME, OUT / 'mounted-root-private.key')
    r.record = {'state': 'separate-native-catalog-continuation', 'originalProducerState': failed['state'], 'originalProducerFailure': 'coordinated-schema-image-differs', 'commands': []}
    r.save = lambda: (OUT / 'catalog-continuation-02-progress-private.json').write_text(json.dumps(r.record, indent=2)+'\n')
    r.command(['docker', 'start', r.receipt['id']], 'restart-initialized-cluster')
    for _ in range(120):
        ready = subprocess.run(['docker', 'exec', r.receipt['id'], 'pg_isready', '-U', r.g.ADMIN], capture_output=True)
        if ready.returncode == 0: break
        time.sleep(.2)
    else: raise TimeoutError('Restored database restart readiness')
    r.g.verify_container(r.inspect(), r.receipt, r.VOLUME, OUT / 'mounted-root-private.key')
    original_container = 'a4181e334bb0da63e213aaea5966d163e24faab58ddb3e6122665b3c41042cce'
    original_database = 'openplan_recovered_2553c3e83129432e86c97cf3aef72aee'
    bundle = r.POINT / 'source-point-private'
    restored = OUT / 'restored-private' / bundle.relative_to('/')
    protected = restored / 'configuration-private'
    target = json.loads((protected / 'properties-binding-private.json').read_text())['target']['target']
    values = []
    for label, container, database in [('source', original_container, original_database), ('target', r.receipt['id'], target)]:
        clients = int(r.archive.sql(container, "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend'", database))
        guard.quiescent(clients)
        text = r.command(['docker', 'exec', container, 'pg_dump', '-U', r.g.ADMIN, '-d', database, '--schema-only'], label+'-continuation-schema').decode()
        catalog = json.loads(r.archive.sql(container, s.CATALOG_QUERY, database))
        (OUT / (label+'-catalog-private.json')).write_text(json.dumps(catalog, indent=2)+'\n')
        values.append((text, catalog))
    baseline = json.loads((r.POINT / 'original-before-inventory-private.json').read_text())
    normalized = '\n'.join(line for line in values[0][0].splitlines() if not line.startswith(('--', '\\restrict ', '\\unrestrict ')))
    source_sha = hashlib.sha256(normalized.encode()).hexdigest()
    observed = s.verify(values[0][0], values[1][0], values[0][1], values[1][1])
    r.image.CONTAINER = r.receipt['id']
    actual = r.image.inventory(target, 'continuation-native-target')
    guard.native_records(source_sha, baseline, actual)
    r.g.verify_properties(json.loads((protected / 'database-properties-private.json').read_text()), r.archive.database_properties(r.receipt['id'], target))
    expected_roles = json.loads((protected / 'roles-inventory-private.json').read_text())
    roles = (protected / 'roles-private.sql').read_text()
    r.g.verify_roles(expected_roles, json.loads(r.archive.role_inventory(r.receipt['id'])), roles,
                     r.command(['docker', 'exec', r.receipt['id'], 'pg_dumpall', '-U', r.g.ADMIN, '--roles-only'], 'continuation-role-dump').decode())
    r.archive._keys.require_mounted_bytes(r.receipt, r.archive._keys.read_key(protected / 'pgsodium-root-private.key', private=True))
    census = json.loads((r.POINT / 'point-file-inventory-private.json').read_text())
    r.files.equal(census, r.files.inventory(restored)); r.files.equal(census, r.files.inventory(bundle))
    result = {'state': 'passed-native-database-continuation', 'originalProducerState': failed['state'],
              'originalProducerFailure': 'coordinated-schema-image-differs', 'wallSeconds': round(time.monotonic()-started,3),
              'targetDatabase': target, 'databaseContainerId': r.receipt['id'], 'snapshotId': r.g.SNAPSHOT,
              'tables': len(actual['tables']), 'sequences': len(actual['sequences']),
              'capturedFiles': len(census), 'capturedBytes': sum(row['bytes'] for row in census.values()),
              'schema': observed, 'roleAttributesPasswordsAndGrantsEqual': True,
              'independentlyMountedKeyBytesEqual': True, 'nativeRestartOfInitializedCluster': True,
              'originalSourceSchemaMatchesCapturedPoint': True, 'originalCapturedPointAndRestoredFilesUnchanged': True,
              'scope': 'Separate local cluster and volume, same physical host/disk. No API/installed CLI/Storage download, historical decryption or browser acceptance.'}
    (OUT / 'database-continuation-02-result.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'state':result['state'],'wallSeconds':result['wallSeconds'],'schema':observed}),flush=True)


if __name__ == '__main__': main()
