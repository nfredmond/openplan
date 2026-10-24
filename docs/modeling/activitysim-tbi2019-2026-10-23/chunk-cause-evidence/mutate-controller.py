"""Mutate only the owned controller, then restore its exact bytes."""
import hashlib,json,subprocess,sys
from pathlib import Path
E=Path(__file__).resolve().parent
source=E/'run-hybrid.py';original=source.read_bytes();text=original.decode()
controls=[
 ('harmless-comment',None,None,True),
 ('input-refusal',"if digest(INPUT / folder / name) != expected:","if False:",False),
 ('cache-refusal',"if 'initial_row_size is zero' in log:","if False:",False),
 ('choice-stop',"if not compare(label + '-hybrid', reference, output):","if False and not compare(label + '-hybrid', reference, output):",False),
 ('engine-refusal',"if completed.returncode:","if False:",False),
 ('reference-custody',"if actual != receipt['final_files'] or actual_config != receipt['config_files'] or receipt['exit_code'] != 0:","if False:",False),
 ('complete-census',"for size in [64, 2000]:","for size in [64]:",False),
]
records=[]
try:
 for name,before,after,success in controls:
  changed=text+'\n# Harmless controller comment.\n' if before is None else text.replace(before,after,1)
  if changed==text:raise RuntimeError('Mutation did not alter source')
  source.write_text(changed)
  result=subprocess.run([sys.executable,'-B',str(E/'test-controller.py')],capture_output=True,text=True)
  output=result.stdout+result.stderr
  (E/f'mutation-{name}.log').write_text(output)
  accepted=(result.returncode==0) if success else (result.returncode!=0 and 'FAIL:' in output and 'AssertionError' in output and 'ERROR:' not in output)
  records.append({'name':name,'harmless':success,'exit_code':result.returncode,'accepted':accepted})
  source.write_bytes(original)
  if not accepted:raise RuntimeError(f'Unexpected mutation result: {name}')
finally:
 source.write_bytes(original)
 (E/'controller-mutations.json').write_text(json.dumps({'controls':records,'source_sha256':hashlib.sha256(original).hexdigest(),'restored_exactly':source.read_bytes()==original},indent=2)+'\n')
print(json.dumps(records))
