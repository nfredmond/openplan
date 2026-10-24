"""Run two admitted modeled-only arms and upload an immutable attempt receipt."""
import csv
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import time
import uuid

import boto3
from botocore.config import Config
from monitor import counters, run_stage
from verify_archive import Refusal, digest, verify_archive

PACKAGE = Path(__file__).resolve().parent
ENGINE = '/usr/local/bin/python'


def save(path, data):
    path.write_text(json.dumps(data,indent=2,sort_keys=True)+'\n')


def safe_error(exc):
    # Transport exceptions may contain signed URLs or endpoint details.
    if isinstance(exc, (Refusal, RuntimeError)) and type(exc).__module__ in ('builtins','verify_archive'):
        return str(exc)
    return type(exc).__name__ + ': details withheld; see stage and service error code'


def validate_settings(env):
    required = ['TBI_S3_ENDPOINT','TBI_S3_BUCKET','TBI_ARCHIVE_KEY','TBI_RESULTS_PREFIX',
                'TBI_S3_ACCESS_KEY_ID','TBI_S3_SECRET_ACCESS_KEY']
    if any(not env.get(k) for k in required):
        raise Refusal('missing required environment variable')
    if env.get('TBI_DATASET','full') not in ('full','parity2000'):
        raise Refusal('unsupported dataset')
    if env.get('TBI_NUM_PROCESSES','4') != '4':
        raise Refusal('only the proven four-process configuration is admitted')
    run_id = env.get('TBI_RUN_ID','tbi2019')
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,79}',run_id):
        raise Refusal('invalid run id')
    endpoint = env['TBI_S3_ENDPOINT']
    if not endpoint.startswith(('http://','https://')) or '@' in endpoint or '?' in endpoint:
        raise Refusal('endpoint must be an HTTP(S) URL without credentials or query')
    prefix = env['TBI_RESULTS_PREFIX'].strip('/')
    if not prefix or any(p in ('','.','..') for p in prefix.split('/')):
        raise Refusal('invalid results prefix')
    return run_id, prefix


def model_environment():
    # Credentials stay in the transfer controller, never in engine children.
    return {'PATH':'/usr/local/bin:/usr/bin:/bin','HOME':'/work','LANG':'C.UTF-8',
            'PYTHONDONTWRITEBYTECODE':'1','PYTHONUNBUFFERED':'1',
            'OPENBLAS_NUM_THREADS':'1','OMP_NUM_THREADS':'1','NUMBA_NUM_THREADS':'1',
            'MALLOC_MMAP_THRESHOLD_':'131072','MALLOC_TRIM_THRESHOLD_':'0','MALLOC_ARENA_MAX':'2'}


def prepare_inputs(bundle):
    # This unused field removal is the retained exact-parity derivative.
    path = bundle/'land_use.csv'; target = bundle/'land_use.runtime.csv'
    with path.open() as inp, target.open('x') as out:
        reader = csv.DictReader(inp)
        fields = [f for f in reader.fieldnames if f != 'source_geoid']
        writer = csv.DictWriter(out, fields); writer.writeheader()
        for row in reader: writer.writerow({k:row[k] for k in fields})
    target.replace(path)


def main():
    start = time.monotonic(); state = {'status':'failed','step':'configuration','outcomes_accessed':False}
    client = None; claimed = False; results = None; prefix = None
    try:
        run_id, base_prefix = validate_settings(os.environ)
        # A fresh UUID is mandatory even when an operator repeats the run id.
        attempt = run_id + '-' + uuid.uuid4().hex
        prefix = base_prefix + '/' + attempt
        work = Path('/work')/attempt; work.mkdir(parents=True,exist_ok=False)
        results = work/'results'; results.mkdir()
        state.update(attempt_id=attempt, results_prefix=prefix, dataset=os.environ.get('TBI_DATASET','full'))
        client = boto3.client('s3', endpoint_url=os.environ['TBI_S3_ENDPOINT'],
            region_name=os.environ.get('TBI_S3_REGION','us-east-1'),
            aws_access_key_id=os.environ['TBI_S3_ACCESS_KEY_ID'],
            aws_secret_access_key=os.environ['TBI_S3_SECRET_ACCESS_KEY'],
            aws_session_token=os.environ.get('TBI_S3_SESSION_TOKEN'),
            config=Config(signature_version='s3v4',s3={'addressing_style':'path'},
                          retries={'max_attempts':4,'mode':'standard'},connect_timeout=20,read_timeout=120))
        bucket = os.environ['TBI_S3_BUCKET']
        client.put_object(Bucket=bucket,Key=prefix+'/claim.json',Body=json.dumps(
            {'attempt_id':attempt,'status':'started','outcomes_accessed':False}).encode(),IfNoneMatch='*')
        claimed = True
        print(json.dumps({'attempt_id':attempt,'results_prefix':prefix}),flush=True)
        admission = json.loads((PACKAGE/'admission.json').read_text())
        state['step'] = 'package_verification'
        for name, expected in admission['package_files'].items():
            if digest(PACKAGE/name) != expected: raise Refusal('package file mismatch: '+name)
        spec = admission[state['dataset']]
        state['input_archive'] = spec
        state['step'] = 'download'
        archive = work/'inputs.tar.gz'
        client.download_file(bucket,os.environ['TBI_ARCHIVE_KEY'],str(archive))
        state['step'] = 'archive_verification'
        verification = verify_archive(archive,PACKAGE/spec['inventory'],spec['sha256'],spec['bytes'],work/'bundle')
        save(results/'input-verification.json',verification)
        archive.unlink()
        bundle = work/'bundle'; prepare_inputs(bundle)
        save(results/'runtime-inputs.json',{str(p.relative_to(bundle)):digest(p)
             for p in sorted(bundle.rglob('*')) if p.is_file()})
        # Installed distributions and stock configurations stay independently pinned.
        state['step'] = 'runtime_verification'
        probe = subprocess.run([ENGINE,'-c',
            'import importlib.metadata as m,json,sys,activitysim; from pathlib import Path; '
            'print(json.dumps({"python":list(sys.version_info[:3]),"versions":{d.metadata["Name"].lower().replace("_","-"):d.version for d in m.distributions()},"stock":str(Path(activitysim.__file__).parent/"examples/prototype_mtc/configs")}))'],
            env=model_environment(),check=True,capture_output=True,text=True)
        runtime = json.loads(probe.stdout)
        if runtime['python'] != [3,11,15]: raise Refusal('CPython version mismatch')
        for name, version in admission['model_versions'].items():
            if runtime['versions'].get(name) != version: raise Refusal('dependency version mismatch: '+name)
        stock = Path(runtime['stock'])
        for name, expected in admission['installed_files'].items():
            if digest(Path('/usr/local/lib/python3.11/site-packages')/name) != expected:
                raise Refusal('installed source/config mismatch: '+name)
        save(results/'runtime.json',runtime)
        shutil.copyfile(PACKAGE/'admission.json',results/'admission.json')
        shutil.copytree(PACKAGE/'configs',results/'configs')
        state['arms'] = {}
        for arm in ['current','semcog']:
            output = results/arm; output.mkdir(); (output/'cache').mkdir()
            shutil.copyfile(PACKAGE/'chunk_cache.csv',output/'cache/chunk_cache.csv')
            for part in ['prefix','suffix']:
                state['step'] = arm+'-'+part
                if part == 'suffix':
                    subprocess.run([ENGINE,'-c',
                        'import pandas as p,sys; s=p.read_parquet(sys.argv[1]); '
                        'assert "mp_households" in s.checkpoint_name.values',
                        str(output/'pipeline.parquetpipeline/checkpoints.parquet')],env=model_environment(),check=True,
                        stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
                command = [ENGINE,'-B','-m','activitysim','run','-c',str(PACKAGE/f'configs/{arm}-{part}'),
                           '-c',str(bundle/'configs'),'-c',str(stock),'-d',str(bundle),'-o',str(output)]
                health = run_stage(command,model_environment(),results/(arm+'-'+part),state)
                if part == 'prefix':
                    with (results/(arm+'-'+part)/'engine.log').open() as log:
                        if any('initial_row_size is zero' in line for line in log):
                            raise Refusal('production cache coverage missing')
            names = {f'final_{x}.csv' for x in ['accessibility','land_use','households','persons','tours','trips','joint_tour_participants']}
            if {p.name for p in output.glob('final_*.csv')} != names:
                raise Refusal('final output census mismatch')
            state['arms'][arm] = {'status':'completed','hashes':{n:digest(output/n) for n in sorted(names)}}
        state['status'] = 'completed'; state['step'] = 'complete'
    except BaseException as exc:
        state.update(status='failed',error=safe_error(exc))
    finally:
        state.pop('active_pid',None)
        state['elapsed_seconds'] = time.monotonic()-start
        state['terminal_memory'] = counters()
        if results is not None:
            save(results/'run.json',state)
        if client is not None and claimed:
            try:
                files = []
                for p in sorted(results.rglob('*')):
                    if not p.is_file(): continue
                    relative = str(p.relative_to(results)); sha = digest(p)
                    client.upload_file(str(p),bucket,prefix+'/'+relative,ExtraArgs={'Metadata':{'sha256':sha}})
                    files.append({'path':relative,'bytes':p.stat().st_size,'sha256':sha})
                manifest = (json.dumps({'attempt_id':state['attempt_id'],'files':files},sort_keys=True,indent=2)+'\n').encode()
                client.put_object(Bucket=bucket,Key=prefix+'/manifest.json',Body=manifest)
                state['manifest_sha256'] = hashlib.sha256(manifest).hexdigest()
            except BaseException as exc:
                state.update(status='failed',step='upload',error='artifact upload failed: '+type(exc).__name__)
            # Terminal object is the last upload, including after an earlier upload failure.
            try:
                client.put_object(Bucket=bucket,Key=prefix+'/terminal.json',
                                  Body=json.dumps(state,sort_keys=True,indent=2).encode(),IfNoneMatch='*')
            except BaseException as exc:
                state.update(status='failed',error='terminal upload failed: '+type(exc).__name__)
        print(json.dumps({'status':state['status'],'step':state['step'],
                          'error':state.get('error'),'results_prefix':prefix}),flush=True)
    return 0 if state['status'] == 'completed' else 1


if __name__ == '__main__':
    # SIGKILL/host loss cannot execute cleanup; a missing terminal is incomplete.
    def terminate(signum, frame):
        raise RuntimeError('controller terminated by signal '+str(signum))
    signal.signal(signal.SIGTERM,terminate)
    sys.exit(main())
