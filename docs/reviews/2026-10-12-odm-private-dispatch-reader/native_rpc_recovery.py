"""Reopen a verified owned RPC fixture, exercise private capture and stop it."""
import argparse
import base64
import hashlib
import hmac
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
CLIENT = HERE / 'native_client.py'
READER = ROOT / 'workers/odm_worker/application_dispatch_reader.py'
MIGRATION = ROOT / 'openplan/supabase/migrations/20261017000003_aerial_private_dispatch_custody.sql'
PG_IMAGE = 'sha256:ca7871b587ca2c401ac0f325df6249c9aa0d25647ded34631158efc51176767f'
REST_IMAGE = 'sha256:2f8e7b656f09db697a8875177694b417b35cb76c21370de07fc54e711e902326'
PURPOSE = 'odm-private-dispatch-rpc-cli-20261012'


def quote(value):return "'" + str(value).replace("'", "''") + "'"


def intended_failure(code, diagnostic, reason):
    errors = re.findall(r'^([A-Za-z_][\w.]*Error:.*)$', diagnostic, flags=re.MULTILINE)
    return code == 1 and errors == ['AssertionError: ' + reason]


def oracle_controls():
    reason = 'Native original differs';diagnostic = 'Traceback (most recent call last):\nAssertionError: ' + reason + '\n'
    rows = []
    for label, text in [('baseline', diagnostic), ('harmless', diagnostic + '# Harmless diagnostic comment.\n'), ('restored', diagnostic)]:
        assert intended_failure(1, text, reason)
        rows.append({'control': label, 'outcome': 'survived'})
    for label, code, text in [('zero-exit', 0, diagnostic), ('wrong-reason', 1, diagnostic.replace(reason, 'Unrelated error')),
        ('extra-error', 1, diagnostic + 'ValueError: Unexpected secondary error\n'), ('missing-error', 1, 'Traceback (most recent call last):\n'),
        ('wrong-error-type', 1, diagnostic.replace('AssertionError:', 'ValueError:'))]:
        assert not intended_failure(code, text, reason), 'Native reader oracle accepted an unrelated failure'
        rows.append({'control': label, 'outcome': 'intended_refusal'})
    return rows


def run(fixture, out, *, after_restore=None):
    os.umask(0o077);out.mkdir(mode=0o700)
    (out / 'oracle-controls.json').write_text(json.dumps(oracle_controls(), indent=2) + '\n')
    assert shutil.disk_usage(out).free > 5 * 1024**3
    original = READER.read_bytes();migration = MIGRATION.read_bytes()
    saved_result = json.loads((fixture / 'result.json').read_text())
    assert saved_result['migrationSha256'] == hashlib.sha256(migration).hexdigest(), 'Retained RPC fixture must match the current migration'
    config = json.loads((fixture / 'baseline-ordinary-configuration-private.json').read_text())
    pg = (fixture / 'create-private-database-private.log').read_text().strip()
    rest = (fixture / 'baseline-create-rest-private.log').read_text().strip()
    def inspect(identity):return json.loads(subprocess.check_output(['docker', 'inspect', identity]))[0]
    network = None
    def verify(identity, image, memory):
        info = inspect(identity);host = info['HostConfig']
        assert info['Id'] == identity and info['Image'] == image and info['Config']['Labels']['openplan.purpose'] == PURPOSE
        assert host['Memory'] == host['MemorySwap'] == memory and host['PidsLimit'] == 128 and not host['PortBindings']
        assert len(info['NetworkSettings']['Networks']) == 1
        if network is not None:assert list(info['NetworkSettings']['Networks']) == [network]
        return info
    pg_info = verify(pg, PG_IMAGE, 1073741824);rest_info = verify(rest, REST_IMAGE, 134217728)
    assert not pg_info['State']['Running'] and not rest_info['State']['Running'], 'Retained RPC services must be stopped before this owner reopens them'
    network = next(iter(pg_info['NetworkSettings']['Networks']))
    assert list(rest_info['NetworkSettings']['Networks']) == [network]
    net = json.loads(subprocess.check_output(['docker', 'network', 'inspect', network]))[0]
    assert net['Internal'] is True and net['Labels']['openplan.purpose'] == PURPOSE
    env = dict(item.split('=', 1) for item in rest_info['Config']['Env'] if '=' in item)
    database = urlsplit(env['PGRST_DB_URI']).path[1:]
    assert re.fullmatch(r'rpc_dispatch_[0-9a-f]{32}', database)
    def token(role):
        encode = lambda value: base64.urlsafe_b64encode(json.dumps(value, separators=(',', ':')).encode()).rstrip(b'=')
        content = encode({'alg': 'HS256', 'typ': 'JWT'}) + b'.' + encode({'role': role, 'exp': int(time.time()) + 3600})
        return (content + b'.' + base64.urlsafe_b64encode(hmac.new(env['PGRST_JWT_SECRET'].encode(), content, hashlib.sha256).digest()).rstrip(b'=')).decode()
    config['serviceToken'] = token('service_role');config['anonToken'] = token('anon')
    rows = []
    def sql(query, label):
        result = subprocess.run(['docker', 'exec', '-i', pg, 'psql', '-XqAt', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1'], input=query.encode(), capture_output=True, timeout=35)
        (out / (label + '-private.log')).write_bytes(result.stdout + result.stderr)
        assert result.returncode == 0, 'Owned reader SQL failed: ' + label
        return result.stdout.decode().strip()
    helper_path = ROOT / 'docs/reviews/2026-10-11-odm-url-transport/verify_controls.py'
    spec = importlib.util.spec_from_file_location('reader_native_fault_helper', helper_path)
    helper = importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
    def phase(label, operation, root, reason=None):
        private = out / (label + '-configuration-private.json');private.write_text(json.dumps(config))
        output = out / (label + '-result.json')
        result = subprocess.run([sys.executable, '-B', str(CLIENT), str(private), operation, str(root), str(output)], cwd=ROOT,
            capture_output=True, text=True, timeout=15, env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'})
        diagnostic = result.stdout + result.stderr
        (out / (label + '-private.log')).write_text(diagnostic)
        (out / (label + '-process.json')).write_text(json.dumps({'returncode': result.returncode}) + '\n')
        if reason is not None:
            assert intended_failure(result.returncode, diagnostic, reason), 'Wrong native private reader fault: ' + label
            rows.append({'control': label, 'outcome': 'intended_failure', 'reason': reason})
        else:
            assert result.returncode == 0 and output.exists(), 'Actual private reader failed: ' + label
            rows.append({'control': label, 'outcome': 'survived', **json.loads(output.read_text())})
        (out / 'partial-controls.json').write_text(json.dumps(rows, indent=2) + '\n')
        print(label + ': ' + rows[-1]['outcome'], flush=True)
    actor = config['job']['created_by'];workspace = config['job']['workspace_id']
    member_where = 'workspace_id=' + quote(workspace) + ' AND user_id=' + quote(actor)
    read_function = migration.decode().split('CREATE FUNCTION public.read_aerial_original_dispatch', 1)[1]
    read_function = 'CREATE OR REPLACE FUNCTION public.read_aerial_original_dispatch' + read_function
    touched_role = False;touched_function = False
    try:
        subprocess.run(['docker', 'start', pg], check=True, stdout=subprocess.DEVNULL)
        for _ in range(360):
            if subprocess.run(['docker', 'exec', pg, 'pg_isready', '-U', 'supabase_admin'], capture_output=True).returncode == 0:break
            time.sleep(.5)
        else:raise TimeoutError('Owned reader database readiness')
        assert sql('SELECT role FROM public.workspace_members WHERE ' + member_where + ';', 'actor-before') == 'owner'
        subprocess.run(['docker', 'start', rest], check=True, stdout=subprocess.DEVNULL)
        info = verify(rest, REST_IMAGE, 134217728)
        config['endpoint'] = 'http://' + info['NetworkSettings']['Networks'][network]['IPAddress'] + ':3000'
        import urllib.request
        for _ in range(120):
            try:
                probe = urllib.request.Request(config['endpoint'] + '/aerial_processing_jobs?select=id&limit=0', headers={'Authorization': 'Bearer ' + config['serviceToken']}, method='HEAD')
                with urllib.request.urlopen(probe, timeout=1):break
            except Exception:time.sleep(.25)
        else:raise TimeoutError('Owned reader RPC readiness')
        for label in ('baseline', 'harmless', 'restored'):
            READER.write_bytes(original + (b'\n# Harmless installed reader comment.\n' if label == 'harmless' else b''))
            parent = out / label;parent.mkdir(mode=0o700)
            root = parent / 'runtime'
            phase(label + '-capture', 'capture', root)
            relocated = parent / 'relocated-runtime';shutil.copytree(root, relocated)
            phase(label + '-relocated-recovery', 'recover', relocated)
        READER.write_bytes(helper.replace(original.decode(), "return receipt['payloadText'].encode('utf-8'), receipt['applicationJob']", "return receipt['payloadText'].strip().encode('utf-8'), receipt['applicationJob']").encode())
        fault = out / 'changed-original';fault.mkdir(mode=0o700)
        phase('changed-original-before-fetch', 'capture', fault / 'runtime', 'Native private original must precede source fetching')
        READER.write_bytes(original)
        touched_role = True;sql("UPDATE public.workspace_members SET role='viewer' WHERE " + member_where + ';', 'revoke-original-actor')
        root = out / 'baseline/runtime'
        phase('current-revoked-observation', 'observe', root)
        denied = out / 'refusals';denied.mkdir(mode=0o700)
        for operation in ('revoked-first', 'wrong-target', 'anonymous'):
            phase(operation, operation, denied / operation)
        READER.write_bytes(helper.replace(original.decode(), "'authorizedNow': current['authorizedNow']", "'authorizedNow': True").encode())
        phase('revoked-observation-promoted', 'observe', root, 'Native private observation must preserve revoked access')
        READER.write_bytes(original)
        sql("UPDATE public.workspace_members SET role='owner' WHERE " + member_where + ';', 'restore-original-actor');touched_role = False
        # An owned native engine proof can test refusal after actual access returns.
        if after_restore is not None:
            after_restore(phase, root)
        assert read_function.count('  SELECT * INTO saved') == 1
        touched_function = True;sql(read_function.replace('  SELECT * INTO saved', '  PERFORM pg_sleep(25);\n  SELECT * INTO saved'), 'stall-own-read')
        phase('installed-stalled-read-shared-deadline', 'deadline', root)
        # The remote read can outlive its closed client. Wait for its fixture
        # statement to finish before restoring the definition or stopping it.
        for _ in range(120):
            if sql("SELECT count(*) FROM pg_stat_activity WHERE usename='authenticator' AND state='active' AND query LIKE '%read_aerial_original_dispatch%';", 'wait-own-read-' + str(_)) == '0':break
            time.sleep(.25)
        else:raise TimeoutError('Owned reader remote query remains active')
        sql(read_function, 'restore-own-read');touched_function = False
        # Observe expects a revoked actor. Recheck that assertion after restore.
        touched_role = True;sql("UPDATE public.workspace_members SET role='viewer' WHERE " + member_where + ';', 'revoke-after-stall')
        phase('restored-current-observation', 'observe', root)
        sql("UPDATE public.workspace_members SET role='owner' WHERE " + member_where + ';', 'restore-final-actor');touched_role = False
        (out / 'controls.json').write_text(json.dumps(rows, indent=2) + '\n')
        bindings = {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest() for path in (READER, MIGRATION, CLIENT, Path(__file__))}
        (out / 'source-bindings.json').write_text(json.dumps(bindings, indent=2) + '\n')
    finally:
        READER.write_bytes(original)
        with READER.open('rb') as stream:os.fsync(stream.fileno())
        if inspect(pg)['State']['Running']:
            if touched_function:sql(read_function, 'finally-restore-own-read')
            if touched_role:sql("UPDATE public.workspace_members SET role='owner' WHERE " + member_where + ';', 'finally-restore-original-actor')
        stopped = []
        for identity, image, memory in ((rest, REST_IMAGE, 134217728), (pg, PG_IMAGE, 1073741824)):
            info = verify(identity, image, memory)
            if info['State']['Running']:subprocess.run(['docker', 'stop', '--time', '120', identity], check=True, stdout=subprocess.DEVNULL)
            assert not inspect(identity)['State']['Running']
            stopped.append({'memoryMaxBytes': memory, 'stopped': True, 'oomKilled': info['State']['OOMKilled']})
        (out / 'stopped.json').write_text(json.dumps(stopped, indent=2) + '\n')
        assert READER.read_bytes() == original and MIGRATION.read_bytes() == migration


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fixture', type=Path, required=True);parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args();run(args.fixture.resolve(), args.out.resolve())
