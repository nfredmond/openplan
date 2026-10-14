"""Interrupt actual supplied-archive retention, then replay and copy its roots.

The source metadata and archive contents are synthetic. There is no live engine,
application RPC, valid raster/mesh, whole-installation or physical-host claim.
"""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'workers/odm_worker'))
import retained_output_archive as module
from retained_task_observation import Observations
import test_retained_task_observation as fixtures


def child(config, point):
    plan = json.loads((config / 'engine/plan.json').read_bytes())
    observed = json.loads((config / 'observation.json').read_bytes())
    store = Observations(config / 'engine', plan, records_root=config / 'observations')
    if point == 'before-flush':
        original = module.digest
        def interrupted(*args, **kwargs):
            original(*args, **kwargs)
            os._exit(44)
        module.digest = interrupted
    if point == 'after-link':
        original = module.os.link
        def interrupted(source, target, **kwargs):
            original(source, target, **kwargs)
            if Path(target).name == 'archive.zip':
                os._exit(44)
        module.os.link = interrupted
    result = module.retain(store, observed['bodySha256'], source_root=config / 'provided',
        source_name='all.zip', destination=config / 'retained', max_archive_bytes=4096,
        max_expanded_bytes=4096, max_entries=10, max_directory_bytes=4096, timeout=5)
    (config / 'result.json').write_text(json.dumps(result, indent=2) + '\n')


def run(out):
    os.umask(0o077)
    out.mkdir(mode=0o700)
    bindings = {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in
        [Path(__file__), ROOT / 'workers/odm_worker/retained_output_archive.py',
         ROOT / 'workers/odm_worker/retained_task_observation.py', ROOT / 'workers/odm_worker/derived_zip.py']}
    controls = []
    def launch(folder, point):
        completed = subprocess.run([sys.executable, '-B', str(Path(__file__)), '--child', point,
            '--out', str(folder)], capture_output=True, timeout=15,
            env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'})
        (folder / (point + '-private.log')).write_bytes(completed.stdout + completed.stderr)
        return completed.returncode
    for point in ('before-flush', 'after-link'):
        folder = out / point
        folder.mkdir(mode=0o700)
        fixture = fixtures.Checks()
        fixture.setUp()
        try:
            fixture.value['status'] = {'code': 40}
            observed = fixture.store().record(200, fixture.body())
            shutil.copytree(fixture.fixture.root, folder / 'engine')
            shutil.copytree(fixture.records_root, folder / 'observations')
        finally:
            fixture.tearDown()
        (folder / 'observation.json').write_text(json.dumps(observed, indent=2) + '\n')
        source = folder / 'provided'
        source.mkdir(mode=0o700)
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr('odm_orthophoto/ortho.tif', b'Synthetic raster bytes')
            archive.writestr('odm_texturing/model.obj', b'Synthetic mesh bytes')
        raw = buffer.getvalue()
        (source / 'all.zip').write_bytes(raw)
        assert launch(folder, point) == 44, 'Owned archive child must stop at the actual interruption point'
        assert (folder / 'retained/plan.json').exists() and not (folder / 'retained/receipt.json').exists(), 'Interrupted archive must retain its frozen plan without a complete receipt'
        if point == 'after-link':
            assert (folder / 'retained/archive.zip').stat().st_nlink == 2, 'After-link interruption must expose its actual unpublished alias'
            source.rename(folder / 'unavailable-original-source')
        else:
            assert not (folder / 'retained/archive.zip').exists(), 'Before-flush interruption cannot publish archive bytes'
        assert launch(folder, 'replay') == 0, 'Original archive must recover after actual child interruption'
        result = json.loads((folder / 'result.json').read_bytes())
        assert (folder / 'retained/archive.zip').read_bytes() == raw and result['archive']['sha256'] == hashlib.sha256(raw).hexdigest(), 'Recovered archive must preserve its exact original bytes and hash'
        assert result['publicationPermission'] is False and result['callbackPermission'] is False and result['processingQualityVerification'] == 'unassessed', 'Supplied archive recovery cannot grant publication, callback or quality'
        assert (folder / 'retained/archive.zip').stat().st_nlink == 1, 'Recovered archive must reconcile the owned interrupted alias'
        controls.append({'control': point, 'actualChildExit': 44, 'exactBytes': True,
            'publicationPermission': False, 'actualEngineProvenance': False})
        copied = out / (point + '-copied')
        shutil.copytree(folder, copied)
        if (copied / 'provided').exists():
            (copied / 'provided').rename(copied / 'unavailable-source')
        assert launch(copied, 'replay') == 0, 'Local copied roots must replay without the original source'
        assert json.loads((copied / 'result.json').read_bytes()) == result, 'Local copied archive receipt must remain exact'
        controls.append({'control': point + '-copied', 'exactReceipt': True, 'physicalHostRecovery': False})
    for relative, digest in bindings.items():
        assert hashlib.sha256((ROOT / relative).read_bytes()).hexdigest() == digest
    (out / 'controls.json').write_text(json.dumps(controls, indent=2) + '\n')
    (out / 'source-bindings.json').write_text(json.dumps(bindings, indent=2) + '\n')
    print(json.dumps({'controls': len(controls), 'actualInterruptedChildren': 2,
        'actualEngine': False, 'wholeInstallationRecovery': False}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--child', choices=('before-flush', 'after-link', 'replay'))
    arguments = parser.parse_args()
    if arguments.child:
        child(arguments.out.resolve(), arguments.child)
    else:
        run(arguments.out.resolve())
