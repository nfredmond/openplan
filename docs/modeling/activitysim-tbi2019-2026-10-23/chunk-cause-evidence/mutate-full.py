"""Exercise full-admission and modeled-health controls; restore both sources."""
import hashlib,json,subprocess,sys
from pathlib import Path
E=Path(__file__).resolve().parent
files={name:(E/name).read_bytes() for name in ['run-full.py','modeled-health.py']}
controls=[
('full-comment','run-full.py',None,None,True),
('full-status','run-full.py',"if result.get('status') != 'passed_choice_parity' or result.get('full_runs_authorized') is not True:",'if False:',False),
('full-cache','run-full.py',"if m.digest(cache) != freeze['cache_sha256']:",'if False:',False),
('full-choice','run-full.py',"if not m.compare('full-preflight-' + label, reference, m.R / (label + '-hybrid')):",'if False:',False),
('full-input','run-full.py',"if m.digest(m.INPUT / 'bundle' / name) != expected:",'if False:',False),
('full-census','run-full.py','for size in [64, 2000]:','for size in [64]:',False),
('health-comment','modeled-health.py',None,None,True),
('health-denominator','modeled-health.py','total = sum(counts.values())','total = max(counts.values(), default=0)',False),
('health-period','modeled-health.py','if low < value <= high:','if low <= value < high:',False),
('health-home-county','modeled-health.py','l.zone_id=h.home_zone_id','l.zone_id=t.tour_id',False),
]
records=[]
try:
 for name,file,before,after,harmless in controls:
  original=files[file].decode();changed=original+'\n# Harmless comment.\n' if before is None else original.replace(before,after,1)
  if changed==original:raise RuntimeError('Mutation did not change source')
  (E/file).write_text(changed)
  run=subprocess.run([sys.executable,'-B',str(E/'test-full.py')],capture_output=True,text=True)
  output=run.stdout+run.stderr;(E/f'mutation-{name}.log').write_text(output)
  accepted=run.returncode==0 if harmless else run.returncode!=0 and 'FAIL:' in output and 'AssertionError' in output and 'ERROR:' not in output
  records.append({'name':name,'file':file,'harmless':harmless,'exit_code':run.returncode,'accepted':accepted})
  (E/file).write_bytes(files[file])
  if not accepted:raise RuntimeError('Unexpected mutation result: '+name)
finally:
 for name,data in files.items():(E/name).write_bytes(data)
 (E/'full-mutations.json').write_text(json.dumps({'controls':records,'source_sha256':{n:hashlib.sha256(b).hexdigest() for n,b in files.items()},'restored_exactly':all((E/n).read_bytes()==b for n,b in files.items())},indent=2)+'\n')
print(json.dumps(records))
