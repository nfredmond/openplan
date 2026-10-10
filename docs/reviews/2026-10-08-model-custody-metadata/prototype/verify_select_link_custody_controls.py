"""Mutate the actual select-link diagnostic block used by the worker."""
import hashlib,json,subprocess,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parent
WORKER=ROOT.parents[3]/'workers/aequilibrae_worker'
source=(WORKER/'main.py').read_text()
old='        except WorkerStateWriteUnconfirmed:\n            raise\n        except Exception as e:\n            select_link_sets = {}'
new='        except Exception as e:\n            select_link_sets = {}'
assert source.count(old)==1
cases=[('baseline',source,None),('harmless',source+'\n# Harmless comment.\n',None),
       ('swallow-write',source.replace(old,new),'test_unconfirmed_stage_write_escapes_diagnostic_handler'),
       ('omit-database-close',source.replace('                    _sl_db.close()','                    pass'),'test_extension_failure_still_closes_database'),
       ('reject-ordinary-diagnostic',source.replace('            select_link_sets = {}\n            log += f"Select-link setup warning', '            raise\n            log += f"Select-link setup warning'),'test_ordinary_diagnostic_failure_remains_a_warning'),
       ('restored',source,None)]
runner='''
import sys,unittest
from pathlib import Path
from unittest.mock import patch
candidate=Path(sys.argv[1]).read_text();original=Path.read_text
def read(path,*args,**kwargs):
 if path.name=='main.py' and path.parent.name=='aequilibrae_worker':return candidate
 return original(path,*args,**kwargs)
name='test_select_link_custody'+('.SelectLinkCustody.'+sys.argv[2] if sys.argv[2] else '')
with patch.object(Path,'read_text',read):
 result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromName(name))
raise SystemExit(0 if result.wasSuccessful() else 1)
'''
records=[]
with tempfile.TemporaryDirectory() as temp:
 p=Path(temp)/'candidate.py'
 for name,body,target in cases:
  p.write_text(body)
  result=subprocess.run([sys.executable,'-B','-c',runner,str(p),target or ''],cwd=WORKER,capture_output=True,text=True,timeout=30)
  if target:
   kind='ERROR: ' if name=='reject-ordinary-diagnostic' else 'FAIL: '
   if result.returncode!=1 or kind+target not in result.stderr:raise AssertionError(name+': '+result.stderr)
  elif result.returncode:raise AssertionError(name+': '+result.stderr)
  records.append({'control':name,'exit_code':result.returncode,'targeted_test':target})
report={'worker_sha256':hashlib.sha256(source.encode()).hexdigest(),'controls':records,'limits':'Actual extracted select-link block, real CSV and mocked database, screenline selection and state transport. No full assignment or scientific acceptance.'}
content=json.dumps(report,indent=2)+'\n';(ROOT/'select-link-custody-controls.json').write_text(content);print(content)
