"""Archive retained public preparation inputs; never include modeled outputs."""
import argparse,hashlib,json,tarfile,datetime,sys,subprocess
from pathlib import Path
sys.path.insert(0,'scripts/modeling')
import activitysim_mtc_inputs as mtc
ROOT=Path('data/_screening_cache/tbi2019-integration');EVIDENCE=Path(__file__).resolve().parent
p=argparse.ArgumentParser();p.add_argument('--partial',action='store_true');args=p.parse_args()
name='tbi2019-inputs.partial.tar.gz' if args.partial else 'tbi2019-inputs.tar.gz'
archive=ROOT/name
if archive.exists():raise RuntimeError('Archive already exists; replacement refused')
if not args.partial and not (ROOT/'bundle/manifest.json').exists():raise RuntimeError('Complete bundle absent')
def sha(path):
 h=hashlib.sha256()
 with path.open('rb') as f:
  for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
 return h.hexdigest()
runtime=ROOT/'runtime-configs'
runtime.mkdir(exist_ok=True)
settings=runtime/'settings.yaml'
settings.write_text('inherit_settings: True\nchunk_size: 4500000000\nchunk_training_mode: adaptive\ndefault_initial_rows_per_chunk: 100\nhouseholds_sample_size: 0\nmultiprocess: False\n')
readme=ROOT/'ARCHIVE_README.md'
readme.write_text("# Partial input archive\n\nThis archive preserves public source and preparation records only. It is not runnable. No complete population or model bundle is asserted. See the repository readiness report and archive inventory for the missing stages.\n" if args.partial else """# Twin Cities 2019 preparation inputs

This is a prepared-input archive, not scientific admission or a frozen study
opening. No TBI outcome fields or modeled travel outputs are included. Consult
the repository integration readiness and source reports for all unavailable
inputs and exclusions. Raw source files include failed acquisition responses,
which remain identified by HTTP status in their manifests.

After extraction, the runnable data directory is `inputs/bundle`. Layer
`inputs/runtime-configs`, `inputs/bundle/configs`, then `stock_configs` with
ActivitySim 1.5.1 under CPython 3.11. For the candidate, prepend
`inputs/verified-candidate-overlay`. Use a new output directory. Retain all
retained households. Run through `systemd-run --user --scope -p MemoryMax=6G
-p MemorySwapMax=0`. The archived run recipe documents the original command
and configuration order. Installed dependencies are pinned in the environment
inventories; this archive is not a hermetic interpreter installation.

`inputs/common_population` and `inputs/bundle-all704` retain all 704 source zones.
`inputs/bundle` excludes the 66 identified MVTA-area zones, their resident
households and their destinations. Its manifest records exact exclusions and
ordered matrix positions. This does not resolve MVTA dependence outside those
cities. The common population retains the full realized population and diagnostics.
The owned pickle checkpoint supports local interruption recovery only. The CSV
and canonical JSON common-population package is the portable population record.
The input inventory hashes every included file. The archive's external custody
record gives its final SHA-256. No supplied-file hash authenticates a producer
or establishes accuracy.
""")
files=[]
for path in sorted(ROOT.rglob('*')):
 if not path.is_file() or path.is_symlink() or path.suffix in {'.gz'} and path.name.startswith('tbi2019-inputs'):continue
 relative=path.relative_to(ROOT)
 if any(part.startswith('modeled-') or part=='__pycache__' for part in relative.parts):continue
 # A failed/partial directory stays visible as preparation evidence, not an admitted bundle.
 files.append((path,'inputs/'+str(relative)))
stock=mtc.resolve_stock_prototype_mtc('/home/nathaniel/code/openplan/workers/activitysim_worker/.venv-exec/lib/python3.11/site-packages/activitysim/examples/prototype_mtc/configs')['configs_dir']
files += [(p,'stock_configs/'+str(p.relative_to(stock))) for p in sorted(stock.rglob('*')) if p.is_file()]
for path in sorted(Path('scripts/modeling').glob('*.py')):files.append((path,'implementation/'+path.name))
for path in sorted(EVIDENCE.iterdir()):
 if path.is_file() and path.suffix in {'.json','.py'} and not path.name.startswith(('pipeline','modeled-','archive-custody','archive-inventory')):
  files.append((path,'evidence/'+path.name))
for path in sorted(EVIDENCE.parent.glob('INTEGRATION_*.md')):
 files.append((path,'study/'+path.name))
inventory=[{'archive_path':name,'source_path':str(path),'bytes':path.stat().st_size,'sha256':sha(path)} for path,name in files]
inv=EVIDENCE/('archive-inventory.partial.json' if args.partial else 'archive-inventory.json')
inv.write_text(json.dumps({'status':'partial_not_executable' if args.partial else 'prepared_executable_not_scientifically_admitted','files':inventory},indent=2)+'\n')
with tarfile.open(archive,'w:gz',compresslevel=1) as tar:
 for path,name in files:tar.add(path,arcname=name,recursive=False)
 tar.add(inv,arcname='archive-inventory.json',recursive=False)
record={'status':'partial_not_executable' if args.partial else 'prepared_executable_not_scientifically_admitted',
 'archive_path':str(archive.resolve()),'sha256':sha(archive),'bytes':archive.stat().st_size,
 'inventory_sha256':sha(inv),'files':len(files),'created_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),
 'repository_head_at_archive':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),
 'source_closure_note':'Exact implementation bytes are inventoried; repository may contain uncommitted preparation records at archive time.',
 'outcomes_included':False,'modeled_outputs_included':False,'claim':'supplied artifacts with hashes; not producer authenticated'}
(EVIDENCE/('archive-custody.partial.json' if args.partial else 'archive-custody.json')).write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps(record),flush=True)
