"""Prove parsing, policy, bounded-array and byte-custody checks with exact restoration."""
import hashlib,json,subprocess,sys
from pathlib import Path
p=Path('scripts/modeling/streamed_json_object.py');original=p.read_bytes();out=Path(__file__).resolve().parent
cases=[('comment',None,None,True),
 ('duplicate-root','or key in seen','or False',False),
 ('semantic-decode',"result = decode(raw.encode('utf-8'))",'result = json.loads(raw)',False),
 ('element-policy','                validate(result)','                pass',False),
 ('root-policy','                validate({key: None})','                pass',False),
 ('discard-array',"if key in discard_arrays and buffer.startswith('['):",'if False:',False),
 ('trailing-content','if buffer or not eof:','if False:',False),
 ('hash',"digest.hexdigest() != expected_file['sha256']",'False',False),
 ('length',"byte_count != expected_file['bytes']",'False',False)]
results=[]
try:
 for name,old,new,survive in cases:
  source=original.decode()
  if old is not None and source.count(old)!=1:raise RuntimeError('Anchor mismatch: '+name)
  p.write_text(source+'\n# Harmless comment.\n' if old is None else source.replace(old,new))
  run=subprocess.run([sys.executable,'-B','-m','unittest','discover','-s','scripts/modeling/tests','-p','test_streamed_json_object.py','-v'],capture_output=True,text=True)
  log=run.stdout+run.stderr;(out/('streamed-json-mutation-'+name+'.log')).write_text(log)
  p.write_bytes(original)
  ok=run.returncode==0 if survive else run.returncode!=0 and 'FAIL:' in log and 'ERROR:' not in log
  results.append({'name':name,'expected':'survive' if survive else 'assertion failure','exit_code':run.returncode,'expected_observed':ok,'restored_sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
  if not ok:break
finally:
 p.write_bytes(original);(out/'streamed-json-mutations.json').write_text(json.dumps(results,indent=2)+'\n')
if len(results)!=len(cases) or not all(r['expected_observed'] for r in results):sys.exit(1)
