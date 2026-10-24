"""Exercise bounded descriptor hashing without changing its byte identity."""
import hashlib,json,subprocess,sys
from pathlib import Path
p=Path('scripts/modeling/common_population.py');original=p.read_bytes();out=Path(__file__).resolve().parent
cases=[('comment',None,None,True),
 ('whole-file', '    digest = hashlib.sha256()\n    size = 0', '    path.read_bytes()\n    digest = hashlib.sha256()\n    size = 0',False),
 ('digest', '            digest.update(block)', '            digest.update(block[:1])',False),
 ('length', '            size += len(block)', '            size += 1',False)]
results=[]
try:
 for name,old,new,survive in cases:
  source=original.decode()
  if old is not None and source.count(old)!=1:raise RuntimeError('Anchor mismatch')
  p.write_text(source+'\n# Harmless comment.\n' if old is None else source.replace(old,new))
  run=subprocess.run([sys.executable,'-B','-m','unittest','test_common_population_memory.MemoryParity.test_descriptor_streams_same_hash_and_length_without_whole_file_read','-v'],cwd='scripts/modeling/tests',capture_output=True,text=True)
  log=run.stdout+run.stderr;(out/('stream-descriptor-mutation-'+name+'.log')).write_text(log)
  p.write_bytes(original)
  ok=run.returncode==0 if survive else run.returncode!=0 and 'FAIL:' in log and 'ERROR:' not in log
  results.append({'name':name,'expected':'survive' if survive else 'assertion failure','exit_code':run.returncode,'expected_observed':ok,'restored_sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
  if not ok:break
finally:
 p.write_bytes(original);(out/'stream-descriptor-mutations.json').write_text(json.dumps(results,indent=2)+'\n')
if len(results)!=len(cases) or not all(r['expected_observed'] for r in results):sys.exit(1)
