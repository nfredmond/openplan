"""Derive the frozen whole-household fixture from the verified corrected archive."""
import csv
import hashlib
import heapq
import io
import json
from pathlib import Path
import shutil
import sys
import tarfile
from verify_archive import digest, verify_archive

P = Path(__file__).resolve().parent
root = Path(sys.argv[2]); root.mkdir(parents=True, exist_ok=False)
verify_archive(sys.argv[1], P/'full-inventory.json',
               '0465298da115a6de40d23c26d7c21de273be2d48266f76f80813780a7c45d6c2',
               2783118248, root/'full')
subset = root/'subset'; subset.mkdir()
with (root/'full/households.csv').open() as f:
    chosen = heapq.nsmallest(2000, csv.DictReader(f), key=lambda r: hashlib.sha256(
        ('tbi2019-chunk-parity-2000-v1:' + r['household_id']).encode()).digest())
ids = {r['household_id'] for r in chosen}; counts = {}
for table in ['households', 'persons']:
    with (root/f'full/{table}.csv').open() as inp, (subset/f'{table}.csv').open('x') as out:
        reader = csv.DictReader(inp); writer = csv.DictWriter(out, reader.fieldnames)
        writer.writeheader(); n = 0
        for row in reader:
            if row['household_id'] in ids:
                writer.writerow(row); n += 1
        counts[table] = n
for name in ['land_use.csv', 'skims', 'configs']:
    src = root/'full'/name
    if src.is_dir(): shutil.copytree(src, subset/name)
    else: shutil.copyfile(src, subset/name)
records = [{'archive_path':'inputs/bundle/'+str(p.relative_to(subset)),
            'bytes':p.stat().st_size, 'sha256':digest(p)} for p in sorted(subset.rglob('*')) if p.is_file()]
inventory = (json.dumps({'parent_sha256':'0465298da115a6de40d23c26d7c21de273be2d48266f76f80813780a7c45d6c2',
                        'selection':'lowest SHA256(tbi2019-chunk-parity-2000-v1:household_id)',
                        'counts':counts, 'files':records}, indent=2)+'\n').encode()
(P/'proof-inventory.json').write_bytes(inventory)
archive = root/'proof.tar.gz'
with tarfile.open(archive, 'w:gz', compresslevel=1) as out:
    for r in records:
        source = subset/r['archive_path'].removeprefix('inputs/bundle/')
        info = tarfile.TarInfo(r['archive_path']); info.size = r['bytes']; info.mode = 0o600
        with source.open('rb') as f: out.addfile(info, f)
    info = tarfile.TarInfo('archive-inventory.json'); info.size = len(inventory); info.mode = 0o600
    out.addfile(info, io.BytesIO(inventory))
receipt = {'sha256':digest(archive), 'bytes':archive.stat().st_size,
           'inventory_sha256':hashlib.sha256(inventory).hexdigest(), 'counts':counts,
           'tool_sha256':digest(__file__), 'no_outcomes':True}
(root/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps(receipt))
