"""Read useful original products under actual access on one isolated selected schema.

The retained profile is fixed evidence, not a portable installation command.
No engine starts, source fetches, callback delivery or publication are allowed.
"""
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

PG = 'a79d62deecea7fd1d1099b35863ca3de50ef7f44618c3c130c9f5b34b024bed3'
REST = '3c6255798df56cb37d42b9aa226123919409cbf5d50ce57c97c9000ecb76950f'
DATABASE = 'odm_output_68adf5426c164b71b653efeb24d42c9a'
PROOF = Path('/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009')
PROFILE = PROOF/'odm-output-schema-recovery-20261014/main41c-controls-01/baseline-private'


def inspect(identity):
    return json.loads(subprocess.check_output(['docker', 'inspect', identity]))[0]


def run(repo, out, *, child=False):
    os.umask(0o077)
    sys.path.insert(0, str(repo/'workers/odm_worker'))
    from application_dispatch_http import Transport
    from application_dispatch_reader import Reader
    from runtime_admission import Runtime
    from runtime_dispatch_custody import Custody
    from runtime_observation import Observer
    from runtime_output_intake import Intake
    from runtime_products import Products
    helper_spec = importlib.util.spec_from_file_location('owned_profile',
        repo/'docs/reviews/2026-10-12-odm-private-dispatch-reader/native_rpc_recovery.py')
    helper = importlib.util.module_from_spec(helper_spec)
    helper_spec.loader.exec_module(helper)
    useful = PROOF/'odm-useful-output-native-20261013/processing-05'
    original = PROFILE/'upgraded-runtime'
    dispatch = json.loads(next(original.glob('original-dispatch-*/receipt.json')).read_bytes())
    job, request, binding = dispatch['applicationJob'], json.loads(dispatch['payloadText']), dispatch['binding']
    expected = json.loads((useful/'retained-output.json').read_bytes())
    observation = expected['archive']['observationSha256']
    pv, rv = inspect(PG), inspect(REST)
    for value, identity, image, memory in [(pv, PG, helper.PG_IMAGE, 1073741824),
            (rv, REST, helper.REST_IMAGE, 134217728)]:
        assert value['Id'] == identity and value['Image'] == image
        assert value['HostConfig']['Memory'] == value['HostConfig']['MemorySwap'] == memory
        assert not value['HostConfig']['PortBindings']
        assert value['State']['Running'] is child, 'Owned profile running state differs'
    assert pv['Config']['Labels']['openplan.purpose'] == helper.PURPOSE
    assert rv['Config']['Labels']['openplan.proof'] == str(PROFILE)
    network = next(iter(pv['NetworkSettings']['Networks']))
    assert list(rv['NetworkSettings']['Networks']) == [network]
    net = json.loads(subprocess.check_output(['docker', 'network', 'inspect', network]))[0]
    assert net['Internal'] and net['Labels']['openplan.purpose'] == helper.PURPOSE
    env = dict(row.split('=', 1) for row in rv['Config']['Env'] if '=' in row)
    assert urlsplit(env['PGRST_DB_URI']).path == '/'+DATABASE
    q = helper.quote
    where = 'workspace_id='+q(job['workspace_id'])+' AND user_id='+q(job['created_by'])
    sequence = 0

    def sql(query, label):
        nonlocal sequence
        sequence += 1
        p = subprocess.run(['docker', 'exec', '-i', PG, 'psql', '-XqAt', '-U', 'postgres',
            '-d', DATABASE, '-v', 'ON_ERROR_STOP=1'], input=query.encode(), capture_output=True, timeout=35)
        (out/(f'{sequence:03d}-'+label+'-private.log')).write_bytes(p.stdout+p.stderr)
        assert p.returncode == 0, 'Owned product SQL failed: '+label
        return p.stdout.decode().strip()

    def token():
        encode = lambda value: base64.urlsafe_b64encode(json.dumps(value, separators=(',', ':')).encode()).rstrip(b'=')
        raw = encode({'alg': 'HS256', 'typ': 'JWT'})+b'.'+encode({'role': 'service_role', 'exp': int(time.time())+3600})
        return (raw+b'.'+base64.urlsafe_b64encode(hmac.new(env['PGRST_JWT_SECRET'].encode(), raw, hashlib.sha256).digest()).rstrip(b'=')).decode()

    def consumer(root, *, revoke_after_copy=False, exit_after_copy=False):
        runtime = Runtime(root, binding['installationId'], max_queued=2, pipeline=lambda _job: None)
        custody = Custody(runtime, binding['targetId'], timeout=30)
        address = inspect(REST)['NetworkSettings']['Networks'][network]['IPAddress']
        transport = Transport('http://'+address+':3000', 'owned-original-products',
            lambda _ref: {'apiKey': token(), 'bearerToken': token()}, allow_http=True)
        reads = []
        def rpc(arguments, deadline, *, owned):
            reads.append(arguments)
            if revoke_after_copy and len(reads) == 5:
                sql("UPDATE public.workspace_members SET role='viewer' WHERE "+where+';', 'revoke-after-copy')
            return transport(arguments, deadline, owned=owned)
        def refuse(*_args, **_kwargs):
            raise AssertionError('Saved product recovery cannot contact an engine or fetch input')
        observer = Observer(Reader(custody, rpc, timeout=10), refuse, refuse, timeout=30)
        intake = Intake(observer, max_archive_bytes=256*1024**2, max_expanded_bytes=1024**3,
            max_entries=10000, max_directory_bytes=4*1024**2, timeout=120)
        products = Products(intake, timeout=120)
        if exit_after_copy:
            original_copy = products._copy
            def interrupted(*args):
                original_copy(*args)
                if args[2]['kind'] == 'orthomosaic':
                    os._exit(44)
            products._copy = interrupted
        return runtime, products, reads

    if child:
        assert out.is_dir() and not any(out.glob('preparation-*/private-products'))
        runtime, products, _reads = consumer(out, exit_after_copy=True)
        with runtime.owner():
            products.advance(request['requestId'], observation)
        raise AssertionError('Owned product child must stop after its first member')

    out.mkdir(mode=0o700)
    assert shutil.disk_usage(out).free > 5*1024**3
    started, actor_role = [], None
    try:
        subprocess.run(['docker', 'start', PG], check=True, stdout=subprocess.DEVNULL)
        started.append(PG)
        for _ in range(120):
            if subprocess.run(['docker', 'exec', PG, 'pg_isready', '-U', 'supabase_admin'], capture_output=True).returncode == 0:
                break
            time.sleep(.25)
        else:
            raise TimeoutError('Owned product database readiness')
        versions = json.loads(sql('SELECT json_agg(version ORDER BY version) FROM supabase_migrations.schema_migrations;', 'history'))
        selected = sorted(path.name.split('_', 1)[0] for path in (repo/'openplan/supabase/migrations').glob('*.sql'))
        assert versions == selected and len(versions) == 409, 'Owned products need the selected 409-migration fixture'
        actor_role = sql('SELECT role FROM public.workspace_members WHERE '+where+';', 'original-role')
        assert actor_role == 'member', 'Selected original actor role differs'
        subprocess.run(['docker', 'start', REST], check=True, stdout=subprocess.DEVNULL)
        started.append(REST)
        root = out/'runtime'
        shutil.copytree(original, root)
        runtime, products, reads = consumer(root)
        for _ in range(120):
            try:
                reply = products.intake.observer.reader.transport(
                    {'p_request': request['requestId'], 'p_installation': binding['installationId'], 'p_target': binding['targetId']},
                    time.monotonic()+2, owned=lambda: True)
                if json.loads(reply)['authorizedNow'] is True:
                    break
            except (OSError, ValueError, TimeoutError):
                time.sleep(.25)
        else:
            raise TimeoutError('Owned products RPC readiness')
        reads.clear()
        with runtime.owner():
            result = products.advance(request['requestId'], observation)
        assert len(reads) == 5, 'Original products need five actual current access reads'
        pack = next(root.glob('preparation-*/private-products'))
        for row in result['products']:
            if row['availability'] == 'retained':
                payload = (pack/'objects'/row['filename']).read_bytes()
                assert len(payload) == row['bytes'] and hashlib.sha256(payload).hexdigest() == row['sha256'], 'Actual product bytes differ'
        assert result['archive'] == {key: expected['archive']['archive'][key] for key in ('bytes', 'sha256')}
        reads.clear()
        with runtime.owner():
            replay = products.advance(request['requestId'], observation)
        assert replay == result and len(reads) == 5, 'Saved native products must replay exact custody under current access'
        for key in ['processingQualityVerification', 'requestedDeliverableCompletenessVerification', 'archiveTaskProvenanceVerification']:
            assert result[key] == 'unassessed', 'Private native products cannot promote '+key
        assert result['callbackPermission'] is False and result['publicationPermission'] is False, 'Native products cannot permit delivery'
        interrupted_root = out/'interrupted-runtime'
        shutil.copytree(original, interrupted_root)
        p = subprocess.run([sys.executable, '-B', str(Path(__file__).resolve()), '--repo', str(repo),
            '--out', str(interrupted_root), '--child'], capture_output=True, timeout=180)
        (out/'interrupted-child-private.log').write_bytes(p.stdout+p.stderr)
        assert p.returncode == 44, 'Actual product child must exit after retained member bytes'
        interrupted_pack = next(interrupted_root.glob('preparation-*/private-products'))
        assert (interrupted_pack/'objects/orthophoto.tif').exists() and not (interrupted_pack/'receipt.json').exists()
        resumed, recovered, resumed_reads = consumer(interrupted_root)
        with resumed.owner():
            recovered_result = recovered.advance(request['requestId'], observation)
        assert recovered_result == result and len(resumed_reads) == 5, 'Actual interrupted products must recover original receipt and access'
        revoked_root = out/'revoked-runtime'
        shutil.copytree(original, revoked_root)
        revoked, candidate, revoked_reads = consumer(revoked_root, revoke_after_copy=True)
        try:
            with revoked.owner():
                candidate.advance(request['requestId'], observation)
        except PermissionError:
            pass
        else:
            raise AssertionError('Actual post-copy actor revocation must refuse completion')
        revoked_pack = next(revoked_root.glob('preparation-*/private-products'))
        assert len(revoked_reads) == 5 and (revoked_pack/'objects/orthophoto.tif').exists()
        assert not (revoked_pack/'receipt.json').exists(), 'Revoked original products cannot publish completion'
        record = {'selectedMigrations': 409, 'actualReadsPerCompletedOperation': 5,
            'originalArchive': result['archive'], 'products': result['products'],
            'savedReplayExact': True, 'actualChildExit': 44, 'interruptedReplayExact': True,
            'postCopyRevocationRefused': True, 'revokedBytesRetained': True,
            'callbackPermission': False, 'publicationPermission': False,
            'scope': 'isolated_selected_schema_private_original_product_custody',
            'physicalHostRecovery': False, 'scientificAcceptance': False}
        (out/'result.json').write_text(json.dumps(record, indent=2)+'\n')
        print(json.dumps(record), flush=True)
    finally:
        try:
            if actor_role is not None:
                sql('UPDATE public.workspace_members SET role='+q(actor_role)+' WHERE '+where+';', 'restore-original-role')
        finally:
            stopped = []
            for identity in reversed(started):
                if inspect(identity)['State']['Running']:
                    subprocess.run(['docker', 'stop', '--time', '120', identity], check=True, stdout=subprocess.DEVNULL)
                value = inspect(identity)
                assert not value['State']['Running'] and not value['State']['OOMKilled']
                stopped.append({'id': identity, 'running': False, 'oomKilled': False})
        (out/'stopped.json').write_text(json.dumps(stopped)+'\n')
        group = Path('/sys/fs/cgroup')/Path('/proc/self/cgroup').read_text().split('0::', 1)[1].strip().lstrip('/')
        (out/'resources.json').write_text(json.dumps({key: (group/key).read_text().strip()
            for key in ['memory.max', 'memory.peak', 'memory.swap.max', 'memory.swap.peak', 'memory.events']}, indent=2)+'\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--repo', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--child', action='store_true')
    args = parser.parse_args()
    run(args.repo.resolve(), args.out.resolve(), child=args.child)
