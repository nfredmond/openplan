"""Record exact wheel, source and configuration custody before the image build."""
import hashlib
import json
from pathlib import Path
import sys
import zipfile
from email.parser import BytesParser
from verify_archive import digest

P = Path(__file__).resolve().parent
root = Path(sys.argv[1]); site = Path(sys.argv[2])
versions = {}
for label, directory in [('model','wheels'),('transport','transport-wheels')]:
    lines = []; wheels = []
    for wheel in sorted((root/directory).glob('*.whl')):
        with zipfile.ZipFile(wheel) as z:
            meta = BytesParser().parsebytes(z.read(next(n for n in z.namelist() if n.endswith('.dist-info/METADATA'))))
        name, version = meta['Name'], meta['Version']; sha = digest(wheel)
        lines.append(f'{name}=={version} --hash=sha256:{sha}')
        wheels.append({'file':wheel.name,'sha256':sha,'bytes':wheel.stat().st_size})
        if label == 'model': versions[name.lower().replace('_','-')] = version
    (P/f'requirements-{label}.lock').write_text('\n'.join(lines)+'\n')
    (P/f'wheels-{label}.json').write_text(json.dumps(wheels,indent=2)+'\n')
installed = {str(p.relative_to(site)):digest(p) for p in (site/'activitysim').rglob('*')
             if p.is_file() and (p.suffix == '.py' or 'examples/prototype_mtc/configs/' in str(p))
             and '__pycache__' not in str(p)}
receipt = json.loads((root/'proof-input/receipt.json').read_text())
admission = {'base_image':'python:3.11.15-slim-bookworm@sha256:d29f48a31a8b408ed19272ca1e7b10ebae13b240a27e862d3d4217c528e2e0c3',
             'full':{'sha256':'0465298da115a6de40d23c26d7c21de273be2d48266f76f80813780a7c45d6c2',
                     'bytes':2783118248,'inventory':'full-inventory.json','households':1060601,'persons':2617177},
             'parity2000':{'sha256':receipt['sha256'],'bytes':receipt['bytes'],'inventory':'proof-inventory.json','households':2000,'persons':4971},
             'model_versions':versions,'installed_files':installed,'package_files':{}}
for name in ['runner.py','monitor.py','verify_archive.py','full-inventory.json','proof-inventory.json','chunk_cache.csv']:
    admission['package_files'][name] = digest(P/name)
for p in sorted((P/'configs').rglob('*')):
    if p.is_file(): admission['package_files'][str(p.relative_to(P))] = digest(p)
(P/'admission.json').write_text(json.dumps(admission,indent=2,sort_keys=True)+'\n')
