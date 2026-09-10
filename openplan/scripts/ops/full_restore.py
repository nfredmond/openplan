"""Full database and Storage restoration for the owned disposable local drill.

The caller creates both fresh CLI projects. This helper refuses other projects,
nonempty targets, mismatched runtime images/roles and scheduled SQL jobs. It keeps
the target's bootstrap database and imports into a new empty database first.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import tarfile
import time

SERVICES = ('db', 'auth', 'rest', 'storage')


def run(args: list[str], **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def output(args: list[str]) -> str:
    return subprocess.check_output(args, text=True).strip()


def sql(container: str, query: str, database='postgres') -> str:
    return output(['docker', 'exec', container, 'psql', '-X', '-U',
                   'supabase_admin', '-d', database, '-v', 'ON_ERROR_STOP=1',
                   '-At', '-c', query])


def require_project(project: str, kind: str) -> dict:
    """Only the existing drill's generated project names are eligible."""
    if not re.fullmatch(r'openplan-restore-' + kind + r'-[0-9]+', project):
        raise ValueError('Only an owned disposable restore-drill project is allowed')
    result = {}
    for service in SERVICES:
        name = f'supabase_{service}_{project}'
        info = json.loads(output(['docker', 'inspect', name]))[0]
        if info['Config']['Labels'].get('com.supabase.cli.project') != project:
            raise ValueError('Container project identity differs')
        result[service] = {'name': name, 'image': info['Config']['Image'],
                           'imageId': info['Image']}
    return result


def require_matching(source: dict, target: dict):
    if any(source[s]['imageId'] != target[s]['imageId'] for s in SERVICES):
        raise ValueError('Source and target service images must match exactly')


def role_inventory(db: str) -> str:
    return sql(db, """SELECT jsonb_build_object('roles',
      (SELECT jsonb_agg(to_jsonb(r) ORDER BY rolname) FROM
       (SELECT rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,
        rolreplication,rolbypassrls,rolconnlimit,rolvaliduntil,rolconfig FROM pg_roles) r),
      'memberships',(SELECT jsonb_agg(jsonb_build_array(a.rolname,b.rolname,
       m.admin_option,m.inherit_option,m.set_option) ORDER BY a.rolname,b.rolname)
       FROM pg_auth_members m JOIN pg_roles a ON a.oid=m.roleid
       JOIN pg_roles b ON b.oid=m.member));""")


def require_empty_target(db: str):
    # These are empty in the caller's freshly migrated target. Built-in reference
    # rows and buckets are expected; the bootstrap database is retained intact.
    for name in ('public.workspaces', 'auth.users', 'storage.objects'):
        if sql(db, f'SELECT count(*) FROM {name}') != '0':
            raise ValueError(f'Refusing a target with existing records: {name}')
    if sql(db, "SELECT count(*) FROM pg_database WHERE datname IN "
               "('openplan_recovered','openplan_bootstrap_preserved')") != '0':
        raise ValueError('Recovery database names already exist; retain and inspect them')


def require_no_jobs(db: str):
    if sql(db, "SELECT to_regclass('cron.job') IS NOT NULL") == 't':
        if sql(db, 'SELECT count(*) FROM cron.job') != '0':
            raise ValueError('Scheduled SQL jobs require a separate quiescence procedure')


def database_properties(db: str, database='postgres') -> dict:
    # Settings can contain credentials. Return only their hash in evidence.
    settings = sql(db, """SELECT coalesce(jsonb_agg(jsonb_build_array(r.rolname,s.setconfig)
      ORDER BY r.rolname NULLS FIRST),'[]') FROM pg_db_role_setting s
      LEFT JOIN pg_roles r ON r.oid=s.setrole
      WHERE s.setdatabase=(SELECT oid FROM pg_database WHERE datname=current_database())""", database)
    properties = json.loads(sql(db, """SELECT jsonb_build_object('owner',pg_get_userbyid(datdba),
      'encoding',pg_encoding_to_char(encoding),'collate',datcollate,'ctype',datctype,
      'localeProvider',datlocprovider,'locale',datlocale,'collationVersion',datcollversion,
      'connectionLimit',datconnlimit,'acl',(SELECT jsonb_agg(jsonb_build_array(
        pg_get_userbyid(a.grantor),CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
        a.privilege_type,a.is_grantable) ORDER BY a.grantor,a.grantee,a.privilege_type)
        FROM aclexplode(coalesce(datacl,acldefault('d',datdba))) a))
      FROM pg_database WHERE datname=current_database()""", database))
    # Role OIDs can differ between independently initialized clusters.
    properties['acl'].sort()
    normalized_settings = json.loads(settings)
    for row in normalized_settings:
        row[1].sort()
    properties['settingsSha256'] = hashlib.sha256(json.dumps(normalized_settings, sort_keys=True).encode()).hexdigest()
    return properties


def restore_database_properties(source_db: str, target_db: str, destination: Path):
    # The fresh target has no custom database grants. Recreate the captured
    # default-local ACL under its original grantor, rather than broadening access.
    if sql(source_db, """SELECT count(*) FROM pg_database d,
      LATERAL aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a
      WHERE d.datname=current_database() AND a.grantor<>d.datdba""") != '0':
        raise ValueError('Delegated database grantors need a separate configuration restore')
    commands = sql(source_db, """SELECT format('SET ROLE %I; REVOKE ALL PRIVILEGES ON DATABASE openplan_recovered FROM PUBLIC; REVOKE ALL PRIVILEGES ON DATABASE openplan_recovered FROM %I;',
      pg_get_userbyid(datdba),pg_get_userbyid(datdba)) FROM pg_database WHERE datname=current_database()""")
    commands += '\n' + sql(source_db, """SELECT format('GRANT %s ON DATABASE openplan_recovered TO %s%s;',
      a.privilege_type,CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(a.grantee)) END,
      CASE WHEN a.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END)
      FROM pg_database d,LATERAL aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a
      WHERE d.datname=current_database() ORDER BY a.grantee,a.privilege_type""")
    commands += '\nRESET ROLE;\n' + sql(source_db, "SELECT format('ALTER DATABASE openplan_recovered CONNECTION LIMIT %s;',datconnlimit) FROM pg_database WHERE datname=current_database()")
    commands += '\n' + sql(source_db, """SELECT CASE WHEN s.setrole=0
      THEN format('ALTER DATABASE openplan_recovered SET %I TO %L;',split_part(item,'=',1),substr(item,strpos(item,'=')+1))
      ELSE format('ALTER ROLE %I IN DATABASE openplan_recovered SET %I TO %L;',r.rolname,split_part(item,'=',1),substr(item,strpos(item,'=')+1)) END
      FROM pg_db_role_setting s LEFT JOIN pg_roles r ON r.oid=s.setrole,
      LATERAL unnest(s.setconfig) item WHERE s.setdatabase=(SELECT oid FROM pg_database WHERE datname=current_database())""")
    result = subprocess.run(['docker', 'exec', '-i', target_db, 'psql', '-X', '-U', 'supabase_admin',
                             '-d', 'template1', '-v', 'ON_ERROR_STOP=1', '--single-transaction'],
                            input=commands, text=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    if result.returncode:
        (destination/'private-settings-error.log').write_text(result.stderr)
        raise RuntimeError('Database configuration restore failed; inspect the private settings log')


def stream_hash(args: list[str]) -> str:
    digest = hashlib.sha256()
    with subprocess.Popen(args, stdout=subprocess.PIPE) as process:
        assert process.stdout is not None
        while block := process.stdout.read(1024 * 1024):
            digest.update(block)
        if process.wait() != 0:
            raise RuntimeError('Snapshot command failed')
    return digest.hexdigest()


def schema_hash(db: str, database='postgres') -> str:
    schema = output(['docker', 'exec', db, 'pg_dump', '-U', 'supabase_admin',
                     '-d', database, '--schema-only'])
    # PostgreSQL generates a random psql restriction token for each dump.
    stable = '\n'.join(line for line in schema.splitlines()
                       if not line.startswith(('\\restrict ', '\\unrestrict ')))
    return hashlib.sha256(stable.encode()).hexdigest()


def database_inventory(db: str) -> dict:
    """Census tables, materialized views, sequence positions and large objects."""
    names = json.loads(sql(db, """SELECT coalesce(jsonb_agg(format('%I.%I',n.nspname,c.relname)
      ORDER BY n.nspname,c.relname),'[]') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE c.relkind IN ('r','m') AND n.nspname !~ '^pg_' AND n.nspname<>'information_schema'"""))
    # Large-object pages and ownership live in system tables but are durable data.
    names += ['pg_catalog.pg_largeobject', 'pg_catalog.pg_largeobject_metadata']
    rows = {}
    for name in names:
        query = f'COPY (SELECT to_jsonb(t)::text FROM {name} t ORDER BY to_jsonb(t)::text) TO STDOUT'
        rows[name] = {'rows': int(sql(db, f'SELECT count(*) FROM {name}')),
                      'sha256': stream_hash(['docker', 'exec', db, 'psql', '-X', '-U',
                          'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At', '-c', query])}
    sequences = json.loads(sql(db, """SELECT coalesce(jsonb_agg(format('%I.%I',n.nspname,c.relname)
      ORDER BY n.nspname,c.relname),'[]') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE c.relkind='S' AND n.nspname !~ '^pg_' AND n.nspname<>'information_schema'"""))
    sequence_state = {name: json.loads(sql(db, f'SELECT jsonb_build_array(last_value,is_called) FROM {name}')) for name in sequences}
    return {'tables': rows, 'sequences': sequence_state, 'schemaSha256': schema_hash(db), 'databaseProperties': database_properties(db)}


def compare_inventory(before: dict, after: dict):
    if before != after:
        changed = sorted(name for name in set(before['tables']) | set(after['tables'])
                         if before['tables'].get(name) != after['tables'].get(name))
        raise ValueError('Restored database differs: ' + ', '.join(changed) +
                         ('; schema changed' if before['schemaSha256'] != after['schemaSha256'] else '') +
                         ('; sequence state changed' if before.get('sequences') != after.get('sequences') else '') +
                         ('; database ownership, permissions or settings changed' if before.get('databaseProperties') != after.get('databaseProperties') else ''))


def storage_inventory(archive: Path) -> dict:
    """Reject escaping paths and links before extracting a trusted local archive."""
    files = {}
    with tarfile.open(archive, 'r:gz') as tar:
        seen = set()
        for member in tar:
            path = PurePosixPath(member.name)
            if path.is_absolute() or '..' in path.parts or not (member.isfile() or member.isdir()):
                raise ValueError('Storage archive contains an unsafe path or entry')
            name = str(path)
            if name in seen:
                raise ValueError('Storage archive contains duplicate paths')
            seen.add(name)
            if member.isfile():
                handle = tar.extractfile(member)
                assert handle is not None
                files[name] = {'bytes': member.size, 'sha256': hashlib.file_digest(handle, 'sha256').hexdigest()}
    return files


def storage_archive(storage: dict, destination: Path):
    with destination.open('xb') as handle:
        run(['docker', 'run', '--rm', '--network', 'none', '--volumes-from', storage['name'],
             '--entrypoint', 'sh', storage['imageId'], '-c', 'cd /mnt && tar -czf - .'], stdout=handle)


def wait_for_services(names: list[str]):
    for name in names:
        for _ in range(60):
            status = output(['docker', 'inspect', '--format',
                             '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}', name])
            if status == 'healthy':
                break
            time.sleep(1)
        else:
            raise RuntimeError(f'Restored service did not become healthy: {name}')


def full_restore(source_project: str, target_project: str, destination: Path) -> dict:
    os.umask(0o077)
    source = require_project(source_project, 'source')
    target = require_project(target_project, 'target')
    require_matching(source, target)
    source_db, target_db = source['db']['name'], target['db']['name']
    require_empty_target(target_db)
    require_no_jobs(source_db)
    if role_inventory(source_db) != role_inventory(target_db):
        raise ValueError('Cluster role definitions differ; restore matching role configuration first')
    destination.mkdir(mode=0o700, parents=True, exist_ok=False)
    source_writers = [source[s]['name'] for s in ('auth', 'rest', 'storage')]
    target_writers = [target[s]['name'] for s in ('auth', 'rest', 'storage')]
    # The drill owns the only API clients and creates no workers or outbound jobs.
    # Leave failed captures/targets stopped for diagnosis; caller cleanup owns them.
    run(['docker', 'stop', *source_writers], stdout=subprocess.DEVNULL)
    before = database_inventory(source_db)
    with (destination/'postgres.dump').open('xb') as handle:
        run(['docker', 'exec', source_db, 'pg_dump', '-U', 'supabase_admin', '-d', 'postgres',
             '--format=custom'], stdout=handle)
    storage_archive(source['storage'], destination/'storage.tgz')
    objects = storage_inventory(destination/'storage.tgz')
    compare_inventory(before, database_inventory(source_db))
    captured_schema = before['schemaSha256']
    # PostgreSQL can flatten redundant AND parentheses when replaying a CHECK.
    # Compile the captured schema separately to define the expected restoration,
    # while retaining and checking the untouched source's original schema hash.
    run(['docker', 'exec', source_db, 'createdb', '-U', 'supabase_admin', '-T', 'template0', '--owner', before['databaseProperties']['owner'], 'openplan_schema_control'])
    with (destination/'postgres.dump').open('rb') as handle:
        run(['docker', 'exec', '-i', source_db, 'pg_restore', '-U', 'supabase_admin',
             '-d', 'openplan_schema_control', '--schema-only', '--exit-on-error', '--single-transaction'], stdin=handle)
    before['schemaSha256'] = schema_hash(source_db, 'openplan_schema_control')
    run(['docker', 'stop', *target_writers], stdout=subprocess.DEVNULL)
    run(['docker', 'exec', target_db, 'createdb', '-U', 'supabase_admin', '-T', 'template0', '--owner', before['databaseProperties']['owner'], 'openplan_recovered'])
    with (destination/'postgres.dump').open('rb') as handle:
        run(['docker', 'exec', '-i', target_db, 'pg_restore', '-U', 'supabase_admin',
             '-d', 'openplan_recovered', '--exit-on-error', '--single-transaction'], stdin=handle)
    restore_database_properties(source_db, target_db, destination)
    # Only the newly created target's connections are ended. Its bootstrap data
    # remains in a disabled database; no DROP, overwrite or source reset occurs.
    sql(target_db, 'ALTER DATABASE postgres ALLOW_CONNECTIONS false', 'template1')
    sql(target_db, "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='postgres'", 'template1')
    sql(target_db, 'ALTER DATABASE postgres RENAME TO openplan_bootstrap_preserved', 'template1')
    sql(target_db, 'ALTER DATABASE openplan_recovered RENAME TO postgres', 'template1')
    with (destination/'storage.tgz').open('rb') as handle:
        run(['docker', 'run', '--rm', '-i', '--network', 'none', '--volumes-from', target['storage']['name'],
             '--entrypoint', 'sh', target['storage']['imageId'], '-c', 'cd /mnt && tar -xzf -'], stdin=handle)
    after = database_inventory(target_db)
    compare_inventory(before, after)
    storage_archive(target['storage'], destination/'restored-storage.tgz')
    if storage_inventory(destination/'restored-storage.tgz') != objects:
        raise ValueError('Restored Storage bytes differ')
    archive_hashes = {}
    for name in ('postgres.dump', 'storage.tgz'):
        with (destination/name).open('rb') as handle:
            archive_hashes[name] = hashlib.file_digest(handle, 'sha256').hexdigest()
    result = {'source': source, 'target': target, 'database': before, 'storage': objects,
              'capturedSchemaSha256': captured_schema,
              'archiveSha256': archive_hashes,
              'bootstrapPreserved': True, 'scope': 'Default local CLI database and Storage; no external workers, custom roles or scheduled SQL jobs'}
    (destination/'manifest.json').write_text(json.dumps(result, indent=2)+'\n')
    run(['docker', 'start', *source_writers, *target_writers], stdout=subprocess.DEVNULL)
    wait_for_services([project[s]['name'] for project in (source, target) for s in ('auth', 'storage')])
    return result


if __name__ == '__main__':
    import sys
    if len(sys.argv) != 4:
        raise SystemExit('Usage: full_restore.py SOURCE_PROJECT TARGET_PROJECT NEW_PRIVATE_DIRECTORY')
    result = full_restore(sys.argv[1], sys.argv[2], Path(sys.argv[3]))
    print(f"[restore-drill] full archive restored: {len(result['database']['tables'])} tables, {len(result['storage'])} files")
