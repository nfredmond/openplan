"""Prepare isolated inputs and freeze two outcome-free subset memberships."""
import csv, heapq, hashlib, json, shutil, subprocess
from pathlib import Path
import sys
sys.path.insert(0,'scripts/modeling')
from activitysim_chunk_parity import digest
OLD=Path('/home/nathaniel/.t3/worktrees/openplan/t3-8dddce31/data/_screening_cache/tbi2019-convergence')
ROOT=Path('data/_screening_cache/tbi2019-choice-parity').resolve()
E=Path(__file__).resolve().parent
prior=E.parent/'convergence-evidence'
ROOT.mkdir(parents=True,exist_ok=False)
archive=json.loads((prior/'archive-custody.json').read_text())
assert digest(archive['archive_path'])==archive['sha256']
for name in ['bundle','parity-inputs']+[p.name for p in OLD.glob('parity-config-*')]+['runtime-configs-production']:
 subprocess.run(['cp','-a','--reflink=auto',str(OLD/name),str(ROOT/name)],check=True)
# Existing outputs remain read-only and must match the retained receipt.
closure=json.loads((prior/'comparison-closure.json').read_text())
for mode,files in closure['final_files'].items():
 for name,record in files.items():assert digest(OLD/f'parity-current-{mode}'/name)==record['sha256']
subset=ROOT/'inputs-2000';subset.mkdir()
with (ROOT/'bundle/households.csv').open() as f:
 chosen=heapq.nsmallest(2000,csv.DictReader(f),key=lambda r:hashlib.sha256(('tbi2019-chunk-parity-2000-v1:'+r['household_id']).encode()).digest())
ids={r['household_id'] for r in chosen};counts={}
for table in ['households','persons']:
 with (ROOT/'bundle'/f'{table}.csv').open() as inp,(subset/f'{table}.csv').open('x') as out:
  reader=csv.DictReader(inp);writer=csv.DictWriter(out,reader.fieldnames);writer.writeheader();n=0
  for row in reader:
   if row['household_id'] in ids:writer.writerow(row);n+=1
  counts[table]=n
for name in ['land_use.csv','skims']:
 subprocess.run(['cp','-a','--reflink=auto',str(ROOT/'bundle'/name),str(subset/name)],check=True)
record={'archive_sha256':archive['sha256'],'selection':'lowest 2000 SHA256(tbi2019-chunk-parity-2000-v1:household_id), complete households','seed':0,'counts':counts,'household_ids':sorted(ids,key=int),'inputs':{},'configurations':{},'existing_outputs_verified':closure['final_files'],'outcomes_accessed':False}
for folder in [ROOT/'parity-inputs',subset,ROOT/'bundle']:
 record['inputs'][folder.name]={str(p.relative_to(folder)):digest(p) for p in sorted(folder.rglob('*')) if p.is_file()}
for folder in ROOT.glob('*config*'):
 record['configurations'][folder.name]={str(p.relative_to(folder)):digest(p) for p in sorted(folder.rglob('*')) if p.is_file()}
(E/'input-freeze.json').write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps({'counts':counts,'input_freeze_sha256':digest(E/'input-freeze.json')}))
