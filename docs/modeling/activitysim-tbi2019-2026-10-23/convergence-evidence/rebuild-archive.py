"""Replace affected members in a new archive, checking every inherited member."""
import hashlib,json,tarfile
from pathlib import Path
import sys
sys.path.insert(0,'scripts/modeling')
from activitysim_chunk_parity import digest
E=Path(__file__).resolve().parent;OLD=E.parent/'integration-evidence';ROOT=Path('data/_screening_cache/tbi2019-convergence')
prior=json.loads((OLD/'archive-custody.runtime.json').read_text());source=Path(prior['archive_path'])
if digest(source)!=prior['sha256']:raise RuntimeError('Original runtime archive digest differs')
original=json.loads((OLD/'archive-inventory.runtime.json').read_text())
old={r['archive_path']:r for r in original['files']}
new={}
for directory in ['common_population','bundle-all704','bundle','parity-inputs']:
 for p in (ROOT/directory).rglob('*'):
  if p.is_file():new['inputs/'+str(p.relative_to(ROOT))]=p
for directory in [*ROOT.glob('parity-config-*'),*ROOT.glob('runtime-configs-*')]:
 for p in directory.rglob('*'):
  if p.is_file():new['inputs/'+str(p.relative_to(ROOT))]=p
for p in Path('scripts/modeling').glob('*.py'):new['implementation/'+p.name]=p
for p in E.rglob('*'):
 if p.is_file() and p.suffix in {'.json','.py','.md'} and not p.name.startswith('archive-'):
  new['convergence-evidence/'+str(p.relative_to(E))]=p
new['study/POPULATION_CHUNKING_ADDENDUM.md']=E.parent/'POPULATION_CHUNKING_ADDENDUM.md'
readme=ROOT/'ARCHIVE_README.md'
readme.write_text('''# Population-corrected preparation archive

No survey outcomes or modeled travel tables are included. This successor keeps
public source inputs and historical failures from the prior runtime archive.
The original archive remains retained under its original hash. Source controls,
coefficients, geography vintages, tolerances and published margins do not change.
The explicit entropy fitter resolves 673 prior nonconverged fits. Four published
source conflicts remain failed and excluded. See the study addendum and retained
population report for fractional and integer realization results and limitations.

The complete source geography remains in inputs/bundle-all704 and its common
population diagnostics. inputs/bundle is the common runtime domain after MVTA
and failed-population exclusions. Runtime uses every household in that bundle.
inputs/parity-inputs is a fixed 64-household instrument fixture, never the full
run population. Configurations labeled parity are for the parity proof only.

Run ActivitySim 1.5.1 under CPython 3.11. Layer the appropriate explicit runtime
configuration, then inputs/bundle/configs, then stock_configs. The candidate
needs its separately verified frozen coefficient overlay. Use a fresh output
directory and MemoryMax=9G, MemorySwapMax=0, one heavy job at a time. Retain the
engine training cache before production and verify exact final-table parity
before full runs. This archive does not itself assert that parity or full runs
complete. Repository reports outside the archive record those later results.

Historical evidence recipes and absolute source paths document prior execution;
they are not portable commands. Inputs/bundle is the direct CLI data directory.
This is supplied-artifact custody, not producer authentication or scientific
admission. The frozen opening remains closed.
''')
new['inputs/ARCHIVE_README.md']=readme
replaced_prefixes=['inputs/common_population/','inputs/bundle-all704/','inputs/bundle/','inputs/runtime-configs/']
# The old owned recovery pickle belongs to the previous fitter and cannot be
# offered as a recovery checkpoint for these new population inputs.
retired={'inputs/population-fit.checkpoint.pkl','inputs/population-fit.checkpoint.json'}
keep={name:r for name,r in old.items() if name not in retired and name not in new and not any(name.startswith(p) for p in replaced_prefixes)}
entries=[*keep.values(),*[{'archive_path':name,'source_path':str(p),'bytes':p.stat().st_size,'sha256':digest(p)} for name,p in new.items()]]
entries.sort(key=lambda r:r['archive_path'])
inventory=E/'archive-inventory.json';inventory.write_text(json.dumps({'status':'population_corrected_parity_pending_not_scientifically_admitted','parent_archive_sha256':prior['sha256'],'files':entries},indent=2)+'\n')
archive=ROOT/'tbi2019-inputs.population-corrected.tar.gz'
if archive.exists():raise RuntimeError('Successor archive already exists')
seen=set()
class HashedReader:
 def __init__(self,f):self.f=f;self.h=hashlib.sha256();self.size=0
 def read(self,n=-1):
  b=self.f.read(n);self.h.update(b);self.size+=len(b);return b
with tarfile.open(source,'r|gz') as inp,tarfile.open(archive,'w:gz',compresslevel=1) as out:
 for m in inp:
  if not m.isfile() or m.name in seen:raise RuntimeError('Invalid original archive member')
  seen.add(m.name)
  with inp.extractfile(m) as f:
   reader=HashedReader(f)
   if m.name in keep:out.addfile(m,reader)
   else:
    while reader.read(1024*1024):pass
   expected=old.get(m.name)
   if m.name=='archive-inventory.json':expected={'bytes':(OLD/'archive-inventory.runtime.json').stat().st_size,'sha256':digest(OLD/'archive-inventory.runtime.json')}
   if expected is None or reader.size!=expected['bytes'] or reader.h.hexdigest()!=expected['sha256']:
    raise RuntimeError('Original member differs: '+m.name)
 if seen!=set(old)|{'archive-inventory.json'}:raise RuntimeError('Original member census differs')
 for name,p in sorted(new.items()):out.add(p,arcname=name,recursive=False)
 out.add(inventory,arcname='archive-inventory.json',recursive=False)
record={'archive_path':str(archive.resolve()),'sha256':digest(archive),'bytes':archive.stat().st_size,'files':len(entries),'inventory_sha256':digest(inventory),
        'parent_archive_sha256':prior['sha256'],'parent_members_verified':len(seen),'retired_old_checkpoint_members':sorted(retired),
        'claim':'public inputs only; parity pending; no frozen opening','outcomes_included':False,'modeled_outputs_included':False}
(E/'archive-custody.json').write_text(json.dumps(record,indent=2)+'\n');print(json.dumps(record),flush=True)
