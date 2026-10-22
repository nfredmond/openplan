"""Exact UTF-8 history and a separately acknowledged migration parse boundary.

This protocol is not native parser evidence. Only the admitted caller may send.
"""
import hashlib
import json
import os
import time

import journal as j
import policy as p

VERSION = '20261017000017'
NAME = 'portfolio_skip_invalid_classifications'
SOURCE_SHA = 'b129f80e37aa9be71069683acd42df3fb6fdb94078ed0458f20b6e9c5155a41b'


def text_value(raw):
    # Hex contains no SQL quote, backslash or control character from the input.
    raw.decode('utf-8', errors='strict')
    p.require(b'\x00' not in raw, 'history-nul-unrepresentable')
    return "pg_catalog.convert_from(pg_catalog.decode('" + raw.hex() + "','hex'),'UTF8')"


def source_bytes(path):
    p.require(path.is_file() and not path.is_symlink(), 'migration-source-regular')
    raw = path.read_bytes()
    p.same(SOURCE_SHA, hashlib.sha256(raw).hexdigest(), 'migration-source-bytehash')
    text_value(raw)
    return raw


def identity_sql():
    return """SELECT pg_catalog.json_build_object(
'phase','migration-ready','database',current_database(),
'oid',(SELECT oid::pg_catalog.int8 FROM pg_catalog.pg_database WHERE datname=current_database()),
'sessionRole',session_user,'currentRole',current_user,
'postgresSuperuser',(SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname=current_user),
'pid',pg_catalog.pg_backend_pid(),'applicationName',current_setting('application_name'),
'scs',current_setting('standard_conforming_strings'),
'clientEncoding',current_setting('client_encoding'),'serverEncoding',current_setting('server_encoding'));
"""


def ready_identity(value, target):
    expected = {'phase':'migration-ready', 'database':target['database'], 'oid':target['oid'],
        'sessionRole':'supabase_admin',
        'currentRole':'postgres', 'postgresSuperuser':False, 'applicationName':'a0-limit-wrapper',
        'scs':'on', 'clientEncoding':'UTF8', 'serverEncoding':'UTF8'}
    p.same(set(expected) | {'pid'}, set(value), 'migration-ready-fields')
    for key, wanted in expected.items():
        p.same(wanted, value.get(key), 'migration-ready-'+key)
    p.require(type(value.get('pid')) is int and value['pid'] > 0, 'migration-ready-pid')


def wait_ready(handle, target):
    proc, path, out, err = handle
    deadline = time.monotonic() + 6
    while time.monotonic() < deadline:
        raw = (path/'stdout.bin').read_bytes()
        errors = (path/'stderr.bin').read_bytes()
        p.require(not errors, 'migration-ready-stderr')
        if raw.endswith(b'\n'):
            p.same(1, len(raw.splitlines()), 'migration-ready-ambiguous')
            value = json.loads(raw)
            ready_identity(value, target)
            p.require(proc.poll() is None, 'migration-ready-exited')
            os.fsync(out.fileno()); os.fsync(err.fileno())
            j.write(path/'ready.stdout', raw); j.write(path/'ready.stderr', errors)
            j.record(path/'ready.json', value)
            return value
        p.require(proc.poll() is None, 'migration-ready-exited')
        time.sleep(0.02)
    raise ValueError('migration-ready-timeout')


def body(raw, prior_digest):
    p.require(type(prior_digest) is str and len(prior_digest) == 32 and
              all(c in '0123456789abcdef' for c in prior_digest), 'history-prior-digest')
    prefix = "LOCK TABLE supabase_migrations.schema_migrations IN EXCLUSIVE MODE;\n"
    prefix += "DO $history$ BEGIN IF (SELECT md5(coalesce(string_agg(md5(to_jsonb(h)::pg_catalog.text),'' ORDER BY md5(to_jsonb(h)::pg_catalog.text)),'')) FROM supabase_migrations.schema_migrations h)<>'"+prior_digest+"' THEN RAISE EXCEPTION 'migration-history-race'; END IF; END $history$;\n"
    suffix = "\nINSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES ("
    suffix += text_value(VERSION.encode())+','+text_value(NAME.encode())+',ARRAY['+text_value(raw)+']::pg_catalog.text[]);\nCOMMIT;\n'
    return prefix.encode() + raw + suffix.encode()


def execute(controller, raw, prior_digest, bounds):
    controller.inspect()
    # The inherited DO checks the actual system/OID as admin in this very
    # backend. Do not require pg_control_system permission after SET ROLE.
    prelude = controller.identity_guard(controller.db).replace('; ', ';\n')
    # Refuse off. SET ROLE does not apply ALTER ROLE defaults. Each terminator
    # also ends its physical line, so the next psql scan reads current status.
    prelude += 'BEGIN;\n'+bounds.replace(';', ';\n')
    prelude += "SET LOCAL client_encoding='UTF8';\nSET LOCAL ROLE postgres;\n"
    prelude += "DO $role$ BEGIN IF current_user<>'postgres' OR (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname=current_user) THEN RAISE EXCEPTION 'migration-role'; END IF; END $role$;\n"
    prelude += identity_sql()
    first = prelude.encode()
    handle = controller.t.start(controller.argv(controller.db), data=first)
    try:
        handle[0].stdin.write(first); handle[0].stdin.flush()
        before = wait_ready(handle, controller.target)
        dependent = body(raw, prior_digest)
        j.write(handle[1]/'send-body.sql', dependent)
        j.record(handle[1]/'send-body-intent.json', {'backendPID':before['pid'],
            'sourceSHA256':hashlib.sha256(raw).hexdigest(),
            'inputSHA256':hashlib.sha256(dependent).hexdigest(), 'retry':'forbidden'})
        # No migration source byte reaches this same pipe before ready is checked.
        handle[0].stdin.write(dependent); handle[0].stdin.close()
    except BaseException as error:
        j.record(handle[1]/'phase-failure.json', {'type':type(error).__name__,
            'outcome':'unknown; no retry, rollback or backend-absence claim'})
        if not handle[0].stdin.closed:
            handle[0].stdin.close()
        controller.t.finish(handle, timeout=25)
        raise
    code, _ = controller.t.finish(handle, timeout=90)
    p.same(0, code, 'migration-transport-exit-unknown-commit')


def readback_sql():
    return """SELECT pg_catalog.json_build_object('priorDigest',
(SELECT md5(coalesce(string_agg(md5(to_jsonb(p)::pg_catalog.text),'' ORDER BY md5(to_jsonb(p)::pg_catalog.text)),'')) FROM supabase_migrations.schema_migrations p WHERE version<>'20261017000017'),
'rows',coalesce(pg_catalog.json_agg(
pg_catalog.json_build_object('version',version,'name',name,
'cardinality',pg_catalog.cardinality(statements),'statements',statements,
'dimensions',pg_catalog.array_ndims(statements),'lowerBound',pg_catalog.array_lower(statements,1),
'upperBound',pg_catalog.array_upper(statements,1),
'byteLength',pg_catalog.octet_length(pg_catalog.convert_to(statements[1],'UTF8')),
'utf8hex',pg_catalog.encode(pg_catalog.convert_to(statements[1],'UTF8'),'hex'),
'sha256',pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(statements[1],'UTF8')),'hex'))), '[]'::pg_catalog.json))
FROM supabase_migrations.schema_migrations WHERE version='20261017000017';"""


def exact_history(value, raw, prior_digest):
    p.same({'rows','priorDigest'}, set(value), 'history-readback-fields')
    p.same(prior_digest,value.get('priorDigest'),'history-predecessor-unchanged')
    rows = value.get('rows')
    p.require(type(rows) is list and len(rows) == 1, 'history-row-cardinality')
    expected = {'version':VERSION, 'name':NAME, 'cardinality':1,
        'statements':[raw.decode('utf-8', errors='strict')], 'utf8hex':raw.hex(),
        'dimensions':1,'lowerBound':1,'upperBound':1,'byteLength':len(raw),
        'sha256':hashlib.sha256(raw).hexdigest()}
    p.same(set(expected),set(rows[0]),'history-source-exact-readback')
    for key, wanted in expected.items():
        p.same(wanted, rows[0].get(key), 'history-source-exact-readback')
